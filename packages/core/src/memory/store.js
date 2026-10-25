// Medical Record storage: plain repo files, no database.
//   .shakefix/memory/cases/<iid>.json   one case per issue (schema shakefix.case/v1)
//   .shakefix/memory/lessons.md         append-only lessons ("Never ..." / "Always ...")
//   .shakefix/memory/index.json         generated (see ./indexer.js and docs/CONTRACTS.md)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { normalizePath, normalizeRoute } from './text.js';

export const MEMORY_DIR = '.shakefix/memory';
export const CASES_DIR = `${MEMORY_DIR}/cases`;
export const LESSONS_PATH = `${MEMORY_DIR}/lessons.md`;
export const INDEX_PATH = `${MEMORY_DIR}/index.json`;
export const CASE_SCHEMA = 'shakefix.case/v1';
export const INDEX_SCHEMA = 'shakefix.memory-index/v1';
export const LESSON_SOURCES = Object.freeze(['second-opinion-block', 'reporter-rejected', 'reoperation', 'attending-concern']);

export const casePath = (iid) => `${CASES_DIR}/${Number(iid)}.json`;

export const LESSONS_HEADER = [
  '# ShakeFix Medical Record: lessons',
  '',
  'Append-only. One lesson per `## L<n>` block: `## L<n> · <source> · case #<iid>`, then one',
  'line of text that starts with "Never" or "Always", then optional `- files:`, `- patterns:` and',
  '`- added:` lines. Written by CI (scripts/memory/record-case.mjs), the intake (reporter rejected)',
  'and `node packages/core/bin/shakefix-memory.js add-lesson`. Never edit or reorder old lessons:',
  'add a new one that supersedes it. Format: docs/MEMORY.md.',
  '',
].join('\n');

// ---------------------------------------------------------------------------------- repo root

/** Walk up from `start` to the first directory holding .shakefix/ (or .git/); fallback: start. */
export function findRepoRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.shakefix')) || existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(start);
    dir = up;
  }
}

// ---------------------------------------------------------------------------------- cases

const uniq = (a) => [...new Set((a ?? []).filter((x) => x !== undefined && x !== null && x !== ''))];
const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** An empty case with every field present, in canonical key order. */
export function emptyCase(iid) {
  return {
    schema: CASE_SCHEMA,
    iid: Number(iid),
    rids: [],
    route: '',
    testids: [],
    symptom: { note: '', expectation: '', console_error: null },
    root_cause: { file: null, line: null, summary: '', pattern: '' },
    fix: { files: [], lines_changed: null, mr: null, attempts: null },
    second_opinion: { intended: null, unintended: null, blocked_changes: [] },
    reporter_verdicts: { confirmed: 0, rejected: 0 },
    seen_before: null,
    lessons_applied: [],
    proposed_lessons: [],
    time_to_fix_s: null,
    timestamps: { reported_at: null, operated_at: null, merged_at: null, deployed_at: null, updated_at: null },
  };
}

