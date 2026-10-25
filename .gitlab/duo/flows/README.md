# ShakeFix custom flow

`shakefix.yml` is the GitLab Duo Agent Platform custom flow that runs the ShakeFix ER team:

| # | Component | Role | Ends with |
|---|---|---|---|
| 1 | `triage_nurse` | Reproduces the shake report as a failing Playwright spec | one word: `reproduced`, `not_reproduced` or `not_shakefix`, plus `.shakefix/tmp/triage.json` |
| 2 | `surgeon` | Minimal fix, tests green, Ledger entry, branch `shakefix/<iid>-<slug>` | JSON surgery report |
| 3 | `attending` | Read-only review against the diagnosis and `.shakefix/policy.yml` | JSON `{approve, confidence, concerns, policy_hits}` |
| 4 | `discharge` | Opens the MR with the Patient Chart, sets labels, comments on the issue | JSON `{case, mr_iid, labels}` |

Routing: `triage_nurse` -> `surgeon` only when the answer is exactly `reproduced`.
`not_shakefix` ends the flow. Anything else goes straight to `discharge`, which files a
"could not reproduce" chart and adds `needs-info`.

The YAML validates against GitLab's own JSON schema
(`app/validators/json_schemas/ai_catalog/flow_v2.json`) and is about 13 KiB (the limit is 40 KiB).

## 1. Turn on custom flows

Group `nxt-spacenos-global` (or the hackathon subgroup) > **Settings > GitLab Duo**:

1. Duo Agent Platform: on.
2. Allow custom flows and flow triggers: on.
3. Execution: hosted runners are fine on GitLab.com (they carry the `gitlab--duo` tag).

## 2. Register the flow

You can register from the project or from the AI Catalog. The project route is simpler.

1. Project `shakefix` > left sidebar **AI > Flows** > **New flow**.
2. **Display name:** `ShakeFix ER`.
   **Description:** `Shake report -> failing spec -> minimal fix -> review -> MR with Patient Chart.`
3. **Visibility:** Public (the project must be public for the hackathon anyway).
4. **Configuration > Flow:** paste the full contents of `.gitlab/duo/flows/shakefix.yml`.
5. **Create flow**. If the editor rejects a key, see `docs/limits.md` (flow schema section) and record the message there.

Alternative: **Explore > AI Catalog > Flows > New flow**, same fields.

**Updating it later:** after editing the YAML, publish a new version from the repo instead of pasting again:
`GITLAB_TOKEN=<maintainer PAT> FLOW_ITEM_ID=<id from the flow URL> node scripts/push-flow.mjs`.
Projects that enabled the flow without pinning a version use the new version on the next run.

Alternative (tags, optional): the `ai_catalog_publish` CI job publishes `ai-catalog/flows/shakefix.yml`
through the `components/ai-catalog` CI/CD component. See the comments in `.gitlab-ci.yml`.

## 3. Enable it and add the triggers

Project > **AI > Flows > Managed > ShakeFix ER > Enable**, select project `shakefix`. Enabling
creates the flow service account (named like `ai-shakefix-er-<group>`). Note its username: the
intake needs it as `FLOW_SERVICE_ACCOUNT` for re-operation mentions.

Then **AI > Triggers > New flow trigger**:

| Field | Value |
|---|---|
| Description | `ShakeFix: new shake report` |
| Condition 1 | **On an event** > Event **Work item** > Run when **Created** |
| Condition 2 | **On an event** > Event **Mention** |
| Service account | the flow service account from above |
| Configuration source | **AI Catalog** > `ShakeFix ER` |

Optional goal per condition (needs the `ai_flow_trigger_goals` flag, GitLab 19.5+):

- Work item created:
  `Act only if this issue has the label shakefix and the marker <!-- shakefix:rid= -->. Otherwise answer not_shakefix and stop.`
- Mention:
  `Re-operate (or re-triage) the issue named in the context. For re-operate, read the Second Opinion report on the merge request it names; for re-triage, read the latest reports/<rid>/replay-<n>.json.`

The flow prompts already enforce this filter, so the goals are a second layer, not a requirement.

## 4. Important trigger rules

1. **Only humans fire triggers.** The intake creates issues with the maintainer's personal access
   token (`GITLAB_HUMAN_PAT`), never a project or group token. A bot, service account or another
   flow cannot start a trigger.
2. **Work item created** passes a short context block with the issue URL as the goal. The
   triage nurse parses the IID from `/-/issues/<iid>` or `/-/work_items/<iid>`.
3. **Mention** passes `Input: <comment>` and `Context: {Issue IID: <iid>}`. The intake posts
   `@<flow-service-account> re-operate: see Second Opinion report on !<mr>` with the human PAT when Second Opinion
   blocks a fix for the first time (BUILD_SPEC 11.7), and
   `@<flow-service-account> re-triage: reporter rejected the fix, see latest replay` when the reporter
   answers 👎 to "Fixed ✓ — is it working for you now?" (BUILD_SPEC 17.5). The issue is reopened and the
   new replay is committed as `reports/<rid>/replay-<n>.json` first.
4. Flow runs bill GitLab Credits to the service account, not the human.

## 5. Spike checklist

| Spike | Check |
|---|---|
| S0 | Flow saves without schema errors; a session appears under **AI > Sessions** |
| S1 | `curl` an issue with the human PAT; a session starts within about 30 s |
| S1b | A PAT-posted mention of the service account starts a second session |
| S2 | The triage nurse can run `npx playwright test` in the sandbox (see `agent-config.yml`) |

If S2 fails, keep the flow and let CI run the spec instead (BUILD_SPEC 25, S2 fallback).
