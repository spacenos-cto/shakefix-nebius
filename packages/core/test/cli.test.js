import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { main as agentMain } from '../bin/shakefix-agent.js';
import { main as scmMain } from '../bin/shakefix-scm.js';

const REPO = resolve(import.meta.dirname, '../../..');
const capture = () => {
  const out = [];
  const err = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
};

describe('shakefix-agent CLI', () => {
  it('--dry-run with MODEL_PROVIDER=none prints the role plan without any network call', async () => {
    const c = capture();
    const code = await agentMain(['--issue', '9', '--dry-run', '--repo', REPO], { MODEL_PROVIDER: 'none' }, c.io);
    expect(code).toBe(0);
    const text = c.out.join('\n');
    expect(text).toMatch(/plan for issue #9/);
    expect(text).toMatch(/triage_nurse \(max 40 tool calls\): get_issue/);
    expect(text).toMatch(/discharge \(max 15 tool calls\)/);
  });

  it('--json plan honours --max-tool-calls', async () => {
    const c = capture();
    await agentMain(['--issue', '3', '--dry-run', '--json', '--max-tool-calls', '5', '--repo', REPO], { MODEL_PROVIDER: 'none' }, c.io);
    const plan = JSON.parse(c.out[0]);
    expect(plan.plan.map((p) => p.budget)).toEqual([5, 5, 5, 5]);
  });

  it('usage errors exit 2; runner duo has nothing to do', async () => {
    const c = capture();
    expect(await agentMain([], {}, c.io)).toBe(2);
    expect(await agentMain(['--issue', 'abc'], {}, c.io)).toBe(2);
    expect(await agentMain(['--issue', '1', '--runner', 'duo'], {}, c.io)).toBe(0);
    expect(c.out.at(-1)).toMatch(/GitLab Duo/);
  });

  it('a real (non dry) run without a model refuses', async () => {
    const c = capture();
    const code = await agentMain(['--issue', '1', '--repo', REPO], { MODEL_PROVIDER: 'none', SCM_PROVIDER: 'github', GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't' }, c.io);
    expect(code).toBe(2);
    expect(c.err.join('\n')).toMatch(/needs a model/);
  });
});

describe('shakefix-scm CLI', () => {
  it('labels / note / merge / mr-labels go through the ScmProvider', async () => {
    const calls = [];
    const scm = new Proxy({}, {
      get: (_t, name) => async (...args) => {
        calls.push([name, ...args]);
        if (name === 'getMR') return { labels: ['shakefix', 'shakefix::ready'] };
        if (name === 'mrClosesIssues') return [{ iid: 9 }];
        if (name === 'findRidInIssue') return 'r_1';
        return {};
      },
    });
    const out = [];
    await scmMain(['labels', '--mr', '12', '--add', 'shakefix::ready', '--remove', 'shakefix::proof,shakefix::unintended'], {}, { scm, out: (s) => out.push(s) });
    await scmMain(['note', '--issue', '9', '--body', 'hi'], {}, { scm });
    await scmMain(['merge', '--mr', '12', '--sha', 'abc'], {}, { scm });
    await scmMain(['mr-labels', '--mr', '12'], {}, { scm, out: (s) => out.push(s) });
    await scmMain(['linked-issues', '--mr', '12'], {}, { scm, out: (s) => out.push(s) });
    expect(calls).toEqual([
      ['updateMR', 12, { addLabels: ['shakefix::ready'], removeLabels: ['shakefix::proof', 'shakefix::unintended'] }],
      ['addIssueNote', 9, 'hi'],
      ['mergeMR', 12, { sha: 'abc', squash: true }],
      ['getMR', 12],
      ['mrClosesIssues', 12],
    ]);
    expect(out).toEqual(['shakefix,shakefix::ready', '9']);
    await expect(scmMain(['bogus'], {}, { scm })).rejects.toThrow(/unknown command/);
  });
});
