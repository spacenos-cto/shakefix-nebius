# Providers: running ShakeFix outside GitLab + Duo

ShakeFix was built for GitLab + Duo, and that stays the default. Three switches let the same code run
on other platforms by changing config only. The provider code lives in `packages/core` (`@shakefix/core`).

| Switch | Values | Default | What it changes |
|---|---|---|---|
| `SCM_PROVIDER` | `gitlab` · `github` | `gitlab` | Issues, notes, labels, commits, uploads, MRs/PRs, merge (intake, Second Opinion, agent tools) |
| `MODEL_PROVIDER` | `anthropic` · `openai-compatible` · `none` | `anthropic` | Second Opinion labeler and the local agent runner |
| `AGENT_RUNNER` | `duo` · `local` | `duo` on GitLab, `local` on GitHub | Who runs the four ER roles |

With no new variables set, nothing changes: the intake uses its own GitLab client, the CI scripts
still use `curl`, Second Opinion calls Claude once with no retry (`ANTHROPIC_API_KEY`, `PROOF_MODEL`),
and Duo runs the ER team.

## Matrix

| Setup | SCM | Agents | Model | CI | Status |
|---|---|---|---|---|---|
| **GitLab + Duo (default)** | `gitlab` | Duo custom flow (`.gitlab/duo/flows/shakefix.yml`) | Duo's model for agents; Claude (`anthropic`) for the labeler | `.gitlab-ci.yml` | Production path |
| GitHub + local runner + Claude | `github` | `local` (`packages/core/bin/shakefix-agent.js`) | `anthropic` | `templates/github/.github/workflows/shakefix.yml` | Port: unit-tested, not yet run end to end |
| GitHub + local runner + Nebius Nemotron | `github` | `local` | `openai-compatible` (Nebius Token Factory) | same template | Second Opinion runs live on Nemotron (`scripts/nebius/second-opinion.mjs`); agent roles wired, run locally with `--dry-run`. See [`docs/NEBIUS.md`](NEBIUS.md) |
| GitHub + local runner + Vultr | `github` | `local` | `openai-compatible` (Vultr Serverless Inference) | same template (Cloud Run deploy unchanged) | Port: unit-tested, not yet run end to end |
| Any + rules only | any | `duo` or none | `none` | any | Labeler uses deterministic rules; the local runner refuses to run without a model (it can still print its plan with `--dry-run`) |

## Environment variables

### SCM

| Variable | Used by | Notes |
|---|---|---|
| `SCM_PROVIDER` | all | `gitlab` (default) or `github`. Unknown values fail fast. |
| `GITLAB_URL`, `GITLAB_PROJECT_ID`, `GITLAB_HUMAN_PAT` | intake | Unchanged. |
| `CI_API_V4_URL`, `CI_PROJECT_ID`, `SHAKEFIX_BOT_TOKEN` | Second Opinion, CI | Unchanged. |
| `GITLAB_TOKEN` | core CLIs | Optional fallback token for `shakefix-agent` / `shakefix-scm` on GitLab. |
| `GITHUB_REPO` | all (GitHub) | `owner/name`. Falls back to `GITHUB_REPOSITORY`, which Actions sets. |
| `GITHUB_TOKEN` | all (GitHub) | Falls back to `GH_TOKEN`. Needs contents, issues and pull_requests write. |
| `GITHUB_API_URL` | all (GitHub) | Default `https://api.github.com` (GitHub Enterprise: `https://<host>/api/v3`). |
| `SCM_LABEL_MAP` | GitHub | Optional renames, e.g. `needs-human=help wanted,sev::1=P1`. |

GitHub has no scoped labels, so the GitHub provider fakes them: adding `shakefix::ready` removes any other
`shakefix::*` label on the issue or PR, as GitLab does. PRs stand in for MRs, and objects come back in the
GitLab shape (`iid`, `description`, `labels`, `web_url`, `source_branch`). GitHub has no attachment API,
so screenshots are committed under `reports/uploads/` with `[skip ci]`.

### Model

| Variable | Notes |
|---|---|
| `MODEL_PROVIDER` | `anthropic` (default), `openai-compatible` (aliases `openai`), `none` (aliases `rules`, `off`). |
| `MODEL_NAME` | Model id. Anthropic falls back to `PROOF_MODEL`, then `claude-sonnet-4-5`. Required for `openai-compatible`. |
| `MODEL_BASE_URL` | Required for `openai-compatible`; include the version, e.g. `https://host/v1`. Anthropic falls back to `ANTHROPIC_BASE_URL`. |
| `MODEL_API_KEY` | Falls back to `ANTHROPIC_API_KEY` for `anthropic` only. Optional for local OpenAI-compatible servers. |
| `MODEL_TIMEOUT_MS` | Default 60000. |

