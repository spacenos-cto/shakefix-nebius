import { describe, expect, it, vi } from 'vitest';
import { labelProof, labelerModelFromEnv, labelResponseFormatFromEnv } from '../src/label.js';
import { gitlabFromEnv, scmFromEnv, scmConfigured, withProofApi } from '../src/gitlab.js';
import { allChanges } from '../src/diff.js';
import { fx, fxText, b1Proof } from './helpers.js';

const issue = fxText('b1/issue.md');
const replay = fx('b1/replay.json');

const okResponse = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });

describe('labeler model from env (default path unchanged)', () => {
  it('default: Claude via ANTHROPIC_API_KEY + PROOF_MODEL + ANTHROPIC_BASE_URL', () => {
    const m = labelerModelFromEnv({ ANTHROPIC_API_KEY: 'k', PROOF_MODEL: 'claude-x', ANTHROPIC_BASE_URL: 'https://p' });
    expect(m).toMatchObject({ name: 'anthropic', model: 'claude-x' });
    expect(labelerModelFromEnv({ ANTHROPIC_API_KEY: 'k' }).model).toBe('claude-sonnet-4-5');
  });

  it('no key -> null (rules fallback, same error text as before)', async () => {
    expect(labelerModelFromEnv({})).toBe(null);
    const res = await labelProof(b1Proof(), { issueText: issue, replays: [replay], llm: labelerModelFromEnv({}) || undefined });
    expect(res).toMatchObject({ labeler: 'rules', error: 'ANTHROPIC_API_KEY not set' });
  });

  it('default anthropic labeler does NOT retry (one request on failure, as before)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 529, json: async () => ({}) }));
    const res = await labelProof(b1Proof(), { issueText: issue, replays: [replay], llm: labelerModelFromEnv({ ANTHROPIC_API_KEY: 'k' }, { fetchImpl }) });
    expect(res.labeler).toBe('rules');
    expect(res.error).toBe('anthropic HTTP 529');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('MODEL_PROVIDER=none is rules-only', async () => {
    const res = await labelProof(b1Proof(), { issueText: issue, replays: [replay], llm: labelerModelFromEnv({ MODEL_PROVIDER: 'none', ANTHROPIC_API_KEY: 'k' }) });
    expect(res).toMatchObject({ labeler: 'rules', error: 'MODEL_PROVIDER=none (rules only)' });
    expect(res.proof.summary.unintended).toBe(1);
  });

  it('MODEL_PROVIDER=openai-compatible (Nebius Token Factory Nemotron) labels through /chat/completions', async () => {
    // Nemotron is a reasoning model: it emits a <think> block and prose before the JSON. The labeler
    // must still parse it (so the live Second Opinion runs on Nemotron, not the rules fallback).
    const fetchImpl = vi.fn(async (_url, init) => {
      const user = JSON.parse(init.body).messages[1].content;
      const ids = JSON.parse(user.split('## Changes\n')[1]).map((c) => c.id);
      const labels = ids.map((id) => ({ id, label: id === 'c1' ? 'unintended' : 'intended', reason: 'nemotron says so' }));
      const content = `<think>\nc1 is on a bill the replay never touched.\n</think>\nHere you go:\n${JSON.stringify({ labels })}`;
      return okResponse({ choices: [{ message: { content }, finish_reason: 'stop' }] });
    });
    const llm = labelerModelFromEnv({ MODEL_PROVIDER: 'openai-compatible', MODEL_BASE_URL: 'https://api.tokenfactory.nebius.com/v1', MODEL_NAME: 'nvidia/Nemotron-3-Ultra-550b-a55b', MODEL_API_KEY: 'nb' }, { fetchImpl });
    const res = await labelProof(b1Proof(), { issueText: issue, replays: [replay], llm });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.tokenfactory.nebius.com/v1/chat/completions');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'nvidia/Nemotron-3-Ultra-550b-a55b', max_tokens: 1500, temperature: 0 });
    expect(JSON.parse(init.body).messages[0].role).toBe('system');
    expect(res.labeler).toBe('llm');
    expect(allChanges(res.proof).find((c) => c.id === 'c1').reason).toBe('nemotron says so');
  });

  it('PROOF_RESPONSE_FORMAT=json_schema sends a response_format to Token Factory', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const user = JSON.parse(init.body).messages[1].content;
      const ids = JSON.parse(user.split('## Changes\n')[1]).map((c) => c.id);
      return okResponse({ choices: [{ message: { content: JSON.stringify({ labels: ids.map((id) => ({ id, label: 'intended', reason: 'r' })) }) }, finish_reason: 'stop' }] });
    });
    const llm = labelerModelFromEnv({ MODEL_PROVIDER: 'openai-compatible', MODEL_BASE_URL: 'https://api.tokenfactory.nebius.com/v1', MODEL_NAME: 'nvidia/nemotron', MODEL_API_KEY: 'nb', PROOF_RESPONSE_FORMAT: 'json_schema' }, { fetchImpl });
    const res = await labelProof(b1Proof(), { issueText: issue, replays: [replay], llm, responseFormat: labelResponseFormatFromEnv({ PROOF_RESPONSE_FORMAT: 'json_schema' }) });
    expect(res.labeler).toBe('llm');
    const rf = JSON.parse(fetchImpl.mock.calls[0][1].body).response_format;
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.properties.labels.items.properties.label.enum).toEqual(['intended', 'unintended']);
  });
});