/** Coerce any object into the canonical case shape (unknown keys dropped, types fixed). */
export function canonicalCase(c) {
  const e = emptyCase(c?.iid);
  if (!Number.isFinite(e.iid) || e.iid <= 0) throw new Error(`case needs a positive integer iid (got ${c?.iid})`);
  const s = c.symptom ?? {};
  const rc = c.root_cause ?? {};
  const fx = c.fix ?? {};
  const so = c.second_opinion ?? {};
  const rv = c.reporter_verdicts ?? {};
  const ts = c.timestamps ?? {};
  return {
    ...e,
    rids: uniq(c.rids ?? (c.rid ? [c.rid] : [])).map(String),
    route: c.route ? normalizeRoute(c.route) : '',
    testids: uniq(c.testids).map(String),
    symptom: {
      note: String(s.note ?? ''),
      expectation: String(s.expectation ?? ''),
      console_error: s.console_error ? String(s.console_error) : null,
    },
    root_cause: {
      file: rc.file ? normalizePath(rc.file) : null,
      line: num(rc.line),
      summary: String(rc.summary ?? ''),
      pattern: String(rc.pattern ?? ''),
    },
    fix: {
      files: uniq((fx.files ?? []).map(normalizePath)),
      lines_changed: num(fx.lines_changed),
      mr: num(fx.mr),
      attempts: num(fx.attempts),
    },
    second_opinion: {
      intended: num(so.intended),
      unintended: num(so.unintended),
      blocked_changes: uniq(so.blocked_changes).map(String),
    },
    reporter_verdicts: { confirmed: num(rv.confirmed) ?? 0, rejected: num(rv.rejected) ?? 0 },
    seen_before: num(c.seen_before),
    lessons_applied: uniq(c.lessons_applied).map(String),
    proposed_lessons: (c.proposed_lessons ?? [])
      .filter((l) => l && l.text)
      .map((l) => ({ source: LESSON_SOURCES.includes(l.source) ? l.source : 'reoperation', text: String(l.text), files: uniq((l.files ?? []).map(normalizePath)) })),
    time_to_fix_s: num(c.time_to_fix_s),
    timestamps: {
      reported_at: ts.reported_at ?? null,
      operated_at: ts.operated_at ?? null,
      merged_at: ts.merged_at ?? null,
      deployed_at: ts.deployed_at ?? null,
      updated_at: ts.updated_at ?? null,
    },
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const UNION_KEYS = new Set(['rids', 'testids', 'files', 'blocked_changes', 'lessons_applied']);

/**
 * Merge a patch into a case. Objects merge deeply; list fields (rids, testids, fix.files,
 * blocked_changes, lessons_applied) are unioned; proposed_lessons are appended (deduped by text);
 * null / undefined / '' in the patch never erase a known value.
 */
export function mergeCase(base, patch) {
  const walk = (a, b, key) => {
    if (b === undefined || b === null || b === '') return a;
    if (Array.isArray(b)) {
      if (key === 'proposed_lessons') {
        const seen = new Set((a ?? []).map((l) => l.text));
        return [...(a ?? []), ...b.filter((l) => l && !seen.has(l.text))];
      }
      return UNION_KEYS.has(key) ? uniq([...(a ?? []), ...b]) : b;
    }
    if (isObj(b)) {
      const out = { ...(isObj(a) ? a : {}) };
      for (const [k, v] of Object.entries(b)) out[k] = walk(out[k], v, k);
      return out;
    }
    return b;
  };
  return canonicalCase(walk(base, patch, ''));
}

const secs = (a, b) => {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / 1000) : null;
};

/**
 * Time to fix (seconds): report -> first green fix commit (operated_at); falls back to merged_at.
 * This is the agent's time, the number the repeat-bug speedup metric compares.
 */
export function timeToFix(c) {
  const t = c.timestamps ?? {};
  return secs(t.reported_at, t.operated_at) ?? secs(t.reported_at, t.merged_at);
}

export function readCaseFile(root, iid) {
  const p = join(root, casePath(iid));
  if (!existsSync(p)) return null;
  return canonicalCase(JSON.parse(readFileSync(p, 'utf8')));
}

export const caseJson = (c) => `${JSON.stringify(canonicalCase(c), null, 2)}\n`;

export function writeCaseFile(root, c) {
  const p = join(root, casePath(c.iid));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, caseJson(c));
  return casePath(c.iid);
}

/** Every case under .shakefix/memory/cases, sorted by iid. Invalid files are reported, not thrown. */
export function readCases(root) {
  const dir = join(root, CASES_DIR);
  const cases = [];
  const errors = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return { cases, errors }; }
  for (const name of names.filter((n) => /^\d+\.json$/.test(n)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
    try {
      cases.push(canonicalCase(JSON.parse(readFileSync(join(dir, name), 'utf8'))));
    } catch (err) {
      errors.push(`${CASES_DIR}/${name}: ${err.message}`);
    }
  }
  return { cases, errors };
}

// ---------------------------------------------------------------------------------- lessons

const csvList = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== '-');

