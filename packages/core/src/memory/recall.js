// Recall ("Seen before") and pre-mortem for the Medical Record. Fully deterministic:
// route match + testid Jaccard + TF-IDF cosine over symptom / root-cause text + file overlap.

import {
  basename, cosine, idfOf, intersect, jaccard, normalizePath, normalizeRoute, normalizeTestid, overlap, round2, routeSimilarity, tfidf, tokenize,
} from './text.js';

export const WEIGHTS = Object.freeze({ route: 0.25, testids: 0.25, text: 0.35, files: 0.15 });
export const MIN_SCORE = 0.2; // below this a case is not returned by recall
export const SEEN_SCORE = 0.45; // at or above this a case counts as "seen before"

const uniq = (a) => [...new Set((a ?? []).filter(Boolean))];
const csv = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);

// ---------------------------------------------------------------------------------- queries

const expectationText = (e) => (e ? [e.testid, e.state, e.text].filter(Boolean).join(' ') : '');

/** Top console error of a replay (first error, else first warning). */
export function topConsoleError(replay) {
  const c = replay?.console ?? [];
  const top = c.find((x) => x.level === 'error') ?? c.find((x) => x.level === 'warn');
  return top ? String(top.msg ?? '').slice(0, 300) : null;
}

/** Last route a replay visited (startRoute if no actions). */
export function lastRoute(replay) {
  const acts = replay?.actions ?? [];
  for (let i = acts.length - 1; i >= 0; i--) if (acts[i].route) return acts[i].route;
  return replay?.startRoute ?? '';
}

/** A recall query from a shakefix.replay/v1 object. */
export function queryFromReplay(replay) {
  const testids = uniq([...(replay?.actions ?? []).map((a) => a.testid), replay?.expectation?.testid]);
  return {
    route: lastRoute(replay),
    testids,
    consoleMsg: topConsoleError(replay) ?? '',
    note: replay?.note ?? '',
    expectation: expectationText(replay?.expectation),
    rid: replay?.rid ?? null,
  };
}

/**
 * A recall query from a ShakeFix issue description (services/intake/src/render.js issueBody):
 * uses the inline replay JSON when present, else the note / route / console sections.
 */
