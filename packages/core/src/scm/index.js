// SCM provider switch. SCM_PROVIDER=gitlab (default) | github.
//
// ScmProvider interface (both providers return GitLab-shaped objects: iid, title, description,
// labels[], web_url; MRs also source_branch, target_branch, sha, draft, state):
//   name, capabilities, defaultBranch()
//   getIssue(iid) · createIssue({title, description, labels}) · findOpenIssueByLabel(label)
//   updateIssue(iid, {addLabels, removeLabels, stateEvent: 'reopen'|'close'}) · addIssueNote(iid, body)
//   listIssueNotes(iid) · findRidInIssue(iid)
//   getFile(path, ref) · commitFile({branch, filePath, content, message})
//   commitFiles({branch, startBranch, message, files: [{path, content, action}]}) · createBranch({branch, ref})
//   uploadFile({filename, data, contentType}) -> {url, markdown}
//   getMR(iid) · findMRBySourceBranch(branch) · createMR({sourceBranch, targetBranch, title, description, labels})
//   updateMR(iid, {addLabels, removeLabels, title, description}) · addMRNote(iid, body) · listMRNotes(iid)
//   mrClosesIssues(iid) · linkedIssue(mrIid) · mergeMR(iid, {sha, squash, removeSourceBranch, whenPipelineSucceeds, commitMessage})
//   startFlow({goal, workflowDefinition})   (GitLab Duo only)

import { createGitlabProvider } from './gitlab.js';
import { createGithubProvider } from './github.js';
import { parseLabelMap } from './common.js';

export { createGitlabProvider, createGithubProvider };
export * from './errors.js';
export * from './common.js';
export { normalizeIssue, normalizePR, normalizeNote } from './github.js';

export const SCM_PROVIDERS = Object.freeze(['gitlab', 'github']);

/** Provider name from the environment. Unknown values throw (a typo must not silently hit GitLab). */
export function scmProviderName(env = process.env) {
  const p = String(env.SCM_PROVIDER || 'gitlab').trim().toLowerCase();
  if (!SCM_PROVIDERS.includes(p)) throw new Error(`SCM_PROVIDER must be one of ${SCM_PROVIDERS.join('|')} (got "${env.SCM_PROVIDER}")`);
  return p;
}

/**
 * Resolve provider config from env. Backward compatible with both existing env sets:
 *   intake: GITLAB_URL, GITLAB_PROJECT_ID, GITLAB_HUMAN_PAT
 *   CI/proof: CI_API_V4_URL, CI_PROJECT_ID, SHAKEFIX_BOT_TOKEN
 *   new:    GITLAB_TOKEN
 *   GitHub: GITHUB_REPO (or GITHUB_REPOSITORY, set by Actions), GITHUB_TOKEN (or GH_TOKEN), GITHUB_API_URL
 * `prefer` picks which GitLab token wins when several are set: 'bot' (CI) or 'human' (intake).
 */
export function scmConfigFromEnv(env = process.env, { prefer = 'bot' } = {}) {
  const provider = scmProviderName(env);
  if (provider === 'github') {
    return {
      provider,
      repo: env.GITHUB_REPO || env.GITHUB_REPOSITORY || '',
      token: env.GITHUB_TOKEN || env.GH_TOKEN || '',
      apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
      labelMap: parseLabelMap(env.SCM_LABEL_MAP),
    };
  }
  const tokens = prefer === 'human'
    ? [env.GITLAB_HUMAN_PAT, env.GITLAB_TOKEN, env.SHAKEFIX_BOT_TOKEN]
    : [env.SHAKEFIX_BOT_TOKEN, env.GITLAB_TOKEN, env.GITLAB_HUMAN_PAT];
  return {
    provider,
    apiUrl: env.CI_API_V4_URL || undefined,
    baseUrl: (env.GITLAB_URL || 'https://gitlab.com').replace(/\/+$/, ''),
    projectId: env.GITLAB_PROJECT_ID || env.CI_PROJECT_ID || '',
    token: tokens.find(Boolean) || '',
  };
}

/** Missing required settings for a resolved config (names of env vars). */
export function missingScmConfig(c) {
  if (c.provider === 'github') {
    return [!c.repo && 'GITHUB_REPO', !c.token && 'GITHUB_TOKEN'].filter(Boolean);
  }
  return [!c.projectId && 'GITLAB_PROJECT_ID|CI_PROJECT_ID', !c.token && 'GITLAB_TOKEN|SHAKEFIX_BOT_TOKEN|GITLAB_HUMAN_PAT'].filter(Boolean);
}

/** Build a provider from an explicit config ({provider, ...provider options}). */
export function createScm(config = {}) {
  const { provider = 'gitlab', ...opts } = config;
  if (provider === 'github') return createGithubProvider(opts);
  if (provider === 'gitlab') return createGitlabProvider(opts);
  throw new Error(`unknown SCM provider "${provider}"`);
}

/** Build the provider selected by SCM_PROVIDER. Throws listing missing env vars. */
export function scmFromEnv(env = process.env, { fetch, prefer, timeoutMs } = {}) {
  const c = scmConfigFromEnv(env, { prefer });
  const missing = missingScmConfig(c);
  if (missing.length) throw new Error(`${c.provider} SCM provider needs env: ${missing.join(', ')}`);
  return createScm({ ...c, ...(fetch ? { fetch } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
}
