// Gate logic (§11.7 + §15). Pure except for minimatch.

import { minimatch } from 'minimatch';
import { counts } from './report.js';
import { computeFixConfidence, regressionFromProof, DEFAULT_FIX_CONFIDENCE_MIN } from './confidence.js';

export const EXIT = Object.freeze({ READY: 0, ERROR: 1, UNINTENDED: 10, NEEDS_HUMAN: 11 });
export const LOCKFILES = Object.freeze(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'npm-shrinkwrap.json', 'bun.lockb']);

// ---------------------------------------------------------------------------
// Minimal YAML subset parser (maps, block lists, scalars, inline [a, b] lists, comments).
// Enough for .shakefix/policy.yml; avoids an extra dependency.
// ---------------------------------------------------------------------------

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

export function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^"(.*)"$/.test(s)) return JSON.parse(s);
  if (/^'(.*)'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\[.*\]$/.test(s)) {
    const inner = s.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => parseScalar(x)) : [];
  }
  if (s === '{}') return {};
  return s;
}

function splitKey(text) {
  // key: value  (first ':' followed by space or end of line, outside quotes)
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === ':' && (i === text.length - 1 || text[i + 1] === ' ')) {
      return [parseScalar(text.slice(0, i)), text.slice(i + 1).trim()];
    }
  }
  return null;
}

export function parseYaml(src) {
  const lines = [];
  for (const raw of String(src).split(/\r?\n/)) {
    const l = stripComment(raw).replace(/\s+$/, '');
    if (!l.trim() || l.trim() === '---') continue;
    lines.push({ indent: l.length - l.trimStart().length, text: l.trim() });
  }
  const [v] = parseBlock(lines, 0, lines.length ? lines[0].indent : 0);
  return v ?? {};
}

function parseBlock(lines, i, indent) {
  if (i >= lines.length) return [null, i];
  if (lines[i].text.startsWith('- ') || lines[i].text === '-') return parseList(lines, i, indent);
  return parseMap(lines, i, indent);
}

function parseList(lines, i, indent) {
  const out = [];
  while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
    const rest = lines[i].text.slice(1).trim();
    if (!rest) {
      const next = lines[i + 1];
      if (next && next.indent > indent) {
        const [v, j] = parseBlock(lines, i + 1, next.indent);
        out.push(v); i = j;
      } else { out.push(null); i++; }
      continue;
    }
    if (splitKey(rest)) {
      // map item: re-home the first key at indent+2
      const childIndent = indent + 2;
      const copy = lines.slice();
      copy[i] = { indent: childIndent, text: rest };
      const [v, j] = parseMap(copy, i, childIndent);
      out.push(v); i = j;
    } else {
      out.push(parseScalar(rest)); i++;
    }
  }
  return [out, i];
}

function parseMap(lines, i, indent) {
  const out = {};
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('- ')) {
    const kv = splitKey(lines[i].text);
    if (!kv) throw new Error(`policy.yml: cannot parse line "${lines[i].text}"`);
    const [k, v] = kv;
    if (v !== '') { out[k] = parseScalar(v); i++; continue; }
    const next = lines[i + 1];
    if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')))) {
      const [val, j] = parseBlock(lines, i + 1, next.indent);
      out[k] = val; i = j;
    } else { out[k] = null; i++; }
  }
  return [out, i];
}

// ---------------------------------------------------------------------------
// Diff file list: plain paths, or `git diff --numstat` lines (added<TAB>deleted<TAB>path).
// ---------------------------------------------------------------------------

