// Agent timeline + stopwatch (shake → 👍) and the human-touch counter. Pure functions.
//
// Stage times come from what the intake can observe:
//   shaken          POST /v1/reports received (the shake reached us)
//   issue_created   the issue was created (or a webhook "open" for a recovered record)
//   triage_start    label shakefix::triaging, or the first note by a bot on the issue
//   triage_end      push to shakefix/<iid>-* that adds tests/regressions/issue-<iid>.spec.ts (commit time),
//                   or label shakefix::in-surgery
//   surgery         first commit pushed to shakefix/<iid>-* (commit time), or label shakefix::in-surgery
//   review          a bot note / MR description with the Attending's {"approve":…,"confidence":…} JSON
//   mr_opened       merge_request "open"
//   second_opinion  the "Second Opinion — Behavior Diff" note on the MR, or label shakefix::ready|unintended
//   merged          merge_request "merge"
//   deployed        POST /v1/reports/:rid/fixed (smoke test passed in production)
//   verified        the reporter's 👍 (POST /v1/reports/:rid/verdict confirmed)
//
// Human touches: actions by users that are not bots and not the intake itself:
// notes, MR approvals, merges, pushes to the fix branch and manual edits (labels, title, description).
// The intake posts notes and labels with the maintainer's PAT (GitLab triggers ignore bots), so it
// remembers the ids of the notes it wrote and treats issue edits right after its own calls as automation.

export const STAGES = Object.freeze([
  { key: 'shaken', label: 'Shaken' },
  { key: 'issue_created', label: 'Issue created' },
  { key: 'triage_start', label: 'Triage started' },
  { key: 'triage_end', label: 'Reproduced (failing test)' },
  { key: 'surgery', label: 'Surgery (fix committed)' },
  { key: 'review', label: 'Attending review' },
  { key: 'mr_opened', label: 'MR opened' },
  { key: 'second_opinion', label: 'Second Opinion' },
  { key: 'merged', label: 'Merged' },
  { key: 'deployed', label: 'Deployed' },
  { key: 'verified', label: '👍 Reporter confirmed' },
]);
export const STAGE_KEYS = Object.freeze(STAGES.map((s) => s.key));

/** Hidden marker on every note the intake posts (src/gitlab.js addIssueNote). */
export const INTAKE_NOTE_MARKER = '<!-- shakefix:intake-note -->';

export const HUMAN_KINDS = Object.freeze(['note', 'approval', 'merge', 'push', 'edit']);
const MAX_EVENTS = 200;
/** Issue/MR edits by the PAT user within this window after an intake call are the intake's own. */
export const AUTOMATION_WINDOW_MS = 60_000;

const LABEL_STAGES = {
  'shakefix::triaging': ['triage_start'],
  'shakefix::in-surgery': ['triage_end', 'surgery'],
  'shakefix::proof': ['mr_opened'],
  'shakefix::ready': ['second_opinion'],
  'shakefix::unintended': ['second_opinion'],
  'shakefix::deployed': ['deployed'],
  'shakefix::verified': ['verified'],
};

// GitLabDuo is the Duo Code Review account; ai-* are flow service accounts.
const BOT_RE = /(^|[-_.])bot([-_.]|$)|^project_\d+_bot|^group_\d+_bot|^ai-|^duo[-_]|^gitlab-?duo$|^gitlab-bot$|^ghost$|\[bot\]$/i;
const SECOND_OPINION_RE = /Second Opinion\s*[—-]\s*Behavior Diff/i;
const ATTENDING_RE = /"approve"\s*:\s*(true|false)/;
const PROOF_COUNTS_RE = /\*\*(\d+)\s+changes?\s*·\s*(\d+)\s+intended\s*·\s*(\d+)\s+unintended\*\*/;

/** True for flow service accounts, project/group bots and anything in `botUsernames`. */
export function isBotUser(username, botUsernames = []) {
  const u = String(username ?? '').replace(/^@+/, '');
  if (!u) return true; // unknown actor: never count it as a human touch
  if (botUsernames.some((b) => String(b).replace(/^@+/, '').toLowerCase() === u.toLowerCase())) return true;
  return BOT_RE.test(u);
}

const toIso = (v, fallback) => {
  const ms = typeof v === 'number' ? v : Date.parse(v ?? '');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
};

const labelsOf = (list) => (Array.isArray(list) ? list : []).map((l) => (typeof l === 'string' ? l : l?.title)).filter(Boolean);

function stageEvents(keys, at, source, detail) {
  return keys.map((stage) => ({ type: 'stage', stage, at, source, ...(detail ? { detail } : {}) }));
}

