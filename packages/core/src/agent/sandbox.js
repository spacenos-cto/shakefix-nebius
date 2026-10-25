// Safety layer for the local agent runner: every path stays inside the repository and every
// command is checked against a small allowlist and run WITHOUT a shell (on Windows a shell is
// needed for .cmd shims; arguments are then quoted and shell metacharacters are already refused).
//
// This is defence in depth, not a jail: run the local runner on an ephemeral CI runner
// (GitHub Actions, GitLab CI), never on a machine holding other secrets.

import { spawn } from 'node:child_process';
import { realpathSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class SandboxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SandboxError';
  }
}

const SHELL_META = /[;&|`$<>^%\r\n]/;
const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|_KEY$|_PAT$|PRIVATE|CREDENTIAL)/i;

const GIT_ALLOWED = new Set(['status', 'diff', 'log', 'show', 'add', 'commit', 'checkout', 'switch', 'branch', 'rev-parse', 'ls-files', 'restore', 'merge-base']);
const GIT_FORBIDDEN_ARG = /^(--upload-pack|--receive-pack|--exec|--git-dir|--work-tree|-c$|-C$|--output|--ext-diff|--textconv)|^ext::/;
const NODE_SCRIPT_DIRS = ['packages/', 'scripts/', 'node_modules/'];

/** Split a command line into argv (supports "double" and 'single' quotes, no escapes). */
export function tokenize(command) {
  const s = String(command ?? '').trim();
  if (!s) throw new SandboxError('empty command');
  if (SHELL_META.test(s)) throw new SandboxError('shell operators (; & | ` $ < > ^ % newline) are not allowed');
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) throw new SandboxError('unbalanced quote');
  if (has || cur) out.push(cur);
  return out;
}

