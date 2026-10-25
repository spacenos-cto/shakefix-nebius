#!/usr/bin/env bash
# After a healthy deploy, stamp fixedAt and mr on the Ledger entries of the issues just fixed and
# commit .shakefix/ledger/index.json to the default branch with [skip ci].
# The bot user must be allowed to push to the default branch (docs/setup-gitlab.md). The CI job is
# allow_failure, so a protected-branch refusal never blocks the pipeline.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
need curl jq

INDEX=".shakefix/ledger/index.json"
BRANCH="${CI_DEFAULT_BRANCH:-main}"
[[ -f "$INDEX" ]] || { log "no $INDEX"; exit 0; }

mr="$(mr_for_sha "${CI_COMMIT_SHA:-}")"
[[ -n "$mr" ]] || { log "no merged MR for this commit; nothing to stamp"; exit 0; }
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
current="$(cat "$INDEX")"
updated="$current"
while read -r iid; do
  [[ -n "$iid" ]] || continue
  updated="$(jq --arg iid "$iid" --argjson mr "$mr" --arg now "$now" \
    'map(if ((.iid | tostring) == $iid) and (.fixedAt == null) then (.fixedAt = $now | .mr = $mr) else . end)' <<<"$updated")"
done < <(issues_for_mr "$mr")

if [[ "$(jq -S . <<<"$updated")" == "$(jq -S . <<<"$current")" ]]; then
  log "ledger already up to date"
  exit 0
fi
payload="$(jq -n --arg branch "$BRANCH" --arg path "$INDEX" --arg content "$(jq . <<<"$updated")" \
  --arg msg "chore(ledger): stamp fix for !${mr} [skip ci]" \
  '{branch: $branch, commit_message: $msg, actions: [{action: "update", file_path: $path, content: $content}]}')"
api POST "repository/commits" -H 'content-type: application/json' --data "$payload" >/dev/null
log "ledger stamped for !${mr}"
