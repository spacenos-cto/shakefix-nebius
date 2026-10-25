import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createGitlabClient } from '../src/gitlab.js';
import { signBody } from '../src/hmac.js';
import { createMemoryStore } from '../src/store/memory.js';
import { fakeGitlab, makeReplay, PNG_B64, testConfig } from './helpers.js';

const ORIGIN = 'https://splitpal.example.run.app';
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'k', auth: 'a' } };

const healthy = async () => ({ ok: true, status: 200 });

function setup({ config: over = {}, openIssues = [], fetchImpl = healthy, labelEvents = [] } = {}) {
  const config = testConfig(over);
  const fg = fakeGitlab({ openIssues, labelEvents });
  const gitlab = createGitlabClient({ baseUrl: config.gitlabUrl, projectId: config.projectId, token: config.humanPat, fetch: fg.fetch });
  const store = createMemoryStore();
  const sent = [];
  const pusher = { mode: 'webpush', send: async (sub, payload) => (sent.push({ sub, payload }), { ok: true }) };
  const app = buildApp({ config, gitlab, store, pusher, fetchImpl });
  return { app, fg, store, sent, config };
}

const report = (app, body, headers = {}) =>
  app.inject({ method: 'POST', url: '/v1/reports', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, payload: body });

const signed = (app, url, body, secret = 'hook-secret') => {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', 'x-shakefix-signature': signBody(secret, raw) },
    payload: raw,
  });
};

