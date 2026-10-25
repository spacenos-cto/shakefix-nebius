# ShakeFix for judges

**Judges page:** https://shakefix-bdb22c.gitlab.io/judges.html?intake=https://intake-pzd4uebegq-uc.a.run.app (criteria → evidence, live-verified certificates)

## The 60-second path

1. **Break it yourself.** https://shakefix-bdb22c.gitlab.io/try.html : pick a CareRx bug, press **Shake**. A real
   GitLab issue opens and the agents (one GitLab Duo flow) start on it.
2. **Open issue #14** (https://gitlab.com/nxt-spacenos-global/shakefix/-/work_items/14). Filed by the intake from
   a shake: Margaret was charged $24 for a $12 refill. Read the Triage note (reproduced, with a failing spec)
   and the Blast Radius note (902 synthetic patients use that button).
3. **Open MR !12** (https://gitlab.com/nxt-spacenos-global/shakefix/-/merge_requests/12). A 3-line fix, the
   fix summary, the Second Opinion behaviour diff and Fix Confidence. Then its pipeline: merge, deploy, smoke.
4. **Check the referee.** Control MRs !10 (planted bad fix, must be blocked) and !11 (harmless, must pass).
   Mission Control's **Numbers** tab scores them: https://shakefix-bdb22c.gitlab.io/
5. **Re-verify.** `node scripts/verify-evidence.mjs` checks every link through GitLab's public API.

## Key deliverables and where to find them

| Deliverable | Where |
|---|---|
| GitLab Duo flow: Triage Nurse, Surgeon, Attending, Discharge (AI Catalog "ShakeFix ER") | [`.gitlab/duo/flows/shakefix.yml`](.gitlab/duo/flows/shakefix.yml) |
| Shake SDK (replay, redaction, verdict sheet) | [`packages/sdk/`](packages/sdk/) |
| Intake: issues, states, stopwatch, certificates, infra triage, pager | [`services/intake/`](services/intake/) |
| Replay → Playwright spec generator | [`packages/replay/`](packages/replay/) |
| Second Opinion behaviour diff + Fix Confidence gate | [`packages/proof/`](packages/proof/) |
| Blast Radius (Orbit or static graph, synthetic patients, verified context) | [`packages/core/src/blast/`](packages/core/src/blast/), [`docs/BLAST-RADIUS.md`](docs/BLAST-RADIUS.md) |
| Demo app with seeded bugs C1–C4 | [`apps/carerx/`](apps/carerx/), [`SEEDED_BUGS.md`](apps/carerx/SEEDED_BUGS.md) |
| Mission Control, Try page, certificate page | [`dashboard/`](dashboard/) |
| CI/CD: tests, scans, preview, Second Opinion, Blast Radius, auto-merge, deploy, smoke, rollback | [`.gitlab-ci.yml`](.gitlab-ci.yml), [`scripts/ci/`](scripts/ci/) |
| Terraform (Cloud Run, WIF, remote state, explained plans) | [`infra/`](infra/) |
| Policy and governance | [`.shakefix/policy.yml`](.shakefix/policy.yml), [`CODEOWNERS`](CODEOWNERS) |
| Sources for every statistic | [`docs/STATS.md`](docs/STATS.md) |
| Graded eval | [`evals/`](evals/) |

## The short version

Older patients are the users least likely to report a bug and most hurt by one: a double charge, a privacy
switch that lies, a refill button a screen reader can't name, a thyroid dose shown in mg instead of mcg.

ShakeFix turns a shake into a fix. The SDK has already recorded the last 30 taps, console errors, network calls
and a redacted screenshot. The intake on Cloud Run opens a GitLab issue. A GitLab Duo flow with four agents takes
over: the Triage Nurse writes a Playwright test that must fail on `main` (no reproduction, no fix) and maps the
Blast Radius; the Surgeon makes the smallest change that turns it green; the Attending reviews it against
policy; Discharge writes a plain-English fix summary.

The fix is AI code too, so Second Opinion, which never writes code, deploys it beside production, replays every
user flow on both and diffs what the user sees, what the API returns and what the database writes. Fix
Confidence (0–100) decides: GO merges by itself, HOLD waits for a human, BLOCK goes back to surgery. Dosing code
always waits for a pharmacist. After deploy and a production smoke test (automatic rollback, paging the
on-call), the reporter's phone asks "Fixed ✓. Is it working for you now?" and a signed certificate records it.

Every human touch is counted. Where a number is weak, the README's Limits say so.

## Re-verify

```bash
node scripts/verify-evidence.mjs          # every link, via GitLab's public API
node evals/run.mjs --mode local           # the graded eval (~3 minutes, needs Playwright's Chromium)
corepack pnpm -r --if-present test        # all unit tests
```
