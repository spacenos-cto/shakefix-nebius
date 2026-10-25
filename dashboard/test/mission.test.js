import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABS, searchWithTab, tabFromSearch, tabKeyTarget } from '../src/tabs.js';
import { ago, buildFeed, describe, eventKeyForState, eventsFromCard, eventsFromTimeline, transitionEvents } from '../src/feed.js';
import { controlsScore, proofBars, proofTotals } from '../src/opinion.js';
import { caseLinks, certificateHref, receipts } from '../src/receipts.js';
import { numberTiles, shakeToLiveSeries, sparkline, tween, easeOutCubic } from '../src/numbers.js';
import { normalizeBoard } from '../src/metrics.js';
import { STAGES, fixtureTimeline } from '../src/timeline.js';
import { STAGE_EXPLAIN } from '../src/explain.js';
import { demoBoard } from '../src/fixtures.js';

const hero = JSON.parse(readFileSync(new URL('../../services/intake/src/demo/hero-run.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-10-11T09:00:00.000Z');
const MIN = 60_000;

// ---- tabs -------------------------------------------------------------------------------------
test('tabs: order, ?tab= parsing and URL sync keep other params', () => {
  assert.deepEqual(TABS.map((t) => t.id), ['patients', 'feed', 'opinion', 'receipts', 'numbers']);
  assert.equal(tabFromSearch('?tab=feed'), 'feed');
  assert.equal(tabFromSearch('?tab=nope'), 'patients');
  assert.equal(tabFromSearch(''), 'patients');
  assert.equal(searchWithTab('?intake=https%3A%2F%2Fx&explain=1', 'numbers'), '?intake=https%3A%2F%2Fx&explain=1&tab=numbers');
  assert.equal(searchWithTab('?tab=numbers&rid=r1', 'patients'), '?rid=r1');
  assert.equal(searchWithTab('?tab=feed', 'patients'), '');
});

test('tabs: arrow keys wrap, Home/End jump, other keys ignored', () => {
  assert.equal(tabKeyTarget('patients', 'ArrowRight'), 'feed');
  assert.equal(tabKeyTarget('numbers', 'ArrowRight'), 'patients');
  assert.equal(tabKeyTarget('patients', 'ArrowLeft'), 'numbers');
  assert.equal(tabKeyTarget('opinion', 'Home'), 'patients');
  assert.equal(tabKeyTarget('opinion', 'End'), 'numbers');
  assert.equal(tabKeyTarget('opinion', 'a'), null);
});

// ---- feed -------------------------------------------------------------------------------------
test('feed: every timeline stage reuses the plain-English copy from explain.js', () => {
  for (const [key] of STAGES) {
    const d = describe(key);
    assert.equal(d.text, STAGE_EXPLAIN[key].plain, key);
    assert.ok(d.icon && d.icon !== '•', key);
  }
  for (const s of ['rolled-back', 'needs-human', 'reopened', 'unintended']) assert.notEqual(describe(s).icon, '•', s);
  assert.equal(eventKeyForState('in-surgery'), 'surgery');
  assert.equal(eventKeyForState('rolled-back'), 'rolled-back');
});

test('feed: timeline events only for reached stages, demo sources kept', () => {
  // Real case #14 fixture: up to the MR (330 s), before Second Opinion (726 s).
  const tl = fixtureTimeline(hero, T0, T0 + 450_000);
  const ev = eventsFromTimeline({ rid: hero.rid, iid: 14, title: 't' }, tl);
  assert.deepEqual(ev.map((e) => e.key), ['shaken', 'issue_created', 'triage_start', 'mr_opened']);
  assert.equal(ev.find((e) => e.key === 'mr_opened').source, null); // "recorded" is the norm, not tagged
  assert.equal(ev[0].iid, 14);
  // A stage that was not recorded keeps its tag on screen.
  const scripted = { ...hero, stages: hero.stages.map((s) => (s.key === 'triage_start' ? { ...s, source: 'scripted' } : s)) };
  const ev2 = eventsFromTimeline({ rid: hero.rid, iid: 14, title: 't' }, fixtureTimeline(scripted, T0, T0 + 450_000));
  assert.equal(ev2.find((e) => e.key === 'triage_start').source, 'scripted');
});

test('feed: board cards give shake, live and timed current state', () => {
  const [c] = normalizeBoard([{ rid: 'a', issueIid: 7, state: 'rolled-back', createdAt: 1000, updatedAt: 5000 }]);
  assert.deepEqual(eventsFromCard(c).map((e) => [e.key, e.at]), [['shaken', 1000], ['rolled-back', 5000]]);
  const [d] = normalizeBoard([{ rid: 'b', state: 'deployed', createdAt: 1000, fixedAt: 9000 }]);
  assert.deepEqual(eventsFromCard(d).map((e) => e.key), ['shaken', 'deployed']);
});

test('feed: transitions, newest first, timelines win, near-duplicates merged', () => {
  const prev = normalizeBoard([{ rid: 'a', state: 'triaging', createdAt: 1000 }, { rid: 'b', state: 'proof' }]);
  const next = normalizeBoard([{ rid: 'a', state: 'in-surgery', createdAt: 1000 }, { rid: 'b', state: 'proof' }, { rid: 'c', state: 'received', createdAt: 2000 }]);
  const tr = transitionEvents(prev, next, 50_000);
  assert.deepEqual(tr.map((e) => [e.rid, e.key, e.at]), [['a', 'surgery', 50_000]]);
  assert.deepEqual(transitionEvents(null, next), []);

  const timelines = new Map([['c', { card: { rid: 'c', iid: 9 }, tl: { stages: [{ key: 'shaken', at: 2000 }, { key: 'issue_created', at: 4000 }] } }]]);
  const feed = buildFeed({ cards: next, timelines, transitions: tr });
  assert.deepEqual(feed.map((e) => `${e.rid}:${e.key}`), ['a:surgery', 'c:issue_created', 'c:shaken', 'a:shaken']);
  for (let i = 1; i < feed.length; i++) assert.ok(feed[i - 1].at >= feed[i].at);

  // the same deploy seen as card.fixedAt and as a poll transition 3 s later is one row
  const [d] = normalizeBoard([{ rid: 'd', state: 'deployed', createdAt: 1000, fixedAt: 100_000 }]);
  const dup = buildFeed({ cards: [d], transitions: transitionEvents(normalizeBoard([{ rid: 'd', state: 'deploying' }]), [d], 103_000) });
  assert.equal(dup.filter((e) => e.key === 'deployed').length, 1);
  assert.equal(buildFeed({ cards: next, limit: 1 }).length, 1);
});

test('feed: ago()', () => {
  assert.equal(ago(1000, 2000), 'just now');
  assert.equal(ago(0, 45_000), '45s ago');
  assert.equal(ago(0, 3 * MIN), '3m ago');
  assert.equal(ago(0, 3 * 60 * MIN), '3h ago');
  assert.equal(ago(0, 72 * 60 * MIN), '3d ago');
  assert.equal(ago(null), '');
});

// ---- Second Opinion ---------------------------------------------------------------------------
test('proof bars: only cases with a result, scaled to the largest, flaky kept', () => {
  const cards = normalizeBoard([
    { rid: 'a', issueIid: 1, state: 'deployed', proof: { intended: 2, unintended: 1, flaky: 1 } },
    { rid: 'b', issueIid: 2, state: 'proof', proof: { intended: 2, unintended: 0 } },
    { rid: 'c', issueIid: 3, state: 'received', proof: {} },
  ]);
  const bars = proofBars(cards);
  assert.deepEqual(bars.map((b) => b.rid), ['b', 'a']);
  const a = bars.find((b) => b.rid === 'a');
  assert.deepEqual([a.intended, a.unintended, a.flaky, a.total, a.scale], [2, 1, 1, 4, 1]);
  assert.equal(bars.find((b) => b.rid === 'b').scale, 0.5);
  assert.deepEqual(proofTotals(bars), { intended: 4, unintended: 1, flaky: 1 });
  assert.deepEqual(proofBars(null), []);
});

test('controls scorecard: missing file → null, precision / recall over finished runs', () => {
  assert.equal(controlsScore(null), null);
  assert.equal(controlsScore({ not: 'an array' }), null);
  assert.equal(controlsScore([{ kind: 'nonsense' }]), null);
  const s = controlsScore([
    { mr: 1, kind: 'planted-bad', expected: 'block', actual: 'block' },
    { mr: 2, kind: 'planted-bad', expected: 'block', actual: 'pass' },
    { mr: 3, kind: 'harmless', expected: 'pass', actual: 'passed' },
    { mr: 4, kind: 'real-fix', expected: 'pass', actual: 'blocked' },
    { mr: 5, kind: 'real-fix', expected: 'pass' },
  ]);
  assert.deepEqual([s.total, s.ran, s.pending, s.correct], [5, 4, 1, 2]);
  assert.deepEqual([s.tp, s.fn, s.fp, s.tn], [1, 1, 1, 1]);
  assert.equal(s.precision, 0.5);
  assert.equal(s.recall, 0.5);
  assert.equal(s.rows[4].actual, null);
  const perfect = controlsScore([{ mr: 9, kind: 'planted-bad', actual: 'block' }, { mr: 10, kind: 'harmless', actual: 'pass' }]);
  assert.equal(perfect.rows[0].expected, 'block'); // planted-bad defaults to block
  assert.deepEqual([perfect.precision, perfect.recall, perfect.correct], [1, 1, 2]);
});

// ---- Receipts ---------------------------------------------------------------------------------
test('receipts: discharged only, newest first, links and certificate', () => {
  const cards = normalizeBoard([
    { rid: 'r1', issueIid: 3, mrIid: 4, state: 'verified', createdAt: 0, fixedAt: 3 * MIN, humanTouches: 0, pipelineId: 77 },
    { rid: 'r2', issueIid: 5, state: 'deployed', createdAt: 10 * MIN, fixedAt: 12 * MIN, issueUrl: 'https://gl/x/-/work_items/5' },
    { rid: 'r3', issueIid: 6, state: 'proof', createdAt: 0 },
  ]);
  const rows = receipts(cards, { gitlabProjectUrl: 'https://gitlab.com/g/p/', intake: 'https://intake.example/' });
  assert.deepEqual(rows.map((r) => r.rid), ['r2', 'r1']);
  assert.equal(rows[1].shakeToLiveMs, 3 * MIN);
  assert.equal(rows[1].humanTouches, 0);
  assert.deepEqual(rows[1].links, {
    issue: 'https://gitlab.com/g/p/-/issues/3',
    mr: 'https://gitlab.com/g/p/-/merge_requests/4',
    pipeline: 'https://gitlab.com/g/p/-/pipelines/77',
  });
  assert.equal(rows[0].links.issue, 'https://gl/x/-/work_items/5');
  assert.equal(rows[0].certificate, './certificate.html?rid=r2&intake=https%3A%2F%2Fintake.example');
  assert.equal(certificateHref('r 1'), './certificate.html?rid=r+1');
  assert.deepEqual(caseLinks({ iid: 1 }), { issue: null, mr: null, pipeline: null });
});

// ---- Numbers ----------------------------------------------------------------------------------
test('numbers: tiles agree with metrics.js on the demo fixtures', () => {
  const cards = normalizeBoard(demoBoard(T0).cards);
  const n = numberTiles(cards);
  assert.equal(n.median.n, 3); // b2, b3, b1 discharged (the live card is still in triage)
  assert.equal(Math.round(n.median.ms), 168_000); // 2m 48s
  assert.deepEqual(n.handsOff, { pct: 100, n: 3, of: 3 });
  assert.deepEqual(n.unintended, { value: 1, cases: 1 });
  assert.deepEqual(n.rollbacks, { value: 1 });
  assert.equal(numberTiles([], { rollbacks: 4 }).rollbacks.value, 4);
  const touched = normalizeBoard([{ rid: 'a', state: 'deployed', humanTouches: 2 }, { rid: 'b', state: 'verified', humanTouches: 0 }]);
  assert.deepEqual(numberTiles(touched).handsOff, { pct: 50, n: 1, of: 2 });
  assert.equal(numberTiles([]).handsOff.pct, null);
});

test('numbers: series oldest first, sparkline geometry, easing', () => {
  const cards = normalizeBoard(demoBoard(T0).cards);
  const s = shakeToLiveSeries(cards);
  assert.deepEqual(s.map((p) => p.rid), ['r_demo_b2', 'r_demo_b3', 'r_demo_b1']);
  const sp = sparkline([10, 30, 20], { width: 100, height: 50, pad: 5 });
  assert.equal(sp.path, 'M5 45 L50 5 L95 25');
  assert.deepEqual([sp.min, sp.max], [10, 30]);
  assert.equal(sparkline([]).path, '');
  assert.equal(sparkline([7], { width: 100, height: 50, pad: 5 }).path, 'M50 25');
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(2), 1);
  assert.equal(tween(0, 100, 1), 100);
  assert.ok(tween(0, 100, 0.5) > 50); // eases out: fast first
});
