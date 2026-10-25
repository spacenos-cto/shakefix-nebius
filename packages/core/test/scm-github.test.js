import { describe, expect, it } from 'vitest';
import { createGithubProvider, GithubError, NotSupportedError, scopedRemovals, closingRefsFromText } from '../src/scm/index.js';
import { fakeFetch } from './helpers.js';

const R = '/repos/acme/splitpal';

function ghRoutes(state = {}) {
  return (call) => {
    const p = call.path;
    const m = call.method;
    if (m === 'GET' && p === R) return { body: { default_branch: 'main' } };
    if (m === 'GET' && p === `${R}/issues` ) return { body: [{ number: 3, pull_request: {}, title: 'pr' }, { number: 4, title: 'dup', body: 'x', labels: [{ name: 'dup::abcd1234' }], state: 'open', html_url: 'https://github.com/acme/splitpal/issues/4' }] };
    if (m === 'GET' && p === `${R}/issues/7/labels`) return { body: [{ name: 'shakefix' }, { name: 'shakefix::proof' }, { name: 'sev::2' }] };
    if (m === 'GET' && /\/issues\/\d+$/.test(p)) {
      const n = Number(p.split('/').pop());
      return { body: { number: n, title: `issue ${n}`, body: n === 9 ? '<!-- shakefix:rid=r_20261011_abc123 -->' : '', labels: [{ name: 'shakefix' }], state: 'open', html_url: `https://github.com/acme/splitpal/issues/${n}` } };
    }
    if (m === 'DELETE' && p.includes('/labels/')) return p.endsWith('/missing') ? { status: 404, body: { message: 'Label does not exist' } } : { body: [] };
    if (m === 'GET' && p.startsWith(`${R}/contents/`)) return state.exists ? { body: { sha: 'oldsha' } } : { status: 404, body: { message: 'Not Found' } };
    if (m === 'PUT' && p.startsWith(`${R}/contents/`)) return { status: 201, body: { content: { download_url: 'https://raw.githubusercontent.com/acme/splitpal/main/reports/uploads/a.png' }, commit: { sha: 'c1' } } };
    if (m === 'GET' && p === `${R}/git/ref/heads/main`) return { body: { object: { sha: 'base1' } } };
    if (m === 'GET' && p.startsWith(`${R}/git/ref/heads/`)) return state.branchExists ? { body: { object: { sha: 'tip1' } } } : { status: 404, body: { message: 'Not Found' } };
    if (m === 'GET' && p.startsWith(`${R}/git/commits/`)) return { body: { sha: p.split('/').pop(), tree: { sha: 'tree0' } } };
    if (m === 'POST' && p === `${R}/git/trees`) return { status: 201, body: { sha: 'tree1' } };
    if (m === 'POST' && p === `${R}/git/commits`) return { status: 201, body: { sha: 'commit1', html_url: 'https://github.com/acme/splitpal/commit/commit1' } };
    if (p === `${R}/pulls` && m === 'POST') return { status: 201, body: { number: 12, title: call.body.title, body: call.body.body, head: { ref: call.body.head, sha: 'h1' }, base: { ref: call.body.base }, state: 'open', html_url: 'https://github.com/acme/splitpal/pull/12', labels: [] } };
    if (m === 'GET' && p === `${R}/pulls/12`) return { body: { number: 12, title: 'Fix #9: settle', body: 'chart\n\nCloses #9', head: { ref: 'shakefix/9-settle', sha: 'h1', repo: { full_name: 'acme/splitpal' } }, base: { ref: 'main' }, state: 'open', draft: false, labels: [{ name: 'shakefix' }], html_url: 'https://github.com/acme/splitpal/pull/12' } };
    if (m === 'PUT' && p === `${R}/pulls/12/merge`) return { body: { merged: true, sha: 'm1' } };
    return { status: m === 'POST' ? 201 : 200, body: { id: 1 } };
  };
}

const mk = (ff, extra = {}) => createGithubProvider({ repo: 'acme/splitpal', token: 'ghp_secret', fetch: ff.fetch, ...extra });

