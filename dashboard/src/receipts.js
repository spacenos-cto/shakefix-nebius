// Receipts tab: every discharged case with its links, shake → live time and human touches. Pure, no DOM.

import { LIVE_STATES } from './metrics.js';

const trim = (s) => String(s ?? '').replace(/\/+$/, '');

/** Issue / MR / pipeline URLs for a card; explicit URLs win, else built from the GitLab project URL. */
export function caseLinks(card, gitlabProjectUrl = '') {
  const gl = trim(gitlabProjectUrl);
  return {
    issue: card.issueUrl ?? (gl && card.iid != null ? `${gl}/-/issues/${card.iid}` : null),
    mr: card.mrUrl ?? (gl && card.mrIid != null ? `${gl}/-/merge_requests/${card.mrIid}` : null),
    pipeline: card.pipelineUrl ?? (gl && card.pipelineId != null ? `${gl}/-/pipelines/${card.pipelineId}` : null),
  };
}

/** ./certificate.html?rid=<rid>&intake=<intake> (intake left out when there is none, e.g. demo mode). */
export function certificateHref(rid, intake = '') {
  const q = new URLSearchParams({ rid: String(rid ?? '') });
  if (intake) q.set('intake', trim(intake));
  return `./certificate.html?${q}`;
}

/** Discharged (live or verified) cases, most recently shipped first. */
export function receipts(cards, { gitlabProjectUrl = '', intake = '' } = {}) {
  return (Array.isArray(cards) ? cards : [])
    .filter((c) => LIVE_STATES.includes(c.state))
    .map((c) => ({
      rid: c.rid,
      iid: c.iid,
      mrIid: c.mrIid,
      pipelineId: c.pipelineId ?? null,
      title: c.title,
      state: c.state,
      verdict: c.verdict,
      fixedAt: c.fixedAt ?? null,
      shakeToLiveMs: c.createdAt != null && c.fixedAt != null ? Math.max(0, c.fixedAt - c.createdAt) : null,
      humanTouches: c.humanTouches,
      links: caseLinks(c, gitlabProjectUrl),
      certificate: certificateHref(c.rid, intake),
    }))
    .sort((a, b) => (b.fixedAt ?? -Infinity) - (a.fixedAt ?? -Infinity));
}
