#!/usr/bin/env node
// Second Opinion CLI — behavior-diff gate for ShakeFix.
//   proof run    --base <url> --head <url> --flows "<glob>" [--replay <path>]... [--replay-from-mr <iid>] --out <dir>
//   proof label  --in proof.json (--issue-from-mr <iid> | --issue-text <file>) [--replay <path>]... [--out <file>]
//   proof report --in proof.json [--post-mr <iid>] [--out report.md]
//   proof gate   --in proof.json --policy .shakefix/policy.yml --diff-files <file> [--labels a,b] [--mr <iid>] [--attempt n]
// Exit codes: 0 ok/ready · 1 error · 10 unintended (first time) · 11 needs-human

import { parseArgs } from 'node:util';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename, relative, resolve, sep } from 'node:path';

const log = (...a) => console.error(...a);
// Hidden tag on the Behavior Diff note so later pipelines edit it instead of posting another.
const REPORT_MARKER = '<!-- shakefix:second-opinion-report -->';

const HELP = `proof (alias: second-opinion) — Second Opinion, the ShakeFix behavior-diff gate

  proof run    --base <url> --head <url> --flows "<glob>" [--replay <path>]... [--replay-from-mr <iid>] --out <dir>
               [--mr <iid>] [--base-sha <sha>] [--head-sha <sha>] [--reports-dir reports]
  proof label  --in proof.json (--issue-from-mr <iid> | --issue-text <file>) [--replay <path>]... [--out <file>]
  proof report --in proof.json [--post-mr <iid>] [--out report.md] [--base-ref main]
  proof gate   --in proof.json [--policy .shakefix/policy.yml] [--diff-files <file>] [--labels a,b] [--mr <iid>] [--attempt n]

Fix Confidence (0–100, GO / HOLD / BLOCK) is computed by report and gate and written to proof.json
summary.fix_confidence. Only GO auto-merges. Env: FIX_CONFIDENCE_MIN (default 80), PROOF_UNIT_STATUS
(pass|fail, else the pipeline's \`unit\` job), PROOF_PREMORTEM_RISK (low|medium|high|0..1).

Exit codes: 0 ok/ready · 1 error · 10 unintended (first time) · 11 needs-human`;

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function writeJson(p, v) {
  await mkdir(dirname(resolve(p)), { recursive: true });
  await writeFile(p, JSON.stringify(v, null, 2) + '\n');
}

function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'flow';
}

// ---------------------------------------------------------------------------- glob
const MAGIC = /[*?[\]{}!]/;

async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

export async function expandGlob(pattern, cwd = process.cwd()) {
  const { minimatch } = await import('minimatch');
  const pat = pattern.replace(/\\/g, '/');
  const segs = pat.split('/');
  const fixed = [];
  for (const s of segs) { if (MAGIC.test(s)) break; fixed.push(s); }
  if (fixed.length === segs.length) return existsSync(resolve(cwd, pat)) ? [resolve(cwd, pat)] : [];
  const root = resolve(cwd, fixed.join('/') || '.');
  const files = await walk(root);
  const absPat = resolve(cwd, pat).split(sep).join('/');
  return files.filter((f) => minimatch(f.split(sep).join('/'), absPat, { dot: true })).sort();
}

// ---------------------------------------------------------------------------- helpers
function short(sha) {
  return sha ? String(sha).slice(0, 7) : '';
}

function flowName(flow, path) {
  return slug(flow?.name || basename(path).replace(/\.flow\.json$|\.json$/, ''));
}

function flowTestids(flow) {
  const s = new Set();
  for (const a of flow.actions || []) if (a.testid) s.add(a.testid);
  if (flow.expectation?.testid) s.add(flow.expectation.testid);
  return [...s].sort();
}