/**
 * Timeline events for one GitLab webhook payload.
 * @param {object} payload  raw webhook body (issue, work_item, merge_request, note, push, pipeline)
 * @param {{now: string, botUsernames?: string[], issueIid?: number|null, intakeNoteIds?: Array<number|string>,
 *          lastAutomationAt?: string|null}} ctx
 * @returns {Array<{type:'stage', stage, at, source, detail?} | {type:'human', kind, at, detail?} | {type:'proof', intended, unintended, at}>}
 */
export function timelineEventsFromHook(payload, ctx) {
  const now = ctx.now;
  const bots = ctx.botUsernames ?? [];
  const kind = payload?.object_kind ?? payload?.event_type;
  const attrs = payload?.object_attributes ?? {};
  const user = payload?.user?.username ?? payload?.user_username ?? null;
  const human = !isBotUser(user, bots);
  const out = [];

  const addedLabels = () => {
    const ch = payload?.changes?.labels;
    if (ch) {
      const prev = new Set(labelsOf(ch.previous));
      return labelsOf(ch.current).filter((l) => !prev.has(l));
    }
    return labelsOf(payload?.labels ?? attrs.labels);
  };
  const labelStages = (at) => {
    for (const l of addedLabels()) if (LABEL_STAGES[l]) out.push(...stageEvents(LABEL_STAGES[l], at, `label ${l}`));
  };
  const withinAutomation = () => {
    const last = Date.parse(ctx.lastAutomationAt ?? '');
    return Number.isFinite(last) && Date.parse(now) - last <= AUTOMATION_WINDOW_MS && Date.parse(now) >= last;
  };

  if (kind === 'issue' || kind === 'work_item') {
    const at = now;
    if (attrs.action === 'open') out.push(...stageEvents(['issue_created'], toIso(attrs.created_at, at), 'issue open'));
    labelStages(at);
    const ch = payload?.changes ?? {};
    const edited = ['labels', 'title', 'description'].some((k) => k in ch);
    if (attrs.action === 'update' && edited && human && !withinAutomation()) {
      out.push({ type: 'human', kind: 'edit', at, detail: Object.keys(ch).filter((k) => ['labels', 'title', 'description'].includes(k)).join(',') });
    }
    return out;
  }

  if (kind === 'merge_request') {
    const at = now;
    if (attrs.action === 'open') {
      out.push(...stageEvents(['mr_opened'], toIso(attrs.created_at, at), 'MR open'));
      if (ATTENDING_RE.test(String(attrs.description ?? ''))) out.push(...stageEvents(['review'], toIso(attrs.created_at, at), 'Attending JSON in MR description'));
    }
    if (attrs.action === 'merge') out.push(...stageEvents(['merged'], at, 'MR merge'));
    labelStages(at);
    if (human) {
      if (attrs.action === 'approved' || attrs.action === 'approval') out.push({ type: 'human', kind: 'approval', at });
      if (attrs.action === 'merge') out.push({ type: 'human', kind: 'merge', at });
      const ch = payload?.changes ?? {};
      // The flow opens the MR and then sets labels/description; GitLab attributes those edits to the
      // human who triggered the flow (composite identity), so edits right after opening are automation.
      const sinceOpen = Date.parse(now) - Date.parse(attrs.created_at ?? '');
      const justOpened = Number.isFinite(sinceOpen) && sinceOpen >= 0 && sinceOpen <= AUTOMATION_WINDOW_MS;
      if (attrs.action === 'update' && !attrs.oldrev && ['labels', 'title', 'description'].some((k) => k in ch) && !withinAutomation() && !justOpened) {
        out.push({ type: 'human', kind: 'edit', at, detail: 'merge request' });
      }
    }
    return out;
  }

  if (kind === 'note') {
    const at = toIso(attrs.created_at, now);
    const body = String(attrs.note ?? attrs.body ?? '');
    const noteId = attrs.id;
    const ours = body.includes(INTAKE_NOTE_MARKER) || (ctx.intakeNoteIds ?? []).some((id) => String(id) === String(noteId));
    if (!human) {
      if (SECOND_OPINION_RE.test(body)) {
        out.push(...stageEvents(['second_opinion'], at, 'Second Opinion note'));
        const m = PROOF_COUNTS_RE.exec(body);
        if (m) out.push({ type: 'proof', intended: Number(m[2]), unintended: Number(m[3]), at });
      } else if (ATTENDING_RE.test(body)) {
        out.push(...stageEvents(['review'], at, 'Attending note'));
      } else if (attrs.noteable_type === 'Issue') {
        out.push(...stageEvents(['triage_start'], at, 'first ER note on the issue'));
      }
    } else if (!ours && !attrs.system) {
      out.push({ type: 'human', kind: 'note', at });
    }
    return out;
  }

  if (kind === 'push') {
    const commits = Array.isArray(payload?.commits) ? payload.commits : [];
    if (!commits.length) return out;
    const times = commits.map((c) => toIso(c.timestamp, now)).sort();
    out.push(...stageEvents(['surgery'], times[0], 'first commit on the fix branch'));
    const iid = ctx.issueIid;
    const spec = iid != null ? `tests/regressions/issue-${iid}.spec.ts` : null;
    const withSpec = spec ? commits.find((c) => [...(c.added ?? []), ...(c.modified ?? [])].includes(spec)) : null;
    if (withSpec) out.push(...stageEvents(['triage_end'], toIso(withSpec.timestamp, now), `commit adds ${spec}`));
    if (human) out.push({ type: 'human', kind: 'push', at: now, detail: `${commits.length} commit(s)` });
    return out;
  }

  return out;
}

