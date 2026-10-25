// Pure rendering of issue title / labels / description (BUILD_SPEC §8.3) and notes.
// No I/O here: everything is unit-tested in test/render.test.js.
import { currentRoute, deviceName, topConsoleError, topConsoleMessage } from './replay.js';

export const INLINE_REPLAY_MAX_CHARS = 200_000;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Make text safe inside a ``` fence. */
const fenceSafe = (s) => String(s ?? '').replace(/```/g, "'''");
/** Make text safe inside an inline `code` span. */
const codeSafe = (s) => String(s ?? '').replace(/`/g, "'");

export function issueTitle(replay) {
  const subject = oneLine(replay.note) || oneLine(topConsoleMessage(replay)) || 'bug report';
  return `🩺 [shake] ${truncate(subject, 80)} (${truncate(oneLine(currentRoute(replay)), 60)})`;
}

export function issueLabels({ sev, hash }) {
  return ['shakefix', `sev::${sev}`, `dup::${hash}`];
}

export function ridMarker(rid) {
  return `<!-- shakefix:rid=${rid} -->`;
}

/**
 * @param {{replay: object, screenshotMarkdown?: string|null}} p
 * First line is always the contract marker `<!-- shakefix:rid=<rid> -->`.
 */
export function issueBody({ replay, screenshotMarkdown, trackUrl = null }) {
  const [w, h] = replay.device?.viewport ?? [0, 0];
  const top = topConsoleError(replay);
  const topText = top ? [top.msg, top.stack].filter(Boolean).join('\n') : '(none)';
  let replayJson = JSON.stringify(replay, null, 2);
  if (replayJson.length > INLINE_REPLAY_MAX_CHARS) {
    replayJson = `${replayJson.slice(0, INLINE_REPLAY_MAX_CHARS)}\n… (truncated; see the committed file)`;
  }
  const note = oneLine(replay.note) || '(no note)';

  return [
    ridMarker(replay.rid),
    '## 🩺 Patient intake',
    '',
    `**Reporter note:** ${note}`,
    `**Trigger:** ${replay.trigger} · **Route:** \`${codeSafe(currentRoute(replay))}\` · **App version:** \`${codeSafe(replay.app?.version)}\` · **Device:** ${deviceName(replay.device?.ua)}, ${w}×${h}`,
    ...(trackUrl ? [`**Live:** [Follow this case in Mission Control](${trackUrl})`] : []),
    '',
    screenshotMarkdown || '_(no screenshot)_',
    '',
    '### Top console error',
    '```',
    fenceSafe(topText),
    '```',
    '',
    `### Replay (also at \`reports/${replay.rid}/replay.json\`)`,
    '```json',
    fenceSafe(replayJson),
    '```',
    '',
    '---',
    // Visible copy of the marker: GitLab Duo strips HTML comments from what agents read.
    `ShakeFix report: shakefix:rid=${replay.rid}`,
    '_Filed automatically by ShakeFix intake. The ER team (Duo flow) will take it from here._',
    '',
  ].join('\n');
}

export function replayFilePath(rid) {
  return `reports/${rid}/replay.json`;
}

export function replayCommitMessage(rid) {
  return `chore(report): ${rid} [skip ci]`;
}

export function plusOneNote(rid) {
  return `+1 reporter (\`${rid}\`): same route, actions and console error. Subscribed for the fix notification.`;
}

/** Mention note that fires the flow's Mention trigger (BUILD_SPEC §11.7). */
export function reoperateNote({ account, mr }) {
  const handle = String(account).replace(/^@+/, '');
  return `@${handle} re-operate: Second Opinion found unintended changes on !${mr}. See report.`;
}

export function flowGoal(issueIid) {
  return `ShakeFix: fix issue #${issueIid}`;
}

/**
 * Web Push payload for "Fixed ✓". With `rid` + `verdictUrl` the service worker adds the
 * 👍 / 👎 verdict actions (BUILD_SPEC §17.5); `deviceId` makes the verdict idempotent.
 */
export function fixedPushPayload(url, { rid, verdictUrl, deviceId } = {}) {
  const payload = { title: 'Fixed ✓', body: 'The bug you reported is gone. Pull to refresh.', url: url || '/' };
  if (rid) Object.assign(payload, { kind: 'fixed', rid, tag: `shakefix-${rid}` });
  if (rid && verdictUrl) payload.verdictUrl = verdictUrl;
  if (rid && deviceId) payload.deviceId = deviceId;
  return payload;
}

// ---- reporter verdict ("patient's verdict", BUILD_SPEC §17.5) ---------------------------

export const VERIFIED_NOTE = '✅ Verified by the reporter — the patient confirms the fix.';

export function verifiedNote({ certificateUrl = null } = {}) {
  return certificateUrl ? `${VERIFIED_NOTE}\n\n📜 [Discharge Certificate](${certificateUrl})` : VERIFIED_NOTE;
}

/** reports/<rid>/replay-<n>.json (n >= 2; replay.json is the first). */
export function verdictReplayPath(rid, n) {
  return `reports/${rid}/replay-${n}.json`;
}

export function verdictReplayCommitMessage(rid, n) {
  return `chore(report): ${rid} replay-${n}, reporter says still broken [skip ci]`;
}

/** Issue note for a 👎 verdict, with the fresh replay inline. */
export function rejectedNote({ replay, path }) {
  let replayJson = JSON.stringify(replay, null, 2);
  if (replayJson.length > INLINE_REPLAY_MAX_CHARS) {
    replayJson = `${replayJson.slice(0, INLINE_REPLAY_MAX_CHARS)}\n… (truncated; see the committed file)`;
  }
  const note = oneLine(replay.note) || '(no note)';
  return [
    "👎 The reporter says it's still broken — new replay attached; back to triage.",
    '',
    `**Reporter note:** ${note}`,
    `**Route:** \`${codeSafe(currentRoute(replay))}\` · **App version:** \`${codeSafe(replay.app?.version)}\``,
    '',
    `### Replay (also at \`${path}\`)`,
    '```json',
    fenceSafe(replayJson),
    '```',
    '',
  ].join('\n');
}

/** Mention note (posted with the HUMAN PAT) that re-fires the flow's Mention trigger. */
export function retriageNote({ account }) {
  const handle = String(account).replace(/^@+/, '');
  return `@${handle} re-triage: reporter rejected the fix, see latest replay`;
}
