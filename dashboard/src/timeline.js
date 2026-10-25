// Per-case agent timeline + live stopwatch ("shake → 👍 11m 42s · Human touches: 0"). Pure, no DOM.
// Input: GET <intake>/v1/reports/:rid/timeline (services/intake/src/timeline.js buildTimeline()).

import { formatDuration } from './metrics.js';

export const STAGES = [
  ['shaken', 'Shaken'],
  ['issue_created', 'Issue created'],
  ['triage_start', 'Triage started'],
  ['triage_end', 'Reproduced (failing test)'],
  ['surgery', 'Surgery (fix committed)'],
  ['review', 'Attending review'],
  ['mr_opened', 'MR opened'],
  ['second_opinion', 'Second Opinion'],
  ['merged', 'Merged'],
  ['deployed', 'Deployed'],
  ['verified', '👍 Reporter confirmed'],
];

const ms = (v) => {
  const n = typeof v === 'number' ? v : Date.parse(v ?? '');
  return Number.isFinite(n) ? n : null;
};

/** Elapsed ms: frozen at 👍, otherwise ticking from the shake. */
export function liveElapsed(tl, nowMs = Date.now()) {
  const start = ms(tl?.startedAt);
  if (start == null) return null;
  const end = ms(tl.endedAt);
  return Math.max(0, (end ?? nowMs) - start);
}

/** "shake → 👍 11m 42s · Human touches: 0 · $0.38" (+ " (running)" until the reporter's 👍). */
export function stopwatchLine(tl, nowMs = Date.now()) {
  if (!tl) return '';
  const e = liveElapsed(tl, nowMs);
  const running = !tl.endedAt;
  const cost = tl.cost && Number.isFinite(Number(tl.cost.usd)) ? ` · $${Number(tl.cost.usd).toFixed(2)}` : '';
  return `shake → 👍 ${formatDuration(e)}${running ? ' (running)' : ''} · Human touches: ${tl.humanTouches ?? 0}${cost}`;
}

/** Rows for the timeline list: label, time, "+mm:ss" since the shake, source tag. */
export function stageRows(tl) {
  const start = ms(tl?.startedAt);
  const byKey = new Map((tl?.stages ?? []).map((s) => [s.key, s]));
  return STAGES.map(([key, label]) => {
    const s = byKey.get(key) ?? {};
    const at = ms(s.at);
    return {
      key,
      label: s.label ?? label,
      at,
      sinceShake: at != null && start != null ? formatDuration(at - start) : null,
      source: s.source ?? null,
      reached: at != null,
    };
  });
}

/**
 * Same shape as the intake's DEMO_MODE timeline, computed in the browser from the hero-run fixture
 * (services/intake/src/demo/hero-run.json) when the board runs without an intake.
 */
export function fixtureTimeline(fixture, startMs, nowMs = Date.now()) {
  const stages = (fixture?.stages ?? []).map((s) => {
    const at = startMs + s.offsetS * 1000;
    return { key: s.key, at: at <= nowMs ? new Date(at).toISOString() : null, source: s.source };
  });
  const verified = stages.find((s) => s.key === 'verified')?.at ?? null;
  return {
    rid: fixture?.rid,
    issueIid: fixture?.issueIid ?? null,
    mrIid: fixture?.mrIid ?? null,
    demo: true,
    stages,
    startedAt: new Date(startMs).toISOString(),
    endedAt: verified,
    running: !verified,
    humanTouches: fixture?.humanTouches ?? 0,
    cost: fixture?.cost ?? null,
  };
}
