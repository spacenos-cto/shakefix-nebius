// Voice (docs/VOICE.md): voice-note transcript on the issue, the reporter's "is it fixed?" call,
// the on-call developer's rollback call, and the ElevenLabs post-call webhook. ElevenLabs is faked.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createGitlabClient } from '../src/gitlab.js';
import { signBody } from '../src/hmac.js';
import { createMemoryStore } from '../src/store/memory.js';
import { callOutcome, createVoice, decodeAudio, verifyElevenSignature } from '../src/voice.js';
import { fakeGitlab, makeReplay, testConfig } from './helpers.js';

const ORIGIN = 'https://splitpal.example.run.app';
const RID = 'r_20261011_8f3a01';
const PHONE = '+14155550100';
const WH = 'el-webhook-secret';
const AUDIO = Buffer.alloc(2048, 7).toString('base64');

function fakeVoice({ transcribe = 'The dose shows mg but it should be mcg', features = {} } = {}) {
  const calls = [];
  return {
    calls,
    features: { transcribe: true, confirmCall: true, oncallCall: true, ...features },
    async transcribe() { return transcribe ? { text: transcribe, language: 'en' } : null; },
    async call(c) { calls.push(c); return { conversationId: `conv_${calls.length}`, callSid: 'CA1' }; },
  };
}

function setup({ voice = fakeVoice(), config: over = {} } = {}) {
  const config = testConfig({ elevenWebhookSecret: WH, oncallPhone: '+14155550199', ...over });
  const fg = fakeGitlab();
  const gitlab = createGitlabClient({ baseUrl: config.gitlabUrl, projectId: config.projectId, token: config.humanPat, fetch: fg.fetch });
  const store = createMemoryStore();
  const pusher = { mode: 'poll', send: async () => ({ ok: false }) };
  const app = buildApp({ config, gitlab, store, pusher, voice });
  return { app, fg, store, voice, config };
}

