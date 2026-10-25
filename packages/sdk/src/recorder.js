// Action recorder: ring buffer of the last N user actions (BUILD_SPEC §7.2.1).
// Records click / input / change / submit / navigate. Selector priority: data-testid > id > short CSS path.
// Input values are masked (omitted) unless the field's testid is allowlisted or it has data-shakefix-allow.
// Password fields are never recorded at all.

export const DEFAULT_ALLOWLIST = ['total-input', 'person-input-*', 'title-input', 'tip-select', 'currency-select'];
export const RAGE_CLICKS = 3;
export const RAGE_WINDOW_MS = 800;

export class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = [];
  }
  push(item) {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    return item;
  }
  last() {
    return this.items[this.items.length - 1];
  }
  replaceLast(item) {
    if (this.items.length) this.items[this.items.length - 1] = item;
    else this.items.push(item);
  }
  toArray() {
    return this.items.slice();
  }
  clear() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
}

function globToRegExp(glob) {
  return new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}

export function matchesAllowlist(testid, allowlist = DEFAULT_ALLOWLIST) {
  if (!testid) return false;
  return allowlist.some((p) => (p.includes('*') ? globToRegExp(p).test(testid) : p === testid));
}

export function isPasswordField(el) {
  if (!el || !el.tagName) return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  return (el.tagName === 'INPUT' && type === 'password') || ac.includes('password');
}

export function testIdOf(el) {
  return (el && el.getAttribute && el.getAttribute('data-testid')) || undefined;
}

/** True when the element's value must NOT be recorded. */
export function shouldMask(el, allowlist = DEFAULT_ALLOWLIST) {
  if (!el || isPasswordField(el)) return true;
  if (el.hasAttribute && el.hasAttribute('data-shakefix-allow')) return false;
  return !matchesAllowlist(testIdOf(el), allowlist);
}

function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}

/** Short CSS path, max `maxDepth` levels, anchored at the nearest ancestor with a testid or id. */
export function cssPath(el, maxDepth = 4) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < maxDepth) {
    const tag = node.tagName.toLowerCase();
    if (node !== el) {
      const tid = testIdOf(node);
      if (tid) { parts.unshift(`[data-testid="${tid}"]`); break; }
      if (node.id) { parts.unshift(`#${cssEscape(node.id)}`); break; }
    }
    if (tag === 'html' || tag === 'body') { parts.unshift(tag); break; }
    let part = tag;
    const parent = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

/** Selector priority: data-testid > id > short CSS path. */
export function selectorFor(el) {
  const testid = testIdOf(el);
  if (testid) return { testid, selector: `[data-testid="${testid}"]` };
  if (el.id) return { selector: `#${cssEscape(el.id)}` };
  return { selector: cssPath(el) };
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'number', 'email', 'tel', 'url', 'search', 'date', 'time', 'datetime-local', 'month', 'week', 'range', 'color']);

function isTextEntry(el) {
  if (el.tagName === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase());
}
function isToggle(el) {
  return el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.getAttribute('type') || '');
}

/** The element that "is" the click target: nearest testid holder, else nearest interactive ancestor. */
export function resolveClickTarget(target) {
  if (!target || !target.closest) return target;
  return (
    target.closest('[data-testid]') ||
    target.closest('button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], summary, label') ||
    target
  );
}

/**
 * @param {{capacity?: number, allowlist?: string[], now?: () => number, getRoute?: () => string,
 *          isIgnored?: (e: Event) => boolean, onRageClick?: (selector: string) => void}} opts
 */
