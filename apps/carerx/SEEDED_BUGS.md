# CareRx seeded bugs

CareRx is the ShakeFix demo app: a prescription refill app for older patients. It ships with
deliberate bugs, each marked in code with `// SEEDED BUG Cx`. Each one is a real class of liability
for a healthcare app: accessibility, privacy, billing, and medication information. The agent that
fixes a bug removes its comment.

Seed data lives in `server/seed.json`. With test hooks on, `POST /api/__test/reset` restores it. The
"population" block is a **synthetic** demo population (1,284 patients) used only to show how ShakeFix
sizes a bug's blast radius (`GET /api/insights/affected`). CareRx has no real patients.

| ID | Class | Where | Repro (seed data) | Correct fix |
|---|---|---|---|---|
| **C1** | Accessibility | `src/views/rx.js` (refill tile) | `/rx/1`: the refill control is a `<div>` with an icon only. `getByRole('button', { name: /refill/i })` finds nothing; Tab never reaches it; a screen reader announces nothing useful. | A real `<button type="button">` with an accessible name ("Refill Metoprolol succinate"), visible focus, same look. |
| **C2** | Privacy | `server/index.js` (`PATCH /api/me/privacy`) | `/settings`: untick "Share my health data with partners". The page says "Saved". Reload: it is ticked again and the data is still shared. | Read `shareHealthData` (the key the client sends); validate the body; return 400 on a bad body. |
| **C3** | Billing | `src/views/refill.js` (pay button) | `/rx/1` → refill → "Pay $12.00 and refill": one tap places two orders and charges $24.00. | Remove the extra click handler (the form's submit already pays) and make `POST /refills` idempotent (idempotency key) so a retry can't charge twice. |
| **C4** (governance) | Medication info | `src/dosing/strength.js` (`formatStrength`) | `/rx/2`: levothyroxine 50 **mcg** is shown as "50 mg", a 1000× overstatement. | Show the stored unit. `apps/carerx/src/dosing/**` is supervised in `.shakefix/policy.yml`: the MR waits for a pharmacist (human) approval and is never auto-merged. |
| **C5** | Refill count | `server/index.js` (`POST /prescriptions/:id/refills`) | `/rx/1`: 2 refills left. Refill and pay, go back: it now says 3. Every refill adds one, so the patient is never told to ask their doctor. Seeded on 2026-10-23 for the live recording. | Decrement `refillsLeft`; a refill can never increase it. |

Baseline flows that show these bugs while they are live: `tests/e2e/refill-and-pay.flow.json` (C3),
`privacy-opt-out.flow.json` (C2), `thyroid-strength.flow.json` (C4). C1 has no baseline flow: an
accessibility bug is invisible to a mouse-driven replay, which is why the Triage Nurse turns the
reporter's note into a role-based assertion.

SplitPal, the previous demo app, keeps its bugs (B1–B8) for the graded evals: `apps/splitpal/`.
