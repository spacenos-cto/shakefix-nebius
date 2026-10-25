# The Medical Record: ShakeFix memory

The Medical Record is ShakeFix's long-term memory. It upgrades the old Bug Ledger. It follows the
LORE idea: agents get better when they **remember outcomes, not just code**. Before surgery they run a
pre-mortem. They recall similar past cases. They obey lessons learned from earlier mistakes.

It is deterministic and lives in the repo. There is no vector database, no embeddings and no new
dependency. Every answer is reproducible from files you can read in a merge request.

## 1. Files

| File | Written by | What |
|---|---|---|
| `.shakefix/memory/cases/<iid>.json` | Surgeon (draft, on the fix branch), CI after merge | One case per issue (`shakefix.case/v1`): symptom, root cause, fix, Second Opinion summary, reporter verdicts, time to fix |
| `.shakefix/memory/lessons.md` | CI, intake, `add-lesson` | Append-only lessons. Each one starts with "Never" or "Always" |
| `.shakefix/memory/index.json` | generated | Compact view for agents and the ER Board: cases, lessons, hotspots, stats |

The exact shapes are in [CONTRACTS.md](CONTRACTS.md#medical-record-docsmemorymd).

Only the case file travels on a fix branch. It is a new file per issue, so it never conflicts.
`lessons.md` and `index.json` are written straight to the default branch with `[skip ci]`.
Merge requests never touch them, so they never conflict either. Case files are bookkeeping:
`.shakefix/memory/**` is excluded from the policy size limits (`proof gate` and `merge.sh`).

## 2. The four ideas

1. **Recall ("Seen before").** `recall()` scores every past case and returns the top 3 with reasons.
   The score is a weighted mix of four deterministic signals. Only signals the query has are weighted.

   | Signal | Weight | How |
   |---|---|---|
   | Route | 0.25 | Normalised (`/bill/7/settle` -> `/bill/:id/settle`): same 1.0, prefix 0.6, same section 0.3 |
   | Testids | 0.25 | Jaccard over normalised testids (`bill-row-7` -> `bill-row-n`) |
   | Symptom text | 0.35 | TF-IDF cosine over note, expectation, console error, root-cause summary, pattern |
   | Files | 0.15 | Overlap with the case's files plus the files of lessons learned on it |

   A score of 0.45 or more counts as "seen before".
2. **Pre-mortem.** `premortem()` asks "how did this area go last time?" before anyone edits code.
   Risk points: the area broke before (+1, or +2 at 3+ breaks), the last fix needed 2+ attempts (+1),
   a past fix had side effects (Second Opinion block or re-operation, +1), a reporter rejected a past
   fix (+2). 4+ is **high**, 2-3 is **med**, otherwise **low**. High risk recommends **supervised**
   autonomy and adds the policy hit `memory:high-risk`, which forces `needs-human`.
3. **Lessons.** Short "Never ..." / "Always ..." rules with the files and patterns they guard. They come from:
   1. `second-opinion-block`: Second Opinion caught an unintended change (`proof-gate.sh`).
   2. `reporter-rejected`: the reporter tapped 👎 after deploy (intake verdict hook).
   3. `reoperation`: the Surgeon's `--propose-lesson` after a re-operation (recorded at merge).
   4. `attending-concern`: "Lesson: Never/Always ..." lines the Discharge copies from the Attending's
      concerns into the MR description (recorded at merge).
4. **Hotspots and the repeat-bug speedup.** `index.json` counts cases per file and per route
   (`hotspots`). It also compares the median time to fix a **repeat** bug (`seen_before` set)
   with a **first-time** bug: `stats.repeat_bug_median_time_s` vs `stats.first_time_median_s`, and `speedup`.
   Time to fix = issue created -> first green fix commit (the Surgeon's `record-case`), else -> merge.

## 3. Who uses it, when

| Step | Who | Command / hook | Effect |
|---|---|---|---|
| Triage | Triage Nurse | `node packages/core/bin/shakefix-memory.js premortem --replay <replay> --iid <iid> --files <suspects>` | `seen_before`, `premortem`, `evidence` go into `.shakefix/tmp/triage.json` and an "In triage" issue note |
| Surgery | Surgeon | `shakefix-memory lessons --files ...`, then reads `cases/<seen iid>.json` | Lessons are hard constraints. A matching case gives the "family fix" hypothesis |
| Surgery | Surgeon | `shakefix-memory record-case --iid ... --root-cause ... --pattern ... --attempts ...` | Draft case committed with the fix |
| Review | Attending | reads `lessons.md` + `triage.json` | "violates L<n>" concerns; high risk -> `memory:high-risk` |
| Discharge | Discharge | Patient Chart | **History** row (seen before, lessons applied, pre-mortem) and **Evidence** row (replay step timestamps, top console error verbatim, regression test, Second Opinion summary) |
| MR pipeline | `scripts/ci/proof-gate.sh` | `scripts/memory/record-case.mjs proof` | Unintended changes -> `second-opinion-block` lesson on main |
| After deploy | `scripts/ci/close-issue.sh` | `scripts/memory/record-case.mjs merged` + `chart-rows` | Case completed (MR, files, Second Opinion, times), lessons appended, index rebuilt, one `[skip ci]` commit; the discharge chart gets History + Evidence rows |
| Reporter 👎 | intake `/v1/reports/:rid/verdict` | `services/intake/src/memory.js` | `reporter-rejected` lesson + verdict count, one `[skip ci]` commit (off with `MEMORY_LESSONS=0`) |

Every write is guarded. A memory failure is logged as a warning and never fails CI or a verdict.

## 4. CLI

```bash
node packages/core/bin/shakefix-memory.js recall    --replay reports/<rid>/replay.json
node packages/core/bin/shakefix-memory.js premortem --replay reports/<rid>/replay.json --iid 12 --files apps/splitpal/src/lib/split.js
node packages/core/bin/shakefix-memory.js premortem --issue-file .shakefix/tmp/issue.md
node packages/core/bin/shakefix-memory.js recall    --route /bill/12 --testids bill-total --note "rupee sign on a USD bill"
node packages/core/bin/shakefix-memory.js lessons   --files apps/splitpal/src/lib/money.js
node packages/core/bin/shakefix-memory.js add-lesson --source attending-concern --text "Always ..." --files a.js --case 12
node packages/core/bin/shakefix-memory.js record-case --iid 12 --triage .shakefix/tmp/triage.json \
  --root-cause "apps/splitpal/src/lib/split.js:17 - remainder cent dropped" --pattern money-rounding \
  --files apps/splitpal/src/lib/split.js --lines-changed 9 --attempts 1 --seen-before 4 --lessons-applied L1
node packages/core/bin/shakefix-memory.js rebuild-index [--check]
```

Every command prints JSON. Duo agents run it with `run_command`; the local runner's sandbox allows it
(`node <script under packages/>`). Library: `import { memory } from '@shakefix/core'` or `@shakefix/core/memory`.

## 5. What is in the record

`.shakefix/memory` holds only real runs. Today that is one case:

1. **#4, B1 settle rounding** (`/bill/:id/settle`, `split.js:17`, pattern `money-rounding`). Fixed in MR !1
   in 1 attempt, 447 s from report to green fix commit (2026-10-10). Not merged or deployed yet.
   Lesson **L1** comes from a local dev run on the same day: a naive `roundMoney` fix changed
   `/bill/9 · tip-total: ₹49.99 -> ₹50.00`. L1: "Never change roundMoney in money.js: it is shared
   with tip.js; a Math.round change altered tip totals on other bills."

The unit tests use a separate, clearly **synthetic** record in `packages/core/test/fixtures/memory/`
(an invented 2-attempt #4 and a currency case #6 with lesson L2). It is never read at runtime.

To reset the live record after a rehearsal, restore the folder from the commit you want:
`git checkout <ref> -- .shakefix/memory`.

## 6. Demo beat: the second shake

1. Shake the settle bug again (B1 is back after `scripts/reset-demo.sh`).
2. With today's record, `premortem` for that shake prints
   **"Seen before: #4 (0.94, same route /bill/:id/settle + testids 7/7 shared + ...)"** and
   **"Pre-mortem: med - This area broke 1 time, last fix (#4) needed 1 attempt"**. Risk is med because the
   area broke before and a past fix in it had a blocked side effect.
3. The Surgeon reads case #4 and L1. It goes straight to `split.js` (family fix, cents + largest remainder)
   and leaves `roundMoney` alone.
4. The Patient Chart's **History** row cites "Seen before #4" and the lessons applied. Its time to fix is
   compared with #4's 447 s first-time fix; the number shown is whatever the run measures.
5. After merge, `index.json` records the repeat case and the ER Board shows the repeat-bug speedup.

## 7. Why not a vector DB

1. **Auditable.** Lessons and cases are plain files in merge requests. Humans can review and revert them.
2. **Deterministic.** The same record and the same report always give the same recall and risk. Tests pin them.
3. **Small.** A project has tens or hundreds of cases. TF-IDF plus structure (route, testids, files)
   beats embeddings at this size, and it explains itself ("same route + testids 7/7 shared").
