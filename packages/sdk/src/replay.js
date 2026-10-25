// Builds replay.json exactly per docs/CONTRACTS.md (schema "shakefix.replay/v1").

export const SCHEMA = 'shakefix.replay/v1';
export const TRIGGERS = ['shake', 'bubble', 'hotkey', 'auto-error', 'rage-click'];

/** Last clicked element → intended outcome. Override/extend with window.ShakeFixConfig.expectations. */
export const DEFAULT_EXPECTATIONS = {
  'settle-btn': { testid: 'settled-banner', state: 'visible' },
  'confirm-settle-btn': { testid: 'settled-banner', state: 'visible' },
  'save-bill-btn': { testid: 'bill-total', state: 'visible' },
  'new-bill-btn': { testid: 'title-input', state: 'visible' },
  'add-person-btn': { testid: 'person-input-1', state: 'visible' },
};

function globMatch(pattern, s) {
  if (!pattern.includes('*')) return pattern === s;
  return new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(s);
}

function normalizeExpectation(e) {
  if (!e || typeof e.testid !== 'string') return null;
  const state = ['visible', 'hidden', 'text'].includes(e.state) ? e.state : 'visible';
  const out = { testid: e.testid, state };
  if (state === 'text') out.text = String(e.text ?? '');
  return out;
}

/** Infers the expectation from the most recent click that has a testid. Exact keys win over globs. */
export function inferExpectation(actions, map = DEFAULT_EXPECTATIONS) {
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i];
    if (a.type !== 'click' || !a.testid) continue;
    if (Object.prototype.hasOwnProperty.call(map, a.testid)) return normalizeExpectation(map[a.testid]);
    const key = Object.keys(map).find((k) => k.includes('*') && globMatch(k, a.testid));
    return key ? normalizeExpectation(map[key]) : null;
  }
  return null;
}

function hex(n, rand) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

function cryptoRand() {
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    const b = new Uint32Array(1);
    globalThis.crypto.getRandomValues(b);
    return b[0] / 2 ** 32;
  }
  return Math.random();
}

/** rid format per contract: r_<yyyymmdd>_<6 hex> (UTC date). */
export function genRid(date = new Date(), rand = cryptoRand) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `r_${ymd}_${hex(6, rand)}`;
}

/** Converts raw recorder entries to contract actions (t relative to first action, internal fields dropped). */
export function toContractActions(raw) {
  if (!raw.length) return [];
  const t0 = raw[0].ts;
  return raw.map((a) => {
    const out = { t: Math.max(0, Math.round(a.ts - t0)), type: a.type };
    if (a.testid) out.testid = a.testid;
    out.selector = a.selector || '';
    if (a.value !== undefined) out.value = String(a.value);
    out.route = a.route || '/';
    return out;
  });
}

/** Route the replay must start from: the route before the oldest buffered action. */
export function startRouteOf(raw, fallback = '/') {
  if (!raw.length) return fallback;
  const first = raw[0];
  if (first.type === 'navigate') return first.from || fallback;
  return first.route || fallback;
}

/**
 * @param {object} p
 * @param {string} [p.rid]
 * @param {{name:string, version:string, baseUrl:string}} p.app
 * @param {{ua:string, viewport:[number,number], touch:boolean}} p.device
 * @param {string} p.trigger
 * @param {string} [p.note]
 * @param {Array} p.rawActions  recorder entries
 * @param {string} p.currentRoute
 * @param {object} [p.expectations]
 * @param {Array} [p.console]
 * @param {Array} [p.network]
 */
export function buildReplay(p) {
  const actions = toContractActions(p.rawActions || []);
  return {
    schema: SCHEMA,
    rid: p.rid || genRid(),
    app: { name: String(p.app.name || 'app'), version: String(p.app.version || 'unknown'), baseUrl: String(p.app.baseUrl || '') },
    device: {
      ua: String(p.device.ua || ''),
      viewport: [Math.round(p.device.viewport[0]) || 0, Math.round(p.device.viewport[1]) || 0],
      touch: !!p.device.touch,
    },
    trigger: TRIGGERS.includes(p.trigger) ? p.trigger : 'bubble',
    note: String(p.note || '').slice(0, 2000),
    startRoute: startRouteOf(p.rawActions || [], p.currentRoute || '/'),
    actions,
    expectation: inferExpectation(actions, { ...DEFAULT_EXPECTATIONS, ...(p.expectations || {}) }),
    console: (p.console || []).map((c) => {
      const o = { level: c.level === 'warn' ? 'warn' : 'error', msg: String(c.msg) };
      if (c.stack) o.stack = String(c.stack);
      return o;
    }),
    network: (p.network || []).map((n) => ({ method: String(n.method), path: String(n.path), status: Math.round(Number(n.status)) || 0, ms: Math.round(Number(n.ms)) || 0 })),
  };
}
