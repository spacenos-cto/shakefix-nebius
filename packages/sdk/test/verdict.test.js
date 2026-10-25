// Reporter verdict ("patient's verdict", BUILD_SPEC §17.5): 👍 / 👎 after a "Fixed" notification.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createShakeFix } from '../src/index.js';
import { showFixedNotification, takeVerdictParam, verdictUrl, VERDICT_ACTIONS } from '../src/notify.js';

const RID = 'r_20261011_aaaaaa';
const ENDPOINT = 'https://intake.example/v1/reports';
const VERDICT_URL = `https://intake.example/v1/reports/${RID}/verdict`;

let posted;
let instances;

function boot(cfg = {}) {
  const sf = createShakeFix({ endpoint: ENDPOINT, app: 'splitpal', automationUi: true, ...cfg }, { win: window });
  sf.start();
  instances.push(sf);
  return sf;
}
const root = () => document.getElementById('shakefix-root').shadowRoot;
const button = (text) => [...root().querySelectorAll('button')].find((b) => b.textContent === text);

beforeEach(() => {
  posted = [];
  instances = [];
  localStorage.clear();
  document.body.innerHTML = '<button data-testid="settle-btn">Settle</button><span data-testid="app-version">vdeadbee</span>';
  history.replaceState(null, '', '/bill/7');
  window.html2canvas = vi.fn(async () => ({ width: 10, height: 10, toDataURL: () => 'data:image/png;base64,QUJD' }));
  window.fetch = vi.fn(async (url, init) => {
    posted.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true, rid: RID }) };
  });
});

afterEach(() => {
  for (const sf of instances) {
    sf._internals.recorder.stop();
    sf._internals.consoleCap.stop();
    sf._internals.networkCap.stop();
    sf._internals.watcher.stop();
  }
  document.getElementById('shakefix-root')?.remove();
  delete window.html2canvas;
  localStorage.clear();
});

describe('askVerdict sheet', () => {
  it('shows the question with 👍 / 👎', () => {
    const sf = boot();
    expect(sf.askVerdict(RID)).toBe(true);
    expect(root().textContent).toContain('Fixed ✓ — is it working for you now?');
    expect(button('👍 Yes, fixed')).toBeTruthy();
    expect(button('👎 Still broken')).toBeTruthy();
  });

  it('👍 posts {verdict:"confirmed", deviceId} to <base>/v1/reports/:rid/verdict', async () => {
    const sf = boot();
    sf.askVerdict(RID);
    button('👍 Yes, fixed').click();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].url).toBe(VERDICT_URL);
    expect(posted[0].init.method).toBe('POST');
    expect(posted[0].body).toEqual({ verdict: 'confirmed', deviceId: expect.stringMatching(/^dev_[0-9a-f]{24}$/) });
    await vi.waitFor(() => expect(root().textContent).toContain('Thanks for confirming'));
    expect(JSON.parse(localStorage.getItem('shakefix.verdicts'))).toEqual([RID]);
  });

  it('👍 shows an error and stays open when the intake fails', async () => {
    window.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const sf = boot();
    sf.askVerdict(RID);
    button('👍 Yes, fixed').click();
    await vi.waitFor(() => expect(root().textContent).toContain("Couldn't send"));
    expect(button('👍 Yes, fixed').disabled).toBe(false);
  });

  it('👎 opens the reporter pre-filled and posts {verdict:"rejected", replay}', async () => {
    const sf = boot();
    document.querySelector('[data-testid=settle-btn]').click(); // a fresh step to replay
    sf.askVerdict(RID);
    button('👎 Still broken').click();
    expect(root().querySelector('textarea').value).toBe('Still broken after fix');
    expect(root().querySelector('h2').textContent).toBe('Still broken?');
    button('Send').click();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].url).toBe(VERDICT_URL);
    const body = posted[0].body;
    expect(Object.keys(body).sort()).toEqual(['deviceId', 'replay', 'verdict']);
    expect(body.verdict).toBe('rejected');
    expect(body.replay).toMatchObject({ schema: 'shakefix.replay/v1', note: 'Still broken after fix', startRoute: '/bill/7' });
    expect(body.replay.actions.map((a) => a.testid)).toEqual(['settle-btn']);
    expect(posted.some((p) => p.url === ENDPOINT)).toBe(false); // not filed as a new report
    await vi.waitFor(() => expect(root().textContent).toContain('Back to the ER'));
  });

  it('rejects malformed rids', () => {
    expect(boot().askVerdict('nope')).toBe(false);
  });
});

