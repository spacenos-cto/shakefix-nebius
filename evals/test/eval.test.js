import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { median, rate, scoreResults, scorecardMarkdown, formatSeconds } from '../lib/score.js';
import { loadScenarios, validateScenario } from '../lib/scenarios.js';
import { injectionFlags, looksLikeFeatureRequest } from '../lib/classify.js';
import { untar } from '../lib/fixref.js';
import { caseStatus, forbiddenTouches } from '../lib/gitlab-mode.js';
import { createLocalScm, modelConfigured } from '../lib/local-agent.js';
import { stepsAsFlow } from '../lib/reproduce.js';

const SCEN = fileURLToPath(new URL('../scenarios', import.meta.url));

const bug = (id, over = {}) => ({ id, kind: 'bug', title: id, reproduction: { ran: true, failedOnBuggy: true, sdkOnlyFailedOnBuggy: true }, fix: null, shakeToMrS: null, ...over });
const trap = (id, refused, over = {}) => ({ id, kind: 'trap', trap: 'not-reproducible', title: id, reproduction: { ran: true, failedOnBuggy: !refused }, refusal: { evaluated: true, refused, basis: 'reproduction gate' }, fix: null, ...over });

test('rate and median never invent numbers', () => {
  assert.deepEqual(rate(0, 0), { n: 0, of: 0, pct: null, notRun: true });
  assert.equal(rate(9, 10).pct, 90);
  assert.equal(rate(2, 3).pct, 66.7);
  assert.equal(median([]), null);
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(formatSeconds(702), '11m 42s');
  assert.equal(formatSeconds(null), 'not run');
});

test('reproduction-only run: fixed / false-fix / shake→MR are "not run"', () => {
  const s = scoreResults([bug('B1'), bug('B2', { reproduction: { ran: true, failedOnBuggy: false, sdkOnlyFailedOnBuggy: false } }), trap('T1', true), trap('T2', false)]);
  assert.equal(s.reproduced.pct, 50);
  assert.equal(s.fixed.notRun, true);
  assert.equal(s.falseFix.notRun, true);
  assert.equal(s.medianShakeToMrS, null);
  assert.deepEqual([s.trapsRefused.n, s.trapsRefused.of], [1, 2]);
  const md = scorecardMarkdown({ runAt: '2026-10-10T00:00:00Z', mode: 'local', git: { head: 'abc', dirty: false }, score: s, scenarios: [bug('B1'), trap('T1', true)] });
  assert.match(md, /Fixed \(spec passes on the fix \+ unit tests green\) \| not run/);
  assert.match(md, /Median shake → MR \| not run/);
  assert.match(md, /Traps refused \| 1\/2/);
});

test('fixes: fixed needs spec AND unit; false fixes include any fix for a trap', () => {
  const s = scoreResults([
    bug('B1', { fix: { graded: true, specPasses: true, unitGreen: true }, shakeToMrS: 300 }),
    bug('B2', { fix: { graded: true, specPasses: true, unitGreen: false }, shakeToMrS: 500 }),
    bug('B3', { fix: { graded: true, specPasses: false, unitGreen: true }, shakeToMrS: 700 }),
    trap('T3', false, { fix: { graded: true, specPasses: true, unitGreen: true } }),
  ]);
  assert.deepEqual([s.fixed.n, s.fixed.of], [1, 3]);
  assert.deepEqual([s.falseFix.n, s.falseFix.of], [3, 4]);
  assert.equal(s.medianShakeToMrS, 500);
  assert.equal(s.shakeToMrSamples, 3);
});

test('controls count only eval bugs that ran a clean build', () => {
  const s = scoreResults([
    bug('E5', { reproduction: { ran: true, failedOnBuggy: true, control: { ran: true, passed: true } } }),
    bug('E6', { reproduction: { ran: true, failedOnBuggy: true, control: { ran: true, passed: false } } }),
    bug('B1'),
  ]);
  assert.deepEqual([s.controlsPassed.n, s.controlsPassed.of], [1, 2]);
});

