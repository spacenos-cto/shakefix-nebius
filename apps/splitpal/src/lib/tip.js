// Tip maths. Shares roundMoney() with split.js (see money.js).
import { roundMoney } from './money.js';
import { evalBug } from '../evalBugs.js';

export const TIP_OPTIONS = [0, 5, 10, 15, 20];

/** Tip amount for a subtotal at `pct` percent, rounded to 2dp. */
export function tipAmount(subtotal, pct) {
  const p = Number(pct) || 0;
  if (p <= 0 && !evalBug('E9')) return 0; // E9: a negative custom tip flows straight through
  return roundMoney((Number(subtotal) * p) / 100);
}

export function isValidTip(pct) {
  return TIP_OPTIONS.includes(Number(pct));
}

export const MAX_CUSTOM_TIP = 50;

/** Custom tip percent typed by the user: 0..50, at most 2 decimals. */
export function isValidCustomTip(pct) {
  const p = Number(pct);
  if (String(pct ?? '').trim() === '' || !Number.isFinite(p)) return false;
  // EVAL BUG E9 (off unless EVAL_BUG=E9): only checks that it is a number, so -10 % is accepted
  // and every share shrinks (a negative tip).
  if (evalBug('E9')) return true;
  return p >= 0 && p <= MAX_CUSTOM_TIP && Math.abs(Math.round(p * 100) - p * 100) < 1e-6;
}
