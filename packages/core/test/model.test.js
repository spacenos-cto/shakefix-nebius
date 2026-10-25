import { describe, expect, it } from 'vitest';
import { createAnthropicModel, createOpenAICompatibleModel, extractJson, completeJson, ModelError } from '../src/model/index.js';
import { fakeFetch } from './helpers.js';

const anthropicOk = (text, extra = {}) => ({ body: { content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra } });
const openaiOk = (text, finish = 'stop') => ({ body: { choices: [{ message: { role: 'assistant', content: text }, finish_reason: finish }] } });

describe('anthropic provider', () => {
  it('posts a Messages API request and returns the first text block', async () => {
    const ff = fakeFetch(() => anthropicOk('hello'));
    const m = createAnthropicModel({ apiKey: 'sk-test', model: 'claude-sonnet-4-5', fetch: ff.fetch });
    const out = await m.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 321, temperature: 0.2 });
    expect(out).toBe('hello');
    const c = ff.calls[0];
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.headers).toMatchObject({ 'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
    expect(c.body).toEqual({ model: 'claude-sonnet-4-5', max_tokens: 321, temperature: 0.2, system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
  });

  it('honours baseUrl; `user` is shorthand for one user message', async () => {
    const ff = fakeFetch(() => anthropicOk('x'));
    await createAnthropicModel({ apiKey: 'k', baseUrl: 'https://proxy.test/', fetch: ff.fetch }).complete({ user: 'u' });
    expect(ff.calls[0].url).toBe('https://proxy.test/v1/messages');
    expect(ff.calls[0].body.messages).toEqual([{ role: 'user', content: 'u' }]);
  });

  it('rejects truncated output and missing text', async () => {
    const t = createAnthropicModel({ apiKey: 'k', fetch: fakeFetch(() => anthropicOk('par', { stop_reason: 'max_tokens' })).fetch, retries: 0 });
    await expect(t.complete({ user: 'u' })).rejects.toThrow(/truncated/);
    const n = createAnthropicModel({ apiKey: 'k', fetch: fakeFetch(() => ({ body: { content: [] } })).fetch, retries: 0 });
    await expect(n.complete({ user: 'u' })).rejects.toThrow(/no text block/);
    await expect(createAnthropicModel({}).complete({ user: 'u' })).rejects.toThrow(/API key/);
  });

  it('retries once on 5xx / 429, not on 4xx', async () => {
    let n = 0;
    const ff = fakeFetch(() => (++n === 1 ? { status: 529, body: {} } : anthropicOk('second')));
    expect(await createAnthropicModel({ apiKey: 'k', fetch: ff.fetch, retryDelayMs: 0 }).complete({ user: 'u' })).toBe('second');
    expect(ff.calls).toHaveLength(2);

    const bad = fakeFetch(() => ({ status: 400, body: {} }));
    const err = await createAnthropicModel({ apiKey: 'k', fetch: bad.fetch, retryDelayMs: 0 }).complete({ user: 'u' }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.message).toBe('anthropic HTTP 400');
    expect(bad.calls).toHaveLength(1);

    const always = fakeFetch(() => ({ status: 503, body: {} }));
    await expect(createAnthropicModel({ apiKey: 'k', fetch: always.fetch, retryDelayMs: 0 }).complete({ user: 'u' })).rejects.toThrow(/503/);
    expect(always.calls).toHaveLength(2);
  });

  it('a network error or timeout is retried and reported', async () => {
    const ff = fakeFetch(() => ({ throw: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }));
    const err = await createAnthropicModel({ apiKey: 'k', fetch: ff.fetch, retryDelayMs: 0, timeoutMs: 5 }).complete({ user: 'u' }).catch((e) => e);
    expect(err.message).toMatch(/timeout after 5 ms/);
    expect(ff.calls).toHaveLength(2);
  });

  it('passes an AbortSignal (timeout) to fetch', async () => {
    let signal;
    const m = createAnthropicModel({ apiKey: 'k', fetch: async (_u, init) => { signal = init.signal; return { ok: true, status: 200, json: async () => anthropicOk('x').body }; } });
    await m.complete({ user: 'u' });
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('openai-compatible provider (Nebius / Vultr / OpenRouter / Together)', () => {
  it('posts /chat/completions with the system prompt first and Bearer auth', async () => {
    const ff = fakeFetch(() => openaiOk('{"a":1}'));
    const m = createOpenAICompatibleModel({ apiKey: 'nb-key', model: 'nvidia/Llama-3_1-Nemotron-Ultra-253B-v1', baseUrl: 'https://api.studio.nebius.com/v1/', fetch: ff.fetch });
    expect(await m.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, temperature: 0 })).toBe('{"a":1}');
    const c = ff.calls[0];
    expect(c.url).toBe('https://api.studio.nebius.com/v1/chat/completions');
    expect(c.headers.authorization).toBe('Bearer nb-key');
    expect(c.body).toEqual({
      model: 'nvidia/Llama-3_1-Nemotron-Ultra-253B-v1',
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      max_tokens: 50,
      temperature: 0,
    });
  });

  it('works without an API key (local servers) and joins content parts', async () => {
    const ff = fakeFetch(() => ({ body: { choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, finish_reason: 'stop' }] } }));
    const m = createOpenAICompatibleModel({ model: 'm', baseUrl: 'http://localhost:8000/v1', fetch: ff.fetch });
    expect(await m.complete({ user: 'u' })).toBe('ab');
    expect(ff.calls[0].headers.authorization).toBeUndefined();
  });

  it('rejects empty / truncated replies and needs baseUrl + model', async () => {
    const empty = createOpenAICompatibleModel({ model: 'm', baseUrl: 'https://x/v1', fetch: fakeFetch(() => ({ body: { choices: [] } })).fetch, retries: 0 });
    await expect(empty.complete({ user: 'u' })).rejects.toThrow(/no message content/);
    const cut = createOpenAICompatibleModel({ model: 'm', baseUrl: 'https://x/v1', fetch: fakeFetch(() => openaiOk('par', 'length')).fetch, retries: 0 });
    await expect(cut.complete({ user: 'u' })).rejects.toThrow(/truncated/);
    expect(() => createOpenAICompatibleModel({ model: 'm' })).toThrow(/MODEL_BASE_URL/);
    expect(() => createOpenAICompatibleModel({ baseUrl: 'https://x' })).toThrow(/MODEL_NAME/);
  });

  it('retries once on 429', async () => {
    let n = 0;
    const ff = fakeFetch(() => (++n === 1 ? { status: 429, body: {} } : openaiOk('ok')));
    const m = createOpenAICompatibleModel({ model: 'm', baseUrl: 'https://x/v1', fetch: ff.fetch, retryDelayMs: 0 });
    expect(await m.complete({ user: 'u' })).toBe('ok');
    expect(ff.calls).toHaveLength(2);
  });
});

describe('JSON extraction', () => {
  it('parses plain JSON, fenced JSON and JSON surrounded by prose', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"labels":[{"id":"c1"}]}\n```')).toEqual({ labels: [{ id: 'c1' }] });
    expect(extractJson('Sure! Here it is: {"tool":"read_file","args":{"file_path":"a"}} Hope that helps.')).toEqual({ tool: 'read_file', args: { file_path: 'a' } });
  });

  it('respects braces and quotes inside strings and returns the FIRST object', () => {
    expect(extractJson('{"s":"a } b { \\"q\\" }","n":{"x":[1,2]}} {"second":true}')).toEqual({ s: 'a } b { "q" }', n: { x: [1, 2] } });
  });

  it('skips a broken candidate and finds the next valid object', () => {
    expect(extractJson('{not json} then {"ok":true}')).toEqual({ ok: true });
  });

  it('throws when there is no JSON object', () => {
    expect(() => extractJson('reproduced')).toThrow(ModelError);
    expect(() => extractJson('{"open": ')).toThrow(/no JSON object/);
    expect(() => extractJson(undefined)).toThrow();
  });

  it('completeJson = complete + extractJson', async () => {
    const m = { complete: async () => 'Answer: {"approve":true,"confidence":0.9}' };
    expect(await completeJson(m, { user: 'u' })).toEqual({ approve: true, confidence: 0.9 });
  });
});
