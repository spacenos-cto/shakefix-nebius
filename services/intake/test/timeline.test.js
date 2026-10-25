import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createGitlabClient } from '../src/gitlab.js';
import { createMemoryStore } from '../src/store/memory.js';
import { signBody } from '../src/hmac.js';
import { applyTimelineEvents, buildTimeline, formatStopwatch, isBotUser, STAGE_KEYS, timelineEventsFromHook } from '../src/timeline.js';
import { badgeMessage, badgeStats, renderBadge } from '../src/badge.js';
import { fakeGitlab, makeReplay, testConfig } from './helpers.js';

const NOW = '2026-10-11T10:00:00.000Z';
const BOTS = ['ai-shakefix-grp'];

describe('timeline events', () => {
  it('detects bots and humans', () => {
    expect(isBotUser('ai-shakefix-grp', [])).toBe(true);
    expect(isBotUser('project_12_bot_abc', [])).toBe(true);
    expect(isBotUser('shakefix-bot', [])).toBe(true);
    expect(isBotUser('venkatesh', [])).toBe(false);
    expect(isBotUser('GitLabDuo', [])).toBe(true);
    expect(isBotUser('venkatesh', ['venkatesh'])).toBe(true);
    expect(isBotUser(null, [])).toBe(true);
  });

  it('maps pushes to surgery / triage_end with commit times; bot pushes are not human touches', () => {
    const ev = timelineEventsFromHook({
      object_kind: 'push', ref: 'refs/heads/shakefix/4-settle', user_username: 'ai-shakefix-grp',
      commits: [{ timestamp: '2026-10-10T08:47:22Z', added: ['tests/regressions/issue-4.spec.ts'], modified: ['apps/splitpal/src/lib/split.js'] }],
    }, { now: NOW, botUsernames: BOTS, issueIid: 4 });
    expect(ev.filter((e) => e.type === 'stage').map((e) => e.stage).sort()).toEqual(['surgery', 'triage_end']);
    expect(ev.find((e) => e.stage === 'surgery').at).toBe('2026-10-10T08:47:22.000Z');
    expect(ev.some((e) => e.type === 'human')).toBe(false);
  });

  it('counts human approvals, merges, notes and pushes; ignores the intake\'s own notes', () => {
    const human = { username: 'maintainer' };
    const all = [
      ...timelineEventsFromHook({ object_kind: 'merge_request', user: human, object_attributes: { action: 'approved' } }, { now: NOW, botUsernames: BOTS }),
      ...timelineEventsFromHook({ object_kind: 'merge_request', user: human, object_attributes: { action: 'merge' } }, { now: NOW, botUsernames: BOTS }),
      ...timelineEventsFromHook({ object_kind: 'note', user: human, object_attributes: { id: 5, note: 'lgtm', noteable_type: 'MergeRequest' } }, { now: NOW, botUsernames: BOTS }),
      ...timelineEventsFromHook({ object_kind: 'note', user: human, object_attributes: { id: 900, note: '✅ Verified', noteable_type: 'Issue' } }, { now: NOW, botUsernames: BOTS, intakeNoteIds: [900] }),
    ];
    expect(all.filter((e) => e.type === 'human').map((e) => e.kind)).toEqual(['approval', 'merge', 'note']);
    expect(all.find((e) => e.stage === 'merged')).toBeTruthy();
  });

  it('reads the Second Opinion card and the Attending JSON from bot notes', () => {
    const so = timelineEventsFromHook({
      object_kind: 'note', user: { username: 'shakefix-bot' },
      object_attributes: { id: 1, noteable_type: 'MergeRequest', note: '### 🩺 Second Opinion — Behavior Diff (main ⟷ !1)\n**2 changes · 2 intended · 0 unintended** → ✅ ready' },
    }, { now: NOW, botUsernames: BOTS });
    expect(so.find((e) => e.stage === 'second_opinion')).toBeTruthy();
    expect(so.find((e) => e.type === 'proof')).toMatchObject({ intended: 2, unintended: 0 });
    const att = timelineEventsFromHook({
      object_kind: 'note', user: { username: 'ai-shakefix-grp' },
      object_attributes: { id: 2, noteable_type: 'MergeRequest', note: '{"approve":true,"confidence":0.9}' },
    }, { now: NOW, botUsernames: BOTS });
    expect(att[0]).toMatchObject({ stage: 'review' });
  });

  it('human label edits right after an intake call are automation, later ones are touches', () => {
    const payload = { object_kind: 'issue', user: { username: 'maintainer' }, object_attributes: { action: 'update' }, changes: { labels: { previous: [], current: [{ title: 'needs-human' }] } } };
    expect(timelineEventsFromHook(payload, { now: NOW, botUsernames: BOTS, lastAutomationAt: '2026-10-11T09:59:30.000Z' }).filter((e) => e.type === 'human')).toEqual([]);
    expect(timelineEventsFromHook(payload, { now: NOW, botUsernames: BOTS, lastAutomationAt: '2026-10-11T09:50:00.000Z' }).filter((e) => e.type === 'human')).toHaveLength(1);
  });

  it('keeps the first time per stage and builds the stopwatch', () => {
    let rec = { rid: 'r_20261011_aaaaaa', issueIid: 4, state: 'verified', stages: { shaken: '2026-10-11T09:00:00.000Z' } };
    rec = { ...rec, ...applyTimelineEvents(rec, [
      { type: 'stage', stage: 'surgery', at: '2026-10-11T09:05:00.000Z' },
      { type: 'stage', stage: 'surgery', at: '2026-10-11T09:06:00.000Z' },
      { type: 'stage', stage: 'verified', at: '2026-10-11T09:11:42.000Z' },
      { type: 'human', kind: 'approval', at: '2026-10-11T09:08:00.000Z' },
    ]) };
    expect(rec.stages.surgery).toBe('2026-10-11T09:05:00.000Z');
    const tl = buildTimeline(rec, { now: NOW });
    expect(tl.stages.map((s) => s.key)).toEqual(STAGE_KEYS);
    expect(tl.elapsedMs).toBe(11 * 60_000 + 42_000);
    expect(tl.running).toBe(false);
    expect(tl.humanTouches).toBe(1);
    expect(tl.stopwatch).toBe('shake → 👍 11m 42s · Human touches: 1');
    expect(JSON.stringify(tl)).not.toContain('maintainer');
    expect(formatStopwatch(5000)).toBe('5s');
    expect(formatStopwatch(null)).toBe('—');
  });
});

