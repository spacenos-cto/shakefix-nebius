// Writers for the Medical Record: build / update case files and append lessons.
// Pure helpers (…From…) build patches and lesson texts; record*/add* touch the working tree.

import {
  appendLesson, emptyCase, mergeCase, readCaseFile, readLessonsText, timeToFix, writeCaseFile, writeLessonsText, oneLine,
} from './store.js';
import { rebuildIndex } from './indexer.js';
import { lastRoute, topConsoleError } from './recall.js';
import { normalizePath } from './text.js';

const uniq = (a) => [...new Set((a ?? []).filter(Boolean))];

/** "apps/x/split.js:17 - summary" (also "—" or ":" before the summary) -> {file, line, summary}. */
export function parseRootCause(s) {
  const t = oneLine(s);
  if (!t) return {};
  const m = /^([^\s:]+\.[A-Za-z0-9]+)(?::(\d+))?\s*(?:[-–—:]\s*)?(.*)$/.exec(t);
  if (!m) return { summary: t };
  return { file: normalizePath(m[1]), line: m[2] ? Number(m[2]) : null, summary: m[3] || '' };
}

/** Case patch fields that come from a replay. */
export function caseFromReplay(replay) {
  if (!replay) return {};
  const e = replay.expectation;
  return {
    rids: replay.rid ? [replay.rid] : [],
    route: lastRoute(replay),
    testids: uniq([...(replay.actions ?? []).map((a) => a.testid), e?.testid]),
    symptom: {
      note: replay.note ?? '',
      expectation: e ? `${e.testid} ${e.state}${e.text ? ` "${e.text}"` : ''}` : '',
      console_error: topConsoleError(replay),
    },
  };
}

const fmt = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/** Unintended changes in a shakefix.proof/v1 object as "where: before -> after" strings. */
export function blockedChangesFromProof(proof) {
  const out = [];
  for (const f of proof?.flows ?? []) {
    for (const c of f.changes ?? []) {
      if ((c.label ?? c.candidate) !== 'unintended') continue;
      out.push(`${c.where}: ${fmt(c.before)} -> ${fmt(c.after)}`);
    }
  }
  return uniq(out);
}

export function secondOpinionFromProof(proof) {
  const all = (proof?.flows ?? []).flatMap((f) => f.changes ?? []);
  const lab = (c) => c.label ?? c.candidate;
  return {
    intended: proof?.summary?.intended ?? all.filter((c) => lab(c) === 'intended').length,
    unintended: proof?.summary?.unintended ?? all.filter((c) => lab(c) === 'unintended').length,
    blocked_changes: blockedChangesFromProof(proof),
  };
}

/**
 * Parse Second Opinion MR notes (packages/proof/src/report.js renderReport) into
 * {intended, unintended, blocked_changes}. The latest report sets the counts; unintended rows
 * from every report are kept, so a re-operated MR remembers what was blocked the first time.
 */
export function secondOpinionFromNotes(bodies) {
  let last = null;
  const blocked = [];
  for (const body of bodies ?? []) {
    const s = String(body ?? '');
    if (!/Second Opinion/.test(s)) continue;
    const m = /\*\*(\d+) changes? · (\d+) intended · (\d+) unintended\*\*/.exec(s);
    if (!m) continue;
    last = { intended: Number(m[2]), unintended: Number(m[3]) };
    for (const line of s.split('\n')) {
      if (!line.startsWith('|') || !/unintended/i.test(line) || /^\|\s*\|\s*Channel/.test(line)) continue;
      const cells = line.split('|').map((x) => x.trim());
      // | icon | channel | where | before → after | verdict |
      if (cells.length < 6 || !/unintended/i.test(cells[5])) continue;
      blocked.push(`${cells[3]}: ${cells[4].replace(/\s*→\s*/, ' -> ')}`);
    }
  }
  if (!last) return null;
  return { ...last, blocked_changes: uniq(blocked) };
}

