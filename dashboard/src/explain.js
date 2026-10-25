// Explain mode + Visual mode copy for the ER Board. Pure, no DOM.
// Explain mode: every column, stage and metric says, in plain English, what it is and which
// disaster it prevents. For people who have never done devops / CI/CD.
// Visual mode: the board as one "patient journey" track (journey()).

import { COLUMNS, columnFor } from './metrics.js';

/** Board columns: what is happening + what would go wrong without this step. */
export const COLUMN_EXPLAIN = {
  triage: {
    icon: '🩺',
    plain: 'A user shook their phone. An AI is turning what they did into a test that fails, proving the bug is real.',
    prevents: 'No more "can you send steps to reproduce?" and no fixing bugs that are not there.',
  },
  surgery: {
    icon: '🔧',
    plain: 'An AI writes the smallest fix on a separate copy of the code (a branch). The live app is untouched.',
    prevents: 'Half-finished code can never reach users. Work happens off to the side.',
  },
  proof: {
    icon: '🔍',
    plain: 'The robot runs every test and security scan, opens a private preview, then replays real user flows on the old and new version and compares them.',
    prevents: '"It worked on my laptop", leaked passwords, and "fixing bug A broke feature B".',
  },
  recovery: {
    icon: '🚀',
    plain: 'Every check passed. The fix is merged into the real code and shipped. The robot first saves the current version as an undo point.',
    prevents: 'Manual 2am deploys and "which version is live right now?".',
  },
  discharged: {
    icon: '✅',
    plain: 'The fix is live. The robot pinged the live site to check it is healthy, and messaged the person who reported the bug.',
    prevents: 'A broken deploy staying up. If the health check fails, the robot rolls back by itself.',
  },
  verified: {
    icon: '👍',
    plain: 'The person who reported the bug tapped 👍: it really is fixed for them.',
    prevents: 'Closing a bug that users still hit. The user, not the robot, has the last word.',
  },
  human: {
    icon: '✋',
    plain: 'The robot stopped and asked a person, because the fix looked risky, the report was unclear, or a deploy was rolled back.',
    prevents: 'An AI shipping something it is not sure about. Rules decide when a human must look.',
  },
};

/** Case timeline stages (keys from timeline.js STAGES). */
export const STAGE_EXPLAIN = {
  shaken: { plain: 'The user shook their phone. The app saved a recording of the last steps.', prevents: 'Vague bug reports.' },
  issue_created: { plain: 'A ticket was opened automatically, with the recording attached.', prevents: 'Reports lost in chat or email.' },
  triage_start: { plain: 'The AI Triage Nurse started reading the recording.', prevents: 'Bugs waiting days for someone to look.' },
  triage_end: { plain: 'It wrote a test that fails because of this bug.', prevents: 'Guessing. The bug is now proven and repeatable.' },
  surgery: { plain: 'The AI Surgeon wrote a small fix until that test passed.', prevents: 'Big risky rewrites. Small fixes are easy to check.' },
  review: { plain: 'A second AI (the Attending) reviewed the fix like a senior engineer would.', prevents: 'Sloppy or unsafe code slipping through.' },
  mr_opened: { plain: 'The fix was proposed as a merge request: "please add this to the real code".', prevents: 'Changes going live without a record or review.' },
  second_opinion: { plain: 'The robot compared the old and new app, flow by flow.', prevents: 'The fix quietly breaking something else.' },
  merged: { plain: 'All checks passed, so the fix joined the real code.', prevents: 'Broken code in the main version.' },
  deployed: { plain: 'The new version went live, with an undo point saved first.', prevents: 'Deploys you cannot undo.' },
  verified: { plain: 'The reporter confirmed it is fixed.', prevents: 'Closing bugs users still see.' },
};

/** Headline metric cards, by element id. */
export const METRIC_EXPLAIN = {
  'm-median': 'How long from a user shaking the phone to the fix being live. Lower is better.',
  'm-handsoff': 'Share of bugs fixed with zero people touching them.',
  'm-unintended': 'Times the robot caught a fix that broke something else, before users saw it.',
  'm-confirmed': 'Share of fixes the original reporter confirmed with 👍.',
  'm-rollbacks': 'Times a deploy failed its health check and was undone automatically.',
};

/** One sentence for the open case: where it is now and what happens next. */
export function caseStory(rows) {
  const reached = (rows ?? []).filter((r) => r.reached);
  if (!reached.length) return 'Waiting for the first event.';
  const last = reached[reached.length - 1];
  const next = (rows ?? []).find((r) => !r.reached);
  const now = STAGE_EXPLAIN[last.key]?.plain ?? last.label;
  if (!next) return `${now} Case closed.`;
  return `${now} Next: ${next.label.replace(/^👍\s*/, '').toLowerCase()}.`;
}

/** Visual mode: the board columns as one ordered journey; `human` is the off-ramp. */
export function journey(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const phases = COLUMNS.map((col) => ({
    id: col.id,
    title: col.title,
    offRamp: col.id === 'human',
    ...COLUMN_EXPLAIN[col.id],
    cards: list.filter((c) => columnFor(c) === col.id),
  }));
  return { main: phases.filter((p) => !p.offRamp), offRamp: phases.find((p) => p.offRamp) };
}
