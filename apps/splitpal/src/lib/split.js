// Bill splitting. Shared by the browser (src/) and the API server (server/index.js).
import { roundMoney } from './money.js';
import { tipAmount } from './tip.js';

/** Amount to split: the bill total plus the tip. */
export function grandTotal(bill) {
  return Number(bill.total) + tipAmount(bill.total, bill.tipPct || 0);
}

/**
 * Splits `amount` evenly between `people`.
 * Returns [{ name, amount }] in the same order as `people`.
 */
export function splitEvenly(amount, people) {
  const n = people.length;
  if (n === 0) return [];
  // SEEDED BUG B1: every share is truncated to 2dp, so 1000 / 3 -> 333.33 x 3 = 999.99
  // and the leftover 0.01 is never allocated to anyone.
  const each = Math.floor((Number(amount) / n) * 100 + 1e-6) / 100;
  return people.map((name) => ({ name, amount: each }));
}

/** Shares for a stored bill (total + tip, split across bill.people). */
export function sharesFor(bill) {
  return splitEvenly(grandTotal(bill), bill.people || []);
}

/**
 * True when the paid shares add up to the full amount owed.
 * POST /api/bills/:id/settle only marks a bill settled when this is true.
 */
export function isFullySettled(amount, paidShares) {
  const paid = paidShares.reduce((sum, s) => sum + s.amount, 0);
  // SEEDED BUG B1: compares the (lossy) sum of truncated shares with the total: 999.99 !== 1000.
  return roundMoney(paid) === roundMoney(amount);
}