async function replayForRid(rid, reportsDir, issueText) {
  const p = join(reportsDir, rid, 'replay.json');
  if (existsSync(p)) return { replay: await readJson(p), path: p };
  const { replayFromText } = await import('../src/label.js');
  const r = replayFromText(issueText);
  if (r) return { replay: r, path: '(issue description)' };
  throw new Error(`replay for ${rid} not found at ${p} or in the issue description`);
}

// ---------------------------------------------------------------------------- run
async function cmdRun(argv) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      base: { type: 'string' }, head: { type: 'string' }, flows: { type: 'string' }, 'no-recheck': { type: 'boolean' },
      replay: { type: 'string', multiple: true }, 'replay-from-mr': { type: 'string' },
      out: { type: 'string', default: 'proof' }, mr: { type: 'string' },
      'base-sha': { type: 'string' }, 'head-sha': { type: 'string' },
      'reports-dir': { type: 'string', default: 'reports' },
    },
  });
  if (!o.base || !o.head) throw usage('run needs --base and --head');
  const env = process.env;
  const { loadRunner, launchBrowser, captureFlow } = await import('../src/capture.js');
  const { diffFlow, buildProof, splitStable } = await import('../src/diff.js');
  const { pixelDiffCount } = await import('../src/pixel.js');
  const runner = await loadRunner(log);

  const loadFlowFile = async (p) => (runner.loadFlow ? runner.loadFlow(p) : readJson(p));
  const jobs = [];
  if (o.flows) {
    const paths = await expandGlob(o.flows);
    if (!paths.length) log(`warn: no flows matched ${o.flows}`);
    for (const p of paths) {
      const flow = await loadFlowFile(p);
      jobs.push({ name: flowName(flow, p), flow, source: 'e2e' });
    }
  }
  let rid;
  for (const p of o.replay || []) {
    const flow = await loadFlowFile(p);
    rid = rid || flow.rid;
    jobs.push({ name: slug(flow.rid ? `replay-${flow.rid}` : `replay-${basename(p, '.json')}`), flow, source: 'replay' });
  }
  if (o['replay-from-mr']) {
    const { scmFromEnv } = await import('../src/gitlab.js');
    const { ridFromText } = await import('../src/label.js');
    const gl = scmFromEnv();
    // A human's MR (or a control MR) has no linked report: check it with the flows alone.
    const issue = await gl.linkedIssue(o['replay-from-mr']).catch((err) => {
      log(`no replay: ${err.message}; running the flow suite only`);
      return null;
    });
    if (issue) {
      const r = ridFromText(issue.description);
      if (!r) throw new Error(`issue #${issue.iid} has no <!-- shakefix:rid=... --> marker`);
      const { replay, path } = await replayForRid(r, o['reports-dir'], issue.description);
      log(`replay ${r} (issue #${issue.iid}) from ${path}`);
      rid = rid || r;
      jobs.push({ name: slug(`replay-${r}`), flow: replay, source: 'replay' });
    }
  }
  if (!jobs.length) throw usage('run needs --flows and/or --replay / --replay-from-mr');

  // Dedupe names deterministically.
  const used = new Map();
  for (const j of jobs) {
    const n = used.get(j.name) || 0;
    used.set(j.name, n + 1);
    if (n) j.name = `${j.name}-${n + 1}`;
  }

  await mkdir(o.out, { recursive: true });
  const browser = await launchBrowser();
  const flows = [];
  let baseVersion = null;
  let headVersion = null;
  let fatal = null;
  try {
    for (const j of jobs) {
      log(`flow ${j.name} (${j.source})`);
      const common = { browser, flow: j.flow, flowName: j.name, outDir: o.out, runFlow: runner.runFlow, log };
      const b = await captureFlow({ ...common, url: o.base, side: 'base' });
      const h = await captureFlow({ ...common, url: o.head, side: 'head' });
      if (b.fatal || h.fatal) { fatal = `${j.name}: ${b.fatal ? `base: ${b.error}` : `head: ${h.error}`}`; break; }
      baseVersion = baseVersion || b.appVersion;
      headVersion = headVersion || h.appVersion;
      const pixel = {};
      const n = Math.min(b.steps.length, h.steps.length);
      for (let i = 0; i < n; i++) {
        try {
          const [ba, hb] = await Promise.all([
            readFile(join(o.out, b.steps[i].screenshot)), readFile(join(o.out, h.steps[i].screenshot)),
          ]);
          pixel[i] = pixelDiffCount(ba, hb, 0.1);
        } catch { pixel[i] = 0; }
      }
      let changes = diffFlow(b, h, { pixel });
      let flaky = [];
      // Stability check: a baseline flow that changed is captured once more on both sides. Only
      // changes seen in both runs count; the rest come from timing in the app, not from the fix.
      if (changes.length && j.source !== 'replay' && !o['no-recheck']) {
        const b2 = await captureFlow({ ...common, url: o.base, side: 'base-recheck' });
        const h2 = await captureFlow({ ...common, url: o.head, side: 'head-recheck' });
        if (!b2.fatal && !h2.fatal) {
          ({ stable: changes, flaky } = splitStable(changes, diffFlow(b2, h2, { pixel: {} })));
          if (flaky.length) log(`  ${flaky.length} change(s) did not repeat on a second run: flaky, not counted`);
        }
      }
      const routes = [...new Set([...b.steps, ...h.steps].map((s) => s.route))].sort();
      const entry = { flow: j.name, source: j.source, changes, routes };
      if (flaky.length) entry.flaky = flaky;
      if (j.source === 'replay') {
        entry.testids = flowTestids(j.flow);
        // Fix Confidence input: the reporter's flow should FAIL on base and PASS on head.
        if (b.outcome && h.outcome) entry.reproduction = { base: b.outcome, head: h.outcome };
      }
      flows.push(entry);
      log(`  ${changes.length} change(s)`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (fatal) throw new Error(`capture failed (${fatal})`);

  const ver = (v) => (v ? String(v).replace(/^v/, '') : '');
  const proof = buildProof({
    mr: numOrNull(o.mr ?? o['replay-from-mr'] ?? env.CI_MERGE_REQUEST_IID),
    base: o['base-sha'] || env.PROOF_BASE_SHA || short(env.CI_MERGE_REQUEST_DIFF_BASE_SHA) || ver(baseVersion) || o.base,
    head: o['head-sha'] || env.PROOF_HEAD_SHA || env.CI_COMMIT_SHORT_SHA || ver(headVersion) || o.head,
    rid,
    flows,
  });
  const out = join(o.out, 'proof.json');
  await writeJson(out, proof);
  log(`wrote ${out}: ${proof.summary.changes} change(s) across ${flows.length} flow(s)`);
  return 0;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------- label
async function cmdLabel(argv) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      in: { type: 'string' }, out: { type: 'string' },
      'issue-from-mr': { type: 'string' }, 'issue-text': { type: 'string' },
      replay: { type: 'string', multiple: true }, 'reports-dir': { type: 'string', default: 'reports' },
    },
  });
  if (!o.in) throw usage('label needs --in');
  const { labelProof, labelerModelFromEnv, ridFromText, replayFromText } = await import('../src/label.js');
  const proof = await readJson(o.in);
  let issueText = '';
  if (o['issue-text']) issueText = await readFile(o['issue-text'], 'utf8');
  else if (o['issue-from-mr']) {
    const { scmFromEnv } = await import('../src/gitlab.js');
    try {
      const issue = await scmFromEnv().linkedIssue(o['issue-from-mr']);
      issueText = `# ${issue.title || ''}\n\n${issue.description || ''}`;
    } catch (err) {
      log(`warn: could not load issue for MR !${o['issue-from-mr']} (${err.message}); labeling without issue text`);
    }
  }
  const replays = [];
  for (const p of o.replay || []) replays.push(await readJson(p));
  const rid = proof.rid || ridFromText(issueText);
  if (rid) {
    const p = join(o['reports-dir'], rid, 'replay.json');
    if (existsSync(p)) replays.push(await readJson(p));
  }
  const embedded = replayFromText(issueText);
  if (embedded) replays.push(embedded);

  // Model from MODEL_PROVIDER (default anthropic: ANTHROPIC_API_KEY, PROOF_MODEL, ANTHROPIC_BASE_URL as before).
  const llm = labelerModelFromEnv(process.env) || undefined;
  const res = await labelProof(proof, { issueText, replays, llm });
  if (res.error) log(`labeler: ${res.labeler} (${res.error})`);
  const out = o.out || o.in;
  await writeJson(out, res.proof);
  const s = res.proof.summary;
  console.log(`labeled ${s.changes} change(s): ${s.intended} intended · ${s.unintended} unintended (labeler: ${res.labeler})`);
  return 0;
}

