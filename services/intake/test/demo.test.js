import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDemo, loadDemoFixture, validateFixture } from '../src/demo.js';
import { makeReplay, testConfig } from './helpers.js';

const ORIGIN = 'https://splitpal.example.run.app';

function setup({ speed = 1 } = {}) {
  let t = Date.parse('2026-10-11T10:00:00.000Z');
  const now = () => t;
  const config = testConfig({ demoMode: true, demoSpeed: speed });
  const demo = createDemo({ fixture: loadDemoFixture(), now, speed });
  // No GitLab client and no store: demo mode must never reach them.
  const app = buildApp({ config, gitlab: null, store: null, pusher: null, now, demo });
  return { app, demo, advance: (s) => { t += s * 1000; } };
}

describe('DEMO_MODE fixture', () => {
  const f = loadDemoFixture();
  it('is the real hero run (case #14 → MR !12), every stage a recorded timestamp', () => {
    expect(f).toMatchObject({ rid: 'r_20261012_3d080f', issueIid: 14, mrIid: 12 });
    for (const s of f.stages) expect(s.source).toBe('recorded');
    for (const s of f.stages) expect(s.evidence).toBeTruthy();
  });
  it('rejects broken fixtures', () => {
    expect(() => validateFixture({ ...f, schema: 'x' })).toThrow();
    expect(() => validateFixture({ ...f, stages: [{ key: 'shaken', offsetS: 5, source: 'recorded' }, { key: 'merged', offsetS: 1, source: 'scripted' }] })).toThrow(/ascending/);
    expect(() => validateFixture({ ...f, stages: [{ key: 'nope', offsetS: 0, source: 'recorded' }] })).toThrow(/unknown stage/);
  });
});

describe('DEMO_MODE routes', () => {
  it('paces the hero run through board, status and timeline in real time, labelled demo', async () => {
    const { app, advance } = setup();
    const rid = 'r_20261012_3d080f';
    let st = (await app.inject({ method: 'GET', url: `/v1/reports/${rid}/status` })).json();
    expect(st).toMatchObject({ state: 'received', issueIid: 14, demo: true });
    advance(60);
    expect((await app.inject({ method: 'GET', url: `/v1/reports/${rid}/status` })).json().state).toBe('triaging');
    advance(540 - 60);
    const board = (await app.inject({ method: 'GET', url: '/v1/board', headers: { origin: 'https://x.gitlab.io' } })).json();
    expect(board.demo).toBe(true);
    expect(board.items[0]).toMatchObject({ rid, state: 'proof', mrIid: 12, demo: true });
    advance(1590 - 540);
    st = (await app.inject({ method: 'GET', url: `/v1/reports/${rid}/status` })).json();
    expect(st.state).toBe('verified');
    const tl = (await app.inject({ method: 'GET', url: `/v1/reports/${rid}/timeline` })).json();
    expect(tl.demo).toBe(true);
    expect(tl.elapsedMs).toBe(1590_000);
    expect(tl.stages.find((s) => s.key === 'verified')).toMatchObject({ source: 'recorded' });
    expect(tl.stopwatch).toBe('shake → 👍 26m 30s · Human touches: 1');
    const badge = await app.inject({ method: 'GET', url: '/v1/badge.svg' });
    expect(badge.body).toContain('DEMO · Discharged 1 · 👍 100%');
  });

  it('a live shake walks the same script with its own rid and waits for the real 👍', async () => {
    const { app, advance } = setup({ speed: 10 });
    const replay = makeReplay({ rid: 'r_20261011_abcdef' });
    const res = await app.inject({ method: 'POST', url: '/v1/reports', headers: { 'content-type': 'application/json', origin: ORIGIN }, payload: { replay } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ rid: 'r_20261011_abcdef', issueIid: 14, demo: true });
    const verdict = (body) => app.inject({ method: 'POST', url: '/v1/reports/r_20261011_abcdef/verdict', headers: { 'content-type': 'application/json', origin: ORIGIN }, payload: body });
    expect((await verdict({ verdict: 'confirmed' })).statusCode).toBe(409);
    advance(1590 / 10 + 1);
    const st = (await app.inject({ method: 'GET', url: '/v1/reports/r_20261011_abcdef/status' })).json();
    expect(st.state).toBe('deployed'); // never auto-verified
    expect((await verdict({ verdict: 'confirmed' })).json()).toMatchObject({ ok: true, state: 'verified', demo: true });
    expect((await verdict({ verdict: 'confirmed' })).json()).toMatchObject({ duplicate: true });
    expect((await app.inject({ method: 'GET', url: '/v1/reports/r_20261011_abcdef/status' })).json().state).toBe('verified');
  });

  it('refuses CI writes and unknown rids', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/v1/hooks/gitlab', payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/v1/reports/r_20261011_ffffff/status' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({ demoMode: true });
  });
});

describe('DEMO_MODE speed', () => {
  it('a sped-up replay says how long the real run took', async () => {
    const { app } = setup({ speed: 10 });
    const tl = (await app.inject({ method: 'GET', url: '/v1/reports/r_20261012_3d080f/timeline' })).json();
    expect(tl.replaySpeed).toBe(10);
    expect(tl.stopwatch).toContain('replayed at 10x; the real run took 26m 30s');
  });
});
