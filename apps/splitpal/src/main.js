import './styles.css';
import { el, mount } from './dom.js';
import { renderList } from './views/list.js';
import { renderNewBill } from './views/newBill.js';
import { renderBill } from './views/bill.js';
import { renderSettle } from './views/settle.js';
import { renderSettings } from './views/settings.js';

const app = document.getElementById('app');
const errorSlot = document.getElementById('error-slot');

// ------------------------------------------------------------ version footer
// Runtime value injected by the server (APP_VERSION env) wins over the build-time one.
const metaVersion = document.querySelector('meta[name="app-version"]')?.content;
const version = metaVersion && metaVersion !== '__APP_VERSION__' ? metaVersion : __APP_VERSION__;
document.getElementById('app-version').textContent = `v${version}`;
window.__SPLITPAL_VERSION__ = version;

// ------------------------------------------------------------ demo replay label
// DEMO_MODE=1 on the server: the intake replays a recorded ShakeFix run (docs/DEMO.md). Say so on screen.
if (document.querySelector('meta[name="shakefix-demo"]')?.getAttribute('content') === '1') {
  document.body.classList.add('is-demo');
  document.body.prepend(el('div', { class: 'demo-ribbon', testid: 'demo-replay-label', role: 'note' },
    'DEMO REPLAY · recorded ShakeFix run, not live'));
}

// ------------------------------------------------------------ error banner
function showError(err) {
  const message = err?.message || String(err || 'Something went wrong');
  mount(errorSlot, el('div', { class: 'banner banner-error', testid: 'error-banner', role: 'alert' },
    el('strong', {}, 'Something broke. '), message));
}
function clearError() {
  mount(errorSlot);
}
// Uncaught errors are deliberately NOT swallowed: the ShakeFix SDK listens for them too.
window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

// ------------------------------------------------------------ router (History API)
const routes = [
  { pattern: /^\/$/, view: renderList, title: 'Bills' },
  { pattern: /^\/bill\/new$/, view: renderNewBill, title: 'New bill' },
  { pattern: /^\/bill\/(?<id>[^/]+)\/settle$/, view: renderSettle, title: 'Settle up' },
  { pattern: /^\/bill\/(?<id>[^/]+)$/, view: renderBill, title: 'Bill' },
  { pattern: /^\/settings$/, view: renderSettings, title: 'Settings' },
];

function notFound() {
  return [el('section', { class: 'hero' }, el('h1', {}, 'Not found'), el('a', { href: '/', 'data-link': true, testid: 'home-link' }, 'Back to bills'))];
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
  clearError();
  const match = routes.map((r) => ({ r, m: path.match(r.pattern) })).find((x) => x.m);
  document.title = match ? `${match.r.title} · SplitPal` : 'SplitPal';
  const ctx = { params: match?.m.groups || {}, navigate, rerender: render };
  app.setAttribute('aria-busy', 'true');
  // Errors thrown by a view propagate as unhandled rejections -> error-banner.
  const nodes = match ? await match.r.view(ctx) : notFound();
  if (seq !== renderSeq) return; // a newer navigation won
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

render();

// ------------------------------------------------------------ PWA
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[splitpal] SW registration failed', err));
  });
}