describe('badge', () => {
  it('counts discharged cases and the 👍 share', () => {
    const recs = [
      { state: 'verified', v: 'confirmed' }, { state: 'deployed', v: null }, { state: 'proof', v: null }, { state: 'reopened', v: 'rejected' },
    ];
    const s = badgeStats(recs, (r) => r.v);
    expect(s).toEqual({ discharged: 2, confirmed: 1, rejected: 1, confirmedPct: 50 });
    expect(badgeMessage(s)).toBe('Discharged 2 · 👍 50%');
    expect(badgeMessage(badgeStats([], () => null))).toBe('Discharged 0 · 👍 —');
    const svg = renderBadge({ message: '<x>' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('&lt;x&gt;');
  });
});

describe('intake timeline routes', () => {
  function setup() {
    const config = testConfig();
    const fg = fakeGitlab();
    const gitlab = createGitlabClient({ baseUrl: config.gitlabUrl, projectId: config.projectId, token: config.humanPat, fetch: fg.fetch });
    const store = createMemoryStore();
    let t = Date.parse('2026-10-11T09:00:00.000Z');
    const now = () => t;
    const app = buildApp({ config, gitlab, store, pusher: { mode: 'poll', send: async () => ({ ok: false }) }, now });
    return { app, store, advance: (ms) => { t += ms; } };
  }
  const hook = (app, payload) => app.inject({ method: 'POST', url: '/v1/hooks/gitlab', headers: { 'content-type': 'application/json', 'x-gitlab-token': 'wh-secret' }, payload });

  it('records stages from report → push → MR → fixed → 👍 and serves a public timeline + badge', async () => {
    const { app, advance } = setup();
    const rid = 'r_20261011_8f3a01';
    await app.inject({ method: 'POST', url: '/v1/reports', headers: { 'content-type': 'application/json', origin: 'https://splitpal.example.run.app' }, payload: { replay: makeReplay() } });
    advance(60_000);
    await hook(app, { object_kind: 'push', ref: 'refs/heads/shakefix/41-settle', user_username: 'ai-shakefix-grp', commits: [{ timestamp: '2026-10-11T09:01:00Z', added: ['tests/regressions/issue-41.spec.ts'] }] });
    advance(30_000);
    await hook(app, { object_kind: 'merge_request', user: { username: 'ai-shakefix-grp' }, object_attributes: { iid: 42, action: 'open', source_branch: 'shakefix/41-settle' }, labels: [] });
    await hook(app, { object_kind: 'merge_request', user: { username: 'maintainer' }, object_attributes: { iid: 42, action: 'approved', source_branch: 'shakefix/41-settle' }, labels: [] });
    advance(60_000);
    const raw = JSON.stringify({ mrIid: 42, cost: { usd: 0.38, source: 'model + CI' } });
    await app.inject({ method: 'POST', url: `/v1/reports/${rid}/fixed`, headers: { 'content-type': 'application/json', 'x-shakefix-signature': signBody('hook-secret', raw) }, payload: raw });
    advance(42_000);
    await app.inject({ method: 'POST', url: `/v1/reports/${rid}/verdict`, headers: { 'content-type': 'application/json', origin: 'https://splitpal.example.run.app' }, payload: { verdict: 'confirmed', deviceId: 'device_12345678' } });

    const res = await app.inject({ method: 'GET', url: `/v1/reports/${rid}/timeline`, headers: { origin: 'https://someone.gitlab.io' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const tl = res.json();
    const at = Object.fromEntries(tl.stages.map((s) => [s.key, s.at]));
    expect(at.shaken).toBe('2026-10-11T09:00:00.000Z');
    expect(at.issue_created).toBeTruthy();
    expect(at.triage_end).toBe('2026-10-11T09:01:00.000Z');
    expect(at.mr_opened).toBeTruthy();
    expect(at.deployed).toBe('2026-10-11T09:02:30.000Z');
    expect(at.verified).toBe('2026-10-11T09:03:12.000Z');
    expect(tl.humanTouches).toBe(1);
    expect(tl.cost).toEqual({ usd: 0.38, source: 'model + CI' });
    expect(tl.stopwatch).toBe('shake → 👍 3m 12s · Human touches: 1 · $0.38');

    const badge = await app.inject({ method: 'GET', url: '/v1/badge.svg', headers: { origin: 'https://gitlab.com' } });
    expect(badge.headers['content-type']).toContain('image/svg+xml');
    expect(badge.body).toContain('Discharged 1 · 👍 100%');
    expect((await app.inject({ method: 'GET', url: '/v1/reports/nope/timeline' })).statusCode).toBe(400);
  });
});

describe('composite identity: flow edits right after it opens the MR', () => {
  const mr = (now, created) => ({
    object_kind: 'merge_request',
    user: { username: 'cto.spacenos' },
    object_attributes: { action: 'update', created_at: created, iid: 3 },
    changes: { labels: { previous: [], current: [{ title: 'shakefix::proof' }] } },
  });
  it('an edit within the automation window of the MR opening is not a human touch', () => {
    const ev = timelineEventsFromHook(mr('2026-10-10T20:36:14.000Z', '2026-10-10T20:36:10.000Z'), { now: '2026-10-10T20:36:14.000Z' });
    expect(ev.filter((e) => e.type === 'human')).toEqual([]);
  });
  it('a later edit by a person still counts', () => {
    const ev = timelineEventsFromHook(mr('2026-10-10T21:00:00.000Z', '2026-10-10T20:36:10.000Z'), { now: '2026-10-10T21:00:00.000Z' });
    expect(ev.filter((e) => e.type === 'human').map((e) => e.kind)).toEqual(['edit']);
  });
});

describe('intake note marker', () => {
  it('a note carrying the intake marker is never a human touch, even before its id is stored', async () => {
    const { timelineEventsFromHook, INTAKE_NOTE_MARKER } = await import('../src/timeline.js');
    const hook = {
      object_kind: 'note',
      user: { username: 'maintainer' },
      issue: { iid: 14 },
      object_attributes: { id: 999, noteable_type: 'Issue', note: `👍 Reporter confirmed\n\n${INTAKE_NOTE_MARKER}`, created_at: '2026-10-12T08:47:31Z' },
    };
    const events = timelineEventsFromHook(hook, { now: '2026-10-12T08:47:32Z', issueIid: 14, intakeNoteIds: [] });
    expect(events.filter((e) => e.type === 'human')).toEqual([]);
  });
});
