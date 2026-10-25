#!/usr/bin/env bash
# Post a note. Body comes from a file, or "-" for stdin.
# Usage: comment.sh <file|-> [--mr <iid> | --issue <iid> | --issues]
# Default target: the current MR in MR pipelines, else the issues closed by the merged MR.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
need curl jq

[[ $# -ge 1 ]] || die "usage: comment.sh <file|-> [--mr <iid>|--issue <iid>|--issues]"
src="$1"; shift
if [[ "$src" == "-" ]]; then body="$(cat)"; else [[ -f "$src" ]] || die "no such file: $src"; body="$(cat "$src")"; fi
[[ -n "$body" ]] || die "empty comment body"

kind="" iid=""
case "${1:-}" in
  --mr) kind="merge_requests"; iid="$2" ;;
  --issue) kind="issues"; iid="$2" ;;
  --issues) kind="issues" ;;
  "") ;;
  *) die "unknown argument: $1" ;;
esac
if [[ -z "$kind" ]]; then
  if [[ -n "${CI_MERGE_REQUEST_IID:-}" ]]; then kind="merge_requests"; iid="$CI_MERGE_REQUEST_IID"; else kind="issues"; fi
fi

if [[ -n "$iid" ]]; then
  post_note "$kind" "$iid" "$body"; log "commented on ${kind%s} ${iid}"
else
  while read -r i; do [[ -n "$i" ]] || continue; post_note issues "$i" "$body"; log "commented on issue $i"; done < <(target_issues)
fi
