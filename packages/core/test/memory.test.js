// Medical Record (docs/MEMORY.md): deterministic recall, pre-mortem, lessons, index, CLI and CI writer.
import { describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  LESSONS_HEADER, addLesson, addLessonToIndex, appendLesson, buildIndex, canonicalCase, emptyCase, evidenceFromReplay, jaccard,
  lessonFromProof, lessonFromRejection, lessonLinesFromText, lessonsFor, loadMemory, mergeCase, normalizeRoute, normalizeTestid,
  parseLessons, parseRootCause, premortem, queryFromIssueText, queryFromReplay, rebuildIndex, recall, recordCase, recordVerdict,
  renderLesson, routeSimilarity, secondOpinionFromNotes, seenBeforeLine, tokenize,
} from '../src/memory/index.js';
import * as intakeMemory from '../../../services/intake/src/memory.js';
import { issueBody } from '../../../services/intake/src/render.js';
import { main as recordMain, chartRows } from '../../../scripts/memory/record-case.mjs';

const REPO = resolve(import.meta.dirname, '../../..');
// SYNTHETIC Medical Record (cases #4, #6, lessons L1, L2). The live record in REPO/.shakefix/memory holds only real runs.
const FIXTURE = join(import.meta.dirname, 'fixtures/memory');
const CLI = join(REPO, 'packages/core/bin/shakefix-memory.js');
const B1 = JSON.parse(readFileSync(join(REPO, 'reports/demo/b1.replay.json'), 'utf8'));
const NOW = '2026-10-12T08:00:00Z';

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'shakefix-mem-'));
  cpSync(join(FIXTURE, '.shakefix/memory'), join(dir, '.shakefix/memory'), { recursive: true });
  return dir;
}
const cli = (args, cwd = REPO) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, json: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
};
const secondShake = { ...B1, rid: 'r_20261012_5ec0d0', note: 'settle still does nothing after paying everyone' };

describe('text helpers', () => {
  it('tokenizes camelCase, drops stop words and numbers, folds plurals', () => {
    expect(tokenize('roundMoney changed the bills 999.99')).toEqual(['roundmoney', 'round', 'money', 'changed', 'bill']);
  });
  it('normalizes routes and testids', () => {
    expect(normalizeRoute('/bill/7/settle?x=1')).toBe('/bill/:id/settle');
    expect(normalizeRoute('https://a.run.app/bill/12')).toBe('/bill/:id');
    expect(normalizeTestid('bill-row-7')).toBe('bill-row-n');
    expect(normalizeTestid('pay-Asha-btn')).toBe('pay-Asha-btn');
    expect(routeSimilarity('/bill/7/settle', '/bill/:id/settle')).toBe(1);
    expect(routeSimilarity('/bill/7', '/bill/:id/settle')).toBe(0.6);
    expect(routeSimilarity('/settings', '/bill/1')).toBe(0);
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
  });
  it('parses root causes', () => {
    expect(parseRootCause('apps/splitpal/src/lib/split.js:17 - remainder cent dropped')).toEqual({ file: 'apps/splitpal/src/lib/split.js', line: 17, summary: 'remainder cent dropped' });
    expect(parseRootCause('just words')).toEqual({ summary: 'just words' });
  });
});

describe('cases', () => {
  it('canonicalCase fills every field and normalises the route', () => {
    const c = canonicalCase({ iid: 9, route: '/bill/9', rid: 'r_1' });
    expect(c).toMatchObject({ schema: 'shakefix.case/v1', iid: 9, route: '/bill/:id', rids: ['r_1'], reporter_verdicts: { confirmed: 0, rejected: 0 } });
    expect(() => canonicalCase({})).toThrow(/iid/);
  });
  it('mergeCase unions lists and never erases with null', () => {
    const a = mergeCase(emptyCase(3), { testids: ['a'], fix: { files: ['x.js'], attempts: 1 }, root_cause: { summary: 's' } });
    const b = mergeCase(a, { testids: ['b'], fix: { files: ['y.js'], attempts: null }, root_cause: { summary: '' } });
    expect(b.testids).toEqual(['a', 'b']);
    expect(b.fix).toMatchObject({ files: ['x.js', 'y.js'], attempts: 1 });
    expect(b.root_cause.summary).toBe('s');
  });
});

