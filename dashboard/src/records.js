// "Medical Records" panel: reads .shakefix/memory/index.json (copied to memory.json at build, like
// ledger.json). Pure, no DOM. Shape: docs/CONTRACTS.md "Medical Record" (shakefix.memory-index/v1).

import { formatDuration } from './metrics.js';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function hotspotLabel(h) {
  if (h.kind === 'route' || h.route) return h.route ?? h.key;
  if (h.kind === 'file' || h.file) return String(h.file ?? h.key).replace(/^apps\/[^/]+\/src\//, '');
  return String(h.key ?? '?');
}

/**
 * @param {object|null} index  memory index.json, or null when the file does not exist yet
 * @returns {null | {cases, hotspots, lessons, speedup, blocked}}
 */
export function medicalRecords(index, { maxHotspots = 5, maxLessons = 4 } = {}) {
  if (!index || typeof index !== 'object' || !Array.isArray(index.cases)) return null;
  const hotspots = (Array.isArray(index.hotspots) ? index.hotspots : [])
    .filter((h) => h && num(h.count) != null)
    .slice()
    .sort((a, b) => b.count - a.count || (b.last_iid ?? 0) - (a.last_iid ?? 0))
    .slice(0, maxHotspots)
    .map((h) => ({ kind: h.kind ?? (h.route ? 'route' : 'file'), label: hotspotLabel(h), count: Number(h.count), lastIid: h.last_iid ?? null }));
  const lessons = (Array.isArray(index.lessons) ? index.lessons : [])
    .slice(-maxLessons)
    .reverse()
    .map((l) => ({ id: String(l.id ?? ''), source: String(l.source ?? ''), text: String(l.text ?? ''), case: l.case ?? null }));
  const stats = index.stats ?? {};
  return {
    cases: num(stats.cases) ?? index.cases.length,
    hotspots,
    lessons,
    speedup: speedupLine(stats),
    blocked: num(stats.blocked_side_effects),
  };
}

/** "Repeat bugs fixed 3.1× faster (40s vs 2m 04s)", or what is known so far. Never invents a number. */
export function speedupLine(stats = {}) {
  const repeat = num(stats.repeat_bug_median_time_s);
  const first = num(stats.first_time_median_s);
  if (repeat != null && first != null && repeat > 0) {
    const factor = num(stats.speedup) ?? first / repeat;
    return { factor, text: `Repeat bugs fixed ${factor.toFixed(1)}× faster (median ${formatDuration(repeat * 1000)} vs ${formatDuration(first * 1000)} first time)` };
  }
  if (first != null) return { factor: null, text: `First-time median ${formatDuration(first * 1000)} · no repeat bug yet` };
  return { factor: null, text: 'No timed cases yet' };
}

/**
 * Ledger-panel entries ("recurring patterns" + "recent entries") from the Medical Record cases.
 * The memory index replaced .shakefix/ledger/index.json, which agents no longer write.
 * @returns {Array<{id, iid, route, pattern, rootCause, files}>}  oldest first (the panel shows newest first)
 */
export function ledgerEntriesFromMemory(index) {
  const cases = Array.isArray(index?.cases) ? index.cases : [];
  return cases
    .filter((c) => c && c.iid != null)
    .slice()
    .sort((a, b) => a.iid - b.iid)
    .map((c) => ({
      id: String(c.iid),
      iid: c.iid,
      route: c.route ?? null,
      pattern: c.pattern ?? c.root_cause?.pattern ?? null,
      rootCause: c.summary ?? c.root_cause?.summary ?? '',
      files: Array.isArray(c.files) ? c.files : c.file ? [c.file] : [],
    }));
}
