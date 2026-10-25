# Seeded bugs

The demo app ships with four deliberate, deterministic bugs. The authoritative list, with file
paths and exact repro steps, lives with the app:

**[`apps/splitpal/SEEDED_BUGS.md`](../apps/splitpal/SEEDED_BUGS.md)**

Summary (BUILD_SPEC 6.2):

| ID | Bug | Expected outcome in the loop |
|---|---|---|
| B1 (hero) | 1000 split 3 ways loses 0.01, settle never completes | Naive fix blocked by Second Opinion (1 unintended), re-operation passes |
| B2 | Blank person name crashes the split view | Hands-off: deployed, reporter notified |
| B3 | USD bill shows the rupee sign in the totals header | Hands-off: deployed |
| B4 (governance) | Session token expiry off by one in `auth/` | `needs-human`, MR waits for code-owner approval, never auto-merged |

## Mark the seeded state (once)

After the app with all four bugs is on `main`, tag that commit:

```bash
git tag -a seeded-bugs -m "SplitPal with seeded bugs B1-B4"
git push origin seeded-bugs
```

Never move this tag unless the app itself changes (new screens or test ids). If it must move,
re-verify every bug by hand first.

## Reset for another recording

```bash
scripts/reset-demo.sh --push          # restore apps/splitpal from the tag, clear specs + Ledger, open an MR
scripts/reset-demo.sh --keep-ledger   # keep the Ledger to show "family fixed" on a later bug
```

Then:

1. Merge the `demo-reset` MR. The main pipeline redeploys the buggy app.
2. Close or relabel leftover `shakefix` issues so the ER Board starts clean.
3. Reproduce each bug by hand on a phone over HTTPS before recording.

## Rehearsal matrix (BUILD_SPEC 19.4)

| # | Scenario | How to start | Expect |
|---|---|---|---|
| 1 | B2 empty name | shake on the bill view | deployed + push |
| 2 | B3 currency | shake after switching to USD | deployed |
| 3 | B1 naive fix | shake on settle | Second Opinion blocks once, then deployed |
| 4 | B4 auth | shake in settings | `needs-human`, not merged |
| 5 | Not reproducible | file a fake report | `needs-info` chart |
| 6 | Duplicate | shake the same bug twice | "+1 reporter" comment, no new flow |
| 7 | Rollback drill | run a main pipeline with `FORCE_SMOKE_FAIL=1` | smoke fails, traffic rolls back, issue reopened |
