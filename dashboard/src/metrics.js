// Pure helpers for the ER Board: normalise /v1/board payloads, place cards in columns,
// compute headline metrics. No DOM here, so node --test can cover it.

export const COLUMNS = [
  { id: 'triage', title: 'Triage', states: ['received', 'triaging', 'reopened'] },
  { id: 'surgery', title: 'Surgery', states: ['in-surgery', 'unintended'] },
  { id: 'proof', title: 'Second Opinion', states: ['proof'] },
  { id: 'recovery', title: 'Recovery', states: ['ready', 'merged', 'deploying'] },
  { id: 'discharged', title: 'Discharged', states: ['deployed'] },
  { id: 'verified', title: 'Verified', states: ['verified'] },
  { id: 'human', title: 'Needs human', states: ['needs-human', 'needs-info', 'rolled-back'] },
];

const STATE_ALIASES = {
  'shakefix::triaging': 'triaging',
  'shakefix::in-surgery': 'in-surgery',
  'shakefix::proof': 'proof',
  'shakefix::ready': 'ready',
  'shakefix::unintended': 'unintended',
  'shakefix::deployed': 'deployed',
  'shakefix::rolled-back': 'rolled-back',
  'shakefix::verified': 'verified',
  'shakefix::reopened': 'reopened',
  fixed: 'deployed',
};

const toMs = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** States where the fix is live (discharged, with or without the reporter's 👍). */
export const LIVE_STATES = ['deployed', 'verified'];
const VERDICTS = new Set(['confirmed', 'rejected']);

/** Accepts {cards:[...]}, {reports:[...]} or a bare array. Unknown fields are ignored. */
export function normalizeBoard(payload) {
  const list = Array.isArray(payload) ? payload : payload?.cards ?? payload?.items ?? payload?.reports ?? [];
  return list
    .filter((c) => c && typeof c === 'object')
    // Closed without a shipped fix (superseded, duplicate, refused): not a patient any more.
    .filter((c) => String(c.state ?? '').toLowerCase() !== 'closed')
    .map((c) => {
      const rawState = String(c.state ?? 'received').toLowerCase();
      const state = STATE_ALIASES[rawState] ?? rawState;
      const proof = c.proof ?? {};
      const ts = c.timestamps ?? {};
      c = { ...c, createdAt: c.createdAt ?? ts.createdAt ?? ts.received, updatedAt: c.updatedAt ?? ts.updatedAt, fixedAt: c.fixedAt ?? ts.fixedAt ?? ts.deployed };
      return {
        rid: String(c.rid ?? ''),
        iid: c.issueIid ?? c.iid ?? null,
        title: String(c.title ?? c.note ?? 'Untitled report'),
        sev: Math.min(3, Math.max(1, num(c.sev ?? c.severity ?? 3) || 3)),
        state,
        createdAt: toMs(c.createdAt),
        updatedAt: toMs(c.updatedAt) ?? toMs(c.createdAt),
        fixedAt: toMs(c.fixedAt ?? c.deployedAt),
        mrIid: c.mrIid ?? null,
        issueUrl: c.issueUrl ?? null,
        mrUrl: c.mrUrl ?? null,
        pipelineUrl: c.pipelineUrl ?? null,
        pipelineId: c.pipelineId ?? c.pipelineIid ?? null,
        route: c.route ?? null,
        proof: {
          intended: num(proof.intended),
          unintended: num(proof.unintended ?? proof.caught),
          flaky: num(proof.flaky),
          known: proof.intended != null || proof.unintended != null,
        },
        autonomy: c.autonomy ?? (state === 'needs-human' ? 'supervised' : 'hands-off'),
        rollbacks: num(c.rollbacks ?? (state === 'rolled-back' ? 1 : 0)),
        reoperations: num(c.reoperations),
        // Human actions on the case (approvals, merges, notes, pushes, edits); null when the intake doesn't say.
        humanTouches: c.humanTouches == null ? null : num(c.humanTouches),
        demo: c.demo === true,
        // Reporter verdict on the current fix: 'confirmed' (👍), 'rejected' (👎) or null.
        verdict: VERDICTS.has(c.verdict) ? c.verdict : state === 'verified' ? 'confirmed' : null,
        verdicts: { confirmed: num(c.verdicts?.confirmed), rejected: num(c.verdicts?.rejected) },
      };
    });
}

export function columnFor(card) {
  return COLUMNS.find((col) => col.states.includes(card.state))?.id ?? 'triage';
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Headline metrics. Server-provided metrics (payload.metrics) win when present. */
export function computeMetrics(cards, serverMetrics = {}) {
  const fixed = cards.filter((c) => LIVE_STATES.includes(c.state) && c.createdAt && c.fixedAt);
  const durations = fixed.map((c) => c.fixedAt - c.createdAt);
  const last = fixed.slice().sort((a, b) => b.fixedAt - a.fixedAt)[0];
  const finished = cards.filter((c) => [...LIVE_STATES, 'needs-human', 'rolled-back'].includes(c.state));
  // Hands-off means nobody touched it: a case with any recorded human touch does not count.
  const handsOff = cards.filter((c) => LIVE_STATES.includes(c.state) && c.autonomy === 'hands-off' && !c.humanTouches);
  // Reporter verdicts: share of delivered fixes the reporter confirmed (👍) out of all that got a verdict.
  const confirmed = cards.filter((c) => c.verdict === 'confirmed').length;
  const rejected = cards.filter((c) => c.verdict === 'rejected').length;
  const judged = confirmed + rejected;

  return {
    medianMs: serverMetrics.medianShakeToFixedMs ?? median(durations),
    lastMs: serverMetrics.lastShakeToFixedMs ?? (last ? last.fixedAt - last.createdAt : null),
    handsOffPct:
      serverMetrics.handsOffPct ?? (finished.length ? Math.round((100 * handsOff.length) / finished.length) : null),
    finished: finished.length,
    unintendedCaught: serverMetrics.unintendedCaught ?? cards.reduce((s, c) => s + c.proof.unintended, 0),
    rollbacks: serverMetrics.rollbacks ?? cards.reduce((s, c) => s + c.rollbacks, 0),
    confirmedPct: serverMetrics.confirmedPct ?? (judged ? Math.round((100 * confirmed) / judged) : null),
    confirmed: serverMetrics.confirmed ?? confirmed,
    rejected: serverMetrics.rejected ?? rejected,
    awaitingVerdict: cards.filter((c) => c.state === 'deployed' && c.verdict == null).length,
  };
}

/** Ledger index.json -> [{pattern, count, routes}] sorted by count desc. */
export function ledgerPatterns(entries) {
  const map = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    const key = String(e?.pattern || 'unclassified');
    const row = map.get(key) ?? { pattern: key, count: 0, routes: new Set() };
    row.count += 1;
    if (e?.route) row.routes.add(String(e.route));
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, routes: [...r.routes] }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
