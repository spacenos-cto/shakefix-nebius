import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createShakeFix, readScriptConfig, resolveVersion } from '../src/index.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('script config + version', () => {
  it('reads data-endpoint / data-app / data-version (data-project alias)', () => {
    const s = document.createElement('script');
    s.dataset.endpoint = 'https://intake.example/v1/reports';
    s.dataset.project = 'splitpal';
    s.dataset.version = 'abc1234';
    expect(readScriptConfig(s)).toEqual({ endpoint: 'https://intake.example/v1/reports', app: 'splitpal', version: 'abc1234' });
  });
  it('falls back to #app-version / [data-testid=app-version] text', () => {
    document.body.innerHTML = '<footer><span data-testid="app-version">v1a2b3c4</span></footer>';
    expect(resolveVersion(undefined, document)).toBe('1a2b3c4');
    document.body.innerHTML = '<span id="app-version">2.0.1</span>';
    expect(resolveVersion(undefined, document)).toBe('2.0.1');
    expect(resolveVersion('x9', document)).toBe('x9');
  });
});

describe('createShakeFix end-to-end (jsdom)', () => {
  let sf;
  let posted;
  let fetchMock;
  beforeEach(() => {
    posted = [];
    document.body.innerHTML = '<button data-testid="settle-btn">Settle</button><span data-testid="app-version">vdeadbee</span>';
    history.replaceState(null, '', '/bill/7');
    window.html2canvas = vi.fn(async () => ({ width: 10, height: 10, toDataURL: () => 'data:image/png;base64,QUJD' }));
    fetchMock = window.fetch = vi.fn(async (url, init) => {
      posted.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ rid: 'r_20261011_aaaaaa', issueUrl: 'https://gitlab.com/x/shakefix/-/issues/12' }) };
    });
    sf = createShakeFix({ endpoint: 'https://intake.example/v1/reports', app: 'splitpal', automationUi: true }, { win: window });
    sf.start();
  });
  afterEach(() => {
    sf._internals.recorder.stop();
    sf._internals.consoleCap.stop();
    sf._internals.networkCap.stop();
    document.getElementById('shakefix-root')?.remove();
    delete window.html2canvas;
  });

  it('hotkey opens the sheet; Send posts {replay, screenshotPng, pushSubscription}', async () => {
    document.querySelector('[data-testid=settle-btn]').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true }));
    const root = document.getElementById('shakefix-root').shadowRoot;
    root.querySelector('textarea').value = 'settle button does nothing';
    const send = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Send');
    send.click();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    const body = JSON.parse(posted[0].init.body);
    expect(posted[0].url).toBe('https://intake.example/v1/reports');
    expect(Object.keys(body).sort()).toEqual(['deviceId', 'pushSubscription', 'replay', 'screenshotPng']);
    expect(body.deviceId).toMatch(/^dev_[0-9a-f]{24}$/);
    expect(body.screenshotPng).toBe('QUJD');
    expect(body.pushSubscription).toBeNull();
    expect(body.replay).toMatchObject({
      schema: 'shakefix.replay/v1',
      trigger: 'hotkey',
      note: 'settle button does nothing',
      app: { name: 'splitpal', version: 'deadbee' },
      startRoute: '/bill/7',
      expectation: { testid: 'settled-banner', state: 'visible' },
    });
    expect(body.replay.actions).toEqual([{ t: 0, type: 'click', testid: 'settle-btn', selector: '[data-testid="settle-btn"]', route: '/bill/7' }]);
    await vi.waitFor(() => expect(root.textContent).toContain('View issue #12'));
  });

  it("the SDK's own UI clicks are not recorded and its intake calls are not logged", async () => {
    sf.open('bubble');
    const root = document.getElementById('shakefix-root').shadowRoot;
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Send').click();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    const replay = JSON.parse(posted[0].init.body).replay;
    expect(replay.actions).toEqual([]);
    expect(replay.network).toEqual([]);
  });

  it('captures console errors and app fetches', async () => {
    console.error(new Error('kaboom'));
    await window.fetch('/api/bills/7');
    const r = sf.getReplay();
    expect(r.console[0]).toMatchObject({ level: 'error', msg: 'kaboom' });
    expect(r.console[0].stack).toContain('kaboom');
    expect(r.network[0]).toMatchObject({ method: 'GET', path: '/api/bills/7', status: 201 });
  });

  it('notify without Push falls back to polling the status endpoint', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      sf.open('shake');
      const root = document.getElementById('shakefix-root').shadowRoot;
      root.querySelector('[role=switch]').click();
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Send').click();
      await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('shakefix.watch'))[0].rid).toBe('r_20261011_aaaaaa'));
      fetchMock.mockImplementation(async (url) => {
        posted.push({ url });
        return { ok: true, status: 200, json: async () => ({ state: 'deployed', issueIid: 12 }) };
      });
      vi.advanceTimersByTime(20_000);
      await vi.waitFor(() => expect(posted.some((p) => p.url === 'https://intake.example/v1/reports/r_20261011_aaaaaa/status')).toBe(true));
      await flush();
      await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('shakefix.watch'))).toEqual([]));
    } finally {
      vi.useRealTimers();
      localStorage.clear();
    }
  });
});
