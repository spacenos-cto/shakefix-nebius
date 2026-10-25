#!/usr/bin/env node
// Run the agents' regression spec against base AND head, and add the result to proof.json as a
// reproduction entry. Fix Confidence then sees the strongest proof available: the spec must FAIL on
// base (bug reproduced) and PASS on head (bug fixed). The user's raw replay alone often can't show
// that (masked input, no expectation), so without this a correct fix is held as "unproven".
//
//   node scripts/ci/spec-reproduction.mjs --base <url> --head <url> --branch shakefix/<iid>-slug --proof proof/proof.json
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string' }, branch: { type: 'string' }, proof: { type: 'string', default: 'proof/proof.json' } } });
const log = (...a) => console.error('[spec-repro]', ...a);
const iid = /^shakefix\/(\d+)(?:-|$)/.exec(o.branch ?? '')?.[1];
if (!iid || !o.base || !o.head) { log('not a ShakeFix MR or missing URLs; skipped'); process.exit(0); }

const specs = existsSync('tests/regressions')
  ? readdirSync('tests/regressions').filter((f) => new RegExp(`^issue-${iid}(-r\\d+)?\\.spec\\.ts$`).test(f)).map((f) => `tests/regressions/${f}`)
  : [];
if (!specs.length) { log(`no tests/regressions/issue-${iid}*.spec.ts; skipped`); process.exit(0); }

function run(url, spec) {
  const r = spawnSync('npx', ['playwright', 'test', spec, '--reporter=line', '--retries=0'], {
    env: { ...process.env, BASE_URL: url }, encoding: 'utf8', timeout: 240_000, shell: process.platform === 'win32',
  });
  return { passed: r.status === 0, exit: r.status };
}

const proof = JSON.parse(readFileSync(o.proof, 'utf8'));
for (const spec of specs) {
  const base = run(o.base, spec);
  const head = run(o.head, spec);
  log(`${spec}: base ${base.passed ? 'PASS' : 'FAIL'}, head ${head.passed ? 'PASS' : 'FAIL'}`);
  proof.flows.push({ flow: `spec:${spec}`, source: 'replay', kind: 'regression-spec', changes: [], reproduction: { base: { passed: base.passed }, head: { passed: head.passed } } });
}
writeFileSync(o.proof, `${JSON.stringify(proof, null, 2)}\n`);
