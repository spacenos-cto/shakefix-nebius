# Changelog

All notable changes to ShakeFix. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- The behavior-diff gate is now called **Second Opinion** everywhere people read it (MR card
  "🩺 Second Opinion — Behavior Diff", footer, CI job `second_opinion`, docs, dashboard). The package
  path `packages/proof`, the `proof` CLI, `proof.json` (`shakefix.proof/v1`) and env vars are unchanged;
  `second-opinion` is a new bin alias.

### Added
- Provider switch (`packages/core`, docs/PROVIDERS.md): `SCM_PROVIDER=gitlab|github`,
  `MODEL_PROVIDER=anthropic|openai-compatible|none`, `AGENT_RUNNER=duo|local`. The new local agent runner
  (`shakefix-agent --issue <n> [--dry-run]`) runs the same four ER prompts, which
  `scripts/sync-prompts.mjs` extracts from the Duo YAML. GitHub Actions template in `templates/github/`.
  The default GitLab + Duo path is unchanged.
- Reporter verdict loop ("the patient's verdict"): after "Fixed ✓" the SDK asks "is it working for you
  now?" (👍 / 👎, also as notification actions in the SplitPal service worker). 👍 → `shakefix::verified`;
  👎 → the issue is reopened with a new replay (`reports/<rid>/replay-<n>.json`) and the flow re-triages.
  New intake endpoint `POST /v1/reports/:rid/verdict`; `/v1/board` items carry `verdict` / `verdicts`;
  the ER Board shows a Verified column, 👍/👎 chips and "% fixes confirmed by reporter".
- GitLab Duo custom flow `shakefix` with four ER agents (Triage Nurse, Surgeon, Attending,
  Discharge) and conditional routing for "could not reproduce".
- `.gitlab/duo/agent-config.yml`: setup script, cache and sandbox network policy for flow runs.
- Patient Chart MR template, shake-report issue template, `.gitlab/labels.sh`.
- `.shakefix/policy.yml`, persona guide, Bug Ledger (`index.json`, entry template), CODEOWNERS.
- Root `.gitlab-ci.yml`: lint, tests, SAST / dependency / secret scanning, Cloud Build image,
  tagged Cloud Run preview, Second Opinion gate, auto-merge, production deploy, smoke test, automatic
  rollback, reporter notification, issue discharge, Ledger stamp, ER Board on Pages, intake deploy.
- CI scripts: `merge.sh`, `label.sh`, `comment.sh`, `notify.sh` (HMAC-signed), `close-issue.sh`,
  `rollback.sh`, `traffic.sh`, `ledger-commit.sh`, `build-catalog-flow.mjs`.
- Terraform for Google Cloud: Artifact Registry, Cloud Run (splitpal, intake), Firestore,
  Secret Manager, CI service account, Workload Identity Federation for gitlab.com, budget alert.
- ER Board dashboard (Vite, vanilla JS) with live polling, headline metrics, Ledger panel and demo mode.
- Docs: architecture (Mermaid), GitLab setup, limits, SCI method skeleton; demo reset script.
