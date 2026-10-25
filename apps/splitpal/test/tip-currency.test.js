import { describe, it, expect } from 'vitest';
import { tipAmount, isValidTip, TIP_OPTIONS } from '../src/lib/tip.js';
import { formatMoney, formatHeaderTotal, isValidCurrency } from '../src/lib/currency.js';

describe('tip', () => {
  it('offers the standard tip options', () => {
    expect(TIP_OPTIONS).toEqual([0, 5, 10, 15, 20]);
    expect(isValidTip(10)).toBe(true);
    expect(isValidTip(7)).toBe(false);
  });

  it('computes whole-number tips', () => {
    expect(tipAmount(200, 10)).toBe(20);
    expect(tipAmount(120, 15)).toBe(18);
    expect(tipAmount(1000, 0)).toBe(0);
  });
});

describe('formatMoney', () => {
  it('formats rupees with Indian grouping', () => {
    expect(formatMoney(1000, 'INR')).toBe('₹1,000.00');
    expect(formatMoney(120000, 'INR')).toBe('₹1,20,000.00');
  });

  it('formats dollars', () => {
    expect(formatMoney(46, 'USD')).toBe('$46.00');
  });

  it('falls back to INR for unknown currencies', () => {
    expect(isValidCurrency('EUR')).toBe(false);
    expect(formatMoney(5, 'EUR')).toBe('₹5.00');
  });
});

describe('formatHeaderTotal', () => {
  it('formats rupee totals', () => {
    expect(formatHeaderTotal(1200, 'INR')).toBe('₹1,200.00');
    expect(formatHeaderTotal(1200000, 'INR')).toBe('₹12,00,000.00');
  });

  it('USD totals show a dollar sign', () => {
    expect(formatHeaderTotal(120, 'USD')).toBe('$120.00');
  });

  it('uses western grouping for large USD totals', () => {
    expect(formatHeaderTotal(1200000, 'USD')).toBe('$1,200,000.00');
  });
});
