// Agent runner switch. AGENT_RUNNER=duo | local.
//
//   duo   (default with SCM_PROVIDER=gitlab): the GitLab Duo custom flow runs the ER team, started by
//         the "Work item created" / Mention triggers. Nothing runs locally.
//   local (default with SCM_PROVIDER=github): a minimal Node agent loop runs the SAME four roles
//         (prompts from .shakefix/prompts, synced from the Duo YAML) with any ModelProvider and a
//         small sandboxed tool set. For platforms without Duo (GitHub + Nemotron / Vultr / Claude).
//
// AgentRunner interface: { name, run({ issue, dryRun? }) -> Promise<result> }

import { loadRolePrompts, fillTemplate } from '../prompts.js';
import { extractJson } from '../model/index.js';
import { createSandbox } from './sandbox.js';
import { createTools } from './tools.js';

export { createSandbox, SandboxError, tokenize } from './sandbox.js';
export { createTools, globToRegExp } from './tools.js';

export const AGENT_RUNNERS = Object.freeze(['duo', 'local']);
export const DEFAULT_BUDGETS = Object.freeze({ triage_nurse: 40, surgeon: 60, attending: 25, discharge: 15 });

export function agentRunnerName(env = process.env) {
  const explicit = String(env.AGENT_RUNNER || '').trim().toLowerCase();
  const name = explicit || (String(env.SCM_PROVIDER || 'gitlab').toLowerCase() === 'github' ? 'local' : 'duo');
  if (!AGENT_RUNNERS.includes(name)) throw new Error(`AGENT_RUNNER must be one of ${AGENT_RUNNERS.join('|')} (got "${env.AGENT_RUNNER}")`);
  return name;
}

/** Duo: issue creation / mentions trigger the flow on GitLab. */
export function createDuoRunner() {
  return {
    name: 'duo',
    async run({ issue } = {}) {
      return {
        runner: 'duo',
        ran: false,
        issue: issue ?? null,
        message: 'GitLab Duo runs the ER team from the "Work item created" and Mention triggers (.gitlab/duo/flows/shakefix.yml); nothing to run locally.',
      };
    },
  };
}

/** Tool budget for a role: "Budget: about N tool calls" in its prompt, capped by maxToolCalls. */
export function roleBudget(role, maxToolCalls) {
  const m = /Budget:\s*about\s*(\d+)\s*tool calls/i.exec(role.system || '');
  const fromPrompt = m ? Number(m[1]) : DEFAULT_BUDGETS[role.role] ?? 20;
  return maxToolCalls ? Math.min(fromPrompt, maxToolCalls) : fromPrompt;
}

/** Route after a role finishes (mirrors the routers in the Duo YAML). */
export function nextRole(role, finalAnswer) {
  if (role === 'triage_nurse') {
    const word = String(finalAnswer ?? '').trim().toLowerCase().replace(/[^a-z_]/g, ' ').trim().split(/\s+/)[0] || '';
    if (word === 'reproduced') return 'surgeon';
    if (word === 'not_shakefix') return 'end';
    return 'discharge';
  }
  return { surgeon: 'attending', attending: 'discharge', discharge: 'end' }[role] ?? 'end';
}

function preamble({ scm, role, tools, budget }) {
  const pr = scm?.name === 'github';
  const lines = tools.map((t) => `- ${t.name}${t.args ? ` ${t.args}` : ''}: ${t.desc}`);
  return [
    `You are running in the ShakeFix LOCAL agent runner (not GitLab Duo). SCM: ${scm?.name ?? 'unknown'}${pr ? ' (merge requests are GitHub pull requests; "!<n>" means PR #<n>)' : ''}.`,
    'PROTOCOL: reply with exactly ONE JSON object per turn and nothing else:',
    '  {"tool":"<name>","args":{...}}   to call one tool, or',
    '  {"final": <answer>}               when done; <answer> is exactly what your FINAL ANSWER rules require (string or JSON object).',
    `TOOLS (at most ${budget} calls for this role):`,
    ...lines,
    'RUNNER RULES: paths are relative to the repository root and cannot leave it. run_command allows only',
    '`node <script under packages/ or scripts/>`, `npx playwright test ...`, `pnpm test` / `pnpm --filter <pkg> test` /',
    '`pnpm exec playwright test ...`, and offline git (status, diff, log, show, add, commit, checkout, switch, branch, rev-parse,',
    'ls-files, restore). No shell operators, no network: never git fetch/pull/push. To publish work use create_branch then',
    'create_commit (they commit through the SCM API), then create_merge_request.',
    `ROLE: ${role.name}.`,
  ].join('\n');
}