export function createSandbox(repoRoot) {
  const root = resolve(repoRoot);
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  const written = new Set();

  const inside = (abs, base) => {
    const rel = relative(base, abs);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };

  /** Resolve a repo-relative path; throws SandboxError if it escapes the repo or touches .git. */
  function resolvePath(p, { write = false } = {}) {
    if (p === undefined || p === null || String(p).trim() === '') throw new SandboxError('path is required');
    const raw = String(p).trim();
    if (/^[A-Za-z]:/.test(raw) && process.platform !== 'win32') throw new SandboxError(`path outside the repository: ${raw}`);
    const abs = resolve(root, raw);
    if (!inside(abs, root)) throw new SandboxError(`path outside the repository: ${raw}`);
    const rel = relative(root, abs).split(sep).join('/');
    if (rel === '.git' || rel.startsWith('.git/')) throw new SandboxError('.git is off limits');
    if (write && (rel === 'node_modules' || rel.startsWith('node_modules/') || rel.includes('/node_modules/'))) {
      throw new SandboxError('node_modules is read-only');
    }
    // Symlink escape: the nearest existing ancestor must really live inside the repo.
    let probe = abs;
    while (!existsSync(probe) && probe !== dirname(probe)) probe = dirname(probe);
    if (existsSync(probe) && !inside(realpathSync(probe), realRoot)) throw new SandboxError(`path resolves outside the repository: ${raw}`);
    return { abs, rel: rel || '.' };
  }

  function checkPathArgs(args) {
    for (const a of args) {
      if (a.startsWith('-')) {
        const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : '';
        if (v && (v.includes('/') || v.includes('\\'))) resolvePath(v);
        continue;
      }
      if (a.includes('/') || a.includes('\\') || a === '..' || isAbsolute(a)) resolvePath(a);
    }
  }

  /**
   * Validate a command against the allowlist. Returns {cmd, args} to spawn (may rewrite, e.g.
   * `npx playwright` -> `npx --no playwright` so npx never downloads).
   */
  function checkCommand(command) {
    const argv = Array.isArray(command) ? command.map(String) : tokenize(command);
    if (!argv.length) throw new SandboxError('empty command');
    if (process.platform === 'win32' && argv.some((a) => a.includes('"'))) throw new SandboxError('double quotes inside arguments are not allowed');
    const [cmd, ...args] = argv;
    if (!['node', 'npx', 'pnpm', 'git'].includes(cmd)) {
      throw new SandboxError(`command not allowed: ${cmd} (allowed: node <repo script>, npx playwright test, pnpm test, git <local subcommand>)`);
    }
    checkPathArgs(args);
    switch (cmd) {
      case 'node': {
        const script = args[0];
        if (!script || script.startsWith('-')) throw new SandboxError('node: only `node <repo script> [args]` is allowed (no -e/-p/--eval/flags)');
        const { rel } = resolvePath(script);
        if (!NODE_SCRIPT_DIRS.some((d) => rel.startsWith(d))) throw new SandboxError(`node: scripts must live under ${NODE_SCRIPT_DIRS.join(', ')}`);
        if (written.has(rel)) throw new SandboxError('node: refusing to run a file the agent wrote');
        return { cmd, args };
      }
      case 'npx': {
        const rest = args.filter((a) => a !== '--no' && a !== '--no-install');
        if (rest[0] !== 'playwright' || rest[1] !== 'test') throw new SandboxError('npx: only `npx playwright test ...` is allowed');
        return { cmd, args: ['--no', ...rest] };
      }
      case 'pnpm': {
        const rest = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === '--filter' || a === '-F') { i++; continue; }
          if (a.startsWith('--filter=') || ['-r', '--recursive', '--if-present', '-w', '--workspace-root', '--silent', '-s'].includes(a)) continue;
          rest.push(a);
        }
        const ok = rest[0] === 'test'
          || (rest[0] === 'run' && rest[1] === 'test')
          || (rest[0] === 'exec' && rest[1] === 'playwright' && rest[2] === 'test')
          || (rest[0] === 'exec' && rest[1] === 'vitest' && rest[2] === 'run');
        if (!ok) throw new SandboxError('pnpm: only test / run test / exec playwright test / exec vitest run are allowed');
        return { cmd, args };
      }
      case 'git': {
        const sub = args[0];
        if (!GIT_ALLOWED.has(sub)) throw new SandboxError(`git ${sub ?? ''}: not allowed (local, offline subcommands only: ${[...GIT_ALLOWED].join(', ')})`);
        const bad = args.find((a) => GIT_FORBIDDEN_ARG.test(a));
        if (bad) throw new SandboxError(`git: option ${bad} is not allowed`);
        return { cmd, args };
      }
      default:
        throw new SandboxError(`command not allowed: ${cmd} (allowed: node <repo script>, npx playwright test, pnpm test, git <local subcommand>)`);
    }
  }

  /** Environment for child processes: secrets removed. */
  function childEnv(env = process.env) {
    const out = {};
    for (const [k, v] of Object.entries(env)) if (!SECRET_ENV.test(k)) out[k] = v;
    out.CI = out.CI || '1';
    return out;
  }

  /** Run an allowlisted command. Never throws for a non-zero exit; returns {exitCode, stdout, stderr}. */
  function runCommand(command, { timeoutMs = 10 * 60_000, maxOutput = 12_000 } = {}) {
    const { cmd, args } = checkCommand(command);
    const win = process.platform === 'win32';
    return new Promise((resolveRun) => {
      const child = win
        ? spawn([cmd, ...args.map((a) => (/[\s()]/.test(a) ? `"${a}"` : a))].join(' '), { cwd: root, env: childEnv(), shell: true, windowsHide: true })
        : spawn(cmd, args, { cwd: root, env: childEnv(), shell: false });
      let stdout = '';
      let stderr = '';
      const cap = (s, d) => (s.length > maxOutput * 2 ? s : s + d);
      child.stdout.on('data', (d) => { stdout = cap(stdout, d.toString()); });
      child.stderr.on('data', (d) => { stderr = cap(stderr, d.toString()); });
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      const done = (exitCode, extra = '') => {
        clearTimeout(timer);
        const trim = (s) => (s.length > maxOutput ? `...[${s.length - maxOutput} chars cut]...\n${s.slice(-maxOutput)}` : s);
        resolveRun({ command: [cmd, ...args].join(' '), exitCode, stdout: trim(stdout), stderr: trim(stderr + extra) });
      };
      child.on('error', (err) => done(127, String(err.message)));
      child.on('close', (code, signal) => done(code ?? (signal ? 137 : 1), signal ? `\n(killed: ${signal})` : ''));
    });
  }

  return { root, written, resolvePath, checkCommand, runCommand, childEnv };
}
