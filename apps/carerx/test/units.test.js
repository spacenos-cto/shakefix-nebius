import { describe, it, expect } from 'vitest';
import { formatUsd, toCents, fromCents } from '../src/lib/money.js';
import { formatDay, sameDay } from '../src/lib/dates.js';
import { formatStrength, isKnownUnit } from '../src/dosing/strength.js';

describe('money', () => {
  it('formats USD with cents and thousands', () => {
    expect(formatUsd(12)).toBe('$12.00');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsd(-3.1)).toBe('-$3.10');
    expect(fromCents(toCents(0.1) + toCents(0.2))).toBe(0.3);
  });
});

describe('dates', () => {
  it('formats a UTC day and compares days', () => {
    expect(formatDay('2026-09-12T15:00:00.000Z')).toBe('12 Sep 2026');
    expect(sameDay('2026-10-11T01:00:00Z', '2026-10-11T23:00:00Z')).toBe(true);
    expect(sameDay('2026-10-11T23:00:00Z', '2026-10-12T00:30:00Z')).toBe(false);
  });
});

describe('strength', () => {
  it('formats milligrams', () => {
    expect(formatStrength(25, 'mg')).toBe('25 mg');
    expect(isKnownUnit('mcg')).toBe(true);
  });
});

// Correct behaviour for seeded bug C4 (un-skip when C4 is fixed).
describe.skip('C4: micrograms are shown as micrograms (un-skip when C4 is fixed)', () => {
  it('50 mcg stays 50 mcg', () => {
    expect(formatStrength(50, 'mcg')).toBe('50 mcg');
  });
});
