import { el } from '../dom.js';
import { api } from '../api.js';

/** Asks the ShakeFix SDK (if loaded) to start listening for shakes. */
async function enableShakeInSdk() {
  const sdk = window.ShakeFix || window.shakefix;
  try {
    if (sdk && typeof sdk.enableShake === 'function') return (await sdk.enableShake()) !== false;
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      return (await DeviceMotionEvent.requestPermission()) === 'granted';
    }
  } catch {
    return false;
  }
  return true;
}

const statusText = (on) => (on ? 'Your health data is shared with partners.' : 'Your health data is not shared.');

export async function renderSettings() {
  const me = await api.me();
  const status = el('p', { class: 'muted', testid: 'privacy-status' }, statusText(me.privacy.shareHealthData));
  const saved = el('p', { class: 'saved', testid: 'privacy-saved', role: 'status' });

  const toggle = el('input', {
    type: 'checkbox',
    id: 'share',
    testid: 'privacy-share-toggle',
    'data-shakefix-allow': true,
    checked: me.privacy.shareHealthData,
    onchange: async (e) => {
      const want = e.target.checked;
      // The client sends the right key; the server is where it goes wrong (C2).
      await api.setPrivacy({ shareHealthData: want });
      status.textContent = statusText(want);
      saved.textContent = 'Saved';
    },
  });

  const shakeBtn = el('button', {
    type: 'button',
    class: 'btn btn-block',
    testid: 'enable-shake-btn',
    onclick: async () => {
      shakeBtn.textContent = (await enableShakeInSdk()) ? 'Shake to report: On' : 'Shake to report: Off';
    },
  }, 'Turn on shake to report');

  return [
    el('section', { class: 'hero' }, el('h1', {}, 'Settings'), el('p', { class: 'muted' }, `${me.firstName} ${me.lastName}`)),
    el('div', { class: 'card' },
      el('h2', {}, 'Privacy'),
      el('label', { class: 'switch', for: 'share' }, toggle, el('span', {}, 'Share my health data with partners')),
      status,
      saved,
    ),
    el('div', { class: 'card' },
      el('h2', {}, 'Something not working?'),
      el('p', { class: 'muted' }, 'Shake your phone on any screen to tell us. We fix it and let you know.'),
      shakeBtn,
    ),
  ];
}
