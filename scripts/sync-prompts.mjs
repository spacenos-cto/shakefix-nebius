#!/usr/bin/env node
// Extract the ER role prompts from the Duo flow (the source of truth) into .shakefix/prompts/*.md,
// which the local agent runner (packages/core, AGENT_RUNNER=local) reads.
//
//   node scripts/sync-prompts.mjs            write / refresh the files
//   node scripts/sync-prompts.mjs --check    exit 1 if any file is missing or out of date
//
// packages/core/test/prompts.test.js runs the same comparison, so drift fails `pnpm test`.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOW_PATH, expectedPromptFiles } from '../packages/core/src/prompts.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const yaml = await readFile(join(root, FLOW_PATH), 'utf8');
const files = expectedPromptFiles(yaml);
if (!Object.keys(files).length) {
  console.error(`sync-prompts: no prompts found in ${FLOW_PATH}`);
  process.exit(1);
}

let drift = 0;
for (const [rel, content] of Object.entries(files)) {
  const p = join(root, rel);
  const current = await readFile(p, 'utf8').catch(() => null);
  if (current?.replace(/\r\n/g, '\n') === content) continue;
  drift++;
  if (check) {
    console.error(`sync-prompts: ${rel} is ${current === null ? 'missing' : 'out of date'}`);
  } else {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
    console.log(`sync-prompts: wrote ${rel}`);
  }
}
if (check && drift) {
  console.error('sync-prompts: run `node scripts/sync-prompts.mjs` and commit the result');
  process.exit(1);
}
if (!drift) console.log(`sync-prompts: ${Object.keys(files).length} prompt file(s) up to date`);
