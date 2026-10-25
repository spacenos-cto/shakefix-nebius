# Shared contracts (all components MUST follow these exactly)

## SplitPal data-testids
new-bill-btn, bill-row-<id>, title-input, total-input, person-input-<n> (0-based), add-person-btn, save-bill-btn,
share-<name>, tip-select, currency-select, tip-total, bill-total, settle-btn, pay-<name>-btn, confirm-settle-btn,
settled-banner, enable-shake-btn, app-version, error-banner

Any app: `data-testid="app-version"` and any element with `data-shakefix-mask` are masked in Second Opinion
screenshots (build-specific text such as the version, and anything laid out around it).

## SplitPal routes
/  ·  /bill/new  ·  /bill/:id  ·  /bill/:id/settle  ·  /settings
Hash routing is NOT used; History API (pushState). Server serves index.html for all non-/api paths.

## SplitPal API (same origin)
GET /api/bills · POST /api/bills · GET /api/bills/:id · PATCH /api/bills/:id · POST /api/bills/:id/settle · GET /healthz
Test hooks (only when env SHAKEFIX_TEST_HOOKS=1):
POST /api/__test/reset   -> reseed data, clear audit log, returns {ok:true}
GET  /api/__test/audit?since=<epoch ms> -> [{ts, op:"insert"|"update"|"delete", table, rowId, fields:{...}}]
Fixed clock for tests: header `x-test-now: <ISO>` honoured when hooks enabled.

## replay.json (schema "shakefix.replay/v1")
{
  "schema": "shakefix.replay/v1",
  "rid": "r_<yyyymmdd>_<6 hex>",
  "app": { "name": string, "version": string, "baseUrl": string },
  "device": { "ua": string, "viewport": [w,h], "touch": boolean },
  "trigger": "shake"|"bubble"|"hotkey"|"auto-error"|"rage-click",
  "note": string,
  "startRoute": string,
  "actions": [ { "t": ms, "type": "click"|"input"|"change"|"navigate"|"submit", "testid"?: string, "selector": string, "value"?: string, "route": string } ],
  "expectation": { "testid": string, "state": "visible"|"hidden"|"text", "text"?: string } | null,
  "console": [ { "level": "error"|"warn", "msg": string, "stack"?: string } ],
  "network": [ { "method": string, "path": string, "status": number, "ms": number } ]
}

## proof.json (schema "shakefix.proof/v1")
{ "schema":"shakefix.proof/v1", "mr": number|null, "base": string, "head": string,
  "flows":[ { "flow": string, "changes":[ { "id":"c1", "channel":"screen"|"api"|"db", "where": string,
      "before": any, "after": any, "label"?: "intended"|"unintended", "reason"?: string, "candidate"?: "intended"|"unintended" } ] } ],
  "summary": { "changes": n, "intended"?: n, "unintended"?: n } }

## e2e flow files tests/e2e/<name>.flow.json
Same shape as replay.json "actions" + "startRoute" + "expectation", plus "name" and "tags": ["smoke"?].

## Reporter verdict ("patient's verdict")
POST <intake>/v1/reports/:rid/verdict   (public, CORS allowlist, rate limited per IP, zod-validated)
  body: { "verdict": "confirmed"|"rejected", "deviceId"?: string /^[A-Za-z0-9_:-]{8,128}$/,
          "replay"?: replay.json (REQUIRED when rejected), "pushSubscription"?: PushSubscriptionJSON }
  200 { ok:true, rid, verdict, state:"verified" }                                    (confirmed)
  200 { ok:true, rid, verdict, state:"reopened", replayPath, retriggered:boolean }   (rejected)
  200 { ok:true, duplicate:true, rid, state }   same device (or same rid without deviceId) already voted this fix round
  409 { error:"not_fixed", state }              fix not live (state is not deployed|verified)
  400 invalid_verdict · 404 not_found · 429 rate_limited
confirmed → issue note "✅ Verified by the reporter — the patient confirms the fix.", label shakefix::verified,
            state "verified", verifiedAt.
rejected  → commit reports/<rid>/replay-<n>.json ([skip ci], n = 2, 3, …; rid re-keyed to the original),
            reopen issue, remove every shakefix:: state label, add shakefix::reopened, note
            "👎 The reporter says it's still broken — new replay attached; back to triage." + replay inline,
            then (HUMAN PAT) "@<FLOW_SERVICE_ACCOUNT> re-triage: reporter rejected the fix, see latest replay".
Idempotency: one verdict per fix round (POST /fixed opens a new round) per deviceId (or per rid if none).
POST /v1/reports also accepts an optional "deviceId" (same format) so push verdicts dedupe with the SDK.

