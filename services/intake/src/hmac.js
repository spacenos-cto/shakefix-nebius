import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-shakefix-signature';

/** hex(HMAC-SHA256(secret, rawBody)) */
export function signBody(secret, rawBody) {
  return createHmac('sha256', secret).update(rawBody ?? '').digest('hex');
}

/**
 * Verify `x-shakefix-signature`. Accepts `<hex>` or `sha256=<hex>`.
 * Returns false (never throws) for missing secret/header or malformed input.
 */
export function verifySignature(secret, rawBody, header) {
  if (!secret || typeof header !== 'string') return false;
  const got = header.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(got)) return false;
  const expected = signBody(secret, rawBody ?? '');
  return timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'));
}

/** Constant-time string compare (for X-Gitlab-Token). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