// ---------------------------------------------------------------------------- report
async function cmdReport(argv) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      in: { type: 'string' }, out: { type: 'string' }, 'post-mr': { type: 'string' },
      'base-ref': { type: 'string' }, policy: { type: 'string', default: '.shakefix/policy.yml' },
      'diff-files': { type: 'string' }, labels: { type: 'string' },
    },
  });
  if (!o.in) throw usage('report needs --in');
  const { renderReport } = await import('../src/report.js');
  const env = process.env;
  const proof = await readJson(o.in);
  // Fix Confidence on the card (same computation as `proof gate`, best effort).
  let confidence = null;
  try {
    confidence = (await evaluateForConfidence({ proof, o, env, mr: o['post-mr'] })).fixConfidence;
    const { summaryOf } = await import('../src/confidence.js');
    proof.summary = { ...(proof.summary || {}), fix_confidence: summaryOf(confidence) };
    await writeJson(o.in, proof);
  } catch (err) {
    log(`warn: Fix Confidence not computed (${err.message})`);
  }
  let artifacts;
  if (env.CI_JOB_URL) {
    const rel = relative(process.cwd(), dirname(resolve(o.in))).split(sep).join('/') || '.';
    const prefix = rel === '.' ? '' : `${rel}/`;
    artifacts = {
      screenshots: `${env.CI_JOB_URL}/artifacts/browse/${prefix}raw`,
      proof: `${env.CI_JOB_URL}/artifacts/file/${prefix}proof.json`,
    };
  }
  const md = renderReport(proof, { baseRef: o['base-ref'] || env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME || 'main', artifacts, confidence });
  if (o.out) await writeFile(o.out, md);
  else process.stdout.write(md);
  if (o['post-mr']) {
    const { scmFromEnv } = await import('../src/gitlab.js');
    const res = await scmFromEnv().upsertMRNote(o['post-mr'], `${md.trimEnd()}

${REPORT_MARKER}
`, REPORT_MARKER);
    log(`${res?.updated ? 'updated' : 'posted'} Behavior Diff on !${o['post-mr']}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------- gate
async function cmdGate(argv) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      in: { type: 'string' }, policy: { type: 'string', default: '.shakefix/policy.yml' },
      'diff-files': { type: 'string' }, labels: { type: 'string' }, mr: { type: 'string' },
      attempt: { type: 'string' }, json: { type: 'boolean', default: false },
    },
  });
  if (!o.in) throw usage('gate needs --in');
  const { evaluateGate, parseYaml, parseDiffFiles } = await import('../src/gate.js');
  const env = process.env;
  const proof = await readJson(o.in);
  let policy = {};
  if (existsSync(o.policy)) policy = parseYaml(await readFile(o.policy, 'utf8'));
  else log(`warn: policy ${o.policy} not found; using defaults`);
  const files = o['diff-files'] ? parseDiffFiles(await readFile(o['diff-files'], 'utf8')) : [];

  let labels = null;
  if (o.labels !== undefined) labels = o.labels.split(',');
  else if (o.mr && (await import('../src/gitlab.js')).scmConfigured(env)) {
    try {
      const { scmFromEnv } = await import('../src/gitlab.js');
      labels = (await scmFromEnv().getMR(o.mr)).labels || [];
    } catch (err) { log(`warn: could not fetch MR labels (${err.message})`); }
  }
  if (labels === null) labels = (env.CI_MERGE_REQUEST_LABELS || '').split(',');
  labels = labels.map((s) => s.trim()).filter(Boolean);

  const attempt = Number(o.attempt || env.PROOF_ATTEMPT || 1) || 1;
  const { gatherConfidenceInputs } = await import('../src/confidence-inputs.js');
  const { summaryOf } = await import('../src/confidence.js');
  const scm = await scmIfConfigured(env);
  const confidence = await gatherConfidenceInputs({ env, scm, mr: o.mr, log });
  const r = evaluateGate({ proof, policy, files, labels, attempt, confidence });
  // Export the score with the artifact: proof.json summary.fix_confidence.
  proof.summary = { ...(proof.summary || {}), fix_confidence: summaryOf(r.fixConfidence) };
  await writeJson(o.in, proof);
  if (o.json) console.log(JSON.stringify(r));
  log(`Fix Confidence ${r.fixConfidence.score}/100 ${r.fixConfidence.verdict} (threshold ${r.fixConfidence.threshold}) — ${r.fixConfidence.reason}`);
  console.log(`proof gate: ${r.status} (exit ${r.code}) — ${r.reason}`);
  return r.code;
}

// ---------------------------------------------------------------------------- fix confidence helpers
async function scmIfConfigured(env) {
  const g = await import('../src/gitlab.js');
  if (!g.scmConfigured(env)) return null;
  try { return g.scmFromEnv(env); } catch { return null; }
}

/** Diff file list: --diff-files, else `git diff --numstat <MR base> HEAD` in CI, else []. */
async function diffFilesFor(o, env) {
  const { parseDiffFiles } = await import('../src/gate.js');
  if (o['diff-files']) return parseDiffFiles(await readFile(o['diff-files'], 'utf8'));
  const baseSha = env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
  if (!baseSha) return [];
  try {
    const { execFileSync } = await import('node:child_process');
    return parseDiffFiles(execFileSync('git', ['diff', '--numstat', baseSha, 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return []; }
}

async function evaluateForConfidence({ proof, o, env, mr }) {
  const { evaluateGate, parseYaml } = await import('../src/gate.js');
  const { gatherConfidenceInputs } = await import('../src/confidence-inputs.js');
  const policy = o.policy && existsSync(o.policy) ? parseYaml(await readFile(o.policy, 'utf8')) : {};
  const files = await diffFilesFor(o, env);
  const labels = (o.labels ?? env.CI_MERGE_REQUEST_LABELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const scm = await scmIfConfigured(env);
  const confidence = await gatherConfidenceInputs({ env, scm, mr, log });
  return evaluateGate({ proof, policy, files, labels, attempt: Number(env.PROOF_ATTEMPT || 1) || 1, confidence });
}

// ---------------------------------------------------------------------------- main
function usage(msg) {
  const e = new Error(msg);
  e.usage = true;
  return e;
}

const COMMANDS = { run: cmdRun, label: cmdLabel, report: cmdReport, gate: cmdGate };

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') { console.log(HELP); return cmd ? 0 : 1; }
  const fn = COMMANDS[cmd];
  if (!fn) { log(`unknown command: ${cmd}\n\n${HELP}`); return 1; }
  return fn(rest);
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const isMain = !!process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => {
      log(`proof: ${err.message}`);
      if (err.usage) log(`\n${HELP}`);
      process.exitCode = 1;
    },
  );
}

export { main };
