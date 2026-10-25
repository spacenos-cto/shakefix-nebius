// Pure normalization helpers. No I/O.

/** Keys removed from API bodies and DB fields before diffing (§11.2). */
export const VOLATILE_KEYS = Object.freeze(['id', 'createdAt', 'updatedAt', 'ts']);

/** Test ids whose text legitimately differs between base and head (build stamp). */
export const IGNORED_TESTIDS = Object.freeze(['app-version']);

export const HIDDEN = '(hidden)';
export const ABSENT = '(absent)';
export const NONE = '(none)';

/** Strip origin + query + hash; replace purely numeric path segments with :id. */
export function normalizePath(input) {
  let p = String(input ?? '');
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) p = new URL(p).pathname;
  } catch { /* keep raw */ }
  p = p.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) p = '/' + p;
  return p
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? ':id' : seg))
    .join('/')
    .replace(/\/+$/, '') || '/';
}

/** Pathname of a page URL without normalizing ids (routes keep concrete bill ids). */
export function routeOf(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, '') || '/';
  } catch {
    const p = String(url ?? '/').split('#')[0].split('?')[0];
    return p.replace(/\/+$/, '') || '/';
  }
}

/** Deep copy with object keys sorted and volatile keys removed. */
export function normalizeBody(value, volatile = VOLATILE_KEYS) {
  if (Array.isArray(value)) return value.map((v) => normalizeBody(v, volatile));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (volatile.includes(k)) continue;
      out[k] = normalizeBody(value[k], volatile);
    }
    return out;
  }
  return value;
}

/** Collapse whitespace so layout-only reflow does not count as a text change. */
export function normalizeText(s) {
  if (s === null || s === undefined) return HIDDEN;
  return String(s).replace(/\s+/g, ' ').trim();
}

/** Normalize a raw {testid: text} map: drop ignored ids, collapse whitespace, sort keys. */
export function normalizeTextMap(map, ignored = IGNORED_TESTIDS) {
  const out = {};
  for (const k of Object.keys(map || {}).sort()) {
    if (ignored.includes(k)) continue;
    out[k] = normalizeText(map[k]);
  }
  return out;
}

/** Normalize one captured API response. */
export function normalizeApiEntry(e) {
  return {
    method: String(e.method || 'GET').toUpperCase(),
    path: normalizePath(e.path ?? e.url),
    status: Number(e.status),
    body: e.body === undefined ? null : normalizeBody(e.body),
  };
}

/** Normalize audit rows [{ts, op, table, rowId, fields}] -> [{op, table, fields}]. */
export function normalizeAudit(rows) {
  return (rows || []).map((r) => ({
    op: String(r.op),
    table: String(r.table),
    fields: normalizeBody(r.fields || {}),
  }));
}

/** Stable JSON stringify (keys sorted) used for dedup keys and comparisons. */
export function stableStringify(v) {
  return JSON.stringify(normalizeBody(v, []));
}

/** Format a JSON path segment: $.a.b[1] or $["weird key"]. */
export function joinPath(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

/** Extract a bill id from a route (/bill/9, /bill/9/settle) or testid (bill-row-9). */
export function billIdOf({ route, testid } = {}) {
  const m = /^\/bill\/(\d+)(?:\/|$)/.exec(route || '');
  if (m) return m[1];
  const t = /^bill-row-(\d+)$/.exec(testid || '');
  if (t) return t[1];
  return null;
}
