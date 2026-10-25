import { describe, it, expect } from 'vitest';
import { isSessionValid, sessionExpiresAt, sessionStatus, formatRemaining, HOUR_MS } from '../src/auth/session.js';

const session = { user: 'Asha', issuedAt: '2026-10-10T12:00:00.000Z', ttlHours: 24 };
const issued = Date.parse(session.issuedAt);

describe('session', () => {
  it('expires ttlHours after issue', () => {
    expect(new Date(sessionExpiresAt(session)).toISOString()).toBe('2026-10-11T12:00:00.000Z');
  });

  it('is valid early in the session', () => {
    expect(isSessionValid(session, issued + 1 * HOUR_MS)).toBe(true);
  });

  it('is invalid after expiry', () => {
    expect(isSessionValid(session, issued + 25 * HOUR_MS)).toBe(false);
  });

  it('reports remaining time', () => {
    const s = sessionStatus(session, Date.parse('2026-10-11T10:00:00.000Z'));
    expect(s.remainingMs).toBe(2 * HOUR_MS);
    expect(s.expiresAt).toBe('2026-10-11T12:00:00.000Z');
  });

  it('formats remaining time', () => {
    expect(formatRemaining(90 * 60 * 1000)).toBe('1h 30m');
    expect(formatRemaining(-5)).toBe('0h 0m');
  });
});

// Correct behaviour for seeded bug B4 (un-skip when fixed; auth/ changes need human approval).
describe.skip('B4: session stays valid until it actually expires (un-skip when B4 is fixed)', () => {
  it('is still valid 30 minutes before expiry', () => {
    expect(isSessionValid(session, Date.parse('2026-10-11T11:30:00.000Z'))).toBe(true);
  });

  it('is invalid exactly at expiry', () => {
    expect(isSessionValid(session, sessionExpiresAt(session))).toBe(false);
  });
});
