import { describe, it, expect, vi } from 'vitest';
import {
  buildTouchContext, ruleFor, applyRules, parseLlmOutput, labelProof, buildPrompt,
  ridFromText, replayFromText, issueRouteFromText,
} from '../src/label.js';
import { allChanges } from '../src/diff.js';
import { fx, fxText, b1Proof } from './helpers.js';

const issue = fxText('b1/issue.md');
const replay = fx('b1/replay.json');

describe('issue parsing', () => {
  it('reads rid marker, route and embedded replay', () => {
    expect(ridFromText(issue)).toBe('r_20261011_8f3a2c');
    expect(issueRouteFromText(issue)).toBe('/bill/4/settle');
    expect(replayFromText(issue)).toEqual(replay);
    expect(ridFromText('no marker')).toBe(null);
  });
});

describe('pre-rules (§11.4)', () => {
  const proof = b1Proof();
  const touch = buildTouchContext({ proof, replays: [replay], issueText: issue });

  it('collects touched routes, bills and testids', () => {
    expect(touch.routes).toEqual(['/bill/4', '/bill/4/settle', '/bill/new']);
    expect(touch.bills).toEqual(['4']);
    expect(touch.testids).toContain('settled-banner');
  });

  it('B1 trap: /bill/9 · tip-total ₹49.99 → ₹50.00 is candidate UNINTENDED', () => {
    const ruled = applyRules(proof, touch);
    const c1 = allChanges(ruled).find((c) => c.where === '/bill/9 · tip-total');
    expect(c1).toMatchObject({ id: 'c1', before: '₹49.99', after: '₹50.00', candidate: 'unintended', label: 'unintended' });
    expect(c1.reason).toBe('rule: bill 9 is not touched by the replay');
  });

  it('every replay change is candidate intended; summary has exactly 1 unintended', () => {
    const ruled = applyRules(proof, touch);
    const rep = ruled.flows[1].changes;
    expect(rep.every((c) => c.candidate === 'intended')).toBe(true);
    expect(rep.find((c) => c.where.endsWith('settled-banner')).reason)
      .toBe('rule: route /bill/4/settle and testid settled-banner are in the replay');
    expect(ruled.summary).toEqual({ changes: 10, intended: 9, unintended: 1, labeler: 'rules' });
  });

  it('a bill-row on a touched route but for an untouched bill is unintended', () => {
    expect(ruleFor({ ctx: { route: '/', testid: 'bill-row-9' } }, { routes: ['/'], bills: ['4'], testids: [] }).candidate)
      .toBe('unintended');
  });

  it('untouched non-bill route is unintended; no replay context makes everything unintended', () => {
    expect(ruleFor({ ctx: { route: '/settings' } }, touch)).toEqual({
      candidate: 'unintended', reason: 'rule: route /settings is not touched by the replay',
    });
    expect(ruleFor({ ctx: { route: '/bill/4' } }, { routes: [], bills: [], testids: [] }).candidate).toBe('unintended');
  });

  it('applyRules does not mutate its input', () => {
    const before = JSON.stringify(proof);
    applyRules(proof, touch);
    expect(JSON.stringify(proof)).toBe(before);
  });
});

describe('LLM output validation', () => {
  const ids = ['c1', 'c2'];
  it('accepts strict JSON (and tolerates a code fence)', () => {
    const ok = '{"labels":[{"id":"c1","label":"unintended","reason":"other bill"},{"id":"c2","label":"intended","reason":"the bug"}]}';
    expect(parseLlmOutput(ok, ids).get('c1')).toEqual({ label: 'unintended', reason: 'other bill' });
    expect(parseLlmOutput('```json\n' + ok + '\n```', ids).size).toBe(2);
  });
  it('tolerates a Nemotron <think> block and surrounding prose', () => {
    const ok = '{"labels":[{"id":"c1","label":"unintended","reason":"other bill"},{"id":"c2","label":"intended","reason":"the bug"}]}';
    const think = `<think>\nc1 touches bill 9, which the replay never visits, so it is a side effect.\nc2 is the reported double charge.\n</think>\nHere is the verdict:\n${ok}`;
    expect(parseLlmOutput(think, ids).get('c1')).toEqual({ label: 'unintended', reason: 'other bill' });
    // an unclosed <think> (reasoning truncated by max_tokens) still finds nothing to parse -> throws
    expect(() => parseLlmOutput('<think>reasoning but no answer', ids)).toThrow();
  });
  it.each([
    ['not json', 'nope'],
    ['missing id', '{"labels":[{"id":"c1","label":"intended","reason":"x"}]}'],
    ['unknown id', '{"labels":[{"id":"c1","label":"intended","reason":"x"},{"id":"c9","label":"intended","reason":"x"}]}'],
    ['bad label', '{"labels":[{"id":"c1","label":"maybe","reason":"x"},{"id":"c2","label":"intended","reason":"x"}]}'],
    ['empty reason', '{"labels":[{"id":"c1","label":"intended","reason":""},{"id":"c2","label":"intended","reason":"x"}]}'],
    ['duplicate', '{"labels":[{"id":"c1","label":"intended","reason":"x"},{"id":"c1","label":"intended","reason":"x"}]}'],
  ])('rejects %s', (_n, text) => {
    expect(() => parseLlmOutput(text, ids)).toThrow();
  });
});