function renamedTarget(p) {
  // "{old => new}/file" or "a/{x => y}.js" or "old => new"
  if (p.includes('{') && p.includes(' => ')) return p.replace(/\{[^{}]*? => ([^{}]*?)\}/g, '$1').replace(/\/\//g, '/');
  if (p.includes(' => ')) return p.split(' => ').pop();
  return p;
}

export function parseDiffFiles(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(raw.replace(/\r$/, ''));
    if (m) {
      out.push({
        path: renamedTarget(m[3].trim()),
        added: m[1] === '-' ? 0 : Number(m[1]),
        deleted: m[2] === '-' ? 0 : Number(m[2]),
      });
    } else {
      out.push({ path: renamedTarget(line), added: null, deleted: null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Policy checks
// ---------------------------------------------------------------------------

/** Returns [{file, match, autonomy, reason}] for every file that hits a non-hands-off rule. */
export function policyHits(policy, files) {
  const hits = [];
  for (const f of files) {
    for (const r of policy?.rules || []) {
      if (!r?.match) continue;
      if (minimatch(f.path, r.match, { dot: true }) && (r.autonomy || 'hands-off') !== 'hands-off') {
        hits.push({ file: f.path, match: r.match, autonomy: r.autonomy, reason: r.reason || null });
      }
    }
  }
  return hits;
}

/** Returns a list of human-readable limit violations. */
// Medical Record case files (.shakefix/memory/**, docs/MEMORY.md) are bookkeeping, not the fix:
// they never count toward max_files_changed / max_lines_changed.
const isBookkeeping = (p) => String(p).startsWith('.shakefix/memory/');

export function limitViolations(policy, allFiles) {
  const files = allFiles.filter((f) => !isBookkeeping(f.path));
  const lim = policy?.limits || {};
  const out = [];
  if (Number.isFinite(lim.max_files_changed) && files.length > lim.max_files_changed) {
    out.push(`files changed ${files.length} > max_files_changed ${lim.max_files_changed}`);
  }
  if (Number.isFinite(lim.max_lines_changed) && files.length && files.every((f) => f.added !== null)) {
    const lines = files.reduce((s, f) => s + f.added + f.deleted, 0);
    if (lines > lim.max_lines_changed) out.push(`lines changed ${lines} > max_lines_changed ${lim.max_lines_changed}`);
  }
  if (lim.forbid_new_dependencies) {
    const lock = files.find((f) => LOCKFILES.includes(f.path.split('/').pop()));
    if (lock) out.push(`forbid_new_dependencies: lockfile changed (${lock.path})`);
  }
  return out;
}

/**
 * Decide the gate outcome.
 * @param {object} p
 * @param {object} p.proof     labeled proof.json
 * @param {object} p.policy    parsed policy.yml
 * @param {Array}  p.files     parseDiffFiles() output
 * @param {string[]} p.labels  current MR labels
 * @param {number} p.attempt   1 = first Second Opinion verdict on this MR, 2 = after a re-operation
 * @param {object} [p.confidence] extra Fix Confidence inputs {unit, attending, premortemRisk, threshold, regression}
 * @returns {{code:number, status:'ready'|'unintended'|'needs-human', reason:string, counts:object, hits:Array, violations:string[]}}
 */
export function evaluateGate({ proof, policy = {}, files = [], labels = [], attempt = 1, confidence = {} }) {
  if (!proof || proof.schema !== 'shakefix.proof/v1') throw new Error('gate: input is not a shakefix.proof/v1 document');
  const n = counts(proof);
  const hits = policyHits(policy, files);
  const violations = limitViolations(policy, files);
  const fixConfidence = computeFixConfidence({
    regression: confidence.regression ?? regressionFromProof(proof),
    unit: confidence.unit,
    // block_on_unintended: false is the team's explicit opt-out; don't let the score re-block it.
    unintended: policy?.proof?.block_on_unintended === false ? 0 : n.unintended,
    policyHits: hits.length,
    limitViolations: violations.length,
    attending: confidence.attending ?? null,
    premortemRisk: confidence.premortemRisk ?? null,
    attempt: Math.max(attempt || 1, labels.includes('shakefix::unintended') ? 2 : 1),
    threshold: Number.isFinite(confidence.threshold) ? confidence.threshold : DEFAULT_FIX_CONFIDENCE_MIN,
  });
  const base = { counts: n, hits, violations, fixConfidence };

  const autonomy = policy.autonomy_default || 'hands-off';
  if (autonomy !== 'hands-off') {
    return { ...base, code: EXIT.NEEDS_HUMAN, status: 'needs-human', reason: `policy: autonomy_default is ${autonomy}` };
  }
  if (hits.length) {
    const h = hits[0];
    return {
      ...base, code: EXIT.NEEDS_HUMAN, status: 'needs-human',
      reason: `policy: ${h.file} matches "${h.match}" (${h.autonomy})${h.reason ? ` — ${h.reason}` : ''}`,
    };
  }
  if (violations.length) {
    return { ...base, code: EXIT.NEEDS_HUMAN, status: 'needs-human', reason: `limits: ${violations.join('; ')}` };
  }
  if (labels.includes('needs-human')) {
    return { ...base, code: EXIT.NEEDS_HUMAN, status: 'needs-human', reason: 'MR already carries the needs-human label' };
  }
  const block = policy?.proof?.block_on_unintended !== false;
  // Unintended by the rules but the model disagrees: neither side may decide alone, so a human does.
  const disputed = (proof.flows ?? []).flatMap((f) => f.changes ?? []).filter((c) => c.label === 'unintended' && c.disputed).length;
  if (n.unintended > 0 && block && disputed === n.unintended) {
    return {
      ...base, code: EXIT.NEEDS_HUMAN, status: 'needs-human',
      reason: `${disputed} change(s) the rules call unintended and the model calls intended: a human decides`,
    };
  }
  if (n.unintended > 0 && block) {
    const maxReops = Number.isFinite(policy?.proof?.max_reoperations) ? policy.proof.max_reoperations : 1;
    const effectiveAttempt = Math.max(attempt || 1, labels.includes('shakefix::unintended') ? 2 : 1);
    const reopsUsed = effectiveAttempt - 1;
    if (reopsUsed >= maxReops) {
      return {
        ...base, code: EXIT.NEEDS_HUMAN, status: 'needs-human',
        reason: `${n.unintended} unintended change(s) after ${reopsUsed} re-operation(s) (max ${maxReops})`,
      };
    }
    return {
      ...base, code: EXIT.UNINTENDED, status: 'unintended',
      reason: `${n.unintended} unintended change(s) (re-operation ${reopsUsed + 1} of ${maxReops})`,
    };
  }
  // Auto-merge only on GO: a team threshold (FIX_CONFIDENCE_MIN) on the deterministic Fix Confidence.
  if (fixConfidence.verdict !== 'GO') {
    return {
      ...base, code: EXIT.NEEDS_HUMAN, status: 'needs-human',
      reason: `Fix Confidence ${fixConfidence.score}/100 ${fixConfidence.verdict}: ${fixConfidence.reason}`,
    };
  }
  return {
    ...base, code: EXIT.READY, status: 'ready',
    reason: `${n.changes} change(s), ${n.intended} intended, ${n.unintended} unintended${!block && n.unintended ? ' (block_on_unintended: false)' : ''}`,
  };
}
