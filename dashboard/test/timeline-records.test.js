import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureTimeline, liveElapsed, stageRows, stopwatchLine, STAGES } from '../src/timeline.js';
import { medicalRecords, speedupLine } from '../src/records.js';
import { normalizeBoard } from '../src/metrics.js';

const hero = JSON.parse(readFileSync(new URL('../../services/intake/src/demo/hero-run.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-10-11T09:00:00.000Z');

test('stopwatch runs until the 👍, then freezes', () => {
  const tl = { startedAt: '2026-10-11T09:00:00.000Z', endedAt: null, humanTouches: 0, stages: [] };
  assert.equal(stopwatchLine(tl, T0 + 65_000), 'shake → 👍 1m 05s (running) · Human touches: 0');
  const done = { ...tl, endedAt: '2026-10-11T09:11:42.000Z', cost: { usd: 0.38 } };
  assert.equal(stopwatchLine(done, T0 + 3_600_000), 'shake → 👍 11m 42s · Human touches: 0 · $0.38');
  assert.equal(liveElapsed({}, T0), null);
});

test('stage rows cover every stage, with time since the shake and the source tag', () => {
  const rows = stageRows({ startedAt: '2026-10-11T09:00:00.000Z', stages: [{ key: 'surgery', at: '2026-10-11T09:07:27.000Z', source: 'recorded' }, { key: 'verified', at: null, source: 'scripted' }] });
  assert.equal(rows.length, STAGES.length);
  const surgery = rows.find((r) => r.key === 'surgery');
  assert.equal(surgery.sinceShake, '7m 27s');
  assert.equal(surgery.reached, true);
  assert.equal(rows.find((r) => r.key === 'verified').reached, false);
});

test('fixture timeline replays the hero run from page load', () => {
  const early = fixtureTimeline(hero, T0, T0 + 450_000);
  assert.equal(early.demo, true);
  assert.equal(early.running, true);
  // Real case #14: MR opened at 5m 30s, merged at 13m 02s (services/intake/src/demo/hero-run.json).
  assert.ok(early.stages.find((s) => s.key === 'mr_opened').at);
  assert.equal(early.stages.find((s) => s.key === 'merged').at, null);
  const late = fixtureTimeline(hero, T0, T0 + 10 * 3_600_000);
  assert.equal(late.running, false);
  assert.match(stopwatchLine(late, T0 + 10 * 3_600_000), /^shake → 👍 26m 30s · Human touches: 1/);
});

test('medical records: hotspots, lessons, speedup; null-safe', () => {
  assert.equal(medicalRecords(null), null);
  assert.equal(medicalRecords({ nope: 1 }), null);
  const r = medicalRecords({
    cases: [{ iid: 4 }, { iid: 6 }],
    lessons: [{ id: 'L1', source: 'second-opinion-block', case: 4, text: 'Never change roundMoney' }, { id: 'L2', source: 'attending-concern', case: 6, text: 'Always Intl' }],
    hotspots: [{ kind: 'route', route: '/bill/:id', count: 1, last_iid: 6 }, { kind: 'file', file: 'apps/splitpal/src/lib/split.js', count: 3, last_iid: 4 }],
    stats: { cases: 2, repeat_bug_median_time_s: 40, first_time_median_s: 124 },
  });
  assert.equal(r.cases, 2);
  assert.deepEqual(r.hotspots[0], { kind: 'file', label: 'lib/split.js', count: 3, lastIid: 4 });
  assert.equal(r.lessons[0].id, 'L2'); // newest first
  assert.equal(r.speedup.text, 'Repeat bugs fixed 3.1× faster (median 40s vs 2m 04s first time)');
  assert.equal(speedupLine({ first_time_median_s: 228.5 }).text, 'First-time median 3m 49s · no repeat bug yet');
  assert.equal(speedupLine({}).text, 'No timed cases yet');
  // The shorthand shape from the brief ({key,count,last_iid}) still renders.
  assert.equal(medicalRecords({ cases: [], hotspots: [{ key: 'split.js', count: 2, last_iid: 1 }] }).hotspots[0].label, 'split.js');
});

test('board items carry human touches and the demo flag', () => {
  const [c] = normalizeBoard({ items: [{ rid: 'r1', state: 'proof', humanTouches: 2, demo: true }] });
  assert.equal(c.humanTouches, 2);
  assert.equal(c.demo, true);
  assert.equal(normalizeBoard([{ rid: 'r2' }])[0].humanTouches, null);
});

test('ledger panel entries come from the Medical Record cases', async () => {
  const { ledgerEntriesFromMemory } = await import('../src/records.js');
  const { ledgerPatterns } = await import('../src/metrics.js');
  const index = JSON.parse(readFileSync(new URL('../../.shakefix/memory/index.json', import.meta.url), 'utf8'));
  const entries = ledgerEntriesFromMemory(index);
  assert.equal(entries.length, index.cases.length);
  assert.ok(entries.every((e) => e.iid != null && typeof e.rootCause === 'string'));
  assert.ok(ledgerPatterns(entries).length >= 1);
  assert.deepEqual(ledgerEntriesFromMemory(null), []);
  // case-file shape (root_cause object) works too
  assert.deepEqual(ledgerEntriesFromMemory({ cases: [{ iid: 2, root_cause: { summary: 's', pattern: 'p', file: 'f' } }] })[0], { id: '2', iid: 2, route: null, pattern: 'p', rootCause: 's', files: [] });
});
