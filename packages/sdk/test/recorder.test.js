import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RingBuffer, createRecorder, selectorFor, shouldMask, matchesAllowlist, cssPath, DEFAULT_ALLOWLIST } from '../src/recorder.js';

function html(markup) {
  document.body.innerHTML = markup;
}
function fire(el, type, init = {}) {
  const Ctor = type === 'click' ? MouseEvent : Event;
  el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }));
}
function typeInto(el, value) {
  el.value = value;
  fire(el, 'input');
}

describe('RingBuffer', () => {
  it('keeps only the last N items in order', () => {
    const b = new RingBuffer(3);
    [1, 2, 3, 4, 5].forEach((n) => b.push(n));
    expect(b.toArray()).toEqual([3, 4, 5]);
    expect(b.size).toBe(3);
    expect(b.last()).toBe(5);
  });

  it('recorder keeps the last 30 actions', () => {
    html('<button data-testid="b">x</button>');
    let t = 0;
    const r = createRecorder({ now: () => (t += 1000), getRoute: () => '/' });
    r.start(window, document);
    const btn = document.querySelector('button');
    for (let i = 0; i < 45; i++) fire(btn, 'click');
    r.stop();
    const acts = r.actions();
    expect(acts).toHaveLength(30);
    expect(acts[0].ts).toBe(16000); // 45 clicks at ts 1000..45000 → oldest kept is #16
  });
});

describe('selector priority: data-testid > id > css path', () => {
  beforeEach(() => html(`
    <main>
      <button id="go" data-testid="settle-btn">Settle</button>
      <button id="only-id">Id</button>
      <section><ul><li>a</li><li><span class="x">b</span></li></ul></section>
      <div data-testid="card"><p><em>deep</em></p></div>
    </main>`));

  it('prefers data-testid even when id exists', () => {
    expect(selectorFor(document.getElementById('go'))).toEqual({ testid: 'settle-btn', selector: '[data-testid="settle-btn"]' });
  });
  it('falls back to id', () => {
    expect(selectorFor(document.getElementById('only-id'))).toEqual({ selector: '#only-id' });
  });
  it('falls back to a short css path (max 4 levels, nth-of-type)', () => {
    const span = document.querySelector('span.x');
    const sel = selectorFor(span).selector;
    expect(sel).toBe('section > ul > li:nth-of-type(2) > span');
    expect(document.querySelector(sel)).toBe(span);
  });
  it('css path anchors at the nearest testid ancestor', () => {
    const em = document.querySelector('em');
    expect(cssPath(em)).toBe('[data-testid="card"] > p > em');
  });
  it('clicks resolve to the nearest testid holder', () => {
    html('<button data-testid="settle-btn"><span id="inner">Settle</span></button>');
    const r = createRecorder({ getRoute: () => '/bill/7' });
    r.start(window, document);
    fire(document.getElementById('inner'), 'click');
    r.stop();
    expect(r.actions()[0]).toMatchObject({ type: 'click', testid: 'settle-btn', selector: '[data-testid="settle-btn"]', route: '/bill/7' });
  });
});

describe('masking', () => {
  it('default allowlist matches SplitPal fields incl. person-input-* glob', () => {
    expect(DEFAULT_ALLOWLIST).toEqual(['total-input', 'person-input-*', 'title-input', 'tip-select', 'currency-select']);
    expect(matchesAllowlist('person-input-12')).toBe(true);
    expect(matchesAllowlist('total-input')).toBe(true);
    expect(matchesAllowlist('email-input')).toBe(false);
    expect(matchesAllowlist(undefined)).toBe(false);
  });

  it('shouldMask honours allowlist, data-shakefix-allow, passwords', () => {
    html(`
      <input data-testid="total-input">
      <input data-testid="name-input">
      <input id="free" data-shakefix-allow>
      <input type="password" data-testid="total-input" data-shakefix-allow>`);
    const [total, name, free, pw] = document.querySelectorAll('input');
    expect(shouldMask(total)).toBe(false);
    expect(shouldMask(name)).toBe(true);
    expect(shouldMask(free)).toBe(false);
    expect(shouldMask(pw)).toBe(true);
  });

  let r;
  afterEach(() => r && r.stop());

  it('records allowlisted values, omits masked values, never records passwords', () => {
    html(`
      <input data-testid="total-input">
      <input data-testid="email">
      <input type="password" id="pw">
      <select data-testid="tip-select"><option>0</option><option>10</option></select>
      <select data-testid="secret-select"><option>a</option><option>b</option></select>`);
    r = createRecorder({ getRoute: () => '/bill/new' });
    r.start(window, document);
    typeInto(document.querySelector('[data-testid=total-input]'), '1000');
    typeInto(document.querySelector('[data-testid=email]'), 'me@x.io');
    typeInto(document.getElementById('pw'), 'hunter2');
    fire(document.getElementById('pw'), 'change');
    const tip = document.querySelector('[data-testid=tip-select]');
    tip.value = '10';
    fire(tip, 'change');
    const sec = document.querySelector('[data-testid=secret-select]');
    sec.value = 'b';
    fire(sec, 'change');
    const acts = r.actions();
    expect(acts).toHaveLength(4);
    expect(acts[0]).toMatchObject({ type: 'input', testid: 'total-input', value: '1000' });
    expect(acts[1]).toMatchObject({ type: 'input', testid: 'email' });
    expect(acts[1]).not.toHaveProperty('value');
    expect(acts[2]).toMatchObject({ type: 'change', testid: 'tip-select', value: '10' });
    expect(acts[3]).not.toHaveProperty('value');
    expect(JSON.stringify(acts)).not.toContain('hunter2');
    expect(JSON.stringify(acts)).not.toContain('me@x.io');
  });

  it('coalesces keystrokes on one field into a single input action', () => {
    html('<input data-testid="total-input">');
    r = createRecorder({ getRoute: () => '/' });
    r.start(window, document);
    const el = document.querySelector('input');
    ['1', '10', '100', '1000'].forEach((v) => typeInto(el, v));
    expect(r.actions()).toHaveLength(1);
    expect(r.actions()[0].value).toBe('1000');
  });
});

