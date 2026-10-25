#!/usr/bin/env bash
# Re-introduce the seeded SplitPal bugs (B1-B4) so the full loop can be recorded again.
#
# How it works: the commit where all four bugs are present is tagged `seeded-bugs` (create it
# once, see scripts/seed-bugs.md). This script restores apps/splitpal/ from that tag onto a fresh
# branch `demo-reset`, removes agent-written regression specs, and empties the Ledger
# (optional). You then merge `demo-reset` into main through a normal MR.
#
# Usage:
#   scripts/reset-demo.sh [--tag seeded-bugs] [--keep-ledger] [--keep-specs] [--push]
# Run from the repo root on a clean working tree.
set -euo pipefail

TAG="seeded-bugs"
KEEP_LEDGER=0
KEEP_SPECS=0
PUSH=0
BRANCH="demo-reset"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --keep-ledger) KEEP_LEDGER=1; shift ;;
    --keep-specs) KEEP_SPECS=1; shift ;;
    --push) PUSH=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
[[ -z "$(git status --porcelain)" ]] || { echo "working tree is not clean; commit or stash first" >&2; exit 1; }
git fetch --tags --quiet origin || true
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null || { echo "tag ${TAG} not found (see scripts/seed-bugs.md)" >&2; exit 1; }

DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

git checkout -q "$DEFAULT_BRANCH"
git pull -q --ff-only origin "$DEFAULT_BRANCH" || true
git checkout -q -B "$BRANCH"

echo "Restoring apps/splitpal from ${TAG}"
git rm -r -q --cached apps/splitpal >/dev/null 2>&1 || true
rm -rf apps/splitpal
git checkout "$TAG" -- apps/splitpal

if [[ $KEEP_SPECS -eq 0 ]]; then
  echo "Removing agent-written regression specs"
  git rm -q --ignore-unmatch 'tests/regressions/issue-*.spec.ts' || true
fi

if [[ $KEEP_LEDGER -eq 0 ]]; then
  echo "Emptying the Ledger"
  printf '[]\n' > .shakefix/ledger/index.json
  git rm -q --ignore-unmatch '.shakefix/ledger/entries/*.md' || true
  mkdir -p .shakefix/ledger/entries && touch .shakefix/ledger/entries/.gitkeep
  git add .shakefix/ledger
fi

git add -A apps/splitpal tests/regressions 2>/dev/null || git add -A apps/splitpal
if git diff --cached --quiet; then
  echo "Nothing to reset: the seeded bugs are already in place."
  exit 0
fi
git commit -q -s -m "chore(demo): re-introduce seeded bugs B1-B4 from ${TAG}"
echo "Committed on branch ${BRANCH}."

if [[ $PUSH -eq 1 ]]; then
  git push -q -u origin "$BRANCH" \
    -o merge_request.create \
    -o merge_request.target="$DEFAULT_BRANCH" \
    -o merge_request.title="Demo reset: re-introduce seeded bugs" \
    -o merge_request.remove_source_branch
  echo "Pushed. Merge the MR, then verify the bugs by hand (scripts/seed-bugs.md)."
else
  echo "Next: git push -u origin ${BRANCH} and merge it through an MR."
fi
