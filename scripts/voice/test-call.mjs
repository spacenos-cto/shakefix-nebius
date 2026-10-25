#!/usr/bin/env node
// Local voice test (docs/VOICE.md), no deploy needed. Reads keys from .env.voice.local (gitignored)
// and never prints them. Phone numbers are masked in all output.
//
//   node scripts/voice/test-call.mjs phones            list the account's numbers (free)
//   node scripts/voice/test-call.mjs setup             create the two ShakeFix agents (free), saves their ids
//   node scripts/voice/test-call.mjs call confirm      PAID: one "is it fixed for you?" call to TEST_PHONE
//   node scripts/voice/test-call.mjs call oncall       PAID: one on-call rollback call to TEST_PHONE
//
// .env.voice.local:
//   ELEVENLABS_API_KEY=...
//   ELEVENLABS_PHONE_NUMBER_ID=...   (from `phones`)
//   TEST_PHONE=+91XXXXXXXXXX         (your own number)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callOutcome } from '../../services/intake/src/voice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = path.join(ROOT, '.env.voice.local');
const API = 'https://api.elevenlabs.io';

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) throw new Error(`missing ${ENV_FILE} (see the header of this script)`);
  const env = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const mask = (p) => (p ? `${String(p).slice(0, 3)}…${String(p).slice(-4)}` : '(none)');
const env = loadEnv();
if (!env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY missing in .env.voice.local');
const headers = { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' };

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`${method} ${url} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return j;
}

function saveEnv(key, value) {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith(`${key}=`) && l !== '');
  lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV_FILE, `${lines.join('\n')}\n`);
}

const AGENTS = {
  confirm: {
    name: 'ShakeFix confirm',
    envKey: 'ELEVENLABS_CONFIRM_AGENT_ID',
    first: "Hi, this is ShakeFix, calling about the problem you reported in {{app_name}}: {{issue_title}}. We've shipped a fix. Could you open the app and check whether it works for you now?",
    prompt: 'You are a short, friendly follow-up call. Ask once whether the problem is fixed. Wait while the person checks. If they are unsure, ask them to try once more. Never ask for personal information. Never promise anything beyond "the team will look again". End the call politely once you have an answer.',
    field: ['fixed', '"yes" if the person said the problem is fixed, "no" if it is still broken, "unsure" otherwise.'],
    test: { shakefix_rid: 'r_20261022_abcdef', shakefix_round: '1', issue_title: 'the dose shows mg instead of mcg', app_name: 'CareRx' },
  },
  oncall: {
    name: 'ShakeFix on-call',
    envKey: 'ELEVENLABS_ONCALL_AGENT_ID',
    first: 'Hi, this is ShakeFix. Production was rolled back: {{reason}} on version {{version}}. Traffic is back on {{prev_revision}}. The case is: {{issue_title}}. Should I send it back to the agents for another try, or hold until you look?',
    prompt: 'You are calling an on-call developer. Be brief. Get one decision: retry or hold. Do not take any other action.',
    field: ['decision', '"retry" if the developer approved another automated attempt, "hold" if they want to look first, "unsure" otherwise.'],
    test: { shakefix_issues: '17', version: 'abc1234', prev_revision: 'carerx-00042', reason: 'the post-deploy smoke test failed', issue_title: 'the dose shows mg instead of mcg' },
  },
};

const [cmd, kind] = process.argv.slice(2);

if (cmd === 'phones') {
  const list = await api('GET', '/v1/convai/phone-numbers');
  for (const p of list) console.log(`${p.phone_number_id}  ${mask(p.phone_number)}  ${p.provider}  label="${p.label}"  assigned=${p.assigned_agent?.agent_name ?? '-'}`);
  console.log(`\nPut the id you want in .env.voice.local as ELEVENLABS_PHONE_NUMBER_ID. Outbound calls do not change the number's assigned (inbound) agent.`);
} else if (cmd === 'setup') {
  for (const a of Object.values(AGENTS)) {
    if (env[a.envKey]) { console.log(`${a.name}: already set (${a.envKey})`); continue; }
    const j = await api('POST', '/v1/convai/agents/create', {
      name: a.name,
      conversation_config: { agent: { first_message: a.first, language: 'en', prompt: { prompt: a.prompt } } },
      platform_settings: { data_collection: { [a.field[0]]: { type: 'string', description: a.field[1] } } },
    });
    saveEnv(a.envKey, j.agent_id);
    console.log(`${a.name}: created ${j.agent_id} (saved as ${a.envKey})`);
  }
} else if (cmd === 'call' && AGENTS[kind]) {
  const a = AGENTS[kind];
  for (const k of [a.envKey, 'ELEVENLABS_PHONE_NUMBER_ID', 'TEST_PHONE']) if (!env[k]) throw new Error(`${k} missing in .env.voice.local`);
  if (!/^\+[1-9]\d{7,14}$/.test(env.TEST_PHONE)) throw new Error('TEST_PHONE must be E.164, e.g. +919876543210');
  console.log(`PAID: calling ${mask(env.TEST_PHONE)} with "${a.name}"…`);
  const placed = await api('POST', '/v1/convai/twilio/outbound-call', {
    agent_id: env[a.envKey],
    agent_phone_number_id: env.ELEVENLABS_PHONE_NUMBER_ID,
    to_number: env.TEST_PHONE,
    conversation_initiation_client_data: { dynamic_variables: { shakefix_kind: kind, ...a.test } },
  });
  console.log(`placed: conversation ${placed.conversation_id}`);
  // Poll until the call is analysed (the deployed intake gets this from the post-call webhook instead).
  const deadline = Date.now() + 5 * 60_000;
  let conv = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8000));
    conv = await api('GET', `/v1/convai/conversations/${placed.conversation_id}`);
    process.stdout.write(`  status: ${conv.status}\n`);
    if (conv.status === 'done' || conv.status === 'failed') break;
  }
  const o = callOutcome({ data: { ...conv, conversation_initiation_client_data: { dynamic_variables: { shakefix_kind: kind, ...a.test } } } });
  console.log(`\nresult: kind=${o.kind} decision=${o.decision} duration=${o.durationSecs ?? '?'}s`);
  if (o.summary) console.log(`summary: ${o.summary}`);
} else {
  console.log('usage: test-call.mjs phones | setup | call confirm | call oncall');
  process.exitCode = 1;
}
