import { describe, expect, it } from 'vitest';
import { safeEqual, signBody, verifySignature } from '../src/hmac.js';

describe('HMAC', () => {
  const secret = 's3cret';
  const body = '{"url":"/bill/7"}';
  const sig = signBody(secret, body);

  it('signBody is hex sha256 HMAC', () => {
    // openssl: printf '%s' '{"url":"/bill/7"}' | openssl dgst -sha256 -hmac s3cret
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies plain hex and sha256= prefixed', () => {
    expect(verifySignature(secret, body, sig)).toBe(true);
    expect(verifySignature(secret, body, `sha256=${sig}`)).toBe(true);
    expect(verifySignature(secret, body, sig.toUpperCase())).toBe(true);
  });

  it('rejects tampered body, wrong secret, missing or malformed header', () => {
    expect(verifySignature(secret, `${body} `, sig)).toBe(false);
    expect(verifySignature('other', body, sig)).toBe(false);
    expect(verifySignature(secret, body, undefined)).toBe(false);
    expect(verifySignature(secret, body, 'abc')).toBe(false);
    expect(verifySignature('', body, sig)).toBe(false);
  });

  it('signs the empty body', () => {
    expect(verifySignature(secret, '', signBody(secret, ''))).toBe(true);
  });

  it('safeEqual', () => {
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'b')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
  });
});
