import { describe, it, expect } from 'vitest';
import { buildReplay, inferExpectation, genRid, DEFAULT_EXPECTATIONS, SCHEMA } from '../src/replay.js';
import { createRecorder } from '../src/recorder.js';
import { endpointBase } from '../src/notify.js';

/** Minimal structural validator mirroring docs/CONTRACTS.md (the intake validates the same with zod). */
function contractErrors(r) {
  const errs = [];
  const is = (cond, msg) => { if (!cond) errs.push(msg); };
  const str = (v) => typeof v === 'string';
  is(r.schema === 'shakefix.replay/v1', 'schema');
  is(/^r_\d{8}_[0-9a-f]{6}$/.test(r.rid), 'rid');
  is(r.app && str(r.app.name) && str(r.app.version) && str(r.app.baseUrl), 'app');
  is(r.device && str(r.device.ua) && Array.isArray(r.device.viewport) && r.device.viewport.length === 2 && r.device.viewport.every(Number.isFinite) && typeof r.device.touch === 'boolean', 'device');
  is(['shake', 'bubble', 'hotkey', 'auto-error', 'rage-click'].includes(r.trigger), 'trigger');
  is(str(r.note), 'note');
  is(str(r.startRoute), 'startRoute');
  is(Array.isArray(r.actions), 'actions');
  for (const a of r.actions || []) {
    is(Number.isFinite(a.t) && a.t >= 0, 'action.t');
    is(['click', 'input', 'change', 'navigate', 'submit'].includes(a.type), 'action.type');
    is(a.testid === undefined || str(a.testid), 'action.testid');
    is(str(a.selector), 'action.selector');
    is(a.value === undefined || str(a.value), 'action.value');
    is(str(a.route), 'action.route');
    const extra = Object.keys(a).filter((k) => !['t', 'type', 'testid', 'selector', 'value', 'route'].includes(k));
    is(extra.length === 0, `action extra keys ${extra}`);
  }
  if (r.expectation !== null) {
    is(str(r.expectation.testid) && ['visible', 'hidden', 'text'].includes(r.expectation.state), 'expectation');
    if (r.expectation.state === 'text') is(str(r.expectation.text), 'expectation.text');
  }
  is(Array.isArray(r.console) && r.console.every((c) => ['error', 'warn'].includes(c.level) && str(c.msg) && (c.stack === undefined || str(c.stack))), 'console');
  is(Array.isArray(r.network) && r.network.every((n) => str(n.method) && str(n.path) && Number.isFinite(n.status) && Number.isFinite(n.ms)), 'network');
  const top = Object.keys(r).sort();
  is(JSON.stringify(top) === JSON.stringify(['actions', 'app', 'console', 'device', 'expectation', 'network', 'note', 'rid', 'schema', 'startRoute', 'trigger'].sort()), 'top-level keys');
  return errs;
}

function recordB1Session() {
  document.body.innerHTML = `
    <button data-testid="new-bill-btn">New</button>
    <input data-testid="title-input"><input data-testid="total-input">
    <input data-testid="person-input-0"><input data-testid="person-input-1"><input data-testid="person-input-2">
    <button data-testid="save-bill-btn">Save</button>
    <button data-testid="settle-btn">Settle</button>
    <button data-testid="confirm-settle-btn">Confirm</button>`;
  history.replaceState(null, '', '/');
  let t = 1_000_000;
  const r = createRecorder({ now: () => (t += 400), getRoute: () => location.pathname });
  r.start(window, document);
  const q = (id) => document.querySelector(`[data-testid="${id}"]`);
  const type = (id, v) => { q(id).value = v; q(id).dispatchEvent(new Event('input', { bubbles: true })); };
  q('new-bill-btn').click();
  history.pushState(null, '', '/bill/new');
  type('title-input', 'Dinner');
  type('total-input', '1000');
  type('person-input-0', 'Asha');
  type('person-input-1', 'Ben');
  type('person-input-2', 'Chen');
  q('save-bill-btn').click();
  history.pushState(null, '', '/bill/7');
  q('settle-btn').click();
  history.pushState(null, '', '/bill/7/settle');
  q('confirm-settle-btn').click();
  r.stop();
  return r.actions();
}

