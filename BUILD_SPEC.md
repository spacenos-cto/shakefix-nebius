# ShakeFix, verified by Second Opinion: complete build specification

> **One-line pitch:** A user shakes their phone when the app breaks. AI agents on GitLab reproduce the bug, fix it, and **Second Opinion** checks that the fix changed only what it should. Then it ships to production and the user's phone buzzes "Fixed." No developer touched it.
>
> **Hook line:** "Your bug report *is* the test."
> **Closing line:** "Users report bugs. Agents fix them. Second Opinion makes sure the fix didn't break anything else."

This file is the single source of truth for the build. Work top to bottom. Every section ends with a **Done when** check. Nothing ships until every box in §20 is ticked.

---

## Table of contents

0. [Status, accounts and deadlines](#0-status-accounts-and-deadlines)
1. [Hackathon rules we must satisfy](#1-hackathon-rules-we-must-satisfy)
2. [Prize strategy](#2-prize-strategy)
3. [System architecture](#3-system-architecture)
4. [Repository layout (two projects)](#4-repository-layout-two-projects)
5. [Tech stack and versions](#5-tech-stack-and-versions)
6. [Component A: SplitPal demo app (with seeded bugs)](#6-component-a-splitpal-demo-app)
7. [Component B: Shake SDK (capture + replay recorder)](#7-component-b-shake-sdk)
8. [Component C: Intake service (Cloud Run)](#8-component-c-intake-service)
9. [Component D: GitLab project setup](#9-component-d-gitlab-project-setup)
10. [Component E: Duo custom flow (4 ER agents)](#10-component-e-duo-custom-flow)
11. [Component F: Second Opinion (behavior diff gate)](#11-component-f-second-opinion-behavior-diff-gate)
12. [Component G: CI/CD pipeline](#12-component-g-cicd-pipeline)
13. [Component H: Google Cloud infrastructure](#13-component-h-google-cloud-infrastructure)
14. [Component I: Medical Record (memory, upgrades the Bug Ledger)](#14-component-i-medical-record)
15. [Component J: Policy and governance](#15-component-j-policy-and-governance)
16. [Component K: ER Board dashboard (GitLab Pages)](#16-component-k-er-board-dashboard)
17. [Component L: Reporter notification ("Fixed")](#17-component-l-reporter-notification)
18. [Component M: Sustainability (SCI), optional prize](#18-component-m-sustainability-sci)
19. [Testing plan](#19-testing-plan)
20. [Submission checklist](#20-submission-checklist)
21. [Demo video script (2:50)](#21-demo-video-script)
22. [Devpost text template](#22-devpost-text-template)
23. [README template](#23-readme-template)
24. [Schedule](#24-schedule)
25. [Risks, spikes and fallbacks](#25-risks-spikes-and-fallbacks)
26. [Security and privacy](#26-security-and-privacy)
27. [Glossary](#27-glossary)

---

## 0. Status, accounts and deadlines

| Item | Value |
|---|---|
| Hackathon | GitLab "Life After Code" (Transcend) on Devpost |
| **Submission deadline** | **Oct 27, 2026, 13:00 UTC (6:30 PM IST)**. Repo, video and form are locked after this. |
| Judging | Oct 28 – Nov 14. Winners about Nov 16. |
| GitLab user | `cto.spacenos` (Venkatesh Devale) |
| Current group | `nxt-spacenos-global`, **private**, Ultimate trial with Duo Agent Platform, Owner. Trial expires about **Nov 9**. |
| Existing project | `nxt-spacenos-global/Spacenos-project` (private, branch `main`). **Do not use it.** Create new projects (Path A requires new work). |
| Hackathon subgroup | **Not provisioned yet.** Expected at `gitlab.com/gitlab-ai-hackathon/transcend-october-2026/<id>`, named for `@cto.spacenos`. Re-check daily. If it never appears, build in `nxt-spacenos-global` and make the projects **public**. |
| Duo | Identity verified. Default model **Claude Sonnet 5.5**. |
| Google Cloud | Project `shakefix` on a paid billing account (no free-trial credit). Stay inside the always-free tiers: Cloud Run min instances 0, default Cloud Build pool, Artifact Registry cleanup policy (§13). |
| Build sessions | Discord office hours on **Thu Oct 15, 19:00 UTC** and **Tue Oct 20, 10:00 UTC** in `#transcend-hackathon`. |
| Support | @-mention `gitlab-org/developer-relations/contributor-success` in any issue or MR. |

**Trial-expiry consequence:** after about Nov 9, Duo flows in `nxt-spacenos-global` stop. The public repo and pipeline history remain visible, and the Cloud Run demo keeps serving. Judges see recorded runs. Write this plainly in the README's "Limits" section. If the hackathon subgroup appears, move the projects there; it has event-provided Duo access.

**Done when:** you know which namespace hosts the projects and Duo Chat answers in that namespace.

---

## 1. Hackathon rules we must satisfy

| # | Rule | How ShakeFix satisfies it |
|---|---|---|
| R1 | Use GitLab Duo Agent Platform features (agents, flows, triggers, MCP) | Custom flow `shakefix` with 4 AgentComponents, started by a trigger. Sessions are visible. |
| R2 | Path A "Start Fresh": NEW projects, created on or after Oct 5 | Both projects are created during the build window (§4). |
| R3 | Public GitLab project with all source, assets and run instructions | `shakefix` is public, with a README that has setup steps. |
| R4 | **MIT LICENSE** visible in the About section | `LICENSE` at repo root. Verify GitLab detects "MIT License" on the project page. |
| R5 | Visible CI/CD pipeline history showing the automation | Run the full loop **10+ times** before the deadline. Pipelines stay public. |
| R6 | Demo video under 3:00, public on YouTube, no third-party trademarks or copyrighted music | §21. Silent or royalty-free audio only. No real brand logos in the demo app. |
| R7 | Text description: what it does, the problem, how GitLab automates the post-code lifecycle | §22 |
| R8 | Optional Google Cloud bonus (+0.2): live GCP link plus deployment code in the repo | Cloud Run plus `infra/` Terraform (§13) |
| R9 | Optional Environmental prize: quantified SCI | §18 |
| R10 | Don't change the submission after the deadline | Live judge shakes go to the **separate demo project** (§4). The submitted repo is frozen. |
| R11 | Everything you use or make must be MIT-compatible | All dependencies MIT, Apache-2.0 or BSD. Check in §19.6. |
| R12 | Agent YAML falls under MIT plus the GitLab DCO 1.1 | Sign-off line in commits (`git commit -s`). |

**Done when:** every row has a link or file proving it (fill in §20).

---

## 2. Prize strategy

The stacking rule: **one path prize plus one special prize** per project.

| Target | Prize | Why we qualify |
|---|---|---|
| Primary path prize | **Path A – Best Hands-off Agent ($5,000)** | Shake → production with no human, when Second Opinion finds no unintended change. |
| Alternate path prize | Path A – Most Stages Covered ($5,000) | Touches all 9 stages (§3.3). Judges decide which path prize we get. |
| Special prize | **Most Creative ($4,000)** | Novel trigger (end-user shake) plus the Second Opinion behavior diff. |
| Optional special | Most Environmentally Impactful ($5,000) | Only if §18 is completed with real numbers. |
| Score bonus | Google Cloud +0.2 | Cloud Run plus Terraform in the repo. |

**Autonomy framing:** Hands-off by default. It drops to **Supervised** automatically when `policy.yml` matches (for example `auth/` paths) or when Second Opinion flags an unintended change twice. Show both in the video. Judges love that the system knows when to stop.

---

## 3. System architecture

### 3.1 Flow (end to end)

```
[1] User on phone (SplitPal PWA, Cloud Run)
     shake (DeviceMotion) or "Report bug" bubble
     SDK captures: screenshot, console errors, last 30 actions (replay.json), route, device, app version
        │ POST /v1/reports
        ▼
[2] Intake service (Cloud Run)
     - validates + scrubs PII
     - commits reports/<rid>/replay.json to the default branch via API with [skip ci] (see §8.2)
     - creates GitLab issue (title, labels shakefix + sev::*, replay JSON inline, screenshot upload)
     - uses MAINTAINER PERSONAL PAT (human actor) → fires Duo trigger "Work item created"
     - stores push subscription in Firestore keyed by rid
        │
        ▼
[3] Duo custom flow "shakefix" (Claude via GitLab AI Gateway)
     Triage Nurse (Reproducer) → Surgeon (Fixer) → Attending (Skeptic) → Discharge (Dispatcher)
     output: branch shakefix/<iid>-<slug>, commit(s) incl. tests/regressions/issue-<iid>.spec.ts, MR with Patient Chart, label shakefix::ready
        │ MR pipeline (normal CI, no LLM except Second Opinion's labeler job)
        ▼
[4] CI pipeline on the MR
     lint → unit → regression spec → SAST + dependency + secret detection → build image →
     deploy BRANCH revision (Cloud Run tag) → Second Opinion: replay flows on MAIN vs BRANCH → behavior diff →
     Second Opinion labeler (Claude via API or Duo) marks intended/unintended → gate
        │ gate pass                               │ gate fail
        ▼                                         ▼
[5] merge (CI, project token) → main pipeline:   comment report, label shakefix::unintended,
     build → deploy PROD (traffic 100% new rev)   assign flow again (once) with Second Opinion report as context
     → post-deploy smoke replay → ledger update   → second fail: label needs-human, stop
     → notify reporter "Fixed" (Web Push)
     → close issue with Discharge note
        │ smoke fails
        ▼
     rollback: traffic back to previous revision, reopen issue, label shakefix::rolled-back

[6] Patient's verdict (reporter, §17.5)
     "Fixed ✓ — is it working for you now?"  👍 → POST /v1/reports/:rid/verdict {confirmed}
        → note "✅ Verified by the reporter…", label shakefix::verified (ER Board: Verified)
     👎 → re-report sheet → POST /v1/reports/:rid/verdict {rejected, replay}
        → commit reports/<rid>/replay-<n>.json, reopen issue, label shakefix::reopened,
          HUMAN-PAT mention "@<flow SA> re-triage: …" → back to [3]
```

### 3.2 Actors and identities

| Actor | Identity | Why |
|---|---|---|
| Intake creating the issue | **Maintainer's personal PAT** (`cto.spacenos`) | Triggers fire only for human actions. Project or group tokens count as bots and won't fire. |
| Duo flow | Flow service account `ai-shakefix-<group>`, using composite identity | Platform default. MRs are attributed to the human who triggered the flow. |
| CI merge, labels, comments | **Project access token** `SHAKEFIX_BOT_TOKEN` (Maintainer, `api` scope) | Bots are fine here; no trigger is needed downstream. |
| CI → Google Cloud | Workload Identity Federation (OIDC `id_tokens`), no JSON keys | Secure stage story. |
| Second Opinion labeler | Calls Claude through a CI job (see §11.6 options) | Deterministic diff plus an LLM label. |

### 3.3 DevSecOps stage coverage (all 9)

| Stage | Where |
|---|---|
| **Plan** | Intake auto-creates the issue with labels, severity and milestone. The Ledger links related bugs. |
| **Create** | Surgeon commits the fix. Triage Nurse commits the regression spec. |
| **Verify** | Unit tests, the regression spec (fail → pass proof), Second Opinion replay on main vs branch. |
| **Package** | Docker image to Artifact Registry, tagged by SHA. |
| **Secure** | GitLab SAST, Dependency Scanning and Secret Detection templates. The Attending agent reviews the diff for security. |
| **Release** | Branch revision → merge → prod traffic shift on Cloud Run. Release notes in the MR. |
| **Configure** | Terraform in `infra/`, Cloud Run service YAML, `agent-config.yml`, CI variables. Everything as code. |
| **Monitor** | Shake reports, console errors, post-deploy smoke replay, automatic rollback, ER Board dashboard. |
| **Govern** | `policy.yml`, CODEOWNERS, protected branches, approval rules on `auth/`, audit trail (Sessions plus MR history), Second Opinion reports archived as artifacts. |

**Done when:** you can point to a file or job for each row.

---

## 4. Repository layout (two projects)

Two GitLab projects in the same namespace. Both are **public** and **MIT**.

1. **`shakefix`**: the **submitted** project, containing the product (SDK, intake, flow, Second Opinion, CI templates, infra, dashboard) **plus** the SplitPal demo app. It is frozen after Oct 27.
2. **`shakefix-live`**: a fork or mirror of `shakefix` created on Oct 26, wired to the **public demo URL**. Shakes made by judges after the deadline create issues and MRs **here**, never in `shakefix`. The README links to it as "live playground".

### 4.1 `shakefix` tree

```
shakefix/
├── LICENSE                              # MIT
├── README.md                            # §23
├── CHANGELOG.md
├── CODEOWNERS
├── .gitlab-ci.yml                       # §12 (root pipeline)
├── .gitlab/
│   ├── duo/
│   │   ├── agent-config.yml             # §10.6 sandbox network + setup_script
│   │   ├── flows/
│   │   │   └── shakefix.yml             # §10 custom flow (≤ 40 KiB)
│   │   └── mcp.json                     # optional, not required
│   ├── merge_request_templates/
│   │   └── shakefix.md                  # Patient Chart template
│   └── issue_templates/
│       └── shake-report.md
├── .shakefix/
│   ├── policy.yml                       # §15
│   ├── persona.md                       # ER voice guide used by all prompts
│   └── ledger/
│       ├── index.json                   # §14
│       └── entries/                     # <id>.md per fixed bug
├── reports/                             # intake writes reports/<rid>/replay.json here
├── apps/
│   └── splitpal/                        # §6 demo PWA (Vite + TS)
│       ├── src/
│       ├── public/ (manifest.webmanifest, sw.js, icons)
│       ├── server/ (tiny Express API + SQLite/Firestore for bills)
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── sdk/                             # §7 shakefix-sdk (shake + capture + recorder)
│   ├── replay/                          # replay.json → Playwright spec converter + runner
│   └── proof/                           # §11 behavior diff engine + CLI
├── services/
│   └── intake/                          # §8 Cloud Run service (Fastify + TS)
├── tests/
│   ├── regressions/                     # issue-<iid>.spec.ts (written by agents)
│   ├── e2e/                             # baseline flows Second Opinion always replays
│   └── unit/
├── dashboard/                           # §16 ER Board (static, built to public/)
├── infra/                               # §13 Terraform
│   ├── main.tf, variables.tf, outputs.tf
│   ├── cloudrun.tf, artifact.tf, firestore.tf, wif.tf, secrets.tf
│   └── service.yaml                     # Cloud Run service spec (reference)
├── scripts/
│   ├── ci/ (merge.sh, label.sh, comment.sh, traffic.sh, rollback.sh, notify.sh)
│   ├── seed-bugs.md                     # list of seeded bugs + how to reset
│   └── reset-demo.sh                    # re-introduces seeded bugs for re-recording
├── docs/
│   ├── architecture.png                 # exported diagram for README + Devpost
│   ├── architecture.mmd                 # Mermaid source
│   ├── limits.md
│   └── sci.md                           # §18
└── package.json / pnpm-workspace.yaml / tsconfig.base.json
```

**Done when:** both projects exist, are public, and show "MIT License" on the overview page.

---

## 5. Tech stack and versions

| Layer | Choice | Licence |
|---|---|---|
| Language | TypeScript 5.x, Node.js 22 LTS | — |
| Monorepo | pnpm workspaces | MIT |
| Demo app | Vite + vanilla TS (or Preact) PWA, Express API | MIT |
| Data (app) | Firestore (Native) or SQLite on Cloud Run (ephemeral; fine for the demo) | — |
| Screenshot | `html2canvas` | MIT |
| Browser automation | `@playwright/test` | Apache-2.0 |
| Intake | Fastify + `zod` | MIT |
| Push | `web-push` (VAPID) | MPL-2.0 → **verify compatibility; fallback: ntfy-style polling via SW** |
| Image diff | `pixelmatch` + `pngjs` | ISC / MIT |
| JSON diff | `jsondiffpatch` or a hand-rolled diff | MIT |
| IaC | Terraform ≥ 1.7, `hashicorp/google` provider | MPL-2.0 (tooling, not shipped) |
| LLM | Claude Sonnet 5.5 via the GitLab AI Gateway (flow). Second Opinion labeler: see §11.6. | — |

> **Licence note:** `web-push` is MPL-2.0. The rule says "everything you use or make must be MIT-licensed". **Ask in Discord** (Oct 15) whether MPL/Apache dependencies are OK. If not, use no push library: the service worker polls `GET /v1/reports/:rid/status` every 20s while the PWA is open. The "buzz" then works only while the app is open, which is fine for the demo.

---

## 6. Component A: SplitPal demo app

A small bill-splitting PWA. It's a believable app with real flows for Second Opinion to replay.

### 6.1 Screens and flows

| Route | Purpose | Key elements (stable `data-testid`s) |
|---|---|---|
| `/` | Bills list | `bill-row-<id>`, `new-bill-btn` |
| `/bill/new` | Create a bill: title, total, people | `title-input`, `total-input`, `person-input-<n>`, `add-person-btn`, `save-bill-btn` |
| `/bill/:id` | Split view: per-person share, tip %, currency | `share-<name>`, `tip-select`, `currency-select`, `settle-btn` |
| `/bill/:id/settle` | Settle up: mark paid, confirmation | `pay-<name>-btn`, `confirm-settle-btn`, `settled-banner` |
| `/settings` | Name, currency default, "Enable shake to report" | `enable-shake-btn` |

API (Express, same container): `GET/POST /api/bills`, `GET/PATCH /api/bills/:id`, `POST /api/bills/:id/settle`. Every write appends to `audit_log` (`{ts, op, table, rowId, fields}`); Second Opinion reads this for DB-write diffs (§11.3).

### 6.2 Seeded bugs (deterministic, reproducible)

Keep them in `scripts/seed-bugs.md`. `reset-demo.sh` restores them on a `demo-reset` branch for re-recording.

| ID | Bug | Repro | Expected fix | Trap for Second Opinion |
|---|---|---|---|---|
| **B1** (hero) | Split rounding: ₹1000 / 3 shows 333.33 ×3 = 999.99, so ₹0.01 is lost and "settle" never completes | New bill 1000, 3 people → settle → banner never shows | Allocate the remainder cent to the first person (largest-remainder method) | A naive fix using `Math.round` on the total changes **tip totals** on other bills. Second Opinion flags it as **unintended**, and the second iteration fixes it with `toCents`. This is the video's "Second Opinion catches the AI" moment. |
| **B2** | Empty person name crashes the split view (`undefined.toUpperCase`) | Add a person with a blank name → open bill | Validate and trim, show an inline error | None |
| **B3** | Currency switch to USD shows `₹` symbol in the totals header | Bill → currency USD | Use `Intl.NumberFormat` with the selected currency | None |
| **B4** (governance demo) | `auth/session.ts` token expiry off-by-one logs users out early | Settings → wait (simulated clock) | Fix the comparison | **Path matches `auth/`**, so policy forces Supervised and stops for human approval |

### 6.3 Requirements

1. PWA: `manifest.webmanifest` plus a service worker (`sw.js`) for push/notification click → opens `/bill/:id`.
2. Every interactive element has a `data-testid`. The recorder uses it as the primary selector.
3. Deterministic data: seed bills on boot from `server/seed.json`.
4. Version string in the footer (`v<git short sha>`) so the video shows the deploy changing.
5. `/healthz` endpoint for Cloud Run.

**Done when:** all 4 bugs reproduce by hand on a phone over HTTPS.

---

## 7. Component B: Shake SDK

Package `packages/sdk`, loaded with `<script src="/shakefix-sdk.js" data-endpoint="https://intake…/v1/reports" data-project="splitpal"></script>`.

### 7.1 Shake detection

```js
// iOS 13+: requires a user gesture to grant motion permission
async function enableShake() {
  if (typeof DeviceMotionEvent?.requestPermission === 'function') {
    const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') return false;
  }
  let last = null, hits = [];
  addEventListener('devicemotion', e => {
    const a = e.accelerationIncludingGravity; if (!a) return;
    if (last) {
      const jolt = Math.abs(a.x-last.x)+Math.abs(a.y-last.y)+Math.abs(a.z-last.z);
      const now = performance.now();
      if (jolt > 15) { hits.push(now); hits = hits.filter(t => now - t < 1000); }
      if (hits.length >= 3) { hits = []; openReporter(); }
    }
    last = { x: a.x, y: a.y, z: a.z };
  });
  return true;
}
```

1. Show a one-time chip "Enable shake to report" that calls `enableShake()` on tap.
2. **Fallbacks:** a floating "Report bug" bubble (bottom-right, always visible) and **Ctrl+Shift+B** on desktop.
3. **Auto-prompt:** after an uncaught error or 3 rage clicks (3 clicks on the same element within 800ms), show the toast "Looks like something broke. Tap to tell us."

### 7.2 Capture

1. **Action recorder:** a ring buffer of the last **30** actions: `click`, `input` (value **masked** unless the field is in an allowlist, e.g. `total-input`, `person-input-*`), `change`, `navigate` (pushState/popstate), `submit`. Each records `{t, type, selector, testid, value?, route}`.
2. **Console:** the last 50 `console.error`/`console.warn` calls, plus `window.onerror` and `unhandledrejection` with stack.
3. **Network:** the last 20 fetch/XHR calls `{method, path, status, ms}`, with no bodies or headers.
4. **Screenshot:** `html2canvas(document.body, {scale: 0.6})` → PNG data URL. Elements with `data-private` are masked.
5. **Context:** route, viewport, UA, app version, timestamp.
6. **Reporter form:** an optional one-line note ("what went wrong?") plus a "Notify me when fixed" toggle that registers push and attaches the subscription.

### 7.3 `replay.json` schema (v1)

```json
{
  "schema": "shakefix.replay/v1",
  "rid": "r_2026_10_11_8f3a",
  "app": { "name": "splitpal", "version": "a1b2c3d", "baseUrl": "https://splitpal-....run.app" },
  "device": { "ua": "...", "viewport": [390, 844], "touch": true },
  "trigger": "shake | bubble | hotkey | auto-error | rage-click",
  "note": "settle button does nothing",
  "startRoute": "/",
  "actions": [
    { "t": 0,    "type": "click",    "testid": "new-bill-btn", "selector": "[data-testid=new-bill-btn]" },
    { "t": 812,  "type": "input",    "testid": "total-input",  "value": "1000" },
    { "t": 1500, "type": "click",    "testid": "settle-btn" }
  ],
  "expectation": { "testid": "settled-banner", "state": "visible" },
  "console": [ { "level": "error", "msg": "...", "stack": "..." } ],
  "network": [ { "method": "POST", "path": "/api/bills/7/settle", "status": 200, "ms": 41 } ]
}
```

`expectation` is inferred: the last clicked element's intended outcome from a small map in the SDK config (e.g. `settle-btn → settled-banner visible`). If it's unknown, it's left `null` and the Triage Nurse infers it from the note.

**Done when:** shaking on a real iPhone and a real Android phone posts a valid `replay.json` (validated by zod in the intake).

---

## 8. Component C: Intake service

`services/intake`, Fastify on Cloud Run (`intake-<env>`).

### 8.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/reports` | Body: `{replay, screenshotPng (base64), pushSubscription?}`. Returns `{rid, issueUrl}`. |
| GET | `/v1/reports/:rid/status` | `{state: received|triaging|in-surgery|proof|deployed|verified|reopened|rolled-back|needs-human, issueIid, mrIid?, verdict}`. Used for polling and the dashboard. |
| POST | `/v1/reports/:rid/fixed` | CI `notify.sh` (HMAC). Marks deployed, opens a new verdict round, sends the "Fixed ✓" push with `verdictUrl`. |
| POST | `/v1/reports/:rid/verdict` | Public (CORS allowlist, rate limited, zod). Reporter verdict `{verdict: confirmed|rejected, deviceId?, replay?}` (§17.5). |
| GET | `/v1/board` | Public, read-only, no PII. Items include `verdict` (`confirmed|rejected|null`) and `verdicts` counts. |
| POST | `/v1/hooks/gitlab` | A GitLab webhook (issue, MR and pipeline events) updates Firestore `reports/<rid>.state`. Verified with the `X-Gitlab-Token` secret. |
| GET | `/healthz` | Health check |

### 8.2 On `POST /v1/reports`

1. Validate with zod. Reject over 2 MB. Rate limit to 5/min per IP and 50/day per app.
2. **Scrub:** drop non-allowlisted input values, strip emails and phone numbers from notes with a regex.
3. **Dedupe:** hash (route + last 5 action testids + top console error). If an open issue has the same hash label `dup::<hash8>`, add a comment "+1 reporter" and subscribe the push; don't trigger a new flow.
4. **Commit replay:** `POST /projects/:id/repository/commits` to the **default branch** creating `reports/<rid>/replay.json`. This lets agents read it with `get_repository_file`.
   - Note: this creates a commit on `main`, which triggers a pipeline. Add `[skip ci]` to that commit message.
   - **Alternative if branch protection blocks it:** commit to the branch `reports` and have agents read with `ref=reports`.
5. **Upload screenshot:** `POST /projects/:id/uploads` → markdown link.
6. **Create issue** with the **maintainer personal PAT** (`GITLAB_HUMAN_PAT`):
   - Title: `🩺 [shake] <note or top error> (<route>)`
   - Labels: `shakefix`, `sev::<1-3>` (sev1 = uncaught error, sev2 = expectation failed, sev3 = cosmetic), `dup::<hash8>`
   - Description: from the template in §8.3.
7. Save `{rid, issueIid, hash, pushSubscription, state:'received'}` in Firestore.
8. **Trigger:** the issue creation fires the **"Work item created"** trigger (§10.5). If the spike (§25 S1) shows it doesn't fire, the fallback is to start the flow via `POST /api/v4/ai/duo_workflows/workflows` with the goal "Fix issue #<iid>" (§10.7).

### 8.3 Issue description template

````markdown
<!-- shakefix:rid=r_2026_10_11_8f3a -->
## 🩺 Patient intake

**Reporter note:** settle button does nothing
**Trigger:** shake · **Route:** `/bill/7` · **App version:** `a1b2c3d` · **Device:** iPhone, 390×844

![screenshot](/uploads/…/shot.png)

### Top console error
```
(none)
```

### Replay (also at `reports/r_2026_10_11_8f3a/replay.json`)
```json
{ …full replay.json… }
```

---
_Filed automatically by ShakeFix intake. The ER team (Duo flow) will take it from here._
````

### 8.4 Config (env vars / Secret Manager)

`GITLAB_URL`, `GITLAB_PROJECT_ID`, `GITLAB_HUMAN_PAT` (Secret Manager), `GITLAB_WEBHOOK_SECRET`, `FIRESTORE_COLLECTION=reports`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secret), `ALLOWED_ORIGINS`.

### 8.5 Live vs submitted routing

`GITLAB_PROJECT_ID` points to **`shakefix`** during the build and video recording. On **Oct 26** switch it to **`shakefix-live`** and redeploy the intake. From then on, judge shakes never touch the submitted repo.

**Done when:** a shake creates an issue in under 3s with the inline replay, the committed replay file and the screenshot.

---

## 9. Component D: GitLab project setup

Do these in order in the browser or via the API.

1. **Create the project** `shakefix`: public, initialised with a README, then push the scaffold.
2. **LICENSE:** MIT, `Copyright (c) 2026 Venkatesh Devale`. Confirm the About panel shows "MIT License".
3. **Group settings → GitLab Duo:**
   - Duo Agent Platform: **on**.
   - **"Allow custom flows" / flow triggers: on.**
   - Default model: Claude Sonnet 5.5 (already default).
   - "Allow external MCP tools": only if MCP is used (optional).
4. **Labels:**
   - `shakefix`, `sev::1`, `sev::2`, `sev::3`
   - `shakefix::triaging`, `shakefix::in-surgery`, `shakefix::proof`, `shakefix::ready`, `shakefix::unintended`, `shakefix::deployed`, `shakefix::verified`, `shakefix::reopened`, `shakefix::rolled-back`
   - `needs-human`, `dup::*` (created on demand)
5. **Protected branch** `main`: push for no one, merge for Maintainers. Allow the project access token to merge.
6. **Merge request settings:**
   - "Pipelines must succeed": on.
   - "All threads resolved": off (bot threads).
   - Merge method: merge commit.
   - Squash: encourage.
   - Delete source branch: on.
7. **Approval rules:**
   - Rule `auth-owners`: 1 approval from `@cto.spacenos` (or a second account, see the note) for changes in `apps/splitpal/src/auth/**`, also via CODEOWNERS with "Require code owner approval" on `main`.
   - **Note:** MRs created by the flow are attributed to the triggering human (`cto.spacenos`), and authors may not approve their own MRs. For the `auth/` demo, add a **second GitLab account** (teammate) as code owner, or show the MR "waiting for approval" without approving it in the video.
8. **CI/CD variables** (masked and protected where possible):

| Key | Value | Notes |
|---|---|---|
| `SHAKEFIX_BOT_TOKEN` | project access token, Maintainer, scope `api` | merge, label and comment from CI |
| `GCP_PROJECT_ID` | e.g. `shakefix-hack` | |
| `GCP_REGION` | `asia-south1` (or `us-central1`) | |
| `GCP_WIF_PROVIDER` | `projects/<num>/locations/global/workloadIdentityPools/gitlab/providers/gitlab` | §13.4 |
| `GCP_SA_EMAIL` | `shakefix-ci@<proj>.iam.gserviceaccount.com` | |
| `INTAKE_URL` | Cloud Run URL of the intake | notify step |
| `INTAKE_HOOK_SECRET` | shared secret for CI → intake status calls | |
| `ANTHROPIC_API_KEY` | only if the Second Opinion labeler uses the direct API (§11.6 option B) | masked |

9. **Webhook:** Project → Webhooks → `INTAKE_URL/v1/hooks/gitlab`, secret `GITLAB_WEBHOOK_SECRET`, events: issues, merge requests, pipelines.
10. **GitLab Pages:** enabled (for the dashboard, §16). Public.
11. **Runners:** GitLab.com hosted runners (default). Duo flow jobs need the `gitlab--duo` tag, which hosted runners provide. **Verify in the spike** that the sandbox works on hosted runners (privileged / user namespaces).

**Done when:** a manual MR with a passing pipeline can be merged by `SHAKEFIX_BOT_TOKEN` via the API.

---

## 10. Component E: Duo custom flow

File: `.gitlab/duo/flows/shakefix.yml`. Size limit 40 KiB.

> **Schema caveat:** the keys below follow the documented v1 schema (`version: v1`, `environment: ambient`, `components`, `prompts`, `routers`, `flow.entry_point`). Field names inside components and prompts (`toolset`, `inputs`, `prompt_template`, `ui_log_events`) **must be validated against docs.gitlab.com "Custom flows schema"** during spike S0. Top-level `name`, `description` and `model` are **rejected**. Models are set at group level, and prompts may use `model_tags` only.

### 10.1 Persona (shared voice): `.shakefix/persona.md`

The ER team runs a calm, precise hospital emergency room. Every comment uses this **Patient Chart** card:

```markdown
### 🩺 Patient Chart — #<iid>
| | |
|---|---|
| **Symptoms** | <what the user saw> |
| **Diagnosis** | <root cause, file:line> |
| **Procedure** | <what changed, 1–3 bullets> |
| **Vitals** | regression spec ❌→✅ · unit ✅ · Second Opinion: n intended / m unintended |
| **Discharge** | <next step / who> |
_— <Agent role>, ShakeFix ER_
```

Rules: no jokes about real medical harm, short sentences, cite file paths, and never claim success without test evidence.

### 10.2 Agents (components)

| # | Component id | Persona | Job | Tools (allowlist) | max_cycles |
|---|---|---|---|---|---|
| 1 | `triage_nurse` | Triage Nurse, "trusts nothing until it reproduces" | Read issue + `reports/<rid>/replay.json`, check the Ledger for similar bugs, write `tests/regressions/issue-<iid>.spec.ts` from the replay (via the converter, §10.4), **run it and confirm it FAILS** | `get_issue`, `get_repository_file`, `list_repository_tree`, `find_files`, `grep`, `read_file`, `create_file_with_contents`, `run_command` | 40 |
| 2 | `surgeon` | Surgeon, "smallest incision possible" | Find the root cause, make the **minimal** fix, run the regression spec + unit tests until green, write the Ledger entry, create branch `shakefix/<iid>-<slug>` and commit (spec + fix + ledger) | `read_file`, `grep`, `find_files`, `edit_file`, `create_file_with_contents`, `run_command`, `run_tests`, `create_branch`, `create_commit` | 60 |
| 3 | `attending` | Attending physician, "paranoid reviewer" | Review the diff: scope creep, security, matches the issue, checks `policy.yml`. Output JSON `{approve: bool, confidence: 0..1, concerns: [], policy_hits: []}` | `read_file`, `grep`, `get_repository_file`, `run_tests` (read-only otherwise) | 25 |
| 4 | `discharge` | Discharge nurse | Open the MR with the Patient Chart, apply labels (`shakefix::proof` normally, `needs-human` on a policy hit or `approve:false`), link the issue (`Closes #iid`), comment on the issue | `create_merge_request`, `create_issue_note`, `update_issue`, `create_merge_request_note` | 15 |

Routing: `triage_nurse → surgeon → attending → discharge → end`. If the Triage Nurse **cannot reproduce** (the spec passes on main), go straight to `discharge` with a "could not reproduce" chart and label `needs-info`.

### 10.3 Draft `shakefix.yml`

```yaml
version: "v1"
environment: ambient
coding_environment: full

components:
  - name: "triage_nurse"
    type: AgentComponent
    prompt_id: "triage_nurse_prompt"
    inputs:
      - from: "context:goal"
        as: "goal"
      - from: "context:project_id"
        as: "project_id"
    toolset:
      - "get_issue"
      - "get_repository_file"
      - "list_repository_tree"
      - "find_files"
      - "grep"
      - "read_file"
      - "create_file_with_contents"
      - "run_command"
    ui_log_events: ["on_agent_final_answer", "on_tool_execution_success", "on_tool_execution_failed"]

  - name: "surgeon"
    type: AgentComponent
    prompt_id: "surgeon_prompt"
    inputs:
      - from: "context:goal"
        as: "goal"
      - from: "context:triage_nurse.final_answer"
        as: "triage_report"
    toolset: ["read_file","grep","find_files","edit_file","create_file_with_contents","run_command","run_tests","create_branch","create_commit"]

  - name: "attending"
    type: AgentComponent
    prompt_id: "attending_prompt"
    inputs:
      - from: "context:goal"
        as: "goal"
      - from: "context:surgeon.final_answer"
        as: "surgery_report"
    toolset: ["read_file","grep","get_repository_file","run_tests"]

  - name: "discharge"
    type: AgentComponent
    prompt_id: "discharge_prompt"
    inputs:
      - from: "context:goal"
        as: "goal"
      - from: "context:triage_nurse.final_answer"
        as: "triage_report"
      - from: "context:surgeon.final_answer"
        as: "surgery_report"
      - from: "context:attending.final_answer"
        as: "review"
    toolset: ["create_merge_request","create_issue_note","update_issue","create_merge_request_note"]

routers:
  - from: "triage_nurse"
    to: "surgeon"
  - from: "surgeon"
    to: "attending"
  - from: "attending"
    to: "discharge"
  - from: "discharge"
    to: "end"

flow:
  entry_point: "triage_nurse"

prompts:
  - prompt_id: "triage_nurse_prompt"
    prompt_template:
      system: |
        <contents of §10.4 Triage Nurse prompt>
      user: |
        Goal: {{goal}}
        Project: {{project_id}}
  # … surgeon_prompt, attending_prompt, discharge_prompt (see §10.4)
```

> **Conditional routing** (could-not-reproduce → discharge) needs router conditions. If the schema lacks them, keep the linear flow and have the Surgeon **no-op with a clear final answer** when the triage report says `reproduced:false`. The Discharge agent then files the "could not reproduce" chart.

### 10.4 Prompts (system text; keep each under about 1.5 KB)

**Triage Nurse**
```
You are the Triage Nurse of ShakeFix ER. Voice: calm, precise (see .shakefix/persona.md).
INPUT: an issue created by ShakeFix intake. It contains <!-- shakefix:rid=... -->.
STEPS:
1. Read the issue. Extract rid. Read reports/<rid>/replay.json (default branch; if missing try ref "reports").
2. Read .shakefix/ledger/index.json. If a similar entry exists (same route or same file), note its id.
3. Generate the regression spec by running:
   node packages/replay/bin/to-spec.js reports/<rid>/replay.json tests/regressions/issue-<iid>.spec.ts --iid <iid>
4. Run: npx playwright test tests/regressions/issue-<iid>.spec.ts --reporter=line  (against local dev server: npm run -w splitpal start:test &)
5. It MUST FAIL. If it passes, set reproduced=false.
FINAL ANSWER (JSON only):
{"reproduced":bool,"rid":"...","iid":n,"spec_path":"...","failure":"<assertion message>","suspect_files":["..."],"ledger_match":"<id|null>"}
Never edit app source. Never create branches or MRs.
```

**Surgeon**
```
You are the Surgeon of ShakeFix ER. Smallest incision possible.
INPUT: triage_report JSON.
If reproduced=false: do nothing; final answer {"operated":false,"reason":"not reproduced"}.
STEPS:
1. Read suspect_files and the failing spec. If ledger_match, read .shakefix/ledger/entries/<id>.md and fix the whole family (sibling call sites) if the same root cause applies.
2. Edit the minimum lines. Do not reformat, rename, or touch unrelated files.
3. Run the regression spec and `npm test -w splitpal`. Loop until green (max 3 attempts).
4. Write .shakefix/ledger/entries/<iid>.md (template in file header) and append to index.json.
5. create_branch shakefix/<iid>-<slug>; create_commit with: spec file, fix, ledger files. Message: "fix(<area>): <summary> (closes #<iid>)\n\nSigned-off-by: ShakeFix ER".
FINAL ANSWER (JSON only):
{"operated":true,"branch":"...","files":["..."],"root_cause":"file:line — ...","tests":{"regression":"pass","unit":"pass"},"attempts":n}
```

**Attending**
```
You are the Attending physician. Paranoid reviewer. You approve nothing you have not read.
INPUT: surgery_report. Read every changed file on the branch. Read .shakefix/policy.yml.
Check: (a) change matches the diagnosis, (b) no unrelated edits, (c) no secrets/unsafe input handling, (d) policy path matches.
Run the regression spec once more.
FINAL ANSWER (JSON only):
{"approve":bool,"confidence":0.0-1.0,"concerns":["..."],"policy_hits":["auth/**"],"summary":"one sentence"}
```

**Discharge**
```
You are the Discharge nurse. You open the MR and write the Patient Chart (format in .shakefix/persona.md).
If operated=false: comment the chart on the issue with "Could not reproduce", add label needs-info. Stop.
Else: create_merge_request from the branch to main, title "🩺 Fix #<iid>: <summary>", description = Patient Chart + "Closes #<iid>".
Labels: "shakefix" plus — if review.policy_hits non-empty OR approve=false OR confidence<0.7 → "needs-human"; else "shakefix::proof".
Comment on the issue: "Moved to surgery → !<mr>". 
FINAL ANSWER: {"mr_iid":n,"labels":[...]}
```

### 10.5 Trigger

Project → **Automate → Flows → shakefix → Triggers → Add trigger**:
- Event: **Work item created** (issue type).
- Scope/filter: the flow's goal text tells agents to act **only** if the issue has the label `shakefix` and the `<!-- shakefix:rid= -->` marker. Otherwise they finish immediately with "not a ShakeFix report".
- Also add a **Mention** trigger (`@ai-shakefix-<group>`) as a manual re-run path, used by the Second Opinion re-operation (§11.7) and by the reporter-rejected re-triage (§17.5: `@ai-shakefix-<group> re-triage: reporter rejected the fix, see latest replay`).

### 10.6 `.gitlab/duo/agent-config.yml` (default branch only)

```yaml
setup_script:
  - corepack enable
  - pnpm install --frozen-lockfile
  - pnpm --filter splitpal build
  - npx playwright install --with-deps chromium
cache:
  key: shakefix-duo
  paths: [ node_modules/, ~/.cache/ms-playwright/ ]
network_policy:
  include_recommended_allowed: true      # npm registry etc.
  allowed_domains:
    - playwright.azureedge.net
    - playwright.download.prss.microsoft.com
    - cdn.playwright.dev
```
> Per docs, `setup_script` runs **before** the sandbox network policy is applied, so installs work there. Agents' `run_command` calls later are sandboxed. **Verify in spike S2.**

### 10.7 Fallback start (if triggers can't fire from the intake)

1. **Option A:** the intake calls `POST /api/v4/ai/duo_workflows/workflows` with `{project_id, goal: "ShakeFix: fix issue #<iid>", workflow_definition: "<custom flow id>"}`. Check the docs for exact fields.
2. **Option B:** the human-tap fallback. The intake sends the maintainer a push saying "New patient #<iid>: Approve triage?" Tapping it opens the issue, and the maintainer assigns the flow's service account (a human action). This makes the demo **Supervised**, which is still a prize category.

**Done when:** creating an issue with a replay leads to an MR with a failing-then-passing spec and a Patient Chart, with no human input.

---

## 11. Component F: Second Opinion (behavior diff gate)

Package `packages/proof` exposes a CLI: `proof run --base <url> --head <url> --flows <glob> --out proof/`.

### 11.1 Inputs

1. **Base URL:** current prod revision (`main`), e.g. `https://main---splitpal-xyz.run.app` (Cloud Run tag URL).
2. **Head URL:** the MR's branch revision `https://mr-<iid>---splitpal-xyz.run.app`.
3. **Flows:**
   - every `tests/e2e/*.flow.json` (baseline flows: create bill, split 3 ways, change tip, change currency, settle)
   - plus the user's `reports/<rid>/replay.json`
   - plus the new regression spec's steps.

### 11.2 Execution

For each flow, run Playwright (chromium, fixed viewport 390×844, `reducedMotion`, fixed clock `2026-10-11T10:00:00Z`, seeded data via `POST /api/__test/reset`) **against base and head**. After every step, capture:

1. **Screen:**
   - a full-page screenshot,
   - a DOM snapshot of visible text per `data-testid`: `{testid: innerText}`.
2. **API:** every response `{method, path(normalized ids), status, body(json, keys sorted, volatile keys removed: id, createdAt, updatedAt)}`.
3. **DB:** `GET /api/__test/audit?since=<ts>` returns the write ops `{op, table, fields}`.

The `__test` endpoints exist only when `SHAKEFIX_TEST_HOOKS=1`. That flag is on for the base/head preview revisions and **off in prod**.

### 11.3 Diff

1. **Screens:** for each `testid`, a text diff (`before → after`). Pixel diff with `pixelmatch` (threshold 0.1) is used **only** to flag "visual change without text change".
2. **API:**
   - status changes,
   - added or removed endpoints,
   - JSON field diffs, compared by path, e.g. `$.shares[1].amount: 333.33 → 333.34`.
3. **DB:** added, removed or changed write ops per table and field.

Output `proof/proof.json`:

```json
{
  "schema": "shakefix.proof/v1",
  "mr": 42, "base": "a1b2c3d", "head": "e4f5a6b",
  "flows": [
    { "flow": "settle-3-way", "changes": [
      { "id": "c1", "channel": "screen", "where": "/bill/7 · settled-banner", "before": "(hidden)", "after": "Settled ✓" },
      { "id": "c2", "channel": "api", "where": "POST /api/bills/:id/settle · $.ok", "before": false, "after": true },
      { "id": "c3", "channel": "screen", "where": "/bill/9 · tip-total", "before": "₹49.99", "after": "₹50.00" }
    ]}
  ],
  "summary": { "changes": 3 }
}
```

### 11.4 Labeling (intended vs unintended)

Labeler input: `proof.json` plus the issue text plus the Patient Chart diagnosis. Output adds to each change `{label: "intended"|"unintended", reason}`, plus `summary.intended` and `summary.unintended`.

**Deterministic pre-rules** (applied before the LLM, to cut tokens and add determinism):
1. A change in a flow whose route matches the issue route and testids in the replay is **intended candidate**.
2. A change on a route or bill **not** touched by the replay is an **unintended candidate**.
3. The LLM only confirms or overrides candidates and must give a reason.

### 11.5 Report on the MR (Behavior Diff card)

```markdown
### 🩺 Second Opinion — Behavior Diff (main ⟷ !42)
| | Channel | Where | Before → After | Verdict |
|---|---|---|---|---|
| ✓ | SCREEN | /bill/7 · settled-banner | hidden → "Settled ✓" | intended — the reported bug |
| ✓ | API | POST /bills/:id/settle · ok | false → true | intended |
| ✗ | SCREEN | /bill/9 · tip-total | ₹49.99 → ₹50.00 | **unintended** — tip math changed on an unrelated bill |
**3 changes · 2 intended · 1 unintended** → ⛔ blocked
Artifacts: screenshots, proof.json
```

### 11.6 Where the labeler runs (pick one in spike S3)

| Option | How | Pros | Cons |
|---|---|---|---|
| **A (preferred, most "Duo")** | A second small custom flow `proof-labeler`, triggered by **Mention** in an MR note. CI can't trigger flows (bot), so **the Discharge agent's MR note mentions it**, but that is also a bot action. ❌ | All-Duo | Triggers need a human, so this won't chain |
| **B (recommended)** | CI step `proof label` in the `second_opinion` job calls Claude through the **Anthropic API** directly (`ANTHROPIC_API_KEY`, masked) | Reliable, deterministic, fast | Not Duo. That's fine: Duo does the fixing, and Second Opinion is our product |
| C | CI job with no LLM: deterministic pre-rules only | Zero cost | Weaker demo |

**Decision:** use **B** with C as the automatic fallback if the API fails. State it in the README: "Second Opinion's labeler calls Claude directly. The fixing agents run on GitLab Duo."

### 11.7 Gate logic (`scripts/ci/proof-gate.sh`)

1. `unintended == 0` and no `needs-human` label → label `shakefix::ready` → **merge job** runs.
2. `unintended > 0` and this is the **first** time → comment "Second Opinion found side effects; sending back to surgery." Label `shakefix::unintended`.
   - Re-trigger the surgeon with the Second Opinion report: the CI posts the report, then **the intake (holding the human PAT) posts a mention of the flow service account on the issue**: `@ai-shakefix-<group> re-operate: see Second Opinion report on !42`.
   - This counts as a human action because it comes from the human PAT, so the Mention trigger fires. **Validate in spike S1b.**
3. `unintended > 0` on the **second** time → label `needs-human`, stop, notify the maintainer.

**Done when:** the B1 naive fix gets blocked with exactly 1 unintended change, and the second iteration passes with 0.

---

## 12. Component G: CI/CD pipeline

`.gitlab-ci.yml` (sketch; complete the job scripts):

```yaml
stages: [lint, test, secure, build, preview, second_opinion, merge, deploy, monitor, ledger, pages]

include:
  - template: Jobs/SAST.gitlab-ci.yml
  - template: Jobs/Dependency-Scanning.gitlab-ci.yml
  - template: Jobs/Secret-Detection.gitlab-ci.yml

default:
  image: mcr.microsoft.com/playwright:v1.48.0-jammy   # match pinned @playwright/test version
  cache: { key: pnpm, paths: [.pnpm-store] }
  before_script: [corepack enable, pnpm config set store-dir .pnpm-store, pnpm install --frozen-lockfile]

variables:
  SPLITPAL_SERVICE: splitpal
  IMAGE: $GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/shakefix/splitpal:$CI_COMMIT_SHORT_SHA

.gcp_auth:
  id_tokens:
    GITLAB_OIDC_TOKEN: { aud: "https://iam.googleapis.com/$GCP_WIF_PROVIDER" }
  before_script:
    - echo "$GITLAB_OIDC_TOKEN" > .ci_token
    - gcloud iam workload-identity-pools create-cred-config $GCP_WIF_PROVIDER --service-account=$GCP_SA_EMAIL --credential-source-file=.ci_token --output-file=.gcp.json
    - gcloud auth login --cred-file=.gcp.json && gcloud config set project $GCP_PROJECT_ID

lint:        { stage: lint, script: [pnpm lint, pnpm typecheck] }
unit:        { stage: test, script: [pnpm test -r --reporter=junit], artifacts: { reports: { junit: "**/junit.xml" } } }
regression:
  stage: test
  script: [pnpm --filter splitpal start:test & , npx wait-on http://localhost:8080/healthz, npx playwright test tests/regressions tests/e2e]
  artifacts: { when: always, paths: [playwright-report/], reports: { junit: test-results/junit.xml } }

build_image:
  extends: .gcp_auth
  stage: build
  image: google/cloud-sdk:slim
  script: [gcloud builds submit apps/splitpal --tag $IMAGE]     # or kaniko
  rules: [{ if: $CI_MERGE_REQUEST_IID }, { if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH }]

preview_deploy:          # MR only: deploy branch revision with tag, no traffic
  extends: .gcp_auth
  stage: preview
  image: google/cloud-sdk:slim
  script:
    - gcloud run deploy $SPLITPAL_SERVICE --image $IMAGE --region $GCP_REGION --no-traffic --tag mr-$CI_MERGE_REQUEST_IID --set-env-vars SHAKEFIX_TEST_HOOKS=1
    - echo "HEAD_URL=$(gcloud run services describe $SPLITPAL_SERVICE --region $GCP_REGION --format='value(status.traffic[?tag=mr-'$CI_MERGE_REQUEST_IID'].url)')" >> preview.env
  artifacts: { reports: { dotenv: preview.env } }
  environment: { name: review/mr-$CI_MERGE_REQUEST_IID, url: $HEAD_URL, on_stop: preview_stop }
  rules: [{ if: $CI_MERGE_REQUEST_IID }]

second_opinion:
  stage: second_opinion
  needs: [preview_deploy]
  script:
    - pnpm proof run --base "$BASE_URL" --head "$HEAD_URL" --flows "tests/e2e/*.flow.json" --replay-from-mr $CI_MERGE_REQUEST_IID --out proof/
    - pnpm proof label --in proof/proof.json --issue-from-mr $CI_MERGE_REQUEST_IID   # option B, falls back to rules
    - pnpm proof report --in proof/proof.json --post-mr $CI_MERGE_REQUEST_IID
    - bash scripts/ci/proof-gate.sh proof/proof.json
  artifacts: { when: always, paths: [proof/], expose_as: "Second Opinion report" }
  rules: [{ if: $CI_MERGE_REQUEST_IID }]

auto_merge:
  stage: merge
  needs: [second_opinion, regression, unit, sast, secret_detection]
  script: [bash scripts/ci/merge.sh]     # merges via SHAKEFIX_BOT_TOKEN only if label shakefix::ready and not needs-human
  rules: [{ if: $CI_MERGE_REQUEST_IID && $CI_MERGE_REQUEST_LABELS =~ /shakefix/ }]

deploy_prod:
  extends: .gcp_auth
  stage: deploy
  image: google/cloud-sdk:slim
  script:
    - PREV=$(gcloud run services describe $SPLITPAL_SERVICE --region $GCP_REGION --format='value(status.traffic[0].revisionName)')
    - echo "PREV_REVISION=$PREV" >> deploy.env
    - gcloud run deploy $SPLITPAL_SERVICE --image $IMAGE --region $GCP_REGION --tag main --set-env-vars SHAKEFIX_TEST_HOOKS=0
  artifacts: { reports: { dotenv: deploy.env } }
  environment: { name: production, url: https://splitpal-xyz.run.app }
  rules: [{ if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH }]

post_deploy_smoke:
  stage: monitor
  needs: [deploy_prod]
  script: [BASE_URL=$PROD_URL npx playwright test tests/e2e --grep @smoke]
  rules: [{ if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH }]

rollback:
  extends: .gcp_auth
  stage: monitor
  needs: [deploy_prod, post_deploy_smoke]
  when: on_failure
  script: [gcloud run services update-traffic $SPLITPAL_SERVICE --region $GCP_REGION --to-revisions $PREV_REVISION=100, bash scripts/ci/label.sh rolled-back]

notify_and_close:
  stage: ledger
  needs: [post_deploy_smoke]
  script: [bash scripts/ci/notify.sh, bash scripts/ci/close-issue.sh]   # intake push "Fixed", Discharge note, label deployed
  rules: [{ if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH }]

pages:
  stage: pages
  script: [pnpm --filter dashboard build, mv dashboard/dist public]
  artifacts: { paths: [public] }
  rules: [{ if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH }]
```

Notes:
1. `BASE_URL` is the `main` tag URL (stable; set it as a CI variable).
2. Preview cleanup: the `preview_stop` job removes the tag on MR close.
3. The AI Catalog publish job (optional, polish) runs on tag pipelines with the AI Catalog CI/CD component to publish `shakefix` flow versions.
4. Add `[skip ci]` handling so intake report commits don't spawn pipelines.

**Done when:** one MR runs every stage, and the main pipeline deploys, smokes, notifies and closes.

---

## 13. Component H: Google Cloud infrastructure

### 13.1 Project

1. Create a GCP project `shakefix-hack` and link billing. There is no trial credit here, so keep usage inside the always-free tiers.
2. Enable the APIs: `run`, `artifactregistry`, `cloudbuild`, `iamcredentials`, `sts`, `secretmanager`, `firestore`.

### 13.2 Terraform (`infra/`)

| Resource | Purpose |
|---|---|
| `google_artifact_registry_repository.shakefix` | Docker images |
| `google_cloud_run_v2_service.splitpal` | The demo app (min instances 0, max 2, 512Mi) |
| `google_cloud_run_v2_service.intake` | The intake service |
| `google_firestore_database` (native) | Report state plus push subscriptions |
| `google_secret_manager_secret` × 3 | `gitlab-human-pat`, `vapid-private`, `gitlab-webhook-secret` |
| `google_service_account.ci` + roles | `run.admin`, `iam.serviceAccountUser`, `artifactregistry.writer`, `cloudbuild.builds.editor` |
| `google_iam_workload_identity_pool` + provider `gitlab` | OIDC from `https://gitlab.com`, attribute condition `assertion.project_path == "<ns>/shakefix"` |
| `google_service_account_iam_member` | `workloadIdentityUser` for the pool principal set |
| `google_cloud_run_v2_service_iam_member` | `allUsers` invoker for splitpal and intake (public demo) |

### 13.3 Regions and cost

`asia-south1` (Mumbai), or `us-central1` for judges in the US. Everything stays within the free tier or a few dollars. **Set a budget alert at $20.**

### 13.4 Workload Identity Federation from GitLab

1. The pool `gitlab` gets an OIDC provider with issuer `https://gitlab.com` and attribute mapping `google.subject=assertion.sub, attribute.project_path=assertion.project_path, attribute.ref=assertion.ref`.
2. The CI job gets `id_tokens` with `aud` = the provider resource name (see §12 `.gcp_auth`).

**Done when:** `terraform apply` from a clean project creates everything, and CI deploys with **no JSON key** anywhere.

---

## 14. Component I: Medical Record

Full design: [docs/MEMORY.md](docs/MEMORY.md). Contracts: docs/CONTRACTS.md "Medical Record".
LORE-inspired, deterministic, repo-stored. No vector DB and no new dependencies.

### 14.1 Files

1. `.shakefix/memory/cases/<iid>.json` (`shakefix.case/v1`): rids, route, testids, symptom (note, expectation,
   top console error), root_cause {file, line, summary, pattern}, fix {files, lines_changed, mr, attempts},
   second_opinion {intended, unintended, blocked_changes[]}, reporter_verdicts, time_to_fix_s, timestamps.
2. `.shakefix/memory/lessons.md`: append-only "Never ..." / "Always ..." lessons with source
   (second-opinion-block | reporter-rejected | reoperation | attending-concern), files, patterns and case.
3. `.shakefix/memory/index.json` (generated): cases[], lessons[], hotspots[], stats (repeat-bug vs
   first-time median time to fix). The ER Board reads it.
4. The old `.shakefix/ledger/` stays for compatibility (`ledger_stamp` is a no-op when it is empty).
   Agents no longer write it.

### 14.2 Code

1. `packages/core/src/memory`: `recall()` (route match, testid Jaccard, TF-IDF cosine, file overlap; top 3
   with score and reasons), `premortem()` (risk low/med/high, history, lessons, autonomy; high risk ->
   supervised + policy hit `memory:high-risk`), `recordCase()`, `addLesson()`, `rebuildIndex()`.
2. CLI `node packages/core/bin/shakefix-memory.js recall|premortem|lessons|rebuild-index|add-lesson|record-case`, JSON out.
3. Writers: `scripts/memory/record-case.mjs merged` (from `scripts/ci/close-issue.sh`),
   `record-case.mjs proof` (from `scripts/ci/proof-gate.sh`), intake verdict hook on 👎
   (`services/intake/src/memory.js`). All commit with `[skip ci]` and never fail CI.

### 14.3 Use

1. The Triage Nurse runs `premortem` and writes "Seen before: #N (score, why)" + risk into `triage.json`
   and an issue note.
2. The Surgeon must read the lessons for the files it edits before editing, and reuse a matching case's
   root cause ("family fix"). It records the case draft with `record-case`.
3. The Attending flags lesson violations and adds `memory:high-risk` on high risk.
4. The Discharge chart gets a **History** row and a cited **Evidence** row (replay step timestamps, top
   console error, regression test, Second Opinion summary).
5. **Video moment:** the second shake of the settle rounding bug: "Seen before #4", with its time to fix measured against #4's first-time 447 s.

---

## 15. Component J: Policy and governance

### 15.1 `.shakefix/policy.yml`

```yaml
version: 1
autonomy_default: hands-off          # hands-off | supervised | assisted
rules:
  - match: "apps/splitpal/src/auth/**"
    autonomy: supervised             # MR opens; human must approve; no auto-merge
    reason: "Authentication changes always need a human."
  - match: "infra/**"
    autonomy: assisted               # agents propose only; no commits
  - match: "**/*.sql"
    autonomy: supervised
limits:
  max_files_changed: 5
  max_lines_changed: 60
  forbid_new_dependencies: true
proof:
  block_on_unintended: true
  max_reoperations: 1
```

### 15.2 Enforcement layers (belt and braces)

1. The Attending agent reads the policy and reports `policy_hits`.
2. The `proof-gate.sh` and `merge.sh` scripts re-check the diff against the policy deterministically (`minimatch`) and refuse to merge on a hit.
3. GitLab **CODEOWNERS** plus "Require code owner approval" on `main` for `auth/**`. This is platform-enforced.
4. Protected branches and `Pipelines must succeed`.

**Done when:** the B4 fix opens an MR that sits in "waiting for approval" with `needs-human` and is never merged automatically.

---

## 16. Component K: ER Board dashboard

A static site in `dashboard/` (Vite + vanilla TS), deployed to GitLab Pages, reading data at build time plus live from `INTAKE_URL/v1/board` (public, read-only, no PII).

1. **Columns:** Triage (incl. reopened) → Surgery → Second Opinion → Recovery (deploying) → Discharged → **Verified** (the reporter confirmed), plus Needs human.
2. **Card:** `#iid`, title, sev chip, elapsed time, MR link, Second Opinion summary (`2✓ 0✗`), reporter verdict chip (👍 verified / 👎 still broken).
3. **Headline metrics:**
   - **median shake-to-fixed time** and the last one,
   - % hands-off vs escalated,
   - unintended changes caught by Second Opinion,
   - **% fixes confirmed by reporter** (👍 out of all verdicts, with 👍 / 👎 / awaiting counts),
   - rollbacks.
4. **Ledger panel:** recurring patterns with counts.
5. **Style:** match the Second Opinion video (ink-black ground, fire-orange accent, Barlow + IBM Plex Mono).

**Done when:** the Pages URL shows live cards updating during a run (refresh every 5s).

---

## 17. Component L: Reporter notification

1. At report time the PWA asks "Notify me when fixed?" → `PushManager.subscribe({applicationServerKey: VAPID_PUBLIC_KEY})` → the subscription is sent with the report.
2. `notify.sh` (main pipeline after the smoke test passes) → `POST INTAKE_URL/v1/reports/:rid/fixed` (HMAC with `INTAKE_HOOK_SECRET`) → the intake sends Web Push: **"Fixed ✓ — the bug you reported is gone. Pull to refresh."** with the URL `/bill/:id`.
3. Polling fallback (if push is unavailable or the licence question goes against us): the SW polls `/v1/reports/:rid/status` every 20s while open and shows a Notification when the state is `deployed`.
4. iOS: Web Push works only for PWAs **added to the Home Screen** (iOS 16.4+). For the video, use Android Chrome or an installed iOS PWA.
5. **The patient's verdict (reporter verdict loop).** "Fixed" is a claim; the reporter confirms it.
   1. **Notification:** the "Fixed ✓" notification carries actions `[{action:'yes',title:'👍 Fixed'},{action:'no',title:'👎 Still broken'}]` and data `{rid, url, verdictUrl, deviceId}`. In the SW `notificationclick`: **yes** → `fetch(verdictUrl, {verdict:'confirmed', deviceId})` directly (falls back to opening `?shakefix_verdict=yes&rid=<rid>`); **no** → open `<url>?shakefix_verdict=no&rid=<rid>`; a plain tap → `<url>?shakefix_verdict=ask&rid=<rid>`.
   2. **SDK sheet:** on push-click landing (`?shakefix_verdict=…`) and on the poll fallback, after the Fixed toast the SDK shows "Fixed ✓ — is it working for you now?" with **👍 Yes, fixed** and **👎 Still broken**. 👍 posts `{verdict:"confirmed"}`; 👎 opens the normal reporter sheet pre-filled with "Still broken after fix" and posts `{verdict:"rejected", replay}` (the fresh replay) to `<endpoint-base>/v1/reports/:rid/verdict`. Hidden under `navigator.webdriver` like the rest of the auto UI; `window.ShakeFix.askVerdict(rid)` shows it on demand for tests.
   3. **Intake:** `POST /v1/reports/:rid/verdict` (public, CORS allowlist, rate limited, zod). **confirmed** → issue note "✅ Verified by the reporter — the patient confirms the fix.", label `shakefix::verified`, state `verified`, `verifiedAt`. **rejected** → commit `reports/<rid>/replay-<n>.json` (`[skip ci]`), reopen the issue, note "👎 The reporter says it's still broken — new replay attached; back to triage." with the replay inline, remove `shakefix::deployed` (and every other state label), add `shakefix::reopened`, then post `@<FLOW_SERVICE_ACCOUNT> re-triage: reporter rejected the fix, see latest replay` **with the human PAT** so the Mention trigger fires. One verdict per fix round per device id (or per rid); duplicates are ignored.
   4. **Board:** `/v1/board` items carry `verdict` and `verdicts`; the ER Board shows a Verified column, 👍/👎 chips and "% fixes confirmed by reporter".

**Done when:** the phone shows the notification within 10s of the prod smoke test passing, and both 👍 (issue gets `shakefix::verified`) and 👎 (issue reopens and the flow re-triages from `replay-2.json`) work end to end.

---

## 18. Component M: Sustainability (SCI), optional prize

1. **SCI formula:** `SCI = ((E × I) + M) per R`, where R = one fixed bug.
2. **E (energy):**
   - CI job minutes × runner power estimate (document the assumption, e.g. 2 vCPU × 10W/vCPU),
   - plus Cloud Run CPU-seconds from the logs,
   - plus LLM tokens × a published Wh/1k-token estimate. Cite the source and mark it as an estimate.
3. **I (grid intensity):** the Electricity Maps or WattTime average for the region (static value, cited, with date).
4. **M (embodied):** amortised per GCP docs, or state it as excluded with a reason.
5. **Optimisations to quantify:**
   - deterministic pre-rules cut LLM tokens by X%,
   - Second Opinion replays only affected flows (route-scoped) vs all flows,
   - pipeline `rules:`/`needs:` skip unaffected jobs,
   - Cloud Run min-instances 0.
6. **Output:** one row per fix in the MR chart ("≈ n gCO₂e per fix") plus `docs/sci.md` with the method, sources and before/after numbers.

Only opt in on the form if real numbers exist.

---

## 19. Testing plan

### 19.1 Unit (vitest)

| Area | Tests |
|---|---|
| SDK shake | jolt maths, 3 hits/1s threshold, permission path mocked |
| SDK recorder | ring buffer size, masking, selector priority (testid > id > css path) |
| Intake | zod validation, scrub, dedupe hash, issue body render, rate limit, verdict endpoint (confirm / reject / idempotency / labels) |
| SDK verdict | 👍 / 👎 sheet, re-report pre-fill, landing params, notification actions |
| Service worker | verdict actions, 👍 direct post, 👎 / tap landing URLs |
| Replay converter | replay.json → spec code snapshot test; expectation mapping |
| Second Opinion diff | screen/API/DB diff fixtures, volatile-key removal, id normalisation |
| Second Opinion gate | label combos → exit codes |
| Policy | minimatch rules, limits |

### 19.2 Integration

1. Intake → GitLab sandbox project: issue created with the right labels and body.
2. Second Opinion against two local servers (base = buggy, head = fixed) → expected `proof.json`.

### 19.3 E2E baseline flows (`tests/e2e/*.flow.json`)

1. `create-bill`
2. `split-3-way` (@smoke)
3. `change-tip`
4. `change-currency`
5. `settle` (@smoke)
6. `settings-shake-toggle`

### 19.4 Full-loop rehearsals (counted for the pipeline history)

| # | Scenario | Expected result |
|---|---|---|
| 1 | B2 empty-name crash | hands-off → deployed → push |
| 2 | B3 currency symbol | hands-off → deployed |
| 3 | B1 naive fix | Second Opinion blocks (1 unintended) → re-operation → deployed |
| 4 | B4 auth | needs-human, not merged |
| 5 | Not reproducible (fake report) | needs-info chart |
| 6 | Duplicate shake | +1 comment, no new flow |
| 7 | Bad fix forced (manual) | smoke fails → rollback |
| 8 | Reporter confirms (👍 on the "Fixed ✓" notification or sheet) | `shakefix::verified`, "✅ Verified by the reporter" note, card in **Verified**, confirmed % rises |
| 9 | Reporter rejects (👎 → re-report "Still broken after fix") | issue reopened, `reports/<rid>/replay-2.json` committed, `shakefix::reopened`, re-triage mention → flow runs again → deployed → ask again |

Run each **at least once**, and B1–B3 several times, giving **10+ pipelines**.

### 19.5 Device matrix

Android Chrome (shake), iOS Safari (permission chip plus bubble), desktop Chrome (hotkey plus bubble).

### 19.6 Licence audit

`npx license-checker --summary`. Only MIT, ISC, BSD and Apache-2.0 (and MPL only if confirmed in Discord).

---

## 20. Submission checklist

Tick every box before Oct 26 23:59 IST (leave a buffer before the 13:00 UTC Oct 27 lock).

**Repo**
- [ ] `shakefix` is public, and the About section shows **MIT License**
- [ ] README per §23, with the architecture diagram image and setup steps that work from scratch
- [ ] All source: sdk, intake, replay, proof, flow YAML, agent-config, CI, infra, dashboard, demo app
- [ ] No secrets in the repo (secret detection pipeline green)
- [ ] Pipeline history: **10+ runs** showing MR → Second Opinion → merge → deploy → notify; 1 Second Opinion block; 1 rollback; 1 needs-human
- [ ] Duo Sessions visible for the flow runs (screenshots in `docs/`)
- [ ] Ledger has 3+ entries
- [ ] Commits signed off (`-s`) for DCO

**Live**
- [ ] SplitPal prod URL on Cloud Run works on a phone
- [ ] Intake routed to **`shakefix-live`** (from Oct 26)
- [ ] ER Board Pages URL live
- [ ] Budget alert set and min-instances 0

**Video**
- [ ] Under 3:00, YouTube **Public**
- [ ] Shake happens in the first 15s, the full loop is shown, and the Second Opinion block moment is shown
- [ ] Names "GitLab Duo Agent Platform", "custom flow", "Claude" and "Google Cloud Run" out loud or on screen
- [ ] No third-party trademarks or copyrighted music

**Devpost form**
- [ ] Path A · category **Hands-off**
- [ ] Text per §22
- [ ] GitLab project URL, video URL, GCP live link (bonus)
- [ ] Environmental opt-in **only** if §18 is done
- [ ] Team members added

**After submit**
- [ ] Don't touch `shakefix` until Nov 16. Keep the Cloud Run services and `shakefix-live` running.

---

## 21. Demo video script

Target 2:50. Screen-record the phone (scrcpy for Android) next to the GitLab UI. Silent or royalty-free audio, with captions on screen.

| Time | Picture | Caption / voice |
|---|---|---|
| 0:00–0:12 | Phone: SplitPal, ₹1000 split 3 ways, tap Settle → nothing. A **3:00 timer** starts in the corner. User shakes the phone. | "It's 11pm. Your app is broken. Your devs are asleep." |
| 0:12–0:30 | Reporter sheet → "Notify me when fixed ✓" → Send. GitLab: issue appears with screenshot + replay. ER Board card enters **Triage**. | "Shake. That's the whole bug report." |
| 0:30–0:55 | Duo Session: Triage Nurse writes `issue-12.spec.ts`; Playwright run shows **red**. | "Your bug report *is* the test." |
| 0:55–1:20 | Surgeon diff (2 lines), tests **green**, Attending JSON card, MR opens with the **Patient Chart**. | "Four agents on GitLab Duo, running Claude." |
| 1:20–1:50 | Pipeline: SAST ✓ → preview revision on Cloud Run → **Second Opinion** report: **1 unintended ✗ (₹49.99 → ₹50.00 on another bill)** → blocked → sent back to surgery → re-run → **0 unintended ✓**. | "The fix is AI code too. Second Opinion checks what it actually changed." |
| 1:50–2:10 | Auto-merge → deploy prod → smoke ✓ → **phone buzzes: "Fixed ✓"** → user pulls to refresh → Settled banner. Timer stops at about 2:4x. | — |
| 2:10–2:30 | Governance: B4 `auth/` fix → MR waits for human approval (`needs-human`). Quick cut: a forced bad deploy → smoke ✗ → **auto-rollback**. | "It knows when to stop." |
| 2:30–2:50 | ER Board metrics, 9 stages lit, Ledger "family fixed", logos as text only (no trademarks), repo URL. | "Users report bugs. Agents fix them. Second Opinion makes sure the fix didn't break anything else." |

**Recording tips:**
1. Pre-warm Cloud Run (min instances 1 during recording only).
2. Run the take 5 times and keep the best.
3. If the real loop takes more than 3 minutes, show the real timer and cut idle waiting with a visible "⏩ 40s" label. Honesty matters.

---

## 22. Devpost text template

```markdown
## Inspiration
Users don't file bug reports — they leave. Developers lose hours on "cannot reproduce". And when an AI agent does fix something, who checks the fix?

## What it does
ShakeFix turns a phone shake into a production fix:
1. Shake → screenshot, console, and the user's last 30 actions are captured.
2. A GitLab issue is created and a **GitLab Duo custom flow** wakes four ER agents (Triage Nurse, Surgeon, Attending, Discharge) running Claude.
3. The replay becomes a **failing Playwright test**, the Surgeon makes the minimal fix, the Attending reviews it against our policy.
4. **Second Opinion** deploys main and the fix side by side on Cloud Run, replays real flows, and diffs screens, API responses and DB writes. Unintended changes block the merge and send the fix back to surgery.
5. Clean → auto-merge → deploy → smoke test → the reporter's phone buzzes "Fixed".
Risky paths (auth) automatically drop to Supervised and wait for a human.

## How we built it
GitLab Duo Agent Platform (custom flow, triggers, sessions), GitLab CI/CD with SAST/dependency/secret scanning, Google Cloud Run (tagged revisions + traffic shifting), Workload Identity Federation (no keys), Firestore, Playwright, TypeScript.

## DevSecOps stages covered (9/9)
Plan · Create · Verify · Package · Secure · Release · Configure · Monitor · Govern — table in README.

## Challenges
Triggers require a human actor; flows can't read attachments; sandboxed network for Playwright; deterministic Second Opinion diffs.

## Accomplishments
Median shake-to-fixed time: __ min. Second Opinion caught __ unintended changes across __ runs.

## What's next
GitHub support, native iOS/Android SDKs, Second Opinion as a standalone PR check for any AI-written change.
```

---

## 23. README template

1. **Title + one-line pitch + 20s GIF** (shake → fixed)
2. **Live links:** demo app, ER Board, `shakefix-live` playground, video
3. **How it works:** architecture image (`docs/architecture.png`) plus the 5-step list
4. **The ER team:** a table of 4 agents with their tools and outputs
5. **Second Opinion:** what it diffs, a sample report
6. **9 stages table** (§3.3)
7. **Autonomy and policy:** `policy.yml` explained
8. **Setup from scratch:** GCP Terraform, GitLab settings (§9), CI variables, flow + trigger creation, intake deploy
9. **Run the demo locally:** `pnpm i && pnpm dev`
10. **Limits (honest):**
    - triggers need a human PAT,
    - the labeler uses the direct Claude API,
    - the trial expiry note,
    - iOS push needs an installed PWA,
    - SCI numbers are estimates.
11. **Licence:** MIT and DCO

---

## 24. Schedule

| Date | Goal | Done when |
|---|---|---|
| **Sat Oct 10 (today)** | Spikes S0–S2 plus scaffold, demo app with seeded bugs, SDK, intake | A shake creates an issue, and the flow starts on a trigger |
| **Sun Oct 11** | Flow produces an MR with a red→green spec. CI: test, secure, build, preview | The B2 fix reaches an MR with a green pipeline to preview |
| Mon Oct 12 – Tue Oct 13 | Second Opinion engine (capture plus diff) | B1 naive fix shows 1 unintended |
| Wed Oct 14 | Second Opinion labeler, gate, re-operation loop | B1 is fixed on the second pass automatically |
| Thu Oct 15 | Merge → prod → smoke → rollback → notify. **Discord office hours 19:00 UTC** (ask about licences and triggers) | Phone buzzes "Fixed" |
| Fri Oct 16 | Policy plus CODEOWNERS (B4), Ledger, dedupe | The B4 MR waits for a human |
| Sat Oct 17 – Sun Oct 18 | ER Board, Terraform clean apply, README, tests | Everything reproducible from scratch |
| Mon Oct 19 – Tue Oct 20 | 10+ full-loop runs, bug fixes. **Office hours Oct 20 10:00 UTC** | Pipeline history is full |
| Wed Oct 21 – Thu Oct 22 | SCI (optional), AI Catalog publish (optional), polish | — |
| Fri Oct 23 – Sat Oct 24 | Record and edit the video. Devpost draft | Video under 3:00 uploaded unlisted |
| Sun Oct 25 | Full submission dry-run against §20 | All boxes ticked |
| **Mon Oct 26** | Create `shakefix-live`, switch the intake, set the video **Public**, **submit** | Devpost shows submitted |
| Tue Oct 27 13:00 UTC | Deadline (buffer day) | — |

---

## 25. Risks, spikes and fallbacks

| ID | Spike / risk | How to test (first thing) | Fallback |
|---|---|---|---|
| **S0** | Custom flow YAML validates and runs | Minimal 1-agent flow that comments "hello" on an issue | Simplify the schema, and ask in Discord |
| **S1** | An issue created with a **personal PAT** fires the "Work item created" trigger | Create an issue via curl with the PAT and watch for the flow session | Direct start via the workflows API (§10.7 A), or human tap (§10.7 B) → Supervised |
| **S1b** | A PAT-posted mention fires the Mention trigger (re-operation) | Post `@ai-shakefix-…` via the API | Re-operate by having CI open a new issue "Re-operate !42" via the PAT |
| **S2** | Playwright and npm run inside the flow sandbox | Flow agent runs `npx playwright test` on a trivial spec | Custom image in agent-config (no network policy), or the Triage Nurse writes the spec and **CI** runs it (agent reads the CI result via `get_pipeline_failing_jobs`) |
| **S3** | Claude API from CI for the Second Opinion labeler | One job calling the API | Deterministic rules only (§11.6 C) |
| S4 | Hosted runners support the flow sandbox | Covered by S0 | Ask in Discord. Use a self-hosted runner on a GCE e2-small (free tier) |
| S5 | Credits run out (trial / service account billing) | Check usage after S0 | Move to the hackathon subgroup when it's provisioned, and keep flows short (max_cycles) |
| S6 | Trial expires about Nov 9 | — | Recorded runs plus the README note; the hackathon subgroup if granted |
| S7 | Repo freeze broken by live shakes | — | `shakefix-live` routing (§8.5) |
| S8 | Flow too slow for the video | Time S0–S2 | Show the real timer with labelled cuts |
| S9 | iOS motion permission or push friction | Device test | Bubble plus Android for the hero shot |

**Rule:** if a spike fails twice, take the fallback immediately. Don't burn more than 2 hours on a spike.

---

## 26. Security and privacy

1. **No real user data.** SplitPal uses seed data only. Mask inputs by default, and use the allowlist only for numeric demo fields.
2. Keep the **human PAT** only in Secret Manager, read by the intake at runtime. Use the minimum scope (`api`) and **rotate it after judging**.
3. CI uses WIF, so there are no GCP keys. CI variables are masked and protected.
4. Intake protections:
   - CORS allowlist and rate limits,
   - size caps,
   - zod validation,
   - an HMAC-verified webhook.
5. Flow sandbox: keep the default network policy plus only the needed domains, and give each agent a tool allowlist.
6. Policy blocks auto-merge on sensitive paths. CODEOWNERS enforces it at the platform level.
7. The README states clearly: "ShakeFix opens and merges code automatically only within policy limits. Never point it at production systems you don't own."

---

## 27. Glossary

| Term | Meaning |
|---|---|
| Replay | JSON of the user's last actions captured by the SDK |
| Regression spec | A Playwright test generated from the replay that must fail before the fix and pass after |
| Second Opinion | The behavior-diff engine comparing main vs branch on screens, APIs and DB writes |
| Patient Chart | The standard comment format all agents use |
| Ledger | Repo-stored memory of past root causes, used to fix bug "families" |
| Hands-off / Supervised / Assisted | Hackathon autonomy levels. ShakeFix switches automatically via policy |
| Re-operation | A second surgeon pass triggered by a Second Opinion block (max 1) |
