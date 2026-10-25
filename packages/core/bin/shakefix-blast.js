#!/usr/bin/env node
// ShakeFix Blast Radius CLI (docs/BLAST-RADIUS.md). Markdown on stdout by default, JSON with --json.
// Works offline: without an app URL the patient count is "unknown"; without Orbit config the
// static graph is used.
//
//   shakefix-blast --replay reports/<rid>/replay.json [--files a,b] [--app-url URL] [--json] [--out file.md]
//   shakefix-blast --files apps/carerx/src/lib/money.js,apps/carerx/src/views/refill.js#renderRefill
//
// Options: --app-dir <dir> (default <repo>/apps/carerx), --app-prefix apps/carerx, --hops 1..3,
//          --category billing|accessibility|privacy|medication-info|general, --segment <name>,
//          --no-orbit
// Env: APP_URL (fallback for --app-url), GITLAB_URL/CI_SERVER_URL + ORBIT_TOKEN|GITLAB_TOKEN +
//      ORBIT_PROJECT_ID|CI_PROJECT_ID (Orbit; any failure falls back to the static graph).
// Exit: 0 ok, 2 usage error, 1 failure.

import { parseArgs } from 'node:util';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blastRadius } from '../src/blast/index.js';

const OPTIONS = {
  replay: { type: 'string' },
  files: { type: 'string' },
  'app-url': { type: 'string' },
  links: { type: 'string', default: 'arrow' },
  'app-dir': { type: 'string' },
  'app-prefix': { type: 'string' },
  hops: { type: 'string' },
  category: { type: 'string' },
  segment: { type: 'string' },
  json: { type: 'boolean', default: false },
  out: { type: 'string' },
  'no-orbit': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

const USAGE = 'usage: shakefix-blast --replay <replay.json> [--files a,b] [--app-url URL] [--json] [--out file.md]';
const REPO = resolve(import.meta.dirname, '../../..');
const csv = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * @param {string[]} argv
 * @param {Record<string,string|undefined>} env
 * @param {{out:(s:string)=>void, err:(s:string)=>void}} io
 * @param {{fetch?:Function, cwd?:string}} deps
 */
export async function main(argv = process.argv.slice(2), env = process.env, io = { out: (s) => console.log(s), err: (s) => console.error(s) }, deps = {}) {
  let o;
  try {
    ({ values: o } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    io.err(`shakefix-blast: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (o.help) { io.out(USAGE); return 0; }
  if (!o.replay && !o.files) { io.err(`shakefix-blast: need --replay and/or --files\n${USAGE}`); return 2; }
  const cwd = deps.cwd ?? process.cwd();
  const abs = (p) => (isAbsolute(p) ? p : resolve(cwd, p));

  let replay = null;
  if (o.replay) {
    if (!existsSync(abs(o.replay))) { io.err(`shakefix-blast: replay not found: ${o.replay}`); return 2; }
    try {
      replay = JSON.parse(readFileSync(abs(o.replay), 'utf8'));
    } catch (e) {
      io.err(`shakefix-blast: replay is not JSON: ${e.message}`);
      return 2;
    }
  }
  const appPrefix = o['app-prefix'] ?? 'apps/carerx';
  const appDir = o['app-dir'] ? abs(o['app-dir']) : resolve(REPO, appPrefix);
  if (!existsSync(appDir)) { io.err(`shakefix-blast: app folder not found: ${appDir} (use --app-dir)`); return 2; }

  const report = await blastRadius({
    links: o.links === 'plain' ? 'plain' : 'arrow',
    appDir,
    appPrefix,
    replay,
    files: csv(o.files),
    appUrl: o['app-url'] || env.APP_URL || '',
    env,
    fetch: deps.fetch,
    hops: o.hops,
    category: o.category,
    segment: o.segment,
    orbit: !o['no-orbit'],
  });
  const text = o.json ? JSON.stringify(report, null, 2) : report.markdown;
  if (o.out) writeFileSync(abs(o.out), `${text}\n`);
  io.out(text);
  return 0;
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.error(`shakefix-blast: ${e.message}`);
    process.exitCode = 1;
  });
}
