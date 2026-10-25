// In-memory rate limiting (per Cloud Run instance; good enough for the demo).
// - per IP: token bucket, capacity N, refilled at N per minute
// - per app: fixed UTC-day window, M per day

export class TokenBucketLimiter {
  constructor({ capacity, refillPerMs, now = Date.now, maxKeys = 10_000 }) {
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.now = now;
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }

  take(key) {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.prune(t);
      b = { tokens: this.capacity, at: t };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + (t - b.at) * this.refillPerMs);
      b.at = t;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, retryAfterSec: 0 };
    }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerMs / 1000)) };
  }

  prune(t) {
    for (const [k, b] of this.buckets) {
      if (b.tokens + (t - b.at) * this.refillPerMs >= this.capacity) this.buckets.delete(k);
    }
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}

export class DailyLimiter {
  constructor({ limit, now = Date.now }) {
    this.limit = limit;
    this.now = now;
    this.day = '';
    this.counts = new Map();
  }

  take(key) {
    const t = this.now();
    const day = new Date(t).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.counts.clear();
    }
    const n = this.counts.get(key) ?? 0;
    if (n >= this.limit) {
      const nextMidnight = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((nextMidnight - t) / 1000)) };
    }
    this.counts.set(key, n + 1);
    return { ok: true, retryAfterSec: 0 };
  }
}

export function createRateLimiter({ ipPerMin = 5, readIpPerMin = 60, appPerDay = 50, now = Date.now } = {}) {
  const ip = new TokenBucketLimiter({ capacity: ipPerMin, refillPerMs: ipPerMin / 60_000, now });
  const read = new TokenBucketLimiter({ capacity: readIpPerMin, refillPerMs: readIpPerMin / 60_000, now });
  const app = new DailyLimiter({ limit: appPerDay, now });
  return {
    checkIp: (addr) => ip.take(String(addr || 'unknown')),
    checkReadIp: (addr) => read.take(String(addr || 'unknown')),
    checkApp: (name) => app.take(String(name || 'unknown')),
  };
}
