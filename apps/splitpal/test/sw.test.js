// Service worker: "Fixed ✓" notification with 👍 / 👎 verdict actions (BUILD_SPEC §17.5).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://splitpal.example.run.app';
const RID = 'r_20261011_8f3a01';
const VERDICT_URL = `https://intake.test/v1/reports/${RID}/verdict`;

function loadSw({ fetchImpl } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const navigated = [];
  const fetchCalls = [];
  const win = {
    url: `${ORIGIN}/`,
    navigate: vi.fn(async (u) => navigated.push(u)),
    focus: vi.fn(async () => {}),
  };
  let windows = [];
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    registration: { showNotification: vi.fn(async (title, options) => shown.push({ title, options })) },
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: vi.fn(async (u) => opened.push(u)),
    },
  };
  const fetch = vi.fn(async (url, init) => {
    fetchCalls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return fetchImpl ? fetchImpl(url, init) : { ok: true, status: 200, json: async () => ({}) };
  });
  vm.runInNewContext(SRC, { self, fetch, URL, setInterval, clearInterval, JSON, Promise, Error, String });

  const dispatch = async (type, event) => {
    let p = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (x) => { p = x; } });
    await p;
  };
  const push = (payload) => dispatch('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } });
  const click = (data, action = '') => dispatch('notificationclick', { action, notification: { data, close: vi.fn() } });
  const message = (data) => (listeners.message ? dispatch('message', { data }) : Promise.resolve());
  return { push, click, message, shown, opened, navigated, fetchCalls, setWindows: (w) => { windows = w; }, win };
}

const fixedPayload = { title: 'Fixed ✓', body: 'The bug you reported is gone. Pull to refresh.', url: '/bill/7', kind: 'fixed', rid: RID, verdictUrl: VERDICT_URL, deviceId: 'dev_abcdef12' };

describe('sw.js verdict actions', () => {
  it('"Fixed ✓" push shows 👍 / 👎 actions and keeps the verdict data', async () => {
    const sw = loadSw();
    await sw.push(fixedPayload);
    const { title, options } = sw.shown[0];
    expect(title).toBe('Fixed ✓');
    expect(options.actions).toEqual([{ action: 'yes', title: '👍 Fixed' }, { action: 'no', title: '👎 Still broken' }]);
    expect(options.data).toEqual({ url: '/bill/7', rid: RID, kind: 'fixed', verdictUrl: VERDICT_URL, deviceId: 'dev_abcdef12' });
  });

  it('other notifications get no actions', async () => {
    const sw = loadSw();
    await sw.push({ title: 'Hello', body: 'x' });
    expect(sw.shown[0].options.actions).toBeUndefined();
  });

  it('👍 posts {verdict:"confirmed", deviceId} to the verdict URL and opens nothing', async () => {
    const sw = loadSw();
    await sw.push(fixedPayload);
    await sw.click(sw.shown[0].options.data, 'yes');
    expect(sw.fetchCalls).toHaveLength(1);
    expect(sw.fetchCalls[0]).toMatchObject({ url: VERDICT_URL, init: { method: 'POST' }, body: { verdict: 'confirmed', deviceId: 'dev_abcdef12' } });
    expect(sw.opened).toEqual([]);
  });

  it('👍 falls back to the page (?shakefix_verdict=yes) when the post fails', async () => {
    const sw = loadSw({ fetchImpl: async () => { throw new Error('offline'); } });
    await sw.push(fixedPayload);
    await sw.click(sw.shown[0].options.data, 'yes');
    expect(sw.opened).toEqual([`${ORIGIN}/bill/7?shakefix_verdict=yes&rid=${RID}`]);
  });

  it('👎 opens the app with ?shakefix_verdict=no&rid=<rid>', async () => {
    const sw = loadSw();
    await sw.push(fixedPayload);
    await sw.click(sw.shown[0].options.data, 'no');
    expect(sw.fetchCalls).toEqual([]);
    expect(sw.opened).toEqual([`${ORIGIN}/bill/7?shakefix_verdict=no&rid=${RID}`]);
  });

  it('a plain tap focuses an open tab and asks for the verdict', async () => {
    const sw = loadSw();
    sw.setWindows([sw.win]);
    await sw.push(fixedPayload);
    await sw.click(sw.shown[0].options.data);
    expect(sw.navigated).toEqual([`${ORIGIN}/bill/7?shakefix_verdict=ask&rid=${RID}`]);
  });

  it('watch fallback notifies with actions and derives the verdict URL', async () => {
    const sw = loadSw({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ state: 'deployed' }) }) });
    const statusUrl = `https://intake.test/v1/reports/${RID}/status`;
    await sw.message({ type: 'shakefix:watch', statusUrl, url: '/bill/7', rid: RID });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].options.actions).toHaveLength(2);
    expect(sw.shown[0].options.data).toMatchObject({ rid: RID, kind: 'fixed', verdictUrl: VERDICT_URL });
    await sw.message({ type: 'shakefix:unwatch', statusUrl });
  });
});
