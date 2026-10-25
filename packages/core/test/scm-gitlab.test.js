import { describe, expect, it } from 'vitest';
import { createGitlabProvider, GitlabError, ScmError } from '../src/scm/index.js';
import { createGitlabClient } from '../../../services/intake/src/gitlab.js';
import { fakeFetch } from './helpers.js';

const P = '/api/v4/projects/grp%2Fshakefix';

function gitlabRoutes(call) {
  const p = call.path;
  if (call.method === 'GET' && p === P) return { body: { default_branch: 'main' } };
  if (p.endsWith('/repository/files/apps%2Fa.js') && call.method === 'HEAD') return { status: 200, body: '' };
  if (p.includes('/repository/files/') && call.method === 'HEAD') return { status: 404, body: { message: '404 File Not Found' } };
  if (p.endsWith('/raw')) return { body: '{"raw":true}' };
  if (p.endsWith('/merge_requests/5/closes_issues')) return { body: [] };
  if (p.endsWith('/merge_requests/5')) return { body: { iid: 5, title: 'Fix #9: settle', description: 'Closes #9', source_branch: 'shakefix/9-settle' } };
  if (p.endsWith('/issues/9')) return { body: { iid: 9, description: '<!-- shakefix:rid=r_20261011_abc123 -->\nbody' } };
  if (p.endsWith('/uploads')) return { status: 201, body: { url: '/uploads/x/a.png', markdown: '![a](/uploads/x/a.png)' } };
  return { status: call.method === 'POST' ? 201 : 200, body: { ok: true } };
}

const mk = (ff, extra = {}) => createGitlabProvider({ baseUrl: 'https://gitlab.test/', projectId: 'grp/shakefix', token: 'glpat-x', fetch: ff.fetch, ...extra });

describe('gitlab provider request shapes', () => {
  it('uses PRIVATE-TOKEN, /api/v4 and an url-encoded project id; apiUrl wins over baseUrl', async () => {
    const ff = fakeFetch(gitlabRoutes);
    expect(await mk(ff).defaultBranch()).toBe('main');
    expect(ff.calls[0].url).toBe('https://gitlab.test/api/v4/projects/grp%2Fshakefix');
    expect(ff.calls[0].headers['PRIVATE-TOKEN']).toBe('glpat-x');
    const ff2 = fakeFetch(gitlabRoutes);
    await createGitlabProvider({ apiUrl: 'https://ci.test/api/v4/', projectId: 7, token: 't', fetch: ff2.fetch }).getIssue(3);
    expect(ff2.calls[0].url).toBe('https://ci.test/api/v4/projects/7/issues/3');
  });

  it('commitFiles resolves upsert to create/update and creates the branch from startBranch', async () => {
    const ff = fakeFetch(gitlabRoutes);
    await mk(ff).commitFiles({
      branch: 'shakefix/9-settle', startBranch: 'main', message: 'fix(split): x (closes #9)',
      files: [{ path: 'apps/a.js', content: 'A' }, { path: 'tests/regressions/issue-9.spec.ts', content: 'S' }, { path: 'old.js', action: 'delete' }],
    });
    const heads = ff.calls.filter((c) => c.method === 'HEAD');
    expect(heads.map((c) => c.query.ref)).toEqual(['main', 'main']);
    const post = ff.calls.at(-1);
    expect(post).toMatchObject({ method: 'POST', path: `${P}/repository/commits` });
    expect(post.body).toEqual({
      branch: 'shakefix/9-settle', start_branch: 'main', commit_message: 'fix(split): x (closes #9)',
      actions: [
        { action: 'update', file_path: 'apps/a.js', content: 'A' },
        { action: 'create', file_path: 'tests/regressions/issue-9.spec.ts', content: 'S' },
        { action: 'delete', file_path: 'old.js' },
      ],
    });
  });

  it('createMR / updateMR / addMRNote / listMRNotes / mergeMR', async () => {
    const ff = fakeFetch(gitlabRoutes);
    const gl = mk(ff);
    await gl.createMR({ sourceBranch: 'shakefix/9-x', targetBranch: 'main', title: 'Fix #9', description: 'chart', labels: ['shakefix', 'shakefix::proof'] });
    await gl.updateMR(5, { addLabels: ['shakefix::ready'], removeLabels: ['shakefix::proof', 'shakefix::unintended'] });
    await gl.addMRNote(5, 'hello');
    await gl.listMRNotes(5);
    await gl.mergeMR(5, { sha: 'abc', commitMessage: 'Fix #9 (!5)' });
    const [create, update, note, list, merge] = ff.calls;
    expect(create).toMatchObject({ method: 'POST', path: `${P}/merge_requests` });
    expect(create.body).toEqual({ source_branch: 'shakefix/9-x', target_branch: 'main', title: 'Fix #9', description: 'chart', labels: 'shakefix,shakefix::proof', remove_source_branch: true, squash: true });
    expect(update).toMatchObject({ method: 'PUT', path: `${P}/merge_requests/5`, body: { add_labels: 'shakefix::ready', remove_labels: 'shakefix::proof,shakefix::unintended' } });
    expect(note).toMatchObject({ method: 'POST', path: `${P}/merge_requests/5/notes`, body: { body: 'hello' } });
    expect(list).toMatchObject({ method: 'GET', path: `${P}/merge_requests/5/notes`, query: { per_page: '100', sort: 'asc' } });
    expect(merge).toMatchObject({ method: 'PUT', path: `${P}/merge_requests/5/merge` });
    expect(merge.body).toEqual({ sha: 'abc', squash: true, should_remove_source_branch: true, auto_merge: true, merge_when_pipeline_succeeds: true, squash_commit_message: 'Fix #9 (!5)' });
  });

  it('getFile returns raw text; linkedIssue falls back to "#n" refs; findRidInIssue reads the marker', async () => {
    const ff = fakeFetch(gitlabRoutes);
    const gl = mk(ff);
    expect(await gl.getFile('reports/r/replay.json', 'reports')).toBe('{"raw":true}');
    expect(ff.calls[0].path).toBe(`${P}/repository/files/reports%2Fr%2Freplay.json/raw`);
    expect(ff.calls[0].query.ref).toBe('reports');
    expect((await gl.linkedIssue(5)).iid).toBe(9);
    expect(await gl.findRidInIssue(9)).toBe('r_20261011_abc123');
  });

  it('errors are GitlabError (an ScmError) and never contain the token', async () => {
    const ff = fakeFetch(() => ({ status: 403, body: { message: 'forbidden' } }));
    const err = await mk(ff).addIssueNote(1, 'x').catch((e) => e);
    expect(err).toBeInstanceOf(GitlabError);
    expect(err).toBeInstanceOf(ScmError);
    expect(err.isScmError).toBe(true);
    expect(err.status).toBe(403);
    expect(err.message).not.toContain('glpat-x');
  });
});

