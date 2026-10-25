// Eval-only seeded bugs E5–E10 (SEEDED_BUGS.md): OFF by default, ON only with EVAL_BUG.
import { afterEach, describe, expect, it } from 'vitest';
import { parseEvalBugs, evalBug, resetEvalBugsForTests, EVAL_BUGS } from '../src/evalBugs.js';
import { formatMoney } from '../src/lib/currency.js';
import { tipAmount, isValidCustomTip } from '../src/lib/tip.js';
import { formatBillDate } from '../src/lib/dates.js';

const saved = process.env.EVAL_BUG;
function withBugs(value) {
  if (value === undefined) delete process.env.EVAL_BUG;
  else process.env.EVAL_BUG = value;
  resetEvalBugsForTests();
}
afterEach(() => withBugs(saved));

describe('EVAL_BUG flag', () => {
  it('parses a comma list and ignores unknown ids', () => {
    expect([...parseEvalBugs(' e5, E7 ,B1,x')]).toEqual(['E5', 'E7']);
    expect(parseEvalBugs('').size).toBe(0);
    expect(EVAL_BUGS).toHaveLength(6);
  });

  it('is off when EVAL_BUG is unset (main stays clean)', () => {
    withBugs(undefined);
    for (const id of EVAL_BUGS) expect(evalBug(id)).toBe(false);
    expect(formatMoney(300, 'INR')).toBe('₹300.00');
    expect(isValidCustomTip('-10')).toBe(false);
    expect(isValidCustomTip('12.5')).toBe(true);
    expect(isValidCustomTip('0.29')).toBe(true);
    expect(isValidCustomTip('51')).toBe(false);
    expect(isValidCustomTip('')).toBe(false);
    expect(tipAmount(1000, -10)).toBe(0);
    expect(formatBillDate('2026-10-10T20:30:00.000Z', { timeZone: 'UTC' })).toBe('10 Oct 2026');
  });

  it('E8 drops trailing zeros', () => {
    withBugs('E8');
    expect(formatMoney(300, 'INR')).toBe('₹300');
  });

  it('E9 accepts a negative custom tip', () => {
    withBugs('E9');
    expect(isValidCustomTip('-10')).toBe(true);
    expect(tipAmount(1000, -10)).toBe(-100);
  });

  it('E7 shifts late-evening dates to the next day', () => {
    withBugs('E7');
    expect(formatBillDate('2026-10-10T20:30:00.000Z', { timeZone: 'UTC' })).toBe('11 Oct 2026');
  });
});
