import { describe, expect, it } from 'vitest';
import { createGitlabClient, GitlabError } from '../src/gitlab.js';
import { fakeGitlab } from './helpers.js';

const mk = (fg) => createGitlabClient({ baseUrl: 'https://gitlab.test/', projectId: 'grp/shakefix', token: 'glpat-x', fetch: fg.fetch });

describe('gitlab client (fake fetch)', () => {
  it('sends PRIVATE-TOKEN and url-encodes the project id', async () => {
    const fg = fakeGitlab();
    expect(await mk(fg).defaultBranch()).toBe('main');
    expect(fg.calls[0].path).toBe('/projects/grp%2Fshakefix');
    expect(fg.calls[0].headers['PRIVATE-TOKEN']).toBe('glpat-x');
  });

  it('caches the default branch', async () => {
    const fg = fakeGitlab();
    const c = mk(fg);
    await c.defaultBranch();
    await c.defaultBranch();
    expect(fg.calls).toHaveLength(1);
  });

  it('commitFile posts a single create action', async () => {
    const fg = fakeGitlab();
    await mk(fg).commitFile({ branch: 'main', filePath: 'reports/r/replay.json', content: '{}', message: 'm [skip ci]' });
    expect(fg.calls[0]).toMatchObject({
      method: 'POST',
      path: '/projects/grp%2Fshakefix/repository/commits',
      body: { branch: 'main', commit_message: 'm [skip ci]', actions: [{ action: 'create', file_path: 'reports/r/replay.json', content: '{}' }] },
    });
  });

  it('uploadFile sends multipart form data', async () => {
    const fg = fakeGitlab();
    const up = await mk(fg).uploadFile({ filename: 'a.png', data: Buffer.from([1, 2, 3]) });
    expect(fg.calls[0].body).toBeInstanceOf(FormData);
    expect(up.markdown).toContain('/uploads/');
  });

  it('createIssue joins labels; findOpenIssueByLabel filters opened', async () => {
    const fg = fakeGitlab();
    const c = mk(fg);
    await c.createIssue({ title: 't', description: 'd', labels: ['shakefix', 'dup::abcd1234'] });
    expect(fg.calls[0].body.labels).toBe('shakefix,dup::abcd1234');
    const found = await c.findOpenIssueByLabel('dup::abcd1234');
    expect(found.iid).toBe(41);
    expect(fg.calls[1].query).toMatchObject({ labels: 'dup::abcd1234', state: 'opened' });
  });

  it('startFlow posts project_id, goal, workflow_definition', async () => {
    const fg = fakeGitlab();
    await mk(fg).startFlow({ goal: 'ShakeFix: fix issue #41', workflowDefinition: 'shakefix' });
    expect(fg.calls[0]).toMatchObject({
      path: '/ai/duo_workflows/workflows',
      body: { project_id: 'grp/shakefix', goal: 'ShakeFix: fix issue #41', workflow_definition: 'shakefix' },
    });
  });

  it('throws GitlabError without leaking the token', async () => {
    const fg = fakeGitlab({ failOn: () => true });
    const err = await mk(fg).addIssueNote(1, 'x').catch((e) => e);
    expect(err).toBeInstanceOf(GitlabError);
    expect(err.status).toBe(500);
    expect(err.message).not.toContain('glpat-x');
  });
});