/** Parse lessons.md into [{id, n, source, case, text, files, patterns, added}] in file order. */
export function parseLessons(md) {
  const out = [];
  const blocks = String(md ?? '').replace(/\r\n/g, '\n').split(/^## /m).slice(1);
  for (const block of blocks) {
    const [head, ...rest] = block.split('\n');
    const m = /^L(\d+)\s*·\s*([a-z-]+)(?:\s*·\s*case\s*#(\d+))?(?:\s*\([^)]*\))?\s*$/.exec(head.trim()); // optional "(note)" suffix
    if (!m) continue;
    const lesson = { id: `L${m[1]}`, n: Number(m[1]), source: m[2], case: m[3] ? Number(m[3]) : null, text: '', files: [], patterns: [], added: null };
    const textLines = [];
    for (const raw of rest) {
      const line = raw.trim();
      const kv = /^- (files|patterns|added):\s*(.*)$/.exec(line);
      if (kv) {
        if (kv[1] === 'added') lesson.added = kv[2].trim() || null;
        else lesson[kv[1]] = csvList(kv[2]).map((x) => (kv[1] === 'files' ? normalizePath(x) : x));
      } else if (line) {
        textLines.push(line);
      }
    }
    lesson.text = textLines.join(' ');
    out.push(lesson);
  }
  return out;
}

/** Render one lesson block (no leading blank line). Byte-identical to services/intake/src/memory.js. */
export function renderLesson({ id, source, case: caseIid, text, files = [], patterns = [], added }) {
  const lines = [`## ${id} · ${source}${caseIid ? ` · case #${caseIid}` : ''}`, oneLine(text)];
  if (files.length) lines.push(`- files: ${files.join(', ')}`);
  if (patterns.length) lines.push(`- patterns: ${patterns.join(', ')}`);
  if (added) lines.push(`- added: ${added}`);
  return `${lines.join('\n')}\n`;
}

export const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const normText = (s) => oneLine(s).toLowerCase().replace(/[^a-z0-9 ]+/g, '');

/** Validate a lesson; returns an error string or null. */
export function lessonError(l) {
  if (!LESSON_SOURCES.includes(l?.source)) return `source must be one of ${LESSON_SOURCES.join('|')}`;
  if (!/^(Never|Always)\b/.test(oneLine(l.text))) return 'text must start with "Never" or "Always"';
  if (oneLine(l.text).length > 400) return 'text is longer than 400 characters';
  return null;
}

/**
 * Append a lesson to lessons.md text (pure). Dedupes by normalised text.
 * Returns {md, lesson, added}; `lesson` is the existing one when it was a duplicate.
 */
export function appendLesson(md, input, { now = new Date().toISOString() } = {}) {
  const err = lessonError(input);
  if (err) throw new Error(`invalid lesson: ${err}`);
  const base = md && String(md).trim() ? String(md).replace(/\r\n/g, '\n') : LESSONS_HEADER;
  const existing = parseLessons(base);
  const dup = existing.find((l) => normText(l.text) === normText(input.text));
  if (dup) return { md: base, lesson: dup, added: false };
  const n = existing.reduce((m, l) => Math.max(m, l.n), 0) + 1;
  const lesson = {
    id: `L${n}`,
    n,
    source: input.source,
    case: input.case ? Number(input.case) : null,
    text: oneLine(input.text),
    files: uniq((input.files ?? []).map(normalizePath)),
    patterns: uniq(input.patterns ?? []),
    added: input.added ?? now,
  };
  const sep = base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n';
  return { md: `${base}${sep}${renderLesson(lesson)}`, lesson, added: true };
}

export function readLessonsText(root) {
  const p = join(root, LESSONS_PATH);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

export function writeLessonsText(root, md) {
  const p = join(root, LESSONS_PATH);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, md);
  return LESSONS_PATH;
}

/** Everything the recall / premortem / index code needs. */
export function loadMemory(root = findRepoRoot()) {
  const { cases, errors } = readCases(root);
  const lessons = parseLessons(readLessonsText(root));
  return { root, cases, lessons, errors };
}
