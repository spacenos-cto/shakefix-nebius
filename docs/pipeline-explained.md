# The ShakeFix Pipeline, Explained for Humans

> For anyone who has never done "devops" and just wants to understand what happens
> between *"I changed some code"* and *"users are now running it."*
> No prior CI/CD knowledge assumed. Read top to bottom once; keep it as a map.

---

## 0. The one-paragraph version

When code changes, a robot (the **pipeline**) runs a checklist before and after that
change reaches real users. The checklist catches the bugs, security holes, and
broken deploys that *would otherwise reach users at 2am*. If everything passes, the
robot ships it and tells everyone. If the live site breaks, the robot **undoes the
deploy by itself**. That's the whole thing. The rest of this doc is just naming the
items on the checklist.

---

## 1. "Why so much process? Startups just push, pull, deploy."

Fair. Here's the honest answer, because "best practice" is not a reason.

**"Push → pull → deploy" is not wrong. It's just missing the safety net.** Every
step in our pipeline exists because *someone, somewhere, shipped a Friday night and
regretted it.* Each step is literally "a specific disaster, prevented automatically."

| The disaster that happens without it | The step that prevents it |
|---|---|
| "It worked on my laptop, broke in prod" | Tests run on a clean machine, not yours |
| "We shipped an API key into a public repo" | Secret + dependency scans |
| "The fix for bug A silently broke feature B" | Second Opinion replays old flows |
| "The new deploy is down and we're all asleep" | Auto smoke-test + **auto rollback** |
| "Which version is even live right now?" | Every image tagged by commit |
| "Who approved this and why?" | The Ledger — a permanent record |

So the trade is simple:

1. **Raw push-pull-deploy** = faster today, and every bug is *your pager going off later.*
2. **A pipeline** = ~10 extra minutes per change, and the robot catches the bug *before*
   the user does. You trade a little speed now for not getting woken up.
3. **You don't have to do it all at once.** A one-person startup can start with just
   tests + deploy, and add scanning / rollback the first time something scary happens.
   The order below is also roughly the order you should *adopt* them.

**Rule of thumb:** add a pipeline step the day after something it would have caught
bites you. Never before, never much later.

---

## 2. The words, in plain English

You'll see these everywhere. Learn them once.

- **Commit** — one saved snapshot of your code, with a message. Like a save point.
- **Push** — upload your commits from your laptop to the shared server (GitLab).
- **Branch** — a private copy of the code you can mess with without touching `main`.
- **`main`** — the branch that represents "the real thing." What ships to users.
- **MR / Merge Request** (GitHub calls it a **PR / Pull Request**) — a formal proposal:
  *"please take my branch and fold it into `main`."* This is where review happens.
- **Merge** — accepting an MR: your branch's changes become part of `main`.
- **Pipeline** — the robot's checklist that runs automatically on a push or an MR.
- **Stage** — one phase of the checklist (e.g. "test"). Stages run in order.
- **Job** — one task inside a stage (e.g. "run unit tests"). Jobs in a stage run together.
- **CI** (Continuous Integration) — the "check my change is safe" half (stages 1–6 below).
- **CD** (Continuous Delivery/Deployment) — the "ship it and watch it" half (stages 7–11).
- **Artifact** — a file a job produces and hands to a later job (a report, a built app).
- **Image / container** — your app frozen into a sealed box that runs the same everywhere.
  Solves "works on my machine." Built once, run in prod unchanged.
- **Deploy** — put a new image live on the server (we use Google **Cloud Run**).
- **Traffic** — which version real users actually hit. You can deploy a version with
  **no traffic** (it's live but nobody's routed to it yet — perfect for testing).
- **Rollback** — point traffic back at the previous good version. The undo button.
- **Smoke test** — a tiny "is it even breathing?" check against the live site.

---

## 3. The hospital metaphor (why the jobs have weird names)

This repo treats a bug like a **patient moving through an ER**. That's not decoration —
it's the mental model that makes the pipeline easy to hold in your head:

- A user shakes their phone to report a bug → the patient **arrives** (Intake).
- The **Triage Nurse** writes down exactly how to reproduce it (a failing test).
- **Surgeons** (AI agents) operate — they write the fix.
- A **Second Opinion** doctor independently checks the fix didn't harm anything else.
- The patient is **discharged** (issue closed) and the visit is written in the **Ledger**.

Keep that story in mind; the job names below will click.

---

## 4. There are three kinds of pipeline run

The robot behaves differently depending on *what you did*. This is the single most
confusing thing for newcomers, so here it is up front:

1. **MR pipeline** — you opened a Merge Request. Goal: *prove this change is safe*
   **before** it's allowed into `main`. It builds a private preview and checks everything.
   **It does not touch production.**
2. **Main pipeline** — a change landed on `main`. Goal: *ship it to real users and watch it.*
   This is the one that actually deploys and can roll back.
3. **Tag pipeline** — you marked a release (a "tag"). Goal: optional publishing extras.
   Ignore this until you need it.

Same checklist file, three different paths through it. The file decides the path with
`rules:` (e.g. "only run deploy when the branch is `main`").

---

## 5. The MR pipeline, step by step

*Trigger: you open or update a Merge Request. Nothing here reaches users.*

1. **lint** — *"is the code tidy and the types sane?"* Catches typos and obvious
   mistakes in seconds, before wasting time on slower checks.
