// "Notify me when fixed" (BUILD_SPEC §17): Web Push when available, otherwise poll
// GET <base>/v1/reports/:rid/status every 20 s while the page is open.

export const WATCH_KEY = 'shakefix.watch';
export const POLL_MS = 20_000;
/** DEMO_MODE replays a recorded run in real time; poll faster so the phone keeps up with the board. */
export const DEMO_POLL_MS = 3_000;
const WATCH_TTL_MS = 7 * 24 * 3600 * 1000;
export const FIXED_TITLE = 'Fixed ✓';
export const FIXED_BODY = 'The bug you reported is gone. Pull to refresh.';

// ---- reporter verdict ("patient's verdict", BUILD_SPEC §17.5) ---------------------------
export const DEVICE_KEY = 'shakefix.device';
export const ANSWERED_KEY = 'shakefix.verdicts';
export const VERDICT_QUESTION = 'Fixed ✓ — is it working for you now?';
export const STILL_BROKEN_NOTE = 'Still broken after fix';
export const RID_RE = /^r_\d{8}_[0-9a-f]{6}$/;
/** Query params the service worker adds when a "Fixed" notification is tapped. */
export const VERDICT_PARAM = 'shakefix_verdict';

/** <base>/v1/reports/:rid/verdict */
export function verdictUrl(endpoint, rid) {
  return `${endpointBase(endpoint)}/v1/reports/${encodeURIComponent(rid)}/verdict`;
}

