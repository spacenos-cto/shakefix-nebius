// "Try ShakeFix": the live demo app (CareRx) inside a phone frame, with a button that shakes the phone and
// asks the SDK inside the frame to open its reporter (postMessage {type: 'shakefix:shake'}).
import './style.css';
import './try.css';

const params = new URLSearchParams(location.search);
// Public default: the DEMO_MODE pair (replays real case #14 at 10x, labelled DEMO REPLAY), so the page works
// even when the self-hosted runner is offline. ?app=…&intake=… points it at the live services instead.
const APP_URL = (params.get('app') || import.meta.env.VITE_DEMO_APP_URL || 'https://carerx-demo-pzd4uebegq-uc.a.run.app').replace(/\/+$/, '');
const INTAKE = params.get('intake') || (params.get('app') ? null : 'https://intake-demo-pzd4uebegq-uc.a.run.app');

// Seeded bugs that reproduce on production (apps/carerx/SEEDED_BUGS.md).
const BUGS = [
  { path: '/rx/1', text: 'Refill Metoprolol and pay the $12 copay. Check what you were charged.' },
  { path: '/settings', text: 'Turn off "Share my health data". Reload the page.' },
  { path: '/rx/2', text: 'Look at the levothyroxine dose. Is it really milligrams?' },
  { path: '/rx/1', text: 'Try to refill using only the keyboard (Tab, Enter).' },
];

const $ = (id) => document.getElementById(id);
const frame = $('app');
const device = $('device');
const note = $('shake-note');

function go(path) {
  frame.src = `${APP_URL}${path}`;
}

$('bugs').replaceChildren(...BUGS.map((b) => {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bug';
  btn.textContent = b.text;
  btn.addEventListener('click', () => go(b.path));
  li.append(btn);
  return li;
}));

$('app-src').textContent = `App: ${APP_URL}`;
if (INTAKE) {
  for (const id of ['board-link', 'board-link-2']) $(id).href = `./index.html?explain=1&view=visual&intake=${encodeURIComponent(INTAKE)}`;
}
go('/');

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

$('shake').addEventListener('click', () => {
  note.textContent = '';
  document.body.classList.remove('shaking');
  void device.offsetWidth; // restart the animation
  document.body.classList.add('shaking');
  try { navigator.vibrate?.([60, 40, 60, 40, 90]); } catch { /* unsupported */ }
  const delay = reduced() ? 0 : 900;
  setTimeout(() => {
    document.body.classList.remove('shaking');
    try {
      frame.contentWindow.postMessage({ type: 'shakefix:shake' }, APP_URL);
      note.textContent = 'The reporter opened inside the phone. Type what went wrong and tap Send.';
    } catch {
      note.textContent = 'Could not reach the app. Use the orange bug button inside the phone instead.';
    }
  }, delay);
});