describe('lessons.md', () => {
  it('append is deterministic, numbered and deduped by text', () => {
    let r = appendLesson('', { source: 'reoperation', text: 'Never touch  a.js', files: ['a.js'], case: 2 }, { now: NOW });
    expect(r.lesson.id).toBe('L1');
    expect(r.md.startsWith(LESSONS_HEADER)).toBe(true);
    r = appendLesson(r.md, { source: 'attending-concern', text: 'Always test b.' }, { now: NOW });
    expect(r.lesson.id).toBe('L2');
    const dup = appendLesson(r.md, { source: 'reoperation', text: 'Never touch a.js!' }, { now: NOW });
    expect(dup).toMatchObject({ added: false, lesson: { id: 'L1' } });
    expect(parseLessons(r.md)).toEqual([
      { id: 'L1', n: 1, source: 'reoperation', case: 2, text: 'Never touch a.js', files: ['a.js'], patterns: [], added: NOW },
      { id: 'L2', n: 2, source: 'attending-concern', case: null, text: 'Always test b.', files: [], patterns: [], added: NOW },
    ]);
  });
  it('numbers after a lesson whose header carries a "(note)" suffix', () => {
    const md = `${LESSONS_HEADER}
## L1 · second-opinion-block · case #4 (local dev run)
Never x.
`;
    expect(parseLessons(md).map((l) => l.id)).toEqual(['L1']);
    expect(appendLesson(md, { source: 'reoperation', text: 'Never y.' }, { now: NOW }).lesson.id).toBe('L2');
  });
  it('rejects lessons that are not Never/Always or have an unknown source', () => {
    expect(() => appendLesson('', { source: 'reoperation', text: 'Be careful' })).toThrow(/Never/);
    expect(() => appendLesson('', { source: 'vibes', text: 'Never x' })).toThrow(/source/);
  });
  it('the seeded roundMoney lesson is L1 and applies to money.js and tip.js', () => {
    const mem = loadMemory(FIXTURE);
    const l1 = mem.lessons.find((l) => l.id === 'L1');
    expect(l1.text).toBe('Never change roundMoney in money.js: it is shared with tip.js; a Math.round change altered tip totals on other bills.');
    expect(lessonsFor(mem, { files: ['apps/splitpal/src/lib/tip.js'] }).map((l) => l.id)).toEqual(['L1']);
    expect(lessonsFor(mem, { patterns: ['currency-format'] }).map((l) => l.id)).toEqual(['L2']);
  });
  it('the intake writes byte-identical lessons (parity with services/intake/src/memory.js)', () => {
    const input = { iid: 4, route: '/bill/:id/settle', note: 'still  broken', files: ['apps/splitpal/src/lib/split.js', 'tests/regressions/issue-4.spec.ts'], patterns: ['money-rounding'] };
    expect(intakeMemory.lessonFromRejection(input)).toEqual(lessonFromRejection(input));
    expect(intakeMemory.LESSONS_HEADER).toBe(LESSONS_HEADER);
    const l = { id: 'L3', source: 'reporter-rejected', case: 4, text: 'Always x', files: ['a.js'], patterns: ['p'], added: NOW };
    expect(intakeMemory.renderLesson(l)).toBe(renderLesson(l));
    const md = readFileSync(join(FIXTURE, '.shakefix/memory/lessons.md'), 'utf8');
    const a = intakeMemory.appendLessonText(md, lessonFromRejection(input), NOW);
    const b = appendLesson(md, lessonFromRejection(input), { now: NOW });
    expect(a.md).toBe(b.md);
    expect(intakeMemory.normalizeRoute('/bill/7/settle')).toBe(normalizeRoute('/bill/7/settle'));
  });
});

