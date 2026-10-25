import { describe, expect, it } from 'vitest';
import {
  scmProviderName, scmConfigFromEnv, scmFromEnv, createScm,
  modelProviderName, modelConfigFromEnv, modelFromEnv, createModel, NoModelError,
  agentRunnerName, createAgentRunner,
} from '../src/index.js';

describe('SCM provider selection', () => {
  it('defaults to gitlab and rejects unknown names', () => {
    expect(scmProviderName({})).toBe('gitlab');
    expect(scmProviderName({ SCM_PROVIDER: 'GitHub' })).toBe('github');
    expect(() => scmProviderName({ SCM_PROVIDER: 'bitbucket' })).toThrow(/gitlab\|github/);
  });

  it('gitlab config is backward compatible with the CI and intake env names', () => {
    const ci = scmConfigFromEnv({ CI_API_V4_URL: 'https://gl.test/api/v4', CI_PROJECT_ID: '42', SHAKEFIX_BOT_TOKEN: 'bot', GITLAB_HUMAN_PAT: 'human' });
    expect(ci).toMatchObject({ provider: 'gitlab', apiUrl: 'https://gl.test/api/v4', projectId: '42', token: 'bot' });
    const intake = scmConfigFromEnv({ GITLAB_URL: 'https://gl.test/', GITLAB_PROJECT_ID: 'g/p', GITLAB_HUMAN_PAT: 'human', SHAKEFIX_BOT_TOKEN: 'bot' }, { prefer: 'human' });
    expect(intake).toMatchObject({ baseUrl: 'https://gl.test', projectId: 'g/p', token: 'human' });
    expect(scmConfigFromEnv({ GITLAB_TOKEN: 't', GITLAB_PROJECT_ID: '1' }).token).toBe('t');
  });

  it('github config reads GITHUB_REPO, falls back to GITHUB_REPOSITORY and GH_TOKEN', () => {
    expect(scmConfigFromEnv({ SCM_PROVIDER: 'github', GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x' }))
      .toMatchObject({ provider: 'github', repo: 'o/r', token: 'x', apiUrl: 'https://api.github.com' });
    expect(scmConfigFromEnv({ SCM_PROVIDER: 'github', GITHUB_REPO: 'a/b', GITHUB_REPOSITORY: 'o/r', SCM_LABEL_MAP: 'needs-human=help wanted' }))
      .toMatchObject({ repo: 'a/b', labelMap: { 'needs-human': 'help wanted' } });
  });

  it('scmFromEnv names the missing variables and builds the selected provider', () => {
    expect(() => scmFromEnv({})).toThrow(/GITLAB_PROJECT_ID\|CI_PROJECT_ID.*GITLAB_TOKEN/);
    expect(() => scmFromEnv({ SCM_PROVIDER: 'github' })).toThrow(/GITHUB_REPO, GITHUB_TOKEN/);
    expect(scmFromEnv({ GITLAB_PROJECT_ID: '1', GITLAB_TOKEN: 't' }).name).toBe('gitlab');
    expect(scmFromEnv({ SCM_PROVIDER: 'github', GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't' }).name).toBe('github');
    expect(() => createScm({ provider: 'svn' })).toThrow(/unknown SCM provider/);
  });
});

describe('model provider selection', () => {
  it('defaults to anthropic; accepts aliases; rejects unknown', () => {
    expect(modelProviderName({})).toBe('anthropic');
    expect(modelProviderName({ MODEL_PROVIDER: 'openai' })).toBe('openai-compatible');
    expect(modelProviderName({ MODEL_PROVIDER: 'rules' })).toBe('none');
    expect(() => modelProviderName({ MODEL_PROVIDER: 'gpt' })).toThrow(/anthropic\|openai-compatible\|none/);
  });

  it('MODEL_API_KEY falls back to ANTHROPIC_API_KEY, MODEL_BASE_URL to ANTHROPIC_BASE_URL', () => {
    expect(modelConfigFromEnv({ ANTHROPIC_API_KEY: 'a', ANTHROPIC_BASE_URL: 'https://proxy' }))
      .toMatchObject({ provider: 'anthropic', apiKey: 'a', baseUrl: 'https://proxy', model: 'claude-sonnet-4-5' });
    expect(modelConfigFromEnv({ ANTHROPIC_API_KEY: 'a', MODEL_API_KEY: 'm', MODEL_NAME: 'claude-x' }))
      .toMatchObject({ apiKey: 'm', model: 'claude-x' });
    expect(modelConfigFromEnv({}, { model: 'legacy' }).model).toBe('legacy');
  });

  it('openai-compatible needs MODEL_BASE_URL and MODEL_NAME; ANTHROPIC_API_KEY is not reused', () => {
    const env = { MODEL_PROVIDER: 'openai-compatible', MODEL_BASE_URL: 'https://api.studio.nebius.com/v1', MODEL_NAME: 'nvidia/nemotron', ANTHROPIC_API_KEY: 'a' };
    expect(modelConfigFromEnv(env)).toMatchObject({ apiKey: '', baseUrl: 'https://api.studio.nebius.com/v1', model: 'nvidia/nemotron' });
    expect(modelFromEnv(env).name).toBe('openai-compatible');
    expect(() => modelFromEnv({ MODEL_PROVIDER: 'openai-compatible', MODEL_NAME: 'x' })).toThrow(/MODEL_BASE_URL/);
  });

  it('none is rules-only: complete() rejects with NoModelError', async () => {
    const m = createModel({ provider: 'none' });
    expect(m.name).toBe('none');
    await expect(m.complete({ user: 'hi' })).rejects.toBeInstanceOf(NoModelError);
  });
});

describe('agent runner selection', () => {
  it('duo on GitLab, local on GitHub, explicit wins', () => {
    expect(agentRunnerName({})).toBe('duo');
    expect(agentRunnerName({ SCM_PROVIDER: 'github' })).toBe('local');
    expect(agentRunnerName({ AGENT_RUNNER: 'local' })).toBe('local');
    expect(() => agentRunnerName({ AGENT_RUNNER: 'crew' })).toThrow();
  });

  it('the duo runner has nothing to run locally', async () => {
    const r = await createAgentRunner({ runner: 'duo' }).run({ issue: 7 });
    expect(r).toMatchObject({ runner: 'duo', ran: false, issue: 7 });
    expect(r.message).toMatch(/Work item created/);
  });
});