export function queryFromIssueText(md) {
  const s = String(md ?? '').replace(/\r\n/g, '\n');
  const block = /```json\n([\s\S]*?)\n```/.exec(s);
  if (block) {
    try { return queryFromReplay(JSON.parse(block[1])); } catch { /* truncated replay: fall through */ }
  }
  const note = /\*\*Reporter note:\*\*\s*(.*)/.exec(s)?.[1]?.trim() ?? '';
  const route = /\*\*Route:\*\*\s*`([^`]*)`/.exec(s)?.[1] ?? '';
  const consoleMsg = /### Top console error\n```\n([\s\S]*?)\n```/.exec(s)?.[1]?.split('\n')[0] ?? '';
  const testids = uniq([...s.matchAll(/data-testid=\\?"([^"\\]+)\\?"/g)].map((m) => m[1]));
  const rid = /shakefix:rid=([A-Za-z0-9_.-]+)/.exec(s)?.[1] ?? null;
  return { route, testids, consoleMsg: consoleMsg === '(none)' ? '' : consoleMsg, note: note === '(no note)' ? '' : note, expectation: '', rid };
}

/** Merge explicit fields over a base query (explicit wins when set). */
export function mergeQuery(base = {}, over = {}) {
  const q = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    q[k] = v;
  }
  q.testids = csv(q.testids);
  q.files = csv(q.files).map(normalizePath);
  return q;
}

// ---------------------------------------------------------------------------------- documents

export const caseFiles = (c) => uniq([c.root_cause?.file, ...(c.fix?.files ?? [])].filter(Boolean).map(normalizePath));

/** Files of a case plus the files of lessons learned on it (the area the case taught us about). */
export const caseAreaFiles = (memory, c) =>
  uniq([...caseFiles(c), ...(memory.lessons ?? []).filter((l) => l.case === c.iid).flatMap((l) => l.files.map(normalizePath))]);

/** The text a case contributes to TF-IDF. */
export function caseDoc(c) {
  return tokenize([
    c.symptom?.note, c.symptom?.expectation, c.symptom?.console_error,
    c.root_cause?.summary, String(c.root_cause?.pattern ?? '').replace(/-/g, ' '),
    ...(c.testids ?? []).map(normalizeTestid), ...caseFiles(c).map((f) => basename(f).replace(/\.\w+$/, '')),
  ].filter(Boolean).join(' '));
}

export function queryDoc(q) {
  return tokenize([
    q.note, q.consoleMsg, q.expectation, q.pattern && String(q.pattern).replace(/-/g, ' '),
    ...(q.testids ?? []).map(normalizeTestid), ...(q.files ?? []).map((f) => basename(f).replace(/\.\w+$/, '')),
  ].filter(Boolean).join(' '));
}

function fileScore(qFiles, cFiles) {
  if (!qFiles.length || !cFiles.length) return { score: 0, shared: [] };
  const full = intersect(qFiles, cFiles);
  const base = intersect(qFiles.map(basename), cFiles.map(basename));
  const s = Math.max(overlap(qFiles, cFiles), 0.8 * overlap(qFiles.map(basename), cFiles.map(basename)));
  return { score: s, shared: full.length ? full : base };
}

// ---------------------------------------------------------------------------------- recall

/**
 * Top-k similar past cases. Returns [{iid, score, reasons[], why, route, pattern, root_cause,
 * fix:{files, attempts, mr}, lessons[]}] sorted by score (ties: newer case first).
 * Only signals present in the query are weighted (a query without files is not penalised).
 */
export function recall(memory, query, { limit = 3, minScore = MIN_SCORE, exclude = [] } = {}) {
  const q = mergeQuery({}, query);
  const cases = (memory.cases ?? []).filter((c) => !exclude.includes(c.iid) && !(q.iid && c.iid === Number(q.iid)));
  if (!cases.length) return [];
  const docs = cases.map(caseDoc);
  const qd = queryDoc(q);
  const idf = idfOf([...docs, qd]);
  const qv = tfidf(qd, idf);
  const qTest = q.testids.map(normalizeTestid);
  const qRoute = q.route ? normalizeRoute(q.route) : '';

  const out = [];
  cases.forEach((c, i) => {
    const sig = {};
    const reasons = [];
    if (qRoute) {
      sig.route = routeSimilarity(qRoute, c.route);
      if (sig.route === 1) reasons.push(`same route ${c.route}`);
      else if (sig.route > 0) reasons.push(`related route ${c.route}`);
    }
    if (qTest.length) {
      const cTest = (c.testids ?? []).map(normalizeTestid);
      sig.testids = jaccard(qTest, cTest);
      const shared = intersect(qTest, cTest);
      if (shared.length) reasons.push(`testids ${shared.length}/${new Set([...qTest, ...cTest]).size} shared (${shared.slice(0, 3).join(', ')})`);
    }
    if (qd.length) {
      const { score, terms } = cosine(qv, tfidf(docs[i], idf));
      sig.text = score;
      if (score >= 0.05 && terms.length) reasons.push(`symptom text ${round2(score)} (${terms.join(', ')})`);
    }
    if (q.files.length) {
      const { score, shared } = fileScore(q.files, caseAreaFiles(memory, c));
      sig.files = score;
      if (shared.length) reasons.push(`files ${shared.map(basename).join(', ')}`);
    }
    if (q.pattern && c.root_cause?.pattern && q.pattern === c.root_cause.pattern) reasons.push(`same pattern ${q.pattern}`);
    let wsum = 0;
    let total = 0;
    for (const [k, v] of Object.entries(sig)) {
      wsum += WEIGHTS[k];
      total += WEIGHTS[k] * v;
    }
    let score = wsum ? total / wsum : 0;
    if (q.pattern && c.root_cause?.pattern === q.pattern) score = Math.min(1, score + 0.1);
    score = round2(score);
    if (score < minScore) return;
    out.push({
      iid: c.iid,
      score,
      reasons,
      why: reasons.join(' + '),
      route: c.route,
      pattern: c.root_cause?.pattern || null,
      root_cause: c.root_cause?.file ? `${c.root_cause.file}${c.root_cause.line ? `:${c.root_cause.line}` : ''} - ${c.root_cause.summary}` : c.root_cause?.summary || null,
      fix: { files: c.fix?.files ?? [], attempts: c.fix?.attempts ?? null, mr: c.fix?.mr ?? null },
      lessons: lessonsForCase(memory, c).map((l) => l.id),
    });
  });
  out.sort((a, b) => b.score - a.score || b.iid - a.iid);
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------------- lessons

const fileMatches = (lessonFile, files) => {
  const lf = normalizePath(lessonFile);
  return files.some((f) => f === lf || basename(f) === basename(lf) || (lf.endsWith('/**') && f.startsWith(lf.slice(0, -2))));
};

/** Lessons linked to a case (by case id, or by sharing one of its files). */
export function lessonsForCase(memory, c) {
  const files = caseFiles(c);
  return (memory.lessons ?? []).filter((l) => l.case === c.iid || l.files.some((f) => fileMatches(f, files)));
}

/** Lessons that apply to a set of files and/or patterns, in file order. */
export function lessonsFor(memory, { files = [], patterns = [], cases = [] } = {}) {
  const fs = csv(files).map(normalizePath);
  const ps = csv(patterns);
  return (memory.lessons ?? []).filter((l) =>
    l.files.some((f) => fileMatches(f, fs)) || l.patterns.some((p) => ps.includes(p)) || (l.case && cases.includes(l.case)));
}

// ---------------------------------------------------------------------------------- evidence

/** Cited evidence for the Patient Chart, straight from the replay (no model involved). */
export function evidenceFromReplay(replay) {
  if (!replay) return null;
  const steps = (replay.actions ?? []).map((a) => {
    const t = `${(Number(a.t || 0) / 1000).toFixed(1)}s`;
    const what = a.type === 'navigate' ? `navigate ${a.route}` : `${a.type} ${a.testid || a.selector || ''}`.trim();
    return `${t} ${what}`;
  });
  const e = replay.expectation;
  return {
    rid: replay.rid ?? null,
    steps,
    top_console_error: topConsoleError(replay),
    expectation: e ? `${e.testid} should be ${e.state}${e.text ? ` "${e.text}"` : ''}` : null,
    failed_requests: (replay.network ?? []).filter((n) => n.status >= 400).map((n) => `${n.method} ${n.path} -> ${n.status}`),
  };
}

// ---------------------------------------------------------------------------------- pre-mortem

const HARD_SOURCES = new Set(['second-opinion-block', 'reoperation']);
const recency = (c) => Date.parse(c.timestamps?.deployed_at || c.timestamps?.merged_at || c.timestamps?.operated_at || c.timestamps?.reported_at || '') || 0;

/**
 * Pre-mortem before surgery: how risky is this area, given the record?
 * Risk points: area broke before (+1, +2 at 3 or more), last fix needed 2+ attempts (+1),
 * a past fix here had side effects (Second Opinion block or re-operation, +1),
 * a reporter rejected a past fix here (+2). high >= 4 > med >= 2 > low.
 * High risk recommends supervised autonomy and the policy hit "memory:high-risk".
 */
export function premortem(memory, query, { limit = 3 } = {}) {
  const q = mergeQuery({}, query);
  const seen = recall(memory, q, { limit });
  const strong = seen.filter((m) => m.score >= SEEN_SCORE);
  const byIid = new Map((memory.cases ?? []).map((c) => [c.iid, c]));
  const areaFiles = uniq([...q.files, ...strong.flatMap((m) => caseFiles(byIid.get(m.iid)))]);
  const areaRoute = q.route ? normalizeRoute(q.route) : '';
  // The area: cases sharing a file with it (lesson files count) or recalled as "seen before".
  // A bare route match only counts when nothing more specific is known (routes like /bill/:id are broad).
  const others = (memory.cases ?? []).filter((c) => !(q.iid && c.iid === Number(q.iid)));
  let related = others.filter((c) => caseAreaFiles(memory, c).some((f) => fileMatches(f, areaFiles)) || strong.some((m) => m.iid === c.iid));
  if (!related.length && !areaFiles.length && areaRoute) related = others.filter((c) => c.route === areaRoute);
  related.sort((a, b) => recency(b) - recency(a) || b.iid - a.iid);
  const patterns = uniq([q.pattern, ...related.map((c) => c.root_cause?.pattern)]);
  const lessons = lessonsFor(memory, { files: areaFiles, patterns, cases: related.map((c) => c.iid) });

  const n = related.length;
  const last = related[0] ?? null;
  const k = last?.fix?.attempts ?? null;
  const sideEffects = related.some((c) => (c.second_opinion?.blocked_changes ?? []).length) || lessons.some((l) => HARD_SOURCES.has(l.source));
  const rejected = related.some((c) => (c.reporter_verdicts?.rejected ?? 0) > 0) || lessons.some((l) => l.source === 'reporter-rejected');

  const factors = [];
  let points = 0;
  if (n >= 3) { points += 2; factors.push(`area broke ${n} times`); } else if (n >= 1) { points += 1; factors.push(`area broke ${n} time${n === 1 ? '' : 's'}`); }
  if (k >= 2) { points += 1; factors.push(`last fix needed ${k} attempts`); }
  if (sideEffects) { points += 1; factors.push('a past fix here had side effects'); }
  if (rejected) { points += 2; factors.push('a reporter rejected a past fix here'); }
  const risk = points >= 4 ? 'high' : points >= 2 ? 'med' : 'low';

  const summary = n
    ? `This area broke ${n} time${n === 1 ? '' : 's'}, last fix (#${last.iid}) needed ${k ?? '?'} attempt${k === 1 ? '' : 's'}, lessons that apply: ${lessons.map((l) => l.id).join(', ') || 'none'}.`
    : `First visit: no similar case in the record${lessons.length ? `; lessons that apply: ${lessons.map((l) => l.id).join(', ')}` : ''}.`;

  return {
    risk,
    points,
    factors,
    summary,
    breaks: n,
    last_fix: last ? { iid: last.iid, attempts: k, mr: last.fix?.mr ?? null, pattern: last.root_cause?.pattern || null } : null,
    lessons: lessons.map((l) => ({ id: l.id, source: l.source, case: l.case, text: l.text, files: l.files })),
    autonomy: risk === 'high' ? 'supervised' : 'hands-off',
    policy_hit: risk === 'high' ? 'memory:high-risk' : null,
    seen_before: seen,
    area: { route: areaRoute || null, files: areaFiles },
  };
}

/** "Seen before: #4 (0.82, same route + ...)" line for notes and charts. */
export function seenBeforeLine(matches) {
  const m = (matches ?? []).filter((x) => x.score >= SEEN_SCORE);
  if (!m.length) return 'Seen before: no (first visit)';
  return `Seen before: ${m.map((x) => `#${x.iid} (${x.score}, ${x.why})`).join('; ')}`;
}
