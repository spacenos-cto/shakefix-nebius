// Reporter verdict loop ("patient's verdict", BUILD_SPEC §17.5): POST /v1/reports/:rid/verdict.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createGitlabClient } from '../src/gitlab.js';
import { signBody } from '../src/hmac.js';
import { createMemoryStore } from '../src/store/memory.js';
import { fakeGitlab, makeReplay, testConfig } from './helpers.js';

const ORIGIN = 'https://splitpal.example.run.app';
const RID = 'r_20261011_8f3a01';
const DUP = 'r_20261011_bbbbbb';
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'k', auth: 'a' } };

function setup({ config: over = {} } = {}) {
  const config = testConfig(over);
  const fg = fakeGitlab();
  const gitlab = createGitlabClient({ baseUrl: config.gitlabUrl, projectId: config.projectId, token: config.humanPat, fetch: fg.fetch });
  const store = createMemoryStore();
  const sent = [];
  const pusher = { mode: 'webpush', send: async (sub, payload) => (sent.push({ sub, payload }), { ok: true }) };
  const app = buildApp({ config, gitlab, store, pusher });
  return { app, fg, store, sent, config };
}

const post = (app, url, body, headers = {}) =>
  app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, payload: body });

const signed = (app, url, body) => {
  const raw = JSON.stringify(body);
  return app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', 'x-shakefix-signature': signBody('hook-secret', raw) }, payload: raw });
};

const verdict = (app, rid, body, headers) => post(app, `/v1/reports/${rid}/verdict`, body, headers);
const fixed = (app, rid = RID) => signed(app, `/v1/reports/${rid}/fixed`, { url: '/bill/7', mrIid: 42, proof: { intended: 2, unintended: 0 } });
const board = async (app) => (await app.inject({ method: 'GET', url: '/v1/board' })).json().items[0];
const notesOf = (fg) => fg.calls.filter((c) => c.method === 'POST' && /\/issues\/41\/notes$/.test(c.path)).map((c) => untag(c.body.body));
// Every intake note ends with the hidden marker (src/gitlab.js); compare the visible text.
const untag = (b) => String(b).replace(/\n\n<!-- shakefix:intake-note -->$/, '');

const freshReplay = (over = {}) =>
  makeReplay({
    rid: 'r_20261012_c0ffee',
    note: 'Still broken after fix — call me at +1 415 555 0100',
    actions: [{ t: 0, type: 'click', testid: 'settle-btn', selector: '[data-testid=settle-btn]', route: '/bill/7' }],
    ...over,
  });

async function reported(opts) {
  const ctx = setup(opts);
  const r = await post(ctx.app, '/v1/reports', { replay: makeReplay(), pushSubscription: SUB, deviceId: 'dev_reporter_0001' });
  expect(r.statusCode).toBe(201);
  return ctx;
}

async function deployed(opts) {
  const ctx = await reported(opts);
  expect((await fixed(ctx.app)).statusCode).toBe(200);
  ctx.fg.calls.length = 0;
  return ctx;
}