/**
 * Apply events to a record. Returns a patch {stages, timeline, humanTouches, proof?} (only changed keys)
 * or null when nothing changed. Stage times keep the FIRST observation.
 */
export function applyTimelineEvents(record, events) {
  if (!events?.length) return null;
  const stages = { ...(record.stages ?? {}) };
  const timeline = [...(record.timeline ?? [])];
  let touches = record.humanTouches ?? 0;
  let proof = null;
  let changed = false;
  for (const ev of events) {
    if (ev.type === 'stage') {
      if (!STAGE_KEYS.includes(ev.stage)) continue;
      const cur = stages[ev.stage];
      if (!cur || Date.parse(ev.at) < Date.parse(cur)) {
        stages[ev.stage] = ev.at;
        timeline.push({ type: 'stage', stage: ev.stage, at: ev.at, source: ev.source ?? null });
        changed = true;
      }
    } else if (ev.type === 'human') {
      touches += 1;
      timeline.push({ type: 'human', kind: ev.kind, at: ev.at, ...(ev.detail ? { detail: ev.detail } : {}) });
      changed = true;
    } else if (ev.type === 'proof') {
      proof = { intended: ev.intended, unintended: ev.unintended };
      changed = true;
    }
  }
  if (!changed) return null;
  const patch = { stages, timeline: timeline.slice(-MAX_EVENTS), humanTouches: touches };
  if (proof) patch.proof = proof;
  return patch;
}

/** Stage time map for a record, falling back to the coarse state timestamps the intake already keeps. */
export function stageTimes(record) {
  const s = { ...(record.stages ?? {}) };
  const ts = record.timestamps ?? {};
  s.shaken ??= ts.received ?? record.createdAt ?? null;
  s.issue_created ??= record.issueCreatedAt ?? null;
  s.triage_start ??= ts.triaging ?? null;
  s.surgery ??= ts['in-surgery'] ?? null;
  s.deployed ??= record.fixedAt ?? ts.deployed ?? null;
  s.verified ??= record.verifiedAt ?? ts.verified ?? null;
  return s;
}

/** "11m 42s" */
export function formatStopwatch(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * Public timeline view (no usernames, notes or replays).
 * @param {object} record  stored report record (primary)
 * @param {{now: string, sources?: Record<string,string>, demo?: boolean}} opts
 */
export function buildTimeline(record, { now, sources = {}, demo = false } = {}) {
  const times = stageTimes(record);
  const start = Date.parse(times.shaken ?? '');
  const endIso = times.verified ?? null;
  const end = endIso ? Date.parse(endIso) : Date.parse(now);
  const elapsedMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  const humanActions = (record.timeline ?? []).filter((e) => e.type === 'human').map((e) => ({ kind: e.kind, at: e.at }));
  const humanTouches = record.humanTouches ?? humanActions.length;
  const cost = record.cost && Number.isFinite(Number(record.cost.usd)) ? { usd: Number(record.cost.usd), source: record.cost.source ?? null } : null;
  return {
    rid: record.rid,
    issueIid: record.issueIid ?? null,
    mrIid: record.mrIid ?? null,
    state: record.state,
    demo,
    stages: STAGES.map((s) => ({ key: s.key, label: s.label, at: times[s.key] ?? null, ...(sources[s.key] ? { source: sources[s.key] } : {}) })),
    startedAt: times.shaken ?? null,
    endedAt: endIso,
    running: !endIso,
    elapsedMs,
    humanTouches,
    humanActions,
    cost,
    stopwatch: `shake → 👍 ${formatStopwatch(elapsedMs)}${endIso ? '' : ' (running)'} · Human touches: ${humanTouches}${cost ? ` · $${cost.usd.toFixed(2)}` : ''}`,
    generatedAt: now,
  };
}
