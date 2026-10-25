# Ledger #<iid> — <title>
- **Route:** /bill/:id/settle
- **Files:** apps/splitpal/src/lib/split.ts:42
- **Root cause:** <one sentence>
- **Pattern:** <kebab-case pattern, e.g. money-rounding>
- **Fix:** <one sentence>
- **Siblings checked:** <file:line (same pattern → fixed)>, <file (n/a)>
- **Regression spec:** tests/regressions/issue-<iid>.spec.ts
- **MR:** !<n> · **Second Opinion:** <n> intended / <m> unintended

<!--
index.json entry appended alongside this file:
{"id":"<iid>","iid":<iid>,"route":"/bill/:id/settle","files":["apps/splitpal/src/lib/split.ts"],
 "rootCause":"...","pattern":"money-rounding","fixedAt":null,"mr":null}
`fixedAt` and `mr` are filled in by CI (scripts/ci/ledger-commit.sh) after the production deploy.
-->
