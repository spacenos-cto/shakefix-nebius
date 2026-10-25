# GitLab setup, step by step (BUILD_SPEC 9)

Do these in order. Commands assume `bash`, `curl` and `jq`.

```bash
export GITLAB_URL=https://gitlab.com
export GROUP=nxt-spacenos-global            # or the hackathon subgroup path
export PROJECT="$GROUP/shakefix"
export GITLAB_TOKEN=<your personal access token, api scope>   # keep it in your shell only
PID=$(jq -rn --arg p "$PROJECT" '$p|@uri')
```

## 1. Create the project

UI: **New project > Create blank project**, name `shakefix`, visibility **Public**,
initialise with a README. Then push the scaffold:

```bash
git remote add origin "$GITLAB_URL/$PROJECT.git"
git push -u origin main
```

## 2. Licence

`LICENSE` is MIT, `Copyright (c) 2026 Venkatesh Devale`. Check that the project overview shows
**MIT License**. Sign off every commit for the DCO: `git commit -s`.

## 3. Group settings > GitLab Duo

1. Duo Agent Platform: **on**.
2. Allow custom flows and flow triggers: **on**.
3. Default model: Claude Sonnet 5.5 (default).
4. Allow external MCP tools: only if MCP is used (it is not).
5. Project **Settings > General > GitLab Duo**: check the **CI/CD runner** row is green
   (hosted runners carry the `gitlab--duo` tag).

## 4. Labels

```bash
PROJECT="$PROJECT" GITLAB_TOKEN="$GITLAB_TOKEN" bash .gitlab/labels.sh
```

Creates `shakefix`, `sev::1..3`, the nine `shakefix::*` state labels (including the reporter-verdict
labels `shakefix::verified` and `shakefix::reopened`), `needs-human` and
`needs-info`. `dup::<hash8>` labels are created on demand by the intake.

## 5. Protected branch `main`

UI: **Settings > Repository > Protected branches**.

| Setting | Value |
|---|---|
| Allowed to merge | Maintainers + the `SHAKEFIX_BOT_TOKEN` bot user |
| Allowed to push and merge | No one, **or** the bot user and `cto.spacenos` if the intake commits replays and CI stamps the Ledger on `main` |
| Code owner approval | **Required** |

If nobody may push to `main`, set the intake's `REPORTS_REF=reports` (replays go to a `reports`
branch) and accept that `ledger_stamp` fails softly.

## 6. Merge request settings

UI: **Settings > Merge requests**.

1. Merge method: **Merge commit**.
2. Squash commits: **Encourage**.
3. Pipelines must succeed: **on**.
4. All threads must be resolved: **off** (bot threads).
5. Delete source branch by default: **on**.
6. Default MR template: `shakefix` (from `.gitlab/merge_request_templates/shakefix.md`).

## 7. Approval rules

1. CODEOWNERS (repo root) covers `apps/splitpal/src/auth/**`, `infra/**` and governance files.
2. With **Require code owner approval** on `main`, any `auth/` change waits for `@cto.spacenos`.
3. Flow MRs are attributed to the human who triggered the flow, and authors cannot approve their
   own MRs. For the B4 demo, add a second account as code owner, or show the MR waiting.

## 8. CI/CD variables

UI: **Settings > CI/CD > Variables**. Mask everything secret; protect where possible
(protected variables are only visible to protected branches and tags, and MR pipelines from
`shakefix/*` branches need `SHAKEFIX_BOT_TOKEN` and the GCP variables, so leave those unprotected
or protect the `shakefix/*` branch pattern).

| Key | Value | Masked |
|---|---|---|
| `SHAKEFIX_BOT_TOKEN` | Project access token, role Maintainer, scope `api` | yes |
| `GCP_PROJECT_ID` | `shakefix-hack` | no |
| `GCP_REGION` | `asia-south1` | no |
| `GCP_WIF_PROVIDER` | `terraform output -raw gcp_wif_provider` | no |
| `GCP_SA_EMAIL` | `terraform output -raw gcp_sa_email` | no |
| `INTAKE_URL` | `terraform output -raw intake_url` | no |
| `INTAKE_HOOK_SECRET` | `openssl rand -hex 32` (same value in Secret Manager `intake-hook-secret`) | yes |
| `ANTHROPIC_API_KEY` | Only for the Second Opinion labeler (option B) | yes |
| `BASE_URL` | Optional override for Second Opinion's base (default: `main-test` tag URL) | no |
| `PROD_URL` | Optional; CI reads the service URL otherwise | no |
| `CATALOG_SYNC_TOKEN` | Optional, AI Catalog publish | yes |

Create the bot token and variables with the API:

```bash
# Project access token (expires in 30 days; rotate after judging)
BOT=$(curl -sS -X POST -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -H 'content-type: application/json' \
  "$GITLAB_URL/api/v4/projects/$PID/access_tokens" \
  -d "{\"name\":\"shakefix-bot\",\"scopes\":[\"api\"],\"access_level\":40,\"expires_at\":\"$(date -u -d '+30 days' +%F)\"}" \
  | jq -r .token)

setvar() {  # setvar KEY VALUE MASKED
  curl -sS -o /dev/null -w "$1 %{http_code}\n" -X POST -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    "$GITLAB_URL/api/v4/projects/$PID/variables" \
    --data-urlencode "key=$1" --data-urlencode "value=$2" -d "masked=$3" -d "protected=false"
}
setvar SHAKEFIX_BOT_TOKEN "$BOT" true
setvar GCP_PROJECT_ID shakefix-hack false
setvar GCP_REGION asia-south1 false
setvar GCP_WIF_PROVIDER "$(terraform -chdir=infra output -raw gcp_wif_provider)" false
setvar GCP_SA_EMAIL "$(terraform -chdir=infra output -raw gcp_sa_email)" false
setvar INTAKE_URL "$(terraform -chdir=infra output -raw intake_url)" false
setvar INTAKE_HOOK_SECRET "$(openssl rand -hex 32)" true   # also store it in Secret Manager
unset BOT
```

## 9. Webhook to the intake

UI: **Settings > Webhooks > Add new webhook**.

- URL: `$INTAKE_URL/v1/hooks/gitlab`
- Secret token: the value stored in Secret Manager `gitlab-webhook-secret`
- Triggers: **Issues events**, **Merge request events**, **Pipeline events**

## 10. GitLab Pages

**Deploy > Pages**: enabled, public. The `pages` job publishes the ER Board from `dashboard/`.

## 11. Runners

GitLab.com hosted runners are the default. Duo flow jobs need the `gitlab--duo` tag, which
hosted runners provide. Spike S2 checks that the sandbox works there (see `docs/limits.md`).

## 12. The flow and its triggers

Follow `.gitlab/duo/flows/README.md`: register `shakefix.yml`, enable it, then add one trigger
with two conditions: **Work item > Created** and **Mention**.

## Done when

A manual MR with a passing pipeline can be merged by `SHAKEFIX_BOT_TOKEN` through the API:

```bash
curl -sS -X PUT -H "PRIVATE-TOKEN: $BOT_TOKEN" \
  "$GITLAB_URL/api/v4/projects/$PID/merge_requests/<iid>/merge" | jq '.state'
```
