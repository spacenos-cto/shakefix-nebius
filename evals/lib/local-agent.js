// Local mode with a model: run the ER team with the local agent runner from @shakefix/core on a scratch
// copy of the working tree. A small in-process SCM stands in for GitLab: the issue is the intake's rendered
// issue, commits are written into the scratch copy, MRs and notes are recorded in memory.
import { copyFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { issueBody, issueLabels, issueTitle } from '../../services/intake/src/render.js';
import { dedupeHash, severityOf } from '../../services/intake/src/replay.js';

/** Is a model configured for the local runner? (MODEL_PROVIDER not none, and a key or local base URL.) */
export function modelConfigured(env = process.env) {
  const p = String(env.MODEL_PROVIDER ?? 'anthropic').toLowerCase();
  if (['none', 'rules', 'off'].includes(p)) return false;
  if (p === 'anthropic') return Boolean(env.MODEL_API_KEY || env.ANTHROPIC_API_KEY);
  return Boolean(env.MODEL_BASE_URL && env.MODEL_NAME);
}

/** Copy tracked + untracked (not ignored) files of the working tree into `dest`. */
export function snapshotWorkingTree({ repoRoot, dest }) {
  rmSync(dest, { recursive: true, force: true });
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = r.stdout.split('\0').filter((f) => f && !f.startsWith('evals/.work/') && !f.startsWith('evals/results/'));
  for (const f of files) {
    const src = join(repoRoot, f);
    if (!existsSync(src)) continue; // deleted in the working tree
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    copyFileSync(src, join(dest, f));
  }
  return files.length;
}

/** In-process ScmProvider for one issue. */
export function createLocalScm({ dir, replay, iid, now = () => new Date().toISOString() }) {
  const issue = {
    iid,
    title: issueTitle(replay),
    description: issueBody({ replay, screenshotMarkdown: null }),
    labels: issueLabels({ sev: severityOf(replay), hash: dedupeHash(replay) }),
    state: 'opened',
    web_url: `local://issues/${iid}`,
    created_at: now(),
  };
  const issueNotes = [];
  const mrs = [];
  const mrNotes = new Map();
  const commits = [];
  const labelsPatch = (list, add = [], remove = []) => [...new Set([...list.filter((l) => !remove.includes(l)), ...add])];
  const scm = {
    name: 'local',
    repo: 'local',
    capabilities: Object.freeze({ scopedLabels: true, uploads: false, flows: false, mergeWhenPipelineSucceeds: false }),
    state: { issue, issueNotes, mrs, mrNotes, commits },
    async defaultBranch() { return 'main'; },
    async getIssue(n) { if (Number(n) !== iid) throw Object.assign(new Error('404'), { status: 404 }); return issue; },
    async listIssueNotes() { return issueNotes; },
    async addIssueNote(_n, body) { const note = { id: issueNotes.length + 1, body, created_at: now() }; issueNotes.push(note); return note; },
    async updateIssue(_n, { addLabels = [], removeLabels = [], stateEvent } = {}) {
      issue.labels = labelsPatch(issue.labels, addLabels, removeLabels);
      if (stateEvent === 'close') issue.state = 'closed';
      return issue;
    },
    async getFile(path) { const { readFileSync } = await import('node:fs'); return readFileSync(join(dir, path), 'utf8'); },
    async createBranch({ branch }) { return { name: branch }; },
    async commitFiles({ branch, message, files }) {
      for (const f of files) {
        const p = join(dir, f.path);
        if (f.action === 'delete') rmSync(p, { force: true });
        else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.content ?? ''); }
      }
      const c = { id: `local${commits.length + 1}`, branch, message, files: files.map((f) => ({ path: f.path, action: f.action ?? 'upsert' })), at: now() };
      commits.push(c);
      return c;
    },
    async findMRBySourceBranch(branch) { return mrs.find((m) => m.source_branch === branch) ?? null; },
    async createMR({ sourceBranch, targetBranch, title, description, labels = [] }) {
      const mr = { iid: mrs.length + 1, source_branch: sourceBranch, target_branch: targetBranch, title, description, labels, state: 'opened', web_url: `local://mrs/${mrs.length + 1}`, created_at: now() };
      mrs.push(mr);
      return mr;
    },
    async getMR(n) { return mrs.find((m) => m.iid === Number(n)) ?? null; },
    async updateMR(n, { addLabels = [], removeLabels = [], title, description } = {}) {
      const mr = mrs.find((m) => m.iid === Number(n));
      if (!mr) return null;
      mr.labels = labelsPatch(mr.labels, addLabels, removeLabels);
      if (title) mr.title = title;
      if (description) mr.description = description;
      return mr;
    },
    async listMRNotes(n) { return mrNotes.get(Number(n)) ?? []; },
    async addMRNote(n, body) { const list = mrNotes.get(Number(n)) ?? []; const note = { id: list.length + 1, body }; list.push(note); mrNotes.set(Number(n), list); return note; },
    async mergeMR() { throw new Error('the eval never merges'); },
  };
  return scm;
}

/**
 * Runs the four ER roles on the scratch copy. Returns what was delivered.
 * @returns {Promise<{mr: object|null, labels: string[], commits: object[], seconds: number, transcript: object}>}
 */
export async function runLocalAgent({ dir, replay, iid, env = process.env, log = () => {} }) {
  const core = await import('../../packages/core/src/index.js');
  const scm = createLocalScm({ dir, replay, iid });
  const model = core.modelFromEnv(env);
  const runner = core.createLocalRunner({ repoRoot: dir, scm, model, log });
  const t0 = Date.now();
  const transcript = await runner.run({ issue: iid });
  const mr = scm.state.mrs[0] ?? null;
  return {
    mr,
    labels: [...scm.state.issue.labels, ...(mr?.labels ?? [])],
    commits: scm.state.commits,
    seconds: mr ? (Date.parse(mr.created_at) - t0) / 1000 : null,
    transcript,
  };
}
