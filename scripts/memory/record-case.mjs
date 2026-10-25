#!/usr/bin/env node
// CI writer for the Medical Record (docs/MEMORY.md). Never breaks CI: callers guard it with `|| true`,
// and every API failure is reported as a warning in the JSON output.
//
//   node scripts/memory/record-case.mjs merged --mr <n> [--issues 4,5]
//       main pipeline, after a healthy deploy (scripts/ci/close-issue.sh): for each issue the MR
//       closes, complete .shakefix/memory/cases/<iid>.json (mr, files, Second Opinion summary from
//       the MR notes, reported/merged/deployed times), append lessons (Second Opinion blocks,
//       "Lesson: Never/Always ..." lines in the MR description = Attending concerns, the Surgeon's
//       proposed re-operation lessons), rebuild index.json, commit to the default branch [skip ci].
//   node scripts/memory/record-case.mjs proof --proof proof/proof.json [--verdict 0|10|11] [--diff-files f] [--mr n] [--iid n]
//       merge request pipeline (scripts/ci/proof-gate.sh): on unintended changes, append a
//       second-opinion-block lesson to lessons.md on the default branch (and splice it into index.json).
//   node scripts/memory/record-case.mjs chart-rows --iid <n>
//       prints the "History" and "Evidence" Patient Chart rows for a recorded case (markdown).
//
// Flags: --local (write the working tree only, no API), --dry-run (no writes at all), --root <dir>, --now <ISO>
// Env: SCM_PROVIDER + CI_API_V4_URL, CI_PROJECT_ID, SHAKEFIX_BOT_TOKEN (or the GitHub set), CI_DEFAULT_BRANCH,
//      CI_MERGE_REQUEST_IID, SHAKEFIX_ISSUE_IIDS.

import { parseArgs } from 'node:util';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INDEX_PATH, LESSONS_PATH, addLessonToIndex, appFiles, appendLesson, caseFromReplay, casePath, indexJson, lessonFromBlocked,
  lessonFromProof, lessonLinesFromText, loadMemory, parseLessons, readCaseFile, readLessonsText, rebuildIndex, recordCase,
  secondOpinionFromNotes, writeLessonsText, median, caseFiles,
} from '../../packages/core/src/memory/index.js';
import { closingRefsFromText, createScm, missingScmConfig, ridFromText, scmConfigFromEnv } from '../../packages/core/src/scm/index.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const csv = (s) => String(s ?? '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const int = (s) => (s === undefined || s === null || s === '' ? null : Number.parseInt(String(s), 10));
const VERDICTS = { 0: 'ready', 10: 'unintended', 11: 'needs-human' };

async function remoteText(scm, path, ref, warnings) {
  try {
    return await scm.getFile(path, ref);
  } catch (err) {
    if (err?.status !== 404) warnings.push(`read ${path}@${ref}: ${err.message}`);
    return null;
  }
}

/** Append lessons to the freshest lessons.md (remote when committing), write it locally. */
function applyLessons(baseMd, lessons, now) {
  let md = baseMd ?? '';
  const added = [];
  for (const l of lessons) {
    if (!l) continue;
    try {
      const r = appendLesson(md, l, { now });
      md = r.md;
      if (r.added) added.push(r.lesson);
    } catch { /* invalid lesson text: skip */ }
  }
  return { md, added };
}

function numstatFiles(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').map((l) => l.split('\t')[2]).filter(Boolean);
}

function diffStats(changes) {
  let lines = 0;
  for (const c of changes ?? []) {
    if (!appFiles([c.new_path]).length) continue;
    for (const l of String(c.diff ?? '').split('\n')) if (/^[+-](?![+-]{2})/.test(l)) lines++;
  }
  return lines;
}