## "Fixed" push payload (Web Push → apps/splitpal/public/sw.js)
{ "title":"Fixed ✓", "body":string, "url":string, "kind":"fixed", "rid":string, "tag":"shakefix-<rid>",
  "verdictUrl":"<intake>/v1/reports/<rid>/verdict", "deviceId"?: string }
Notification actions: [{action:"yes",title:"👍 Fixed"},{action:"no",title:"👎 Still broken"}].
yes → SW POSTs {verdict:"confirmed", deviceId} to verdictUrl. no → opens <url>?shakefix_verdict=no&rid=<rid>.
Plain tap → <url>?shakefix_verdict=ask&rid=<rid> (SDK shows "Fixed ✓ — is it working for you now?").
SDK test hook: window.ShakeFix.askVerdict(rid).

## GET /v1/board items
{ rid, issueIid, title, sev, state, mrIid, proof:{intended,unintended},
  verdict: "confirmed"|"rejected"|null   (current fix round), verdicts: { confirmed:n, rejected:n } (all rounds),
  timestamps: { createdAt, updatedAt, fixedAt, verifiedAt, <state>: ISO… } }
States: received|triaging|in-surgery|proof|deployed|verified|reopened|rolled-back|needs-human|needs-info

## Labels
shakefix, sev::1..3, shakefix::triaging|in-surgery|proof|ready|unintended|deployed|verified|reopened|rolled-back, needs-human, needs-info, dup::<hash8>
State precedence (highest first): needs-human, rolled-back, verified, deployed, needs-info, unintended|ready|proof, in-surgery, triaging, reopened

## Issue marker
First line of issue description: <!-- shakefix:rid=<rid> -->

## Medical Record (docs/MEMORY.md)
Repo files on the default branch. Agents write only `cases/<iid>.json` on their fix branch; CI and the intake write
`lessons.md` and `index.json` straight to the default branch with `[skip ci]`.

### .shakefix/memory/cases/<iid>.json (schema "shakefix.case/v1")
{ "schema":"shakefix.case/v1", "iid": n, "rids":[rid…], "route":"/bill/:id/settle" (normalised), "testids":[…],
  "symptom": { "note": string, "expectation": string, "console_error": string|null },
  "root_cause": { "file": string|null, "line": n|null, "summary": string, "pattern": "<kebab-case>" },
  "fix": { "files":[…], "lines_changed": n|null, "mr": n|null, "attempts": n|null },
  "second_opinion": { "intended": n|null, "unintended": n|null, "blocked_changes": ["<where>: <before> -> <after>"] },
  "reporter_verdicts": { "confirmed": n, "rejected": n },
  "seen_before": iid|null, "lessons_applied": ["L1"…], "proposed_lessons": [{ "source", "text", "files" }],
  "time_to_fix_s": n|null   (reported_at -> operated_at, else -> merged_at),
  "timestamps": { "reported_at", "operated_at", "merged_at", "deployed_at", "updated_at": ISO|null } }

### .shakefix/memory/lessons.md (append-only)
    ## L<n> · <source> · case #<iid>
    Never … | Always …            (one line)
    - files: a, b                 (optional)
    - patterns: p                 (optional)
    - added: <ISO>                (optional)
source ∈ second-opinion-block | reporter-rejected | reoperation | attending-concern. Deduped by text.

### .shakefix/memory/index.json (schema "shakefix.memory-index/v1", generated; read by agents and the ER Board)
{ "schema":"shakefix.memory-index/v1",
  "generated_at": ISO|null      (newest timestamp in the record, so a rebuild of an unchanged record is a no-op),
  "cases": [ { "iid", "rids":[…], "route", "testids":[…], "symptom": string|null, "console_error": string|null,
               "file", "line", "summary", "pattern", "files":[…], "mr", "attempts", "lines_changed",
               "second_opinion": { "intended", "unintended", "blocked": n }, "verdicts": { "confirmed", "rejected" },
               "time_to_fix_s": n|null, "seen_before": iid|null (explicit, else derived by recall >= 0.45 over earlier cases),
               "lessons": ["L1"] (linked), "lessons_applied": ["L1"], "reported_at", "fixed_at" } ]   sorted by iid,
  "lessons": [ { "id":"L1", "source", "case": iid|null, "text", "files":[…], "patterns":[…], "added" } ]   file order,
  "hotspots": [ { "kind":"file", "file": path, "count": n, "last_iid": iid }
              | { "kind":"route", "route": "/bill/:id/settle", "count": n, "last_iid": iid } ]   count desc, then last_iid desc,
  "stats": { "cases": n, "lessons": n, "repeat_cases": n,
             "repeat_bug_median_time_s": n|null, "first_time_median_s": n|null, "speedup": first/repeat|null,
             "lessons_applied": n, "blocked_side_effects": n } }
