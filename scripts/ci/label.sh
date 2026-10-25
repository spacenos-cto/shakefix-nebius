#!/usr/bin/env bash
# Add (and optionally remove) labels on the current MR or on the issues closed by the merged MR.
# Usage:
#   label.sh <label> [--remove <label>]... [--mr <iid> | --issue <iid> | --issues]
# Short labels expand: "ready" -> "shakefix::ready". Scoped labels (shakefix::*) replace each other.
# Default target: the MR in an MR pipeline ($CI_MERGE_REQUEST_IID), else the issues closed by
# the MR that produced $CI_COMMIT_SHA (main pipeline).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
need curl jq

[[ $# -ge 1 ]] || die "usage: label.sh <label> [--remove <label>] [--mr <iid>|--issue <iid>|--issues]"
add="$(expand_label "$1")"; shift
remove=() kind="" iid=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove) remove+=("$(expand_label "$2")"); shift 2 ;;
    --mr) kind="merge_requests"; iid="$2"; shift 2 ;;
    --issue) kind="issues"; iid="$2"; shift 2 ;;
    --issues) kind="issues"; iid=""; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [[ -z "$kind" ]]; then
  if [[ -n "${CI_MERGE_REQUEST_IID:-}" ]]; then kind="merge_requests"; iid="$CI_MERGE_REQUEST_IID"; else kind="issues"; fi
fi

rm_csv="$(IFS=,; echo "${remove[*]:-}")"

apply() {
  local k="$1" i="$2"
  local args=(--data-urlencode "add_labels=${add}")
  [[ -n "$rm_csv" ]] && args+=(--data-urlencode "remove_labels=${rm_csv}")
  api PUT "${k}/${i}" "${args[@]}" >/dev/null
  log "labelled ${k%s} ${i}: +${add}${rm_csv:+ -${rm_csv}}"
}

if [[ -n "$iid" ]]; then
  apply "$kind" "$iid"
else
  found=0
  while read -r i; do [[ -n "$i" ]] || continue; apply issues "$i"; found=1; done < <(target_issues)
  [[ $found -eq 1 ]] || log "no issue to label"
fi
