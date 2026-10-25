#!/usr/bin/env bash
# Auto-merge a ShakeFix MR, only when every gate agrees.
#   1. MR has label shakefix::ready (set by scripts/ci/proof-gate.sh) and NOT needs-human.
#   2. Deterministic policy re-check of the diff against .shakefix/policy.yml
#      (supervised/assisted paths, max files, max lines). Regression specs, Ledger and Medical Record files
#      are excluded from the size limits.
#   3. `node packages/proof/bin/proof.js gate` agrees, when the Second Opinion CLI is present.
# Then it asks GitLab to merge when the pipeline succeeds (the job runs inside that pipeline,
# so an immediate merge would be refused by "Pipelines must succeed").
# Exit 0 with a message when a gate says no: a skipped merge is not a pipeline failure.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
need curl jq git

MR="${CI_MERGE_REQUEST_IID:?merge.sh runs in merge request pipelines only}"
POLICY="${SHAKEFIX_POLICY:-.shakefix/policy.yml}"

refuse() {
  log "not merging !${MR}: $*"
  if [[ "${2:-}" != "quiet" ]]; then
    post_note merge_requests "$MR" "### 🩺 Discharge held — !${MR}
Auto-merge refused: $1
_— Discharge, ShakeFix ER_" || true
  fi
  exit 0
}

# --- 1. labels (fresh from the API; CI_MERGE_REQUEST_LABELS is frozen at pipeline creation)
mr_json="$(api GET "merge_requests/${MR}")"
labels="$(jq -r '.labels | join(",")' <<<"$mr_json")"
log "labels on !${MR}: ${labels}"
grep -qE '(^|,)needs-human(,|$)' <<<"$labels" && refuse "label needs-human is set (supervised)."
grep -qE '(^|,)infra::suspected(,|$)' <<<"$labels" && refuse "label infra::suspected is set: a platform problem is never fixed by auto-merging code."
grep -qE '(^|,)shakefix::ready(,|$)' <<<"$labels" || refuse "label shakefix::ready is missing" quiet
[[ "$(jq -r '.draft // .work_in_progress // false' <<<"$mr_json")" == "false" ]] || refuse "MR is a draft."

# --- 2. deterministic policy check
base="${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}"
if [[ -z "$base" ]]; then
  git fetch -q origin "${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}" || true
  base="$(git merge-base HEAD "origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}")"
fi
git cat-file -e "${base}^{commit}" 2>/dev/null || git fetch -q --depth=200 origin "$base" || true
changed="$(git diff --name-only "$base" HEAD)"
log "changed files:"$'\n'"$changed"

if [[ -f "$POLICY" ]]; then
  # Extract "match|autonomy" pairs from the rules list without a YAML parser.
  rules="$(awk '
    /^[[:space:]]*-[[:space:]]*match:/ { m=$0; sub(/.*match:[[:space:]]*/, "", m); gsub(/["\047]/, "", m); sub(/[[:space:]]+#.*/, "", m) }
    /^[[:space:]]*autonomy:/ && m != "" { a=$0; sub(/.*autonomy:[[:space:]]*/, "", a); sub(/[[:space:]]+#.*/, "", a); print m "|" a; m="" }
  ' "$POLICY")"
  while IFS='|' read -r glob autonomy; do
    [[ -n "$glob" && "$autonomy" != "hands-off" ]] || continue
    while read -r f; do
      [[ -n "$f" ]] || continue
      # In [[ == ]] patterns, * also matches "/", so "dir/**" covers the whole subtree.
      # shellcheck disable=SC2053
      if [[ "$f" == $glob ]]; then refuse "\`$f\` matches policy rule \`$glob\` (autonomy: $autonomy)."; fi
    done <<<"$changed"
  done <<<"$rules"

  max_files="$(awk '/max_files_changed:/ {print $2}' "$POLICY")"
  max_lines="$(awk '/max_lines_changed:/ {print $2}' "$POLICY")"
  counted="$(git diff --numstat "$base" HEAD -- . ':(exclude)tests/regressions/**' ':(exclude).shakefix/ledger/**' ':(exclude).shakefix/memory/**' ':(exclude)reports/**')"
  n_files="$(awk 'NF' <<<"$counted" | wc -l | tr -d ' ')"
  n_lines="$(awk '{a+=($1=="-"?0:$1); d+=($2=="-"?0:$2)} END {print a+d+0}' <<<"$counted")"
  log "fix size: ${n_files} files, ${n_lines} lines (limits ${max_files:-?}/${max_lines:-?})"
  [[ -z "$max_files" || "$n_files" -le "$max_files" ]] || refuse "${n_files} files changed (limit ${max_files})."
  [[ -z "$max_lines" || "$n_lines" -le "$max_lines" ]] || refuse "${n_lines} lines changed (limit ${max_lines})."
  if grep -qE 'forbid_new_dependencies:[[:space:]]*true' "$POLICY"; then
    if git diff "$base" HEAD -- '**/package.json' 'package.json' | grep -qE '^\+[[:space:]]+"[^"]+":[[:space:]]*"[~^0-9]'; then
      refuse "a dependency was added or changed in package.json."
    fi
  fi
fi

# --- 3. Second Opinion CLI gate (optional; owned by packages/proof)
if [[ -f packages/proof/bin/proof.js ]] && command -v node >/dev/null 2>&1; then
  if [[ ! -f proof/proof.json ]]; then
    log "no proof/proof.json artifact; relying on the shakefix::ready label"
  elif node packages/proof/bin/proof.js --help 2>&1 | grep -qw gate; then
    # Re-check this pipeline's Second Opinion artifact (gate reads --in, not git refs).
    node packages/proof/bin/proof.js gate --in proof/proof.json --policy "$POLICY" \
      || refuse "\`proof.js gate\` rejected the diff."
  else
    log "proof.js has no gate command; skipping"
  fi
fi

# --- merge when the pipeline succeeds
sha="${CI_MERGE_REQUEST_SOURCE_BRANCH_SHA:-}"; [[ -n "$sha" ]] || sha="$(jq -r '.sha' <<<"$mr_json")"
api PUT "merge_requests/${MR}/merge" \
  --data-urlencode "sha=${sha}" \
  --data-urlencode "auto_merge=true" \
  --data-urlencode "merge_when_pipeline_succeeds=true" \
  --data-urlencode "should_remove_source_branch=true" \
  --data-urlencode "squash=true" \
  --data-urlencode "squash_commit_message=$(jq -r '.title' <<<"$mr_json") (!${MR})" >/dev/null \
  || die "merge request refused by GitLab (check approvals, conflicts, protected branch settings)"
log "!${MR} set to merge when the pipeline succeeds"
post_note merge_requests "$MR" "### 🩺 Cleared for discharge — !${MR}
Second Opinion found no unintended changes and policy allows hands-off. Merging when this pipeline succeeds.
_— Discharge, ShakeFix ER_" || true
