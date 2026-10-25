#!/usr/bin/env node
// Live Second Opinion on Nebius Token Factory + NVIDIA Nemotron.
//
// Runs ShakeFix's Second Opinion labeler (the behavior-diff reviewer) against a real base-vs-head
// replay and makes ONE live inference call to Nebius Token Factory with an NVIDIA Nemotron model.
// Deterministic rules label every change first; Nemotron can only make a verdict *stricter*
// (intended -> unintended), never clear a rule-flagged change. This is the key module the Nebius
// submission video shows running.
//
// Config (you create the key; it is never printed):
//   MODEL_PROVIDER=openai-compatible
//   MODEL_BASE_URL=https://api.tokenfactory.nebius.com/v1
//   MODEL_NAME=nvidia/Nemotron-3-Ultra-550b-a55b      # confirm the exact id in the TF console
//   MODEL_API_KEY=<your Nebius Token Factory key>
//   PROOF_RESPONSE_FORMAT=json_schema                 # optional; see scripts/nebius/README.md
//
// Usage:
//   node scripts/nebius/second-opinion.mjs                 # built-in real fixture (double-charge)
//   node scripts/nebius/second-opinion.mjs --proof p.json --issue issue.md
//   node scripts/nebius/second-opinion.mjs --list-models   # what Token Factory serves your key

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProof, diffFlow, labelProof, labelerModelFromEnv, allChanges } from '../../packages/proof/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIX = join(REPO, 'packages', 'proof', 'test', 'fixtures', 'b1');

const C = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
const mark = (label) => (label === 'intended' ? `${C.green}intended${C.reset}` : `${C.red}unintended${C.reset}`);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/** The real "naive fix" case: a double-charge fix that also drops a cent on an untouched bill. */
function fixtureCase() {
  const fx = (p) => JSON.parse(readFileSync(join(FIX, p), 'utf8'));
  const replay = fx('replay.json');
  const tip = diffFlow(fx('change-tip.base.json'), fx('change-tip.head.json'));
  const rb = fx('replay.base.json');
  const rh = fx('replay.head.json');
  const rep = diffFlow(rb, rh);
  const proof = buildProof({
    mr: 42, base: 'a1b2c3d', head: 'e4f5a6b', rid: replay.rid,
    flows: [
      { flow: 'change-tip', source: 'e2e', changes: tip, routes: ['/bill/9'] },
      {
        flow: 'replay-r_20261011_8f3a2c', source: 'replay', changes: rep,
        routes: [...new Set([...rb.steps, ...rh.steps].map((s) => s.route))].sort(),
        testids: ['confirm-settle-btn', 'save-bill-btn', 'settle-btn', 'settled-banner', 'total-input'],
      },
    ],
  });
  return { proof, issueText: readFileSync(join(FIX, 'issue.md'), 'utf8'), replays: [replay], name: 'double-charge naive fix (b1 fixture)' };
}

async function listModels(baseUrl, apiKey) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/models`;
  const res = await fetch(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
  if (!res.ok) throw new Error(`GET /models -> HTTP ${res.status}`);
  const data = await res.json();
  const ids = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
  console.log(`${C.bold}Models on ${baseUrl}${C.reset}`);
  for (const id of ids.sort()) console.log(`  ${/nemotron/i.test(id) ? C.cyan + id + C.reset : id}`);
  const nemo = ids.filter((id) => /nemotron/i.test(id));
  console.log(`\n${nemo.length} Nemotron model(s). Set MODEL_NAME to one of the ids above.`);
}

async function main() {
  const env = process.env;
  const baseUrl = env.MODEL_BASE_URL || 'https://api.tokenfactory.nebius.com/v1';

  if (process.argv.includes('--list-models')) {
    await listModels(baseUrl, env.MODEL_API_KEY);
    return 0;
  }

  const llm = labelerModelFromEnv(env);
  if (!llm || llm.name === 'none') {
    console.error(`${C.red}No model configured.${C.reset} Set MODEL_PROVIDER=openai-compatible, MODEL_BASE_URL, MODEL_NAME and MODEL_API_KEY (see this file's header).`);
    return 2;
  }

  let c;
  const proofPath = arg('--proof');
  if (proofPath) {
    const proof = JSON.parse(readFileSync(resolve(proofPath), 'utf8'));
    const issueText = arg('--issue') ? readFileSync(resolve(arg('--issue')), 'utf8') : '';
    c = { proof, issueText, replays: [], name: proofPath };
  } else {
    c = fixtureCase();
  }

  console.log(`${C.bold}ShakeFix Second Opinion — live on Nebius Token Factory${C.reset}`);
  console.log(`  provider : ${llm.name}`);
  console.log(`  endpoint : ${baseUrl}/chat/completions`);
  console.log(`  model    : ${C.cyan}${llm.model}${C.reset}`);
  console.log(`  case     : ${c.name}`);
  console.log(`  json mode: ${env.PROOF_RESPONSE_FORMAT || '(off — tolerant parse)'}\n`);

  const t0 = Date.now();
  const res = await labelProof(c.proof, { issueText: c.issueText, replays: c.replays, llm });
  const ms = Date.now() - t0;

  const changes = allChanges(res.proof);
  const w = Math.max(10, ...changes.map((ch) => (ch.where || '').length));
  for (const ch of changes) {
    const flag = ch.disputed ? ` ${C.yellow}[disputed → human]${C.reset}` : '';
    console.log(`  ${(ch.where || ch.id).padEnd(w)}  ${mark(ch.label)}${flag}`);
    console.log(`    ${C.dim}${ch.channel}: ${JSON.stringify(ch.before)} → ${JSON.stringify(ch.after)}${C.reset}`);
    console.log(`    ${C.dim}${ch.reason}${C.reset}`);
  }

  const s = res.proof.summary;
  console.log(`\n  ${s.changes} changes · ${s.intended} intended · ${s.unintended} unintended`);
  if (res.labeler === 'llm') {
    console.log(`  ${C.green}✓ labeled by Nemotron on Nebius${C.reset} (${llm.model}) in ${ms} ms`);
    return 0;
  }
  console.error(`  ${C.red}✗ fell back to deterministic rules${C.reset}: ${res.error || 'no live model verdict'} (${ms} ms)`);
  return 1; // the whole point is a live Nemotron call — a fallback is a failure here
}

main().then((code) => process.exit(code), (err) => { console.error(`${C.red}error:${C.reset} ${err?.message || err}`); process.exit(3); });
