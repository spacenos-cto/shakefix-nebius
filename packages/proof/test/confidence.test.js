import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeFixConfidence, confidenceThreshold, jsonObjectsIn, normalizeStatus, regressionFromProof, renderConfidence, signalsFromTexts, summaryOf,
} from '../src/confidence.js';
import { mrSignals, unitStatus } from '../src/confidence-inputs.js';
import { evaluateGate, parseYaml, EXIT } from '../src/gate.js';
import { renderReport } from '../src/report.js';
import { applyRules, buildTouchContext } from '../src/label.js';
import { buildProof } from '../src/diff.js';
import { fx, fxText, b1Proof } from './helpers.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const policy = parseYaml(fxText('policy.yml'));
const repro = (base, head) => ({ base: { passed: base }, head: { passed: head } });

function cleanProof(reproduction) {
  const p = applyRules(b1Proof(), buildTouchContext({ proof: b1Proof(), replays: [fx('b1/replay.json')] }));
  p.flows = p.flows.filter((f) => f.flow !== 'change-tip');
  if (reproduction) p.flows.find((f) => f.source === 'replay').reproduction = reproduction;
  return p;
}

describe('computeFixConfidence', () => {
  it('scores a proven, clean fix 100 GO', () => {
    const fc = computeFixConfidence({ regression: 'fail-pass', unit: 'pass', unintended: 0, attending: { approve: true, confidence: 1, concerns: [] } });
    expect(fc).toMatchObject({ score: 100, verdict: 'GO', threshold: 80 });
  });

  it('unknown inputs cost a little but still GO by default (85)', () => {
    expect(computeFixConfidence({})).toMatchObject({ score: 85, verdict: 'GO' });
  });

  it('HOLDs below the team threshold', () => {
    const fc = computeFixConfidence({ regression: 'pass-pass', unit: 'pass', threshold: 80 });
    expect(fc.score).toBe(75);
    expect(fc.verdict).toBe('HOLD');
    expect(fc.reason).toBe('75 < threshold 80');
    expect(computeFixConfidence({ regression: 'pass-pass', unit: 'pass', threshold: 70 }).verdict).toBe('GO');
  });

  it('BLOCKs on a failing head regression, red unit tests, unintended changes or an Attending rejection', () => {
    expect(computeFixConfidence({ regression: 'fail-fail' }).verdict).toBe('BLOCK');
    expect(computeFixConfidence({ regression: 'fail-pass', unit: 'fail' }).verdict).toBe('BLOCK');
    expect(computeFixConfidence({ regression: 'fail-pass', unintended: 1 })).toMatchObject({ verdict: 'BLOCK', score: 70 });
    expect(computeFixConfidence({ regression: 'fail-pass', attending: { approve: false } }).verdict).toBe('BLOCK');
  });

  it('HOLDs on policy hits even with a high score', () => {
    const fc = computeFixConfidence({ regression: 'fail-pass', unit: 'pass', policyHits: 1 });
    expect(fc).toMatchObject({ score: 80, verdict: 'HOLD' });
  });

  it('uses Attending confidence, concerns, premortem risk and re-operation', () => {
    const fc = computeFixConfidence({
      regression: 'fail-pass', unit: 'pass', attending: { approve: true, confidence: 0.7, concerns: ['a', 'b'] }, premortemRisk: 'medium', attempt: 2,
    });
    // 100 - 9 (0.3*30) - 6 - 10 - 5 = 70
    expect(fc.score).toBe(70);
    expect(fc.verdict).toBe('HOLD');
    expect(fc.factors.map((f) => f.key)).toContain('premortem');
  });

  it('threshold comes from FIX_CONFIDENCE_MIN', () => {
    expect(confidenceThreshold({})).toBe(80);
    expect(confidenceThreshold({ FIX_CONFIDENCE_MIN: '90' })).toBe(90);
    expect(confidenceThreshold({ FIX_CONFIDENCE_MIN: 'x' })).toBe(80);
    expect(confidenceThreshold({ FIX_CONFIDENCE_MIN: '' })).toBe(80);
  });

  it('normalizes statuses', () => {
    expect(normalizeStatus('success')).toBe('pass');
    expect(normalizeStatus('failed')).toBe('fail');
    expect(normalizeStatus(undefined)).toBe('unknown');
  });
});

describe('signals from the MR', () => {
  it('finds the Attending JSON in prose and fences (last wins) and a premortem risk', () => {
    const texts = [
      'Chart...\n```json\n{"approve":false,"confidence":0.4,"concerns":["x"],"policy_hits":[]}\n```',
      'Review: {"approve":true,"confidence":0.92,"concerns":[],"policy_hits":[],"summary":"ok {not json}"} done',
      'Memory premortem: {"premortem":{"risk":"high","seen_before":12}}',
    ];
    const s = signalsFromTexts(texts);
    expect(s.attending).toEqual({ approve: true, confidence: 0.92, concerns: [], policyHits: [] });
    expect(s.premortemRisk).toBe(1);
    expect(signalsFromTexts(['{"approve":true,"confidence":85}']).attending.confidence).toBe(0.85);
    expect(signalsFromTexts(['{"query":{},"risk":"med","autonomy":"supervised","policy_hit":"memory:high-risk"}']).premortemRisk).toBe(0.5);
    expect(signalsFromTexts(['{"risk":"high"}']).premortemRisk).toBeNull();
    expect(jsonObjectsIn('a {b} {"c":1}')).toEqual([{ c: 1 }]);
  });

  it('reads notes and pipeline jobs through the SCM, best effort', async () => {
    const scm = {
      name: 'gitlab',
      getMR: async () => ({ description: 'no json here' }),
      listMRNotes: async () => [{ body: '{"approve":true,"confidence":0.8}' }, { system: true, body: '{"approve":false}' }],
      request: async () => [{ name: 'lint', status: 'success' }, { name: 'unit', status: 'failed' }],
    };
    expect((await mrSignals({ scm, mr: 1 })).attending.confidence).toBe(0.8);
    expect(await unitStatus({ env: { CI_PIPELINE_ID: '9', CI_PROJECT_ID: '1' }, scm })).toBe('fail');
    expect(await unitStatus({ env: { PROOF_UNIT_STATUS: 'success' }, scm })).toBe('pass');
    expect(await unitStatus({ env: {}, scm: null })).toBe('unknown');
    const broken = { name: 'gitlab', request: async () => { throw new Error('403'); } };
    expect(await unitStatus({ env: { CI_PIPELINE_ID: '9', CI_PROJECT_ID: '1' }, scm: broken })).toBe('unknown');
  });
});

