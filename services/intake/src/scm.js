// SCM provider for the intake. SCM_PROVIDER=gitlab (default) keeps the self-contained GitLab
// client in ./gitlab.js (the Docker build context is services/intake, so the default image does
// not need anything outside this folder). SCM_PROVIDER=github loads the GitHub provider from
// @shakefix/core: in the monorepo it resolves from packages/core; in a container, build the image
// from the repo root with templates/github/intake.Dockerfile, which copies packages/core.

import { createGitlabClient } from './gitlab.js';

const CORE_CANDIDATES = ['@shakefix/core/scm', '../../../packages/core/src/scm/index.js'];

async function loadCoreScm() {
  let lastErr;
  for (const spec of CORE_CANDIDATES) {
    try {
      return await import(spec);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`SCM_PROVIDER=github needs @shakefix/core (packages/core); build the intake from the repo root (templates/github/intake.Dockerfile). ${lastErr?.message ?? ''}`);
}

/** Config keys that must be set for the chosen provider (for the startup warning). */
export function requiredScmKeys(config) {
  return config.scmProvider === 'github' ? ['githubRepo', 'githubToken'] : ['projectId', 'humanPat'];
}

export async function createScm(config, { fetch } = {}) {
  if (config.scmProvider === 'github') {
    const core = await loadCoreScm();
    return core.createGithubProvider({
      repo: config.githubRepo,
      token: config.githubToken,
      apiUrl: config.githubApiUrl,
      labelMap: core.parseLabelMap(config.scmLabelMap),
      ...(fetch ? { fetch } : {}),
    });
  }
  return createGitlabClient({ baseUrl: config.gitlabUrl, projectId: config.projectId, token: config.humanPat, ...(fetch ? { fetch } : {}) });
}
