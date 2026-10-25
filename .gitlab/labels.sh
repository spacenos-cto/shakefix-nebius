#!/usr/bin/env bash
# Create (or update) every ShakeFix label in a GitLab project. Idempotent.
# Usage:
#   GITLAB_TOKEN=<token with api scope> PROJECT=nxt-spacenos-global/shakefix bash .gitlab/labels.sh
# Optional: GITLAB_URL (default https://gitlab.com).
set -euo pipefail

: "${GITLAB_TOKEN:?set GITLAB_TOKEN (personal or project access token, api scope)}"
: "${PROJECT:?set PROJECT to the project path or numeric id}"
GITLAB_URL="${GITLAB_URL:-https://gitlab.com}"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

pid="$(jq -rn --arg p "$PROJECT" '$p|@uri')"
api="${GITLAB_URL%/}/api/v4/projects/${pid}/labels"

# name|color|description
labels=$(cat <<'LABELS'
shakefix|#FF5A1F|Filed by ShakeFix intake; the ER flow acts only on these.
sev::1|#D9302C|Uncaught error.
sev::2|#F2701C|Expectation failed (the feature did not do what it should).
sev::3|#B9B09D|Cosmetic.
shakefix::triaging|#6E6A60|Triage Nurse is reproducing the report.
shakefix::in-surgery|#8F5BD8|Surgeon is fixing.
shakefix::proof|#2F80ED|MR open; Second Opinion behavior diff running.
shakefix::ready|#2DA160|Second Opinion clean and policy allows hands-off; auto-merge armed.
shakefix::unintended|#D9302C|Second Opinion found unintended changes; back to surgery.
shakefix::deployed|#1F7A44|Fix is live in production.
shakefix::rolled-back|#7A1F1F|Post-deploy smoke failed; production rolled back.
shakefix::verified|#0E5C32|The reporter confirmed the fix (patient's verdict 👍).
shakefix::reopened|#B5482A|The reporter says it's still broken (👎); reopened with a new replay, back to triage.
needs-human|#F2B84B|Supervised: a human must review or approve.
needs-info|#C9A227|Could not reproduce; more information needed.
LABELS
)

while IFS='|' read -r name color desc; do
  [[ -n "$name" ]] || continue
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
    --data-urlencode "name=${name}" --data-urlencode "color=${color}" --data-urlencode "description=${desc}" "$api")"
  if [[ "$code" == "201" ]]; then
    echo "created  ${name}"
  elif [[ "$code" == "409" ]]; then
    enc="$(jq -rn --arg n "$name" '$n|@uri')"
    curl -sS -o /dev/null -X PUT -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
      --data-urlencode "color=${color}" --data-urlencode "description=${desc}" "${api}/${enc}"
    echo "updated  ${name}"
  else
    echo "FAILED   ${name} (HTTP ${code})" >&2
    exit 1
  fi
done <<<"$labels"

echo "Done. dup::<hash8> labels are created on demand by the intake."
