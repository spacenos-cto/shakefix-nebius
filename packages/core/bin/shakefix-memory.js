#!/usr/bin/env node
// ShakeFix Medical Record CLI (docs/MEMORY.md). JSON on stdout, so Duo agents (run_command), the
// local runner and CI can all use it. No network, no dependencies.
//
//   shakefix-memory recall        [query]                    top 3 similar past cases
//   shakefix-memory premortem     [query]                    risk + history + lessons + autonomy
//   shakefix-memory lessons       --files a,b [--patterns p]  lessons that apply to files / patterns
//   shakefix-memory rebuild-index [--check]                  regenerate .shakefix/memory/index.json
//   shakefix-memory add-lesson    --source <s> --text "Never ..." [--files a,b] [--patterns p] [--case n] [--no-index]
//   shakefix-memory record-case   --iid n [--replay f] [--triage f] [--root-cause "file:line - summary"]
//                                 [--pattern p] [--files a,b] [--lines-changed n] [--attempts n] [--mr n]
//                                 [--seen-before n] [--lessons-applied L1,L2] [--propose-lesson "Never ..."] [--index]
//
// query: --replay reports/<rid>/replay.json | --issue-file issue.md | --triage .shakefix/tmp/triage.json
//        and/or --route r --testids a,b --console "msg" --note "text" --files a,b --pattern p --iid n
// Common: --root <repo> (default: nearest folder with .shakefix/), --limit n (default 3)

import { parseArgs } from 'node:util';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addLesson, evidenceFromReplay, findRepoRoot, lessonsFor, loadMemory, mergeQuery, parseRootCause, premortem,
  queryFromIssueText, queryFromReplay, rebuildIndex, recall, recordCase, caseFromReplay, seenBeforeLine,
} from '../src/memory/index.js';

const OPTIONS = {
  root: { type: 'string' }, limit: { type: 'string' },
  replay: { type: 'string' }, 'issue-file': { type: 'string' }, triage: { type: 'string' },
  route: { type: 'string' }, testids: { type: 'string' }, console: { type: 'string' }, note: { type: 'string' },
  files: { type: 'string' }, pattern: { type: 'string' }, patterns: { type: 'string' }, iid: { type: 'string' },
  check: { type: 'boolean', default: false },
  source: { type: 'string' }, text: { type: 'string' }, case: { type: 'string' }, 'no-index': { type: 'boolean', default: false },
  'root-cause': { type: 'string' }, 'lines-changed': { type: 'string' }, attempts: { type: 'string' }, mr: { type: 'string' },
  'seen-before': { type: 'string' }, 'lessons-applied': { type: 'string' }, 'propose-lesson': { type: 'string', multiple: true },
  index: { type: 'boolean', default: false }, now: { type: 'string' },
};

const csv = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const int = (s) => (s === undefined || s === '' ? undefined : Number.parseInt(s, 10));

function readJsonMaybe(root, p) {
  if (!p) return null;
  const full = isAbsolute(p) ? p : join(root, p);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, 'utf8'));
}

/** Build the query and (when available) the replay from flags. */
export function queryFromFlags(root, o) {
  const triage = readJsonMaybe(root, o.triage);
  let replay = readJsonMaybe(root, o.replay);
  if (!replay && triage?.rid) replay = readJsonMaybe(root, `reports/${triage.rid}/replay.json`);
  let q = {};
  if (replay) q = queryFromReplay(replay);
  else if (o['issue-file']) {
    const full = isAbsolute(o['issue-file']) ? o['issue-file'] : join(root, o['issue-file']);
    q = queryFromIssueText(readFileSync(full, 'utf8'));
  }
  if (triage) q = mergeQuery(q, { route: triage.route, files: triage.suspect_files, iid: triage.iid, note: q.note || triage.failure });
  q = mergeQuery(q, {
    route: o.route, testids: o.testids, consoleMsg: o.console, note: o.note, files: o.files, pattern: o.pattern, iid: int(o.iid),
  });
  return { query: q, replay, triage };
}

export async function main(argv = process.argv.slice(2), { out = (s) => console.log(s), cwd = process.cwd() } = {}) {
  const [cmd, ...rest] = argv;
  const { values: o } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false });
  const root = o.root ? resolve(cwd, o.root) : findRepoRoot(cwd);
  const limit = int(o.limit) ?? 3;
  const print = (v) => out(JSON.stringify(v, null, 2));

  switch (cmd) {
    case 'recall': {
      const { query } = queryFromFlags(root, o);
      const matches = recall(loadMemory(root), query, { limit });
      print({ query: summarizeQuery(query), matches, seen_before_line: seenBeforeLine(matches) });
      return 0;
    }
    case 'premortem': {
      const { query, replay } = queryFromFlags(root, o);
      const pm = premortem(loadMemory(root), query, { limit });
      print({ query: summarizeQuery(query), ...pm, seen_before_line: seenBeforeLine(pm.seen_before), evidence: evidenceFromReplay(replay) });
      return 0;
    }
    case 'lessons': {
      const memory = loadMemory(root);
      print({ lessons: lessonsFor(memory, { files: csv(o.files), patterns: csv(o.patterns ?? o.pattern) }) });
      return 0;
    }
    case 'rebuild-index': {
      const r = rebuildIndex(root, { check: o.check });
      print({ path: r.path, up_to_date: r.upToDate, written: r.written, cases: r.index.stats.cases, lessons: r.index.stats.lessons, errors: r.errors });
      return o.check && !r.upToDate ? 1 : 0;
    }
    case 'add-lesson': {
      if (!o.source || !o.text) throw new Error('add-lesson needs --source and --text');
      const r = addLesson(root, {
        source: o.source, text: o.text, files: csv(o.files), patterns: csv(o.patterns ?? o.pattern), case: int(o.case),
      }, { index: !o['no-index'], ...(o.now ? { now: o.now } : {}) });
      print(r);
      return 0;
    }
    case 'record-case': {
      const iid = int(o.iid);
      if (!iid) throw new Error('record-case needs --iid');
      const { replay, triage } = queryFromFlags(root, o);
      const rc = parseRootCause(o['root-cause']);
      const patch = {
        iid,
        ...caseFromReplay(replay),
        ...(triage?.route && !replay ? { route: triage.route } : {}),
        root_cause: { ...rc, pattern: o.pattern },
        fix: { files: csv(o.files), lines_changed: int(o['lines-changed']), mr: int(o.mr), attempts: int(o.attempts) },
        seen_before: int(o['seen-before']),
        lessons_applied: csv(o['lessons-applied']),
        proposed_lessons: (o['propose-lesson'] ?? []).map((text) => ({ source: 'reoperation', text, files: csv(o.files) })),
        timestamps: { reported_at: triage?.reported_at, operated_at: o.now ?? new Date().toISOString() },
      };
      const r = recordCase(root, patch, { index: o.index, ...(o.now ? { now: o.now } : {}) });
      print({ path: r.path, created: r.created, index: r.index, case: r.case });
      return 0;
    }
    default:
      throw new Error(`unknown command ${cmd ?? ''} (recall | premortem | lessons | rebuild-index | add-lesson | record-case)`);
  }
}

const summarizeQuery = (q) => ({ route: q.route || null, testids: q.testids, note: q.note || null, console: q.consoleMsg || null, files: q.files, pattern: q.pattern || null });

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.log(JSON.stringify({ error: e.message }));
    console.error(`shakefix-memory: ${e.message}`);
    process.exitCode = 1;
  });
}
