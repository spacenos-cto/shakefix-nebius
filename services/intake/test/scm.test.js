import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createScm, requiredScmKeys } from '../src/scm.js';
import { GitlabError } from '../src/gitlab.js';
import { fakeGitlab } from './helpers.js';

describe('intake SCM provider switch', () => {
  it('defaults to the GitLab client (same requests as before)', async () => {
    const config = loadConfig({ GITLAB_URL: 'https://gitlab.test', GITLAB_PROJECT_ID: 'grp/shakefix', GITLAB_HUMAN_PAT: 'glpat-x' });
    expect(config.scmProvider).toBe('gitlab');
    expect(requiredScmKeys(config)).toEqual(['projectId', 'humanPat']);
    const fg = fakeGitlab();
    const scm = await createScm(config, { fetch: fg.fetch });
    expect(await scm.defaultBranch()).toBe('main');
    expect(fg.calls[0].path).toBe('/projects/grp%2Fshakefix');
    expect(fg.calls[0].headers['PRIVATE-TOKEN']).toBe('glpat-x');
  });

  it('SCM_PROVIDER=github builds the @shakefix/core GitHub provider', async () => {
    const config = loadConfig({ SCM_PROVIDER: 'github', GITHUB_REPO: 'acme/splitpal', GITHUB_TOKEN: 'ghp_x' });
    expect(requiredScmKeys(config)).toEqual(['githubRepo', 'githubToken']);
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 201, text: async () => JSON.stringify({ number: 5, title: 't', body: 'd', labels: [{ name: 'shakefix' }], state: 'open', html_url: 'https://github.com/acme/splitpal/issues/5' }) };
    };
    const scm = await createScm(config, { fetch });
    expect(scm.name).toBe('github');
    const issue = await scm.createIssue({ title: 't', description: 'd', labels: ['shakefix'] });
    // GitHub issues come back in the GitLab shape app.js reads (iid, web_url)
    expect(issue).toMatchObject({ iid: 5, web_url: 'https://github.com/acme/splitpal/issues/5' });
    expect(calls[0].url).toBe('https://api.github.com/repos/acme/splitpal/issues');
    expect(calls[0].init.headers.authorization).toBe('Bearer ghp_x');
  });

  it('GitHub errors are ScmErrors so app.js maps them to 502 gitlab_error like GitlabError', async () => {
    const config = loadConfig({ SCM_PROVIDER: 'github', GITHUB_REPO: 'acme/splitpal', GITHUB_TOKEN: 'ghp_x' });
    const scm = await createScm(config, { fetch: async () => ({ ok: false, status: 500, text: async () => '{}' }) });
    const err = await scm.addIssueNote(1, 'x').catch((e) => e);
    expect(err.isScmError).toBe(true);
    expect(err).not.toBeInstanceOf(GitlabError);
  });
});
