#!/usr/bin/env node
// Run the ShakeFix ER team on one issue with the local agent runner.
//
//   node packages/core/bin/shakefix-agent.js --issue <n> [--dry-run] [--repo <dir>] [--max-tool-calls <n>] [--runner local|duo] [--json]
//
// Providers come from the environment (docs/PROVIDERS.md):
//   SCM_PROVIDER=github GITHUB_REPO=owner/name GITHUB_TOKEN=...            (or gitlab: GITLAB_PROJECT_ID + GITLAB_TOKEN)
//   MODEL_PROVIDER=openai-compatible MODEL_BASE_URL=... MODEL_NAME=... MODEL_API_KEY=...   (or anthropic)
// --dry-run: read-only tools run; writes, commands, commits, MRs and comments are only printed.
//   With MODEL_PROVIDER=none it prints the role plan (roles, tools, budgets) without calling a model.
// Exit codes: 0 done · 1 error · 2 usage

import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { scmFromEnv, modelFromEnv, modelProviderName, agentRunnerName, createAgentRunner, loadRolePrompts, roleBudget } from '../src/index.js';

const HELP = `shakefix-agent --issue <n> [--dry-run] [--repo <dir>] [--max-tool-calls <n>] [--runner local|duo] [--json]`;

export async function main(argv = process.argv.slice(2), env = process.env, { out = console.log, err = console.error } = {}) {
  let o;
  try {
    ({ values: o } = parseArgs({
      args: argv,
      options: {
        issue: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, repo: { type: 'string' },
        'max-tool-calls': { type: 'string' }, runner: { type: 'string' }, json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (e) {
    err(`${e.message}\n${HELP}`);
    return 2;
  }
  if (o.help) { out(HELP); return 0; }
  if (!o.issue || !/^\d+$/.test(o.issue)) { err(`--issue <number> is required\n${HELP}`); return 2; }

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(o.repo || env.SHAKEFIX_REPO_ROOT || resolve(here, '../../..'));
  const runnerName = o.runner || agentRunnerName({ ...env, AGENT_RUNNER: env.AGENT_RUNNER || 'local' });
  const maxToolCalls = Number(o['max-tool-calls'] || env.SHAKEFIX_MAX_TOOL_CALLS) || undefined;
  const dryRun = o['dry-run'];

  if (runnerName === 'duo') {
    const r = await createAgentRunner({ runner: 'duo' }).run({ issue: Number(o.issue) });
    out(o.json ? JSON.stringify(r) : r.message);
    return 0;
  }

  if (dryRun && modelProviderName(env) === 'none') {
    const roles = await loadRolePrompts(repoRoot);
    const plan = roles.map((r) => ({ role: r.role, name: r.name, budget: roleBudget(r, maxToolCalls), tools: r.toolset }));
    if (o.json) out(JSON.stringify({ runner: 'local', dryRun: true, issue: Number(o.issue), plan }));
    else {
      out(`[dry-run] local runner plan for issue #${o.issue} (MODEL_PROVIDER=none, no model calls):`);
      for (const p of plan) out(`  ${p.role} (max ${p.budget} tool calls): ${p.tools.join(', ')}`);
      out('  routing: triage_nurse -> surgeon (reproduced) | discharge (not_reproduced) | end (not_shakefix); surgeon -> attending -> discharge -> end');
    }
    return 0;
  }

  const scm = scmFromEnv(env);
  const model = modelFromEnv(env);
  if (model.name === 'none') { err('MODEL_PROVIDER=none: the local runner needs a model (use --dry-run to print the plan)'); return 2; }
  const runner = createAgentRunner({ runner: 'local', repoRoot, scm, model, dryRun, maxToolCalls, log: err });
  const res = await runner.run({ issue: Number(o.issue) });
  if (o.json) out(JSON.stringify(res));
  else {
    for (const t of res.transcript) {
      out(`== ${t.role}: ${t.calls.length} tool call(s)${t.exhausted ? ' (budget exhausted)' : ''}`);
      for (const c of t.calls) out(`   ${c.dryRun ? '[dry-run] ' : ''}${c.tool} ${JSON.stringify(c.args).slice(0, 200)}${c.error ? `  !! ${c.error}` : ''}`);
      out(`   final: ${String(t.final).slice(0, 500)}`);
    }
  }
  return 0;
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`shakefix-agent: ${e.message}`); process.exitCode = 1; });
}
