// Pure helpers over a validated replay (shakefix.replay/v1).
import { createHash } from 'node:crypto';

/** Route where the bug happened: last action's route, else startRoute. */
export function currentRoute(replay) {
  const a = replay.actions ?? [];
  return (a.length ? a[a.length - 1].route : replay.startRoute) || '/';
}

/** Top console message: first `error` entry, else first entry, else ''. */
export function topConsoleMessage(replay) {
  const c = replay.console ?? [];
  const e = c.find((x) => x.level === 'error') ?? c[0];
  return e ? String(e.msg ?? '').trim() : '';
}

/** First error-level console entry (or null). */
export function topConsoleError(replay) {
  return (replay.console ?? []).find((x) => x.level === 'error') ?? null;
}

/**
 * An "uncaught error" is an error-level console entry that either says
 * Uncaught/Unhandled (window.onerror / unhandledrejection wording) or carries a stack,
 * or any report the SDK raised itself via trigger "auto-error".
 */
export function hasUncaughtError(replay) {
  if (replay.trigger === 'auto-error') return true;
  return (replay.console ?? []).some(
    (c) => c.level === 'error' && (/\b(uncaught|unhandled)\b/i.test(c.msg ?? '') || Boolean(c.stack)),
  );
}

/** sev 1 = uncaught error, 2 = expectation present (expectation failed), 3 = cosmetic. */
export function severityOf(replay) {
  if (hasUncaughtError(replay)) return 1;
  if (replay.expectation) return 2;
  return 3;
}

/** Normalise a route for dedupe: drop query/hash, numeric path segments become :id. */
export function normalizeRoute(route) {
  const path = String(route || '/').split(/[?#]/)[0] || '/';
  return path.replace(/\/\d+(?=\/|$)/g, '/:id');
}

/**
 * Dedupe key = normalised route + last 5 action testids + top console message.
 * Exported separately so tests can assert the exact input to the hash.
 */
export function dedupeKey(replay) {
  const testids = (replay.actions ?? [])
    .filter((a) => a.testid)
    .slice(-5)
    .map((a) => a.testid)
    .join(',');
  return [normalizeRoute(currentRoute(replay)), testids, topConsoleMessage(replay).slice(0, 300)].join('\n');
}

/** First 8 hex chars of sha256(dedupeKey). Used as label dup::<hash8>. */
export function dedupeHash(replay) {
  return createHash('sha256').update(dedupeKey(replay)).digest('hex').slice(0, 8);
}

/** Rough device name from the UA string, for the issue header. */
export function deviceName(ua = '') {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown device';
}
