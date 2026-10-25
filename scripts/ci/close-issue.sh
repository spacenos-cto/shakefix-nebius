#!/usr/bin/env bash
# Discharge: after a healthy production deploy, write the Discharge note on each issue the merged
# MR closes, label it shakefix::deployed and make sure it is closed.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
need curl jq

mr="$(mr_for_sha "${CI_COMMIT_SHA:-}")"
version="${CI_COMMIT_SHORT_SHA:-unknown}"
where=""
[[ -n "${PROD_URL:-}" ]] && where=" at ${PROD_URL}"

# Medical Record (docs/MEMORY.md): record the case + lessons on the default branch [skip ci].
# Guarded: a memory failure never fails the discharge.
memory="$(dirname "$0")/../memory/record-case.mjs"
if command -v node >/dev/null 2>&1 && [[ -f "$memory" ]]; then
  node "$memory" merged --mr "${mr:-}" >&2 || log "warn: memory record failed (ignored)"
fi

while read -r iid; do
  [[ -n "$iid" ]] || continue
  rows=""
  if command -v node >/dev/null 2>&1 && [[ -f "$memory" ]]; then
    rows="$(node "$memory" chart-rows --iid "$iid" 2>/dev/null || true)"
  fi
  note="### 🩺 Patient Chart — #${iid}
| | |
|---|---|
| **Discharge** | Fix is live in production as \`v${version}\`${where}. |
| **Vitals** | post-deploy smoke ✅ · merged in !${mr:-?} · [pipeline](${CI_PIPELINE_URL:-#}) |
| **Follow-up** | The reporter was notified. If it comes back, shake again: the Medical Record remembers. |${rows:+
${rows}}
_— Discharge, ShakeFix ER_"
  post_note issues "$iid" "$note"
  api PUT "issues/${iid}" \
    --data-urlencode "add_labels=shakefix::deployed" \
    --data-urlencode "remove_labels=needs-info" \
    --data-urlencode "state_event=close" >/dev/null
  log "discharged issue #$iid"
done < <(target_issues)