export function createRecorder(opts = {}) {
  const {
    capacity = 30,
    now = () => Date.now(),
    getRoute = () => location.pathname + location.search,
    isIgnored = () => false,
    onRageClick = () => {},
    // Keep the buffer across full page loads (users reload, and server-rendered apps navigate by
    // loading pages). Off unless a Storage is passed; the SDK passes sessionStorage (this tab only).
    storage = null,
    storageKey = 'shakefix.recorder.v1',
    persistMs = 10 * 60_000,
  } = opts;
  const allowlist = () => opts.allowlist || DEFAULT_ALLOWLIST;
  const buf = new RingBuffer(capacity);
  let currentRoute = null;
  let recentClicks = [];
  const cleanups = [];

  function save() {
    if (!storage) return;
    try { storage.setItem(storageKey, JSON.stringify({ savedAt: now(), items: buf.toArray() })); } catch { /* quota or blocked */ }
  }

  /** Restore actions saved by the previous page in this tab (if recent), then mark the page load. */
  function restore() {
    if (!storage) return;
    let saved = null;
    try { saved = JSON.parse(storage.getItem(storageKey) || 'null'); } catch { saved = null; }
    if (!saved || !Array.isArray(saved.items) || now() - Number(saved.savedAt) > persistMs) return;
    for (const item of saved.items) if (item && typeof item === 'object' && item.type) buf.push(item);
    const route = getRoute();
    const last = buf.last();
    // `value` marks a page load the replay must drive itself (goto), not wait for.
    if (buf.size) buf.push({ ts: now(), type: 'navigate', selector: 'window', route, value: route, from: last?.route ?? null });
  }

  function record(action) {
    const item = buf.push({ ts: action.ts ?? now(), route: getRoute(), ...action });
    save();
    return item;
  }

  function onClick(e) {
    if (isIgnored(e)) return;
    const raw = e.target;
    if (!raw || raw.nodeType !== 1) return;
    const el = resolveClickTarget(raw);
    // Text fields, selects and toggles are captured through input/change instead (replay would double-toggle).
    if (/^(INPUT|SELECT|TEXTAREA|OPTION)$/.test(el.tagName) || isPasswordField(el)) return;
    if (el.tagName === 'LABEL' && (el.control || el.querySelector('input,select,textarea'))) return;
    const sel = selectorFor(el);
    const ts = now();
    recentClicks = recentClicks.filter((c) => ts - c.ts < RAGE_WINDOW_MS);
    recentClicks.push({ ts, selector: sel.selector });
    if (recentClicks.filter((c) => c.selector === sel.selector).length >= RAGE_CLICKS) {
      recentClicks = [];
      onRageClick(sel.selector);
    }
    record({ ts, type: 'click', ...sel });
  }

  function valueFields(el) {
    if (isToggle(el)) return { value: String(!!el.checked) };
    if (shouldMask(el, allowlist())) return {};
    const v = el.isContentEditable ? el.textContent : el.value;
    return v == null ? {} : { value: String(v).slice(0, 500) };
  }

  function onInput(e) {
    if (isIgnored(e)) return;
    const el = e.target;
    if (!el || el.nodeType !== 1 || isPasswordField(el) || !isTextEntry(el)) return;
    const sel = selectorFor(el);
    const prev = buf.last();
    const action = { ts: now(), route: getRoute(), type: 'input', ...sel, ...valueFields(el) };
    // Coalesce keystrokes on the same field into one action carrying the final value.
    if (prev && prev.type === 'input' && prev.selector === sel.selector) buf.replaceLast(action);
    else buf.push(action);
    save();
  }

  function onChange(e) {
    if (isIgnored(e)) return;
    const el = e.target;
    if (!el || el.nodeType !== 1 || isPasswordField(el)) return;
    if (el.tagName !== 'SELECT' && !isToggle(el)) return; // text fields already covered by input
    record({ type: 'change', ...selectorFor(el), ...valueFields(el) });
  }

  function onSubmit(e) {
    if (isIgnored(e)) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    record({ type: 'submit', ...selectorFor(el) });
  }

  function onNavigate() {
    const route = getRoute();
    if (route === currentRoute) return;
    const from = currentRoute;
    currentRoute = route;
    buf.push({ ts: now(), type: 'navigate', selector: 'window', route, from });
    save();
  }

  function start(win = window, doc = document) {
    currentRoute = getRoute();
    restore();
    const opts = { capture: true, passive: true };
    const add = (target, type, fn) => {
      target.addEventListener(type, fn, opts);
      cleanups.push(() => target.removeEventListener(type, fn, opts));
    };
    add(doc, 'click', onClick);
    add(doc, 'input', onInput);
    add(doc, 'change', onChange);
    add(doc, 'submit', onSubmit);
    add(win, 'popstate', onNavigate);
    const hist = win.history;
    for (const m of ['pushState', 'replaceState']) {
      const orig = hist[m];
      hist[m] = function patched(...args) {
        const r = orig.apply(this, args);
        try { onNavigate(); } catch { /* never break the host app */ }
        return r;
      };
      cleanups.push(() => { hist[m] = orig; });
    }
  }

  function stop() {
    while (cleanups.length) cleanups.pop()();
  }

  return {
    start,
    stop,
    record,
    buffer: buf,
    actions: () => buf.toArray(),
    clear: () => { buf.clear(); if (storage) { try { storage.removeItem(storageKey); } catch { /* blocked */ } } },
    // exposed for tests
    _handlers: { onClick, onInput, onChange, onSubmit, onNavigate },
  };
}
