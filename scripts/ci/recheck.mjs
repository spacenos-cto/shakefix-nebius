#!/usr/bin/env node
// Done stays done: read the Playwright JSON report of every regression spec run against production
// and print the issues whose bug is back, one iid per line (stdout). Summary on stderr.
//
//   node scripts/ci/recheck.mjs recheck.json
import { readFileSync } from 'node:fs';
import { recheckResults } from '../../packages/proof/src/recheck.js';

const file = process.argv[2] || 'recheck.json';
let report = {};
try { report = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`[recheck] cannot read ${file}: ${e.message}`); process.exit(1); }
const { checked, failed } = recheckResults(report);
console.error(`[recheck] ${checked.length} past case(s) re-checked on production, ${failed.length} came back${failed.length ? `: #${failed.join(', #')}` : ''}`);
for (const iid of failed) console.log(iid);
