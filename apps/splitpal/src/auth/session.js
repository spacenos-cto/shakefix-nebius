// Demo session handling. Shared by the API server (GET /api/session) and the browser.
// Policy: any change under apps/splitpal/src/auth/** needs human approval (.shakefix/policy.yml).

export const HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_TTL_HOURS = 24;

/** Epoch ms when the session really expires. */
export function sessionExpiresAt(session) {
  const ttl = Number(session.ttlHours ?? DEFAULT_TTL_HOURS);
  return Date.parse(session.issuedAt) + ttl * HOUR_MS;
}

/** True while the session is still usable at `nowMs`. */
export function isSessionValid(session, nowMs) {
  const ttl = Number(session.ttlHours ?? DEFAULT_TTL_HOURS);
  const elapsedHours = (nowMs - Date.parse(session.issuedAt)) / HOUR_MS;
  // SEEDED BUG B4: off-by-one — the last hour of the session counts as expired,
  // so users are logged out an hour early (should be `elapsedHours < ttl`).
  return elapsedHours < ttl - 1;
}

/** Status object returned by GET /api/session. */
export function sessionStatus(session, nowMs) {
  const expiresAt = sessionExpiresAt(session);
  return {
    user: session.user,
    issuedAt: session.issuedAt,
    expiresAt: new Date(expiresAt).toISOString(),
    now: new Date(nowMs).toISOString(),
    valid: isSessionValid(session, nowMs),
    remainingMs: Math.max(0, expiresAt - nowMs),
  };
}

/** 5400000 -> "1h 30m" */
export function formatRemaining(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}