/** "Lesson: Never ..." / "Lesson: Always ..." lines (Discharge writes them from Attending concerns). */
export function lessonLinesFromText(md) {
  return uniq([...String(md ?? '').matchAll(/^\s*(?:[-*]\s*)?\**Lesson:\**\s*((?:Never|Always)\b[^\n]*)$/gim)].map((m) => oneLine(m[1])));
}

export const appFiles = (files) => uniq((files ?? []).map(normalizePath).filter((f) => !/^(tests\/|\.shakefix\/|reports\/)/.test(f) && !/\.(spec|test)\.[jt]s$/.test(f)));

/** Lesson text for a Second Opinion block (deterministic). */
export function lessonFromProof({ iid, proof, files = [] }) {
  return lessonFromBlocked({ iid, blocked: blockedChangesFromProof(proof), files });
}

/** Same lesson from "where: before -> after" strings (e.g. parsed from MR notes). */
export function lessonFromBlocked({ iid, blocked = [], files = [] }) {
  if (!blocked.length) return null;
  const fs = appFiles(files);
  const where = fs.length ? fs.map((f) => f.split('/').pop()).join(', ') : 'shared code';
  return {
    source: 'second-opinion-block',
    case: iid ?? null,
    text: `Never change ${where} in a way that alters ${blocked[0]}${blocked.length > 1 ? ` (+${blocked.length - 1} more)` : ''}: Second Opinion blocked the first fix for #${iid ?? '?'} as unintended.`,
    files: fs,
    patterns: [],
  };
}

/** Lesson text for a reporter rejection (deterministic). */
export function lessonFromRejection({ iid, route, note, files = [], patterns = [] }) {
  const n = oneLine(note).slice(0, 120);
  return {
    source: 'reporter-rejected',
    case: iid ?? null,
    text: `Always replay the reporter's latest replay on ${route || 'the reported route'} before discharge: the reporter rejected the deployed fix for #${iid ?? '?'}${n ? ` ("${n}")` : ''}.`,
    files: appFiles(files),
    patterns,
  };
}

// ---------------------------------------------------------------------------------- writers

/**
 * Create or update .shakefix/memory/cases/<iid>.json with a patch (see mergeCase).
 * Stamps timestamps.updated_at and recomputes time_to_fix_s. index=true also rebuilds index.json.
 */
export function recordCase(root, patch, { now = new Date().toISOString(), index = false } = {}) {
  if (!patch?.iid) throw new Error('recordCase needs patch.iid');
  const existing = readCaseFile(root, patch.iid);
  const merged = mergeCase(existing ?? emptyCase(patch.iid), patch);
  merged.timestamps.updated_at = now;
  merged.time_to_fix_s = timeToFix(merged) ?? merged.time_to_fix_s;
  const path = writeCaseFile(root, merged);
  const idx = index ? rebuildIndex(root) : null;
  return { case: merged, path, created: !existing, index: idx ? idx.path : null };
}

/** Append a lesson to lessons.md (deduped by text). index=true also rebuilds index.json. */
export function addLesson(root, lesson, { now = new Date().toISOString(), index = true } = {}) {
  const r = appendLesson(readLessonsText(root), lesson, { now });
  if (r.added) writeLessonsText(root, r.md);
  const idx = index ? rebuildIndex(root) : null;
  return { lesson: r.lesson, added: r.added, path: '.shakefix/memory/lessons.md', index: idx ? idx.path : null };
}

/** Count a reporter verdict on a case. */
export function recordVerdict(root, iid, verdict, opts) {
  const existing = readCaseFile(root, iid) ?? emptyCase(iid);
  const rv = { ...existing.reporter_verdicts };
  if (verdict === 'confirmed') rv.confirmed++;
  else if (verdict === 'rejected') rv.rejected++;
  else throw new Error(`verdict must be confirmed|rejected (got ${verdict})`);
  return recordCase(root, { iid, reporter_verdicts: rv }, opts);
}
