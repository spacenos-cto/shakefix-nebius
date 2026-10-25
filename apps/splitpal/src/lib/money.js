// Shared money helpers. Used by BOTH split.js (settle check) and tip.js (tip amount),
// so any change here ripples into every bill's tip total.

/** Integer cents for an amount in major units (e.g. 12.34 -> 1234). */
export function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

/** Major units for integer cents (e.g. 1234 -> 12.34). */
export function fromCents(cents) {
  return cents / 100;
}

/**
 * Rounds an amount to 2 decimal places by truncating (always rounds down),
 * so we never charge anyone more than they owe.
 * The tiny epsilon absorbs float noise such as 0.29 * 100 = 28.999999999999996.
 */
export function roundMoney(amount) {
  return Math.floor(Number(amount) * 100 + 1e-6) / 100;
}
