import { describe, it, expect } from 'vitest';
import { jsonDiff, diffFlow, diffApi, diffScreens, buildProof, allChanges, splitStable } from '../src/diff.js';
import { fx, b1Proof } from './helpers.js';

const step = (i, extra = {}) => ({ i, route: '/bill/1', texts: {}, api: [], db: [], ...extra });
const cap = (steps, error = null) => ({ flow: 'f', steps, error });

describe('jsonDiff', () => {
  it('reports leaf differences by JSON path', () => {
    const a = { shares: [{ amount: 333.33 }, { amount: 333.33 }], ok: false };
    const b = { shares: [{ amount: 333.33 }, { amount: 333.34 }], ok: true };
    expect(jsonDiff(a, b)).toEqual([
      { path: '$.ok', before: false, after: true },
      { path: '$.shares[1].amount', before: 333.33, after: 333.34 },
    ]);
  });
  it('reports added/removed keys and array items', () => {
    expect(jsonDiff({ a: 1 }, { b: 2 })).toEqual([
      { path: '$.a', before: 1, after: '(absent)' },
      { path: '$.b', before: '(absent)', after: 2 },
    ]);
    expect(jsonDiff([1], [1, 2])).toEqual([{ path: '$[1]', before: '(absent)', after: 2 }]);
  });
  it('is empty for equal values regardless of key order', () => {
    expect(jsonDiff({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toEqual([]);
  });
});

describe('diffFlow — B1 trap scenario', () => {
  it('change-tip: head changes /bill/9 · tip-total ₹49.99 → ₹50.00 and nothing else', () => {
    const changes = diffFlow(fx('b1/change-tip.base.json'), fx('b1/change-tip.head.json'));
    expect(changes.map(({ channel, where, before, after }) => ({ channel, where, before, after }))).toEqual([
      { channel: 'screen', where: '/bill/9 · tip-total', before: '₹49.99', after: '₹50.00' },
    ]);
  });

  it('replay: screen, api and db changes in deterministic order, deduped across steps', () => {
    const changes = diffFlow(fx('b1/replay.base.json'), fx('b1/replay.head.json'));
    expect(changes.map((c) => [c.channel, c.where, c.before, c.after])).toEqual([
      ['screen', '/bill/4 · share-Asha', '₹333.33', '₹333.34'],
      ['api', 'POST /api/bills · $.shares[0].amount', 333.33, 333.34],
      ['screen', '/bill/4/settle · pay-Asha-btn', 'Pay ₹333.33', 'Pay ₹333.34'],
      ['api', 'GET /api/bills/:id · $.shares[0].amount', 333.33, 333.34],
      ['screen', '/bill/4/settle · error-banner', 'Amounts do not add up', '(hidden)'],
      ['screen', '/bill/4/settle · settled-banner', '(hidden)', 'Settled ✓'],
      ['api', 'POST /api/bills/:id/settle · $.ok', false, true],
      ['api', 'POST /api/bills/:id/settle · status', 409, 200],
      ['db', 'update bills', '(none)', { settled: true }],
    ]);
  });

  it('is deterministic (same input → identical output)', () => {
    expect(JSON.stringify(b1Proof())).toBe(JSON.stringify(b1Proof()));
  });

  it('buildProof assigns stable ids c1..cn across flows', () => {
    const proof = b1Proof();
    expect(proof.schema).toBe('shakefix.proof/v1');
    expect(proof.mr).toBe(42);
    expect(proof.summary).toEqual({ changes: 10 });
    expect(allChanges(proof).map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => `c${i + 1}`));
    expect(proof.flows[0].changes[0]).toMatchObject({ id: 'c1', where: '/bill/9 · tip-total' });
  });
});

describe('diffScreens', () => {
  it('pixel diff only flags visual-only steps', () => {
    const base = cap([step(0, { texts: { a: 'x' } }), step(1, { texts: { a: 'x' } })]);
    const head = cap([step(0, { texts: { a: 'y' } }), step(1, { texts: { a: 'x' } })]);
    const out = diffScreens(base, head, { 0: 500, 1: 120 });
    expect(out.map((c) => c.where)).toEqual(['/bill/1 · a', '/bill/1 · (visual)']);
    expect(out[1].after).toBe('visual change (120 px)');
  });
  it('a testid that disappears is reported as (hidden)', () => {
    const out = diffScreens(cap([step(0, { texts: { b: 'Settled' } })]), cap([step(0)]));
    expect(out[0]).toMatchObject({ before: 'Settled', after: '(hidden)' });
  });
  it('a step missing on one side is reported', () => {
    const out = diffFlow(cap([step(0), step(1)]), cap([step(0)], 'boom'));
    expect(out.map((c) => c.where)).toEqual(['/bill/1 · (flow error)', '/bill/1 · (step 2)']);
  });
});

describe('diffApi', () => {
  it('detects added and removed endpoints', () => {
    const base = cap([step(0, { api: [{ method: 'GET', path: '/api/a', status: 200, body: null }] })]);
    const head = cap([step(0, { api: [{ method: 'GET', path: '/api/b', status: 200, body: null }] })]);
    expect(diffApi(base, head).map((c) => [c.where, c.before, c.after])).toEqual([
      ['GET /api/a', '200 (called ×1)', '(none)'],
      ['GET /api/b', '(none)', '200 (called ×1)'],
    ]);
  });
  it('matches responses across steps (tolerates step slippage)', () => {
    const e = { method: 'GET', path: '/api/bills', status: 200, body: { n: 1 } };
    const base = cap([step(0, { api: [e] }), step(1)]);
    const head = cap([step(0), step(1, { api: [e] })]);
    expect(diffApi(base, head)).toEqual([]);
  });
});

describe('buildProof', () => {
  it('keeps mr null and summary zero for empty flows', () => {
    expect(buildProof({ base: 'a', head: 'b', flows: [{ flow: 'x', changes: [] }] }))
      .toEqual({ schema: 'shakefix.proof/v1', mr: null, base: 'a', head: 'b', flows: [{ flow: 'x', changes: [] }], summary: { changes: 0 } });
  });
});

describe('splitStable (Second Opinion recheck)', () => {
  const tip = (after) => ({ channel: 'screen', where: '/bill/9 · tip-total', before: '₹49.99', after });
  it('keeps changes that repeat and drops ones that do not', () => {
    const r = splitStable([tip('₹24.99'), { channel: 'screen', where: '/bill/13 · bill-total', before: null, after: '₹300.00' }],
      [{ channel: 'screen', where: '/bill/13 · bill-total', before: null, after: '₹300.00' }]);
    expect(r.stable.map((c) => c.where)).toEqual(['/bill/13 · bill-total']);
    expect(r.flaky.map((c) => c.where)).toEqual(['/bill/9 · tip-total']);
  });
  it('a change caused by the fix repeats, so it stays unintended', () => {
    expect(splitStable([tip('₹50.00')], [tip('₹50.00')]).flaky).toEqual([]);
  });
  it('never drops visual-only rows (the recheck has no pixel pass)', () => {
    const v = { channel: 'screen', where: '/bill/1', before: null, after: null, ctx: { kind: 'visual' } };
    expect(splitStable([v], []).stable).toEqual([v]);
  });
  it('buildProof records flaky rows and counts them', () => {
    const p = buildProof({ flows: [{ flow: 'change-tip', changes: [], flaky: [tip('₹24.99')] }] });
    expect(p.summary.flaky).toBe(1);
    expect(p.flows[0].flaky[0].where).toBe('/bill/9 · tip-total');
  });
});
