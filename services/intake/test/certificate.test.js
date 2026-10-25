// Discharge Certificate: GET /v1/reports/:rid/certificate and GET /v1/certificates/verify.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { canonicalJson, certificateEvidence, projectWebUrl, sha256Hex, signDigest, verifyDigestSignature } from '../src/certificate.js';
import { createGitlabClient } from '../src/gitlab.js';
import { signBody } from '../src/hmac.js';
import { createMemoryStore } from '../src/store/memory.js';
import { fakeGitlab, makeReplay, testConfig } from './helpers.js';

const ORIGIN = 'https://splitpal.example.run.app';
const BOARD = 'https://board.example.test';
const RID = 'r_20261011_8f3a01';
const KEY = 'cert-key-test-not-real';

function setup({ config: over = {} } = {}) {
  const config = testConfig(over);
  const fg = fakeGitlab();
  const gitlab = createGitlabClient({ baseUrl: config.gitlabUrl, projectId: config.projectId, token: config.humanPat, fetch: fg.fetch });
  const store = createMemoryStore();
  const pusher = { mode: 'poll', send: async () => ({ ok: true }) };
  const app = buildApp({ config, gitlab, store, pusher, fetchImpl: async () => ({ ok: true, status: 200 }) });
  return { app, store, config };
}

const post = (app, url, body) =>
  app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', origin: ORIGIN }, payload: body });
const signed = (app, url, body) => {
  const raw = JSON.stringify(body);
  return app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', 'x-shakefix-signature': signBody('hook-secret', raw) }, payload: raw });
};
const cert = (app, rid = RID) => app.inject({ method: 'GET', url: `/v1/reports/${rid}/certificate`, headers: { origin: BOARD } });
const verify = (app, q) => app.inject({ method: 'GET', url: `/v1/certificates/verify?${new URLSearchParams(q)}`, headers: { origin: BOARD } });

async function discharged(opts) {
  const ctx = setup(opts);
  await post(ctx.app, '/v1/reports', { replay: makeReplay() });
  await signed(ctx.app, `/v1/reports/${RID}/fixed`, { mrIid: 42, proof: { intended: 2, unintended: 0 } });
  return ctx;
}

describe('GET /v1/reports/:rid/certificate', () => {
  it('issues a signed certificate for a deployed case (public, any origin)', async () => {
    const { app } = await discharged({ config: { certSigningKey: KEY } });
    const res = await cert(app);
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const c = res.json();
    expect(c).toMatchObject({
      schema: 'shakefix.certificate/v1',
      rid: RID,
      state: 'deployed',
      title: expect.stringContaining('settle button does nothing'),
      issue: { iid: 41, url: 'https://gitlab.test/grp/shakefix/-/issues/41' },
      mr: { iid: 42, url: 'https://gitlab.test/grp/shakefix/-/merge_requests/42' },
      humanTouches: 0,
      proof: { intended: 2, unintended: 0 },
      verdict: 'awaiting',
      signed: true,
    });
    expect(Object.keys(c.stages)).toEqual(['shaken', 'issue_created', 'mr_opened', 'second_opinion', 'merged', 'deployed', 'verified']);
    expect(c.stages.shaken).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(c.stages.deployed).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(c.stages.verified).toBeNull();
    expect(c.durations.shakeToDeployedMs).toBeGreaterThanOrEqual(0);
    expect(c.durations.shakeToVerifiedMs).toBeNull();
    expect(c.issuedAt).toMatch(/Z$/);

    // digest = sha256(canonical evidence); signature = HMAC(key, digest)
    const ev = Object.fromEntries(c.evidenceFields.map((k) => [k, c[k]]));
    ev.issue = { iid: c.issue.iid };
    ev.mr = { iid: c.mr.iid };
    expect(c.digest).toBe(sha256Hex(canonicalJson(ev)));
    expect(c.signature).toBe(signDigest(KEY, c.digest));

    // stable across requests (issuedAt is not evidence)
    expect((await cert(app)).json().digest).toBe(c.digest);
  });

  it('is unsigned when CERT_SIGNING_KEY is not set', async () => {
    const { app } = await discharged();
    const c = (await cert(app)).json();
    expect(c.signed).toBe(false);
    expect(c.signature).toBeNull();
    expect(c.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records the reporter verdict once verified', async () => {
    const { app } = await discharged({ config: { certSigningKey: KEY } });
    const before = (await cert(app)).json();
    await post(app, `/v1/reports/${RID}/verdict`, { verdict: 'confirmed', deviceId: 'device-1234' });
    const c = (await cert(app)).json();
    expect(c).toMatchObject({ state: 'verified', verdict: 'confirmed' });
    expect(c.stages.verified).toMatch(/Z$/);
    expect(c.durations.shakeToVerifiedMs).toBeGreaterThanOrEqual(0);
    expect(c.digest).not.toBe(before.digest);
  });

  it('409 not_discharged before deploy, 404 unknown, 400 bad rid', async () => {
    const { app } = setup();
    await post(app, '/v1/reports', { replay: makeReplay() });
    const res = await cert(app);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'not_discharged', state: 'received' });
    expect((await cert(app, 'r_20261011_ffffff')).statusCode).toBe(404);
    expect((await cert(app, 'nope')).statusCode).toBe(400);
  });

  it('uses GITLAB_PROJECT_WEB_URL for links when set', () => {
    expect(projectWebUrl({ gitlabProjectWebUrl: 'https://gitlab.com/acme/app' }, { issueUrl: 'https://x/-/issues/1' })).toBe('https://gitlab.com/acme/app');
    expect(projectWebUrl({ gitlabUrl: 'https://gitlab.com', projectId: 'acme%2Fapp' }, {})).toBe('https://gitlab.com/acme/app');
    expect(projectWebUrl({ gitlabUrl: 'https://gitlab.com', projectId: '123' }, {})).toBeNull();
  });
});

