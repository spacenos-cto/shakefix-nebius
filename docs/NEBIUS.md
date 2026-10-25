# ShakeFix on Nebius Token Factory + NVIDIA Nemotron

> Submission for the **Nebius x NVIDIA Global AI Hackathon** (submission period Aug 26 – Oct 30 2026).
> Track: **Coding & Agentic Workflows.** License: MIT (see [`LICENSE`](../LICENSE)).

ShakeFix is an autonomous bug-fixing pipeline: an end user shakes their phone, AI agents reproduce the
bug, write the smallest fix, a separate **Second Opinion** reviewer verifies the fix changed nothing it
shouldn't, and production ships — the case closes only when the person who reported it says it's fixed.
Full product: [`README.md`](../README.md).

This repository runs ShakeFix's two reasoning-heavy modules on **Nebius Token Factory** with an **NVIDIA
Nemotron** open model, through live `/v1/chat/completions` calls.

## Where Nemotron does a real job

| Module | What Nemotron decides | Why it's a real job (not a wrapper) |
|---|---|---|
| **Second Opinion labeler** (`packages/proof/src/label.js`) | For every behavior change a fix caused (screen text, API field, DB write), is it **intended** (part of the reported fix) or an **unintended** side effect? | It gates auto-merge. Deterministic rules label first; Nemotron can only make a verdict **stricter** (intended → unintended), never clear a flagged change. A model that waves through a side effect can't ship a bad fix — it can only force a human review. |
| **ER agent roles** (`packages/core`, local runner) | Triage Nurse writes a failing regression test from the reporter's replay; Surgeon writes the smallest fix; Attending reviews against policy; Discharge writes the plain-English summary. | These are the agents that actually read the repo, write code and open the MR/PR. `MODEL_PROVIDER=openai-compatible` points all four at Nemotron. |

Nemotron is a **reasoning** model, so it emits a `<think>…</think>` block before its answer. The labeler
strips that block and extracts the JSON from the rest, so the reasoning helps the verdict without breaking
the parser (`stripThink` + `extractJson` in `label.js`). `PROOF_RESPONSE_FORMAT=json_schema` additionally
asks Token Factory to constrain the output to the labels schema (`LABELS_RESPONSE_FORMAT`).

Hackathon guidance — "Ultra for reasoning, Nano/Super for fast calls" — maps cleanly:
`nvidia/Nemotron-3-Ultra-550b-a55b` for the Second Opinion verdict (judgement), a faster
`nvidia/nemotron-3-super-120b-a12b` / `nvidia/Nemotron-3_5-Lightning` for the chattier agent turns.
Confirm the exact ids your key serves with `node scripts/nebius/second-opinion.mjs --list-models`.

## The significant update made during the submission period

ShakeFix existed before this window as a GitLab + GitLab-Duo project. The update made **during the Nebius
submission period** (Oct 25 2026) is the Nebius integration itself:

1. **Live Token Factory client for the Second Opinion reviewer.** `MODEL_PROVIDER=openai-compatible` now
   drives the verdict through `https://api.tokenfactory.nebius.com/v1/chat/completions` with a Nemotron
   model. Previously the only non-rules labeler was Claude.
2. **Reasoning-model handling.** New `stripThink()` + tolerant JSON extraction so Nemotron's `<think>`
   output is parsed, not dropped to the rules fallback (`packages/proof/src/label.js`).
3. **Structured output.** New `response_format` support in the OpenAI-compatible provider
   (`packages/core/src/model/index.js`) and a labels JSON schema, opt-in via `PROOF_RESPONSE_FORMAT`.
4. **Nemotron for the four ER agent roles** via the local runner (`MODEL_PROVIDER` flows through
   `modelFromEnv`), so the agents that write the fix run on Token Factory too.
5. **A live demo entry point** — [`scripts/nebius/second-opinion.mjs`](../scripts/nebius/second-opinion.mjs)
   — that makes one real Nemotron call on a real behavior-diff and prints each verdict.

Tests covering the new paths: `packages/proof/test/providers.test.js` (Token Factory URL, `<think>`
parsing, `response_format`), `packages/proof/test/label.test.js` (`stripThink`), and
`packages/core/test/model.test.js`.

## Run the live call yourself

You need a Nebius Token Factory API key (free tier is enough for the Second Opinion call).

```bash
corepack pnpm install
export MODEL_PROVIDER=openai-compatible
export MODEL_BASE_URL=https://api.tokenfactory.nebius.com/v1
export MODEL_API_KEY=<your Token Factory key>     # never committed; keep it in your shell
node scripts/nebius/second-opinion.mjs --list-models          # find the Nemotron id your key serves
export MODEL_NAME=nvidia/Nemotron-3-Ultra-550b-a55b           # one id from the list above
export PROOF_RESPONSE_FORMAT=json_schema                       # optional
node scripts/nebius/second-opinion.mjs                         # one live Nemotron verdict on a real case
```

Expected: the double-charge fixture (SplitPal) shows the untouched bill's cent change labeled
**unintended** and the reported-bug changes **intended**, ending with `✓ labeled by Nemotron on Nebius`.
Full setup for the agent roles and CI: [`docs/PROVIDERS.md`](PROVIDERS.md).

## Video (≥ 1 minute of the key modules running)

1. **The problem (10s).** Margaret shakes her phone; one shake is the whole bug report.
2. **Agents run (20s).** The ER roles — on Nemotron — reproduce the bug and write the fix.
3. **Second Opinion live on Nebius (30s+).** Run `scripts/nebius/second-opinion.mjs` on camera: show the
   endpoint `api.tokenfactory.nebius.com`, the Nemotron model id, the per-change verdicts, and the final
   `✓ labeled by Nemotron on Nebius` with the latency. This is the key module, running live.
4. **The gate (15s).** The unintended change holds the merge for a human; a clean fix merges itself and the
   reporter's 👍 closes the case.

## Honest notes

- Deterministic rules decide first; Nemotron can only tighten a verdict, never loosen it. That's the design,
  not a limitation — an LLM should not be able to clear its own side effects.
- The built-in demo case is one real behavior-diff fixture. The 12-control-MR benchmark
  ([`controls/RESULTS.md`](../controls/RESULTS.md)) was run on the original GitLab pipeline; re-running it
  live on Nemotron is a `--proof <path>` loop over each control's `proof.json`.
- Model ids and the exact base URL come from the Token Factory console for your key; `--list-models`
  prints what you actually have.
