import './styles.css';
import { el, mount } from './dom.js';
import { renderHome } from './views/home.js';
import { renderRx } from './views/rx.js';
import { renderRefill } from './views/refill.js';
import { renderOrder } from './views/order.js';
import { renderOrders } from './views/orders.js';
import { renderSettings } from './views/settings.js';

const app = document.getElementById('app');
const errorSlot = document.getElementById('error-slot');

// Runtime version injected by the server (APP_VERSION env) wins over the build-time one.
const metaVersion = document.querySelector('meta[name="app-version"]')?.content;
const version = metaVersion && metaVersion !== '__APP_VERSION__' ? metaVersion : __APP_VERSION__;
document.getElementById('app-version').textContent = `v${version}`;

if (document.querySelector('meta[name="shakefix-demo"]')?.getAttribute('content') === '1') {
  document.body.prepend(el('div', { class: 'demo-ribbon', testid: 'demo-replay-label', role: 'note' }, 'DEMO REPLAY · recorded ShakeFix run, not live'));
}

function showError(err) {
  const message = err?.message || String(err || 'Something went wrong');
  mount(errorSlot, el('div', { class: 'banner banner-error', testid: 'error-banner', role: 'alert' }, el('strong', {}, 'Something went wrong. '), message));
}
// Uncaught errors are deliberately NOT swallowed: the ShakeFix SDK listens for them too.
window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

const routes = [
  { pattern: /^\/$/, view: renderHome, title: 'Your prescriptions' },
  { pattern: /^\/rx\/(?<id>[^/]+)\/refill$/, view: renderRefill, title: 'Refill' },
  { pattern: /^\/rx\/(?<id>[^/]+)$/, view: renderRx, title: 'Prescription' },
  { pattern: /^\/orders\/(?<id>[^/]+)$/, view: renderOrder, title: 'Order' },
  { pattern: /^\/orders$/, view: renderOrders, title: 'Orders' },
  { pattern: /^\/settings$/, view: renderSettings, title: 'Settings' },
];

function notFound() {
  return [el('section', { class: 'hero' }, el('h1', {}, 'Page not found'), el('a', { href: '/', 'data-link': true }, 'Back to your prescriptions'))];
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  mount(errorSlot);
  const match = routes.map((r) => ({ r, m: path.match(r.pattern) })).find((x) => x.m);
  document.title = match ? `${match.r.title} · CareRx` : 'CareRx';
  const ctx = { params: match?.m.groups || {}, navigate, rerender: render };
  app.setAttribute('aria-busy', 'true');
  const nodes = match ? await match.r.view(ctx) : notFound();
  if (seq !== renderSeq) return;
  mount(app, ...nodes);
  app.removeAttribute('aria-busy');
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate(link.getAttribute('href'));
});
window.addEventListener('popstate', render);

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
