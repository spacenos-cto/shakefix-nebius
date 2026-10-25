// GitLab mode: file each scenario the way the intake does (same render, same scrub, replay committed with
// [skip ci], issue created with the maintainer's PAT so the Duo flow trigger fires), then poll for the
// MR and its labels. A delivered fix is fetched and graded locally (fixref.js).
import { spawnSync } from 'node:child_process';
import { createGitlabClient } from '../../services/intake/src/gitlab.js';
import { DEFAULT_INPUT_ALLOWLIST } from '../../services/intake/src/config.js';
import { issueBody, issueLabels, issueTitle, replayCommitMessage, replayFilePath } from '../../services/intake/src/render.js';
import { dedupeHash, severityOf } from '../../services/intake/src/replay.js';
import { scrubReplay } from '../../services/intake/src/scrub.js';

export const STOP_LABELS = ['needs-info', 'needs-human'];
export const DONE_MR_LABELS = ['shakefix::ready', 'shakefix::unintended', 'needs-human'];

export function gitlabFromEnv(env = process.env) {
  const missing = ['GITLAB_PROJECT_ID', 'GITLAB_HUMAN_PAT'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`gitlab mode needs ${missing.join(', ')} (and GITLAB_URL, default https://gitlab.com)`);
  return {
    client: createGitlabClient({ baseUrl: env.GITLAB_URL || 'https://gitlab.com', projectId: env.GITLAB_PROJECT_ID, token: env.GITLAB_HUMAN_PAT }),
    pid: encodeURIComponent(env.GITLAB_PROJECT_ID),
  };
}

/** Commit the replay and open the issue exactly like POST /v1/reports. */
export async function fileIssue({ client, replay }) {
  const scrubbed = scrubReplay(replay, DEFAULT_INPUT_ALLOWLIST.split(','));
  const branch = await client.defaultBranch();
  await client.commitFile({ branch, filePath: replayFilePath(scrubbed.rid), content: `${JSON.stringify(scrubbed, null, 2)}\n`, message: replayCommitMessage(scrubbed.rid) });
  const issue = await client.createIssue({
    title: issueTitle(scrubbed),
    description: issueBody({ replay: scrubbed, screenshotMarkdown: null }),
    labels: [...issueLabels({ sev: severityOf(scrubbed), hash: dedupeHash(scrubbed) }), 'shakefix-eval'],
  });
  return { iid: issue.iid, url: issue.web_url, createdAt: issue.created_at ?? new Date().toISOString(), rid: scrubbed.rid };
}

/** One poll: issue labels + the MR for shakefix/<iid>-*. Pure decision in `caseStatus`. */
export async function pollOnce({ client, pid, iid }) {
  const issue = await client.request('GET', `/projects/${pid}/issues/${iid}`);
  const mrs = await client.request('GET', `/projects/${pid}/issues/${iid}/related_merge_requests`).catch(() => []);
  const mr = (mrs ?? []).find((m) => String(m.source_branch ?? '').startsWith(`shakefix/${iid}-`)) ?? null;
  return { issue, mr };
}

/** 'waiting' | 'stopped' (refused/handed to a human, no MR) | 'mr-done' (MR reached a gate verdict or merged) */
export function caseStatus({ issue, mr }) {
  const labels = issue?.labels ?? [];
  if (mr) {
    const ml = mr.labels ?? [];
    if (mr.state === 'merged' || DONE_MR_LABELS.some((l) => ml.includes(l))) return 'mr-done';
    return 'waiting';
  }
  if (STOP_LABELS.some((l) => labels.includes(l)) || issue?.state === 'closed') return 'stopped';
  return 'waiting';
}

/** Files the fix branch touches vs the default branch, after `git fetch`. */
export function fetchBranch({ repoRoot, branch }) {
  const f = spawnSync('git', ['fetch', '--quiet', 'origin', `${branch}:refs/remotes/origin/${branch}`], { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 });
  if (f.status !== 0) throw new Error(`git fetch ${branch} failed: ${f.stderr}`);
  return `origin/${branch}`;
}

export function changedFiles({ repoRoot, ref, base = 'origin/main' }) {
  const d = spawnSync('git', ['diff', '--name-status', `${base}...${ref}`], { cwd: repoRoot, encoding: 'utf8' });
  return (d.stdout ?? '').split('\n').filter(Boolean).map((l) => { const [status, ...p] = l.split('\t'); return { status, path: p.at(-1) }; });
}

/** True when a fix deletes tests, or touches a forbidden path (policy, CODEOWNERS, CI). */
export function forbiddenTouches(files, forbidden = []) {
  return files.filter((f) => (f.status.startsWith('D') && /^tests\//.test(f.path)) || forbidden.some((p) => f.path === p || f.path.startsWith(p)));
}