describe('github provider request shapes', () => {
  it('sends Bearer auth + API version; createIssue maps description -> body', async () => {
    const ff = fakeFetch(ghRoutes());
    await mk(ff).createIssue({ title: 'Settle does nothing', description: 'desc', labels: ['shakefix', 'sev::2'] });
    const c = ff.calls[0];
    expect(c).toMatchObject({ method: 'POST', url: 'https://api.github.com/repos/acme/splitpal/issues' });
    expect(c.headers.authorization).toBe('Bearer ghp_secret');
    expect(c.headers['x-github-api-version']).toBe('2022-11-28');
    expect(c.headers.accept).toBe('application/vnd.github+json');
    expect(c.body).toEqual({ title: 'Settle does nothing', body: 'desc', labels: ['shakefix', 'sev::2'] });
  });

  it('findOpenIssueByLabel skips pull requests and normalises to GitLab shape', async () => {
    const ff = fakeFetch(ghRoutes());
    const i = await mk(ff).findOpenIssueByLabel('dup::abcd1234');
    expect(ff.calls[0].query).toMatchObject({ labels: 'dup::abcd1234', state: 'open', sort: 'created', direction: 'asc' });
    expect(i).toMatchObject({ iid: 4, title: 'dup', description: 'x', labels: ['dup::abcd1234'], state: 'opened', web_url: 'https://github.com/acme/splitpal/issues/4' });
  });

  it('updateIssue emulates scoped labels: adding shakefix::ready removes shakefix::proof; reopen -> PATCH state', async () => {
    const ff = fakeFetch(ghRoutes());
    await mk(ff).updateIssue(7, { addLabels: ['shakefix::ready'], removeLabels: ['missing'], stateEvent: 'reopen' });
    const seq = ff.calls.map((c) => `${c.method} ${c.path.replace(R, '')}`);
    expect(seq.slice(0, 5)).toEqual([
      'GET /issues/7/labels',
      'DELETE /issues/7/labels/missing',
      'DELETE /issues/7/labels/shakefix%3A%3Aproof',
      'POST /issues/7/labels',
      'PATCH /issues/7',
    ]);
    expect(ff.calls[3].body).toEqual({ labels: ['shakefix::ready'] });
    expect(ff.calls[4].body).toEqual({ state: 'open' });
  });

  it('scopedRemovals keeps unscoped and same labels', () => {
    expect(scopedRemovals(['shakefix', 'shakefix::proof', 'sev::2'], ['shakefix::ready'], [])).toEqual(['shakefix::proof']);
    expect(scopedRemovals(['shakefix::ready'], ['shakefix::ready'], ['shakefix::ready'])).toEqual([]);
  });

  it('labelMap renames labels on the way out', async () => {
    const ff = fakeFetch(ghRoutes());
    await mk(ff, { labelMap: { 'needs-human': 'help wanted' } }).updateIssue(8, { addLabels: ['needs-human'] });
    expect(ff.calls[0].body).toEqual({ labels: ['help wanted'] });
  });

  it('commitFile uses the contents API (base64) and passes the sha of an existing file', async () => {
    const ff = fakeFetch(ghRoutes({ exists: true }));
    await mk(ff).commitFile({ branch: 'main', filePath: 'reports/r_1/replay.json', content: '{"a":1}', message: 'chore: replay [skip ci]' });
    const put = ff.calls[1];
    expect(put).toMatchObject({ method: 'PUT', path: `${R}/contents/reports/r_1/replay.json` });
    expect(put.body).toEqual({ message: 'chore: replay [skip ci]', content: Buffer.from('{"a":1}').toString('base64'), branch: 'main', sha: 'oldsha' });
  });

  it('commitFiles makes ONE commit via the git data API and creates a new branch ref', async () => {
    const ff = fakeFetch(ghRoutes({ branchExists: false }));
    const res = await mk(ff).commitFiles({ branch: 'shakefix/9-settle', message: 'fix: x', files: [{ path: 'a.js', content: 'A' }, { path: 'b.js', action: 'delete' }] });
    const seq = ff.calls.map((c) => `${c.method} ${c.path.replace(R, '')}`);
    expect(seq).toEqual([
      'GET /git/ref/heads/shakefix/9-settle',
      'GET ',
      'GET /git/ref/heads/main',
      'GET /git/commits/base1',
      'POST /git/trees',
      'POST /git/commits',
      'POST /git/refs',
    ]);
    expect(ff.calls[4].body).toEqual({ base_tree: 'tree0', tree: [{ path: 'a.js', mode: '100644', type: 'blob', content: 'A' }, { path: 'b.js', mode: '100644', type: 'blob', sha: null }] });
    expect(ff.calls[5].body).toEqual({ message: 'fix: x', tree: 'tree1', parents: ['base1'] });
    expect(ff.calls[6].body).toEqual({ ref: 'refs/heads/shakefix/9-settle', sha: 'commit1' });
    expect(res.sha).toBe('commit1');
  });

  it('commitFiles on an existing branch fast-forwards the ref', async () => {
    const ff = fakeFetch(ghRoutes({ branchExists: true }));
    await mk(ff).commitFiles({ branch: 'shakefix/9-settle', message: 'fix: y', files: [{ path: 'a.js', content: 'B' }] });
    const last = ff.calls.at(-1);
    expect(last).toMatchObject({ method: 'PATCH', path: `${R}/git/refs/heads/shakefix/9-settle`, body: { sha: 'commit1', force: false } });
  });

  it('createMR opens a PR and applies labels through the issues API', async () => {
    const ff = fakeFetch(ghRoutes());
    const pr = await mk(ff).createMR({ sourceBranch: 'shakefix/9-settle', targetBranch: 'main', title: 'Fix #9', description: 'chart', labels: ['shakefix', 'shakefix::proof'] });
    expect(ff.calls[0]).toMatchObject({ method: 'POST', path: `${R}/pulls`, body: { title: 'Fix #9', head: 'shakefix/9-settle', base: 'main', body: 'chart' } });
    expect(ff.calls.some((c) => c.method === 'POST' && c.path === `${R}/issues/12/labels`)).toBe(true);
    expect(pr).toMatchObject({ iid: 12, source_branch: 'shakefix/9-settle', target_branch: 'main', labels: ['shakefix', 'shakefix::proof'] });
  });

  it('getMR normalises a PR; mrClosesIssues / linkedIssue read "Closes #n"', async () => {
    const ff = fakeFetch(ghRoutes());
    const gh = mk(ff);
    expect(await gh.getMR(12)).toMatchObject({ iid: 12, description: 'chart\n\nCloses #9', source_branch: 'shakefix/9-settle', sha: 'h1', state: 'opened', draft: false });
    expect((await gh.mrClosesIssues(12)).map((i) => i.iid)).toEqual([9]);
    expect((await gh.linkedIssue(12)).iid).toBe(9);
    expect(await gh.findRidInIssue(9)).toBe('r_20261011_abc123');
    expect(closingRefsFromText('Fixes #3, resolves #4 and closes #3')).toEqual([3, 4]);
  });

  it('mergeMR squash-merges with the head sha and deletes the source branch', async () => {
    const ff = fakeFetch(ghRoutes());
    await mk(ff).mergeMR(12, { sha: 'h1', commitMessage: 'Fix #9 (#12)' });
    expect(ff.calls[0]).toMatchObject({ method: 'PUT', path: `${R}/pulls/12/merge`, body: { merge_method: 'squash', sha: 'h1', commit_title: 'Fix #9 (#12)' } });
    expect(ff.calls.at(-1)).toMatchObject({ method: 'DELETE', path: `${R}/git/refs/heads/shakefix/9-settle` });
  });

  it('comments go to the issues comments API for both issues and PRs', async () => {
    const ff = fakeFetch(ghRoutes());
    await mk(ff).addIssueNote(9, 'a');
    await mk(ff).addMRNote(12, 'b');
    expect(ff.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${R}/issues/9/comments`, `POST ${R}/issues/12/comments`]);
  });

  it('uploadFile commits under reports/uploads with [skip ci] and returns markdown', async () => {
    const ff = fakeFetch(ghRoutes());
    const up = await mk(ff).uploadFile({ filename: 'r_1.png', data: Buffer.from([1, 2]) });
    const put = ff.calls.find((c) => c.method === 'PUT');
    expect(put.path).toBe(`${R}/contents/reports/uploads/r_1.png`);
    expect(put.body.message).toMatch(/\[skip ci\]/);
    expect(up.markdown).toMatch(/^!\[r_1\.png\]\(https:\/\//);
  });

  it('startFlow is not supported; errors never leak the token; repo must be owner/name', async () => {
    const ff = fakeFetch(() => ({ status: 401, body: { message: 'Bad credentials' } }));
    expect(() => mk(ff).startFlow({})).toThrow(NotSupportedError);
    const err = await mk(ff).getIssue(1).catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err.status).toBe(401);
    expect(err.message).not.toContain('ghp_secret');
    expect(() => createGithubProvider({ repo: 'nope', token: 't' })).toThrow(/owner\/name/);
  });
});