describe('POST /v1/reports', () => {
  it('commits replay, uploads screenshot, creates issue, stores record', async () => {
    const { app, fg, store } = setup();
    const res = await report(app, { replay: makeReplay(), screenshotPng: `data:image/png;base64,${PNG_B64}`, pushSubscription: SUB });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ rid: 'r_20261011_8f3a01', issueIid: 41, duplicate: false, issueUrl: expect.stringContaining('/issues/41') });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);

    const paths = fg.calls.map((c) => `${c.method} ${c.path.replace('grp%2Fshakefix', ':id')}`);
    expect(paths).toEqual([
      'GET /projects/:id/issues',
      'GET /projects/:id',
      'POST /projects/:id/repository/commits',
      'POST /projects/:id/uploads',
      'POST /projects/:id/issues',
    ]);

    const commit = fg.calls[2].body;
    expect(commit.branch).toBe('main');
    expect(commit.commit_message).toBe('chore(report): r_20261011_8f3a01 [skip ci]');
    expect(commit.actions[0].file_path).toBe('reports/r_20261011_8f3a01/replay.json');
    const committed = JSON.parse(commit.actions[0].content);
    expect(committed.actions[1].value).toBe('Dinner with [email]'); // allowlisted title-input, PII scrubbed
    expect(committed.actions[2].value).toBe('1000'); // allowlisted total-input

    const issue = fg.calls[4].body;
    expect(issue.title).toBe('🩺 [shake] settle button does nothing (/bill/7)');
    expect(issue.labels).toMatch(/^shakefix,sev::2,dup::[0-9a-f]{8}$/);
    expect(issue.description.startsWith('<!-- shakefix:rid=r_20261011_8f3a01 -->')).toBe(true);
    expect(issue.description).toContain('![shot](/uploads/x/shot.png)');
    expect(issue.description).not.toContain('bob@example.com');

    const rec = await store.get('r_20261011_8f3a01');
    expect(rec).toMatchObject({ issueIid: 41, state: 'received', primary: true, sev: 2 });
    expect(rec.subscriptions).toHaveLength(1);
  });

  it('honours REPORTS_REF', async () => {
    const { app, fg } = setup({ config: { reportsRef: 'reports' } });
    await report(app, { replay: makeReplay() });
    const commit = fg.calls.find((c) => c.path.endsWith('/repository/commits'));
    expect(commit.body.branch).toBe('reports');
    expect(fg.calls.some((c) => c.method === 'GET' && c.path === '/projects/grp%2Fshakefix')).toBe(false);
  });

  it('dedupes onto an open issue with the same dup:: label', async () => {
    const { app, fg, store } = setup();
    await report(app, { replay: makeReplay() });
    const hash = fg.issues[0].labels.find((l) => l.startsWith('dup::'));
    const res = await report(app, { replay: makeReplay({ rid: 'r_20261011_aaaaaa', note: 'same thing' }), pushSubscription: SUB });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ rid: 'r_20261011_aaaaaa', issueIid: 41, duplicate: true });
    const note = fg.calls.at(-1);
    expect(note.path).toBe('/projects/grp%2Fshakefix/issues/41/notes');
    expect(note.body.body).toContain('+1 reporter');
    expect(fg.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/issues'))).toHaveLength(1);
    expect(hash).toMatch(/^dup::[0-9a-f]{8}$/);
    expect(await store.get('r_20261011_aaaaaa')).toMatchObject({ primary: false, duplicateOf: 'r_20261011_8f3a01' });
  });

  it('rejects invalid replays with 400 and no GitLab calls', async () => {
    const { app, fg } = setup();
    const res = await report(app, { replay: { ...makeReplay(), schema: 'nope' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_report');
    expect(fg.calls).toHaveLength(0);
  });

  it('rejects bodies over the size cap with 413', async () => {
    const { app } = setup({ config: { maxBodyBytes: 1024 } });
    const res = await report(app, { replay: makeReplay({ note: 'x'.repeat(2000) }) });
    expect(res.statusCode).toBe(413);
  });

  it('rate limits 5/min per IP', async () => {
    const { app } = setup();
    const codes = [];
    for (let i = 0; i < 6; i++) {
      const rid = `r_20261011_00000${i}`;
      codes.push((await report(app, { replay: makeReplay({ rid, note: `n${i}`, console: [{ level: 'error', msg: `e${i}` }] }) })).statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 201 || c === 200)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it('rejects disallowed origins', async () => {
    const { app } = setup();
    const res = await report(app, { replay: makeReplay() }, { origin: 'https://evil.test' });
    expect(res.statusCode).toBe(403);
    const pre = await app.inject({ method: 'OPTIONS', url: '/v1/reports', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('START_MODE=api starts the flow via the Duo workflows API', async () => {
    const { app, fg } = setup({ config: { startMode: 'api', flowDefinition: 'shakefix' } });
    await report(app, { replay: makeReplay() });
    const call = fg.calls.find((c) => c.path === '/ai/duo_workflows/workflows');
    expect(call.body).toEqual({ project_id: 'grp/shakefix', goal: 'ShakeFix: fix issue #41', workflow_definition: 'shakefix' });
  });

  it('returns 502 when GitLab fails', async () => {
    const config = testConfig();
    const fg = fakeGitlab({ failOn: (m, p) => m === 'POST' && p.endsWith('/issues') });
    const gitlab = createGitlabClient({ baseUrl: config.gitlabUrl, projectId: config.projectId, token: config.humanPat, fetch: fg.fetch });
    const app = buildApp({ config, gitlab, store: createMemoryStore(), pusher: { mode: 'poll', send: async () => ({}) } });
    const res = await report(app, { replay: makeReplay() });
    expect(res.statusCode).toBe(502);
  });
});

describe('status, fixed, reoperate, hooks, board', () => {
  async function withIssue(opts) {
    const ctx = setup(opts);
    await report(ctx.app, { replay: makeReplay(), pushSubscription: SUB });
    return ctx;
  }

  it('GET status', async () => {
    const { app } = await withIssue();
    const res = await app.inject({ method: 'GET', url: '/v1/reports/r_20261011_8f3a01/status', headers: { origin: ORIGIN } });
    expect(res.json()).toMatchObject({ rid: 'r_20261011_8f3a01', state: 'received', issueIid: 41 });
    expect((await app.inject({ method: 'GET', url: '/v1/reports/bad/status' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/reports/r_20261011_ffffff/status' })).statusCode).toBe(404);
  });

  it('POST fixed requires HMAC, marks deployed and pushes to all reporters', async () => {
    const { app, sent, fg } = await withIssue();
    // a duplicate reporter with its own subscription
    await report(app, { replay: makeReplay({ rid: 'r_20261011_bbbbbb' }), pushSubscription: { ...SUB, endpoint: 'https://push.test/2' } });

    const bad = await signed(app, '/v1/reports/r_20261011_8f3a01/fixed', { url: '/bill/7' }, 'wrong');
    expect(bad.statusCode).toBe(401);

    const res = await signed(app, '/v1/reports/r_20261011_8f3a01/fixed', { url: '/bill/7', mrIid: 42, proof: { intended: 1, unintended: 0 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, state: 'deployed', notified: 2 });
    expect(sent[0].payload).toEqual({
      title: 'Fixed ✓',
      body: 'The bug you reported is gone. Pull to refresh.',
      url: '/bill/7',
      kind: 'fixed',
      rid: 'r_20261011_8f3a01',
      tag: 'shakefix-r_20261011_8f3a01',
      verdictUrl: 'https://intake.test/v1/reports/r_20261011_8f3a01/verdict',
    });
    expect(sent[1].payload.verdictUrl).toBe('https://intake.test/v1/reports/r_20261011_bbbbbb/verdict');
    const st = await app.inject({ method: 'GET', url: '/v1/reports/r_20261011_bbbbbb/status' });
    expect(st.json().state).toBe('deployed');
    expect(fg.calls.length).toBeGreaterThan(0);
  });

  it('POST fixed with an empty signed body works', async () => {
    const { app } = await withIssue();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reports/r_20261011_8f3a01/fixed',
      headers: { 'x-shakefix-signature': signBody('hook-secret', '') },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST reoperate posts the mention with the human PAT, once', async () => {
    const { app, fg } = await withIssue();
    const res = await signed(app, '/v1/reports/r_20261011_8f3a01/reoperate', { mr: 42, proof: { intended: 1, unintended: 1 } });
    expect(res.statusCode).toBe(200);
    const note = fg.calls.at(-1);
    expect(note.path).toBe('/projects/grp%2Fshakefix/issues/41/notes');
    expect(note.headers['PRIVATE-TOKEN']).toBe('glpat-test-not-real');
    expect(note.body.body).toBe('@ai-shakefix-grp re-operate: Second Opinion found unintended changes on !42. See report.\n\n<!-- shakefix:intake-note -->');

    const again = await signed(app, '/v1/reports/r_20261011_8f3a01/reoperate', { mr: 42 });
    expect(again.statusCode).toBe(409);
  });

  it('POST reoperate rejects unsigned and invalid bodies', async () => {
    const { app } = await withIssue();
    const unsigned = await app.inject({ method: 'POST', url: '/v1/reports/r_20261011_8f3a01/reoperate', headers: { 'content-type': 'application/json' }, payload: '{"mr":42}' });
    expect(unsigned.statusCode).toBe(401);
    expect((await signed(app, '/v1/reports/r_20261011_8f3a01/reoperate', { mr: 'x' })).statusCode).toBe(400);
  });

  it('POST reoperate accepts {mrIid} as sent by scripts/ci/proof-gate.sh', async () => {
    const { app } = await withIssue();
    const res = await signed(app, '/v1/reports/r_20261011_8f3a01/reoperate', { mrIid: 42 });
    expect(res.statusCode).toBe(200);
  });

  it('webhook verifies token and maps labels/MRs to states', async () => {
    const { app } = await withIssue();
    const hook = (payload, token = 'wh-secret') =>
      app.inject({ method: 'POST', url: '/v1/hooks/gitlab', headers: { 'content-type': 'application/json', 'x-gitlab-token': token }, payload });

    expect((await hook({ object_kind: 'issue' }, 'nope')).statusCode).toBe(401);

    await hook({
      object_kind: 'issue',
      object_attributes: { iid: 41, action: 'update', title: 'T', description: '<!-- shakefix:rid=r_20261011_8f3a01 -->' },
      labels: [{ title: 'shakefix' }, { title: 'shakefix::triaging' }],
    });
    let st = await app.inject({ method: 'GET', url: '/v1/reports/r_20261011_8f3a01/status' });
    expect(st.json().state).toBe('triaging');

    const r = await hook({ object_kind: 'merge_request', object_attributes: { iid: 42, action: 'open', source_branch: 'shakefix/41-settle' }, labels: [] });
    expect(r.json()).toMatchObject({ ok: true, state: 'in-surgery' });
    st = await app.inject({ method: 'GET', url: '/v1/reports/r_20261011_8f3a01/status' });
    expect(st.json()).toMatchObject({ state: 'in-surgery', mrIid: 42 });

    expect((await hook({ object_kind: 'push' })).json()).toEqual({ ok: true, ignored: true });
  });

  it('webhook recovers an unknown record from the issue marker', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/v1/hooks/gitlab',
      headers: { 'content-type': 'application/json', 'x-gitlab-token': 'wh-secret' },
      payload: {
        object_kind: 'issue',
        object_attributes: { iid: 9, action: 'update', title: 'X', description: '<!-- shakefix:rid=r_20261011_cccccc -->' },
        labels: [{ title: 'shakefix' }, { title: 'sev::1' }, { title: 'shakefix::proof' }],
      },
    });
    const board = (await app.inject({ method: 'GET', url: '/v1/board' })).json();
    expect(board.items[0]).toMatchObject({ rid: 'r_20261011_cccccc', issueIid: 9, sev: 1, state: 'proof' });
  });

  it('GET board is public and has no PII', async () => {
    const { app } = await withIssue();
    const res = await app.inject({ method: 'GET', url: '/v1/board', headers: { origin: 'https://anyone.gitlab.io' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const item = res.json().items[0];
    expect(Object.keys(item).sort()).toEqual(['humanTouches', 'issueIid', 'mrIid', 'proof', 'rid', 'sev', 'state', 'timestamps', 'title', 'verdict', 'verdicts']);
    expect(item.proof).toEqual({ intended: null, unintended: null });
    expect(item.verdict).toBeNull();
    expect(item.verdicts).toEqual({ confirmed: 0, rejected: 0 });
    expect(JSON.stringify(res.json())).not.toContain('fcm.googleapis.com');
  });

  it('healthz and vapid key', async () => {
    const { app } = setup({ config: { vapidPublicKey: 'BPub', pushMode: 'webpush' } });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/v1/vapid-public-key' })).json()).toEqual({ publicKey: 'BPub', pushMode: 'webpush' });
  });
});

describe('infra triage on POST /v1/reports', () => {
  it('a failing health check labels the issue infra::suspected + needs-human and pages the on-call', async () => {
    const pages = [];
    const fetchImpl = async (url, init) => {
      if (String(url).endsWith('/api/health')) return { ok: false, status: 503 };
      pages.push({ url, init });
      return { ok: true, status: 200 };
    };
    const { app, fg, store } = setup({ fetchImpl, config: { pagerWebhookUrl: 'https://ntfy.sh/shakefix-oncall', maintainer: 'oncall' } });
    const res = await report(app, { replay: makeReplay() });
    expect(res.statusCode).toBe(201);
    const issue = fg.calls.find((c) => c.path.endsWith('/issues') && c.method === 'POST').body;
    expect(issue.labels).toContain('infra::suspected');
    expect(issue.labels).toContain('needs-human');
    expect(issue.description).toContain('Infra triage: this may not be a code bug');
    expect(issue.description).toContain('FAILED (503)');
    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe('https://ntfy.sh/shakefix-oncall');
    expect(pages[0].init.headers.priority).toBe('urgent');
    expect((await store.get('r_20261011_8f3a01')).infra.suspected).toBe(true);
  });

  it('a healthy app and a clean replay stay a normal code bug', async () => {
    const { app, fg } = setup();
    await report(app, { replay: makeReplay() });
    const issue = fg.calls.find((c) => c.path.endsWith('/issues') && c.method === 'POST').body;
    expect(issue.labels).not.toContain('infra::suspected');
  });
});

describe('Track your fix', () => {
  it('the report response links the reporter to their case on the public ER Board', async () => {
    const { app } = setup({ config: { boardUrl: 'https://board.example.io' } });
    const res = await report(app, { replay: makeReplay() });
    expect(res.json().trackUrl).toBe('https://board.example.io/?rid=r_20261011_8f3a01&explain=1&view=visual');
  });
  it('no board configured, no link', async () => {
    const { app } = setup();
    expect((await report(app, { replay: makeReplay() })).json().trackUrl).toBeNull();
  });
});

describe('human touches: composite identity', () => {
  const edit = { object_kind: 'issue', user: { username: 'cto.spacenos' }, object_attributes: { iid: 41, action: 'update', description: '<!-- shakefix:rid=r_20261011_8f3a01 -->' }, labels: [{ title: 'shakefix' }, { title: 'shakefix::proof' }], changes: { labels: { previous: [{ title: 'shakefix' }], current: [{ title: 'shakefix' }, { title: 'shakefix::proof' }] } } };
  const hook = (app, payload) => app.inject({ method: 'POST', url: '/v1/hooks/gitlab', headers: { 'content-type': 'application/json', 'x-gitlab-token': 'wh-secret' }, payload });
  const touches = async (app) => (await app.inject({ method: 'GET', url: '/v1/reports/r_20261011_8f3a01/timeline' })).json().humanTouches;

  it('a label edit GitLab attributes to the flow account is not a human touch', async () => {
    const at = new Date().toISOString();
    const ctx = setup({ labelEvents: [{ user: { username: 'ai-shakefix-er-grp' }, created_at: at }] });
    await report(ctx.app, { replay: makeReplay() });
    await hook(ctx.app, edit);
    expect(await touches(ctx.app)).toBe(0);
  });
  it('a label edit a person really made still counts', async () => {
    const at = new Date().toISOString();
    const ctx = setup({ labelEvents: [{ user: { username: 'cto.spacenos' }, created_at: at }] });
    await report(ctx.app, { replay: makeReplay() });
    await hook(ctx.app, edit);
    expect(await touches(ctx.app)).toBe(1);
  });
});