describe('Second Opinion SCM from env', () => {
  it('gitlab (default) needs the same CI variables and error text as before', () => {
    expect(() => scmFromEnv({})).toThrow('GitLab API needs env: CI_API_V4_URL, CI_PROJECT_ID, SHAKEFIX_BOT_TOKEN');
    expect(() => gitlabFromEnv({ CI_API_V4_URL: 'x' })).toThrow('GitLab API needs env: CI_PROJECT_ID, SHAKEFIX_BOT_TOKEN');
    expect(scmConfigured({ CI_API_V4_URL: 'x', CI_PROJECT_ID: '1', SHAKEFIX_BOT_TOKEN: 't' })).toBe(true);
    expect(scmConfigured({ SCM_PROVIDER: 'github', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' })).toBe(true);
    expect(scmConfigured({ SCM_PROVIDER: 'github' })).toBe(false);
  });

  it('gitlab postMRNote / getMR keep their request shape', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ iid: 42, labels: ['shakefix'] }));
    const gl = scmFromEnv({ CI_API_V4_URL: 'https://gitlab.test/api/v4', CI_PROJECT_ID: '7', SHAKEFIX_BOT_TOKEN: 'glpat' }, fetchImpl);
    await gl.postMRNote(42, 'report');
    expect((await gl.getMR(42)).labels).toEqual(['shakefix']);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://gitlab.test/api/v4/projects/7/merge_requests/42/notes');
    expect(init.method).toBe('POST');
    expect(init.headers['PRIVATE-TOKEN']).toBe('glpat');
    expect(JSON.parse(init.body)).toEqual({ body: 'report' });
  });

  it('SCM_PROVIDER=github posts the Behavior Diff as a PR comment', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ id: 1 }));
    const gh = scmFromEnv({ SCM_PROVIDER: 'github', GITHUB_REPOSITORY: 'acme/splitpal', GITHUB_TOKEN: 'ghs' }, fetchImpl);
    await gh.postMRNote(12, 'report');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/acme/splitpal/issues/12/comments');
    expect(init.headers.authorization).toBe('Bearer ghs');
  });
});

describe('upsertMRNote', () => {
  const fake = (notes) => {
    const calls = [];
    return {
      calls,
      scm: withProofApi({
        listMRNotes: async () => notes,
        updateMRNote: async (iid, id, body) => { calls.push(['update', id, body]); return { id }; },
        addMRNote: async (iid, body) => { calls.push(['add', body]); return { id: 99 }; },
      }),
    };
  };
  const M = '<!-- shakefix:second-opinion-report -->';

  it('edits the earlier Behavior Diff note instead of stacking a new one', async () => {
    const { scm, calls } = fake([{ id: 1, body: 'hi' }, { id: 7, body: `old\n${M}` }]);
    const res = await scm.upsertMRNote(2, `new\n${M}`, M);
    expect(res.updated).toBe(true);
    expect(calls).toEqual([['update', 7, `new\n${M}`]]);
  });

  it('posts a new note the first time', async () => {
    const { scm, calls } = fake([{ id: 1, body: 'hi' }]);
    await scm.upsertMRNote(2, `new\n${M}`, M);
    expect(calls[0][0]).toBe('add');
  });
});
