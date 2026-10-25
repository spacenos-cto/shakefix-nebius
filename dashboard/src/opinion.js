// Second Opinion tab: per-case intended / unintended / flaky bars, and the controls scorecard
// (./controls.json: planted-bad, harmless and real-fix MRs with the verdict we expected). Pure, no DOM.

/** One bar per case that has a Second Opinion result. `scale` is the bar length relative to the largest case. */
export function proofBars(cards) {
  const rows = (Array.isArray(cards) ? cards : [])
    .filter((c) => c?.proof?.known)
    .map((c) => {
      const intended = Number(c.proof.intended) || 0;
      const unintended = Number(c.proof.unintended) || 0;
      const flaky = Number(c.proof.flaky) || 0;
      return { rid: c.rid, iid: c.iid, title: c.title, state: c.state, intended, unintended, flaky, total: intended + unintended + flaky };
    });
  const max = Math.max(1, ...rows.map((r) => r.total));
  return rows
    .map((r) => ({ ...r, scale: r.total / max }))
    .sort((a, b) => (b.iid ?? 0) - (a.iid ?? 0));
}

export function proofTotals(bars) {
  return (bars ?? []).reduce((t, b) => ({ intended: t.intended + b.intended, unintended: t.unintended + b.unintended, flaky: t.flaky + b.flaky }), { intended: 0, unintended: 0, flaky: 0 });
}

const KINDS = new Set(['planted-bad', 'harmless', 'real-fix']);

function verdict(v) {
  const s = String(v ?? '').toLowerCase().trim();
  if (['block', 'blocked', 'fail', 'failed', 'red'].includes(s)) return 'block';
  if (['pass', 'passed', 'ok', 'green', 'allow', 'allowed'].includes(s)) return 'pass';
  return null;
}

/**
 * Controls scorecard. Positive = "block". Returns null when there is no usable file (missing, not an
 * array, or no valid rows), so the page can say "No control runs yet".
 */
export function controlsScore(raw) {
  if (!Array.isArray(raw)) return null;
  const rows = raw
    .filter((r) => r && typeof r === 'object' && KINDS.has(r.kind))
    .map((r) => {
      const expected = verdict(r.expected) ?? (r.kind === 'planted-bad' ? 'block' : 'pass');
      const actual = verdict(r.actual);
      return { mr: r.mr ?? null, kind: r.kind, expected, actual, ok: actual != null && actual === expected };
    });
  if (!rows.length) return null;
  const done = rows.filter((r) => r.actual != null);
  const tp = done.filter((r) => r.expected === 'block' && r.actual === 'block').length;
  const fn = done.filter((r) => r.expected === 'block' && r.actual === 'pass').length;
  const fp = done.filter((r) => r.expected === 'pass' && r.actual === 'block').length;
  const tn = done.filter((r) => r.expected === 'pass' && r.actual === 'pass').length;
  return {
    rows,
    total: rows.length,
    ran: done.length,
    pending: rows.length - done.length,
    correct: done.filter((r) => r.ok).length,
    tp, fp, fn, tn,
    // Of the MRs Second Opinion blocked, how many deserved it; of the bad ones, how many it blocked.
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
  };
}
