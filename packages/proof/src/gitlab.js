// SCM access for Second Opinion, through the @shakefix/core ScmProvider.
// Default (SCM_PROVIDER unset or "gitlab"): GitLab REST v4 with CI_API_V4_URL, CI_PROJECT_ID,
// SHAKEFIX_BOT_TOKEN, exactly as before. SCM_PROVIDER=github: GITHUB_REPO (or GITHUB_REPOSITORY)
// + GITHUB_TOKEN; pull requests stand in for merge requests.

import { createGitlabProvider, scmFromEnv as coreScmFromEnv, scmProviderName, issueRefsFromText } from '@shakefix/core/scm';

export { issueRefsFromText };

export function gitlabFromEnv(env = process.env, fetchImpl = fetch) {
  const apiUrl = env.CI_API_V4_URL;
  const projectId = env.CI_PROJECT_ID;
  const token = env.SHAKEFIX_BOT_TOKEN;
  if (!apiUrl || !projectId || !token) {
    const missing = [!apiUrl && 'CI_API_V4_URL', !projectId && 'CI_PROJECT_ID', !token && 'SHAKEFIX_BOT_TOKEN'].filter(Boolean);
    throw new Error(`GitLab API needs env: ${missing.join(', ')}`);
  }
  return createGitlab({ apiUrl, projectId, token, fetchImpl });
}

/** Add the method names Second Opinion has always used on top of a core ScmProvider. */
export function withProofApi(scm) {
  return {
    ...scm,
    getMR: (iid) => scm.getMR(iid),
    getIssue: (iid) => scm.getIssue(iid),
    closesIssues: (iid) => scm.mrClosesIssues(iid),
    postMRNote: (iid, body) => scm.addMRNote(iid, body),
    /** Edit our previous note (found by `marker`) instead of stacking a new one on every pipeline. */
    upsertMRNote: async (iid, body, marker) => {
      const notes = (await scm.listMRNotes(iid).catch(() => [])) ?? [];
      const mine = [...notes].reverse().find((n) => typeof n?.body === 'string' && n.body.includes(marker));
      if (mine?.id != null && scm.updateMRNote) return { ...(await scm.updateMRNote(iid, mine.id, body)), updated: true };
      return scm.addMRNote(iid, body);
    },
    postIssueNote: (iid, body) => scm.addIssueNote(iid, body),
    updateMRLabels: (iid, { add = [], remove = [] }) => scm.updateMR(iid, { addLabels: add, removeLabels: remove }),
    linkedIssue: (mrIid) => scm.linkedIssue(mrIid),
  };
}

export function createGitlab({ apiUrl, projectId, token, fetchImpl = fetch }) {
  return withProofApi(createGitlabProvider({ apiUrl, projectId, token, fetch: fetchImpl, timeoutMs: 30000 }));
}

/** The SCM selected by SCM_PROVIDER (default gitlab, with the CI env above). */
export function scmFromEnv(env = process.env, fetchImpl = fetch) {
  if (scmProviderName(env) === 'gitlab') return gitlabFromEnv(env, fetchImpl);
  return withProofApi(coreScmFromEnv(env, { fetch: fetchImpl, timeoutMs: 30000 }));
}

/** True when scmFromEnv() has what it needs (used to decide whether to fetch live MR labels). */
export function scmConfigured(env = process.env) {
  if (scmProviderName(env) === 'gitlab') return Boolean(env.SHAKEFIX_BOT_TOKEN && env.CI_API_V4_URL && env.CI_PROJECT_ID);
  return Boolean((env.GITHUB_REPO || env.GITHUB_REPOSITORY) && (env.GITHUB_TOKEN || env.GH_TOKEN));
}
