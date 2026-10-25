import { el } from '../dom.js';
import { api } from '../api.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { CURRENCIES } from '../lib/currency.js';
import { formatRemaining } from '../auth/session.js';

/** Asks the ShakeFix SDK (if loaded) to start listening for shakes. */
async function enableShakeInSdk() {
  const sdk = window.ShakeFix || window.shakefix;
  try {
    if (sdk && typeof sdk.enableShake === 'function') return (await sdk.enableShake()) !== false;
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      return (await DeviceMotionEvent.requestPermission()) === 'granted';
    }
  } catch (err) {
    console.warn('[splitpal] could not enable shake:', err);
    return false;
  }
  return true;
}

export async function renderSettings() {
  const prefs = getPrefs();
  const session = await api.session();

  const sessionLine = session.valid
    ? `Signed in as ${session.user} · session expires in ${formatRemaining(session.remainingMs)}`
    : 'Session expired. You have been signed out.';

  const name = el('input', {
    id: 'name', type: 'text', testid: 'settings-name-input', value: prefs.name, autocomplete: 'off',
    onchange: (e) => setPrefs({ name: e.target.value }),
  });
  const currency = el('select', {
    id: 'default-currency', testid: 'default-currency-select', 'data-shakefix-allow': true,
    onchange: (e) => setPrefs({ currency: e.target.value }),
  }, CURRENCIES.map((c) => el('option', { value: c, selected: c === prefs.currency }, c)));

  const shakeLabel = (on) => `Shake to report: ${on ? 'On' : 'Off'}`;
  const shakeBtn = el('button', {
    type: 'button', class: 'btn btn-block', testid: 'enable-shake-btn',
    'aria-pressed': String(prefs.shake),
    onclick: async () => {
      const want = !getPrefs().shake;
      const on = want ? await enableShakeInSdk() : false;
      if (!want) (window.ShakeFix || window.shakefix)?.disableShake?.();
      setPrefs({ shake: on });
      shakeBtn.textContent = shakeLabel(on);
      shakeBtn.setAttribute('aria-pressed', String(on));
      shakeBtn.classList.toggle('btn-primary', on);
    },
  }, shakeLabel(prefs.shake));
  shakeBtn.classList.toggle('btn-primary', prefs.shake);

  return [
    el('section', { class: 'hero' }, el('h1', {}, 'Settings')),
    el('div', { class: 'card form' },
      el('label', { for: 'name' }, 'Your name'), name,
      el('label', { for: 'default-currency' }, 'Default currency'), currency,
    ),
    el('div', { class: 'card' },
      el('h2', {}, 'Found a bug?'),
      el('p', { class: 'muted' }, 'Shake your phone anywhere in SplitPal to report it. We fix it, you get a buzz.'),
      shakeBtn,
    ),
    el('div', { class: 'card' },
      el('h2', {}, 'Account'),
      el('p', { class: session.valid ? 'muted' : 'inline-error', testid: 'session-status' }, sessionLine),
    ),
  ];
}