2. **test** — runs two things on a clean machine:
   - **unit** tests: do the small pieces work in isolation?
   - **regression** test: the *specific* failing test the Triage Nurse wrote for this
     bug. It **must go from failing → passing.** That's the proof the fix works.
3. **secure** — three automated scanners (GitLab provides them free):
   - **SAST**: reads your code for insecure patterns.
   - **Dependency scanning**: are any libraries you use known to be vulnerable?
   - **Secret detection**: did a password/API key sneak into the code? (It happens *constantly*.)
4. **build** — package the app into an **image** tagged with this commit's ID. From
   here on, every step uses this exact sealed box. No "works on my machine."
5. **preview** — deploy that image to Cloud Run **with no traffic**, under a private URL
   (`mr-<number>`). It's live and testable, but **no real user can reach it.** Auto-deleted
   after 3 days. This is the single biggest upgrade over raw push-pull-deploy:
   *you get to look at the real thing before anyone else does.*
6. **second_opinion** — the clever part. It replays the same user flows against the
   **old** version (base) and your **new** preview (head), then **diffs** them:
   - bug gone? ✅
   - anything that used to work now broken? ❌
   - It posts a report on the MR and applies a label: `shakefix::ready`,
     `send back to surgery`, or `needs-human`. A machine's opinion, kept honest by
     replaying reality rather than trusting the code.
7. **merge** — *only* if Second Opinion said `ready` **and** every earlier stage passed,
   a ShakeFix MR merges itself, hands-off. A human MR would be merged by a human here.

> If any check fails, the MR just sits there with a red mark. `main` is never touched.
> That is the entire point: **broken code physically cannot reach users** — it's blocked
> at the door, not cleaned up afterward.

---

## 6. The main pipeline, step by step

*Trigger: a change landed on `main` (usually because an MR merged). This one ships.*

1. **build** — rebuild the sealed image from `main` (same as before, now official).
2. **deploy** — put it live on Cloud Run. Two careful moves:
   - First it **writes down the current live version** (`PREV_REVISION`) — the thing it
     would roll back *to* if this goes wrong. Undo is prepared *before* the risky action.
   - Then it sends all traffic to the new version. Users are now on the new code.
3. **monitor** — immediately after shipping:
   - **post_deploy_smoke**: hit the live site. Is `/health` responding? Do the critical
     flows still work? This runs in **production, right now, on real infrastructure.**
   - **rollback**: *this job only runs if the smoke test failed.* It automatically points
     traffic back at `PREV_REVISION`. **The site heals itself without a human.** This is
     the step that lets you sleep.
4. **ledger** — the paperwork:
   - **notify_and_close**: tell the original reporter it's fixed, close the issue.
   - **ledger_stamp**: write a permanent line in the Ledger — what shipped, when, the proof.
     This is your "who/what/why" audit trail, free, forever.
5. **pages** — rebuild the public **ER Board** dashboard so anyone can watch the live state.

So the main pipeline is a loop with a seatbelt: **save the undo point → ship → check →
undo automatically if broken → record what happened.**

---

## 7. How to actually read the pipeline file

Open [`.gitlab-ci.yml`](../.gitlab-ci.yml). You now have everything to decode it:

- `stages: [...]` at the top — the checklist, in order. This is your table of contents.
- Each block like `lint:` or `deploy_prod:` is **one job**. Its `stage:` says where it sits.
- `script:` — the actual commands that job runs. This is "what it literally does."
- `rules:` — *when* this job runs (which of the three pipeline types). This is the single
  thing to check when a job "didn't run" — it was almost always a `rules:` mismatch.
- `needs:` — which earlier jobs must finish first. How jobs chain together.
- `.node`, `.gcp_auth` (the dotted ones) — reusable setup templates, so jobs don't repeat
  themselves. `extends:` pulls one in.
- `changes:` — an optimization: skip heavy jobs when only docs changed. Speed, not logic.

**Reading strategy:** don't read it top to bottom. Pick one job, read its `stage`,
`script`, and `rules`, and ignore the rest. Each job is independently understandable.

---

## 8. Two things that look scary but aren't

1. **No passwords anywhere.** Jobs talk to Google Cloud using **Workload Identity
   Federation** — GitLab proves its identity with a short-lived token instead of a stored
   key. Translation: *there is no secret JSON key file to leak.* The `.gcp_auth` template
   handles it; you never touch it.
2. **`[skip ci]`.** Some automated commits (the Ledger stamp) carry this tag so they don't
   trigger a pointless new pipeline about themselves. It prevents infinite loops. That's all.

---

## 9. The mental model to walk away with

```
   you push a branch ─► MR pipeline (CI): prove it's safe, never touches users
                              │  lint → test → scan → build → preview → second opinion
                              ▼
                        merge into main
                              │
   main pipeline (CD): ─► save undo point → deploy → smoke test
                              │                           │
                              │                     pass ─┴─► tell everyone + record
                              │                     fail ────► ROLL BACK automatically
                              ▼
                        users safely on new code
```

Everything else is detail. If you remember only one sentence:

> **The pipeline is a checklist that ships your code for you and quietly undoes the
> deploy if the live site breaks — so a bug becomes a red mark on a screen instead of
> a phone call at 2am.**

---

*See also: [`setup-gitlab.md`](setup-gitlab.md) for the variables this pipeline needs,
and [`architecture.mmd`](architecture.mmd) for how the services fit together.*
