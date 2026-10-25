// Demo data for the ER Board when no intake URL is configured (or ?demo=1).
// Built from the seeded SplitPal bugs (B1-B4) so the board tells the same story as the video.
// Timestamps are relative to page load; tick() moves the live case through the board.

const MIN = 60_000;

export function demoBoard(now = Date.now()) {
  return {
    cards: [
      {
        rid: 'r_demo_b2', issueIid: 3, title: 'Blank name crashes the split view', sev: 1,
        state: 'verified', route: '/bill/:id', createdAt: now - 95 * MIN, fixedAt: now - 92 * MIN,
        mrIid: 4, proof: { intended: 2, unintended: 0 }, autonomy: 'hands-off',
        verdict: 'confirmed', verdicts: { confirmed: 1, rejected: 0 },
      },
      {
        rid: 'r_demo_b3', issueIid: 5, title: 'USD totals header shows the rupee sign', sev: 3,
        state: 'deployed', route: '/bill/:id', createdAt: now - 70 * MIN, fixedAt: now - 67.5 * MIN,
        mrIid: 6, proof: { intended: 1, unintended: 0 }, autonomy: 'hands-off',
      },
      {
        rid: 'r_demo_b1', issueIid: 12, title: 'Settle never completes for 1000 split 3 ways', sev: 2,
        state: 'verified', route: '/bill/:id/settle', createdAt: now - 40 * MIN, fixedAt: now - 37.2 * MIN,
        mrIid: 13, proof: { intended: 2, unintended: 1 }, autonomy: 'hands-off', reoperations: 1,
        verdict: 'confirmed', verdicts: { confirmed: 1, rejected: 0 },
      },
      {
        rid: 'r_demo_b4', issueIid: 14, title: 'Session expires one minute early', sev: 2,
        state: 'needs-human', route: '/settings', createdAt: now - 25 * MIN,
        mrIid: 15, proof: { intended: 1, unintended: 0, flaky: 1 }, autonomy: 'supervised',
      },
      {
        rid: 'r_demo_bad', issueIid: 16, title: 'Forced bad deploy (rollback drill)', sev: 3,
        state: 'rolled-back', route: '/', createdAt: now - 18 * MIN,
        mrIid: 17, proof: { intended: 1, unintended: 0 }, autonomy: 'hands-off', rollbacks: 1,
      },
      {
        rid: 'r_demo_b5', issueIid: 19, title: 'Tip rounding still off after the fix', sev: 2,
        state: 'reopened', route: '/bill/:id', createdAt: now - 12 * MIN,
        mrIid: 20, proof: { intended: 1, unintended: 0 }, autonomy: 'hands-off',
        verdict: 'rejected', verdicts: { confirmed: 0, rejected: 1 },
      },
      {
        rid: 'r_demo_live', issueIid: 21, title: 'Tip total looks off on a 3-way split', sev: 2,
        state: 'received', route: '/bill/:id', createdAt: now - 20_000,
        proof: {}, autonomy: 'hands-off',
      },
    ],
  };
}

const LIVE_PATH = ['received', 'triaging', 'in-surgery', 'proof', 'ready', 'deploying', 'deployed', 'verified'];

/** Advance the live demo card one step; restart the walk after discharge. */
export function tick(board, now = Date.now()) {
  const card = board.cards.find((c) => c.rid === 'r_demo_live');
  if (!card) return board;
  const i = LIVE_PATH.indexOf(card.state);
  if (i === LIVE_PATH.length - 1) {
    Object.assign(card, { state: 'received', createdAt: now, fixedAt: undefined, mrIid: undefined, proof: {}, verdict: null });
  } else {
    card.state = LIVE_PATH[i + 1];
    if (card.state === 'proof') card.mrIid = 22;
    if (card.state === 'ready') card.proof = { intended: 2, unintended: 0 };
    if (card.state === 'deployed') card.fixedAt = now;
    if (card.state === 'verified') card.verdict = 'confirmed';
  }
  card.updatedAt = now;
  return board;
}

export const demoLedger = [
  { id: '3', iid: 3, route: '/bill/:id', files: ['apps/splitpal/src/views/bill.ts'], rootCause: 'name not trimmed before toUpperCase', pattern: 'input-validation', fixedAt: null, mr: 4 },
  { id: '5', iid: 5, route: '/bill/:id', files: ['apps/splitpal/src/lib/currency.ts'], rootCause: 'hard-coded currency symbol', pattern: 'locale-formatting', fixedAt: null, mr: 6 },
  { id: '12', iid: 12, route: '/bill/:id/settle', files: ['apps/splitpal/src/lib/split.ts'], rootCause: 'remainder cent dropped', pattern: 'money-rounding', fixedAt: null, mr: 13 },
  { id: '18', iid: 18, route: '/bill/:id', files: ['apps/splitpal/src/lib/tip.ts'], rootCause: 'tip rounded per person', pattern: 'money-rounding', fixedAt: null, mr: 19 },
];
