# Software Carbon Intensity (SCI) of one fix

> **Status: method skeleton. Every number marked `TODO` is not measured yet.**
> We opt in to the Environmental prize only if every TODO below is replaced with a measured
> or cited value (BUILD_SPEC 18).

## 1. Functional unit

**R = one fixed bug**: one shake report that ends in a production deploy (state `deployed`).

SCI = ((E × I) + M) per R

## 2. Energy (E) per fix

| Component | How we measure | Value |
|---|---|---|
| CI job minutes | Sum of `duration` for every job in the MR pipeline and the main pipeline of the fix (GitLab API `/pipelines/:id/jobs`) | **TODO** min |
| Runner power | Assumption: hosted runner, 2 vCPU × 10 W/vCPU = 20 W (cite source, date) | **TODO** W (assumed) |
| CI energy | minutes × 60 × W / 3.6e6 | **TODO** kWh |
| Duo flow job minutes | Duration of the `gitlab--duo` job(s) for the session | **TODO** min |
| Cloud Run CPU-seconds | Cloud Monitoring `run.googleapis.com/container/cpu/allocation_time` for `splitpal` and `intake` during the fix window | **TODO** vCPU-s |
| Cloud Run energy | vCPU-s × **TODO** W/vCPU (cite) / 3.6e6 | **TODO** kWh |
| LLM tokens (flow) | Duo session token counts, if exposed; else estimate from the session log | **TODO** k tokens |
| LLM tokens (Second Opinion labeler) | Anthropic API `usage` from the `second_opinion` job log | **TODO** k tokens |
| LLM energy | tokens × **TODO** Wh/1k tokens (published estimate, cite, mark as estimate) | **TODO** kWh |
| **E total** | | **TODO** kWh |

## 3. Grid intensity (I)

| Region | Source | Value | Date |
|---|---|---|---|
| `asia-south1` (Mumbai) | Electricity Maps yearly average (cite URL) | **TODO** gCO₂e/kWh | **TODO** |
| `us-central1` (Iowa) | Google Cloud region carbon data (cite URL) | **TODO** gCO₂e/kWh | **TODO** |

## 4. Embodied emissions (M)

**TODO:** either amortise per the Google Cloud Carbon Footprint methodology, or state
"excluded: no per-request embodied data for shared cloud hardware" with that reason.

## 5. Result

| | Value |
|---|---|
| SCI per fix (baseline) | **TODO** gCO₂e |
| SCI per fix (optimised) | **TODO** gCO₂e |

The MR Patient Chart gets one line: `≈ TODO gCO₂e per fix`.

## 6. Optimisations to quantify (before → after)

| Optimisation | Where | Before | After |
|---|---|---|---|
| Deterministic pre-rules before the LLM labeler | `packages/proof` | **TODO** tokens/fix | **TODO** tokens/fix |
| Second Opinion replays only route-scoped flows | `packages/proof` | **TODO** flows/fix | **TODO** flows/fix |
| `rules: changes:` skip heavy jobs on docs/report commits | `.gitlab-ci.yml` | **TODO** job-min | **TODO** job-min |
| `[skip ci]` on intake replay commits | intake | 1 pipeline/report | 0 |
| Cloud Run `min_instance_count = 0` | `infra/cloudrun.tf` | **TODO** idle vCPU-h/day | 0 |

## 7. How to collect

```bash
# Job minutes for a pipeline
curl -s -H "PRIVATE-TOKEN: $TOKEN" "https://gitlab.com/api/v4/projects/$PID/pipelines/$PIPELINE/jobs?per_page=100" \
  | jq '[.[].duration] | add / 60'
```

## 8. Sources

- Green Software Foundation, SCI specification: https://sci.greensoftware.foundation/
- **TODO:** runner power source
- **TODO:** grid intensity source(s) with retrieval date
- **TODO:** LLM energy-per-token estimate source
