# ShakeFix Medical Record: lessons

Append-only. One lesson per `## L<n>` block: `## L<n> · <source> · case #<iid>`, then one
line of text that starts with "Never" or "Always", then optional `- files:`, `- patterns:` and
`- added:` lines. Written by CI (scripts/memory/record-case.mjs), the intake (reporter rejected)
and `node packages/core/bin/shakefix-memory.js add-lesson`. Never edit or reorder old lessons:
add a new one that supersedes it. Format: docs/MEMORY.md.

## L1 · second-opinion-block · case #4 (local dev run)
Never change roundMoney in money.js: it is shared with tip.js; a Math.round change altered tip totals on other bills.
- files: apps/splitpal/src/lib/money.js, apps/splitpal/src/lib/tip.js
- patterns: money-rounding
- added: 2026-10-10T09:30:00Z

## L2 · reoperation · case #6
Never edit tip.js, money.js or split.js to fix a bill.js view crash: the fix stays in views/bill.js, and /bill/9 tip-total diffs from the change-tip flow are mid-flow timing (5% vs 10% snapshot), not fix side effects.
- files: apps/splitpal/src/views/bill.js
- added: 2026-10-10T23:20:23.495Z

## L3 · attending-concern · case #14
Always make POST /prescriptions/:id/refills idempotent or guard against double submission, because the server will still create a second order and charge if any client sends two requests.
- files: apps/carerx/src/views/refill.js
- added: 2026-10-12T08:45:51.765Z

## L4 · second-opinion-block · case #16
Never change styles.css, rx.js in a way that alters PATCH /api/me/privacy · $.privacy.shareHealthData: false -> true (+13 more): Second Opinion blocked the first fix for #16 as unintended.
- files: apps/carerx/src/styles.css, apps/carerx/src/views/rx.js
- added: 2026-10-12T09:23:52.467Z

## L5 · reoperation · case #16
Never fix #16 by carrying unrelated server changes: the first branch was cut before #15 merged, so Second Opinion saw the privacy fix reverted (PATCH /me/privacy shareHealthData) and /rx/1/refill blank; rebase on main and change only rx.js and styles.css.
- files: apps/carerx/src/views/rx.js, apps/carerx/src/styles.css
- added: 2026-10-12T09:39:48.234Z

## L6 · attending-concern · case #17
Always render medication units from the stored unit field and never remap units in dosing display code.
- files: apps/carerx/src/dosing/strength.js
- added: 2026-10-12T10:13:58.986Z
