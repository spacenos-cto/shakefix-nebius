# Blast Radius

When a bug report (replay) arrives, or an MR changes files, ShakeFix answers: **what does this touch, and who used it?**

The output is a Markdown section, `### 💥 Blast Radius`, containing:

- a one-line headline, for example: "This bug touches `/rx/:id/refill` · `pay-btn` · **902 patients** in the last 30 days (synthetic demo population)"
- a table: route, component, view module, code paths (up to 3 hops), API endpoints, changed functions, patients, category, graph source
- an exposure line (see the formulas below) and a qualitative legal line
- a `mermaid graph LR` diagram: user action → route → view module → lib/API functions → API endpoint → server helpers

Code: `packages/core/src/blast/`. CLI: `packages/core/bin/shakefix-blast.js`. Tests: `packages/core/test/blast.test.js`.

## How it works

| Step | File | What it does |
|---|---|---|
| Routes | `routes.js` | Reads the SPA `routes` array in `apps/carerx/src/main.js` (regex → `/rx/:id/refill` → view module). Also reads Express `api.get/post/patch/...` calls, applying the `app.use('/api', api)` prefix. Records which `data-testid`s each view renders (template testids such as `rx-row-${id}` become `rx-row-*`). |
| Graph | `graph.js`, `module.js`, `source.js` | Builds a static import/call graph over `apps/carerx` with no parser dependency. It masks strings and comments, then resolves references through ESM imports. Nodes are functions, arrow consts, object methods (`api.refill`) and Express route handlers. It also adds an `http` edge from a client function that holds an `/api/...` literal to the matching server route. |
| Walk | `graph.js` | **Replay:** route + testids → view → forward walk, up to 3 hops. The tapped element's handler is followed into nested functions (`pay-btn` → `pay()` → `api.refill`), so the endpoint the action actually fires is marked. **Changed files:** changed functions → reverse walk (callers), up to 3 hops → views → client routes, and → server routes. |
| Orbit | `orbit.js` | Optional. See below. |
| Patients | `affected.js` | `GET {APP_URL}/api/insights/affected?route=&component=&segment=`. If there is no URL, or the request fails: `patients: "unknown"`. |
| Exposure | `exposure.js` | Picks a category from the note, testids and files, then applies that category's formula. |
| Render | `render.js` | Writes the Markdown and Mermaid. Labels are always quoted, and `" ( ) < > # \`` are entity-escaped for GitLab's renderer. The output is deterministic, with no timestamps. |

## Orbit vs static

- `source: "static"` (the default) uses our own graph (`graph.js`). It always works offline.
- `source: "orbit"` is used when `GITLAB_URL` (or `CI_SERVER_URL`), `ORBIT_TOKEN` (falling back to `GITLAB_TOKEN`) and `ORBIT_PROJECT_ID` (falling back to `CI_PROJECT_ID`) are all set. The CLI then sends a `POST {GITLAB_URL}/api/v4/orbit/query` with a `CALLS` traversal, `hops: [1, 3]`. It asks for callers of the changed definitions and callees of the touched view (query shape: `docs/ORBIT-NOTES.md` §4a). Orbit edges are merged into the static graph.
- If Orbit returns non-200 (our group is not indexed yet: 404), 0 rows, or anything unparseable, the CLI **silently falls back** to static, and the report says `static import/call graph`. Pass `--no-orbit` (or set `SHAKEFIX_BLAST_ORBIT=0`) to skip it entirely.
- Orbit has no route/endpoint entity, so routes always come from `routes.js` (ORBIT-NOTES §4b, "Exact").

## Exposure categories

| Category | Detected from | Insights segment | Formula |
|---|---|---|---|
| billing | charge, twice, copay, pay, refund…; `pay-btn` | – | affected refills × avg copay = possible duplicate charges (upper bound) |
| accessibility | screen reader, VoiceOver, keyboard, focus, label… | `screen-reader` | patients in the screen-reader segment who used the route/component |
| privacy | privacy, share, health data, consent…; `privacy-*` | – | patients who used the privacy control |
| medication-info | dose, strength, mg/mcg…; files under `dosing/` | – | patients who saw the medication info |
| general | anything else | – | patients who used the route/component |

Override the detected category with `--category` and the segment with `--segment`.

## How to call it

The Triage agent (Triage Nurse, after reproducing; `run_command`) writes the section into the issue/MR description or note:

```shell
node packages/core/bin/shakefix-blast.js --replay reports/<rid>/replay.json --app-url "$APP_URL" --out .shakefix/tmp/blast.md
```

For the triage JSON (feeds the plan and the Attending), use:

```shell
node packages/core/bin/shakefix-blast.js --replay reports/<rid>/replay.json --app-url "$APP_URL" --json --out .shakefix/tmp/blast.json
```

CI on a merge request uses the changed files (plus the replay when the MR is a ShakeFix fix):

```shell
FILES=$(git diff --name-only "$CI_MERGE_REQUEST_DIFF_BASE_SHA"...HEAD -- apps/carerx | paste -sd, -)
node packages/core/bin/shakefix-blast.js --files "$FILES" --app-url "$APP_URL" --out blast-radius.md
# ShakeFix MR (branch shakefix/<iid>-...): add --replay reports/<rid>/replay.json
```

Post `blast-radius.md` as one MR note. Upsert it by the hidden marker `<!-- shakefix:blast-radius -->` at the top of the output. GitLab renders the ```` ```mermaid ```` block natively. Orbit env vars (`ORBIT_TOKEN`, masked + protected) are optional.

Offline (no `--app-url`/`APP_URL`), the CLI still prints the full report, with "patients unknown (offline: no APP_URL)".

Exit codes: `0` ok, `2` usage error (missing replay, missing app folder), `1` unexpected failure.

## Honesty notes

- **The population is synthetic.** CareRx is a demo app with no real patients. `/api/insights/affected` serves a seeded demo population (`synthetic: true`). Every patient number in the report says "synthetic demo population", and the footer repeats it.
- The billing figure (refills × avg copay) is an **upper bound** on a synthetic population. It is not a loss estimate.
- **Legal exposure is qualitative only.** No fines, no damages, no case law. `exposure.legal.sources` is always `[]`; a human adds verified citations (see the TODO in `exposure.js`). The tool never generates them.
- The static graph is a heuristic for vanilla ESM. It resolves same-file names and relative imports, and drops anything it cannot resolve. Dynamic dispatch and string-built URLs can be missed. Read it as "at least these paths", not "only these paths".
- Orbit indexes the default branch only, so on an MR it describes the pre-change graph. That is the right graph for "who calls what I changed".

`--links plain` draws edges as `---` instead of `-->`. Use it when the poster HTML-escapes `>` (the Duo note tool does); the CI MR job keeps arrows.
