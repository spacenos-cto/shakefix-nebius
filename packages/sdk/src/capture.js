// Console (last 50 error/warn + uncaught errors + unhandled rejections) and
// network (last 20 fetch/XHR: method, path, status, ms — never bodies or headers).
import { RingBuffer } from './recorder.js';

function fmtArg(a) {
  if (a instanceof Error) return a.message;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

export function createConsoleCapture({ win = window, capacity = 50, onUncaught = () => {} } = {}) {
  const buf = new RingBuffer(capacity);
  const cleanups = [];

  function push(level, msg, stack) {
    const entry = { level, msg: String(msg).slice(0, 1000) };
    if (stack) entry.stack = String(stack).slice(0, 4000);
    buf.push(entry);
  }

  function start() {
    const c = win.console;
    for (const level of ['error', 'warn']) {
      const orig = c[level];
      c[level] = function patched(...args) {
        try {
          const err = args.find((a) => a instanceof Error);
          push(level, args.map(fmtArg).join(' '), err && err.stack);
        } catch { /* ignore */ }
        return orig.apply(this, args);
      };
      cleanups.push(() => { c[level] = orig; });
    }
    const onError = (e) => {
      // Resource load errors (img/script 404) are not ErrorEvents with a message; skip them.
      if (!e || (!e.message && !e.error)) return;
      push('error', e.message || fmtArg(e.error), e.error && e.error.stack);
      onUncaught(e.error || e.message);
    };
    const onRejection = (e) => {
      const r = e && e.reason;
      push('error', 'Unhandled rejection: ' + fmtArg(r), r && r.stack);
      onUncaught(r);
    };
    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    cleanups.push(() => win.removeEventListener('error', onError));
    cleanups.push(() => win.removeEventListener('unhandledrejection', onRejection));
  }

  return {
    start,
    stop: () => { while (cleanups.length) cleanups.pop()(); },
    entries: () => buf.toArray(),
    push,
  };
}

export function toPath(url, base) {
  try {
    const u = new URL(url, base);
    return base && u.origin === new URL(base).origin ? u.pathname : u.host + u.pathname;
  } catch {
    return String(url).split('?')[0];
  }
}

export function createNetworkCapture({ win = window, capacity = 20, isIgnored = () => false, now = () => (win.performance?.now?.() ?? Date.now()) } = {}) {
  const buf = new RingBuffer(capacity);
  const cleanups = [];
  const base = () => win.location && win.location.href;

  function push(method, url, status, ms) {
    buf.push({ method: String(method || 'GET').toUpperCase(), path: toPath(url, base()), status: status | 0, ms: Math.max(0, Math.round(ms)) });
  }

  function start() {
    if (typeof win.fetch === 'function') {
      const origFetch = win.fetch;
      win.fetch = function patchedFetch(input, init) {
        const url = typeof input === 'string' ? input : input && (input.url || String(input));
        const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
        if (isIgnored(url)) return origFetch.apply(this, arguments);
        const t0 = now();
        return origFetch.apply(this, arguments).then(
          (res) => { push(method, url, res.status, now() - t0); return res; },
          (err) => { push(method, url, 0, now() - t0); throw err; },
        );
      };
      cleanups.push(() => { win.fetch = origFetch; });
    }
    const XHR = win.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const proto = XHR.prototype;
      const origOpen = proto.open;
      const origSend = proto.send;
      proto.open = function (method, url) {
        this.__sf = { method, url: String(url) };
        return origOpen.apply(this, arguments);
      };
      proto.send = function () {
        const meta = this.__sf;
        if (meta && !isIgnored(meta.url)) {
          const t0 = now();
          this.addEventListener('loadend', () => push(meta.method, meta.url, this.status, now() - t0));
        }
        return origSend.apply(this, arguments);
      };
      cleanups.push(() => { proto.open = origOpen; proto.send = origSend; });
    }
  }

  return {
    start,
    stop: () => { while (cleanups.length) cleanups.pop()(); },
    entries: () => buf.toArray(),
    push,
  };
}
