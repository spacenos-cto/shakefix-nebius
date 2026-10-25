import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, columnFor, computeMetrics, formatDuration, ledgerPatterns, median, normalizeBoard } from '../src/metrics.js';
import { demoBoard, tick } from '../src/fixtures.js';

test('normalizeBoard accepts {cards}, bare arrays and scoped label states', () => {
  const a = normalizeBoard({ cards: [{ rid: 'r1', state: 'shakefix::proof', sev: 2 }] });
  const b = normalizeBoard([{ rid: 'r1', state: 'proof', sev: '2' }]);
  assert.equal(a[0].state, 'proof');
  assert.equal(b[0].sev, 2);
  assert.equal(columnFor(a[0]), 'proof');
});

test('columns cover every state', () => {
  for (const s of ['received', 'triaging', 'in-surgery', 'proof', 'ready', 'deployed', 'verified', 'reopened', 'needs-human', 'needs-info', 'rolled-back']) {
    assert.ok(columnFor({ state: s }));
  }
  assert.equal(columnFor({ state: 'rolled-back' }), 'human');
  assert.equal(columnFor({ state: 'verified' }), 'verified');
  assert.equal(columnFor({ state: 'reopened' }), 'triage');
  const ids = COLUMNS.map((c) => c.id);
  assert.equal(ids.indexOf('verified'), ids.indexOf('discharged') + 1); // Verified comes right after Discharged
});

test('median and metrics', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  const cards = normalizeBoard(demoBoard(1_000_000_000).cards);
  const m = computeMetrics(cards);
  assert.equal(m.unintendedCaught, 1);
  assert.equal(m.rollbacks, 1);
  assert.equal(m.handsOffPct, 60); // 3 hands-off deployed of 5 finished
  assert.ok(m.medianMs > 0);
  assert.equal(m.confirmedPct, 67); // demo: 2 verified 👍, 1 reopened 👎
});

test('reporter verdicts: chip data and % fixes confirmed by reporter', () => {
  const cards = normalizeBoard({
    items: [
      { rid: 'a', state: 'verified', verdict: 'confirmed', verdicts: { confirmed: 1, rejected: 0 } },
      { rid: 'b', state: 'shakefix::verified' }, // label-only: verified implies 👍
      { rid: 'c', state: 'reopened', verdict: 'rejected', verdicts: { confirmed: 0, rejected: 1 } },
      { rid: 'd', state: 'deployed', verdict: null },
      { rid: 'e', state: 'deployed', verdict: 'bogus' },
    ],
  });
  assert.deepEqual(cards.map((c) => c.verdict), ['confirmed', 'confirmed', 'rejected', null, null]);
  assert.deepEqual(cards[2].verdicts, { confirmed: 0, rejected: 1 });
  const m = computeMetrics(cards);
  assert.equal(m.confirmedPct, 67); // 2 👍 of 3 verdicts
  assert.equal(m.confirmed, 2);
  assert.equal(m.rejected, 1);
  assert.equal(m.awaitingVerdict, 2);
  assert.equal(computeMetrics([]).confirmedPct, null);
  assert.equal(computeMetrics([], { confirmedPct: 90 }).confirmedPct, 90);
});

test('verified fixes still count as fixed and hands-off', () => {
  const cards = normalizeBoard([{ rid: 'a', state: 'verified', createdAt: 1_000, fixedAt: 61_000, autonomy: 'hands-off' }]);
  const m = computeMetrics(cards);
  assert.equal(m.medianMs, 60_000);
  assert.equal(m.handsOffPct, 100);
});

test('server metrics win', () => {
  assert.equal(computeMetrics([], { rollbacks: 7 }).rollbacks, 7);
});

test('ledger patterns group and sort', () => {
  const p = ledgerPatterns([{ pattern: 'a' }, { pattern: 'b' }, { pattern: 'b', route: '/x' }]);
  assert.deepEqual(p.map((r) => [r.pattern, r.count]), [['b', 2], ['a', 1]]);
});

test('formatDuration', () => {
  assert.equal(formatDuration(2 * 60_000 + 41_000), '2m 41s');
  assert.equal(formatDuration(null), '—');
});

test('demo tick walks the live card to deployed and restarts', () => {
  const board = demoBoard(0);
  const seen = new Set();
  for (let i = 0; i < 8; i++) seen.add(tick(board, i).cards.find((c) => c.rid === 'r_demo_live').state);
  assert.ok(seen.has('deployed'));
  assert.ok(seen.has('verified'));
  assert.ok(seen.has('received'));
});

test('a fix with any human touch is not hands-off', () => {
  const cards = normalizeBoard([
    { rid: 'a', state: 'deployed', createdAt: 1_000, fixedAt: 61_000, autonomy: 'hands-off', humanTouches: 0 },
    { rid: 'b', state: 'deployed', createdAt: 1_000, fixedAt: 61_000, autonomy: 'hands-off', humanTouches: 3 },
  ]);
  assert.equal(computeMetrics(cards).handsOffPct, 50);
});

test('closed (superseded) cases leave the board and the metrics', () => {
  const cards = normalizeBoard([{ rid: 'a', state: 'closed' }, { rid: 'b', state: 'proof' }]);
  assert.deepEqual(cards.map((c) => c.rid), ['b']);
});