describe('navigation + rage clicks', () => {
  it('records pushState / popstate navigations with the previous route', () => {
    html('');
    history.replaceState(null, '', '/');
    const r = createRecorder({ getRoute: () => location.pathname + location.search });
    r.start(window, document);
    history.pushState(null, '', '/bill/new');
    history.replaceState(null, '', '/bill/new'); // same route → ignored
    history.pushState(null, '', '/bill/7');
    r.stop();
    const nav = r.actions();
    expect(nav.map((a) => [a.type, a.route, a.from])).toEqual([
      ['navigate', '/bill/new', '/'],
      ['navigate', '/bill/7', '/bill/new'],
    ]);
  });

  it('3 clicks on the same element within 800 ms → onRageClick', () => {
    html('<button data-testid="settle-btn">x</button>');
    let t = 0;
    const onRageClick = vi.fn();
    const r = createRecorder({ now: () => t, getRoute: () => '/', onRageClick });
    r.start(window, document);
    const b = document.querySelector('button');
    t = 0; fire(b, 'click');
    t = 300; fire(b, 'click');
    t = 1200; fire(b, 'click'); // too slow
    expect(onRageClick).not.toHaveBeenCalled();
    t = 1400; fire(b, 'click');
    t = 1600; fire(b, 'click');
    expect(onRageClick).toHaveBeenCalledWith('[data-testid="settle-btn"]');
    r.stop();
  });
});

describe('recorder persistence across page loads', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
  const fakeDoc = () => ({ addEventListener() {}, removeEventListener() {} });
  const fakeWin = () => ({ addEventListener() {}, removeEventListener() {}, history: { pushState() {}, replaceState() {} } });

  it('restores recent actions after a reload and marks the load as a navigate with value', () => {
    const storage = mem();
    let t = 1000;
    let route = '/settings';
    const a = createRecorder({ storage, now: () => (t += 100), getRoute: () => route });
    a.start(fakeWin(), fakeDoc());
    a.record({ type: 'change', testid: 'default-currency-select', selector: '[data-testid="default-currency-select"]', value: 'USD' });
    route = '/bill/new';
    const b = createRecorder({ storage, now: () => (t += 100), getRoute: () => route });
    b.start(fakeWin(), fakeDoc());
    const acts = b.actions();
    expect(acts.map((x) => x.type)).toEqual(['change', 'navigate']);
    expect(acts[1]).toMatchObject({ route: '/bill/new', value: '/bill/new', from: '/settings' });
  });

  it('ignores a stale buffer and is off without storage', () => {
    const storage = mem();
    let t = 0;
    const a = createRecorder({ storage, now: () => t, getRoute: () => '/' });
    a.start(fakeWin(), fakeDoc());
    a.record({ type: 'click', selector: 'button' });
    t = 11 * 60_000;
    const b = createRecorder({ storage, now: () => t, getRoute: () => '/' });
    b.start(fakeWin(), fakeDoc());
    expect(b.actions()).toEqual([]);
    const c = createRecorder({ now: () => t, getRoute: () => '/' });
    c.start(fakeWin(), fakeDoc());
    expect(c.actions()).toEqual([]);
  });

  it('clear() also forgets the stored buffer (after a report is sent)', () => {
    const storage = mem();
    const a = createRecorder({ storage, getRoute: () => '/' });
    a.start(fakeWin(), fakeDoc());
    a.record({ type: 'click', selector: 'button' });
    a.clear();
    expect(storage.getItem('shakefix.recorder.v1')).toBe(null);
  });
});