describe('POST /v1/reports/:rid/verdict — validation and guards', () => {
  it('rejects bad rids, unknown rids and invalid bodies', async () => {
    const { app } = await reported();
    expect((await verdict(app, 'nope', { verdict: 'confirmed' })).statusCode).toBe(400);
    expect((await verdict(app, 'r_20261011_ffffff', { verdict: 'confirmed' })).statusCode).toBe(404);
    const bad = await verdict(app, RID, { verdict: 'meh' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_verdict');
    const noReplay = await verdict(app, RID, { verdict: 'rejected' });
    expect(noReplay.statusCode).toBe(400);
    expect(noReplay.json().issues).toEqual([{ path: 'replay', message: 'replay is required when verdict is rejected' }]);
    expect((await verdict(app, RID, { verdict: 'confirmed', deviceId: 'x y' })).statusCode).toBe(400);
  });

  it('409 until the fix is deployed', async () => {
    const { app, fg } = await reported();
    const before = fg.calls.length;
    const res = await verdict(app, RID, { verdict: 'confirmed' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_fixed', state: 'received' });
    expect(fg.calls.length).toBe(before);
  });

  it('enforces the CORS allowlist', async () => {
    const { app } = await deployed();
    expect((await verdict(app, RID, { verdict: 'confirmed' }, { origin: 'https://evil.test' })).statusCode).toBe(403);
    const pre = await app.inject({ method: 'OPTIONS', url: `/v1/reports/${RID}/verdict`, headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(pre.headers['access-control-allow-methods']).toContain('POST');
    const evilPre = await app.inject({ method: 'OPTIONS', url: `/v1/reports/${RID}/verdict`, headers: { origin: 'https://evil.test' } });
    expect(evilPre.statusCode).toBe(403);
  });

  it('is rate limited per IP (separately from reports)', async () => {
    const { app } = setup();
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await verdict(app, RID, { verdict: 'confirmed' })).statusCode);
    expect(codes.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(codes[5]).toBe(429);
    // the report bucket is untouched
    expect((await post(app, '/v1/reports', { replay: makeReplay() })).statusCode).toBe(201);
  });
});

describe('verdict: confirmed', () => {
  it('notes the issue, adds shakefix::verified, marks verified with verifiedAt', async () => {
    const { app, fg, store } = await deployed();
    const res = await verdict(app, RID, { verdict: 'confirmed', deviceId: 'dev_reporter_0001' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, rid: RID, verdict: 'confirmed', state: 'verified' });

    expect(notesOf(fg)).toEqual(['✅ Verified by the reporter — the patient confirms the fix.']);
    const put = fg.calls.find((c) => c.method === 'PUT');
    expect(put.path).toBe('/projects/grp%2Fshakefix/issues/41');
    expect(put.body).toEqual({ add_labels: 'shakefix::verified' });
    expect(fg.issues[0].labels).toContain('shakefix::verified');

    const rec = await store.get(RID);
    expect(rec.state).toBe('verified');
    expect(rec.verifiedAt).toEqual(expect.any(String));
    expect(rec.timestamps.verified).toEqual(expect.any(String));

    const st = (await app.inject({ method: 'GET', url: `/v1/reports/${RID}/status` })).json();
    expect(st).toMatchObject({ state: 'verified', verdict: 'confirmed' });

    const item = await board(app);
    expect(item).toMatchObject({ state: 'verified', verdict: 'confirmed', verdicts: { confirmed: 1, rejected: 0 } });
    expect(item.timestamps.verifiedAt).toBe(rec.verifiedAt);
  });

  it('is idempotent per device id (duplicates ignored, no extra GitLab calls)', async () => {
    const { app, fg } = await deployed();
    await verdict(app, RID, { verdict: 'confirmed', deviceId: 'dev_reporter_0001' });
    const n = fg.calls.length;
    const again = await verdict(app, RID, { verdict: 'confirmed', deviceId: 'dev_reporter_0001' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ ok: true, duplicate: true, state: 'verified' });
    // the same device cannot flip its vote either
    const flip = await verdict(app, RID, { verdict: 'rejected', deviceId: 'dev_reporter_0001', replay: freshReplay() });
    expect(flip.json()).toMatchObject({ duplicate: true });
    expect(fg.calls.length).toBe(n);
    expect((await board(app)).verdicts).toEqual({ confirmed: 1, rejected: 0 });
  });

  it('without a device id, one verdict per reporter rid', async () => {
    const { app, fg } = await deployed();
    expect((await verdict(app, RID, { verdict: 'confirmed' })).json()).toMatchObject({ verdict: 'confirmed' });
    expect((await verdict(app, RID, { verdict: 'confirmed' })).json()).toMatchObject({ duplicate: true });
    expect(notesOf(fg)).toHaveLength(1);
  });

  it('a second device confirming is counted but does not re-note', async () => {
    const { app, fg } = await deployed();
    await verdict(app, RID, { verdict: 'confirmed', deviceId: 'dev_reporter_0001' });
    const res = await verdict(app, RID, { verdict: 'confirmed', deviceId: 'dev_other_00002' });
    expect(res.json()).toMatchObject({ ok: true, state: 'verified' });
    expect(notesOf(fg)).toHaveLength(1);
    expect((await board(app)).verdicts).toEqual({ confirmed: 2, rejected: 0 });
  });

  it('a duplicate reporter verdict acts on the primary issue', async () => {
    const ctx = await reported();
    await post(ctx.app, '/v1/reports', { replay: makeReplay({ rid: DUP }), pushSubscription: { ...SUB, endpoint: 'https://push.test/2' } });
    await fixed(ctx.app);
    const res = await verdict(ctx.app, DUP, { verdict: 'confirmed' });
    expect(res.json()).toMatchObject({ rid: DUP, state: 'verified' });
    expect(notesOf(ctx.fg).at(-1)).toContain('Verified by the reporter');
    expect((await ctx.store.get(RID)).state).toBe('verified');
    expect((await board(ctx.app)).verdict).toBe('confirmed');
  });
});

describe('verdict: rejected', () => {
  it('commits replay-2, reopens, relabels, notes with the replay inline and re-triggers the flow', async () => {
    const { app, fg, store } = await deployed();
    const res = await verdict(app, RID, { verdict: 'rejected', deviceId: 'dev_reporter_0001', replay: freshReplay() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true, rid: RID, verdict: 'rejected', state: 'reopened', replayPath: `reports/${RID}/replay-2.json`, retriggered: true,
    });

    const seq = fg.calls.map((c) => `${c.method} ${c.path.replace('grp%2Fshakefix', ':id')}`);
    expect(seq).toEqual([ // default branch is cached from the first report
      'POST /projects/:id/repository/commits',
      'PUT /projects/:id/issues/41',
      'POST /projects/:id/issues/41/notes',
      'POST /projects/:id/issues/41/notes',
    ]);

    const commit = fg.calls[0].body;
    expect(commit.branch).toBe('main');
    expect(commit.commit_message).toBe(`chore(report): ${RID} replay-2, reporter says still broken [skip ci]`);
    expect(commit.actions[0]).toMatchObject({ action: 'create', file_path: `reports/${RID}/replay-2.json` });
    const committed = JSON.parse(commit.actions[0].content);
    expect(committed.rid).toBe(RID); // re-keyed to the original report
    expect(committed.note).not.toContain('555 0100'); // scrubbed

    const put = fg.calls[1].body;
    expect(put.state_event).toBe('reopen');
    expect(put.add_labels).toBe('shakefix::reopened');
    expect(put.remove_labels.split(',')).toEqual(expect.arrayContaining(['shakefix::deployed', 'shakefix::verified', 'shakefix::proof']));
    expect(fg.issues[0].state).toBe('opened');

    const [note, mention] = notesOf(fg);
    expect(note.startsWith("👎 The reporter says it's still broken — new replay attached; back to triage.")).toBe(true);
    expect(note).toContain(`### Replay (also at \`reports/${RID}/replay-2.json\`)`);
    expect(note).toContain('```json');
    expect(note).toContain('"rid": "r_20261011_8f3a01"');
    expect(untag(mention)).toBe('@ai-shakefix-grp re-triage: reporter rejected the fix, see latest replay');
    expect(fg.calls[3].headers['PRIVATE-TOKEN']).toBe('glpat-test-not-real'); // HUMAN PAT, so the trigger fires

    const rec = await store.get(RID);
    expect(rec).toMatchObject({ state: 'reopened', replayCount: 2, rejections: 1 });
    expect(rec.timestamps.reopened).toEqual(expect.any(String));
    const item = await board(app);
    expect(item).toMatchObject({ state: 'reopened', verdict: 'rejected', verdicts: { confirmed: 0, rejected: 1 } });
  });

  it('honours REPORTS_REF and skips the mention when FLOW_SERVICE_ACCOUNT is unset', async () => {
    const { app, fg } = await deployed({ config: { reportsRef: 'reports', flowServiceAccount: '' } });
    const res = await verdict(app, RID, { verdict: 'rejected', replay: freshReplay() });
    expect(res.json()).toMatchObject({ retriggered: false });
    expect(fg.calls.find((c) => c.path.endsWith('/repository/commits')).body.branch).toBe('reports');
    expect(notesOf(fg)).toHaveLength(1);
  });

  it('a second rejection waits for the next fix; the next round accepts a new verdict', async () => {
    const { app, store, sent } = await deployed();
    await verdict(app, RID, { verdict: 'rejected', deviceId: 'dev_reporter_0001', replay: freshReplay() });
    expect((await verdict(app, RID, { verdict: 'rejected', deviceId: 'dev_other_00002', replay: freshReplay() })).statusCode).toBe(409);

    // the flow fixes it again; CI notifies again → round 2
    sent.length = 0;
    await fixed(app);
    expect((await store.get(RID)).fixRound).toBe(2);
    expect(sent[0].payload).toMatchObject({ kind: 'fixed', rid: RID, deviceId: 'dev_reporter_0001' });
    expect((await board(app)).verdict).toBeNull();

    const second = await verdict(app, RID, { verdict: 'rejected', deviceId: 'dev_reporter_0001', replay: freshReplay() });
    expect(second.json()).toMatchObject({ state: 'reopened', replayPath: `reports/${RID}/replay-3.json` });
    expect((await board(app)).verdicts).toEqual({ confirmed: 0, rejected: 2 });
  });

  it('a retried CI notify does not open a new verdict round', async () => {
    const { app, store } = await deployed();
    await fixed(app);
    expect((await store.get(RID)).fixRound).toBe(1);
  });

  it('webhook maps the verdict labels to states', async () => {
    const { app } = await deployed();
    const hook = (labels, action = 'update') =>
      app.inject({
        method: 'POST',
        url: '/v1/hooks/gitlab',
        headers: { 'content-type': 'application/json', 'x-gitlab-token': 'wh-secret' },
        payload: {
          object_kind: 'issue',
          object_attributes: { iid: 41, action, title: 'T', description: `<!-- shakefix:rid=${RID} -->` },
          labels: labels.map((title) => ({ title })),
        },
      });
    expect((await hook(['shakefix', 'shakefix::deployed', 'shakefix::verified'])).json()).toMatchObject({ state: 'verified' });
    expect((await hook(['shakefix', 'shakefix::reopened'], 'reopen')).json()).toMatchObject({ state: 'reopened' });
    expect((await hook(['shakefix', 'shakefix::reopened', 'shakefix::triaging'])).json()).toMatchObject({ state: 'triaging' });
  });
});