const post = (app, url, body) => app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', origin: ORIGIN }, payload: body });
const signed = (app, url, body) => {
  const raw = JSON.stringify(body);
  return app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', 'x-shakefix-signature': signBody('hook-secret', raw) }, payload: raw });
};
const elSig = (raw, t = Math.floor(Date.now() / 1000), secret = WH) => `t=${t},v0=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const elHook = (app, payload, sig) => {
  const raw = JSON.stringify(payload);
  return app.inject({ method: 'POST', url: '/v1/hooks/elevenlabs', headers: { 'content-type': 'application/json', 'elevenlabs-signature': sig ?? elSig(raw) }, payload: raw });
};
const callPayload = ({ kind = 'confirm', value, field = kind === 'oncall' ? 'decision' : 'fixed', vars = {} }) => ({
  type: 'post_call_transcription',
  event_timestamp: Math.floor(Date.now() / 1000),
  data: {
    conversation_id: 'conv_1',
    status: 'done',
    metadata: { call_duration_secs: 41 },
    analysis: { transcript_summary: 'Reporter checked the dose screen.', data_collection_results: { [field]: { value } } },
    conversation_initiation_client_data: { dynamic_variables: { shakefix_kind: kind, shakefix_rid: RID, shakefix_round: '1', ...vars } },
  },
});
const untag = (b) => String(b).replace(/\n\n<!-- shakefix:intake-note -->$/, '');
const notesOf = (fg, iid = 41) => fg.calls.filter((c) => c.method === 'POST' && new RegExp(`/issues/${iid}/notes$`).test(c.path)).map((c) => untag(c.body.body));

async function reported(ctx, extra = { voiceNote: { audio: AUDIO, mime: 'audio/webm' }, callback: { phone: PHONE, consent: true } }) {
  const r = await post(ctx.app, '/v1/reports', { replay: makeReplay(), ...extra });
  expect(r.statusCode).toBe(201);
  return r;
}
const fixed = (app) => signed(app, `/v1/reports/${RID}/fixed`, { url: '/bill/7', mrIid: 42 });

describe('voice helpers', () => {
  it('verifies ElevenLabs signatures like the SDK (t.body, hex, 30 min window)', () => {
    const raw = '{"a":1}';
    const now = Date.now();
    expect(verifyElevenSignature(WH, raw, elSig(raw, Math.floor(now / 1000)), now)).toBe(true);
    expect(verifyElevenSignature(WH, raw + ' ', elSig(raw, Math.floor(now / 1000)), now)).toBe(false);
    expect(verifyElevenSignature('other', raw, elSig(raw, Math.floor(now / 1000)), now)).toBe(false);
    expect(verifyElevenSignature(WH, raw, elSig(raw, Math.floor((now - 31 * 60_000) / 1000)), now)).toBe(false);
    expect(verifyElevenSignature(WH, raw, 'v0=abc', now)).toBe(false);
  });

  it('reads call outcomes and never treats unclear answers as yes', () => {
    expect(callOutcome(callPayload({ value: 'Yes' })).decision).toBe('yes');
    expect(callOutcome(callPayload({ value: 'no' })).decision).toBe('no');
    expect(callOutcome(callPayload({ value: 'maybe' })).decision).toBe('unsure');
    expect(callOutcome(callPayload({ kind: 'oncall', value: 'retry', vars: { shakefix_issues: '41, 42' } }))).toMatchObject({ kind: 'oncall', decision: 'retry', issues: [41, 42] });
    expect(callOutcome({ data: {} }).kind).toBeNull();
  });

  it('rejects implausible audio and keeps features off without keys', () => {
    expect(decodeAudio({ audio: 'AAAA', mime: 'audio/webm' })).toBeNull();
    expect(decodeAudio({ audio: AUDIO, mime: 'video/mp4' })).toBeNull();
    expect(decodeAudio({ audio: AUDIO, mime: 'audio/webm' })?.ext).toBe('webm');
    expect(createVoice({ config: testConfig() }).features).toEqual({ transcribe: false, confirmCall: false, oncallCall: false });
  });
});

describe('voice note on a new report', () => {
  it('adds the transcript as "In their words" and never puts the phone number in the issue', async () => {
    const ctx = setup();
    await reported(ctx);
    const create = ctx.fg.calls.find((c) => c.method === 'POST' && /\/issues$/.test(c.path));
    expect(create.body.description).toContain('### 🎙️ In their words');
    expect(create.body.description).toContain('> The dose shows mg but it should be mcg');
    expect(JSON.stringify(ctx.fg.calls)).not.toContain(PHONE);
    // No audio upload unless VOICE_KEEP_AUDIO=1 (only the screenshot path uploads; none sent here).
    expect(ctx.fg.calls.some((c) => /\/uploads$/.test(c.path))).toBe(false);
    expect((await ctx.store.get(RID)).callback.phone).toBe(PHONE);
    const board = (await ctx.app.inject({ method: 'GET', url: '/v1/board' })).body;
    expect(board).not.toContain(PHONE);
  });

  it('rejects a malformed phone number or missing consent', async () => {
    const ctx = setup();
    const bad = await post(ctx.app, '/v1/reports', { replay: makeReplay(), callback: { phone: '555-0100', consent: true } });
    expect(bad.statusCode).toBe(400);
    const noConsent = await post(ctx.app, '/v1/reports', { replay: makeReplay(), callback: { phone: PHONE, consent: false } });
    expect(noConsent.statusCode).toBe(400);
  });

  it('still files the report when transcription fails', async () => {
    const voice = fakeVoice();
    voice.transcribe = async () => { throw new Error('quota'); };
    const ctx = setup({ voice });
    await reported(ctx);
    const create = ctx.fg.calls.find((c) => c.method === 'POST' && /\/issues$/.test(c.path));
    expect(create.body.description).toContain('could not be transcribed');
  });
});

describe('"Is it fixed for you?" call', () => {
  it('calls the reporter once per fix round after the deploy', async () => {
    const ctx = setup();
    await reported(ctx);
    const res = await fixed(ctx.app);
    expect(res.json().called).toBe(1);
    expect(ctx.voice.calls).toEqual([{ kind: 'confirm', to: PHONE, variables: expect.objectContaining({ shakefix_rid: RID, shakefix_round: '1' }) }]);
    await fixed(ctx.app); // a retried notify does not call again
    expect(ctx.voice.calls).toHaveLength(1);
  });

  it('does not call reporters who did not opt in, or when calls are not configured', async () => {
    const a = setup();
    await reported(a, {});
    await fixed(a.app);
    expect(a.voice.calls).toHaveLength(0);
    const b = setup({ voice: fakeVoice({ features: { confirmCall: false } }) });
    await reported(b);
    await fixed(b.app);
    expect(b.voice.calls).toHaveLength(0);
  });

  it('a spoken "yes" verifies the case, with a call note on the issue', async () => {
    const ctx = setup();
    await reported(ctx);
    await fixed(ctx.app);
    const res = await elHook(ctx.app, callPayload({ value: 'yes' }));
    expect(res.json()).toMatchObject({ kind: 'confirm', decision: 'yes', applied: true, state: 'verified' });
    const notes = notesOf(ctx.fg);
    expect(notes.some((n) => n.startsWith('### 📞 Reporter call: 👍'))).toBe(true);
    expect(notes.join('\n')).not.toContain(PHONE);
    const rec = await ctx.store.get(RID);
    expect(rec.state).toBe('verified');
    expect(rec.verdicts.at(-1)).toMatchObject({ verdict: 'confirmed', source: 'call', key: `1:call:${RID}` });
  });

  it('a spoken "no" reopens the case and re-triggers the flow without a new replay commit', async () => {
    const ctx = setup();
    await reported(ctx);
    await fixed(ctx.app);
    ctx.fg.calls.length = 0;
    const res = await elHook(ctx.app, callPayload({ value: 'no' }));
    expect(res.json()).toMatchObject({ decision: 'no', applied: true, state: 'reopened' });
    expect(ctx.fg.calls.some((c) => /\/repository\/commits$/.test(c.path))).toBe(false);
    expect(notesOf(ctx.fg).some((n) => n.includes('@ai-shakefix-grp'))).toBe(true);
    expect((await ctx.store.get(RID)).state).toBe('reopened');
  });

  it('an unclear answer or a call about an old round changes nothing', async () => {
    const ctx = setup();
    await reported(ctx);
    await fixed(ctx.app);
    expect((await elHook(ctx.app, callPayload({ value: 'hmm' }))).json()).toMatchObject({ decision: 'unsure', applied: false });
    expect((await elHook(ctx.app, callPayload({ value: 'yes', vars: { shakefix_round: '9' } }))).json()).toMatchObject({ applied: false });
    expect((await ctx.store.get(RID)).state).toBe('deployed');
  });

  it('rejects unsigned, mis-signed or unconfigured webhooks', async () => {
    const ctx = setup();
    const raw = JSON.stringify(callPayload({ value: 'yes' }));
    expect((await elHook(ctx.app, callPayload({ value: 'yes' }), elSig(raw, undefined, 'wrong'))).statusCode).toBe(401);
    expect((await elHook(ctx.app, callPayload({ value: 'yes' }), 'nope')).statusCode).toBe(401);
    const off = setup({ config: { elevenWebhookSecret: '' } });
    expect((await elHook(off.app, callPayload({ value: 'yes' }))).statusCode).toBe(503);
  });
});

describe('on-call rollback call', () => {
  it('needs the hook signature and the on-call config', async () => {
    const ctx = setup();
    const unsigned = await post(ctx.app, '/v1/oncall/call', { issues: [41] });
    expect(unsigned.statusCode).toBe(401);
    const off = setup({ voice: fakeVoice({ features: { oncallCall: false } }) });
    expect((await signed(off.app, '/v1/oncall/call', { issues: [41] })).statusCode).toBe(503);
  });

  it('phones the on-call developer; "retry" by voice re-triggers the flow on each issue', async () => {
    const ctx = setup();
    await reported(ctx);
    const res = await signed(ctx.app, '/v1/oncall/call', { issues: [41], version: 'abc1234', prevRevision: 'carerx-00042' });
    expect(res.statusCode).toBe(200);
    expect(ctx.voice.calls[0]).toMatchObject({ kind: 'oncall', to: '+14155550199', variables: { shakefix_issues: '41', version: 'abc1234' } });
    ctx.fg.calls.length = 0;
    const hook = await elHook(ctx.app, callPayload({ kind: 'oncall', value: 'retry', vars: { shakefix_issues: '41' } }));
    expect(hook.json()).toMatchObject({ kind: 'oncall', decision: 'retry', issues: [41] });
    const put = ctx.fg.calls.find((c) => c.method === 'PUT' && /\/issues\/41$/.test(c.path));
    expect(put.body.add_labels).toContain('shakefix::voice-approved');
    const notes = notesOf(ctx.fg);
    expect(notes[0]).toMatch(/^### 📞 On-call developer call: 🔁/);
    expect(notes.some((n) => n.includes('@ai-shakefix-grp'))).toBe(true);
  });

  it('"hold" only records the decision', async () => {
    const ctx = setup();
    await reported(ctx);
    ctx.fg.calls.length = 0;
    await elHook(ctx.app, callPayload({ kind: 'oncall', value: 'hold', vars: { shakefix_issues: '41' } }));
    expect(ctx.fg.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(notesOf(ctx.fg)).toHaveLength(1);
  });
});
