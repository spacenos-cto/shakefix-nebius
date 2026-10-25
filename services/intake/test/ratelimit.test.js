import { describe, expect, it } from 'vitest';
import { createRateLimiter, DailyLimiter, TokenBucketLimiter } from '../src/ratelimit.js';

function clock(start = Date.parse('2026-10-11T10:00:00Z')) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('token bucket (5/min/IP)', () => {
  it('allows a burst of 5 then blocks with retry-after', () => {
    const c = clock();
    const rl = createRateLimiter({ ipPerMin: 5, appPerDay: 1000, now: c.now });
    for (let i = 0; i < 5; i++) expect(rl.checkIp('1.2.3.4').ok).toBe(true);
    const blocked = rl.checkIp('1.2.3.4');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(12);
    expect(rl.checkIp('5.6.7.8').ok).toBe(true); // separate bucket
  });

  it('refills over time', () => {
    const c = clock();
    const b = new TokenBucketLimiter({ capacity: 5, refillPerMs: 5 / 60_000, now: c.now });
    for (let i = 0; i < 5; i++) b.take('ip');
    expect(b.take('ip').ok).toBe(false);
    c.advance(12_000);
    expect(b.take('ip').ok).toBe(true);
    expect(b.take('ip').ok).toBe(false);
    c.advance(60_000);
    for (let i = 0; i < 5; i++) expect(b.take('ip').ok).toBe(true);
  });

  it('prunes when the key cap is hit', () => {
    const c = clock();
    const b = new TokenBucketLimiter({ capacity: 1, refillPerMs: 1, now: c.now, maxKeys: 3 });
    ['a', 'b', 'c', 'd', 'e'].forEach((k) => b.take(k));
    expect(b.buckets.size).toBeLessThanOrEqual(3);
  });
});

describe('daily limiter (50/day/app)', () => {
  it('caps per app per UTC day and resets at midnight', () => {
    const c = clock(Date.parse('2026-10-11T23:59:00Z'));
    const d = new DailyLimiter({ limit: 50, now: c.now });
    for (let i = 0; i < 50; i++) expect(d.take('splitpal').ok).toBe(true);
    const blocked = d.take('splitpal');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
    expect(d.take('other').ok).toBe(true);
    c.advance(61_000);
    expect(d.take('splitpal').ok).toBe(true);
  });
});
