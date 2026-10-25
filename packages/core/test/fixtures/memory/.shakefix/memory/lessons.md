# ShakeFix Medical Record: lessons

SYNTHETIC TEST FIXTURE: invented history for packages/core/test/memory.test.js, not real ShakeFix data.

Append-only. One lesson per `## L<n>` block: `## L<n> · <source> · case #<iid>`, then one
line of text that starts with "Never" or "Always", then optional `- files:`, `- patterns:` and
`- added:` lines. Written by CI (scripts/memory/record-case.mjs), the intake (reporter rejected)
and `node packages/core/bin/shakefix-memory.js add-lesson`. Never edit or reorder old lessons:
add a new one that supersedes it. Format: docs/MEMORY.md.

## L1 · second-opinion-block · case #4
Never change roundMoney in money.js: it is shared with tip.js; a Math.round change altered tip totals on other bills.
- files: apps/splitpal/src/lib/money.js, apps/splitpal/src/lib/tip.js
- patterns: money-rounding
- added: 2026-09-20T10:03:00Z

## L2 · attending-concern · case #6
Always format money with Intl.NumberFormat and the bill's currency code; never hard-code or look up a currency symbol by hand.
- files: apps/splitpal/src/lib/currency.js
- patterns: currency-format
- added: 2026-09-21T09:06:00Z