describe('GET /v1/certificates/verify', () => {
  it('a genuine signature is valid and current; a tampered digest or signature is not', async () => {
    const { app } = await discharged({ config: { certSigningKey: KEY } });
    const c = (await cert(app)).json();
    const ok = await verify(app, { rid: RID, digest: c.digest, signature: c.signature });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('*');
    expect(ok.json()).toEqual({ valid: true, rid: RID, current: true });

    const flip = (h) => (h[0] === 'a' ? 'b' : 'a') + h.slice(1);
    expect((await verify(app, { rid: RID, digest: flip(c.digest), signature: c.signature })).json()).toMatchObject({ valid: false, current: false });
    expect((await verify(app, { rid: RID, digest: c.digest, signature: flip(c.signature) })).json()).toMatchObject({ valid: false });
  });

  it('a signature made with another key is invalid', async () => {
    const { app } = await discharged({ config: { certSigningKey: KEY } });
    const c = (await cert(app)).json();
    const res = await verify(app, { rid: RID, digest: c.digest, signature: signDigest('other-key', c.digest) });
    expect(res.json().valid).toBe(false);
  });

  it('without a signing key nothing verifies', async () => {
    const { app } = await discharged();
    const c = (await cert(app)).json();
    const res = await verify(app, { rid: RID, digest: c.digest, signature: signDigest(KEY, c.digest) });
    expect(res.json()).toMatchObject({ valid: false, signed: false });
  });

  it('rejects malformed queries with 400', async () => {
    const { app } = setup({ config: { certSigningKey: KEY } });
    const res = await verify(app, { rid: RID, digest: 'xyz', signature: '00' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_query');
  });
});

describe('certificate helpers', () => {
  it('canonical JSON sorts keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });
  it('verifyDigestSignature never throws on bad input', () => {
    expect(verifyDigestSignature('', 'a'.repeat(64), 'b'.repeat(64))).toBe(false);
    expect(verifyDigestSignature(KEY, null, undefined)).toBe(false);
    const d = 'c'.repeat(64);
    expect(verifyDigestSignature(KEY, d, signDigest(KEY, d))).toBe(true);
  });
  it('evidence falls back to coarse timestamps and maps verdicts', () => {
    const ev = certificateEvidence({ rid: RID, state: 'verified', createdAt: '2026-10-11T10:00:00.000Z', fixedAt: '2026-10-11T10:11:42.000Z', verifiedAt: '2026-10-11T10:20:00.000Z', humanTouches: 1 }, { verdict: 'confirmed' });
    expect(ev.durations).toEqual({ shakeToDeployedMs: 702_000, shakeToVerifiedMs: 1_200_000 });
    expect(ev.verdict).toBe('confirmed');
    expect(ev.proof).toEqual({ intended: null, unintended: null });
  });
});
