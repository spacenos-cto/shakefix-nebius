# SplitPal seeded bugs

SplitPal ships with deliberate bugs for the ShakeFix demo (BUILD_SPEC §6.2): B1–B4 from the start, B5–B8 added on
2026-10-11 so the full loop can be run and filmed on production, each reported from a phone. Each one is
marked in code with a `// SEEDED BUG Bx` comment. The agent that fixes a bug removes its comment.

Seed data lives in `server/seed.json`. With test hooks on, `POST /api/__test/reset` restores it.

| ID | Where | Repro (seed data) | Correct fix |
|---|---|---|---|
| **B1** (hero) | `src/lib/split.js:17` (`splitEvenly`) and `src/lib/split.js:34` (`isFullySettled`) | Open `/bill/7` (₹1000, 3 people), tap `settle-btn`, tap each `pay-<name>-btn`, then `confirm-settle-btn`. `settled-banner` never appears. The API returns `POST /api/bills/7/settle → {"ok":false,"paidTotal":999.99}` | Work in integer cents (`toCents`/`fromCents` in `src/lib/money.js`). Use largest-remainder: 1000/3 becomes 333.34, 333.33, 333.33, with the extra cent going to the first person. Compare cents in `isFullySettled`. **Do not touch `roundMoney`.** |
| **B2** | `src/views/bill.js:7` (`initials`) | `/bill/new`: total 300, `person-input-0` "Asha", `add-person-btn`, leave `person-input-1` blank, `save-bill-btn`. The split view crashes with `Cannot read properties of undefined (reading 'toUpperCase')` and `error-banner` shows. | Trim and validate names. Show an inline error on `/bill/new`, and add a server 400 in `POST /api/bills` (`server/index.js`). Make `initials()` tolerate empty names. |
| **B3** | `src/lib/currency.js:25` (`formatHeaderTotal`) | `/bill/3` → `currency-select` = USD → `bill-total` still shows `₹1,200.00`. `/bill/12` (seeded USD bill) shows `₹120.00`. Shares and tip already show `$`. | Use `Intl.NumberFormat` with the selected currency (or key the lookup correctly). Expect `$1,200.00`. |
| **B4** (governance) | `src/auth/session.js:17` (`isSessionValid`) | Needs test hooks. Open `/settings?now=2026-10-11T11:30:00Z`, or send the header `x-test-now: 2026-10-11T11:30:00Z` to `GET /api/session`. `session-status` says "Session expired", but the session was issued at 2026-10-10T12:00Z with a 24h TTL, so 30 minutes remain. | `elapsedHours < ttl`. The path matches `apps/splitpal/src/auth/**`, so policy forces Supervised and requires human approval. |
| **B5** | `server/index.js` (`summary`, `peopleCount`) | Home: "Dinner at Toit" shows "2 people"; `/bill/7` lists 3. | `peopleCount: bill.people.length`. |
| **B6** | `src/views/settings.js` (name input `onchange`) | `/settings`: type a name in `settings-name-input`, go home, come back: the field is empty again. | Save under the right key: `setPrefs({ name })`. |
| **B7** | `src/views/newBill.js` (`save`) | `/settings`: `default-currency-select` = USD. `/bill/new` says "Total (USD)", but the saved bill shows `₹`. | Use `prefs.currency` when creating the bill. |
| **B8** | `src/views/bill.js` (`tip-select` options) | `/bill/3`: `tip-select` offers 0–15%; 20% is missing although the server accepts it. | Render every `TIP_OPTIONS` entry. |

## The Second Opinion trap (B1)

`roundMoney()` in `src/lib/money.js` truncates to 2 decimal places. **Two callers share it:**

1. `isFullySettled()` in `src/lib/split.js`: the settle check.
2. `tipAmount()` in `src/lib/tip.js`: every bill's tip.

The tempting naive fix for B1 changes the shared helper to `Math.round(amount)`, which rounds the total. Then `roundMoney(999.99) === roundMoney(1000)`, so settle "works". But it also changes **bill 9's tip** (₹499.95 at 10%, raw 49.995):

