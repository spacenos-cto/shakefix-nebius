#!/usr/bin/env node
// Re-record the DEMO_MODE hero run from a real, finished case.
//
//   node services/intake/scripts/record-demo-fixture.mjs --intake https://intake-xxx.run.app --rid r_20261011_b1d3e0 \
//        [--out services/intake/src/demo/hero-run.json]
//
// Reads GET <intake>/v1/reports/<rid>/timeline (public) and writes a shakefix.demo/v1 fixture whose
// observed stages are all "recorded". Stages the intake never observed are dropped, never invented.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateFixture } from '../src/demo.js';

const { values: o } = parseArgs({ options: { intake: { type: 'string' }, rid: { type: 'string' }, out: { type: 'string' } } });
if (!o.intake || !o.rid) {
  console.error('usage: record-demo-fixture.mjs --intake <url> --rid <rid> [--out <path>]');
  process.exit(2);
}
const out = o.out || fileURLToPath(new URL('../src/demo/hero-run.json', import.meta.url));
const prev = (() => { try { return JSON.parse(readFileSync(out, 'utf8')); } catch { return {}; } })();

const base = o.intake.replace(/\/+$/, '');
const res = await fetch(`${base}/v1/reports/${encodeURIComponent(o.rid)}/timeline`);
if (!res.ok) throw new Error(`timeline ${res.status}`);
const tl = await res.json();
if (tl.demo) throw new Error('that intake is in DEMO_MODE; record from the live intake');
const start = Date.parse(tl.startedAt);
const stages = tl.stages
  .filter((s) => s.at)
  .map((s) => ({ key: s.key, offsetS: Math.round((Date.parse(s.at) - start) / 1000), source: 'recorded', evidence: `intake timeline ${s.at}` }))
  .sort((a, b) => a.offsetS - b.offsetS);

// Carry over hand-filled fields (title, links, proof) only when re-recording the SAME case.
const same = prev.rid === tl.rid ? prev : {};

const fixture = validateFixture({
  schema: 'shakefix.demo/v1',
  about: `Hero run recorded from ${base} on ${new Date().toISOString()} (rid ${tl.rid}). Every stage is a recorded intake timestamp.`,
  recordedAt: tl.startedAt,
  rid: tl.rid,
  issueIid: tl.issueIid,
  mrIid: tl.mrIid,
  title: same.title ?? `ShakeFix report ${tl.rid}`,
  sev: same.sev ?? 2,
  route: same.route ?? '/',
  issueUrl: same.issueUrl ?? null,
  mrUrl: same.mrUrl ?? null,
  branch: same.branch ?? null,
  humanTouches: tl.humanTouches,
  cost: tl.cost,
  proof: same.proof ?? null,
  stages,
});
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${out}: ${stages.length} recorded stage(s), ${tl.stopwatch}`);