Every HTTP provider uses a timeout and retries once on network errors, 408, 429 and 5xx. The one
exception is the default Second Opinion labeler: it keeps its previous single attempt, so the default
path behaves exactly as before. `extractJson()` and `completeJson()` pull the first JSON object out
of a reply, even when the model wraps it in prose or code fences.

### Agent runner (local)

| Variable / flag | Notes |
|---|---|
| `AGENT_RUNNER` | `local` to run the ER team in CI; `duo` does nothing locally. |
| `--issue <n>` | Issue to treat. |
| `--dry-run` | Read-only tools run. Writes, commands, commits, PRs and comments are only printed. With `MODEL_PROVIDER=none` it prints the role plan and makes no calls at all. |
| `--max-tool-calls <n>` / `SHAKEFIX_MAX_TOOL_CALLS` | Caps each role's budget. The defaults come from the prompts: 40 / 60 / 25 / 15. |

The local runner has these properties:

1. **Same prompts as Duo.** `node scripts/sync-prompts.mjs` extracts the four prompts and toolsets from the
   flow YAML into `.shakefix/prompts/*.md`. A unit test and `--check` fail on any drift. Edit the YAML,
   never the `.md` files.
2. **Same tool names.** The tool names match Duo's (`get_issue`, `create_file_with_contents`, `edit_file`,
   `run_command`, `create_commit`, `create_merge_request`, ...). Each role gets only the tools its YAML
   component lists.
3. **Sandboxed paths.** Paths stay inside the repo: no `..`, no outside absolute paths, no symlink
   escapes, no `.git/`, and no writes to `node_modules`.
4. **Allowlisted commands.** `run_command` accepts only `node <script under packages/ or scripts/>`,
   `npx playwright test` (rewritten to `npx --no`, so nothing is downloaded), `pnpm test`,
   `pnpm --filter <pkg> test` and `pnpm exec playwright|vitest`, plus offline git subcommands.
   It refuses shell operators, `rm`, `curl`, `git push/fetch` and `node -e`, and it will not run
   scripts the agent itself wrote.
5. **Commits go through the SCM API.** `create_branch` + `create_commit` send the files as one commit
   through the API: GitHub's git data API or GitLab's commits API.
6. **Secrets stay out of commands.** Child processes run without `*TOKEN*`, `*KEY*`, `*SECRET*` or
   `*PAT*` env vars.
7. **Bounded.** Each role has a tool-call budget, and the routing matches the YAML routers.

The sandbox is defence in depth, not a jail. Run the local runner on an ephemeral CI runner.

## GitHub port checklist

1. Copy `templates/github/.github/workflows/shakefix.yml` to `.github/workflows/` in the GitHub repo.
2. Create the labels: `shakefix`, `sev::1..3`, `shakefix::*`, `needs-human`, `needs-info`. GitHub auto-creates
   labels that are missing when they are added, but in grey.
3. Add the secret `SHAKEFIX_GH_TOKEN` (fine-grained PAT or GitHub App). PRs, pushes and comments made with
   the default `GITHUB_TOKEN` do **not** start other workflows. This is the GitHub twin of
   "GitLab triggers ignore bot users".
4. Set up Workload Identity Federation for GitHub OIDC. Add a provider to the existing pool
   (`infra/wif.tf`) with issuer `https://token.actions.githubusercontent.com` and the attribute condition
   `assertion.repository == "<owner>/<repo>"`. Set `vars.GCP_WIF_PROVIDER` / `vars.GCP_SA_EMAIL`.
5. Intake: build it from the repo root with `templates/github/intake.Dockerfile`, which adds `packages/core`.
   Set `SCM_PROVIDER=github`, `GITHUB_REPO` and `GITHUB_TOKEN`.
6. Known gaps:
   1. `/v1/hooks/gitlab` has no GitHub webhook twin yet. The board learns "deployed" from the
      workflow's `/fixed` call, not from PR events.
   2. Re-operate and re-triage run through an `@shakefix ...` issue comment from a maintainer
      (`issue_comment` trigger).
   3. GitHub "auto-merge" needs GraphQL, so the merge job merges directly after the gates pass.

## Copy-paste configs

### 1. Nebius port (GitHub + local runner + Nemotron on Nebius Token Factory)

