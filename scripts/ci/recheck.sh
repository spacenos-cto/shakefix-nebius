#!/usr/bin/env bash
# Done stays done: after a healthy production deploy, run every past case's regression spec against
# production. A case whose spec fails again is re-admitted: reopened, labelled shakefix::readmitted,
# told why, and the on-call is paged. Never touches cases that still pass.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
need curl jq node

[[ -n "${PROD_URL:-}" ]] || die "PROD_URL is not set"
ls tests/regressions/issue-*.spec.ts >/dev/null 2>&1 || { log "no regression specs yet; nothing to re-check"; exit 0; }

BASE_URL="$PROD_URL" PLAYWRIGHT_JSON_OUTPUT_NAME=recheck.json \
  pnpm exec playwright test tests/regressions --reporter=json,line || true

back="$(node scripts/ci/recheck.mjs recheck.json)"
[[ -n "$back" ]] || exit 0

while read -r iid; do
  [[ -n "$iid" ]] || continue
  note="### 🚑 Re-admitted: #${iid} is back
This case's regression spec (\`tests/regressions/issue-${iid}.spec.ts\`) passed when it was fixed and
fails again on production \`v${CI_COMMIT_SHORT_SHA:-?}\` (${PROD_URL}). A later change broke it.
[Re-check job](${CI_JOB_URL:-#}) · re-admitted by the post-deploy re-check, not by a person.
_— Discharge, ShakeFix_"
  post_note issues "$iid" "$note"
  api PUT "issues/${iid}" \
    --data-urlencode "add_labels=shakefix::readmitted" \
    --data-urlencode "remove_labels=shakefix::deployed,shakefix::verified" \
    --data-urlencode "state_event=reopen" >/dev/null
  page "ShakeFix: #${iid} came back" "Regression spec for #${iid} fails on production v${CI_COMMIT_SHORT_SHA:-?}" "${CI_JOB_URL:-}"
  log "re-admitted issue #$iid"
done <<<"$back"