describe('labelProof', () => {
  const opts = { issueText: issue, replays: [replay] };

  it('without ANTHROPIC_API_KEY falls back to rule labels', async () => {
    const res = await labelProof(b1Proof(), opts);
    expect(res.labeler).toBe('rules');
    expect(res.proof.summary.unintended).toBe(1);
    expect(allChanges(res.proof).every((c) => c.reason.startsWith('rule: '))).toBe(true);
  });

  it('calls the Messages API with model, max_tokens 1500, temperature 0 and applies overrides', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const ids = JSON.parse(body.messages[0].content.split('## Changes\n')[1]).map((c) => c.id);
      const labels = ids.map((id) => ({ id, label: id === 'c1' ? 'unintended' : 'intended', reason: id === 'c1' ? 'tip math changed on an unrelated bill' : 'the reported bug' }));
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ labels }) }], stop_reason: 'end_turn' }) };
    });
    const res = await labelProof(b1Proof(), { ...opts, apiKey: 'sk-test', model: 'claude-sonnet-4-5', fetchImpl });
    expect(res.labeler).toBe('llm');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'claude-sonnet-4-5', max_tokens: 1500, temperature: 0 });
    expect(res.proof.summary).toEqual({ changes: 10, intended: 9, unintended: 1, labeler: 'llm' });
    expect(res.proof.flows[0].changes[0].reason).toBe('tip math changed on an unrelated bill');
    expect(res.proof.flows[0].changes[0].candidate).toBe('unintended');
  });

  it('the model cannot clear a rule "unintended": it stays unintended and is marked disputed', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const ids = JSON.parse(body.messages[0].content.split('## Changes\n')[1]).map((c) => c.id);
      const labels = ids.map((id) => ({ id, label: 'intended', reason: 'looks fine' }));
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ labels }) }], stop_reason: 'end_turn' }) };
    });
    const res = await labelProof(b1Proof(), { ...opts, apiKey: 'sk-test', fetchImpl });
    expect(res.labeler).toBe('llm');
    expect(res.proof.summary.unintended).toBe(1);
    const c = allChanges(res.proof).find((x) => x.label === 'unintended');
    expect(c.disputed).toBe(true);
    expect(c.reason).toMatch(/model disagrees/);
  });

  it('on HTTP failure or invalid output falls back to rules', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 529, json: async () => ({}) }));
    const r1 = await labelProof(b1Proof(), { ...opts, apiKey: 'k', fetchImpl: bad });
    expect(r1.labeler).toBe('rules');
    expect(r1.error).toMatch(/529/);
    const junk = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Sure! Here you go' }] }) }));
    const r2 = await labelProof(b1Proof(), { ...opts, apiKey: 'k', fetchImpl: junk });
    expect(r2.labeler).toBe('rules');
    expect(r2.proof.summary.unintended).toBe(1);
  });

  it('prompt omits the embedded replay JSON and lists every change id', () => {
    const proof = applyRules(b1Proof(), buildTouchContext({ proof: b1Proof(), replays: [replay] }));
    const p = buildPrompt(proof, { issueText: issue, touch: { routes: [], testids: [] } });
    expect(p.user).toContain('[replay omitted]');
    expect(p.ids).toHaveLength(10);
    expect(p.system).toMatch(/JSON only/);
  });
});

describe('same word-level edit on another screen', () => {
  it('promotes a list row that contains the intended "mg" -> "mcg" edit', async () => {
    const { applyRules, wordEdit } = await import('../src/label.js');
    expect(wordEdit('50 mg tablet', '50 mcg tablet')).toBe('"mg" → "mcg"');
    expect(wordEdit('Levothyroxine sodium 50 mg · Thyroid', 'Levothyroxine sodium 50 mcg · Thyroid')).toBe('"mg" → "mcg"');
    expect(wordEdit('$12.00', '$12.00')).toBeNull();
    const proof = {
      flows: [{
        flow: 'thyroid-strength',
        changes: [
          { id: 'a', channel: 'screen', where: '/rx/2 · rx-strength', before: '50 mg tablet', after: '50 mcg tablet', ctx: { route: '/rx/2' } },
          { id: 'b', channel: 'screen', where: '/ · rx-row-2', before: 'Levothyroxine sodium 50 mg · Thyroid', after: 'Levothyroxine sodium 50 mcg · Thyroid', ctx: { route: '/' } },
          { id: 'c', channel: 'screen', where: '/ · total', before: '$12.00', after: '$1200', ctx: { route: '/' } },
        ],
      }],
    };
    const out = applyRules(proof, { routes: new Set(['/rx/2']), testids: new Set() });
    const by = Object.fromEntries(out.flows[0].changes.map((c) => [c.id, c.label]));
    expect(by.b).toBe('intended');
    expect(by.c).toBe('unintended');
  });
});
