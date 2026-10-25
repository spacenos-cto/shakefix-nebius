#!/usr/bin/env node
// Blast Radius on a merge request: maps the MR's changed files to routes, components and the
// synthetic patients who used them, then posts (or edits) one MR note. Arrows on here; the Duo
// note tool escapes '>' so the agents use --links plain instead.
//
//   node scripts/ci/blast-note.mjs --files a,b --app-url URL --mr <iid>
//
// Env: CI_API_V4_URL, CI_PROJECT_ID, SHAKEFIX_BOT_TOKEN. Never fails the pipeline on API errors.

import { parseArgs } from 'node:util';
import { blastRadius } from '../../packages/core/src/blast/index.js';
import { MARKER } from '../../packages/core/src/blast/render.js';

const { values: o } = parseArgs({ options: { files: { type: 'string' }, 'app-url': { type: 'string' }, mr: { type: 'string' } } });
const files = String(o.files ?? '').split(',').map((s) => s.trim()).filter((f) => f.startsWith('apps/carerx/src/'));
if (!files.length) { console.log('blast: no CareRx source files changed; skipping'); process.exit(0); }

const report = await blastRadius({ files, appUrl: o['app-url'], links: 'arrow' });
console.log(report.markdown);

const { CI_API_V4_URL: api, CI_PROJECT_ID: pid, SHAKEFIX_BOT_TOKEN: token } = process.env;
if (!api || !pid || !token || !o.mr) { console.log('blast: no GitLab env or MR; not posting'); process.exit(0); }
const base = `${api}/projects/${pid}/merge_requests/${o.mr}/notes`;
const headers = { 'PRIVATE-TOKEN': token, 'content-type': 'application/json' };
try {
  const notes = await (await fetch(`${base}?per_page=100&sort=desc`, { headers })).json();
  const mine = Array.isArray(notes) ? notes.find((n) => n?.body?.includes(MARKER)) : null;
  const res = await fetch(mine ? `${base}/${mine.id}` : base, { method: mine ? 'PUT' : 'POST', headers, body: JSON.stringify({ body: report.markdown }) });
  console.log(`blast: ${mine ? 'updated' : 'posted'} MR note (${res.status})`);
} catch (e) {
  console.log(`blast: could not post (${e.message})`);
}
