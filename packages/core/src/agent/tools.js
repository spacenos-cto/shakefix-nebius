// Tool set of the local agent runner. Tool names match the GitLab Duo tool names used in
// .gitlab/duo/flows/shakefix.yml so the SAME role prompts work unchanged; each role only gets the
// tools its component lists in the YAML (carried into .shakefix/prompts/<role>.md).

import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SandboxError } from './sandbox.js';

const MAX_READ = 20_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.pnpm-store', 'playwright-report', 'test-results', 'coverage']);

const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => String(s).trim()).filter(Boolean);
const num = (v) => {
  const n = Number(String(v ?? '').replace(/^[#!]/, ''));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`expected an issue/MR number, got ${JSON.stringify(v)}`);
  return n;
};
const pick = (a, ...keys) => { for (const k of keys) if (a?.[k] !== undefined && a[k] !== null && a[k] !== '') return a[k]; return undefined; };

const DEFAULT_TEST_COMMAND = 'pnpm -r --if-present test';

/** Command from {command} or {program, args}. */
function commandOf(a, fallback) {
  const command = pick(a, 'command', 'cmd');
  if (command) return command;
  if (a?.program) {
    const extra = pick(a, 'args', 'arguments') ?? [];
    return [String(a.program), ...(Array.isArray(extra) ? extra.map(String) : String(extra).split(/\s+/).filter(Boolean))];
  }
  if (fallback) return fallback;
  throw new SandboxError('command is required');
}

/** Minimal glob -> RegExp (** any depth, * one segment, ? one char). */
export function globToRegExp(glob) {
  let re = '';
  const g = String(glob).replace(/\\/g, '/');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

async function walk(root, dirAbs, out, limit) {
  let entries;
  try { entries = await readdir(dirAbs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= limit) break;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(root, join(dirAbs, e.name), out, limit);
    } else if (e.isFile()) {
      out.push(join(dirAbs, e.name));
    }
  }
  return out;
}

/**
 * Build the tool registry.
 * @param {object} o
 * @param {ReturnType<import('./sandbox.js').createSandbox>} o.sandbox
 * @param {object} o.scm       ScmProvider
 * @param {object} o.state     shared mutable state ({branch, defaultBranch})
 * @param {boolean} [o.dryRun] side-effecting tools only report what they would do
 * @param {(msg:string)=>void} [o.log]
 */
export function createTools({ sandbox, scm, state = {}, dryRun = false, log = () => {}, commandTimeoutMs }) {
  const rel = (abs) => abs.slice(sandbox.root.length + 1).split('\\').join('/');

  const tools = {
    // ---------------------------------------------------------------- read-only, local
    read_file: {
      args: '{file_path}', desc: 'read a repository file',
      async run(a) {
        const { abs } = sandbox.resolvePath(pick(a, 'file_path', 'path'));
        const s = await readFile(abs, 'utf8');
        return s.length > MAX_READ ? `${s.slice(0, MAX_READ)}\n...[truncated ${s.length - MAX_READ} chars]` : s;
      },
    },
    list_dir: {
      args: '{directory}', desc: 'list a directory', aliases: ['list_repository_tree'],
      async run(a) {
        const { abs } = sandbox.resolvePath(pick(a, 'directory', 'path', 'dir') ?? '.');
        const entries = await readdir(abs, { withFileTypes: true });
        return entries.filter((e) => e.name !== '.git').map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n');
      },
    },
    find_files: {
      args: '{name_pattern}', desc: 'find files by glob, e.g. "apps/**/*.js"',
      async run(a) {
        const pattern = String(pick(a, 'name_pattern', 'pattern', 'glob') ?? '**/*');
        const re = globToRegExp(pattern.includes('/') ? pattern : `**/${pattern}`);
        const files = await walk(sandbox.root, sandbox.root, [], 20_000);
        return files.map(rel).filter((f) => re.test(f)).slice(0, 200).join('\n') || '(no matches)';
      },
    },
    grep: {
      args: '{pattern, search_directory?, case_insensitive?}', desc: 'regex search in repository files',
      async run(a) {
        const re = new RegExp(String(pick(a, 'pattern', 'query')), a?.case_insensitive ? 'i' : '');
        const { abs } = sandbox.resolvePath(pick(a, 'search_directory', 'directory', 'path') ?? '.');
        const files = (await stat(abs)).isFile() ? [abs] : await walk(sandbox.root, abs, [], 20_000);
        const hits = [];
        for (const f of files) {
          if (hits.length >= 100) break;
          let s;
          try {
            if ((await stat(f)).size > 512_000) continue;
            s = await readFile(f, 'utf8');
          } catch { continue; }
          if (s.includes('\u0000')) continue;
          s.split('\n').forEach((line, i) => { if (hits.length < 100 && re.test(line)) hits.push(`${rel(f)}:${i + 1}: ${line.slice(0, 240)}`); });
        }
        return hits.join('\n') || '(no matches)';
      },
    },

    // ---------------------------------------------------------------- local writes
    create_file_with_contents: {
      args: '{file_path, contents}', desc: 'create or overwrite a file', aliases: ['write_file'], sideEffect: true,
      async run(a) {
        const { abs, rel: r } = sandbox.resolvePath(pick(a, 'file_path', 'path'), { write: true });
        const contents = String(pick(a, 'contents', 'content') ?? '');
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, contents);
        sandbox.written.add(r);
        return `wrote ${r} (${contents.length} chars)`;
      },
    },
    edit_file: {
      args: '{file_path, old_str, new_str}', desc: 'replace exactly one occurrence of old_str', sideEffect: true,
      async run(a) {
        const { abs, rel: r } = sandbox.resolvePath(pick(a, 'file_path', 'path'), { write: true });
        const oldS = String(pick(a, 'old_str', 'old_string') ?? '');
        const newS = String(pick(a, 'new_str', 'new_string') ?? '');
        if (!oldS) throw new Error('old_str is required');
        const s = await readFile(abs, 'utf8');
        const n = s.split(oldS).length - 1;
        if (n !== 1) throw new Error(`old_str must match exactly once (matched ${n} times)`);
        await writeFile(abs, s.replace(oldS, () => newS));
        sandbox.written.add(r);
        return `edited ${r}`;
      },
    },
    run_command: {
      args: '{command}', desc: 'run an allowlisted command (node <repo script>, npx playwright test, pnpm test, local git)', sideEffect: true,
      async run(a) {
        return sandbox.runCommand(commandOf(a), { timeoutMs: commandTimeoutMs });
      },
    },
    run_tests: {
      args: '{command?}', desc: 'run tests (default: pnpm -r --if-present test)', sideEffect: true,
      async run(a) {
        return sandbox.runCommand(commandOf(a, DEFAULT_TEST_COMMAND), { timeoutMs: commandTimeoutMs });
      },
    },

    // ---------------------------------------------------------------- SCM reads
    get_issue: {
      args: '{issue_iid}', desc: 'get an issue',
      async run(a) {
        const i = await scm.getIssue(num(pick(a, 'issue_iid', 'issue_id', 'iid', 'number')));
        return { iid: i.iid, title: i.title, state: i.state, labels: i.labels, web_url: i.web_url, description: i.description };
      },
    },
    list_issue_notes: {
      args: '{issue_iid}', desc: 'list issue comments',
      async run(a) {
        return (await scm.listIssueNotes(num(pick(a, 'issue_iid', 'iid')))).map((n) => ({ id: n.id, author: n.author?.username, body: n.body }));
      },
    },
    get_merge_request: {
      args: '{merge_request_iid}', desc: 'get a merge request / pull request',
      async run(a) {
        const m = await scm.getMR(num(pick(a, 'merge_request_iid', 'mr_iid', 'iid', 'number')));
        return { iid: m.iid, title: m.title, state: m.state, labels: m.labels, source_branch: m.source_branch, target_branch: m.target_branch, web_url: m.web_url, description: m.description };
      },
    },
    list_all_merge_request_notes: {
      args: '{merge_request_iid}', desc: 'list MR/PR comments',
      async run(a) {
        return (await scm.listMRNotes(num(pick(a, 'merge_request_iid', 'mr_iid', 'iid')))).map((n) => ({ id: n.id, author: n.author?.username, body: n.body }));
      },
    },
    get_repository_file: {
      args: '{file_path, ref?}', desc: 'read a file from the working tree, or from a branch/ref via the SCM API',
      async run(a) {
        const p = pick(a, 'file_path', 'path');
        const ref = pick(a, 'ref', 'branch');
        if (!ref) return tools.read_file.run({ file_path: p });
        sandbox.resolvePath(p); // same path rules for remote reads
        const s = await scm.getFile(String(p), String(ref));
        return s.length > MAX_READ ? `${s.slice(0, MAX_READ)}\n...[truncated]` : s;
      },
    },
    gitlab_merge_request_search: {
      args: '{source_branch}', desc: 'find the open MR/PR for a source branch', aliases: ['find_merge_request'],
      async run(a) {
        const m = await scm.findMRBySourceBranch(String(pick(a, 'source_branch', 'branch', 'search')));
        return m ? { iid: m.iid, title: m.title, labels: m.labels, web_url: m.web_url } : null;
      },
    },

    // ---------------------------------------------------------------- SCM writes
    create_branch: {
      args: '{branch, ref?}', desc: 'name the branch the next create_commit goes to (created on commit)', sideEffect: true, local: true,
      async run(a) {
        const branch = String(pick(a, 'branch', 'branch_name', 'name') ?? '');
        if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.includes('..')) throw new Error(`invalid branch name ${JSON.stringify(branch)}`);
        state.branch = branch;
        state.startBranch = pick(a, 'ref', 'start_branch') ?? state.startBranch;
        return `branch ${branch} will be created from ${state.startBranch || 'the default branch'} on commit`;
      },
    },
    create_commit: {
      args: '{message, branch?, files?: [paths]}', desc: 'commit files from the working tree to the branch through the SCM API (default: every file you wrote, except .shakefix/tmp/)', sideEffect: true,
      async run(a) {
        const branch = String(pick(a, 'branch', 'branch_name') ?? state.branch ?? '');
        if (!branch) throw new Error('no branch: call create_branch first or pass branch');
        const message = String(pick(a, 'message', 'commit_message') ?? '');
        if (!message) throw new Error('message is required');
        const paths = list(pick(a, 'files', 'file_paths') ?? [...sandbox.written]).filter((p) => !p.startsWith('.shakefix/tmp/'));
        if (!paths.length) throw new Error('nothing to commit');
        const files = [];
        for (const p of paths) {
          const { abs, rel: r } = sandbox.resolvePath(p);
          files.push({ path: r, content: await readFile(abs, 'utf8'), action: 'upsert' });
        }
        const startBranch = state.startBranch || state.defaultBranch || (await scm.defaultBranch());
        const res = await scm.commitFiles({ branch, startBranch, message, files });
        state.branch = branch;
        return { branch, files: files.map((f) => f.path), commit: res?.id ?? res?.sha ?? null };
      },
    },
    create_merge_request: {
      args: '{source_branch, target_branch?, title, description, labels?}', desc: 'open a merge request (pull request on GitHub)', sideEffect: true, aliases: ['create_pull_request'],
      async run(a) {
        const m = await scm.createMR({
          sourceBranch: String(pick(a, 'source_branch', 'head') ?? state.branch),
          targetBranch: String(pick(a, 'target_branch', 'base') ?? (state.defaultBranch || (await scm.defaultBranch()))),
          title: String(pick(a, 'title') ?? ''),
          description: String(pick(a, 'description', 'body') ?? ''),
          labels: list(pick(a, 'labels') ?? []),
        });
        return { iid: m.iid, web_url: m.web_url, labels: m.labels };
      },
    },
    update_merge_request: {
      args: '{merge_request_iid, add_labels?, remove_labels?, title?, description?}', desc: 'update MR/PR labels or text', sideEffect: true,
      async run(a) {
        const iid = num(pick(a, 'merge_request_iid', 'mr_iid', 'iid'));
        const m = await scm.updateMR(iid, {
          addLabels: list(pick(a, 'add_labels', 'labels') ?? []),
          removeLabels: list(pick(a, 'remove_labels') ?? []),
          title: pick(a, 'title'),
          description: pick(a, 'description', 'body'),
        });
        return { iid, labels: m?.labels };
      },
    },
    create_merge_request_note: {
      args: '{merge_request_iid, body}', desc: 'comment on an MR/PR', sideEffect: true,
      async run(a) {
        const n = await scm.addMRNote(num(pick(a, 'merge_request_iid', 'mr_iid', 'iid')), String(pick(a, 'body', 'note') ?? ''));
        return { id: n?.id ?? null };
      },
    },
    create_issue_note: {
      args: '{issue_iid, body}', desc: 'comment on an issue', sideEffect: true,
      async run(a) {
        const n = await scm.addIssueNote(num(pick(a, 'issue_iid', 'iid')), String(pick(a, 'body', 'note') ?? ''));
        return { id: n?.id ?? null };
      },
    },
    update_issue: {
      args: '{issue_iid, add_labels?, remove_labels?, state_event?}', desc: 'update issue labels / state', sideEffect: true,
      async run(a) {
        const iid = num(pick(a, 'issue_iid', 'iid'));
        const i = await scm.updateIssue(iid, {
          addLabels: list(pick(a, 'add_labels', 'labels') ?? []),
          removeLabels: list(pick(a, 'remove_labels') ?? []),
          stateEvent: pick(a, 'state_event'),
        });
        return { iid, labels: i?.labels };
      },
    },
  };

  const byName = new Map();
  for (const [name, t] of Object.entries(tools)) {
    t.name = name;
    byName.set(name, t);
    for (const al of t.aliases || []) byName.set(al, t);
  }

  /** Execute a tool by name (or alias). Errors come back as {error} so the model can recover. */
  async function call(name, args, allowed) {
    const t = byName.get(name);
    if (!t) return { error: `unknown tool ${name}` };
    if (allowed && !allowed.has(t.name) && !(t.aliases || []).some((x) => allowed.has(x))) {
      return { error: `tool ${name} is not available to this role` };
    }
    if (dryRun && t.sideEffect && !t.local) {
      // Validate inputs (paths, commands) even in a dry run, but do not execute.
      try {
        if (t.name === 'run_command' || t.name === 'run_tests') sandbox.checkCommand(commandOf(args, t.name === 'run_tests' ? DEFAULT_TEST_COMMAND : undefined));
        const p = pick(args, 'file_path', 'path');
        if (p) sandbox.resolvePath(p, { write: true });
      } catch (err) {
        return { error: err.message, blocked: err instanceof SandboxError };
      }
      log(`[dry-run] would call ${t.name} ${JSON.stringify(args ?? {}).slice(0, 300)}`);
      return { dryRun: true, wouldCall: t.name, args };
    }
    try {
      return await t.run(args ?? {});
    } catch (err) {
      return { error: String(err?.message || err), blocked: err instanceof SandboxError };
    }
  }

  return { tools, byName, call };
}