Regenerate: `node packages/core/bin/shakefix-memory.js rebuild-index` (`--check` exits 1 when stale; a unit test enforces it).

### shakefix-memory premortem / recall output (JSON on stdout)
recall:    { query, matches: [ { iid, score 0..1, reasons:[…], why, route, pattern, root_cause, fix:{files,attempts,mr}, lessons:[…] } ] (max 3), seen_before_line }
premortem: { query, risk: "low"|"med"|"high", points, factors:[…], summary, breaks, last_fix:{iid,attempts,mr,pattern}|null,
             lessons:[{id,source,case,text,files}], autonomy: "hands-off"|"supervised", policy_hit: "memory:high-risk"|null,
             seen_before:[recall matches], area:{route,files}, seen_before_line,
             evidence: { rid, steps:["0.8s click settle-btn"…], top_console_error, expectation, failed_requests:[…] }|null }
Policy hit "memory:high-risk" in the Attending's policy_hits forces label needs-human (supervised).

## Agent timeline, stopwatch and badge (intake)
GET /v1/reports/:rid/timeline   (public, any origin, no usernames/notes/replays)
  { rid, issueIid, mrIid, state, demo: boolean,
    stages: [ { key, label, at: ISO|null, source?: "recorded"|"estimated"|"scripted" (DEMO_MODE only) } ]   keys in order:
      shaken, issue_created, triage_start, triage_end, surgery, review, mr_opened, second_opinion, merged, deployed, verified
    startedAt, endedAt (= verified at, else null), running, elapsedMs, humanTouches, humanActions: [ { kind: note|approval|merge|push|edit, at } ],
    cost: { usd, source } | null, stopwatch: "shake → 👍 11m 42s · Human touches: 0[ · $0.38]", generatedAt }
Stage sources: report received; issue created; label shakefix::triaging / first bot note; push to shakefix/<iid>-* (commit time;
triage_end when it adds tests/regressions/issue-<iid>.spec.ts); Attending JSON in a bot note or the MR description; MR open;
"Second Opinion — Behavior Diff" note or label ready/unintended; MR merge; POST /fixed; verdict confirmed. First observation wins.
Human touch = action by a non-bot user (bots: FLOW_SERVICE_ACCOUNT, BOT_USERNAMES, *bot* names) that the intake did not make itself
(notes it posted are remembered by id; issue edits within 60 s of its own calls are automation).
POST /v1/reports/:rid/fixed accepts optional "cost": { usd: number ≥ 0, source?: string }.
GET /v1/board items add humanTouches: n. GET /v1/badge.svg → "ShakeFix | Discharged N · 👍 X%" (SVG).

## DEMO_MODE (intake env DEMO_MODE=1, DEMO_SPEED=1)
Replays services/intake/src/demo/hero-run.json (schema "shakefix.demo/v1": rid, issueIid, mrIid, title, sev, route, issueUrl, mrUrl,
humanTouches, cost, proof, stages:[{key, offsetS, source: recorded|estimated|scripted, evidence}]) in real time through
/v1/board, /v1/reports/:rid/status, /timeline, /badge.svg. Every response carries demo: true. POST /v1/reports starts the same
script for the shaken rid (its 👍 waits for the real verdict); /fixed, /reoperate and /v1/hooks/gitlab answer 409 demo_mode.
SplitPal DEMO_MODE=1 adds <meta name="shakefix-demo" content="1"> and data-demo="1" on the SDK script; SDK and UIs show "DEMO REPLAY".

## Fix Confidence (packages/proof)
proof.json summary.fix_confidence = { score: 0..100, verdict: "GO"|"HOLD"|"BLOCK", threshold, reason, factors: [ { key, points } ] }.
Replay flows in proof.json carry reproduction: { base: { passed, expectationMet, pageErrors, errorBanner }, head: {…} }.
Gate: BLOCK or HOLD → needs-human (exit 11); only GO may be ready. Env FIX_CONFIDENCE_MIN (default 80), PROOF_UNIT_STATUS,
PROOF_PREMORTEM_RISK. Attending JSON and premortem JSON are read from the MR description and notes (last one wins).

## SplitPal eval bugs (EVAL_BUG=E5..E10, off by default; apps/splitpal/SEEDED_BUGS.md)
New testids on main: bill-count, recent-settled, bill-date, tip-custom-input, tip-apply-btn, tip-error, demo-replay-label.
