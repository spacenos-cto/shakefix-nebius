#!/usr/bin/env bash
# Roll production back after a failed post-deploy smoke test.
#   1. Send 100% of traffic to PREV_REVISION (dotenv from deploy_prod).
#   2. Reopen each issue the merged MR closed, label it shakefix::rolled-back + needs-human.
#   3. Tell the intake (state rolled-back) so the board and the reporter stay honest.
# gcloud must be authenticated. Needs curl and jq (openssl for the intake call).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/lib.sh"
need gcloud curl jq

: "${PREV_REVISION:?PREV_REVISION missing: deploy_prod did not record the previous revision}"
log "rolling ${APP_SERVICE:-carerx} back to ${PREV_REVISION}"
bash "$DIR/traffic.sh" to "$PREV_REVISION" 100
page "ShakeFix: production rolled back" "Smoke test failed on v${CI_COMMIT_SHORT_SHA:-?}. Traffic is back on ${PREV_REVISION}. A human must look before the next deploy." "${CI_PIPELINE_URL:-}"
MENTION=""
[[ -n "${SHAKEFIX_MAINTAINER:-}" ]] && MENTION="@${SHAKEFIX_MAINTAINER#@} "

while read -r iid; do
  [[ -n "$iid" ]] || continue
  api PUT "issues/${iid}" \
    --data-urlencode "state_event=reopen" \
    --data-urlencode "add_labels=shakefix::rolled-back,needs-human" >/dev/null
  post_note issues "$iid" "### 🩺 Patient Chart — #${iid}
| | |
|---|---|
| **Symptoms** | Post-deploy smoke test failed on \`v${CI_COMMIT_SHORT_SHA:-?}\`. |
| **Procedure** | Traffic returned to \`${PREV_REVISION}\` automatically. |
| **Vitals** | [failed pipeline](${CI_PIPELINE_URL:-#}) |
| **Discharge** | Readmitted. ${MENTION}needs to look before the next attempt (paged). |
_— Attending, ShakeFix ER_"
  log "issue #$iid reopened and labelled rolled-back"
done < <(target_issues)

if [[ -n "${INTAKE_URL:-}" && -n "${INTAKE_HOOK_SECRET:-}" ]] && command -v openssl >/dev/null 2>&1; then
  bash "$DIR/notify.sh" rolled-back || log "intake notification failed (ignored)"
  # 4. Phone the on-call developer (ElevenLabs agent): "send it back to the agents, or hold?".
  #    Rollback itself is never gated on the call; the answer only decides the next attempt.
  #    The intake answers 503 when ONCALL_PHONE / the on-call agent are not configured.
  issues="$(target_issues | jq -Rsc 'split("\n") | map(select(length > 0) | tonumber)')"
  body="$(jq -cn --argjson issues "$issues" --arg version "${CI_COMMIT_SHORT_SHA:-}" \
    --arg prev "$PREV_REVISION" --arg reason "the post-deploy smoke test failed" \
    '{issues:$issues, version:$version, prevRevision:$prev, reason:$reason}')"
  sig="$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$INTAKE_HOOK_SECRET" -hex | awk '{print $NF}')"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
    -H "x-shakefix-signature: ${sig}" --data-binary "$body" "${INTAKE_URL%/}/v1/oncall/call")" || code=000
  log "on-call call: intake answered HTTP $code"
fi
