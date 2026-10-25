import { describe, it, expect } from 'vitest';
import { splitEvenly, isFullySettled, sharesFor, grandTotal } from '../src/lib/split.js';
import { toCents } from '../src/lib/money.js';

const sumCents = (shares) => shares.reduce((s, x) => s + toCents(x.amount), 0);

describe('splitEvenly', () => {
  it('splits evenly divisible totals exactly', () => {
    const shares = splitEvenly(1200, ['Asha', 'Ben', 'Chen', 'Dev']);
    expect(shares.map((s) => s.amount)).toEqual([300, 300, 300, 300]);
    expect(shares.map((s) => s.name)).toEqual(['Asha', 'Ben', 'Chen', 'Dev']);
  });

  it('returns no shares for nobody', () => {
    expect(splitEvenly(100, [])).toEqual([]);
  });

  it('settles an evenly divisible bill', () => {
    expect(isFullySettled(1200, splitEvenly(1200, ['a', 'b', 'c', 'd']))).toBe(true);
  });

  it('includes the tip in the amount to split', () => {
    const bill = { total: 120, tipPct: 15, people: ['a', 'b', 'c'] };
    expect(grandTotal(bill)).toBe(138);
    expect(sharesFor(bill).map((s) => s.amount)).toEqual([46, 46, 46]);
  });
});

// Correct behaviour for seeded bug B1. Skipped so CI on main stays green while the bug is
// live; the agent that fixes B1 should un-skip this block (and its regression spec must pass).
describe.skip('B1: uneven splits allocate every cent (un-skip when B1 is fixed)', () => {
  it('1000 / 3 -> 333.34 + 333.33 + 333.33 (largest remainder to the first person)', () => {
    const shares = splitEvenly(1000, ['Asha', 'Ben', 'Chen']);
    expect(shares.map((s) => s.amount)).toEqual([333.34, 333.33, 333.33]);
    expect(sumCents(shares)).toBe(100000);
  });

  it('a 1000 / 3 bill can be settled', () => {
    expect(isFullySettled(1000, splitEvenly(1000, ['Asha', 'Ben', 'Chen']))).toBe(true);
  });

  it('shares always sum to the total', () => {
    for (const [amount, n] of [[100, 3], [10, 7], [549.94, 2], [0.05, 4], [999.99, 6]]) {
      const shares = splitEvenly(amount, Array.from({ length: n }, (_, i) => `p${i}`));
      expect(sumCents(shares)).toBe(toCents(amount));
    }
  });
});
