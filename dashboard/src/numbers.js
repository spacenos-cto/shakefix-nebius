// Numbers tab: four big tiles, a shake → live sparkline, count-up easing. Pure, no DOM.

import { LIVE_STATES, computeMetrics } from './metrics.js';

/**
 * Tiles: median shake → live, hands-off share (discharged cases nobody touched), unintended changes
 * caught, rollbacks. Medians and counts come from metrics.js so the Patients tab and this tab agree.
 */
export function numberTiles(cards, serverMetrics = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const m = computeMetrics(list, serverMetrics);
  const discharged = list.filter((c) => LIVE_STATES.includes(c.state));
  const timed = discharged.filter((c) => c.createdAt != null && c.fixedAt != null);
  const handsOff = discharged.filter((c) => c.autonomy === 'hands-off' && !c.humanTouches);
  return {
    median: { ms: m.medianMs, n: timed.length },
    handsOff: { pct: discharged.length ? Math.round((100 * handsOff.length) / discharged.length) : null, n: handsOff.length, of: discharged.length },
    unintended: { value: m.unintendedCaught, cases: list.filter((c) => c.proof?.unintended > 0).length },
    rollbacks: { value: m.rollbacks },
  };
}

/** Shake → live per discharged case, oldest first. */
export function shakeToLiveSeries(cards) {
  return (Array.isArray(cards) ? cards : [])
    .filter((c) => LIVE_STATES.includes(c.state) && c.createdAt != null && c.fixedAt != null)
    .map((c) => ({ rid: c.rid, iid: c.iid, at: c.fixedAt, ms: Math.max(0, c.fixedAt - c.createdAt) }))
    .sort((a, b) => a.at - b.at);
}

/**
 * Inline-SVG sparkline geometry. Points are evenly spaced (one per case); y is scaled to [min, max].
 * @returns {{path: string, points: Array<{x:number,y:number,v:number}>, min: number|null, max: number|null}}
 */
export function sparkline(values, { width = 320, height = 64, pad = 6 } = {}) {
  const v = (values ?? []).filter((x) => Number.isFinite(x));
  if (!v.length) return { path: '', points: [], min: null, max: null };
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const points = v.map((val, i) => ({
    x: +(pad + (v.length === 1 ? innerW / 2 : (i * innerW) / (v.length - 1))).toFixed(2),
    y: +(pad + (max === min ? innerH / 2 : innerH - ((val - min) / span) * innerH)).toFixed(2),
    v: val,
  }));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  return { path, points, min, max };
}

export const easeOutCubic = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Value at progress t (0..1) of a count-up from `from` to `to`. */
export function tween(from, to, t) {
  return from + (to - from) * easeOutCubic(t);
}