| | `tip-total` on `/bill/9` | bill 7 settles |
|---|---|---|
| main (buggy) | ₹49.99 | no |
| naive fix (`Math.round` in `roundMoney`) | **₹50.00** ← unintended | yes |
| correct fix (cents + largest remainder in `split.js`) | ₹49.99 | yes |

The naive fix touches nothing else on bill 9. Its shares are computed in `splitEvenly` with their own truncation, so they stay ₹274.97 each. The baseline flow `tests/e2e/change-tip.flow.json` visits `/bill/9`, so Second Opinion sees `/bill/9 · tip-total: ₹49.99 → ₹50.00` as the single unintended change.

Under the correct fix, the only behaviour change across all seed bills is bill 7's first share: 333.33 → 333.34.

**Keep unit tests from pinning the 49.99 tip.** Second Opinion must catch the trap, not vitest. If a unit test pins it, the agent's own `npm test` loop catches the trap first and the demo moment is lost.

## Tests while bugs are live

1. **Unit tests (`npm test`).** The correct behaviour for B1, B3 and B4 lives in `describe.skip(...)` blocks in `test/*.test.js`, so CI on main stays green. The fixing agent un-skips the matching block.
2. **E2E flows.** `tests/e2e/settle.flow.json` has `"expectFailUntilFixed": "B1"`, and `change-currency.flow.json` has `"B3"`. `tests/e2e/flows.spec.ts` runs these as `test.fail()`. Once the bug is fixed the flow unexpectedly passes and goes red, so the fixing MR must also delete that field.

## Resetting for a re-record

Re-apply the four snippets marked above (or `git checkout demo-reset -- apps/splitpal/src`), then restart the server or `POST /api/__test/reset`.

## Eval bugs E5–E10 (off by default)

Six more realistic bugs for the graded eval (`evals/`). They live behind the `EVAL_BUG` env flag, so
**main stays clean**: with `EVAL_BUG` unset, every `evalBug()` check in `src/evalBugs.js` is false.
Start a buggy build with `EVAL_BUG=E7 node server/index.js --test-hooks` (comma list allowed). The
server applies server-side bugs directly and injects `<meta name="splitpal-eval-bugs">` for the browser.
Each bug is marked in code with an `EVAL BUG Ex` comment.

| ID | Class | Where | Repro (seed data, UTC browser) | Correct behaviour (main) |
|---|---|---|---|---|
| **E5** | Empty-state crash | `src/views/list.js` (`recentSettledText`) | Open `/`. No seeded bill is settled, `settled[0]` is undefined, the list view throws and `error-banner` shows. | `recent-settled` reads "Nothing settled yet." |
| **E6** | Double submit | `src/views/newBill.js` (save button) | `/bill/new`, fill title, total, two people, tap `save-bill-btn` once, go to `/`. Two bills (ids 13 and 14) exist and `bill-count` reads "6 bills". | One tap creates one bill: `bill-count` reads "5 bills" (4 seeded + 1). |
| **E7** | Date / time zone | `src/lib/dates.js` (`formatBillDate`) | `/bill/7` (created 2026-10-10T20:30Z). `bill-date` reads "Added 11 Oct 2026" because a hard-coded IST offset is added. | "Added 10 Oct 2026" in the viewer's own time zone. |
| **E8** | Currency formatting | `src/lib/currency.js` (`formatMoney`) | `/bill/3`: `share-Asha` shows `₹300` (trailing zeros dropped). | `₹300.00`. |
| **E9** | Negative tip | `src/lib/tip.js` (`isValidCustomTip`, `tipAmount`) | `/bill/7`, type `-10` in `tip-custom-input`, tap `tip-apply-btn`: accepted, tip shows `-₹100.00`, every share shrinks. | `tip-error` "Tip must be between 0 and 50%." and nothing is saved. |
| **E10** | Unicode name | `server/index.js` (`POST /api/bills`) | New bill with people "Zoë" and "Ben": the split view shows `share-Zo`, not `share-Zoë`. | Names are stored as typed (`share-Zoë`). |

The custom tip input (`tip-custom-input`, `tip-error`), the bill date (`bill-date`) and the "Last settled"
line (`recent-settled`) and the bill count (`bill-count`) are ordinary features on main; only their `EVAL BUG` branches are seeded.
