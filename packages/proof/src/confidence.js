// Fix Confidence 0–100 with a GO / HOLD / BLOCK verdict. Deterministic: no model call.
//
// Start at 100 and subtract for every risk we can see:
//
//   regression spec   fail on base → pass on head: 0 · not measured: −10 · passed on base too
//                     (bug not proven): −25 · still fails on head: BLOCK
//   unit tests        green: 0 · unknown: −5 · red: BLOCK
//   Second Opinion    −25 per unintended change (max −75) · any unintended: BLOCK
//   policy            −20 per policy hit (max −40) · −10 per limit violation: HOLD
//   Attending         approve:false → BLOCK · −(1 − confidence) × 30 · −3 per concern (max −15)
//   memory premortem  high −20 · medium −10 · low 0 · numeric 0..1 → −risk × 20
//   re-operation      −5 when this is the second surgery
//
// Verdict: BLOCK if any blocker; else HOLD if score < threshold (FIX_CONFIDENCE_MIN, default 80)
// or there is a policy hit / limit violation; else GO. Only GO may auto-merge.

export const DEFAULT_FIX_CONFIDENCE_MIN = 80;

export function confidenceThreshold(env = process.env) {
  const n = Number(env?.FIX_CONFIDENCE_MIN);
  return Number.isFinite(n) && n >= 0 && n <= 100 && String(env?.FIX_CONFIDENCE_MIN ?? '').trim() !== '' ? n : DEFAULT_FIX_CONFIDENCE_MIN;
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/** "pass" | "fail" | "unknown" from loose inputs (true/false, "success", "failed", …). */
export function normalizeStatus(v) {
  if (v === true) return 'pass';
  if (v === false) return 'fail';
  const s = String(v ?? '').trim().toLowerCase();
  if (['pass', 'passed', 'success', 'green', 'ok'].includes(s)) return 'pass';
  if (['fail', 'failed', 'failure', 'red', 'error'].includes(s)) return 'fail';
  return 'unknown';
}

/**
 * Regression outcome from proof.json: replay flows carry `reproduction: {base:{passed}, head:{passed}}`
 * (written by `proof run`). Returns "fail-pass" | "pass-pass" | "fail-fail" | "pass-fail" | "unknown".
 */
export function regressionFromProof(proof) {
  const all = (proof?.flows ?? []).filter((f) => f?.source === 'replay' && f.reproduction);
  // The agents' regression spec (scripts/ci/spec-reproduction.mjs) is the stronger proof: it encodes
  // the reported symptom even when the raw replay can't (masked input, no expectation). Prefer it.
  const specs = all.filter((f) => f.kind === 'regression-spec');
  const flows = specs.length ? specs : all;
  if (!flows.length) return proof?.summary?.regression ?? 'unknown';
  const side = (k) => (flows.every((f) => f.reproduction?.[k]?.passed === true) ? 'pass' : flows.some((f) => f.reproduction?.[k]?.passed === false) ? 'fail' : null);
  const b = side('base');
  const h = side('head');
  return b && h ? `${b}-${h}` : 'unknown';
}

function parseRisk(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.min(1, v > 1 ? v / 100 : v)) : null;
  const s = String(v).trim().toLowerCase();
  if (s === 'high') return 1;
  if (s === 'medium' || s === 'med') return 0.5;
  if (s === 'low' || s === 'none') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? parseRisk(n) : null;
}

/**
 * The Attending's JSON ({approve, confidence, concerns, policy_hits}) from MR text (description + notes),
 * last one wins. Also picks up a memory premortem `{"premortem": {"risk": "high"}}` or `"premortem_risk"`.
 * @param {string[]} texts
 * @returns {{attending: object|null, premortemRisk: number|null}}
 */
export function signalsFromTexts(texts) {
  let attending = null;
  let premortemRisk = null;
  for (const text of texts ?? []) {
    for (const obj of jsonObjectsIn(String(text ?? ''))) {
      if (typeof obj.approve === 'boolean') {
        let c = Number(obj.confidence);
        if (Number.isFinite(c) && c > 1) c /= 100;
        attending = {
          approve: obj.approve,
          confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : null,
          concerns: Array.isArray(obj.concerns) ? obj.concerns.map(String) : [],
          policyHits: Array.isArray(obj.policy_hits) ? obj.policy_hits.map(String) : [],
        };
      }
      // `shakefix-memory premortem` output pasted as-is (docs/CONTRACTS.md): top-level risk + autonomy/policy_hit.
      const isPremortem = 'risk' in obj && ('autonomy' in obj || 'policy_hit' in obj || 'seen_before_line' in obj);
      const r = parseRisk(obj.premortem_risk ?? obj.premortem?.risk ?? obj.premortemRisk ?? (isPremortem ? obj.risk : null));
      if (r != null) premortemRisk = r;
    }
  }
  return { attending, premortemRisk };
}

/** Every balanced {...} that parses as a JSON object (ignores prose and code fences around it). */
export function jsonObjectsIn(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') j++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          const v = JSON.parse(text.slice(i, j + 1));
          if (v && typeof v === 'object' && !Array.isArray(v)) { out.push(v); i = j; }
        } catch { /* not JSON: keep scanning from i+1 */ }
        break;
      }
    }
  }
  return out;
}

