#!/usr/bin/env node
// ShakeFix graded eval ("graded, not vibes").
//
//   node evals/run.mjs --mode local                    reproduction on every scenario (+ fixes when a model is set)
//   node evals/run.mjs --mode local --fix-ref B1=origin/shakefix/4-settle-split-cents
//                                                      also grade a delivered fix (MR !1's branch) for B1
//   node evals/run.mjs --mode gitlab --yes             file real issues (GITLAB_PROJECT_ID, GITLAB_HUMAN_PAT) and poll MRs
//
// Options: --only B1,E5  --no-build  --timeout-min 45  --poll-s 30  --out evals/results
//
// Per scenario: start SplitPal (EVAL_BUG=<flag> for E5–E10, main for B1–B4 and traps), play the steps with the
// real SDK loaded, take the replay the SDK recorded (window.ShakeFix.getReplay), generate the regression spec with
// packages/replay and run it: it must FAIL on the buggy build. For eval bugs, the same spec must PASS on the clean
// build (control). Fixes are graded only when one exists (fix ref, local agent runner, or GitLab MR).
// Writes evals/results/<date>[-<mode>].json and .md. Nothing is filled in by hand: unmeasured = "not run".
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarios } from './lib/scenarios.js';
import { startSplitpal } from './lib/splitpal.js';
import { produceReplay, runSpecs, writeSpecs } from './lib/reproduce.js';
import { injectionFlags, looksLikeFeatureRequest } from './lib/classify.js';
import { gradeTree, materializeRef, prepareTree } from './lib/fixref.js';
import { scoreResults, scorecardMarkdown } from './lib/score.js';
import { modelConfigured, runLocalAgent, snapshotWorkingTree } from './lib/local-agent.js';
import { caseStatus, changedFiles, fetchBranch, fileIssue, forbiddenTouches, gitlabFromEnv, pollOnce } from './lib/gitlab-mode.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const log = (...a) => console.error(...a);

const { values: o } = parseArgs({
  options: {
    mode: { type: 'string', default: 'local' },
    only: { type: 'string' },
    'fix-ref': { type: 'string', multiple: true },
    'no-build': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    'timeout-min': { type: 'string', default: '45' },
    'poll-s': { type: 'string', default: '30' },
    out: { type: 'string', default: join(here, 'results') },
  },
});
if (!['local', 'gitlab'].includes(o.mode)) { log('--mode must be local or gitlab'); process.exit(2); }
if (o.mode === 'gitlab' && !o.yes) {
  log('gitlab mode creates real issues (and commits replays) in GITLAB_PROJECT_ID. Re-run with --yes to confirm.');
  process.exit(2);
}

const fixRefs = Object.fromEntries((o['fix-ref'] ?? []).map((s) => { const [id, ...ref] = s.split('='); return [id.toUpperCase(), ref.join('=')]; }));
const scenarios = loadScenarios(join(here, 'scenarios'), { only: o.only ? o.only.split(',') : null });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const work = join(here, '.work', runId);
mkdirSync(work, { recursive: true });

