// GET {APP_URL}/api/insights/affected?route=&component=&segment= on the demo app.
// The numbers are a SYNTHETIC demo population (the endpoint says so: synthetic:true). Offline or
// failing -> { patients: 'unknown' } and the report says so; nothing is guessed.

import { execFileSync } from 'node:child_process';

function curlJson(url, timeoutMs) {
  try {
    const out = execFileSync('curl', ['-fsS', '-m', String(Math.ceil(timeoutMs / 1000) + 3), '-H', 'accept: application/json', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function affectedUrl(appUrl, { route, component, segment } = {}) {
  const u = new URL('/api/insights/affected', appUrl.replace(/\/+$/, '') + '/');
  if (route) u.searchParams.set('route', route);
  if (component) u.searchParams.set('component', component);
  if (segment) u.searchParams.set('segment', segment);
  return u.toString();
}

/**
 * @returns {Promise<{patients:number|'unknown', populationSize?, windowDays?, refills?, avgCopay?, synthetic:boolean, note?, reason?, query}>}
 */
export async function fetchAffected(appUrl, query, { fetch: f = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const unknown = (reason) => ({ patients: 'unknown', synthetic: true, reason, query });
  if (!appUrl) return unknown('offline: no APP_URL');
  if (typeof f !== 'function') return unknown('fetch unavailable');
  let res;
  try {
    res = await f(affectedUrl(appUrl, query), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // Sandboxes route HTTPS through a proxy that Node's fetch ignores; curl honours HTTPS_PROXY.
    const viaCurl = curlJson(affectedUrl(appUrl, query), timeoutMs);
    if (viaCurl) res = { ok: true, status: 200, json: async () => viaCurl };
    else return unknown(`insights request failed: ${e?.message || e}`);
  }
  if (!res.ok) return unknown(`insights returned ${res.status}`);
  let d;
  try { d = await res.json(); } catch { return unknown('insights returned non-JSON'); }
  if (!Number.isFinite(d?.patients)) return { ...unknown('no data for this route/component'), populationSize: d?.populationSize, windowDays: d?.windowDays, note: d?.note };
  return {
    patients: d.patients,
    populationSize: d.populationSize ?? null,
    windowDays: d.windowDays ?? null,
    refills: d.refills ?? null,
    avgCopay: d.avgCopay ?? null,
    // Always synthetic for CareRx; never let a missing flag turn it into "real" numbers.
    synthetic: d.synthetic !== false ? true : false,
    note: d.note ?? null,
    query,
  };
}
