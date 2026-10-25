// Model provider switch. MODEL_PROVIDER=anthropic (default) | openai-compatible | none.
//
// ModelProvider interface:
//   name, model
//   complete({system, messages: [{role:'user'|'assistant', content}], maxTokens, temperature}) -> Promise<string>
//
// openai-compatible covers any /chat/completions endpoint: Nebius Token Factory (Nemotron),
// Vultr Serverless Inference, OpenRouter, Together, vLLM, Ollama.
// Every HTTP provider has a timeout and (by default) one retry on network errors, 408, 429 and 5xx.

export const MODEL_PROVIDERS = Object.freeze(['anthropic', 'openai-compatible', 'none']);
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';
export const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com';

export class ModelError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.name = 'ModelError';
    this.status = status;
    this.retryable = retryable;
  }
}

export class NoModelError extends ModelError {
  constructor() {
    super('MODEL_PROVIDER=none: no language model configured (rules-only)');
    this.name = 'NoModelError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryableStatus = (s) => s === 408 || s === 429 || s >= 500;

/** Run fn with `retries` extra attempts on retryable failures. */
export async function withRetry(fn, { retries = 1, retryDelayMs = 1000 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      const retryable = err instanceof ModelError ? err.retryable : true; // network / timeout errors
      if (attempt >= retries || !retryable) throw err;
      attempt++;
      if (retryDelayMs) await sleep(retryDelayMs * attempt);
    }
  }
}

async function post(fetchImpl, url, headers, body, { timeoutMs, label }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ModelError(`${label}: ${err?.name === 'TimeoutError' ? `timeout after ${timeoutMs} ms` : err?.message || err}`, { retryable: true });
  }
  if (!res.ok) throw new ModelError(`${label} HTTP ${res.status}`, { status: res.status, retryable: retryableStatus(res.status) });
  return res.json();
}

const asMessages = (messages, user) => {
  if (Array.isArray(messages) && messages.length) return messages.map((m) => ({ role: m.role, content: String(m.content) }));
  if (user !== undefined) return [{ role: 'user', content: String(user) }];
  throw new ModelError('complete() needs messages');
};

/** Anthropic Messages API. */
export function createAnthropicModel({ apiKey, model = DEFAULT_ANTHROPIC_MODEL, baseUrl, fetch: f = globalThis.fetch, timeoutMs = 60_000, retries = 1, retryDelayMs = 1000 } = {}) {
  const url = `${(baseUrl || DEFAULT_ANTHROPIC_URL).replace(/\/+$/, '')}/v1/messages`;
  return {
    name: 'anthropic',
    model,
    async complete({ system, messages, user, maxTokens = 1500, temperature = 0 } = {}) {
      if (!apiKey) throw new ModelError('anthropic: no API key (MODEL_API_KEY or ANTHROPIC_API_KEY)');
      return withRetry(async () => {
        const body = { model, max_tokens: maxTokens, temperature };
        if (system) body.system = system;
        body.messages = asMessages(messages, user);
        const data = await post(f, url, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body, { timeoutMs, label: 'anthropic' });
        const block = (data.content || []).find((b) => b.type === 'text');
        if (!block) throw new ModelError('anthropic: no text block');
        if (data.stop_reason === 'max_tokens') throw new ModelError('anthropic: truncated (max_tokens)');
        return block.text;
      }, { retries, retryDelayMs });
    },
  };
}

/**
 * Any OpenAI-compatible /chat/completions endpoint. baseUrl includes the version, e.g. https://host/v1.
 * `responseFormat` (e.g. {type:'json_object'} or {type:'json_schema', json_schema:{...}}) is sent as
 * `response_format`; a per-call `responseFormat` overrides it. Nebius Token Factory supports both.
 */
export function createOpenAICompatibleModel({ apiKey, model, baseUrl, fetch: f = globalThis.fetch, timeoutMs = 60_000, retries = 1, retryDelayMs = 1000, headers: extra = {}, responseFormat } = {}) {
  if (!baseUrl) throw new ModelError('openai-compatible: MODEL_BASE_URL is required');
  if (!model) throw new ModelError('openai-compatible: MODEL_NAME is required');
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  return {
    name: 'openai-compatible',
    model,
    async complete({ system, messages, user, maxTokens = 1500, temperature = 0, responseFormat: rfOverride } = {}) {
      return withRetry(async () => {
        const msgs = asMessages(messages, user);
        const body = { model, messages: system ? [{ role: 'system', content: system }, ...msgs] : msgs, max_tokens: maxTokens, temperature };
        const rf = rfOverride ?? responseFormat;
        if (rf) body.response_format = rf;
        const headers = { ...extra };
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;
        const data = await post(f, url, headers, body, { timeoutMs, label: 'openai-compatible' });
        const choice = data?.choices?.[0];
        const content = choice?.message?.content;
        const text = Array.isArray(content) ? content.map((p) => p?.text ?? '').join('') : content;
        if (typeof text !== 'string' || !text) throw new ModelError('openai-compatible: no message content');
        if (choice.finish_reason === 'length') throw new ModelError('openai-compatible: truncated (length)');
        return text;
      }, { retries, retryDelayMs });
    },
  };
}

