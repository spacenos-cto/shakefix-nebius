# Second Opinion control benchmark: results

Expectations were registered first in [`EXPECTED.md`](EXPECTED.md) and [`expected.json`](expected.json)
(commit `84d407a`, pushed before any control branch). This file only adds what happened; the expectations
table is not edited.

**Result: 12 of 12 verdicts match the registered expectation** (4 GO, 3 HOLD, 5 BLOCK). Every MR ran at
exactly the SHA pinned in `expected.json`. The verdict is the label `scripts/ci/proof-gate.sh` put on the MR.

| MR | Branch | SHA (pinned = ran) | Expected | Verdict (label) | Match | Pipeline |
|---|---|---|---|---|---|---|
| !11 | `control/harmless` | `cc40abc` | GO | GO (`shakefix::ready`) | ✓ | [#2937884752](../../-/pipelines/2937884752) |
| !16 | `control/rename-refactor` | `6dfcb11` | GO | GO (`shakefix::ready`) | ✓ | [#2977808306](../../-/pipelines/2977808306) |
| !17 | `control/add-unit-test` | `bec9263` | GO | GO (`shakefix::ready`) | ✓ | [#2977808764](../../-/pipelines/2977808764) |
| !18 | `control/formatting` | `48f7265` | GO | GO (`shakefix::ready`) | ✓ | [#2977809368](../../-/pipelines/2977809368) |
| !19 | `control/dosing-unit` | `d2cb56b` | HOLD | HOLD (`needs-human`) | ✓ | [#2977809971](../../-/pipelines/2977809971) |
| !20 | `control/oversized-docs` | `100d2ae` | HOLD | HOLD (`needs-human`) | ✓ | [#2977810673](../../-/pipelines/2977810673) |
| !21 | `control/add-dependency` | `c6cf6e5` | HOLD | HOLD (`needs-human`) | ✓ | [#2977811132](../../-/pipelines/2977811132) |
| !10 | `control/planted-bad` | `aee0ccb` | BLOCK | BLOCK (`shakefix::unintended`) | ✓ | [#2937884505](../../-/pipelines/2937884505) |
| !22 | `control/api-date-only` | `0656197` | BLOCK | BLOCK (`shakefix::unintended`) | ✓ | [#2977812013](../../-/pipelines/2977812013) |
| !23 | `control/db-extra-write` | `3378892` | BLOCK | BLOCK (`shakefix::unintended`) | ✓ | [#2977812976](../../-/pipelines/2977812976) |
| !24 | `control/privacy-default` | `0c78dd4` | BLOCK | BLOCK (`shakefix::unintended`) | ✓ | [#2977813631](../../-/pipelines/2977813631) |
| !25 | `control/no-refills-copy` | `5b11636` | BLOCK | BLOCK (`shakefix::unintended`) | ✓ | [#2977814262](../../-/pipelines/2977814262) |

## Notes

1. **Precision and recall on the BLOCK class: 5/5 and 5/5.** Every planted side effect was blocked, and no
   harmless change was blocked.
2. **!20 needed one retry.** Its first `build_sdk` job died while the runner's Docker was restarting (the log
   stops in "Preparing environment"); the retried pipeline produced the expected HOLD. No code changed.
3. **What this does not show.** Twelve hand-written cases on one demo app. It shows the gate's rules and the
   behaviour diff work as designed, not a general false-positive rate.
