import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLocalRunner, nextRole, roleBudget } from '../src/agent/index.js';
import { loadRolePrompts } from '../src/prompts.js';

const REPO = resolve(import.meta.dirname, '../../..');
let roles;
let root;

beforeAll(async () => {
  roles = await loadRolePrompts(REPO);
  root = mkdtempSync(join(tmpdir(), 'shakefix-run-'));
  mkdirSync(join(root, 'apps/splitpal/src/lib'), { recursive: true });
  writeFileSync(join(root, 'apps/splitpal/src/lib/split.js'), 'export const cents = (n) => Math.floor(n * 100);\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Scripted model: per role (detected from the system prompt) a queue of replies. */
function scriptedModel(script) {
  const seen = [];
  return {
    name: 'scripted',
    seen,
    async complete({ system, messages }) {
      const role = Object.keys(script).find((r) => system.includes(`ROLE: ${r}`));
      seen.push({ role, messages: messages.map((m) => ({ ...m })) });
      const q = script[role];
      const next = q.length > 1 ? q.shift() : q[0];
      return typeof next === 'function' ? next(messages) : next;
    },
  };
}

function fakeScm() {
  const calls = [];
  const rec = (name, ret) => async (...args) => { calls.push({ name, args }); return typeof ret === 'function' ? ret(...args) : ret; };
  return {
    name: 'github',
    repo: 'acme/splitpal',
    calls,
    defaultBranch: async () => 'main',
    getIssue: rec('getIssue', (n) => ({ iid: n, title: 'Settle does nothing', labels: ['shakefix'], web_url: `https://github.com/acme/splitpal/issues/${n}`, description: '<!-- shakefix:rid=r_20261011_abc123 -->' })),
    commitFiles: rec('commitFiles', { sha: 'c0ffee' }),
    createMR: rec('createMR', { iid: 12, web_url: 'https://github.com/acme/splitpal/pull/12', labels: ['shakefix', 'shakefix::proof'] }),
    addIssueNote: rec('addIssueNote', { id: 1 }),
    updateIssue: rec('updateIssue', { labels: [] }),
  };
}

const J = (o) => JSON.stringify(o);

describe('routing and budgets (mirror the Duo YAML)', () => {
  it('nextRole follows the routers', () => {
    expect(nextRole('triage_nurse', 'reproduced')).toBe('surgeon');
    expect(nextRole('triage_nurse', ' Reproduced.')).toBe('surgeon');
    expect(nextRole('triage_nurse', 'not_shakefix')).toBe('end');
    expect(nextRole('triage_nurse', 'not_reproduced')).toBe('discharge');
    expect(nextRole('surgeon', '{}')).toBe('attending');
    expect(nextRole('attending', '{}')).toBe('discharge');
    expect(nextRole('discharge', '{}')).toBe('end');
  });

  it('budgets come from the prompts ("Budget: about N tool calls") and can be capped', () => {
    const by = Object.fromEntries(roles.map((r) => [r.role, r]));
    expect(roleBudget(by.triage_nurse)).toBe(40);
    expect(roleBudget(by.surgeon)).toBe(60);
    expect(roleBudget(by.attending)).toBe(25);
    expect(roleBudget(by.discharge)).toBe(15);
    expect(roleBudget(by.surgeon, 5)).toBe(5);
  });
});

describe('local runner', () => {
  it('not_shakefix ends after the triage nurse; tool results are fed back', async () => {
    const scm = fakeScm();
    const model = scriptedModel({
      'ShakeFix Triage Nurse': [J({ tool: 'get_issue', args: { issue_iid: 5 } }), 'not_shakefix'],
    });
    const res = await createLocalRunner({ repoRoot: root, scm, model, roles, log: () => {} }).run({ issue: 5 });
    expect(res.transcript).toHaveLength(1);
    expect(res.transcript[0]).toMatchObject({ role: 'triage_nurse', final: 'not_shakefix' });
    expect(res.transcript[0].calls).toEqual([{ tool: 'get_issue', args: { issue_iid: 5 }, ok: true }]);
    const second = model.seen[1].messages;
    expect(second[0].content).toMatch(/Goal: Work item created: https:\/\/github.com\/acme\/splitpal\/issues\/5/);
    expect(second[0].content).toMatch(/Project ID: acme\/splitpal/);
    expect(second.at(-1).content).toMatch(/^TOOL_RESULT get_issue:/);
  });

  it('full ER run: triage -> surgeon (commit via SCM) -> attending -> discharge (PR)', async () => {
    const scm = fakeScm();
    const model = scriptedModel({
      'ShakeFix Triage Nurse': [J({ tool: 'create_file_with_contents', args: { file_path: '.shakefix/tmp/triage.json', contents: '{"reproduced":true,"iid":9}' } }), 'reproduced'],
      'ShakeFix Surgeon': [
        J({ tool: 'edit_file', args: { file_path: 'apps/splitpal/src/lib/split.js', old_str: 'Math.floor', new_str: 'Math.round' } }),
        J({ tool: 'create_branch', args: { branch: 'shakefix/9-settle-rounding' } }),
        J({ tool: 'create_commit', args: { message: 'fix(split): round cents (closes #9)' } }),
        J({ final: { operated: true, branch: 'shakefix/9-settle-rounding' } }),
      ],
      'ShakeFix Attending': [J({ final: { approve: true, confidence: 0.9, concerns: [], policy_hits: [], summary: 'ok' } })],
      'ShakeFix Discharge': [
        (msgs) => {
          expect(msgs[0].content).toContain('Triage verdict: reproduced');
          expect(msgs[0].content).toContain('"branch":"shakefix/9-settle-rounding"');
          expect(msgs[0].content).toContain('"approve":true');
          return J({ tool: 'create_merge_request', args: { source_branch: 'shakefix/9-settle-rounding', title: 'Fix #9: settle rounding', description: 'chart\n\nCloses #9', labels: 'shakefix,shakefix::proof' } });
        },
        J({ final: { case: 'D', mr_iid: 12, labels: ['shakefix', 'shakefix::proof'] } }),
      ],
    });
    const res = await createLocalRunner({ repoRoot: root, scm, model, roles, log: () => {} }).run({ issue: 9 });
    expect(res.transcript.map((t) => t.role)).toEqual(['triage_nurse', 'surgeon', 'attending', 'discharge']);
    expect(readFileSync(join(root, 'apps/splitpal/src/lib/split.js'), 'utf8')).toContain('Math.round');
    const commit = scm.calls.find((c) => c.name === 'commitFiles').args[0];
    expect(commit).toMatchObject({ branch: 'shakefix/9-settle-rounding', startBranch: 'main', message: 'fix(split): round cents (closes #9)' });
    // the scratch triage.json is never committed
    expect(commit.files.map((f) => f.path)).toEqual(['apps/splitpal/src/lib/split.js']);
    const mr = scm.calls.find((c) => c.name === 'createMR').args[0];
    expect(mr).toMatchObject({ sourceBranch: 'shakefix/9-settle-rounding', targetBranch: 'main', labels: ['shakefix', 'shakefix::proof'] });
    expect(JSON.parse(res.transcript[3].final)).toMatchObject({ case: 'D', mr_iid: 12 });
  });

  it('a tool outside the role toolset is refused (attending is read-only)', async () => {
    const scm = fakeScm();
    const model = scriptedModel({
      'ShakeFix Triage Nurse': ['reproduced'],
      'ShakeFix Surgeon': [J({ final: { operated: false } })],
      'ShakeFix Attending': [J({ tool: 'edit_file', args: { file_path: 'x', old_str: 'a', new_str: 'b' } }), J({ final: { approve: false } })],
      'ShakeFix Discharge': [J({ final: { case: 'B' } })],
    });
    const res = await createLocalRunner({ repoRoot: root, scm, model, roles, log: () => {} }).run({ issue: 9 });
    expect(res.transcript[2].calls[0]).toMatchObject({ tool: 'edit_file', ok: false, error: 'tool edit_file is not available to this role' });
  });

  it('is bounded: after maxToolCalls the model is told to finish', async () => {
    const scm = fakeScm();
    const model = scriptedModel({
      'ShakeFix Triage Nurse': [(msgs) => (String(msgs.at(-1).content).startsWith('Tool budget exhausted') ? 'not_reproduced' : J({ tool: 'list_dir', args: { directory: '.' } }))],
      'ShakeFix Discharge': [J({ final: { case: 'A' } })],
    });
    const res = await createLocalRunner({ repoRoot: root, scm, model, roles, maxToolCalls: 3, log: () => {} }).run({ issue: 9 });
    expect(res.transcript[0].calls).toHaveLength(3);
    expect(res.transcript[0].final).toBe('not_reproduced');
    expect(res.transcript.map((t) => t.role)).toEqual(['triage_nurse', 'discharge']);
  });

  it('dry run: no files written, no commit, no MR', async () => {
    const scm = fakeScm();
    const model = scriptedModel({
      'ShakeFix Triage Nurse': [J({ tool: 'create_file_with_contents', args: { file_path: 'tests/regressions/issue-9.spec.ts', contents: 'x' } }), 'reproduced'],
      'ShakeFix Surgeon': [J({ tool: 'create_commit', args: { branch: 'shakefix/9-x', message: 'm' } }), J({ final: { operated: true } })],
      'ShakeFix Attending': [J({ final: { approve: true } })],
      'ShakeFix Discharge': [J({ tool: 'create_merge_request', args: { source_branch: 'shakefix/9-x', title: 't', description: 'd' } }), J({ final: { case: 'D' } })],
    });
    const logs = [];
    const res = await createLocalRunner({ repoRoot: root, scm, model, roles, dryRun: true, log: (m) => logs.push(m) }).run({ issue: 9 });
    expect(existsSync(join(root, 'tests/regressions/issue-9.spec.ts'))).toBe(false);
    expect(scm.calls.filter((c) => c.name !== 'getIssue')).toEqual([]);
    expect(res.transcript.flatMap((t) => t.calls).every((c) => c.dryRun)).toBe(true);
    expect(logs.filter((l) => l.startsWith('[dry-run] would call')).length).toBe(3);
  });

  it('rejects a missing issue number', async () => {
    await expect(createLocalRunner({ repoRoot: root, scm: fakeScm(), model: scriptedModel({}), roles }).run({})).rejects.toThrow(/--issue/);
  });
});
