# scripts/nebius

Live Nebius Token Factory + NVIDIA Nemotron entry points for the Nebius x NVIDIA hackathon.
Overview and submission notes: [`docs/NEBIUS.md`](../../docs/NEBIUS.md).

## `second-opinion.mjs`

Makes **one live inference call** to Nebius Token Factory with a Nemotron model and runs ShakeFix's
Second Opinion labeler on a real base-vs-head behavior diff. Deterministic rules label every change
first; Nemotron can only make a verdict stricter (intended → unintended).

```bash
corepack pnpm install          # once

export MODEL_PROVIDER=openai-compatible
export MODEL_BASE_URL=https://api.tokenfactory.nebius.com/v1
export MODEL_API_KEY=<your Token Factory key>   # you create this; it is never printed or committed

# 1. see which Nemotron models your key serves
node scripts/nebius/second-opinion.mjs --list-models

# 2. pick one and run a live verdict on the built-in real fixture
export MODEL_NAME=nvidia/Nemotron-3-Ultra-550b-a55b
export PROOF_MAX_TOKENS=8000     # Nemotron reasons before answering; without headroom the reply is cut off
node scripts/nebius/second-opinion.mjs

# run it on any captured case instead of the fixture
node scripts/nebius/second-opinion.mjs --proof reports/<rid>/proof.json --issue reports/<rid>/issue.md
```

Exit codes: `0` labeled live by Nemotron · `1` fell back to deterministic rules (no live verdict —
check the model id and key) · `2` no model configured · `3` error.

### Config reference

| Variable | Value |
|---|---|
| `MODEL_PROVIDER` | `openai-compatible` |
| `MODEL_BASE_URL` | `https://api.tokenfactory.nebius.com/v1` (regional/dedicated: `https://api.tokenfactory.<region>.nebius.com/v1`) |
| `MODEL_NAME` | a Nemotron id from `--list-models`, e.g. `nvidia/Nemotron-3-Ultra-550b-a55b` |
| `MODEL_API_KEY` | your Nebius Token Factory key |
| `PROOF_MAX_TOKENS` | output budget; `8000` for Nemotron-Ultra (reasoning). Default 1500 |
| `PROOF_RESPONSE_FORMAT` | `json_object` or unset (tolerant parse). `json_schema` returns HTTP 422 on Nemotron-Ultra — use it only with a JSON-mode model like `openai/gpt-oss-120b` |
| `MODEL_TIMEOUT_MS` | optional, default 60000 |

The API key lives only in your shell / CI secrets. Do not commit it; `.env.nebius.example` has no real key.