export async function main(argv = process.argv.slice(2), { env = process.env, scm: injected, out = (s) => console.log(s), now: nowOpt } = {}) {
  const [cmd, ...rest] = argv;
  const { values: o } = parseArgs({
    args: rest,
    options: {
      mr: { type: 'string' }, issues: { type: 'string' }, iid: { type: 'string' }, proof: { type: 'string' }, verdict: { type: 'string' },
      'diff-files': { type: 'string' }, root: { type: 'string' }, now: { type: 'string' },
      local: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
    },
  });
  const root = o.root ? resolve(o.root) : REPO;
  const now = o.now ?? nowOpt ?? new Date().toISOString();
  const warnings = [];
  const result = { mode: cmd, warnings };
  const print = () => out(JSON.stringify(result, null, 2));

  // ------------------------------------------------------------------ chart rows (local, read-only)
  if (cmd === 'chart-rows') {
    const iid = int(o.iid);
    const c = iid && readCaseFile(root, iid);
    if (!c) return 0;
    out(chartRows(loadMemory(root), c).join('\n'));
    return 0;
  }

  let scm = injected ?? null;
  if (!scm && !o.local && !o['dry-run']) {
    const cfg = scmConfigFromEnv(env);
    const missing = missingScmConfig(cfg);
    if (missing.length) warnings.push(`no SCM credentials (${missing.join(', ')}); writing the working tree only`);
    else scm = createScm(cfg);
  }
  const branch = env.CI_DEFAULT_BRANCH || (scm ? await scm.defaultBranch().catch(() => 'main') : 'main');
  result.branch = branch;

  // ------------------------------------------------------------------ proof (MR pipeline)
  if (cmd === 'proof') {
    const proof = JSON.parse(readFileSync(resolve(o.proof || 'proof/proof.json'), 'utf8'));
    const mr = int(o.mr) ?? int(proof.mr) ?? int(env.CI_MERGE_REQUEST_IID);
    result.verdict = VERDICTS[o.verdict] ?? o.verdict ?? null;
    let iid = int(o.iid);
    if (!iid && scm && mr) {
      try {
        iid = (await scm.mrClosesIssues(mr))?.[0]?.iid ?? null;
        if (!iid) iid = closingRefsFromText((await scm.getMR(mr))?.description)[0] ?? null;
      } catch (err) { warnings.push(`issue for !${mr}: ${err.message}`); }
    }
    const lesson = lessonFromProof({ iid, proof, files: numstatFiles(o['diff-files']) });
    if (!lesson) { result.recorded = false; print(); return 0; }
    const remote = scm ? await remoteText(scm, LESSONS_PATH, branch, warnings) : null;
    const { md, added } = applyLessons(remote ?? readLessonsText(root), [lesson], now);
    result.lessons_added = added.map((l) => l.id);
    if (!added.length || o['dry-run']) { result.recorded = false; print(); return 0; }
    writeLessonsText(root, md);
    if (scm) {
      const idxRemote = await remoteText(scm, INDEX_PATH, branch, warnings);
      let idx = null;
      try { idx = idxRemote ? JSON.parse(idxRemote) : null; } catch { /* rebuilt on the next merge */ }
      for (const l of added) idx = addLessonToIndex(idx, l);
      try {
        await scm.commitFiles({
          branch,
          message: `chore(memory): lesson ${added.map((l) => l.id).join(', ')} from Second Opinion on !${mr ?? '?'} [skip ci]`,
          files: [{ path: LESSONS_PATH, content: md }, { path: INDEX_PATH, content: indexJson(idx) }],
        });
        result.committed = true;
      } catch (err) { warnings.push(`commit: ${err.message}`); }
    }
    result.recorded = true;
    print();
    return 0;
  }

  // ------------------------------------------------------------------ merged (main pipeline)
  if (cmd === 'merged') {
    const mr = int(o.mr) ?? int(env.CI_MERGE_REQUEST_IID);
    let mrObj = null;
    let notes = [];
    let changes = [];
    if (scm && mr) {
      try { mrObj = await scm.getMR(mr); } catch (err) { warnings.push(`MR !${mr}: ${err.message}`); }
      try { notes = (await scm.listMRNotes(mr)) ?? []; } catch (err) { warnings.push(`MR notes: ${err.message}`); }
      if (scm.name === 'gitlab') {
        try {
          const pid = encodeURIComponent(String(env.CI_PROJECT_ID || env.GITLAB_PROJECT_ID || ''));
          changes = (await scm.request('GET', `/projects/${pid}/merge_requests/${mr}/changes`))?.changes ?? [];
        } catch (err) { warnings.push(`MR changes: ${err.message}`); }
      }
    }
    let iids = csv(o.issues ?? env.SHAKEFIX_ISSUE_IIDS).map(int).filter(Boolean);
    if (!iids.length && scm && mr) {
      try { iids = ((await scm.mrClosesIssues(mr)) ?? []).map((i) => int(i.iid)).filter(Boolean); } catch (err) { warnings.push(`closes_issues: ${err.message}`); }
      if (!iids.length) iids = closingRefsFromText(mrObj?.description).map(int).filter(Boolean);
    }
    result.mr = mr;
    result.issues = iids;
    if (!iids.length) { warnings.push('no issues to record'); print(); return 0; }

    const so = secondOpinionFromNotes(notes.map((n) => n.body));
    const changedFiles = appFiles(changes.map((c) => c.new_path));
    const lines = changes.length ? diffStats(changes) : null;
    const remoteLessons = scm ? await remoteText(scm, LESSONS_PATH, branch, warnings) : null;
    let md = remoteLessons ?? readLessonsText(root);
    const written = [];
    const addedAll = [];
    for (const iid of iids) {
      let issue = null;
      if (scm) { try { issue = await scm.getIssue(iid); } catch (err) { warnings.push(`issue #${iid}: ${err.message}`); } }
      const existing = readCaseFile(root, iid);
      const rid = ridFromText(issue?.description) || existing?.rids?.[0] || null;
      const replayPath = rid && join(root, 'reports', rid, 'replay.json');
      const fromReplay = !existing?.route && replayPath && existsSync(replayPath) ? caseFromReplay(JSON.parse(readFileSync(replayPath, 'utf8'))) : {};
      const patch = {
        iid,
        ...fromReplay,
        rids: rid ? [rid] : [],
        fix: {
          mr,
          files: existing?.fix?.files?.length ? [] : changedFiles,
          lines_changed: existing?.fix?.lines_changed ?? lines,
        },
        second_opinion: so ?? undefined,
        timestamps: { reported_at: existing?.timestamps?.reported_at || issue?.created_at, merged_at: mrObj?.merged_at || now, deployed_at: now },
      };
      if (o['dry-run']) { written.push(casePath(iid)); continue; }
      const { case: c } = recordCase(root, patch, { now });
      written.push(casePath(iid));
      const files = caseFiles(c);
      const lessons = [
        ...lessonLinesFromText(mrObj?.description).map((text) => ({ source: 'attending-concern', case: iid, text, files })),
        ...c.proposed_lessons.map((l) => ({ source: l.source, case: iid, text: l.text, files: l.files.length ? l.files : files })),
      ];
      const hasBlockLesson = parseLessons(md).some((l) => l.case === iid && l.source === 'second-opinion-block');
      if (c.second_opinion.blocked_changes.length && !hasBlockLesson) {
        lessons.push(lessonFromBlocked({ iid, blocked: c.second_opinion.blocked_changes, files: changedFiles.length ? changedFiles : files }));
      }
      const r = applyLessons(md, lessons, now);
      md = r.md;
      addedAll.push(...r.added);
    }
    result.cases = written;
    result.lessons_added = addedAll.map((l) => l.id);
    if (o['dry-run']) { print(); return 0; }
    if (md) writeLessonsText(root, md);
    const idx = rebuildIndex(root);
    result.stats = idx.index.stats;
    if (scm) {
      const files = written.map((p) => ({ path: p, content: readFileSync(join(root, p), 'utf8') }));
      if (md) files.push({ path: LESSONS_PATH, content: md });
      files.push({ path: INDEX_PATH, content: indexJson(idx.index) });
      try {
        await scm.commitFiles({ branch, message: `chore(memory): record ${iids.map((i) => `#${i}`).join(', ')} from !${mr ?? '?'} [skip ci]`, files });
        result.committed = true;
      } catch (err) { warnings.push(`commit: ${err.message}`); }
    }
    print();
    return 0;
  }

  throw new Error(`unknown command ${cmd ?? ''} (merged | proof | chart-rows)`);
}

const fmtS = (s) => (s === null || s === undefined ? '?' : s < 120 ? `${s}s` : `${Math.round(s / 60)} min`);

/** Patient Chart rows "History" and "Evidence" for a recorded case. */
export function chartRows(memory, c) {
  const firstTimes = memory.cases.filter((x) => !x.seen_before && x.iid !== c.iid).map((x) => x.time_to_fix_s);
  const fm = median(firstTimes);
  const history = [
    c.seen_before ? `Seen before #${c.seen_before}` : 'First visit',
    `lessons applied: ${c.lessons_applied.join(', ') || 'none'}`,
    `fixed in ${fmtS(c.time_to_fix_s)}${c.seen_before && fm ? ` (first-time median ${fmtS(fm)})` : ''}`,
  ];
  const so = c.second_opinion;
  const evidence = [
    so.intended !== null ? `Second Opinion ${so.intended} intended / ${so.unintended ?? 0} unintended${so.blocked_changes.length ? ` (blocked earlier: ${so.blocked_changes[0]})` : ''}` : null,
    c.symptom.console_error ? `console: \`${c.symptom.console_error.replace(/`/g, "'").slice(0, 120)}\`` : 'console: no errors',
    `regression test \`tests/regressions/issue-${c.iid}.spec.ts\``,
  ].filter(Boolean);
  return [`| **History** | ${history.join(' · ')} |`, `| **Evidence** | ${evidence.join(' · ')} |`];
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.error(`record-case: ${e.message}`);
    process.exitCode = 1;
  });
}
