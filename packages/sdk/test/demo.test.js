// DEMO_MODE: the intake replays a recorded run; the SDK must say "DEMO REPLAY" and poll faster.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createShakeFix, readScriptConfig } from '../src/index.js';
import { createWatcher, DEMO_POLL_MS, POLL_MS } from '../src/notify.js';

const ENDPOINT = 'https://intake.example/v1/reports';
let instances = [];
const root = () => document.getElementById('shakefix-root')?.shadowRoot;

beforeEach(() => {
  instances = [];
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '<span data-testid="app-version">vdeadbee</span>';
  window.html2canvas = vi.fn(async () => ({ width: 1, height: 1, toDataURL: () => 'data:image/png;base64,QUJD' }));
});
afterEach(() => {
  for (const sf of instances) {
    sf._internals.recorder.stop();
    sf._internals.consoleCap.stop();
    sf._internals.networkCap.stop();
    sf._internals.watcher.stop();
  }
  document.getElementById('shakefix-root')?.remove();
});

function boot(cfg = {}) {
  const sf = createShakeFix({ endpoint: ENDPOINT, app: 'splitpal', automationUi: true, ...cfg }, { win: window });
  sf.start();
  instances.push(sf);
  return sf;
}

describe('SDK demo mode', () => {
  it('reads data-demo from the script tag', () => {
    const s = document.createElement('script');
    s.dataset.endpoint = ENDPOINT;
    s.dataset.demo = '1';
    expect(readScriptConfig(s)).toMatchObject({ demo: true });
  });

  it('shows a DEMO REPLAY pill when the page carries <meta name="shakefix-demo">', () => {
    document.head.innerHTML = '<meta name="shakefix-demo" content="1">';
    const sf = boot();
    expect(sf.demo).toBe(true);
    expect(root().querySelector('[data-shakefix-demo]').textContent).toBe('DEMO REPLAY');
    expect(sf._internals.watcher.pollMs).toBe(DEMO_POLL_MS);
  });

  it('is off by default, and switches on when the intake answers demo:true', async () => {
    const sf = boot();
    expect(sf.demo).toBe(false);
    expect(root().querySelector('[data-shakefix-demo]')).toBeNull();
    expect(sf._internals.watcher.pollMs).toBe(POLL_MS);
    window.fetch = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ rid: 'r_20261011_abcdef', demo: true, issueUrl: 'https://gitlab.com/x/-/work_items/4' }) }));
    sf.open('bubble');
    const send = [...root().querySelectorAll('button')].find((b) => b.textContent === 'Send');
    send.click();
    await vi.waitFor(() => expect(sf.demo).toBe(true));
    expect(root().querySelector('[data-shakefix-demo]')).not.toBeNull();
  });

  it('watcher flags demo status answers and can speed up', async () => {
    const onDemo = vi.fn();
    const onFixed = vi.fn();
    localStorage.setItem('shakefix.watch', JSON.stringify([{ rid: 'r_20261011_abcdef', at: Date.now() }]));
    const w = createWatcher({ win: window, endpoint: ENDPOINT, onFixed, onDemo, fetchImpl: async () => ({ ok: true, json: async () => ({ state: 'proof', demo: true }) }) });
    await w.tick();
    expect(onDemo).toHaveBeenCalled();
    expect(onFixed).not.toHaveBeenCalled();
    w.setPollMs(DEMO_POLL_MS);
    expect(w.pollMs).toBe(DEMO_POLL_MS);
    w.stop();
  });
});