const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const clip = (s, n = 8000) => (s.length > n ? `${s.slice(0, n)}\n...[truncated ${s.length - n} chars]` : s);

/**
 * Local runner.
 * @param {object} o
 * @param {string} o.repoRoot
 * @param {object} o.scm     ScmProvider
 * @param {object} o.model   ModelProvider
 * @param {Array}  [o.roles] role prompts (default: loaded from .shakefix/prompts)
 * @param {number} [o.maxToolCalls] hard cap per role (also SHAKEFIX_MAX_TOOL_CALLS in the CLI)
 * @param {boolean} [o.dryRun] side-effecting tools only print what they would do
 */
export function createLocalRunner({ repoRoot, scm, model, roles, maxToolCalls, dryRun = false, log = (m) => console.error(m), commandTimeoutMs, maxTokens = 4000 } = {}) {
  const sandbox = createSandbox(repoRoot);
  const state = {};
  const registry = createTools({ sandbox, scm, state, dryRun, log, commandTimeoutMs });

  async function runRole(role, vars) {
    const allowed = new Set(role.toolset);
    const tools = [...new Set([...allowed].map((n) => registry.byName.get(n)).filter(Boolean))];
    const budget = roleBudget(role, maxToolCalls);
    const system = `${preamble({ scm, role, tools, budget })}\n\n${role.system}`;
    const messages = [{ role: 'user', content: fillTemplate(role.user, vars) }];
    const calls = [];
    for (let turn = 0; turn <= budget + 1; turn++) {
      const text = await model.complete({ system, messages, maxTokens, temperature: 0 });
      messages.push({ role: 'assistant', content: text });
      let obj = null;
      try { obj = extractJson(text); } catch { /* plain-text final answer */ }
      if (!obj || (obj.tool === undefined && obj.final === undefined)) return { final: String(text).trim(), calls };
      if (obj.final !== undefined) return { final: asText(obj.final), calls };
      if (calls.length >= budget) {
        messages.push({ role: 'user', content: 'Tool budget exhausted. Reply now with {"final": ...} only.' });
        continue;
      }
      const name = String(obj.tool);
      const args = obj.args && typeof obj.args === 'object' ? obj.args : {};
      const result = await registry.call(name, args, allowed);
      calls.push({ tool: name, args, ok: !result?.error, ...(result?.dryRun ? { dryRun: true } : {}), ...(result?.error ? { error: result.error } : {}) });
      log(`[${role.role}] ${name} ${result?.error ? `-> error: ${result.error}` : '-> ok'}`);
      messages.push({ role: 'user', content: `TOOL_RESULT ${name}:\n${clip(asText(result ?? null))}` });
    }
    return { final: '', calls, exhausted: true };
  }

  return {
    name: 'local',
    sandbox,
    tools: registry,
    async run({ issue } = {}) {
      const iid = Number(issue);
      if (!Number.isInteger(iid) || iid <= 0) throw new Error('local runner needs --issue <number>');
      const all = roles || (await loadRolePrompts(repoRoot));
      const byRole = Object.fromEntries(all.map((r) => [r.role, r]));
      try { state.defaultBranch = await scm.defaultBranch(); } catch { /* resolved lazily on commit */ }
      let url = '';
      try { url = (await scm.getIssue(iid))?.web_url || ''; } catch { /* the triage nurse will retry */ }
      const vars = {
        goal: `Work item created: ${url || `issue #${iid}`}\nContext: {Issue IID: ${iid}}`,
        project_id: scm?.repo || scm?.projectId || '',
      };
      const transcript = [];
      let current = 'triage_nurse';
      for (let hops = 0; current !== 'end' && hops < 8; hops++) {
        const role = byRole[current];
        if (!role) throw new Error(`no prompt for role ${current}`);
        log(`== ${role.name} ==`);
        const res = await runRole(role, vars);
        transcript.push({ role: current, final: res.final, calls: res.calls, exhausted: Boolean(res.exhausted) });
        if (current === 'triage_nurse') vars.triage_verdict = res.final;
        if (current === 'surgeon') vars.surgery_report = res.final;
        if (current === 'attending') vars.review = res.final;
        current = nextRole(current, res.final);
      }
      return { runner: 'local', issue: iid, dryRun, transcript };
    },
  };
}

/** Pick a runner by name (AGENT_RUNNER) with the given providers. */
export function createAgentRunner({ runner = 'duo', ...opts } = {}) {
  if (runner === 'duo') return createDuoRunner();
  if (runner === 'local') return createLocalRunner(opts);
  throw new Error(`unknown agent runner "${runner}"`);
}
