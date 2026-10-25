// Medical Record hook: a reporter rejection appends a lesson and counts the verdict (docs/MEMORY.md).
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createGitlabClient } from '../src/gitlab.js';
import { signBody } from '../src/hmac.js';
import { appendLessonText, lessonFromRejection, recordRejection } from '../src/memory.js';
import { createMemoryStore } from '../src/store/memory.js';
import { fakeGitlab, makeReplay, testConfig } from './helpers.js';

const RID = 'r_20261011_8f3a01';
const ORIGIN = 'https://splitpal.example.run.app';

function fakeRepo(files = {}) {
  const commits = [];
  return {
    commits,
    getFile: async (p) => { if (p in files) return files[p]; const e = new Error('404'); e.status = 404; throw e; },
    commitFiles: async (c) => { commits.push(c); return { id: 'x' }; },
  };
}

describe('recordRejection', () => {
  const replay = makeReplay({ note: 'still broken', actions: [{ t: 0, type: 'click', testid: 'settle-btn', selector: 'x', route: '/bill/7/settle' }] });
  it('appends a reporter-rejected lesson using the case files and bumps the verdict count', async () => {
    const caseJson = JSON.stringify({ iid: 41, root_cause: { file: 'apps/splitpal/src/lib/split.js', pattern: 'money-rounding' }, fix: { files: ['apps/splitpal/src/lib/split.js'] }, reporter_verdicts: { confirmed: 0, rejected: 0 }, timestamps: {} });
    const index = JSON.stringify({ schema: 'shakefix.memory-index/v1', generated_at: null, cases: [{ iid: 41, verdicts: { confirmed: 0, rejected: 0 } }], lessons: [], stats: {} });
    const repo = fakeRepo({ '.shakefix/memory/cases/41.json': caseJson, '.shakefix/memory/index.json': index });
    const r = await recordRejection({ gitlab: repo, branch: 'main', iid: 41, replay, now: '2026-10-12T00:00:00Z' });
    expect(r).toEqual({ committed: true, lesson: 'L1', added: true });
    const [c] = repo.commits;
    expect(c.branch).toBe('main');
    expect(c.message).toBe('chore(memory): reporter rejected the fix for #41, lesson L1 [skip ci]');
    expect(c.files.map((f) => f.path)).toEqual(['.shakefix/memory/lessons.md', '.shakefix/memory/cases/41.json', '.shakefix/memory/index.json']);
    expect(c.files[0].content).toContain('## L1 · reporter-rejected · case #41\nAlways replay the reporter\'s latest replay on /bill/:id/settle before discharge');
    expect(c.files[0].content).toContain('- files: apps/splitpal/src/lib/split.js\n- patterns: money-rounding');
    expect(JSON.parse(c.files[1].content).reporter_verdicts).toEqual({ confirmed: 0, rejected: 1 });
    const idx = JSON.parse(c.files[2].content);
    expect(idx.lessons[0].id).toBe('L1');
    expect(idx.cases[0].verdicts.rejected).toBe(1);
  });
  it('dedupes the same lesson', () => {
    const l = lessonFromRejection({ iid: 41, route: '/bill/:id', note: 'x' });
    const a = appendLessonText('', l, 'now');
    expect(appendLessonText(a.md, l, 'now')).toMatchObject({ added: false, lesson: { id: 'L1' } });
  });
});

describe('POST /verdict rejected with MEMORY_LESSONS on', () => {
  it('commits the lesson to the default branch after the reopen, and a failure never breaks the verdict', async () => {
    for (const failMemory of [false, true]) {
      const config = testConfig({ memoryLessons: true });
      const fg = fakeGitlab({ failOn: failMemory ? (m, p) => m === 'POST' && /repository\/commits$/.test(p) && fg.calls.filter((c) => /repository\/commits$/.test(c.path)).length > 2 : null });
      const gitlab = createGitlabClient({ baseUrl: config.gitlabUrl, projectId: config.projectId, token: config.humanPat, fetch: fg.fetch });
      const app = buildApp({ config, gitlab, store: createMemoryStore(), pusher: { mode: 'poll', send: async () => ({ ok: true }) } });
      const inj = (url, body, headers = {}) => app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, payload: typeof body === 'string' ? body : JSON.stringify(body) });
      expect((await inj('/v1/reports', { replay: makeReplay() })).statusCode).toBe(201);
      const fixedBody = JSON.stringify({ url: '/bill/7', mrIid: 42, proof: { intended: 1, unintended: 0 } });
      expect((await inj(`/v1/reports/${RID}/fixed`, fixedBody, { 'x-shakefix-signature': signBody('hook-secret', fixedBody) })).statusCode).toBe(200);
      const res = await inj(`/v1/reports/${RID}/verdict`, { verdict: 'rejected', replay: makeReplay({ note: 'nope' }) });
      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe('reopened');
      const commits = fg.calls.filter((c) => c.method === 'POST' && /repository\/commits$/.test(c.path));
      const memory = commits.find((c) => c.body.commit_message.startsWith('chore(memory)'));
      expect(memory.body.branch).toBe('main');
      expect(memory.body.actions[0]).toMatchObject({ action: 'create', file_path: '.shakefix/memory/lessons.md' });
    }
  });
});