/** Rules-only: every call fails with NoModelError so callers fall back to deterministic logic. */
export function createNoModel() {
  return {
    name: 'none',
    model: null,
    async complete() { throw new NoModelError(); },
  };
}

export function modelProviderName(env = process.env) {
  const p = String(env.MODEL_PROVIDER || 'anthropic').trim().toLowerCase();
  const alias = { openai: 'openai-compatible', 'openai_compatible': 'openai-compatible', rules: 'none', off: 'none' };
  const name = alias[p] || p;
  if (!MODEL_PROVIDERS.includes(name)) throw new Error(`MODEL_PROVIDER must be one of ${MODEL_PROVIDERS.join('|')} (got "${env.MODEL_PROVIDER}")`);
  return name;
}

/**
 * Model config from env. MODEL_API_KEY falls back to ANTHROPIC_API_KEY; for anthropic,
 * MODEL_BASE_URL falls back to ANTHROPIC_BASE_URL. `defaults` lets callers keep their own legacy
 * variables (e.g. proof passes {model: PROOF_MODEL}).
 */
export function modelConfigFromEnv(env = process.env, defaults = {}) {
  const provider = modelProviderName(env);
  if (provider === 'none') return { provider };
  if (provider === 'anthropic') {
    return {
      provider,
      apiKey: env.MODEL_API_KEY || env.ANTHROPIC_API_KEY || defaults.apiKey || '',
      model: env.MODEL_NAME || defaults.model || DEFAULT_ANTHROPIC_MODEL,
      baseUrl: env.MODEL_BASE_URL || env.ANTHROPIC_BASE_URL || defaults.baseUrl || undefined,
      timeoutMs: numOr(env.MODEL_TIMEOUT_MS, defaults.timeoutMs),
    };
  }
  return {
    provider,
    apiKey: env.MODEL_API_KEY || defaults.apiKey || '',
    model: env.MODEL_NAME || defaults.model || '',
    baseUrl: env.MODEL_BASE_URL || defaults.baseUrl || '',
    timeoutMs: numOr(env.MODEL_TIMEOUT_MS, defaults.timeoutMs),
    responseFormat: responseFormatFromEnv(env.MODEL_RESPONSE_FORMAT) ?? defaults.responseFormat,
  };
}

/**
 * Map MODEL_RESPONSE_FORMAT to an OpenAI `response_format` object, or undefined.
 * `json_object` (aliases `json`, `1`, `true`) asks for any valid JSON; reasoning models such as
 * Nemotron may still wrap it in `<think>` tokens, which the labeler's parser strips. A full
 * `json_schema` needs a schema object, so callers pass that at call time, not through env.
 */
export function responseFormatFromEnv(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'json_object' || s === 'json' || s === '1' || s === 'true') return { type: 'json_object' };
  return undefined;
}

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export function createModel(config = {}) {
  const { provider = 'anthropic', ...opts } = config;
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  if (provider === 'anthropic') return createAnthropicModel(opts);
  if (provider === 'openai-compatible') return createOpenAICompatibleModel(opts);
  if (provider === 'none') return createNoModel();
  throw new Error(`unknown model provider "${provider}"`);
}

export function modelFromEnv(env = process.env, { fetch, defaults, retries, retryDelayMs } = {}) {
  const c = modelConfigFromEnv(env, defaults);
  return createModel({ ...c, fetch, retries, retryDelayMs });
}

/**
 * Extract and parse the first JSON object in a model reply (tolerates code fences and prose
 * around it). Strings and escapes are respected while matching braces. Throws if none parses.
 */
export function extractJson(text) {
  const s = String(text ?? '');
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(start, i + 1));
          } catch {
            break; // try the next '{'
          }
        }
      }
    }
  }
  throw new ModelError('no JSON object found in model output');
}

/** complete() + extractJson(). */
export async function completeJson(model, opts) {
  return extractJson(await model.complete(opts));
}
