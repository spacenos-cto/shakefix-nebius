#!/usr/bin/env bash
# Shared helpers for ShakeFix CI scripts. Source it: `. "$(dirname "$0")/lib.sh"`.
# Needs: bash, curl, jq. Auth: SHAKEFIX_BOT_TOKEN (project access token, Maintainer, api scope).
set -euo pipefail

: "${CI_API_V4_URL:=https://gitlab.com/api/v4}"
: "${CI_PROJECT_ID:?CI_PROJECT_ID is required}"

log() { printf '[shakefix] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

need() {
  local c
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "missing command: $c"; done
}

# api METHOD PATH [extra curl args...]  -> prints the response body, fails on HTTP >= 400.
# PATH is relative to /projects/:id unless it starts with /.
api() {
  local method="$1" path="$2"; shift 2
  [[ -n "${SHAKEFIX_BOT_TOKEN:-}" ]] || die "SHAKEFIX_BOT_TOKEN is not set"
  local url
  if [[ "$path" == /* ]]; then url="${CI_API_V4_URL}${path}"; else url="${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/${path}"; fi
  local tmp code
  tmp="$(mktemp)"
  code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" \
    -H "PRIVATE-TOKEN: ${SHAKEFIX_BOT_TOKEN}" "$@" "$url")" || { rm -f "$tmp"; die "curl failed: $method $path"; }
  if (( code >= 400 )); then
    log "HTTP $code on $method $path: $(head -c 500 "$tmp")"
    rm -f "$tmp"
    return 1
  fi
  cat "$tmp"; rm -f "$tmp"
}

# Expand a short label: "ready" -> "shakefix::ready". Full labels pass through.
expand_label() {
  case "$1" in
    *::*|shakefix|needs-human|needs-info) printf '%s' "$1" ;;
    *) printf 'shakefix::%s' "$1" ;;
  esac
}

urlencode() { jq -rn --arg v "$1" '$v|@uri'; }

# Merge request IID that produced commit SHA on the default branch (empty if none).
mr_for_sha() {
  local sha="${1:-${CI_COMMIT_SHA:?}}"
  api GET "repository/commits/${sha}/merge_requests" \
    | jq -r '[.[] | select(.state == "merged")] | (.[0].iid // empty)'
}

# Issue IIDs an MR closes: closes_issues API first, then "Closes #n" in the description.
issues_for_mr() {
  local mr="$1" out
  out="$(api GET "merge_requests/${mr}/closes_issues" | jq -r '.[].iid' 2>/dev/null || true)"
  if [[ -z "$out" ]]; then
    out="$(api GET "merge_requests/${mr}" | jq -r '.description // ""' \
      | grep -oiE '(close[sd]?|fix(e[sd])?|resolve[sd]?) #[0-9]+' | grep -oE '[0-9]+' || true)"
  fi
  printf '%s\n' "$out" | awk 'NF' | sort -un
}

# rid from the issue description ("ShakeFix report: shakefix:rid=..." and/or the old comment marker).
# awk, not head: head exits early, and with pipefail grep's SIGPIPE fails the job (exit 141).
rid_for_issue() {
  api GET "issues/$1" | jq -r '.description // ""' \
    | grep -oE 'shakefix:rid=[A-Za-z0-9_.-]+' | awk 'NR == 1' \
    | sed -E 's/^shakefix:rid=//'
}

# Resolve issue targets for main-branch jobs: SHAKEFIX_ISSUE_IIDS overrides, else via merged MR.
target_issues() {
  if [[ -n "${SHAKEFIX_ISSUE_IIDS:-}" ]]; then tr ', ' '\n\n' <<<"$SHAKEFIX_ISSUE_IIDS" | awk 'NF'; return; fi
  local mr; mr="$(mr_for_sha "${CI_COMMIT_SHA:-}")"
  [[ -n "$mr" ]] || { log "no merged MR for ${CI_COMMIT_SHA:-?}"; return 0; }
  issues_for_mr "$mr"
}

# Add a note. kind = issues | merge_requests
post_note() {
  local kind="$1" iid="$2" body="$3"
  api POST "${kind}/${iid}/notes" --data-urlencode "body=${body}" >/dev/null
}

# Page the on-call human through PAGER_WEBHOOK_URL (ntfy, Slack, Discord or any JSON URL). Never fails the job.
#   page "<title>" "<text>" ["<click url>"]
page() {
  local title="$1" text="$2" url="${3:-}" hook="${PAGER_WEBHOOK_URL:-}"
  [[ -n "$hook" ]] || { log "no PAGER_WEBHOOK_URL; page skipped: $title"; return 0; }
  case "$hook" in
    https://ntfy.sh/*|https://*.ntfy.sh/*)
      curl -fsS -m 10 -H "Title: $(LC_ALL=C tr -cd '\40-\176' <<<"$title")" -H "Priority: urgent" -H "Tags: rotating_light" \
        ${url:+-H "Click: $url"} --data-binary "$text" "$hook" >/dev/null ;;
    https://hooks.slack.com/*)
      jq -n --arg t "*$title*"$'\n'"$text"$'\n'"$url" '{text:$t}' | curl -fsS -m 10 -H 'content-type: application/json' --data-binary @- "$hook" >/dev/null ;;
    https://discord.com/*|https://discordapp.com/*)
      jq -n --arg t "**$title**"$'\n'"$text"$'\n'"$url" '{content:$t}' | curl -fsS -m 10 -H 'content-type: application/json' --data-binary @- "$hook" >/dev/null ;;
    *)
      jq -n --arg title "$title" --arg text "$text" --arg url "$url" '{title:$title,text:$text,url:$url}' \
        | curl -fsS -m 10 -H 'content-type: application/json' --data-binary @- "$hook" >/dev/null ;;
  esac && log "paged: $title" || log "page failed (ignored): $title"
}
