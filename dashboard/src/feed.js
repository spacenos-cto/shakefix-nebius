// Live feed: every stage event of every case as one stream, newest on top. Pure, no DOM.
// Sources, best first: the per-case timeline (GET <intake>/v1/reports/:rid/timeline, or the hero-run
// fixture in demo mode), then what the board card itself knows (createdAt, fixedAt, updatedAt), then
// state changes the board saw between two polls.

import { STAGES } from './timeline.js';
import { COLUMN_EXPLAIN, STAGE_EXPLAIN } from './explain.js';

export const FEED_ICONS = {
  shaken: '📳',
  issue_created: '🎫',
  triage_start: '🩺',
  triage_end: '🧪',
  surgery: '🔧',
  review: '🧑‍⚕️',
  mr_opened: '📝',
  second_opinion: '🔍',
  unintended: '⚠️',
  ready: '🟢',
  merged: '🔀',
  deploying: '📦',
  deployed: '🚀',
  verified: '👍',
  reopened: '👎',
  'needs-human': '✋',
  'needs-info': '❓',
  'rolled-back': '↩️',
};

// Board states that are not timeline stages: label + plain-English line (same voice as explain.js).
const STATE_COPY = {
  unintended: { label: 'Unintended change caught', plain: 'Second Opinion found the fix changed something it should not have. Back to surgery.' },
  ready: { label: 'Cleared to ship', plain: 'Every check passed. The fix is ready to merge.' },
  deploying: { label: 'Deploying', plain: 'Saving an undo point, then shipping the new version.' },
  reopened: { label: 'Reopened', plain: 'The reporter tapped 👎: still broken for them. Back to triage.' },
  'needs-human': { label: 'Needs a human', plain: COLUMN_EXPLAIN.human.plain },
  'needs-info': { label: 'Needs info', plain: 'The robot asked the reporter for one more detail before touching code.' },
  'rolled-back': { label: 'Rolled back', plain: 'The live health check failed, so the robot undid the deploy by itself.' },
};

// Board state → the event it represents.
const STATE_EVENT = {
  received: 'shaken',
  triaging: 'triage_start',
  'in-surgery': 'surgery',
  proof: 'second_opinion',
  merged: 'merged',
  deployed: 'deployed',
  verified: 'verified',
};

const STAGE_LABEL = Object.fromEntries(STAGES);

const ms = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(v ?? '');
  return Number.isFinite(n) ? n : null;
};

/** Event key for a board state ('in-surgery' → 'surgery', 'rolled-back' → 'rolled-back'). */
export function eventKeyForState(state) {
  return STATE_EVENT[state] ?? state;
}

/** {icon, label, text} for an event key; unknown keys still get something readable. */
export function describe(key) {
  const stage = STAGE_EXPLAIN[key];
  if (stage) return { icon: FEED_ICONS[key] ?? '•', label: STAGE_LABEL[key] ?? key, text: stage.plain };
  const extra = STATE_COPY[key];
  if (extra) return { icon: FEED_ICONS[key] ?? '•', label: extra.label, text: extra.plain };
  return { icon: '•', label: String(key), text: `Moved to ${String(key).replace(/-/g, ' ')}.` };
}

function event(card, key, at, source = null, id = null) {
  const d = describe(key);
  return {
    id: id ?? `${card.rid}:${key}:${at}`,
    rid: card.rid,
    iid: card.iid ?? card.issueIid ?? null,
    title: card.title ?? '',
    key,
    at,
    icon: d.icon,
    label: d.label,
    text: d.text,
    source,
  };
}

/** Reached stages of one case timeline as feed events. */
export function eventsFromTimeline(card, tl) {
  return (tl?.stages ?? [])
    .map((s) => ({ s, at: ms(s.at) }))
    .filter(({ at }) => at != null)
    .map(({ s, at }) => event(card, s.key, at, s.source && s.source !== 'recorded' ? s.source : null));
}

/** What a board card alone can tell: the shake, going live, and its current state when timed. */
export function eventsFromCard(card) {
  const out = [];
  if (card.createdAt != null) out.push(event(card, 'shaken', card.createdAt));
  if (card.fixedAt != null) out.push(event(card, 'deployed', card.fixedAt));
  const key = eventKeyForState(card.state);
  if (card.updatedAt != null && key !== 'shaken' && key !== 'deployed' && card.updatedAt !== card.createdAt) {
    out.push(event(card, key, card.updatedAt));
  }
  return out;
}

/** State changes between two polls of the board, stamped with the time they were seen. */
export function transitionEvents(prevCards, cards, now = Date.now()) {
  if (!Array.isArray(prevCards)) return [];
  const before = new Map(prevCards.map((c) => [c.rid, c.state]));
  return (cards ?? [])
    .filter((c) => before.has(c.rid) && before.get(c.rid) !== c.state)
    .map((c) => {
      const key = eventKeyForState(c.state);
      return event(c, key, now, null, `${c.rid}:${key}:${now}`);
    });
}

/**
 * The whole feed, newest first.
 * @param {object} o
 * @param {Array} o.cards        normalised board cards
 * @param {Map<string,{card,tl}>} [o.timelines]  per-case timelines; they replace the card's own guesses
 * @param {Array} [o.transitions] events from transitionEvents()
 * @param {number} [o.limit]
 */
export function buildFeed({ cards = [], timelines = new Map(), transitions = [], limit = 80 } = {}) {
  const all = [];
  for (const { card, tl } of timelines.values()) all.push(...eventsFromTimeline(card, tl));
  for (const c of cards) if (!timelines.has(c.rid)) all.push(...eventsFromCard(c));
  for (const t of transitions) if (!timelines.has(t.rid)) all.push(t);
  all.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  // The same thing seen twice (card timestamp + poll transition) within 15 s is one event.
  const kept = [];
  for (const e of all) {
    if (kept.some((k) => k.rid === e.rid && k.key === e.key && Math.abs(k.at - e.at) < 15_000)) continue;
    kept.push(e);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** "just now", "45s ago", "3m ago", "2h ago", "3d ago". */
export function ago(thenMs, nowMs = Date.now()) {
  if (thenMs == null || !Number.isFinite(thenMs)) return '';
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