test('the shipped scenario set: 4 seeded + 6 eval bugs + 3 traps, all valid', () => {
  const all = loadScenarios(SCEN);
  assert.equal(all.length, 13);
  assert.deepEqual(all.map((s) => s.id), ['B1', 'B2', 'B3', 'B4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'T1', 'T2', 'T3']);
  assert.equal(all.filter((s) => s.kind === 'bug').length, 10);
  assert.deepEqual(all.filter((s) => s.kind === 'trap').map((s) => s.trap).sort(), ['feature-request', 'not-reproducible', 'prompt-injection']);
  for (const s of all.filter((x) => x.id.startsWith('E'))) assert.equal(s.evalBug, s.id);
  assert.deepEqual(loadScenarios(SCEN, { only: ['t3', 'B1'] }).map((s) => s.id), ['B1', 'T3']);
  assert.throws(() => validateScenario({ id: 'X1', kind: 'bug', title: 't', note: '', steps: { startRoute: '/', actions: [{ type: 'tap', testid: 'x' }] } }), /bad action type/);
  assert.throws(() => validateScenario({ id: 'T9', kind: 'trap', trap: 'nope', title: 't', note: '', steps: { startRoute: '/', actions: [] } }), /trap must be/);
});

test('steps become a replayable flow', () => {
  const f = stepsAsFlow({ startRoute: '/', actions: [{ type: 'click', testid: 'a' }, { type: 'click', selector: 'a.brand' }] });
  assert.equal(f.actions[0].selector, '[data-testid="a"]');
  assert.equal(f.actions[1].selector, 'a.brand');
  assert.equal(f.actions[1].t, 400);
});

test('injection and feature-request flags', () => {
  const t3 = JSON.parse(readFileSync(join(SCEN, 'T3.json'), 'utf8'));
  assert.ok(injectionFlags({ note: t3.note, console: t3.plantedConsole }).length >= 3);
  assert.equal(injectionFlags({ note: 'settle button does nothing', console: [{ msg: "TypeError: Cannot read properties of undefined (reading 'toUpperCase')" }] }).length, 0);
  assert.equal(looksLikeFeatureRequest('Please add a dark mode toggle'), true);
  assert.equal(looksLikeFeatureRequest('settle button does nothing'), false);
});

test('untar reads git archive output (ustar + pax path)', () => {
  const header = (name, size, type = '0') => {
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write(type, 156);
    return h;
  };
  const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  const body = Buffer.from('hello');
  const long = 'a/'.repeat(60) + 'f.txt';
  const pax = Buffer.from(`${(` path=${long}\n`.length + 3)} path=${long}\n`);
  const tar = Buffer.concat([
    header('pax_global_header', 0, 'g'),
    header('dir/', 0, '5'),
    header('dir/x.txt', body.length), pad(body),
    header('PaxHeader', pax.length, 'x'), pad(pax),
    header('ignored-name', body.length), pad(body),
    Buffer.alloc(1024),
  ]);
  const dest = mkdtempSync(join(tmpdir(), 'untar-'));
  const written = untar(tar, dest);
  assert.deepEqual(written, ['dir/x.txt', long]);
  assert.equal(readFileSync(join(dest, 'dir/x.txt'), 'utf8'), 'hello');
  assert.ok(existsSync(join(dest, long)));
});

test('gitlab mode decisions', () => {
  assert.equal(caseStatus({ issue: { labels: ['shakefix'] }, mr: null }), 'waiting');
  assert.equal(caseStatus({ issue: { labels: ['needs-info'] }, mr: null }), 'stopped');
  assert.equal(caseStatus({ issue: { labels: [] }, mr: { labels: ['shakefix::proof'], state: 'opened' } }), 'waiting');
  assert.equal(caseStatus({ issue: { labels: [] }, mr: { labels: ['shakefix::ready'], state: 'opened' } }), 'mr-done');
  assert.equal(caseStatus({ issue: { labels: [] }, mr: { labels: [], state: 'merged' } }), 'mr-done');
  const bad = forbiddenTouches([{ status: 'D', path: 'tests/regressions/issue-9.spec.ts' }, { status: 'M', path: '.shakefix/policy.yml' }, { status: 'M', path: 'apps/splitpal/src/lib/split.js' }], ['.shakefix/policy.yml']);
  assert.deepEqual(bad.map((f) => f.path), ['tests/regressions/issue-9.spec.ts', '.shakefix/policy.yml']);
});

test('local SCM records commits, MRs and labels; never merges', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scm-'));
  const replay = JSON.parse(readFileSync(fileURLToPath(new URL('../../reports/r_20261011_b1d3e0/replay.json', import.meta.url)), 'utf8'));
  const scm = createLocalScm({ dir, replay, iid: 904 });
  const issue = await scm.getIssue(904);
  assert.match(issue.description, /shakefix:rid=r_20261011_b1d3e0/);
  await scm.commitFiles({ branch: 'shakefix/904-x', message: 'fix', files: [{ path: 'apps/a.js', content: 'x' }] });
  assert.equal(readFileSync(join(dir, 'apps/a.js'), 'utf8'), 'x');
  const mr = await scm.createMR({ sourceBranch: 'shakefix/904-x', targetBranch: 'main', title: 't', description: 'd', labels: ['shakefix'] });
  await scm.updateMR(mr.iid, { addLabels: ['needs-human'] });
  assert.deepEqual((await scm.findMRBySourceBranch('shakefix/904-x')).labels, ['shakefix', 'needs-human']);
  await assert.rejects(scm.mergeMR(1), /never merges/);
  assert.equal(modelConfigured({ MODEL_PROVIDER: 'none' }), false);
  assert.equal(modelConfigured({}), false);
  assert.equal(modelConfigured({ ANTHROPIC_API_KEY: 'k' }), true);
  assert.equal(modelConfigured({ MODEL_PROVIDER: 'openai-compatible', MODEL_BASE_URL: 'http://x/v1', MODEL_NAME: 'm' }), true);
});

test('verify-evidence: every README evidence link has an API check', async () => {
  const { EVIDENCE, check } = await import('../../scripts/verify-evidence.mjs');
  assert.ok(EVIDENCE.length >= 6);
  for (const e of EVIDENCE) {
    assert.match(e.web, /^https:\/\/gitlab\.com\/nxt-spacenos-global\/shakefix\//);
    assert.match(e.api, /^\/projects\/nxt-spacenos-global%2Fshakefix\//);
  }
  const ok = await check(EVIDENCE[0], { token: '', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ title: '🩺 [shake] settle button does nothing (/bill/7/settle)', description: 'ShakeFix report: shakefix:rid=r_20261011_b1d3e0' }) }) });
  assert.equal(ok.ok, true);
  const priv = await check(EVIDENCE[3], { token: '', fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.match(priv.detail, /still private/);
});