function randomHex(win, bytes) {
  const a = new Uint8Array(bytes);
  if (win.crypto && win.crypto.getRandomValues) win.crypto.getRandomValues(a);
  else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Opaque per-browser id (localStorage) so the intake can ignore duplicate verdicts. */
export function getDeviceId(win = window) {
  try {
    const cur = win.localStorage.getItem(DEVICE_KEY);
    if (cur && /^[A-Za-z0-9_:-]{8,128}$/.test(cur)) return cur;
    const id = `dev_${randomHex(win, 12)}`;
    win.localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return undefined;
  }
}

function readAnswered(win) {
  try {
    const v = JSON.parse(win.localStorage.getItem(ANSWERED_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function hasAnswered(win, rid) {
  return readAnswered(win).includes(rid);
}
export function markAnswered(win, rid) {
  const list = readAnswered(win).filter((r) => r !== rid).concat(rid).slice(-50);
  try { win.localStorage.setItem(ANSWERED_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
}

/**
 * POST {verdict, deviceId?, replay?, pushSubscription?} to <base>/v1/reports/:rid/verdict.
 * Resolves the intake's JSON answer; throws on network errors and non-2xx.
 */
export async function postVerdict({ win = window, endpoint, rid, verdict, replay, deviceId, pushSubscription, fetchImpl }) {
  if (!endpoint) throw new Error('ShakeFix: data-endpoint is not configured');
  const body = { verdict };
  if (deviceId) body.deviceId = deviceId;
  if (replay) body.replay = replay;
  if (pushSubscription) body.pushSubscription = pushSubscription;
  const doFetch = fetchImpl || ((...a) => win.fetch(...a));
  const res = await doFetch(verdictUrl(endpoint, rid), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ShakeFix: verdict returned ${res.status}`);
  try { return await res.json(); } catch { return {}; }
}

/**
 * Reads and strips ?shakefix_verdict=ask|no&rid=<rid> (added by the service worker on a
 * notification tap). Returns {verdict, rid} or null. Must run before the recorder starts.
 */
export function takeVerdictParam(win = window) {
  try {
    const u = new URL(win.location.href);
    const verdict = u.searchParams.get(VERDICT_PARAM);
    if (!verdict) return null;
    const rid = u.searchParams.get('rid');
    u.searchParams.delete(VERDICT_PARAM);
    u.searchParams.delete('rid');
    win.history.replaceState(win.history.state, '', u.pathname + u.search + u.hash);
    if (!rid || !RID_RE.test(rid) || !['ask', 'no', 'yes'].includes(verdict)) return null;
    return { verdict, rid };
  } catch {
    return null;
  }
}

/** "https://intake.example/v1/reports" → "https://intake.example" */
export function endpointBase(endpoint) {
  return String(endpoint || '').replace(/\/+$/, '').replace(/\/v1\/reports$/, '');
}

export function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchVapidKey(base, fetchImpl) {
  const res = await fetchImpl(`${base}/v1/vapid-public-key`);
  if (!res.ok) throw new Error('no vapid key');
  const text = (await res.text()).trim();
  try {
    const j = JSON.parse(text);
    return typeof j === 'string' ? j : j.publicKey || j.key || j.vapidPublicKey;
  } catch {
    return text;
  }
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** Asks notification permission (call from a user gesture). Resolves the permission string. */
export async function askNotificationPermission(win = window) {
  const N = win.Notification;
  if (!N) return 'unsupported';
  if (N.permission !== 'default') return N.permission;
  try { return await N.requestPermission(); } catch { return 'denied'; }
}

/** Resolves a PushSubscription JSON or null (caller then falls back to polling). */
export async function subscribePush({ win = window, endpoint, fetchImpl = win.fetch.bind(win) }) {
  try {
    const nav = win.navigator;
    if (!nav.serviceWorker || !win.PushManager) return null;
    if ((await askNotificationPermission(win)) !== 'granted') return null;
    const reg = await withTimeout(nav.serviceWorker.ready, 3000);
    if (!reg || !reg.pushManager) return null;
    const key = await fetchVapidKey(endpointBase(endpoint), fetchImpl);
    if (!key) return null;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
    return sub ? sub.toJSON() : null;
  } catch {
    return null;
  }
}

function readWatch(win) {
  try {
    const list = JSON.parse(win.localStorage.getItem(WATCH_KEY) || '[]');
    const now = Date.now();
    return Array.isArray(list) ? list.filter((w) => w && w.rid && now - (w.at || 0) < WATCH_TTL_MS) : [];
  } catch {
    return [];
  }
}
function writeWatch(win, list) {
  try { win.localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
}

/** 👍 / 👎 actions on the "Fixed" notification (handled by the app's service worker). */
export const VERDICT_ACTIONS = [
  { action: 'yes', title: '👍 Fixed' },
  { action: 'no', title: '👎 Still broken' },
];

/**
 * @param {Window} win
 * @param {string} rid
 * @param {{endpoint?: string, url?: string, deviceId?: string}} [extra]  verdict data for the SW
 */
export async function showFixedNotification(win, rid, { endpoint, url, deviceId } = {}) {
  const data = { rid, kind: 'fixed', url: url || win.location.pathname };
  if (endpoint) data.verdictUrl = verdictUrl(endpoint, rid);
  if (deviceId) data.deviceId = deviceId;
  const opts = { body: FIXED_BODY, tag: `shakefix-${rid}`, data };
  try {
    if (win.Notification && win.Notification.permission === 'granted') {
      const reg = win.navigator.serviceWorker && (await win.navigator.serviceWorker.getRegistration());
      // Actions are only allowed on persistent (service worker) notifications.
      if (reg && reg.showNotification) await reg.showNotification(FIXED_TITLE, { ...opts, actions: VERDICT_ACTIONS });
      else new win.Notification(FIXED_TITLE, opts);
      return true;
    }
  } catch { /* fall through to toast */ }
  return false;
}

/**
 * Poller for watched rids (persisted in localStorage so it resumes on reload).
 * @param {{win?: Window, endpoint: string, onFixed: (rid: string) => void, fetchImpl?: Function}} opts
 */
export function createWatcher({ win = window, endpoint, onFixed, onDemo, fetchImpl, pollMs = POLL_MS }) {
  let timer = null;
  let interval = pollMs;
  const doFetch = fetchImpl || ((...a) => win.fetch(...a));
  const base = endpointBase(endpoint);

  async function tick() {
    const list = readWatch(win);
    if (!list.length) return stop();
    const remaining = [];
    for (const w of list) {
      try {
        const res = await doFetch(`${base}/v1/reports/${encodeURIComponent(w.rid)}/status`, { cache: 'no-store' });
        const body = res.ok ? await res.json() : null;
        if (body && body.demo && onDemo) onDemo();
        // "verified" = another reporter of the same bug already confirmed the fix.
        if (body && (body.state === 'deployed' || body.state === 'verified')) { onFixed(w.rid, body); continue; }
      } catch { /* offline — keep watching */ }
      remaining.push(w);
    }
    writeWatch(win, remaining);
    if (!remaining.length) stop();
  }

  function start() {
    if (timer || !readWatch(win).length) return;
    timer = win.setInterval(tick, interval);
  }
  function setPollMs(ms) {
    if (!(ms > 0) || ms === interval) return;
    interval = ms;
    if (timer) { stop(); start(); }
  }
  function stop() {
    if (timer) win.clearInterval(timer);
    timer = null;
  }
  function watch(rid) {
    const list = readWatch(win).filter((w) => w.rid !== rid);
    list.push({ rid, at: Date.now() });
    writeWatch(win, list);
    start();
  }
  return { start, stop, watch, tick, setPollMs, get pollMs() { return interval; }, list: () => readWatch(win) };
}
