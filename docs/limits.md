# Limits and open questions (honest list)

Last reviewed: 2026-10-10. Each item says what we verified, what we could not, and the fallback.

## 1. GitLab Duo Agent Platform

### 1.1 Flow schema (verified)

Checked against `docs.gitlab.com/user/duo_agent_platform/flows/custom_flows_schema/`, the
[flow registry v1 spec](https://gitlab.com/gitlab-org/modelops/applied-ml/code-suggestions/ai-assist/-/blob/main/docs/flow_registry/v1.md)
and GitLab's validator `app/validators/json_schemas/ai_catalog/flow_v2.json`.
`.gitlab/duo/flows/shakefix.yml` passes that JSON schema locally (0 errors, about 13 KiB of 40 KiB).

| Fact | Effect on ShakeFix |
|---|---|
| Top-level `name`, `description`, `product_group` are rejected | Not used. Name and description are set in the UI. |
| `model` inside prompts is rejected; model comes from group settings | Not used. Claude is the group default. |
| `response_schema_id` / `response_schema_version` are not allowed in custom flows | Final answers are strings. The triage nurse answers one routing word and writes its JSON report to `.shakefix/tmp/triage.json`. |
| `max_cycles` exists in the v1 spec but is **not** in GitLab's `flow_v2.json` (AgentComponent has `additionalProperties: false`) | Not set. The budgets from BUILD_SPEC 10.2 (40/60/25/15) are in the prompts as guidance only. The engine default is 280 cycles per agent. |
| Routers support `condition: {input, routes}` | Used: `reproduced` → surgeon, `not_shakefix` → end, `default_route` → discharge. |
| `ui_log_events` allowed values: `on_agent_final_answer`, `on_tool_execution_success`, `on_tool_execution_failed`, `on_delegation`, `on_delegation_returns` | First three used. |
| Local prompts need `prompt_id`, `name`, `unit_primitives`, `prompt_template`; `params` allows `timeout` and `vertex_location` only | Followed. `placeholder: history` is set (allowed; the docs say it is also added automatically). |
| `inputs` entries may set `optional: true` | Used on discharge for surgeon/attending outputs, which do not exist on the "not reproduced" path. |
| Goal for **Work item created**: a short context block with the work item URL and the action | Triage parses the IID from `/-/issues/<iid>` or `/-/work_items/<iid>`. |
| Goal for **Mention**: `Input: <comment>` + `Context: {Issue IID: <iid>}` | Used for re-operation. |
| Triggers fire only for human actors (bots, service accounts and other flows cannot) | The intake uses the maintainer PAT for issue creation and for the re-operation mention. |

**Not verified until spike S0 runs on gitlab.com:**

1. That `"default_route"` is honoured for `AgentComponent` final answers. It is documented for
   router conditions in the v1 spec, but the examples use `HumanInputComponent` and
   `OneOffComponent`. Fallback: replace the triage router with `to: "surgeon"` and let the
   surgeon no-op when `.shakefix/tmp/triage.json` says `reproduced:false` (BUILD_SPEC 10.3 note).
2. That the routing word matches exactly (the model may add punctuation). The prompt demands one
   bare word; a mismatch falls through to `discharge`, which reads the JSON file and does the right thing.
3. That files written by one component (`.shakefix/tmp/triage.json`) are visible to the next.
   All components run in the same CI job workspace, so this is expected but unconfirmed.

### 1.2 Tools (partly verified)

All tool names used exist in `docs.gitlab.com/user/duo_agent_platform/agents/tools/`.
That page lists `read_file`, `edit_file`, `create_file_with_contents`, `find_files`, `grep`,
`list_dir`, `run_command` under "IDE only". Flows that run in CI/CD execute tools through the
GitLab Duo CLI on the runner (docs: "Executes tools (file operations, Git commands)"), and the
foundational Developer flow uses them, so we expect them to work in our flow. **Verify in S0/S2.**

Deviations from BUILD_SPEC 10.2 allowlists (deliberate):

| Agent | Added | Why |
|---|---|---|
| triage_nurse | `list_issue_notes`, `get_merge_request`, `list_all_merge_request_notes`, `list_dir` | Re-operation needs the Second Opinion report from the MR. |
| surgeon | `list_dir` | Navigation. |
| attending | `list_dir`, `find_files` | Read-only navigation. |
| discharge | `read_file`, `get_issue`, `gitlab_merge_request_search`, `update_merge_request` | Read triage.json; find the existing MR on re-operation; set MR labels. |

### 1.3 Sandbox and Playwright (spike S2, not verified)

1. The default flow image is UBI 9 with Node.js 20 (project targets Node 22; pnpm 9 still runs).
2. `npx playwright install --with-deps` needs apt; UBI has dnf. `agent-config.yml` installs Chromium
   plus a best-effort list of system libraries. If Chromium cannot start, either:
   - set `image: mcr.microsoft.com/playwright:v1.48.2-jammy` (no SRT, so **no sandbox and no network
     policy**), or
   - keep the sandbox and let CI run the spec (the `regression` job) while the triage nurse only writes it.
3. `setup_script` runs before the sandbox and sees the triggering user's tokens. It only installs.
4. Flow jobs do not receive project CI/CD variables (docs: execution variables).
5. `pnpm install --frozen-lockfile` needs a committed `pnpm-lock.yaml`.

### 1.4 Trial expiry

The Ultimate trial on `nxt-spacenos-global` ends about Nov 9. After that, Duo flows stop there.
The public repo, pipelines and Cloud Run demo stay up; judges see recorded sessions and pipeline
history. If the hackathon subgroup appears, the projects move there.

## 2. CI/CD

1. **Auto-merge timing:** `merge.sh` runs inside the MR pipeline, so it asks GitLab to merge when
   the pipeline succeeds (`auto_merge=true`, plus the older `merge_when_pipeline_succeeds=true`).
2. **Labels are re-read from the API:** `CI_MERGE_REQUEST_LABELS` is frozen at pipeline creation,
   while `shakefix::ready` is set by `proof-gate.sh` during the pipeline.
3. **Second Opinion base:** production runs with test hooks off, so Second Opinion cannot use it as a base.
   `deploy_prod` also deploys the same image with hooks on as tag `main-test` (no traffic).
   The first main pipeline must run before any MR can be proofed (or set `BASE_URL`).
4. **Ledger stamp** commits to `main` with the bot token. If the protected branch forbids it,
   the job fails softly (`allow_failure: true`).
5. **AI Catalog publish** is commented out. The `components/ai-catalog` component is pre-1.0
   (latest tag 0.0.32 on 2026-10-10) and expects its own envelope format, generated by
   `scripts/ci/build-catalog-flow.mjs`.
6. **Security templates** are moved to the `secure` stage by overriding `sast`,
   `dependency_scanning` and `secret_detection`.
7. **Smoke tests** rely on `playwright.config.ts` honouring `BASE_URL` and on flows tagged `@smoke`.

## 3. Second Opinion labeler

Second Opinion's labeler calls Claude directly through the Anthropic API from CI (`ANTHROPIC_API_KEY`),
falling back to deterministic rules if the call fails. The fixing agents run on GitLab Duo.

## 4. Notifications

1. iOS Web Push works only for PWAs added to the Home Screen (iOS 16.4+).
2. `web-push` is MPL-2.0. If MPL is not acceptable for the hackathon, the service worker polls
   `/v1/reports/:rid/status` instead (works only while the app is open).

## 5. Sustainability numbers

All SCI figures in `docs/sci.md` are estimates with cited sources. Until real numbers are filled
in, we do not opt in to the Environmental prize.

## 6. Google Cloud

1. Cloud Build runs as the CI service account (`CLOUD_LOGGING_ONLY`), so the CI SA needs
   `logging.logWriter` and `logging.viewer`.
2. Intake secrets have no values in Terraform. The intake starts without them until
   `intake_secrets_ready = true`.
3. Cloud Run min instances is 0, so the first request after idle is slow. Pre-warm before recording.
