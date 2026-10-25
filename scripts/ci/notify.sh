#!/usr/bin/env bash
# Tell the intake that a report is fixed, so it can push "Fixed" to the reporter.
#   POST $INTAKE_URL/v1/reports/<rid>/fixed
#   header x-shakefix-signature: hex(HMAC-SHA256(raw body, INTAKE_HOOK_SECRET))
# The rid comes from the marker <!-- shakefix:rid=... --> in the description of each issue the
# merged MR closes. Runs in the main pipeline after post_deploy_smoke.
# Usage: notify.sh [state]   (state defaults to "deployed"; rollback.sh sends "rolled-back")
set -euo pipefail
. "$(dirname "$0")/lib.sh"
need curl jq openssl

STATE="${1:-deployed}"
: "${INTAKE_URL:?INTAKE_URL is required}"
: "${INTAKE_HOOK_SECRET:?INTAKE_HOOK_SECRET is required}"

mr="$(mr_for_sha "${CI_COMMIT_SHA:-}")"
out="$(mktemp)"
sent=0
while read -r iid; do
  [[ -n "$iid" ]] || continue
  rid="$(rid_for_issue "$iid")"
  if [[ -z "$rid" ]]; then log "issue #$iid has no shakefix rid marker; skipping"; continue; fi
  body="$(jq -cn \
    --arg rid "$rid" --arg state "$STATE" --arg sha "${CI_COMMIT_SHA:-}" \
    --arg version "${CI_COMMIT_SHORT_SHA:-}" --arg url "${PROD_URL:-}" \
    --arg pipeline "${CI_PIPELINE_URL:-}" \
    --argjson issueIid "$iid" --argjson mrIid "${mr:-null}" --argjson ts "$(date +%s)" \
    '{rid:$rid, state:$state, issueIid:$issueIid, mrIid:$mrIid, sha:$sha, version:$version, prodUrl:$url, pipelineUrl:$pipeline, ts:$ts}')"
  sig="$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$INTAKE_HOOK_SECRET" -hex | awk '{print $NF}')"
  code="$(curl -sS -o "$out" -w '%{http_code}' -X POST \
    -H 'content-type: application/json' -H "x-shakefix-signature: ${sig}" \
    --data-binary "$body" "${INTAKE_URL%/}/v1/reports/$(urlencode "$rid")/fixed")" || code=000
  if (( code >= 200 && code < 300 )); then
    log "notified intake: rid=$rid issue=#$iid state=$STATE"
    sent=$((sent + 1))
  else
    log "intake answered HTTP $code for rid=$rid: $(head -c 300 "$out" 2>/dev/null || true)"
    if [[ "${NOTIFY_STRICT:-0}" == "1" ]]; then rm -f "$out"; exit 1; fi
  fi
done < <(target_issues)
rm -f "$out"
log "notifications sent: $sent"
