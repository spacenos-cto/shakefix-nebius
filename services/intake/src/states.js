// Map GitLab webhook events (issue / merge_request / pipeline) to ShakeFix report states.
// Pure functions; see test/states.test.js.

export const STATES = [
  'received',
  'triaging',
  'in-surgery',
  'proof',
  'deployed',
  'verified',
  'reopened',
  'rolled-back',
  'needs-human',
  'needs-info',
  'closed',
];

/** Forward order used for non-authoritative "hint" transitions. */
const RANK = { received: 0, reopened: 1, 'needs-info': 1, triaging: 1, 'in-surgery': 2, proof: 3, deployed: 4, verified: 5 };
/** States a hint can never move a report out of (only labels or CI calls can). */
const STICKY = new Set(['deployed', 'verified', 'rolled-back', 'needs-human', 'closed']);

/**
 * Label → state, highest precedence first. Labels are authoritative: the flow and CI
 * set them, and GitLab Free does not make `shakefix::` scoped labels exclusive, so we
 * resolve conflicts by precedence.
 */
const LABEL_PRECEDENCE = [
  // Outcomes first: a fix that shipped is "deployed" even if a human had to step in on the way.
  ['shakefix::rolled-back', 'rolled-back'],
  ['shakefix::verified', 'verified'],
  ['shakefix::deployed', 'deployed'],
  ['needs-human', 'needs-human'],
  ['needs-info', 'needs-info'],
  ['shakefix::unintended', 'proof'],
  ['shakefix::ready', 'proof'],
  ['shakefix::proof', 'proof'],
  ['shakefix::in-surgery', 'in-surgery'],
  ['shakefix::triaging', 'triaging'],
  // Lowest: once the flow re-triages a reopened issue, its own labels take over.
  ['shakefix::reopened', 'reopened'],
];

/** Issue labels that carry a pipeline state; all are cleared when the reporter rejects a fix. */
export const STATE_LABELS = [
  'shakefix::triaging',
  'shakefix::in-surgery',
  'shakefix::proof',
  'shakefix::ready',
  'shakefix::unintended',
  'shakefix::deployed',
  'shakefix::verified',
  'shakefix::rolled-back',
];

export function labelTitles(payload) {
  const raw = payload?.labels ?? payload?.object_attributes?.labels ?? [];
  return raw.map((l) => (typeof l === 'string' ? l : l?.title)).filter(Boolean);
}

export function stateFromLabels(labels) {
  const set = new Set(labels);
  for (const [label, state] of LABEL_PRECEDENCE) if (set.has(label)) return state;
  return null;
}

const MARKER_RE = /shakefix:rid=(r_\d{8}_[0-9a-f]{6})/;
const BRANCH_RE = /^shakefix\/(\d+)(?:-|$)/;
const CLOSES_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i;

export function ridFromDescription(desc) {
  const m = MARKER_RE.exec(String(desc ?? ''));
  return m ? m[1] : null;
}

export function issueIidFromBranch(branch) {
  const m = BRANCH_RE.exec(String(branch ?? ''));
  return m ? Number(m[1]) : null;
}

function issueIidFromMr(attrs) {
  return issueIidFromBranch(attrs?.source_branch) ?? (() => {
    const m = CLOSES_RE.exec(String(attrs?.description ?? ''));
    return m ? Number(m[1]) : null;
  })();
}

/**
 * @returns {null | {kind, rid, issueIid, mrIid, state, authoritative, title?, labels}}
 * `authoritative` = derived from labels (or an explicit open); otherwise a forward-only hint.
 */
export function mapGitlabEvent(payload) {
  const kind = payload?.object_kind ?? payload?.event_type;
  const attrs = payload?.object_attributes ?? {};

  if (kind === 'issue' || kind === 'work_item') {
    const labels = labelTitles(payload);
    const rid = ridFromDescription(attrs.description);
    const fromLabels = stateFromLabels(labels);
    let state = fromLabels;
    let authoritative = fromLabels !== null;
    if (!state && (attrs.action === 'open' || attrs.action === 'reopen') && labels.includes('shakefix')) {
      state = attrs.action === 'reopen' ? 'triaging' : 'received';
      authoritative = attrs.action === 'reopen';
    }
    // Closed without a shipped fix (superseded, duplicate, refused): it leaves the board.
    if (attrs.action === 'close' && !['deployed', 'verified', 'rolled-back'].includes(state)) {
      state = 'closed';
      authoritative = true;
    }
    return { kind: 'issue', rid, issueIid: attrs.iid ?? null, mrIid: null, state, authoritative, title: attrs.title, labels };
  }

  if (kind === 'merge_request') {
    const labels = labelTitles(payload);
    const issueIid = issueIidFromMr(attrs);
    if (!issueIid) return null;
    const fromLabels = stateFromLabels(labels);
    let state = fromLabels;
    let authoritative = fromLabels !== null;
    if (!state) {
      if (attrs.action === 'merge' || attrs.state === 'merged') state = 'proof';
      else if (['open', 'reopen', 'update'].includes(attrs.action) || attrs.state === 'opened') state = 'in-surgery';
    }
    return { kind: 'merge_request', rid: null, issueIid, mrIid: attrs.iid ?? null, state, authoritative, labels };
  }

  if (kind === 'pipeline') {
    const mr = payload?.merge_request ?? null;
    const issueIid = issueIidFromBranch(mr?.source_branch ?? attrs.ref);
    if (!issueIid) return null;
    // An MR pipeline running on a shakefix/<iid>-* branch means the fix is under Second Opinion.
    const state = ['pending', 'running', 'success'].includes(attrs.status) ? 'proof' : null;
    return { kind: 'pipeline', rid: null, issueIid, mrIid: mr?.iid ?? null, state, authoritative: false, labels: [] };
  }

  return null;
}

/** Decide the next state for a record given a mapped event. Returns null for "no change". */
export function nextState(current, mapped) {
  if (!mapped?.state || mapped.state === current) return null;
  if (mapped.authoritative) return mapped.state;
  if (STICKY.has(current)) return null;
  const cur = RANK[current] ?? 0;
  const nxt = RANK[mapped.state] ?? 0;
  return nxt > cur ? mapped.state : null;
}
