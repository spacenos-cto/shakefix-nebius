// Medical Record hook (docs/MEMORY.md): when a reporter rejects a deployed fix, append a
// "reporter-rejected" lesson to .shakefix/memory/lessons.md and count the verdict on the case,
// in one [skip ci] commit on the default branch.
//
// Self-contained because the intake's Docker build context is services/intake. The lesson format
// and text are byte-identical to packages/core/src/memory (renderLesson, lessonFromRejection);
// packages/core/test/memory.test.js asserts the parity.

export const LESSONS_PATH = '.shakefix/memory/lessons.md';
export const INDEX_PATH = '.shakefix/memory/index.json';
export const casePath = (iid) => `.shakefix/memory/cases/${Number(iid)}.json`;

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

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const normText = (s) => oneLine(s).toLowerCase().replace(/[^a-z0-9 ]+/g, '');
const uniq = (a) => [...new Set((a ?? []).filter(Boolean))];
const appFiles = (files) => uniq((files ?? []).map((f) => String(f).replace(/\\/g, '/').replace(/^\.\//, '').replace(/:\d+(:\d+)?$/, ''))
  .filter((f) => !/^(tests\/|\.shakefix\/|reports\/)/.test(f) && !/\.(spec|test)\.[jt]s$/.test(f)));

/** /bill/7/settle -> /bill/:id/settle (same rule as packages/core/src/memory/text.js). */
export function normalizeRoute(route) {
  if (!route) return '';
  const r = String(route).trim().split(/[?#]/)[0];
  const segs = r.split('/').filter(Boolean).map((s) => {
    if (s.startsWith(':')) return ':id';
    if (/^\d+$/.test(s) || /^r_\d{8}_[0-9a-f]{6}$/i.test(s) || /^[0-9a-f]{8,}$/i.test(s) || /^[0-9a-f-]{32,36}$/i.test(s)) return ':id';
    return s.toLowerCase();
  });
  return `/${segs.join('/')}`;
}

function lastRoute(replay) {
  const acts = replay?.actions ?? [];
  for (let i = acts.length - 1; i >= 0; i--) if (acts[i].route) return acts[i].route;
  return replay?.startRoute ?? '';
}

export function renderLesson({ id, source, case: caseIid, text, files = [], patterns = [], added }) {
  const lines = [`## ${id} · ${source}${caseIid ? ` · case #${caseIid}` : ''}`, oneLine(text)];
  if (files.length) lines.push(`- files: ${files.join(', ')}`);
  if (patterns.length) lines.push(`- patterns: ${patterns.join(', ')}`);
  if (added) lines.push(`- added: ${added}`);
  return `${lines.join('\n')}\n`;
}

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

/** Append (deduped by text) to lessons.md text. Returns {md, lesson, added}. */
export function appendLessonText(md, input, now) {
  const base = md && String(md).trim() ? String(md).replace(/\r\n/g, '\n') : LESSONS_HEADER;
  const heads = [...base.matchAll(/^## L(\d+) · [a-z-]+(?: · case #\d+)?\n(.*)$/gm)];
  const dup = heads.find((m) => normText(m[2]) === normText(input.text));
  if (dup) return { md: base, lesson: { id: `L${dup[1]}` }, added: false };
  const n = heads.reduce((m, h) => Math.max(m, Number(h[1])), 0) + 1;
  const lesson = { id: `L${n}`, source: input.source, case: input.case ?? null, text: oneLine(input.text), files: input.files ?? [], patterns: input.patterns ?? [], added: now };
  const sep = base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n';
  return { md: `${base}${sep}${renderLesson(lesson)}`, lesson, added: true };
}

async function readOrNull(gitlab, path, ref) {
  try {
    return await gitlab.getFile(path, ref);
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Record a reporter rejection. Throws on API errors; the caller logs and ignores them, so the
 * verdict response never depends on the Medical Record.
 */
export async function recordRejection({ gitlab, branch, iid, replay, now }) {
  const [md, caseText, indexText] = await Promise.all([
    readOrNull(gitlab, LESSONS_PATH, branch),
    readOrNull(gitlab, casePath(iid), branch),
    readOrNull(gitlab, INDEX_PATH, branch),
  ]);
  let rec = null;
  try { rec = caseText ? JSON.parse(caseText) : null; } catch { rec = null; }
  const files = rec ? [rec.root_cause?.file, ...(rec.fix?.files ?? [])] : [];
  const patterns = rec?.root_cause?.pattern ? [rec.root_cause.pattern] : [];
  const input = lessonFromRejection({ iid, route: normalizeRoute(lastRoute(replay)), note: replay?.note, files, patterns });
  const r = appendLessonText(md, input, now);
  const out = [];
  if (r.added) out.push({ path: LESSONS_PATH, content: r.md });
  if (rec) {
    rec.reporter_verdicts = { confirmed: rec.reporter_verdicts?.confirmed ?? 0, rejected: (rec.reporter_verdicts?.rejected ?? 0) + 1 };
    if (rec.timestamps) rec.timestamps.updated_at = now;
    out.push({ path: casePath(iid), content: `${JSON.stringify(rec, null, 2)}\n` });
  }
  if (indexText && (r.added || rec)) {
    try {
      const idx = JSON.parse(indexText);
      if (r.added && Array.isArray(idx.lessons)) {
        const l = r.lesson;
        idx.lessons.push({ id: l.id, source: l.source, case: l.case, text: l.text, files: l.files, patterns: l.patterns, added: l.added });
        idx.stats = { ...(idx.stats ?? {}), lessons: idx.lessons.length };
      }
      const c = (idx.cases ?? []).find((x) => x.iid === Number(iid));
      if (c && rec) c.verdicts = rec.reporter_verdicts;
      idx.generated_at = [idx.generated_at, now].filter(Boolean).sort().at(-1);
      out.push({ path: INDEX_PATH, content: `${JSON.stringify(idx, null, 2)}\n` });
    } catch { /* malformed index: CI rebuilds it on the next merge */ }
  }
  if (!out.length) return { committed: false, lesson: r.lesson.id, added: false };
  await gitlab.commitFiles({
    branch,
    message: `chore(memory): reporter rejected the fix for #${iid}${r.added ? `, lesson ${r.lesson.id}` : ''} [skip ci]`,
    files: out,
  });
  return { committed: true, lesson: r.lesson.id, added: r.added };
}