/**
 * @param {object} i
 * @param {string} [i.regression]      "fail-pass" | "pass-pass" | "fail-fail" | "pass-fail" | "unknown"
 * @param {string|boolean} [i.unit]    pass | fail | unknown
 * @param {number} [i.unintended]      Second Opinion unintended count
 * @param {number} [i.policyHits]      count of policy hits
 * @param {number} [i.limitViolations] count of limit violations
 * @param {object|null} [i.attending]  {approve, confidence 0..1, concerns[]}
 * @param {number|string|null} [i.premortemRisk]  0..1 or low|medium|high
 * @param {number} [i.attempt]         1 = first surgery, 2 = re-operation
 * @param {number} [i.threshold]       FIX_CONFIDENCE_MIN
 */
export function computeFixConfidence(i = {}) {
  const threshold = Number.isFinite(i.threshold) ? i.threshold : DEFAULT_FIX_CONFIDENCE_MIN;
  const factors = [];
  const blockers = [];
  const holds = [];
  const add = (key, label, points, detail) => factors.push({ key, label, points: Math.round(points), detail });

  const reg = i.regression || 'unknown';
  if (reg === 'fail-pass') add('regression', 'Regression spec fails on base, passes on head', 0, 'bug proven, fix proven');
  else if (reg === 'pass-pass') add('regression', 'Regression spec also passes on base', -25, 'the bug was not reproduced, so the fix is unproven');
  else if (reg === 'fail-fail' || reg === 'pass-fail') {
    add('regression', 'Regression spec fails on head', -60, 'the fix does not make the reporter\'s flow pass');
    blockers.push('regression spec still fails on the fix');
  } else add('regression', 'Regression spec not measured', -10, 'no fail→pass evidence in proof.json');

  const unit = normalizeStatus(i.unit);
  if (unit === 'pass') add('unit', 'Unit tests green', 0);
  else if (unit === 'fail') { add('unit', 'Unit tests red', -50); blockers.push('unit tests fail'); }
  else add('unit', 'Unit tests: status unknown', -5);

  const un = Math.max(0, Number(i.unintended) || 0);
  if (un > 0) { add('second_opinion', `Second Opinion: ${un} unintended change${un === 1 ? '' : 's'}`, -Math.min(75, 25 * un)); blockers.push(`${un} unintended change(s)`); }
  else add('second_opinion', 'Second Opinion: 0 unintended changes', 0);

  const hits = Math.max(0, Number(i.policyHits) || 0);
  if (hits) { add('policy', `${hits} policy hit${hits === 1 ? '' : 's'}`, -Math.min(40, 20 * hits)); holds.push('policy needs a human'); }
  const lv = Math.max(0, Number(i.limitViolations) || 0);
  if (lv) { add('limits', `${lv} policy limit violation${lv === 1 ? '' : 's'}`, -10 * lv); holds.push('fix is over the policy size limits'); }

  const a = i.attending;
  if (a) {
    if (a.approve === false) { add('attending', 'Attending did not approve', -50); blockers.push('Attending did not approve'); }
    if (Number.isFinite(a.confidence)) add('attending_confidence', `Attending confidence ${Math.round(a.confidence * 100)}%`, -(1 - a.confidence) * 30);
    const c = (a.concerns ?? []).length;
    if (c) add('attending_concerns', `${c} Attending concern${c === 1 ? '' : 's'}`, -Math.min(15, 3 * c));
  }

  const risk = parseRisk(i.premortemRisk);
  if (risk != null) add('premortem', `Memory premortem risk ${risk >= 1 ? 'high' : risk >= 0.5 ? 'medium' : risk > 0 ? Math.round(risk * 100) + '%' : 'low'}`, -risk * 20);

  if ((Number(i.attempt) || 1) > 1) add('reoperation', 'Second surgery on this MR', -5);

  const score = clamp(100 + factors.reduce((s, f) => s + f.points, 0));
  let verdict = 'GO';
  let reason = `${score} ≥ ${threshold}`;
  if (blockers.length) { verdict = 'BLOCK'; reason = blockers.join('; '); }
  else if (holds.length) { verdict = 'HOLD'; reason = holds.join('; '); }
  else if (score < threshold) { verdict = 'HOLD'; reason = `${score} < threshold ${threshold}`; }
  return { score, verdict, threshold, reason, factors, blockers, holds };
}

const ICON = { GO: '✅', HOLD: '✋', BLOCK: '⛔' };

/** Markdown block for the Second Opinion MR card. */
export function renderConfidence(fc) {
  if (!fc) return '';
  const lines = [`**Fix Confidence ${fc.score}/100 · ${ICON[fc.verdict]} ${fc.verdict}** (team threshold ${fc.threshold}) — ${fc.reason}`];
  const shown = fc.factors.filter((f) => f.points !== 0 || ['regression', 'second_opinion'].includes(f.key));
  if (shown.length) lines.push(shown.map((f) => `${f.points === 0 ? '✓' : f.points}` + ` ${f.label}`).join(' · '));
  return lines.join('\n');
}

/** Compact form exported in proof.json summary.fix_confidence. */
export function summaryOf(fc) {
  return { score: fc.score, verdict: fc.verdict, threshold: fc.threshold, reason: fc.reason, factors: fc.factors.map(({ key, points }) => ({ key, points })) };
}
