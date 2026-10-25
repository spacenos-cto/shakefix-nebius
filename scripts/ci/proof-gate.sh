#!/usr/bin/env bash
# Second Opinion gate (BUILD_SPEC §11.7). Wraps `proof gate`, sets MR labels, and on a first-time
# unintended verdict asks the intake to re-operate (signed with INTAKE_HOOK_SECRET).
#
# Usage: bash scripts/ci/proof-gate.sh [proof/proof.json]
#
# Env (CI): CI_API_V4_URL, CI_PROJECT_ID, CI_MERGE_REQUEST_IID, SHAKEFIX_BOT_TOKEN,
#           INTAKE_URL, INTAKE_HOOK_SECRET,
#           CI_MERGE_REQUEST_DIFF_BASE_SHA (or CI_MERGE_REQUEST_TARGET_BRANCH_NAME)
# Optional: PROOF_POLICY (default .shakefix/policy.yml), PROOF_ATTEMPT, SHAKEFIX_MAINTAINER (username to @mention),
#           PROOF_GATE_SOFT=1 (always exit 0 after labeling)
#
# Exit: 0 ready · 10 unintended (sent back to surgery) · 11 needs-human · 1 error
set -euo pipefail

PROOF_JSON="${1:-proof/proof.json}"
POLICY="${PROOF_POLICY:-.shakefix/policy.yml}"
OUT_DIR="$(dirname "$PROOF_JSON")"
DIFF_FILE="$OUT_DIR/diff-files.txt"
MR_IID="${CI_MERGE_REQUEST_IID:?CI_MERGE_REQUEST_IID is required}"
: "${CI_API_V4_URL:?}" "${CI_PROJECT_ID:?}" "${SHAKEFIX_BOT_TOKEN:?}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROOF_BIN="$SCRIPT_DIR/../../packages/proof/bin/proof.js"
API="$CI_API_V4_URL/projects/$CI_PROJECT_ID"

log() { printf '[proof-gate] %s\n' "$*" >&2; }

# --- 1. Files changed by the MR (numstat: added<TAB>deleted<TAB>path) -------------------------
BASE_REF="${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}"
if [ -z "$BASE_REF" ]; then
  TARGET="${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}"
  git fetch -q --depth=100 origin "$TARGET"
  BASE_REF="origin/$TARGET"
elif ! git cat-file -e "$BASE_REF^{commit}" 2>/dev/null; then
  git fetch -q --depth=100 origin "$BASE_REF"
fi
git diff --numstat "$BASE_REF" HEAD > "$DIFF_FILE"
log "diff vs $BASE_REF: $(wc -l < "$DIFF_FILE" | tr -d ' ') file(s)"

# --- 2. Gate verdict ---------------------------------------------------------------------------
set +e
GATE_OUT="$(node "$PROOF_BIN" gate --in "$PROOF_JSON" --policy "$POLICY" --diff-files "$DIFF_FILE" --mr "$MR_IID")"
CODE=$?
set -e
printf '%s\n' "$GATE_OUT"
REASON="$(printf '%s' "$GATE_OUT" | sed -n 's/^proof gate: [^—]*— //p' | tail -n 1)"

gl_labels() { # $1 = add (comma list), $2 = remove (comma list)
  curl -fsS -X PUT -H "PRIVATE-TOKEN: $SHAKEFIX_BOT_TOKEN" \
    --data-urlencode "add_labels=$1" --data-urlencode "remove_labels=$2" \
    "$API/merge_requests/$MR_IID" > /dev/null
}

gl_note() { # $1 = markdown body
  curl -fsS -X POST -H "PRIVATE-TOKEN: $SHAKEFIX_BOT_TOKEN" \
    --data-urlencode "body=$1" "$API/merge_requests/$MR_IID/notes" > /dev/null
}

reoperate() {
  local rid body sig
  rid="$(node -e 'const p=require(require("path").resolve(process.argv[1]));process.stdout.write(p.rid||"")' "$PROOF_JSON")"
  if [ -z "$rid" ]; then log "warn: proof.json has no rid; cannot ask intake to re-operate"; return 0; fi
  if [ -z "${INTAKE_URL:-}" ] || [ -z "${INTAKE_HOOK_SECRET:-}" ]; then
    log "warn: INTAKE_URL / INTAKE_HOOK_SECRET not set; skipping re-operate"; return 0
  fi
  body="$(printf '{"mrIid":%d}' "$MR_IID")"
  sig="$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$INTAKE_HOOK_SECRET" | awk '{print $NF}')"
  if curl -fsS -X POST "${INTAKE_URL%/}/v1/reports/$rid/reoperate" \
      -H 'content-type: application/json' -H "x-shakefix-signature: $sig" \
      --data-binary "$body" > /dev/null; then
    log "re-operate requested for $rid (MR !$MR_IID)"
  else
    log "warn: re-operate request failed for $rid"
  fi
}

# --- 3. Labels + side effects --------------------------------------------------------------------
# A control MR (label `control`, the ground-truth benchmark in the README) only gets the verdict: it is never sent
# back to surgery and never teaches the memory a lesson.
CONTROL=0
case ",${CI_MERGE_REQUEST_LABELS:-}," in *,control,*) CONTROL=1 ;; esac
if [ "$CONTROL" = "1" ]; then
  case "$CODE" in
    0) gl_labels "shakefix::ready" "shakefix::proof,shakefix::unintended" ;;
    10) gl_labels "shakefix::unintended" "shakefix::ready,shakefix::proof" ;;
    11) gl_labels "needs-human" "shakefix::ready,shakefix::proof" ;;
    *) log "error: proof gate failed (exit $CODE)"; exit 1 ;;
  esac
  log "control MR: verdict $CODE recorded, no re-operation, no lesson"
  exit 0
fi

case "$CODE" in
  0)
    gl_labels "shakefix::ready" "shakefix::proof,shakefix::unintended"
    log "ready: $REASON"
    ;;
  10)
    gl_labels "shakefix::unintended" "shakefix::ready,shakefix::proof"
    gl_note "Second Opinion found side effects; sending back to surgery. ${REASON}

_— Second Opinion, ShakeFix ER_"
    reoperate
    ;;
  11)
    MENTION=""
    [ -n "${SHAKEFIX_MAINTAINER:-}" ] && MENTION="@${SHAKEFIX_MAINTAINER#@} "
    gl_labels "needs-human" "shakefix::ready,shakefix::proof"
    gl_note "${MENTION}Second Opinion stopped this MR for a human: ${REASON}

_— Second Opinion, ShakeFix ER_"
    ;;
  *)
    log "error: proof gate failed (exit $CODE)"
    exit 1
    ;;
esac

# Medical Record (docs/MEMORY.md): unintended changes become a lesson on the default branch [skip ci].
# Guarded: a memory failure never changes the gate result.
if [ "$CODE" != "0" ] && [ -f "$SCRIPT_DIR/../memory/record-case.mjs" ]; then
  node "$SCRIPT_DIR/../memory/record-case.mjs" proof --proof "$PROOF_JSON" --verdict "$CODE"     --diff-files "$DIFF_FILE" --mr "$MR_IID" >&2 || log "warn: memory lesson failed (ignored)"
fi

if [ "${PROOF_GATE_SOFT:-0}" = "1" ]; then exit 0; fi
exit "$CODE"
