// Currency formatting.
import { evalBug } from '../evalBugs.js';

export const CURRENCIES = ['INR', 'USD'];

const SYMBOLS = { INR: '₹', USD: '$' };

// Formatting without Intl/ICU: Node builds with small-icu (e.g. the Duo agent sandbox) format
// en-IN like en-US, so grouping is done by hand to give the same output everywhere.
function groupDigits(amount, { indian, decimals }) {
  const n = Number(amount) || 0;
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  let grouped;
  if (indian && int.length > 3) {
    const head = int.slice(0, -3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + int.slice(-3);
  } else {
    grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return (neg ? '-' : '') + grouped + (frac ? '.' + frac : '');
}

export function isValidCurrency(code) {
  return CURRENCIES.includes(code);
}

/** "₹1,000.00" / "$46.00" — used for shares, tip and list rows. */
export function formatMoney(amount, currency = 'INR') {
  const code = isValidCurrency(currency) ? currency : 'INR';
  // EVAL BUG E8 (off unless EVAL_BUG=E8): trailing zeros dropped, so ₹300.00 renders as ₹300.
  let digits = groupDigits(amount, { indian: code === 'INR', decimals: 2 });
  if (evalBug('E8')) digits = digits.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  const neg = digits.startsWith('-');
  return (neg ? '-' : '') + SYMBOLS[code] + (neg ? digits.slice(1) : digits);
}

/** Totals header on the split view (data-testid="bill-total"). */
export function formatHeaderTotal(amount, currency = 'INR') {
  // SYMBOLS is keyed by upper-case ISO codes (fix for #5: the lower-case lookup always missed).
  const code = String(currency).toUpperCase();
  const symbol = SYMBOLS[code] || '₹';
  const digits = groupDigits(amount, { indian: code === 'INR' || !SYMBOLS[code], decimals: 2 });
  return `${symbol}${digits}`;
}