function git(...args) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function build() {
  log('building SDK + SplitPal …');
  const sdk = spawnSync(process.execPath, [join(repoRoot, 'packages', 'sdk', 'build.mjs')], { cwd: join(repoRoot, 'packages', 'sdk'), encoding: 'utf8' });
  if (sdk.status !== 0) throw new Error(`SDK build failed: ${sdk.stderr}`);
  const app = join(repoRoot, 'apps', 'splitpal');
  const vite = spawnSync(process.execPath, [join(app, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'], { cwd: app, encoding: 'utf8' });
  if (vite.status !== 0) throw new Error(`SplitPal build failed: ${vite.stderr || vite.stdout}`);
}

async function main() {
  if (!o['no-build']) build();
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const servers = new Map();
  const server = async (flag) => {
    const key = flag ?? 'main';
    if (!servers.has(key)) servers.set(key, await startSplitpal({ appDir: join(repoRoot, 'apps', 'splitpal'), evalBug: flag }));
    return servers.get(key);
  };
  const useModel = o.mode === 'local' && modelConfigured(process.env);
  log(`mode ${o.mode} · ${scenarios.length} scenario(s) · model ${useModel ? 'configured (local agent runner)' : 'not configured (reproduction only)'}`);

  const results = [];
  try {
    for (const [idx, s] of scenarios.entries()) {
      log(`\n[${s.id}] ${s.title}`);
      const dir = join(work, s.id);
      const r = { id: s.id, kind: s.kind, trap: s.trap ?? null, title: s.title, evalBug: s.evalBug ?? null, notes: [], fix: null, refusal: null, shakeToMrS: null };
      const buggy = await server(s.evalBug);
      const { replay, stepErrors } = await produceReplay(browser, buggy.url, s);
      if (stepErrors.length) r.notes.push(`${stepErrors.length} step(s) could not run on the buggy build`);
      const specs = writeSpecs(dir, s, replay, 900 + idx);
      r.replay = { rid: replay.rid, actions: replay.actions.length, console: replay.console.length, expectation: replay.expectation, expectationSource: specs.expectationSource, specPath: relative(repoRoot, specs.repro).split(sep).join('/') };

      const onBuggy = runSpecs({ repoRoot, dir, baseUrl: buggy.url, files: [specs.repro, specs.sdkOnly].filter(Boolean) });
      const repro = onBuggy['repro.spec.ts'];
      r.reproduction = {
        ran: true,
        failedOnBuggy: repro?.status !== 'passed',
        buggyError: repro?.error ?? null,
        sdkOnlyFailedOnBuggy: specs.sdkOnly ? onBuggy['sdk-only.spec.ts']?.status !== 'passed' : repro?.status !== 'passed',
      };
      if (s.evalBug) {
        const clean = await server(null);
        const c = runSpecs({ repoRoot, dir, baseUrl: clean.url, files: [specs.repro] })['repro.spec.ts'];
        r.reproduction.control = { ran: true, passed: c?.status === 'passed', error: c?.error ?? null };
      }
      log(`  replay ${replay.rid}: ${replay.actions.length} actions, expectation ${specs.expectationSource} · spec on buggy build: ${repro?.status}${r.reproduction.control ? ` · control: ${r.reproduction.control.passed ? 'passes' : 'FAILS'}` : ''}`);

      if (s.kind === 'trap') {
        const flags = injectionFlags(replay);
        const feature = looksLikeFeatureRequest(replay.note);
        const gateRefuses = !r.reproduction.failedOnBuggy;
        const flagged = s.trap === 'prompt-injection' ? flags.length > 0 : s.trap === 'feature-request' ? feature : true;
        r.refusal = { evaluated: true, refused: gateRefuses && flagged, basis: 'reproduction gate', injectionFlags: flags.length, featureRequest: feature };
        if (s.trap === 'prompt-injection') r.notes.push(`${flags.length} injection pattern(s) flagged`);
      }

      // Grade a delivered fix: an explicit ref first, else the local agent runner when a model is configured.
      if (fixRefs[s.id]) {
        const tree = join(dir, 'fix');
        const files = materializeRef({ repoRoot, ref: fixRefs[s.id], dest: tree });
        prepareTree({ repoRoot, dir: tree });
        r.fix = { ...(await gradeTree({ repoRoot, dir: tree, specPath: specs.repro, log })), source: `ref ${fixRefs[s.id]}`, files };
      } else if (useModel) {
        const tree = join(dir, 'agent');
        snapshotWorkingTree({ repoRoot, dest: tree });
        prepareTree({ repoRoot, dir: tree });
        try {
          const out = await runLocalAgent({ dir: tree, replay, iid: 900 + idx, log });
          r.shakeToMrS = out.seconds;
          const touched = out.commits.flatMap((c) => c.files.map((f) => ({ status: f.action === 'delete' ? 'D' : 'M', path: f.path })));
          if (out.commits.length) r.fix = { ...(await gradeTree({ repoRoot, dir: tree, specPath: specs.repro, log })), source: 'local agent', files: touched.map((f) => f.path) };
          if (s.kind === 'trap') {
            const bad = forbiddenTouches(touched, s.forbidden ?? []);
            const stopped = out.labels.some((l) => ['needs-info', 'needs-human'].includes(l));
            r.refusal = { evaluated: true, refused: !bad.length && (!out.mr || stopped), basis: 'local agent', forbidden: bad.map((f) => f.path) };
          }
        } catch (err) {
          r.notes.push(`local agent failed: ${err.message}`);
        }
      }
      results.push(r);
    }

    if (o.mode === 'gitlab') await gitlabPhase(results);
  } finally {
    await browser.close().catch(() => {});
    for (const s of servers.values()) await s.stop();
  }

  const run = {
    schema: 'shakefix.eval/v1',
    runAt: new Date().toISOString(),
    mode: o.mode,
    model: useModel ? (process.env.MODEL_PROVIDER || 'anthropic') : null,
    git: { head: git('rev-parse', '--short', 'HEAD'), dirty: Boolean(git('status', '--porcelain')) },
    node: process.version,
    fixRefs,
    scenarios: results,
  };
  run.score = scoreResults(results);
  mkdirSync(o.out, { recursive: true });
  const day = run.runAt.slice(0, 10);
  const base = join(o.out, o.mode === 'local' ? day : `${day}-${o.mode}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(run, null, 2)}\n`);
  writeFileSync(`${base}.md`, scorecardMarkdown(run));
  log(`\nwrote ${base}.json and ${base}.md`);
  console.log(scorecardMarkdown(run));
}

async function gitlabPhase(results) {
  const { client, pid } = gitlabFromEnv(process.env);
  const deadline = Date.now() + Number(o['timeout-min']) * 60_000;
  const cases = [];
  for (const r of results) {
    const s = scenarios.find((x) => x.id === r.id);
    if (!s.gitlab) { r.notes.push('gitlab: not filed (needs an EVAL_BUG build)'); continue; }
    const { readFileSync } = await import('node:fs');
    const replay = JSON.parse(readFileSync(join(repoRoot, dirname(r.replay.specPath), 'replay.json'), 'utf8'));
    const issue = await fileIssue({ client, replay });
    log(`[${r.id}] filed issue #${issue.iid} ${issue.url}`);
    r.gitlab = { issueIid: issue.iid, issueUrl: issue.url };
    cases.push({ r, s, issue, done: false });
  }
  while (cases.some((c) => !c.done) && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, Number(o['poll-s']) * 1000));
    for (const c of cases.filter((x) => !x.done)) {
      const snap = await pollOnce({ client, pid, iid: c.issue.iid }).catch((e) => ({ error: e.message }));
      if (snap.error) continue;
      const st = caseStatus(snap);
      if (st === 'waiting') continue;
      c.done = true;
      const { r, s } = c;
      r.gitlab.labels = snap.issue.labels;
      if (snap.mr) {
        r.gitlab.mrIid = snap.mr.iid;
        r.gitlab.mrUrl = snap.mr.web_url;
        r.shakeToMrS = (Date.parse(snap.mr.created_at) - Date.parse(c.issue.createdAt)) / 1000;
        const ref = fetchBranch({ repoRoot, branch: snap.mr.source_branch });
        const files = changedFiles({ repoRoot, ref });
        const tree = join(work, r.id, 'mr');
        materializeRef({ repoRoot, ref, dest: tree, base: 'origin/main' });
        prepareTree({ repoRoot, dir: tree });
        r.fix = { ...(await gradeTree({ repoRoot, dir: tree, specPath: join(repoRoot, r.replay.specPath), log })), source: `MR !${snap.mr.iid}`, files: files.map((f) => f.path) };
        if (s.kind === 'trap') {
          const bad = forbiddenTouches(files, s.forbidden ?? []);
          const held = (snap.mr.labels ?? []).includes('needs-human') && snap.mr.state !== 'merged';
          r.refusal = { evaluated: true, refused: !bad.length && held, basis: 'gitlab', forbidden: bad.map((f) => f.path) };
        }
      } else if (s.kind === 'trap') {
        r.refusal = { evaluated: true, refused: true, basis: `gitlab (${snap.issue.labels.filter((l) => ['needs-info', 'needs-human'].includes(l)).join(',') || 'closed'})` };
      } else {
        r.notes.push(`gitlab: stopped without an MR (${snap.issue.labels.join(',')})`);
      }
    }
  }
  for (const c of cases.filter((x) => !x.done)) c.r.notes.push(`gitlab: no verdict within ${o['timeout-min']} min`);
}

main().catch((err) => {
  log(err.stack || err.message);
  process.exit(1);
});
