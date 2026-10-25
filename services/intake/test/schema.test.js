import { describe, expect, it } from 'vitest';
import { RID_RE, reportBodySchema, replaySchema } from '../src/schema.js';
import { makeReplay, PNG_B64 } from './helpers.js';

describe('replay schema (shakefix.replay/v1)', () => {
  it('accepts a contract-shaped replay', () => {
    expect(replaySchema.safeParse(makeReplay()).success).toBe(true);
  });

  it('normalises a missing expectation to null', () => {
    const r = makeReplay();
    delete r.expectation;
    const p = replaySchema.parse(r);
    expect(p.expectation).toBeNull();
  });

  it('strips unknown keys', () => {
    const p = replaySchema.parse({ ...makeReplay(), secret: 'x' });
    expect(p).not.toHaveProperty('secret');
  });

  it.each([
    ['wrong schema', { schema: 'shakefix.replay/v2' }],
    ['bad rid', { rid: 'r_2026_10_11_8f3a' }],
    ['path-traversal rid', { rid: '../../etc' }],
    ['bad trigger', { trigger: 'tap' }],
    ['bad viewport', { device: { ua: 'x', viewport: [1], touch: true } }],
    ['bad console level', { console: [{ level: 'info', msg: 'x' }] }],
  ])('rejects %s', (_n, over) => {
    expect(replaySchema.safeParse(makeReplay(over)).success).toBe(false);
  });

  it('rejects an action without selector/route', () => {
    const r = makeReplay({ actions: [{ t: 0, type: 'click', testid: 'x' }] });
    expect(replaySchema.safeParse(r).success).toBe(false);
  });

  it('rid regex follows the contract r_<yyyymmdd>_<6 hex>', () => {
    expect(RID_RE.test('r_20261011_8f3a01')).toBe(true);
    expect(RID_RE.test('r_20261011_8F3A01')).toBe(false);
  });
});

describe('report body schema', () => {
  it('accepts replay + screenshot + https push subscription', () => {
    const ok = reportBodySchema.safeParse({
      replay: makeReplay(),
      screenshotPng: PNG_B64,
      pushSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'k', auth: 'a' } },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a non-https push endpoint', () => {
    const bad = reportBodySchema.safeParse({
      replay: makeReplay(),
      pushSubscription: { endpoint: 'http://evil.test/x', keys: { p256dh: 'k', auth: 'a' } },
    });
    expect(bad.success).toBe(false);
  });
});
