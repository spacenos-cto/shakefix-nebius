// PII scrubbing (BUILD_SPEC §8.2 step 2, §26).
// - emails and phone numbers are stripped from the reporter note
// - emails are stripped from console messages/stacks
// - input values are dropped unless the action's testid is allowlisted (demo fields); kept values are still scrubbed
// - query strings are dropped from network paths

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
// Candidate phone: optional + or (, digit, 6+ of digits/space/()./-, digit. Confirmed by digit count below.
const PHONE_RE = /(?<![\w+(])(?:\+|\()?\d[\d\s().-]{6,}\d(?!\w)/g;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function scrubEmails(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(EMAIL_RE, '[email]');
}

export function scrubPhones(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(PHONE_RE, (m) => {
    if (ISO_DATE_RE.test(m)) return m;
    return m.replace(/\D/g, '').length >= 8 ? '[phone]' : m;
  });
}

/** Full scrub for free text written by the reporter. */
export function scrubText(text) {
  return scrubPhones(scrubEmails(text));
}

/**
 * Returns a scrubbed deep copy of a validated replay. Never mutates the input.
 * @param {object} replay
 * @param {Iterable<string>} inputAllowlist testids whose values may be kept
 */
export function scrubReplay(replay, inputAllowlist = []) {
  const list = [...inputAllowlist];
  const allow = { has: (id) => list.some((p) => (p.endsWith('*') ? id.startsWith(p.slice(0, -1)) : id === p)) };
  const r = structuredClone(replay);
  r.note = scrubText(r.note ?? '');
  r.actions = (r.actions ?? []).map((a) => {
    const out = { ...a };
    if ('value' in out) {
      if (out.testid && allow.has(out.testid)) out.value = scrubText(String(out.value));
      else delete out.value;
    }
    return out;
  });
  r.console = (r.console ?? []).map((c) => {
    const out = { ...c, msg: scrubEmails(c.msg) };
    if (c.stack !== undefined) out.stack = scrubEmails(c.stack);
    return out;
  });
  r.network = (r.network ?? []).map((n) => ({ ...n, path: scrubEmails(String(n.path).split(/[?#]/)[0]) }));
  return r;
}