describe('gate + report integration', () => {
  it('regressionFromProof reads the replay flows written by `proof run`', () => {
    expect(regressionFromProof(cleanProof(repro(false, true)))).toBe('fail-pass');
    expect(regressionFromProof(cleanProof(repro(true, true)))).toBe('pass-pass');
    expect(regressionFromProof(cleanProof(null))).toBe('unknown');
  });

  it('buildProof keeps the reproduction outcome', () => {
    const p = buildProof({ flows: [{ flow: 'replay-x', source: 'replay', changes: [], reproduction: repro(false, true) }] });
    expect(p.flows[0].reproduction).toEqual(repro(false, true));
  });

  it('the gate attaches Fix Confidence and holds a ready MR below the threshold', () => {
    const ready = evaluateGate({ proof: cleanProof(repro(false, true)), policy, confidence: { unit: 'pass' } });
    expect(ready.status).toBe('ready');
    expect(ready.fixConfidence).toMatchObject({ score: 100, verdict: 'GO' });

    const held = evaluateGate({ proof: cleanProof(repro(false, true)), policy, confidence: { unit: 'pass', attending: { approve: true, confidence: 0.3, concerns: ['a', 'b', 'c'] } } });
    expect(held.code).toBe(EXIT.NEEDS_HUMAN);
    expect(held.reason).toMatch(/^Fix Confidence 70\/100 HOLD/);

    const strict = evaluateGate({ proof: cleanProof(repro(false, true)), policy, confidence: { threshold: 99 } });
    expect(strict.status).toBe('needs-human');

    const notProven = evaluateGate({ proof: cleanProof(repro(false, false)), policy });
    expect(notProven.reason).toMatch(/BLOCK: regression spec still fails/);
  });

  it('the Second Opinion card shows the score', () => {
    const fc = computeFixConfidence({ regression: 'fail-pass', unit: 'pass' });
    const md = renderReport(cleanProof(), { confidence: fc });
    expect(md).toContain('**Fix Confidence 100/100 · ✅ GO** (team threshold 80)');
    expect(renderConfidence(computeFixConfidence({ regression: 'fail-fail' }))).toContain('⛔ BLOCK');
    expect(summaryOf(fc)).toMatchObject({ score: 100, verdict: 'GO', threshold: 80 });
  });

  it('`proof gate` writes summary.fix_confidence into proof.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-'));
    const file = join(dir, 'proof.json');
    writeFileSync(file, JSON.stringify(cleanProof(repro(false, true))));
    const env = { ...process.env, PROOF_UNIT_STATUS: 'pass', FIX_CONFIDENCE_MIN: '80' };
    for (const k of ['SHAKEFIX_BOT_TOKEN', 'CI_API_V4_URL', 'GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_REPO', 'GITHUB_REPOSITORY', 'CI_MERGE_REQUEST_LABELS']) delete env[k];
    const bin = fileURLToPath(new URL('../bin/proof.js', import.meta.url));
    const policyPath = fileURLToPath(new URL('./fixtures/policy.yml', import.meta.url));
    const r = spawnSync(process.execPath, [bin, 'gate', '--in', file, '--policy', policyPath, '--labels', ''], { env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(EXIT.READY);
    expect(r.stderr).toContain('Fix Confidence 100/100 GO');
    expect(JSON.parse(readFileSync(file, 'utf8')).summary.fix_confidence).toMatchObject({ score: 100, verdict: 'GO', threshold: 80 });
  });
});


describe('regressionFromProof prefers the regression spec', async () => {
  const { regressionFromProof } = await import('../src/confidence.js');
  const replay = (b, h) => ({ flow: 'replay', source: 'replay', reproduction: { base: { passed: b }, head: { passed: h } } });
  const spec = (b, h) => ({ flow: 'spec:x', source: 'replay', kind: 'regression-spec', reproduction: { base: { passed: b }, head: { passed: h } } });
  it('a replay that cannot show the bug + a spec that fails on base and passes on head = proven', () => {
    expect(regressionFromProof({ flows: [replay(true, true), spec(false, true)] })).toBe('fail-pass');
  });
  it('a spec that passes on base means unproven, whatever the replay says', () => {
    expect(regressionFromProof({ flows: [replay(false, true), spec(true, true)] })).toBe('pass-pass');
  });
  it('without a spec the replay decides, as before', () => {
    expect(regressionFromProof({ flows: [replay(false, true)] })).toBe('fail-pass');
  });
});
