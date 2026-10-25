import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dedupeHash, dedupeKey, normalizeRoute, severityOf } from '../src/replay.js';
import { makeReplay } from './helpers.js';

describe('dedupe hash', () => {
  it('is sha256(route + last 5 testids + top console msg), first 8 hex', () => {
    const r = makeReplay({ console: [{ level: 'warn', msg: 'w' }, { level: 'error', msg: 'TypeError: x is undefined' }] });
    const key = '/bill/:id\nnew-bill-btn,title-input,total-input,settle-btn\nTypeError: x is undefined';
    expect(dedupeKey(r)).toBe(key);
    expect(dedupeHash(r)).toBe(createHash('sha256').update(key).digest('hex').slice(0, 8));
    expect(dedupeHash(r)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('uses only the last 5 testids', () => {
    const actions = Array.from({ length: 8 }, (_, i) => ({ t: i, type: 'click', testid: `b${i}`, selector: 's', route: '/' }));
    expect(dedupeKey(makeReplay({ actions })).split('\n')[1]).toBe('b3,b4,b5,b6,b7');
  });

  it('is stable across bill ids, values and notes', () => {
    const a = makeReplay();
    const b = makeReplay({ note: 'different words', rid: 'r_20261012_000000' });
    b.actions = b.actions.map((x) => ({ ...x, route: x.route.replace('/bill/7', '/bill/9'), value: undefined }));
    expect(dedupeHash(a)).toBe(dedupeHash(b));
  });

  it('differs when the top console error differs', () => {
    const a = makeReplay({ console: [{ level: 'error', msg: 'A' }] });
    const b = makeReplay({ console: [{ level: 'error', msg: 'B' }] });
    expect(dedupeHash(a)).not.toBe(dedupeHash(b));
  });

  it('falls back to startRoute when there are no actions', () => {
    expect(dedupeKey(makeReplay({ actions: [], startRoute: '/settings?x=1' }))).toBe('/settings\n\n');
  });

  it('normalizeRoute replaces numeric segments', () => {
    expect(normalizeRoute('/bill/12/settle#x')).toBe('/bill/:id/settle');
  });
});

describe('severity', () => {
  it('sev 1 for an uncaught error', () => {
    expect(severityOf(makeReplay({ console: [{ level: 'error', msg: 'Uncaught TypeError: boom' }] }))).toBe(1);
    expect(severityOf(makeReplay({ console: [{ level: 'error', msg: 'boom', stack: 'at x' }] }))).toBe(1);
    expect(severityOf(makeReplay({ trigger: 'auto-error', expectation: null }))).toBe(1);
  });

  it('sev 2 when an expectation is present', () => {
    expect(severityOf(makeReplay({ console: [{ level: 'warn', msg: 'Uncaught? no, a warning' }] }))).toBe(2);
  });

  it('sev 3 otherwise', () => {
    expect(severityOf(makeReplay({ expectation: null }))).toBe(3);
  });
});
