#!/usr/bin/env node
// Provider-neutral SCM helper for CI on non-GitLab platforms (the GitLab pipeline keeps its
// curl scripts in scripts/ci/). Provider from SCM_PROVIDER (+ GITHUB_REPO/GITHUB_TOKEN or GitLab vars).
//
//   shakefix-scm labels  (--mr <n> | --issue <n>) [--add a,b] [--remove c,d] [--state reopen|close]
//   shakefix-scm note    (--mr <n> | --issue <n>) (--body <text> | --body-file <path>)
//   shakefix-scm merge   --mr <n> [--sha <sha>] [--no-squash]
//   shakefix-scm mr-labels --mr <n>             prints the labels, comma separated
//   shakefix-scm linked-issues --mr <n>         prints issue numbers the MR/PR closes, one per line
//   shakefix-scm rid --issue <n>                prints the shakefix rid of an issue

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scmFromEnv } from '../src/scm/index.js';

const csv = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export async function main(argv = process.argv.slice(2), env = process.env, { out = console.log, scm: injected } = {}) {
  const [cmd, ...rest] = argv;
  const { values: o } = parseArgs({
    args: rest,
    options: {
      mr: { type: 'string' }, issue: { type: 'string' }, add: { type: 'string' }, remove: { type: 'string' },
      state: { type: 'string' }, body: { type: 'string' }, 'body-file': { type: 'string' }, sha: { type: 'string' }, 'no-squash': { type: 'boolean', default: false },
    },
  });
  const scm = injected || scmFromEnv(env);
  switch (cmd) {
    case 'labels': {
      const opts = { addLabels: csv(o.add), removeLabels: csv(o.remove) };
      if (o.mr) await scm.updateMR(Number(o.mr), opts);
      else if (o.issue) await scm.updateIssue(Number(o.issue), { ...opts, ...(o.state ? { stateEvent: o.state } : {}) });
      else throw new Error('labels needs --mr or --issue');
      return 0;
    }
    case 'note': {
      const body = o['body-file'] ? await readFile(o['body-file'], 'utf8') : o.body;
      if (!body) throw new Error('note needs --body or --body-file');
      if (o.mr) await scm.addMRNote(Number(o.mr), body);
      else if (o.issue) await scm.addIssueNote(Number(o.issue), body);
      else throw new Error('note needs --mr or --issue');
      return 0;
    }
    case 'merge': {
      if (!o.mr) throw new Error('merge needs --mr');
      await scm.mergeMR(Number(o.mr), { sha: o.sha, squash: !o['no-squash'] });
      return 0;
    }
    case 'mr-labels': {
      out((await scm.getMR(Number(o.mr))).labels.join(','));
      return 0;
    }
    case 'linked-issues': {
      for (const i of await scm.mrClosesIssues(Number(o.mr))) out(String(i.iid));
      return 0;
    }
    case 'rid': {
      out((await scm.findRidInIssue(Number(o.issue))) || '');
      return 0;
    }
    default:
      throw new Error(`unknown command ${cmd ?? ''} (labels | note | merge | mr-labels | linked-issues | rid)`);
  }
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`shakefix-scm: ${e.message}`); process.exitCode = 1; });
}