describe('drift guard: core gitlab provider == intake gitlab client', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const ops = [
    ['defaultBranch', []],
    ['commitFile', [{ branch: 'main', filePath: 'reports/r/replay.json', content: '{}', message: 'm [skip ci]' }]],
    ['createIssue', [{ title: 't', description: 'd', labels: ['shakefix', 'sev::2'] }]],
    ['findOpenIssueByLabel', ['dup::abcd1234']],
    ['updateIssue', [41, { addLabels: ['shakefix::reopened'], removeLabels: ['shakefix::deployed'], stateEvent: 'reopen' }]],
    ['addIssueNote', [41, 'note']],
    ['startFlow', [{ goal: 'ShakeFix: fix issue #41', workflowDefinition: 'shakefix' }]],
    ['uploadFile', [{ filename: 'a.png', data: png }]],
    ['getFile', ['.shakefix/memory/lessons.md', 'main']],
    ['commitFiles', [{ branch: 'main', message: 'chore(memory): x [skip ci]', files: [{ path: 'apps/a.js', content: 'A' }, { path: '.shakefix/memory/lessons.md', content: 'L' }] }]],
  ];
  it.each(ops)('%s sends the same request', async (name, args) => {
    const a = fakeFetch(gitlabRoutes);
    const b = fakeFetch(gitlabRoutes);
    const opts = { baseUrl: 'https://gitlab.test/', projectId: 'grp/shakefix', token: 'glpat-x' };
    await createGitlabClient({ ...opts, fetch: a.fetch })[name](...args);
    await createGitlabProvider({ ...opts, fetch: b.fetch })[name](...args);
    const strip = (calls) => calls.map(({ method, url, headers, body }) => ({ method, url, headers, body: body instanceof FormData ? 'FormData' : body }));
    expect(strip(b.calls)).toEqual(strip(a.calls));
  });
});