const base = {
  app: { name: 'splitpal', version: 'a1b2c3d', baseUrl: 'https://splitpal.example' },
  device: { ua: 'jsdom', viewport: [390, 844], touch: true },
};

describe('replay.json shape (CONTRACTS.md)', () => {
  it('a recorded B1 session produces a contract-valid replay', () => {
    const raw = recordB1Session();
    const replay = buildReplay({
      ...base,
      trigger: 'shake',
      note: 'settle button does nothing',
      rawActions: raw,
      currentRoute: '/bill/7/settle',
      console: [{ level: 'error', msg: 'boom', stack: 'Error: boom\n at x' }],
      network: [{ method: 'POST', path: '/api/bills/7/settle', status: 200, ms: 41.4 }],
    });
    expect(contractErrors(replay)).toEqual([]);
    expect(replay.schema).toBe(SCHEMA);
    expect(replay.startRoute).toBe('/');
    expect(replay.actions[0]).toEqual({ t: 0, type: 'click', testid: 'new-bill-btn', selector: '[data-testid="new-bill-btn"]', route: '/' });
    expect(replay.actions[1]).toEqual({ t: 400, type: 'navigate', selector: 'window', route: '/bill/new' });
    expect(replay.actions.map((a) => a.type)).toEqual([
      'click', 'navigate', 'input', 'input', 'input', 'input', 'input', 'click', 'navigate', 'click', 'navigate', 'click',
    ]);
    expect(replay.actions.find((a) => a.testid === 'total-input').value).toBe('1000');
    expect(replay.expectation).toEqual({ testid: 'settled-banner', state: 'visible' });
    expect(replay.network[0].ms).toBe(41);
  });

  it('startRoute is the route before the oldest buffered action', () => {
    const r = buildReplay({ ...base, trigger: 'bubble', rawActions: [{ ts: 5, type: 'navigate', selector: 'window', route: '/bill/9', from: '/settings' }], currentRoute: '/bill/9' });
    expect(r.startRoute).toBe('/settings');
    expect(r.actions[0]).not.toHaveProperty('from');
    const empty = buildReplay({ ...base, trigger: 'hotkey', rawActions: [], currentRoute: '/bill/3' });
    expect(empty.startRoute).toBe('/bill/3');
    expect(empty.expectation).toBeNull();
    expect(contractErrors(empty)).toEqual([]);
  });

  it('unknown trigger falls back to bubble', () => {
    expect(buildReplay({ ...base, trigger: 'nope', rawActions: [] }).trigger).toBe('bubble');
  });

  it('rid matches r_<yyyymmdd>_<6 hex>', () => {
    expect(genRid(new Date('2026-10-11T10:00:00Z'), () => 0.5)).toBe('r_20261011_888888');
    expect(genRid()).toMatch(/^r_\d{8}_[0-9a-f]{6}$/);
  });
});

describe('expectation inference', () => {
  const click = (testid) => ({ t: 0, type: 'click', testid, selector: `[data-testid="${testid}"]`, route: '/' });

  it('uses the last clicked testid', () => {
    expect(inferExpectation([click('new-bill-btn'), click('settle-btn')])).toEqual({ testid: 'settled-banner', state: 'visible' });
  });
  it('unknown last click → null (Triage Nurse infers from the note)', () => {
    expect(inferExpectation([click('settle-btn'), click('mystery-btn')])).toBeNull();
  });
  it('supports custom maps, globs and text state', () => {
    const map = { ...DEFAULT_EXPECTATIONS, 'pay-*-btn': { testid: 'paid-badge', state: 'text', text: 'Paid' } };
    expect(inferExpectation([click('pay-asha-btn')], map)).toEqual({ testid: 'paid-badge', state: 'text', text: 'Paid' });
  });
  it('config can disable a default with null', () => {
    expect(inferExpectation([click('settle-btn')], { ...DEFAULT_EXPECTATIONS, 'settle-btn': null })).toBeNull();
  });
});

describe('endpointBase', () => {
  it('strips /v1/reports', () => {
    expect(endpointBase('https://intake.example/v1/reports')).toBe('https://intake.example');
    expect(endpointBase('https://intake.example/v1/reports/')).toBe('https://intake.example');
  });
});
