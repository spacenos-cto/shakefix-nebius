#!/usr/bin/env node
// Re-verify every evidence link in README.md / JUDGES.md through GitLab's public REST API.
//
//   node scripts/verify-evidence.mjs            check all (no token: works once the project is public)
//   GITLAB_TOKEN=glpat-... node scripts/verify-evidence.mjs    check while the project is still private
//   node scripts/verify-evidence.mjs --list     print the evidence list without network calls
//   node scripts/verify-evidence.mjs --json     machine-readable result
//
// Exit 0 when every check passes, 1 otherwise. A 404 without a token usually means "still private".
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GITLAB = process.env.GITLAB_URL || 'https://gitlab.com';
export const PROJECT = process.env.EVIDENCE_PROJECT || 'nxt-spacenos-global/shakefix';
export const WEB = `${GITLAB}/${PROJECT}`;
const enc = encodeURIComponent;

/** Each check: what a judge clicks (web) and what proves it (api + expect). */
export const EVIDENCE = [
  {
    id: 'issue-4', label: 'Issue #4 filed by the intake from a shake (report r_20261011_b1d3e0)',
    web: `${WEB}/-/work_items/4`, api: `/projects/${enc(PROJECT)}/issues/4`,
    expect: (j) => /settle button does nothing/.test(j.title ?? '') && /shakefix:rid=r_20261011_b1d3e0/.test(j.description ?? ''),
  },
  {
    id: 'replay-commit', label: 'Replay committed by the intake ([skip ci])',
    web: `${WEB}/-/commit/2169ba8`, api: `/projects/${enc(PROJECT)}/repository/commits/2169ba8`,
    expect: (j) => /r_20261011_b1d3e0/.test(j.title ?? ''),
  },
  {
    id: 'replay-file', label: 'reports/r_20261011_b1d3e0/replay.json on main',
    web: `${WEB}/-/blob/main/reports/r_20261011_b1d3e0/replay.json`,
    api: `/projects/${enc(PROJECT)}/repository/files/${enc('reports/r_20261011_b1d3e0/replay.json')}?ref=main`,
    expect: (j) => j.file_path === 'reports/r_20261011_b1d3e0/replay.json',
  },
  {
    id: 'mr-1', label: 'MR !1 opened by the ER team for issue #4',
    web: `${WEB}/-/merge_requests/1`, api: `/projects/${enc(PROJECT)}/merge_requests/1`,
    expect: (j) => j.source_branch === 'shakefix/4-settle-split-cents',
  },
  {
    id: 'mr-1-commit', label: 'Fix commit 5e4ccbd (split in integer cents, closes #4)',
    web: `${WEB}/-/commit/5e4ccbd4682cad575325f7ac69cd311b7b850c86`, api: `/projects/${enc(PROJECT)}/merge_requests/1/commits`,
    expect: (j) => Array.isArray(j) && j.some((c) => String(c.id).startsWith('5e4ccbd')),
  },
  {
    id: 'regression-spec', label: 'Regression spec tests/regressions/issue-4.spec.ts (written from the replay)',
    web: `${WEB}/-/blob/shakefix/4-settle-split-cents/tests/regressions/issue-4.spec.ts`,
    api: `/projects/${enc(PROJECT)}/repository/files/${enc('tests/regressions/issue-4.spec.ts')}?ref=${enc('shakefix/4-settle-split-cents')}`,
    expect: (j) => j.file_path === 'tests/regressions/issue-4.spec.ts',
  },
  {
    id: 'mr-1-pipelines', label: 'Pipelines of MR !1',
    web: `${WEB}/-/merge_requests/1/pipelines`, api: `/projects/${enc(PROJECT)}/merge_requests/1/pipelines`,
    expect: (j) => Array.isArray(j),
  },
  // CareRx (README "It already ran").
  {
    id: 'issue-14', label: 'Issue #14 (CareRx C3 double charge) filed by the intake from a shake, closed',
    web: `${WEB}/-/work_items/14`, api: `/projects/${enc(PROJECT)}/issues/14`,
    expect: (j) => j.iid === 14 && j.state === 'closed' && /shakefix:rid=r_20261012_3d080f|r_20261012_3d080f/.test(j.description ?? ''),
  },
  {
    id: 'mr-12', label: 'MR !12 (C3 fix) merged by the project bot, no human merge',
    web: `${WEB}/-/merge_requests/12`, api: `/projects/${enc(PROJECT)}/merge_requests/12`,
    expect: (j) => j.state === 'merged' && /bot/.test(j.merged_by?.username ?? ''),
  },
  {
    id: 'mr-14', label: 'MR !14 (C1 accessibility fix) merged by the project bot after the agents re-operated',
    web: `${WEB}/-/merge_requests/14`, api: `/projects/${enc(PROJECT)}/merge_requests/14`,
    expect: (j) => j.state === 'merged' && /bot/.test(j.merged_by?.username ?? ''),
  },
  {
    id: 'control-10', label: 'Control MR !10 (planted bad fix) blocked by Second Opinion',
    web: `${WEB}/-/merge_requests/10`, api: `/projects/${enc(PROJECT)}/merge_requests/10`,
    expect: (j) => j.state !== 'merged' && j.labels?.includes('control') && j.labels?.includes('shakefix::unintended'),
  },
  {
    id: 'control-11', label: 'Control MR !11 (harmless) passed Second Opinion',
    web: `${WEB}/-/merge_requests/11`, api: `/projects/${enc(PROJECT)}/merge_requests/11`,
    expect: (j) => j.state !== 'merged' && j.labels?.includes('control') && j.labels?.includes('shakefix::ready'),
  },
  {
    id: 'license', label: 'MIT licence on main',
    web: `${WEB}/-/blob/main/LICENSE`, api: `/projects/${enc(PROJECT)}/repository/files/LICENSE?ref=main`,
    expect: (j) => j.file_path === 'LICENSE',
  },
];

export async function check(item, { token = process.env.GITLAB_TOKEN, fetchImpl = fetch } = {}) {
  const headers = token ? { 'PRIVATE-TOKEN': token } : {};
  try {
    const res = await fetchImpl(`${GITLAB}/api/v4${item.api}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const hint = res.status === 404 && !token ? ' (not found or still private: set GITLAB_TOKEN to check before submission)' : '';
      return { id: item.id, ok: false, status: res.status, detail: `HTTP ${res.status}${hint}` };
    }
    const json = await res.json();
    const ok = Boolean(item.expect(json));
    return { id: item.id, ok, status: res.status, detail: ok ? 'ok' : 'unexpected content' };
  } catch (err) {
    return { id: item.id, ok: false, status: null, detail: err.message };
  }
}

async function main(argv) {
  if (argv.includes('--list')) {
    for (const e of EVIDENCE) console.log(`${e.id}\t${e.label}\n\t${e.web}`);
    return 0;
  }
  const results = [];
  for (const e of EVIDENCE) results.push({ ...(await check(e)), label: e.label, web: e.web });
  if (argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.label}\n   ${r.web}\n   ${r.detail}`);
  const bad = results.filter((r) => !r.ok).length;
  console.error(`\n${results.length - bad}/${results.length} evidence links verified`);
  return bad ? 1 : 0;
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