describe('when the fix lands', () => {
  it('poll fallback: the Fixed toast is followed by the verdict sheet', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      localStorage.setItem('shakefix.watch', JSON.stringify([{ rid: RID, at: Date.now() }]));
      window.fetch = vi.fn(async (url) => {
        posted.push({ url });
        return { ok: true, status: 200, json: async () => ({ state: 'deployed' }) };
      });
      boot();
      vi.advanceTimersByTime(20_000);
      await vi.waitFor(() => expect(root().textContent).toContain('is it working for you now?'));
      expect(root().textContent).toContain('Fixed ✓ — The bug you reported is gone.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('also fires when another reporter already verified it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      localStorage.setItem('shakefix.watch', JSON.stringify([{ rid: RID, at: Date.now() }]));
      window.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ state: 'verified' }) }));
      boot();
      vi.advanceTimersByTime(20_000);
      await vi.waitFor(() => expect(root().textContent).toContain('is it working for you now?'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('push-click landing ?shakefix_verdict=ask opens the sheet and cleans the URL', () => {
    history.replaceState(null, '', `/bill/7?x=1&shakefix_verdict=ask&rid=${RID}`);
    const sf = boot();
    expect(location.pathname + location.search).toBe('/bill/7?x=1');
    expect(root().textContent).toContain('is it working for you now?');
    expect(sf.getReplay().actions).toEqual([]); // the URL cleanup is not recorded
  });

  it('notification 👎 landing ?shakefix_verdict=no opens the re-report sheet', () => {
    history.replaceState(null, '', `/bill/7?shakefix_verdict=no&rid=${RID}`);
    boot();
    expect(location.search).toBe('');
    expect(root().querySelector('textarea').value).toBe('Still broken after fix');
  });

  it('?shakefix_verdict=yes (SW fallback) posts the confirmation once', async () => {
    history.replaceState(null, '', `/bill/7?shakefix_verdict=yes&rid=${RID}`);
    boot();
    await vi.waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toMatchObject({ url: VERDICT_URL, body: { verdict: 'confirmed' } });
  });

  it('does not ask again for an answered rid', () => {
    localStorage.setItem('shakefix.verdicts', JSON.stringify([RID]));
    history.replaceState(null, '', `/bill/7?shakefix_verdict=ask&rid=${RID}`);
    boot();
    expect(root().textContent).not.toContain('is it working for you now?');
  });
});

describe('automation (navigator.webdriver)', () => {
  beforeEach(() => Object.defineProperty(window.navigator, 'webdriver', { value: true, configurable: true }));
  afterEach(() => { delete window.navigator.webdriver; });

  it('keeps the automatic verdict UI hidden, but window.ShakeFix.askVerdict still works', () => {
    history.replaceState(null, '', `/bill/7?shakefix_verdict=ask&rid=${RID}`);
    const sf = boot({ automationUi: false });
    expect(document.getElementById('shakefix-root')).toBeNull();
    expect(sf.askVerdict(RID)).toBe(true);
    expect(root().textContent).toContain('is it working for you now?');
  });
});

describe('notify helpers', () => {
  it('Fixed notification carries 👍 / 👎 actions and the verdict URL', async () => {
    const showNotification = vi.fn(async () => {});
    const prevN = window.Notification;
    const prevSw = Object.getOwnPropertyDescriptor(window.navigator, 'serviceWorker');
    window.Notification = { permission: 'granted' };
    Object.defineProperty(window.navigator, 'serviceWorker', { value: { getRegistration: async () => ({ showNotification }) }, configurable: true });
    try {
      expect(await showFixedNotification(window, RID, { endpoint: ENDPOINT, url: '/bill/7', deviceId: 'dev_abcdef12' })).toBe(true);
      const [title, opts] = showNotification.mock.calls[0];
      expect(title).toBe('Fixed ✓');
      expect(opts.actions).toEqual([{ action: 'yes', title: '👍 Fixed' }, { action: 'no', title: '👎 Still broken' }]);
      expect(opts.actions).toEqual(VERDICT_ACTIONS);
      expect(opts.data).toEqual({ rid: RID, kind: 'fixed', url: '/bill/7', verdictUrl: VERDICT_URL, deviceId: 'dev_abcdef12' });
    } finally {
      window.Notification = prevN;
      if (prevSw) Object.defineProperty(window.navigator, 'serviceWorker', prevSw);
      else delete window.navigator.serviceWorker;
    }
  });

  it('verdictUrl and takeVerdictParam', () => {
    expect(verdictUrl('https://i.example/v1/reports/', RID)).toBe(`https://i.example/v1/reports/${RID}/verdict`);
    history.replaceState(null, '', `/x?shakefix_verdict=no&rid=bad`);
    expect(takeVerdictParam(window)).toBeNull();
    expect(location.search).toBe('');
    history.replaceState(null, '', '/x?rid=keep');
    expect(takeVerdictParam(window)).toBeNull();
    expect(location.search).toBe('?rid=keep'); // untouched without shakefix_verdict
  });
});
