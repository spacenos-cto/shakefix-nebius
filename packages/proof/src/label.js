// Labeling (§11.4): deterministic pre-rules, then an optional LLM that can only make labels stricter,
// with rule fallback.

import { createAnthropicModel, createModel, extractJson, modelConfigFromEnv } from '@shakefix/core/model';
import { billIdOf, routeOf } from './normalize.js';

export const LABELS = Object.freeze(['intended', 'unintended']);
export const DEFAULT_MODEL = 'claude-sonnet-4-5';
const MAX_REASON = 240;

/**
 * OpenAI `response_format` for the labels object, so a Token Factory model (Nemotron) returns
 * structured JSON. Nebius documents `{type:'json_schema', json_schema:<schema>}`. Opt in with
 * PROOF_RESPONSE_FORMAT=json_schema|json_object; off by default so a model without JSON mode isn't
 * rejected with a 400 (the parser already tolerates prose and `<think>` tokens).
 */
export const LABELS_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      labels: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            label: { type: 'string', enum: ['intended', 'unintended'] },
            reason: { type: 'string' },
          },
          required: ['id', 'label', 'reason'],
        },
      },
    },
    required: ['labels'],
  },
});

/** PROOF_RESPONSE_FORMAT -> an OpenAI response_format object (or undefined). */
export function labelResponseFormatFromEnv(env = process.env) {
  const s = String(env.PROOF_RESPONSE_FORMAT ?? '').trim().toLowerCase();
  if (s === 'json_schema' || s === 'schema') return LABELS_RESPONSE_FORMAT;
  if (s === 'json_object' || s === 'json') return { type: 'json_object' };
  return undefined;
}