describe('recall', () => {
  const mem = loadMemory(FIXTURE);
  it('a second shake of the settle rounding bug recalls #4 first with reasons', () => {
    const m = recall(mem, queryFromReplay(secondShake));
    expect(m[0].iid).toBe(4);
    expect(m[0].score).toBeGreaterThanOrEqual(0.8);
    expect(m[0].reasons[0]).toBe('same route /bill/:id/settle');
    expect(m[0].why).toMatch(/testids 7\/7 shared/);
    expect(m[0].lessons).toEqual(['L1']);
    expect(seenBeforeLine(m)).toMatch(/^Seen before: #4 \(0\.\d+, same route/);
  });
  it('a currency report recalls #6, not #4', () => {
    const m = recall(mem, { route: '/bill/12', testids: ['bill-row-12', 'bill-total'], note: 'USD bill shows the rupee sign' });
    expect(m[0].iid).toBe(6);
    expect(m.find((x) => x.iid === 4)?.score ?? 0).toBeLessThan(0.45);
  });
  it('lesson files count as the area of the case they came from (tip.js -> #4)', () => {
    const m = recall(mem, { files: ['apps/splitpal/src/lib/tip.js'] });
    expect(m.map((x) => x.iid)).toEqual([4]);
  });
  it('is deterministic, limited to 3 and excludes the case itself', () => {
    const q = queryFromReplay(secondShake);
    expect(recall(mem, q)).toEqual(recall(mem, q));
    expect(recall(mem, { ...q, iid: 4 }).some((x) => x.iid === 4)).toBe(false);
    expect(recall({ cases: [], lessons: [] }, q)).toEqual([]);
  });
  it('builds a query from an intake issue description', () => {
    const q = queryFromIssueText(issueBody({ replay: secondShake }));
    expect(q).toMatchObject({ route: '/bill/7/settle', note: secondShake.note, rid: secondShake.rid });
    expect(q.testids).toContain('confirm-settle-btn');
    const q2 = queryFromIssueText('**Reporter note:** total wrong\n**Trigger:** shake · **Route:** `/bill/3` · x\n### Top console error\n```\nTypeError: boom\n```');
    expect(q2).toMatchObject({ note: 'total wrong', route: '/bill/3', consoleMsg: 'TypeError: boom' });
  });
});

describe('premortem (synthetic fixture history)', () => {
  it('second rounding shake: med risk, #4 needed 2 attempts, L1 applies, hands-off', () => {
    const pm = premortem(loadMemory(FIXTURE), { ...queryFromReplay(secondShake), files: ['apps/splitpal/src/lib/split.js'] });
    expect(pm).toMatchObject({ risk: 'med', breaks: 1, last_fix: { iid: 4, attempts: 2 }, autonomy: 'hands-off', policy_hit: null });
    expect(pm.summary).toBe('This area broke 1 time, last fix (#4) needed 2 attempts, lessons that apply: L1.');
    expect(pm.lessons.map((l) => l.id)).toEqual(['L1']);
  });
  it('first visit is low risk', () => {
    const pm = premortem(loadMemory(FIXTURE), { route: '/settings', testids: ['enable-shake-btn'], note: 'toggle does nothing', files: ['apps/splitpal/src/views/settings.js'] });
    expect(pm).toMatchObject({ risk: 'low', breaks: 0, autonomy: 'hands-off' });
    expect(pm.summary).toMatch(/^First visit/);
  });
  it('a reporter-rejected area with repeat breaks is high risk -> supervised + memory:high-risk', () => {
    const root = tempRepo();
    recordCase(root, { iid: 12, route: '/bill/7/settle', root_cause: { file: 'apps/splitpal/src/lib/split.js' }, fix: { attempts: 1 } }, { now: NOW });
    recordVerdict(root, 12, 'rejected', { now: NOW });
    const pm = premortem(loadMemory(root), { ...queryFromReplay(secondShake), files: ['apps/splitpal/src/lib/split.js'] });
    expect(pm).toMatchObject({ risk: 'high', autonomy: 'supervised', policy_hit: 'memory:high-risk' });
    expect(pm.factors).toContain('a reporter rejected a past fix here');
  });
  it('evidence cites replay step timestamps and the top console error', () => {
    const ev = evidenceFromReplay({ ...B1, console: [{ level: 'warn', msg: 'w' }, { level: 'error', msg: 'TypeError: x' }] });
    expect(ev.steps[0]).toBe('0.0s click bill-row-7');
    expect(ev.steps.at(-1)).toBe('2.5s click confirm-settle-btn');
    expect(ev).toMatchObject({ top_console_error: 'TypeError: x', expectation: 'settled-banner should be visible' });
  });
});

describe('index.json', () => {
  it('the synthetic fixture index is up to date (shakefix-memory rebuild-index --root <fixture>)', () => {
    const r = rebuildIndex(FIXTURE, { check: true });
    expect(r.errors).toEqual([]);
    expect(r.upToDate).toBe(true);
  });
  it('the live record index is valid and up to date (no assumptions about its contents)', () => {
    const r = rebuildIndex(REPO, { check: true });
    expect(r.errors).toEqual([]);
    if (r.upToDate) return;
    // A fix branch adds .shakefix/memory/cases/<iid>.json but never the index (CI rebuilds it after
    // merge), so the committed index may lag the case files.
    const committed = JSON.parse(readFileSync(join(REPO, '.shakefix/memory/index.json'), 'utf8'));
    const fresh = buildIndex(loadMemory(REPO));
    const had = committed.cases.map((c) => c.iid);
    // Case files can also be newer than the index (CI completes a case after merge, and two cases
    // closing close together race on index.json). Every indexed case must still exist, and the
    // lessons must match exactly: lessons are the part agents act on.
    expect(fresh.cases.map((c) => c.iid)).toEqual(expect.arrayContaining(had));
    expect(fresh.lessons.map((l) => l.id)).toEqual(committed.lessons.map((l) => l.id));
  });
  it('has the contracted shape: cases, lessons, hotspots, stats', () => {
    const idx = buildIndex(loadMemory(FIXTURE));
    expect(idx.schema).toBe('shakefix.memory-index/v1');
    expect(idx.cases.map((c) => c.iid)).toEqual([4, 6]);
    expect(idx.cases[0]).toMatchObject({ route: '/bill/:id/settle', pattern: 'money-rounding', attempts: 2, time_to_fix_s: 312, seen_before: null, lessons: ['L1'] });
    expect(idx.hotspots[0]).toEqual({ kind: 'file', file: 'apps/splitpal/src/lib/currency.js', count: 1, last_iid: 6 });
    expect(idx.stats).toMatchObject({ cases: 2, lessons: 2, repeat_cases: 0, repeat_bug_median_time_s: null, first_time_median_s: 228.5 });
  });
  it('a repeat case is derived as seen_before and drives the speedup metric', () => {
    const root = tempRepo();
    recordCase(root, {
      iid: 12, ...{ rids: [secondShake.rid] }, route: '/bill/7/settle', testids: queryFromReplay(secondShake).testids,
      symptom: { note: secondShake.note }, root_cause: { file: 'apps/splitpal/src/lib/split.js', line: 17, summary: 'remainder cent dropped again', pattern: 'money-rounding' },
      fix: { files: ['apps/splitpal/src/lib/split.js'], attempts: 1 }, lessons_applied: ['L1'],
      timestamps: { reported_at: '2026-10-12T08:00:00Z', operated_at: '2026-10-12T08:00:41Z' },
    }, { now: NOW });
    const r = rebuildIndex(root);
    const c = r.index.cases.find((x) => x.iid === 12);
    expect(c).toMatchObject({ seen_before: 4, time_to_fix_s: 41, lessons_applied: ['L1'] });
    expect(r.index.stats).toMatchObject({ repeat_cases: 1, repeat_bug_median_time_s: 41, first_time_median_s: 228.5, speedup: 5.57 });
    expect(r.index.hotspots[0]).toMatchObject({ count: 2, last_iid: 12 });
    expect(rebuildIndex(root, { check: true }).upToDate).toBe(true);
  });
  it('addLessonToIndex splices a lesson without the case files', () => {
    const idx = addLessonToIndex(buildIndex(loadMemory(FIXTURE)), { id: 'L3', source: 'reoperation', case: 4, text: 'Never x', files: [], patterns: [], added: '2026-12-01T00:00:00Z' });
    expect(idx.lessons.at(-1).id).toBe('L3');
    expect(idx.stats.lessons).toBe(3);
    expect(idx.generated_at).toBe('2026-12-01T00:00:00Z');
  });
});

describe('lesson builders', () => {
  const proof = { flows: [{ flow: 'change-tip', changes: [
    { id: 'c1', channel: 'screen', where: '/bill/9 · tip-total', before: '₹49.99', after: '₹50.00', label: 'unintended' },
    { id: 'c2', channel: 'screen', where: '/bill/7 · share', before: 333.33, after: 333.34, label: 'intended' },
  ] }] };
  it('turns a Second Opinion block into a Never lesson on the app files', () => {
    const l = lessonFromProof({ iid: 13, proof, files: ['apps/splitpal/src/lib/money.js', 'tests/regressions/issue-13.spec.ts'] });
    expect(l).toEqual({
      source: 'second-opinion-block', case: 13, files: ['apps/splitpal/src/lib/money.js'], patterns: [],
      text: 'Never change money.js in a way that alters /bill/9 · tip-total: ₹49.99 -> ₹50.00: Second Opinion blocked the first fix for #13 as unintended.',
    });
    expect(lessonFromProof({ iid: 1, proof: { flows: [] } })).toBeNull();
  });
  it('parses Second Opinion notes and Lesson lines', () => {
    const blocked = '### 🩺 Second Opinion — Behavior Diff (main ⟷ !9)\n| | Channel | Where | Before → After | Verdict |\n|---|---|---|---|---|\n| ⛔ | Screen | /bill/9 · tip-total | ₹49.99 → ₹50.00 | unintended: tip changed |\n\n**1 change · 0 intended · 1 unintended** → ⛔ blocked';
    const ok = '### 🩺 Second Opinion — Behavior Diff (main ⟷ !9)\n**1 change · 1 intended · 0 unintended** → ✅ ready';
    expect(secondOpinionFromNotes(['hello', blocked, ok])).toEqual({ intended: 1, unintended: 0, blocked_changes: ['/bill/9 · tip-total: ₹49.99 -> ₹50.00'] });
    expect(secondOpinionFromNotes(['nothing'])).toBeNull();
    expect(lessonLinesFromText('Closes #4\nLesson: Never edit roundMoney.\n- **Lesson:** Always use cents.\nLesson: maybe')).toEqual(['Never edit roundMoney.', 'Always use cents.']);
  });
});

describe('CLI: node packages/core/bin/shakefix-memory.js', () => {
  it('premortem --replay prints JSON with seen_before, risk and evidence', () => {
    const dir = tempRepo();
    writeFileSync(join(dir, 'replay.json'), JSON.stringify(secondShake));
    const r = cli(['premortem', '--replay', 'replay.json', '--iid', '12', '--root', dir]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ risk: 'med', autonomy: 'hands-off' });
    expect(r.json.seen_before[0].iid).toBe(4);
    expect(r.json.seen_before_line).toMatch(/^Seen before: #4/);
    expect(r.json.evidence.steps).toHaveLength(7);
  });
  it('recall with flags, lessons, add-lesson, record-case and rebuild-index --check', () => {
    const dir = tempRepo();
    const rc = cli(['recall', '--route', '/bill/12', '--testids', 'bill-total', '--note', 'rupee sign on a USD bill', '--root', dir]);
    expect(rc.json.matches[0].iid).toBe(6);
    expect(cli(['lessons', '--files', 'apps/splitpal/src/lib/money.js', '--root', dir]).json.lessons.map((l) => l.id)).toEqual(['L1']);
    const add = cli(['add-lesson', '--source', 'attending-concern', '--text', 'Always run the tip flow.', '--case', '4', '--root', dir, '--now', NOW]);
    expect(add.json).toMatchObject({ added: true, lesson: { id: 'L3' } });
    expect(cli(['add-lesson', '--source', 'attending-concern', '--text', 'nope', '--root', dir]).code).toBe(1);
    mkdirSync(join(dir, '.shakefix/tmp'), { recursive: true });
    mkdirSync(join(dir, 'reports', secondShake.rid), { recursive: true });
    writeFileSync(join(dir, 'reports', secondShake.rid, 'replay.json'), JSON.stringify(secondShake));
    writeFileSync(join(dir, '.shakefix/tmp/triage.json'), JSON.stringify({ rid: secondShake.rid, iid: 12, reported_at: '2026-10-12T07:59:20Z', suspect_files: ['apps/splitpal/src/lib/split.js'] }));
    const rec = cli(['record-case', '--iid', '12', '--triage', '.shakefix/tmp/triage.json', '--root-cause', 'apps/splitpal/src/lib/split.js:17 - remainder cent dropped',
      '--pattern', 'money-rounding', '--files', 'apps/splitpal/src/lib/split.js', '--lines-changed', '9', '--attempts', '1', '--seen-before', '4',
      '--lessons-applied', 'L1', '--now', '2026-10-12T08:00:00Z', '--root', dir]);
    expect(rec.code).toBe(0);
    expect(rec.json.case).toMatchObject({ iid: 12, route: '/bill/:id/settle', seen_before: 4, time_to_fix_s: 40, root_cause: { line: 17, pattern: 'money-rounding' } });
    expect(existsSync(join(dir, '.shakefix/memory/cases/12.json'))).toBe(true);
    expect(cli(['rebuild-index', '--check', '--root', dir]).code).toBe(1);
    expect(cli(['rebuild-index', '--root', dir]).json).toMatchObject({ written: true, cases: 3, lessons: 3 });
    expect(cli(['nope', '--root', dir]).code).toBe(1);
  });
});

// Fake ScmProvider for scripts/memory/record-case.mjs.
function fakeScm(files = {}, extra = {}) {
  const commits = [];
  return {
    commits,
    name: 'gitlab',
    defaultBranch: async () => 'main',
    getFile: async (p) => { if (p in files) return files[p]; const e = new Error('404'); e.status = 404; throw e; },
    commitFiles: async (c) => { commits.push(c); return { id: 'abc' }; },
    getMR: async () => ({ iid: 9, description: 'Closes #12\nLesson: Always replay the tip flow after touching money helpers.', merged_at: '2026-10-12T08:05:00Z' }),
    listMRNotes: async () => [{ body: '### Second Opinion\n**2 changes · 2 intended · 0 unintended** → ok' }],
    mrClosesIssues: async () => [{ iid: 12 }],
    getIssue: async () => ({ iid: 12, created_at: '2026-10-12T07:59:20Z', description: `<!-- shakefix:rid=${secondShake.rid} -->` }),
    request: async () => ({ changes: [{ new_path: 'apps/splitpal/src/lib/split.js', diff: '@@\n-a\n+b\n+c\n' }, { new_path: 'tests/regressions/issue-12.spec.ts', diff: '+x' }] }),
    ...extra,
  };
}

describe('scripts/memory/record-case.mjs (CI writer)', () => {
  const quiet = () => {};
  it('merged: completes the case, appends the Attending lesson, rebuilds index, one [skip ci] commit', async () => {
    const dir = tempRepo();
    const scm = fakeScm({ '.shakefix/memory/lessons.md': readFileSync(join(dir, '.shakefix/memory/lessons.md'), 'utf8') });
    let out = '';
    await recordMain(['merged', '--mr', '9', '--root', dir], { env: {}, scm, out: (s) => { out = s; }, now: '2026-10-12T08:10:00Z' });
    const res = JSON.parse(out);
    expect(res).toMatchObject({ issues: [12], cases: ['.shakefix/memory/cases/12.json'], lessons_added: ['L3'], committed: true });
    const c = JSON.parse(readFileSync(join(dir, '.shakefix/memory/cases/12.json'), 'utf8'));
    expect(c).toMatchObject({ fix: { mr: 9, files: ['apps/splitpal/src/lib/split.js'], lines_changed: 3 }, second_opinion: { intended: 2, unintended: 0 }, time_to_fix_s: 340 });
    expect(scm.commits).toHaveLength(1);
    expect(scm.commits[0].message).toBe('chore(memory): record #12 from !9 [skip ci]');
    expect(scm.commits[0].files.map((f) => f.path)).toEqual(['.shakefix/memory/cases/12.json', '.shakefix/memory/lessons.md', '.shakefix/memory/index.json']);
    expect(parseLessons(scm.commits[0].files[1].content).at(-1)).toMatchObject({ id: 'L3', source: 'attending-concern', case: 12 });
    expect(chartRows(loadMemory(dir), c)[1]).toMatch(/^\| \*\*Evidence\*\* \| Second Opinion 2 intended \/ 0 unintended/);
    void quiet;
  });
  it('proof: an unintended verdict appends a second-opinion-block lesson on main; ready does nothing', async () => {
    const dir = tempRepo();
    const proofPath = join(dir, 'proof.json');
    writeFileSync(proofPath, JSON.stringify({ mr: 9, flows: [{ flow: 'tip', changes: [{ where: '/bill/9 · tip-total', before: '₹49.99', after: '₹50.00', label: 'unintended' }] }] }));
    const diff = join(dir, 'diff.txt');
    writeFileSync(diff, '1\t1\tapps/splitpal/src/lib/money.js\n30\t0\ttests/regressions/issue-12.spec.ts\n');
    const scm = fakeScm({ '.shakefix/memory/index.json': readFileSync(join(dir, '.shakefix/memory/index.json'), 'utf8') });
    let out = '';
    await recordMain(['proof', '--proof', proofPath, '--verdict', '10', '--diff-files', diff, '--root', dir], { env: {}, scm, out: (s) => { out = s; }, now: NOW });
    expect(JSON.parse(out)).toMatchObject({ verdict: 'unintended', lessons_added: ['L3'], committed: true, recorded: true });
    // remote lessons.md missing (404): falls back to the working tree copy (L1, L2), so this is L3
    const [commit] = scm.commits;
    expect(commit.message).toBe('chore(memory): lesson L3 from Second Opinion on !9 [skip ci]');
    expect(parseLessons(commit.files[0].content)[2]).toMatchObject({ source: 'second-opinion-block', case: 12, files: ['apps/splitpal/src/lib/money.js'] });
    expect(JSON.parse(commit.files[1].content).lessons.at(-1).id).toBe('L3');

    const scm2 = fakeScm();
    writeFileSync(proofPath, JSON.stringify({ mr: 9, flows: [] }));
    await recordMain(['proof', '--proof', proofPath, '--verdict', '0', '--root', dir], { env: {}, scm: scm2, out: (s) => { out = s; } });
    expect(JSON.parse(out).recorded).toBe(false);
    expect(scm2.commits).toHaveLength(0);
  });
  it('without credentials it writes the working tree only and warns', async () => {
    const dir = tempRepo();
    let out = '';
    await recordMain(['merged', '--issues', '6', '--root', dir], { env: {}, out: (s) => { out = s; }, now: NOW });
    const res = JSON.parse(out);
    expect(res.warnings[0]).toMatch(/no SCM credentials/);
    expect(res.cases).toEqual(['.shakefix/memory/cases/6.json']);
    expect(JSON.parse(readFileSync(join(dir, '.shakefix/memory/cases/6.json'), 'utf8')).timestamps.deployed_at).toBe(NOW);
  });
});

describe('addLesson / recordVerdict on disk', () => {
  it('writes lessons.md and the index together', () => {
    const dir = tempRepo();
    const r = addLesson(dir, lessonFromRejection({ iid: 6, route: '/bill/:id', note: 'still rupees' }), { now: NOW });
    expect(r).toMatchObject({ added: true, lesson: { id: 'L3', source: 'reporter-rejected' } });
    expect(JSON.parse(readFileSync(join(dir, '.shakefix/memory/index.json'), 'utf8')).stats.lessons).toBe(3);
    expect(recordVerdict(dir, 6, 'rejected', { now: NOW }).case.reporter_verdicts).toEqual({ confirmed: 1, rejected: 1 });
    expect(() => recordVerdict(dir, 6, 'meh')).toThrow();
  });
});
