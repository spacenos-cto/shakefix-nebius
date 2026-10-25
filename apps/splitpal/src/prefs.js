// Per-device preferences (localStorage, failure-tolerant).
const KEY = 'splitpal.prefs';
const DEFAULTS = { name: 'Asha', currency: 'INR', shake: false };

export function getPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: keep in memory only */
  }
  return next;
}
