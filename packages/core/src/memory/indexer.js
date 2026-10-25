// .shakefix/memory/index.json: the compact, generated view of the Medical Record for agents and
// the ER Board dashboard. Contract: docs/CONTRACTS.md ("Medical Record index"). Deterministic:
// generated_at is the newest timestamp in the record, so rebuilding an unchanged record is a no-op.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { INDEX_PATH, INDEX_SCHEMA, loadMemory, timeToFix } from './store.js';
import { SEEN_SCORE, caseFiles, lessonsForCase, recall } from './recall.js';
import { median, round2 } from './text.js';

const reportedOrder = (a, b) =>
  (Date.parse(a.timestamps.reported_at || '') || 0) - (Date.parse(b.timestamps.reported_at || '') || 0) || a.iid - b.iid;

/** seen_before for a case: explicit value, else the best earlier case scoring >= SEEN_SCORE. */
export function deriveSeenBefore(memory, c) {
  if (c.seen_before) return c.seen_before;
  const ordered = [...memory.cases].sort(reportedOrder);
  const earlier = ordered.slice(0, ordered.findIndex((x) => x.iid === c.iid));
  if (!earlier.length) return null;
  const q = { route: c.route, testids: c.testids, note: c.symptom.note, consoleMsg: c.symptom.console_error, expectation: c.symptom.expectation, files: caseFiles(c), pattern: c.root_cause.pattern };
  const best = recall({ ...memory, cases: earlier }, q, { limit: 1, minScore: SEEN_SCORE })[0];
  return best ? best.iid : null;
}

function hotspots(cases) {
  const files = new Map();
  const routes = new Map();
  const bump = (map, key, iid) => {
    const h = map.get(key) ?? { count: 0, last_iid: 0 };
    h.count++;
    h.last_iid = Math.max(h.last_iid, iid);
    map.set(key, h);
  };
  for (const c of cases) {
    for (const f of caseFiles(c)) bump(files, f, c.iid);
    if (c.route) bump(routes, c.route, c.iid);
  }
  const list = [
    ...[...files].map(([file, h]) => ({ kind: 'file', file, count: h.count, last_iid: h.last_iid })),
    ...[...routes].map(([route, h]) => ({ kind: 'route', route, count: h.count, last_iid: h.last_iid })),
  ];
  return list.sort((a, b) => b.count - a.count || b.last_iid - a.last_iid || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || String(a.file ?? a.route).localeCompare(String(b.file ?? b.route)));
}

export function buildIndex(memory) {
  const cases = memory.cases.map((c) => {
    const seen = deriveSeenBefore(memory, c);
    return {
      iid: c.iid,
      rids: c.rids,
      route: c.route || null,
      testids: c.testids,
      symptom: c.symptom.note || null,
      console_error: c.symptom.console_error,
      file: c.root_cause.file,
      line: c.root_cause.line,
      summary: c.root_cause.summary || null,
      pattern: c.root_cause.pattern || null,
      files: caseFiles(c),
      mr: c.fix.mr,
      attempts: c.fix.attempts,
      lines_changed: c.fix.lines_changed,
      second_opinion: { intended: c.second_opinion.intended, unintended: c.second_opinion.unintended, blocked: c.second_opinion.blocked_changes.length },
      verdicts: c.reporter_verdicts,
      time_to_fix_s: c.time_to_fix_s ?? timeToFix(c),
      seen_before: seen,
      lessons: lessonsForCase(memory, c).map((l) => l.id),
      lessons_applied: c.lessons_applied,
      reported_at: c.timestamps.reported_at,
      fixed_at: c.timestamps.merged_at || c.timestamps.operated_at,
    };
  });
  const lessons = memory.lessons.map((l) => ({ id: l.id, source: l.source, case: l.case, text: l.text, files: l.files, patterns: l.patterns, added: l.added }));
  const repeat = cases.filter((c) => c.seen_before);
  const first = cases.filter((c) => !c.seen_before);
  const rm = median(repeat.map((c) => c.time_to_fix_s));
  const fm = median(first.map((c) => c.time_to_fix_s));
  const stamps = [
    ...memory.cases.flatMap((c) => Object.values(c.timestamps)),
    ...memory.lessons.map((l) => l.added),
  ].filter((t) => t && Number.isFinite(Date.parse(t))).sort();
  return {
    schema: INDEX_SCHEMA,
    generated_at: stamps.at(-1) ?? null,
    cases,
    lessons,
    hotspots: hotspots(memory.cases),
    stats: {
      cases: cases.length,
      lessons: lessons.length,
      repeat_cases: repeat.length,
      repeat_bug_median_time_s: rm,
      first_time_median_s: fm,
      speedup: rm && fm ? round2(fm / rm) : null,
      lessons_applied: cases.reduce((n, c) => n + c.lessons_applied.length, 0),
      blocked_side_effects: memory.cases.reduce((n, c) => n + c.second_opinion.blocked_changes.length, 0),
    },
  };
}

export const indexJson = (index) => `${JSON.stringify(index, null, 2)}\n`;

/**
 * Splice one lesson into an existing index object without the case files (used by CI on merge
 * request pipelines, where the working tree is a branch and must not overwrite main's index).
 */
export function addLessonToIndex(index, l) {
  const base = index && index.schema === INDEX_SCHEMA ? index : { schema: INDEX_SCHEMA, generated_at: null, cases: [], lessons: [], hotspots: [], stats: {} };
  if (base.lessons.some((x) => x.id === l.id)) return base;
  const lessons = [...base.lessons, { id: l.id, source: l.source, case: l.case, text: l.text, files: l.files, patterns: l.patterns, added: l.added }];
  const stamps = [base.generated_at, l.added].filter(Boolean).sort();
  return { ...base, generated_at: stamps.at(-1) ?? null, lessons, stats: { ...base.stats, lessons: lessons.length } };
}

/**
 * Regenerate .shakefix/memory/index.json from the case files and lessons.md.
 * check=true writes nothing and reports whether the file is up to date.
 */
export function rebuildIndex(root, { check = false } = {}) {
  const memory = loadMemory(root);
  const index = buildIndex(memory);
  const text = indexJson(index);
  const p = join(root, INDEX_PATH);
  const current = existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null;
  const upToDate = current === text;
  if (!check && !upToDate) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return { path: INDEX_PATH, upToDate, written: !check && !upToDate, index, errors: memory.errors };
}