// Max output tokens for the verdict. Default 1500 (the original request, unchanged). Reasoning
// models (Nemotron) spend tokens on a <think> block before the JSON, so set PROOF_MAX_TOKENS higher
// for them (the Nebius config uses 8000) or the reply is cut off and the labeler drops to rules.
export const DEFAULT_MAX_TOKENS = 1500;
export function labelMaxTokensFromEnv(env = process.env) {
  const n = Number(env.PROOF_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

const RID_RE = /shakefix:rid=([A-Za-z0-9_-]+)/;

/** Extract the rid marker from an issue description. */
export function ridFromText(text) {
  const m = RID_RE.exec(String(text || ''));
  return m ? m[1] : null;
}

/** Extract the reported route from the intake template: **Route:** `/bill/7`. */
export function issueRouteFromText(text) {
  const m = /\*\*Route:\*\*\s*`([^`]+)`/.exec(String(text || ''));
  return m ? routeOf(m[1]) : null;
}

/** Extract an embedded replay.json (```json block containing "shakefix.replay/v1"). */
export function replayFromText(text) {
  const re = /```json\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    if (!m[1].includes('shakefix.replay/v1')) continue;
    try {
      const obj = JSON.parse(m[1]);
      if (obj && obj.schema === 'shakefix.replay/v1') return obj;
    } catch { /* ignore broken block */ }
  }
  return null;
}

/**
 * Build the "touched" context from replay(s), the replay flows inside proof.json, and the issue text.
 * Returns plain arrays (sorted) so it can be serialized and unit-tested.
 */
export function buildTouchContext({ proof, replays = [], issueText = '' } = {}) {
  const routes = new Set();
  const testids = new Set();
  const addRoute = (r) => { if (r) routes.add(routeOf(r)); };
  for (const r of replays.filter(Boolean)) {
    addRoute(r.startRoute);
    for (const a of r.actions || []) {
      addRoute(a.route);
      if (a.testid) testids.add(a.testid);
    }
    if (r.expectation?.testid) testids.add(r.expectation.testid);
  }
  for (const f of proof?.flows || []) {
    if (f.source !== 'replay') continue;
    for (const r of f.routes || []) addRoute(r);
    for (const t of f.testids || []) testids.add(t);
  }
  const issueRoute = issueRouteFromText(issueText);
  addRoute(issueRoute);
  const bills = new Set();
  for (const r of routes) {
    const b = billIdOf({ route: r });
    if (b) bills.add(b);
  }
  return {
    routes: [...routes].sort(),
    bills: [...bills].sort(),
    testids: [...testids].sort(),
    issueRoute,
  };
}

/** Deterministic pre-rule for one change. Returns {candidate, reason}. */
export function ruleFor(change, touch) {
  const route = change.ctx?.route ?? null;
  const testid = change.ctx?.testid ?? null;
  const bill = billIdOf({ route, testid });
  const routes = new Set(touch.routes || []);
  const bills = new Set(touch.bills || []);
  const testids = new Set(touch.testids || []);

  if (!routes.size) {
    return { candidate: 'unintended', reason: 'rule: no replay context, so every change is treated as a side effect' };
  }
  if (bill && !bills.has(bill)) {
    return { candidate: 'unintended', reason: `rule: bill ${bill} is not touched by the replay` };
  }
  if ((route && routes.has(route)) || (bill && bills.has(bill))) {
    if (testid && testids.has(testid)) {
      return { candidate: 'intended', reason: `rule: route ${route} and testid ${testid} are in the replay` };
    }
    return { candidate: 'intended', reason: `rule: route ${route} is touched by the replay` };
  }
  return { candidate: 'unintended', reason: `rule: route ${route ?? '(unknown)'} is not touched by the replay` };
}

function recount(proof) {
  let intended = 0;
  let unintended = 0;
  let changes = 0;
  for (const f of proof.flows || []) {
    for (const c of f.changes || []) {
      changes++;
      if (c.label === 'intended') intended++;
      else if (c.label === 'unintended') unintended++;
    }
  }
  return { changes, intended, unintended };
}

/** Apply pre-rules: sets `candidate` and (as a fallback) `label` + `reason` on every change. Pure. */
export function applyRules(proof, touch) {
  const out = structuredClone(proof);
  for (const f of out.flows || []) {
    for (const c of f.changes || []) {
      const r = ruleFor(c, touch);
      c.candidate = r.candidate;
      c.label = r.candidate;
      c.reason = r.reason;
    }
  }
  // Second pass: an "unintended" change that is the SAME transformation (same field, same
  // before -> after) as an intended change is the fix generalising to another record
  // (e.g. every 3-way split of 1000 now gets the missing cent). Promote it to intended.
  const sig = (c) => {
    const where = String(c.where ?? '').replace(/\/\d+(?=\/|\s|$)/g, '/:id');
    const field = where.split('·').pop().trim();
    return [c.channel, field, JSON.stringify(c.before), JSON.stringify(c.after)].join('|');
  };
  const intendedSigs = new Set();
  for (const f of out.flows || []) for (const c of f.changes || []) if (c.candidate === 'intended') intendedSigs.add(sig(c));
  for (const f of out.flows || []) {
    for (const c of f.changes || []) {
      if (c.candidate === 'unintended' && intendedSigs.has(sig(c))) {
        c.candidate = 'intended';
        c.label = 'intended';
        c.reason = 'rule: same change as the reported bug, applied to another record';
      }
    }
  }
  // Third pass: the same word-level edit inside a longer text (e.g. "50 mg tablet" -> "50 mcg tablet"
  // on the detail screen, and the same "mg" -> "mcg" inside a list row on the home screen) is the
  // fix showing on another screen, not a side effect.
  const intendedEdits = new Set();
  for (const f of out.flows || []) for (const c of f.changes || []) {
    const e = c.candidate === 'intended' ? wordEdit(c.before, c.after) : null;
    if (e) intendedEdits.add(e);
  }
  for (const f of out.flows || []) {
    for (const c of f.changes || []) {
      const e = c.candidate === 'unintended' ? wordEdit(c.before, c.after) : null;
      if (e && intendedEdits.has(e)) {
        c.candidate = 'intended';
        c.label = 'intended';
        c.reason = `rule: same edit as the reported bug (${e}), shown on another screen`;
      }
    }
  }
  out.summary = { ...(out.summary || {}), ...recount(out), labeler: 'rules' };
  return out;
}

/**
 * The single word-level edit between two texts as '"removed" → "added"' (common leading and
 * trailing words stripped), or null when either side is not text, nothing changed, or the edit is
 * under 2 characters on both sides (too small to identify a fix).
 */
export function wordEdit(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string' || before === after) return null;
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const removed = a.slice(i, a.length - j).join(' ');
  const added = b.slice(i, b.length - j).join(' ');
  if (removed.length < 2 && added.length < 2) return null;
  return `"${removed}" → "${added}"`;
}

/** Compact form of a value for the prompt. */
function short(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 160 ? s.slice(0, 157) + '...' : s;
}

/** Build the strict JSON-only prompt. */
export function buildPrompt(rulesProof, { issueText = '', touch } = {}) {
  const items = [];
  for (const f of rulesProof.flows || []) {
    for (const c of f.changes || []) {
      items.push({
        id: c.id, flow: f.flow, channel: c.channel, where: c.where,
        before: short(c.before), after: short(c.after), candidate: c.candidate, rule: c.reason,
      });
    }
  }
  const system = [
    'You are Second Opinion, the behavior-diff reviewer of the ShakeFix ER team.',
    'A bug fix was replayed on the base and head revisions; every observed behavior change is listed.',
    'Decide for each change whether it is "intended" (part of fixing the reported bug) or "unintended" (a side effect).',
    'Deterministic rules already proposed a candidate. Confirm it unless the evidence clearly says otherwise.',
    'A change on a bill or route the reporter never touched is almost always unintended.',
    'Reply with JSON only, no prose, no code fences, exactly this shape:',
    '{"labels":[{"id":"c1","label":"intended","reason":"<one short sentence>"}]}',
    'Include every id exactly once. label must be "intended" or "unintended". reason must be under 200 characters.',
  ].join('\n');
  const issue = String(issueText || '').replace(/```json[\s\S]*?```/g, '[replay omitted]').slice(0, 3000);
  const user = [
    '## Issue',
    issue || '(no issue text)',
    '',
    '## Replay touched',
    JSON.stringify({ routes: touch?.routes || [], testids: touch?.testids || [] }),
    '',
    '## Changes',
    JSON.stringify(items),
  ].join('\n');
  return { system, user, ids: items.map((i) => i.id) };
}

/** Drop a reasoning model's <think>...</think> block (Nemotron et al.) before parsing. */
export function stripThink(text) {
  let s = String(text || '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  // An unclosed <think> (truncated reasoning) — keep whatever follows the last one.
  const open = s.lastIndexOf('<think>');
  if (open !== -1) s = s.slice(open + '<think>'.length);
  const close = s.lastIndexOf('</think>');
  if (close !== -1) s = s.slice(close + '</think>'.length);
  return s.trim();
}

/**
 * Parse + validate the model output. Throws on any problem. Returns Map id -> {label, reason}.
 * Tolerant of reasoning tokens and prose: strips <think> blocks and code fences, and falls back to
 * pulling the first JSON object out of the reply (so Nemotron's "<think>...</think>{...}" works).
 */
export function parseLlmOutput(text, ids) {
  let s = stripThink(text);
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(s);
  if (fence) s = fence[1].trim();
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    obj = extractJson(s); // first {...} anywhere in the reply; throws if none parses
  }
  if (!obj || !Array.isArray(obj.labels)) throw new Error('missing labels array');
  const want = new Set(ids);
  const got = new Map();
  for (const l of obj.labels) {
    if (!l || typeof l.id !== 'string' || !want.has(l.id)) throw new Error(`unknown id ${l?.id}`);
    if (got.has(l.id)) throw new Error(`duplicate id ${l.id}`);
    if (!LABELS.includes(l.label)) throw new Error(`bad label for ${l.id}`);
    if (typeof l.reason !== 'string' || !l.reason.trim()) throw new Error(`missing reason for ${l.id}`);
    got.set(l.id, { label: l.label, reason: l.reason.trim().slice(0, MAX_REASON) });
  }
  if (got.size !== want.size) throw new Error(`expected ${want.size} labels, got ${got.size}`);
  return got;
}

/**
 * Merge LLM labels into a rules-labeled proof. Pure.
 * The model can only make the verdict stricter: it may turn a rule "intended" into "unintended",
 * never clear a rule "unintended". When it disagrees that way the change stays unintended and is
 * marked `disputed`, so the gate hands the MR to a human instead of auto-merging or re-operating.
 */
export function applyLlmLabels(rulesProof, labels) {
  const out = structuredClone(rulesProof);
  for (const f of out.flows || []) {
    for (const c of f.changes || []) {
      const l = labels.get(c.id);
      if (!l) continue;
      if (c.label === 'unintended' && l.label === 'intended') {
        c.disputed = true;
        c.reason = `${c.reason} (model disagrees: ${l.reason}; a human decides)`.slice(0, MAX_REASON * 2);
        continue;
      }
      c.label = l.label;
      c.reason = l.reason;
    }
  }
  out.summary = { ...(out.summary || {}), ...recount(out), labeler: 'llm' };
  return out;
}

/**
 * Call the Anthropic Messages API (through the @shakefix/core anthropic ModelProvider, no retry,
 * 60 s timeout: the same request as before). Returns the text of the first text block.
 */
export async function callAnthropic({ system, user, apiKey, model = DEFAULT_MODEL, fetchImpl, baseUrl, timeoutMs = 60000 }) {
  return anthropicLabeler({ apiKey, model, fetchImpl, baseUrl, timeoutMs }).complete({ system, user, maxTokens: 1500, temperature: 0 });
}

function anthropicLabeler({ apiKey, model = DEFAULT_MODEL, fetchImpl, baseUrl, timeoutMs = 60000 }) {
  return createAnthropicModel({ apiKey, model, fetch: fetchImpl || globalThis.fetch, baseUrl, timeoutMs, retries: 0 });
}

/**
 * Labeler model from env. Default (MODEL_PROVIDER unset or "anthropic"): Claude with
 * MODEL_API_KEY | ANTHROPIC_API_KEY, MODEL_NAME | PROOF_MODEL | claude-sonnet-4-5 and
 * MODEL_BASE_URL | ANTHROPIC_BASE_URL. MODEL_PROVIDER=openai-compatible uses MODEL_BASE_URL +
 * MODEL_NAME (Nebius, Vultr, OpenRouter, ...). MODEL_PROVIDER=none: rules only.
 * Returns null when no model is usable (no key), so the labeler falls back to rules.
 */
export function labelerModelFromEnv(env = process.env, { fetchImpl } = {}) {
  const c = modelConfigFromEnv(env, { model: env.PROOF_MODEL || DEFAULT_MODEL });
  if (c.provider === 'none') return createModel({ provider: 'none' });
  if (c.provider === 'anthropic') {
    if (!c.apiKey) return null;
    return anthropicLabeler({ apiKey: c.apiKey, model: c.model, fetchImpl, baseUrl: c.baseUrl, timeoutMs: c.timeoutMs });
  }
  return createModel({ ...c, fetch: fetchImpl || globalThis.fetch });
}

/**
 * Full labeling pipeline. Never throws for LLM problems: falls back to rule labels.
 * Returns { proof, labeler: 'llm'|'rules', error?: string }.
 */
export async function labelProof(proof, { issueText = '', replays = [], apiKey, model, fetchImpl, baseUrl, llm, responseFormat, maxTokens } = {}) {
  const touch = buildTouchContext({ proof, replays, issueText });
  const ruled = applyRules(proof, touch);
  const total = ruled.summary.changes;
  // `llm` is any @shakefix/core ModelProvider; without one, the legacy apiKey path builds Claude.
  const provider = llm || (apiKey ? anthropicLabeler({ apiKey, model: model || DEFAULT_MODEL, fetchImpl, baseUrl }) : null);
  if (!provider || provider.name === 'none' || total === 0) {
    const error = !provider ? 'ANTHROPIC_API_KEY not set' : provider.name === 'none' && total ? 'MODEL_PROVIDER=none (rules only)' : undefined;
    return { proof: ruled, labeler: 'rules', touch, error };
  }
  try {
    const { system, user, ids } = buildPrompt(ruled, { issueText, touch });
    // response_format steers OpenAI-compatible models (Nemotron) toward clean JSON; Anthropic ignores it.
    const rf = responseFormat ?? labelResponseFormatFromEnv();
    const mt = maxTokens || labelMaxTokensFromEnv();
    const text = await provider.complete({ system, user, maxTokens: mt, temperature: 0, responseFormat: rf });
    const labels = parseLlmOutput(text, ids);
    return { proof: applyLlmLabels(ruled, labels), labeler: 'llm', touch };
  } catch (err) {
    return { proof: ruled, labeler: 'rules', touch, error: String(err?.message || err) };
  }
}
