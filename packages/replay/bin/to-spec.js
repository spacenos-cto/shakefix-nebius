#!/usr/bin/env node
// Usage: node packages/replay/bin/to-spec.js <replay.json> <out.spec.ts> --iid <n> [--base-url-env BASE_URL]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { generateSpec } from '../lib/to-spec.js';

const USAGE = 'Usage: node packages/replay/bin/to-spec.js <replay.json> <out.spec.ts> --iid <n> [--base-url-env BASE_URL]';

function parseArgs(argv) {
  const pos = [];
  const opts = { baseUrlEnv: 'BASE_URL' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const next = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === '--iid') opts.iid = next();
    else if (flag === '--base-url-env') opts.baseUrlEnv = next();
    else if (flag === '-h' || flag === '--help') opts.help = true;
    else if (flag.startsWith('--')) throw new Error(`Unknown option ${flag}`);
    else pos.push(a);
  }
  return { pos, opts };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message + '\n' + USAGE);
    return 1;
  }
  const { pos, opts } = parsed;
  if (opts.help) { console.log(USAGE); return 0; }
  if (pos.length !== 2 || !opts.iid) { console.error(USAGE); return 1; }
  if (!/^\d+$/.test(String(opts.iid))) { console.error(`--iid must be a number, got "${opts.iid}"`); return 1; }

  const [inPath, outPath] = pos.map((p) => resolve(p));
  let replay;
  try {
    replay = JSON.parse(await readFile(inPath, 'utf8'));
  } catch (e) {
    console.error(`Cannot read replay ${inPath}: ${e.message}`);
    return 2;
  }
  if (replay.schema && replay.schema !== 'shakefix.replay/v1') console.error(`warning: unexpected schema "${replay.schema}"`);

  let code;
  try {
    code = generateSpec(replay, { iid: Number(opts.iid), baseUrlEnv: opts.baseUrlEnv });
  } catch (e) {
    console.error(`Invalid replay: ${e.message}`);
    return 2;
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, code, 'utf8');
  console.log(`wrote ${pos[1]} (${(replay.actions || []).length} actions, expectation: ${replay.expectation ? `${replay.expectation.testid} ${replay.expectation.state}` : 'none → no console errors / error-banner'})`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