```bash
# GitHub repo -> Settings -> Secrets and variables -> Actions
SCM_PROVIDER=github                     # set by the workflow
AGENT_RUNNER=local                      # set by the workflow
MODEL_PROVIDER=openai-compatible        # vars.MODEL_PROVIDER
MODEL_BASE_URL=https://api.tokenfactory.nebius.com/v1   # vars.MODEL_BASE_URL  (Nebius Token Factory; dedicated/regional endpoints use api.tokenfactory.<region>.nebius.com/v1)
MODEL_NAME=nvidia/Nemotron-3-Ultra-550b-a55b            # vars.MODEL_NAME      (reasoning; fast calls: nvidia/nemotron-3-super-120b-a12b or nvidia/Nemotron-3_5-Lightning — confirm the live id with `--list-models`)
MODEL_API_KEY=<nebius token factory key>  # secrets.MODEL_API_KEY
PROOF_RESPONSE_FORMAT=json_schema       # optional: ask Nemotron for schema-valid JSON (see scripts/nebius/README.md)
SHAKEFIX_GH_TOKEN=<fine-grained PAT>    # secrets.SHAKEFIX_GH_TOKEN
SHAKEFIX_MAX_TOOL_CALLS=40              # vars.SHAKEFIX_MAX_TOOL_CALLS (optional)
# try just the Second Opinion labeler live (one Nemotron call, no writes):
#   node scripts/nebius/second-opinion.mjs
# try the ER agent roles locally (read-only tools run; writes only printed):
#   SCM_PROVIDER=github GITHUB_REPO=<owner>/<repo> GITHUB_TOKEN=... node packages/core/bin/shakefix-agent.js --issue 1 --dry-run
```

> **Nemotron is a reasoning model.** It emits a `<think>…</think>` block before its answer. The Second
> Opinion labeler (`packages/proof/src/label.js`) strips that block and pulls the JSON out of the rest,
> so Nemotron's reasoning never breaks the verdict. `PROOF_RESPONSE_FORMAT=json_schema` additionally asks
> Token Factory to constrain the output to the labels schema. See [`docs/NEBIUS.md`](NEBIUS.md).

### 2. Vultr port (GitHub + local runner + Vultr Serverless Inference)

```bash
SCM_PROVIDER=github
AGENT_RUNNER=local
MODEL_PROVIDER=openai-compatible
MODEL_BASE_URL=https://api.vultrinference.com/v1    # TODO verify in the Vultr Serverless Inference console
MODEL_NAME=<model id from the Vultr inference catalog, e.g. a Llama 3.x 70B instruct>
MODEL_API_KEY=<vultr inference api key>
SHAKEFIX_GH_TOKEN=<fine-grained PAT>
# Hosting stays on Cloud Run (GCP_* vars). Moving the app and intake to Vultr compute means replacing
# the gcloud steps in the deploy job; no ShakeFix code depends on Cloud Run outside those steps
# and scripts/ci/traffic.sh.
```

### 3. PayPal hackathon port (GitHub + local runner + Claude)

```bash
SCM_PROVIDER=github
AGENT_RUNNER=local
MODEL_PROVIDER=anthropic                # or openai-compatible if the event mandates a model
MODEL_NAME=claude-sonnet-4-5
MODEL_API_KEY=<anthropic api key>       # ANTHROPIC_API_KEY also works
SHAKEFIX_GH_TOKEN=<fine-grained PAT>
INTAKE_URL=https://<intake>.run.app     # vars.INTAKE_URL
INTAKE_HOOK_SECRET=<shared secret>      # secrets.INTAKE_HOOK_SECRET
# TODO verify against the hackathon rules: required platform (GitHub assumed), allowed models, and whether
# the demo app must use PayPal sandbox payments (SplitPal's settle flow is the natural place; not part of
# this provider switch).
```

## Code map

| Piece | File |
|---|---|
| SCM switch + interface | `packages/core/src/scm/index.js` |
| GitLab provider (superset of the intake client) | `packages/core/src/scm/gitlab.js` |
| GitHub provider | `packages/core/src/scm/github.js` |
| Model switch, retry, JSON helpers | `packages/core/src/model/index.js` |
| Local runner, routing, budgets | `packages/core/src/agent/index.js` |
| Tools / sandbox | `packages/core/src/agent/tools.js`, `packages/core/src/agent/sandbox.js` |
| Prompt extraction | `packages/core/src/prompts.js`, `scripts/sync-prompts.mjs` |
| CLIs | `packages/core/bin/shakefix-agent.js`, `packages/core/bin/shakefix-scm.js` |
| Intake switch | `services/intake/src/scm.js` (GitLab default stays in `services/intake/src/gitlab.js`) |
| Second Opinion switch | `packages/proof/src/gitlab.js` (`scmFromEnv`), `packages/proof/src/label.js` (`labelerModelFromEnv`) |
