/* CareRx service worker: notifications only (no fetch handler, no caching, so
 * Playwright route interception and fresh deploys always see the network). */

const DEFAULT_TITLE = 'CareRx';
const ICON = '/icons/icon-192.png';
const FIXED_TITLE = 'Fixed ✓';
// Reporter verdict ("patient's verdict", BUILD_SPEC §17.5) on the "Fixed" notification.
const VERDICT_ACTIONS = [
  { action: 'yes', title: '👍 Fixed' },
  { action: 'no', title: '👎 Still broken' },
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const isFixed = (payload) => payload.kind === 'fixed' || payload.title === FIXED_TITLE;

function show(payload = {}) {
  const title = payload.title || DEFAULT_TITLE;
  const fixed = isFixed(payload) && payload.rid;
  const options = {
    body: payload.body || '',
    icon: ICON,
    badge: ICON,
    tag: payload.tag || payload.rid || undefined,
    data: {
      url: payload.url || '/',
      rid: payload.rid || null,
      kind: fixed ? 'fixed' : payload.kind || null,
      verdictUrl: payload.verdictUrl || null,
      deviceId: payload.deviceId || null,
    },
  };
  if (fixed) options.actions = VERDICT_ACTIONS;
  return self.registration.showNotification(title, options);
}

// Web Push (VAPID). Payload: {"title","body","url","rid"?, "kind"?: "fixed", "verdictUrl"?, "deviceId"?}
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(show(payload));
});

/** App URL with ?shakefix_verdict=<v>&rid=<rid> so the SDK opens the right sheet. */
function withVerdict(url, verdict, rid) {
  const u = new URL(url || '/', self.location.origin);
  if (rid) {
    u.searchParams.set('shakefix_verdict', verdict);
    u.searchParams.set('rid', rid);
  }
  return u.href;
}

function focusOrOpen(target) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const win of wins) {
      if (new URL(win.url).origin === self.location.origin && 'navigate' in win) {
        return win.focus().then(() => win.navigate(target));
      }
    }
    return self.clients.openWindow(target);
  });
}

async function postConfirmed(data) {
  const body = { verdict: 'confirmed' };
  if (data.deviceId) body.deviceId = data.deviceId;
  const res = await fetch(data.verdictUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 409) throw new Error(`verdict ${res.status}`);
}

// Tap -> focus an open CareRx tab on that URL, or open a new one.
// "Fixed" notifications: 👍 posts the verdict directly; 👎 opens the re-report sheet;
// a plain tap opens the app and the SDK asks "is it working for you now?".
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const fixed = data.kind === 'fixed' && data.rid;

  if (fixed && event.action === 'yes') {
    event.waitUntil(
      (data.verdictUrl ? postConfirmed(data) : Promise.reject(new Error('no verdict url'))).catch(() =>
        // Could not post (offline / no URL): let the SDK send it from the page.
        focusOrOpen(withVerdict(data.url, 'yes', data.rid)),
      ),
    );
    return;
  }
  if (fixed && event.action === 'no') {
    event.waitUntil(focusOrOpen(withVerdict(data.url, 'no', data.rid)));
    return;
  }
  const target = fixed ? withVerdict(data.url, 'ask', data.rid) : new URL(data.url || '/', self.location.origin).href;
  event.waitUntil(focusOrOpen(target));
});

// Message-based fallback (no push library / no push permission):
//   navigator.serviceWorker.controller.postMessage({ type: 'shakefix:notify', title, body, url })
//   navigator.serviceWorker.controller.postMessage({ type: 'shakefix:watch', statusUrl, url, rid, verdictUrl?, deviceId? })
// "watch" polls statusUrl every 20s while the SW is alive and notifies once the fix is live.
const watches = new Map();

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'shakefix:notify') {
    event.waitUntil(show(msg));
  } else if (msg.type === 'shakefix:watch' && msg.statusUrl && !watches.has(msg.statusUrl)) {
    const poll = async () => {
      try {
        const res = await fetch(msg.statusUrl, { cache: 'no-store' });
        const data = await res.json();
        const live = data && ['deployed', 'verified'].includes(data.state || data.status);
        if (live) {
          clearInterval(watches.get(msg.statusUrl));
          watches.delete(msg.statusUrl);
          await show({
            title: FIXED_TITLE,
            body: 'The bug you reported is gone. Pull to refresh.',
            url: data.url || msg.url || '/',
            rid: msg.rid,
            kind: 'fixed',
            verdictUrl: msg.verdictUrl || String(msg.statusUrl).replace(/\/status(\?.*)?$/, '/verdict'),
            deviceId: msg.deviceId,
          });
        }
      } catch {
        /* offline or intake down: try again next tick */
      }
    };
    watches.set(msg.statusUrl, setInterval(poll, 20000));
    event.waitUntil(poll());
  } else if (msg.type === 'shakefix:unwatch' && watches.has(msg.statusUrl)) {
    clearInterval(watches.get(msg.statusUrl));
    watches.delete(msg.statusUrl);
  }
});
