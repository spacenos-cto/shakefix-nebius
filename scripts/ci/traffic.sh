#!/usr/bin/env bash
# Cloud Run traffic helpers. gcloud must already be authenticated (see .gcp_auth in .gitlab-ci.yml).
# Usage:
#   traffic.sh current            -> revision serving the most traffic
#   traffic.sh url <tag>          -> URL of a traffic tag (for example mr-42 or main)
#   traffic.sh to <revision> [%]  -> send % (default 100) of traffic to a revision
#   traffic.sh latest             -> send 100% to the latest ready revision
#   traffic.sh untag <tag>        -> remove a traffic tag
# Env: SERVICE (default $APP_SERVICE, else carerx), GCP_REGION.
set -euo pipefail
SERVICE="${SERVICE:-${APP_SERVICE:-carerx}}"
REGION="${GCP_REGION:?GCP_REGION is required}"
cmd="${1:?usage: traffic.sh current|url <tag>|to <rev> [%]|latest|untag <tag>}"

describe() { gcloud run services describe "$SERVICE" --region "$REGION" --format=json; }

case "$cmd" in
  current)
    describe | jq -r '[.status.traffic[] | select((.percent // 0) > 0)] | max_by(.percent) | .revisionName // empty'
    ;;
  url)
    tag="${2:?tag required}"
    describe | jq -r --arg t "$tag" '.status.traffic[] | select(.tag == $t) | .url' | awk 'NR == 1'
    ;;
  to)
    rev="${2:?revision required}"
    pct="${3:-100}"
    gcloud run services update-traffic "$SERVICE" --region "$REGION" --to-revisions "${rev}=${pct}" --quiet
    ;;
  latest)
    gcloud run services update-traffic "$SERVICE" --region "$REGION" --to-latest --quiet
    ;;
  untag)
    tag="${2:?tag required}"
    gcloud run services update-traffic "$SERVICE" --region "$REGION" --remove-tags "$tag" --quiet
    ;;
  *)
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac
