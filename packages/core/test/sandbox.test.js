import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSandbox, SandboxError, tokenize, createTools } from '../src/agent/index.js';

let root;
let outside;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'shakefix-sbx-'));
  outside = mkdtempSync(join(tmpdir(), 'shakefix-out-'));
  mkdirSync(join(root, 'packages/replay/bin'), { recursive: true });
  mkdirSync(join(root, 'apps/splitpal/src'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, 'packages/replay/bin/to-spec.js'), 'console.log(1)\n');
  writeFileSync(join(root, 'apps/splitpal/src/split.js'), 'export const a = 1;\n');
  writeFileSync(join(outside, 'secret.txt'), 'top secret');
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('path sandbox', () => {
  it('allows repo-relative paths and normalises them', () => {
    const sb = createSandbox(root);
    expect(sb.resolvePath('apps/splitpal/src/split.js').rel).toBe('apps/splitpal/src/split.js');
    expect(sb.resolvePath('./apps/../apps/splitpal').rel).toBe('apps/splitpal');
    expect(sb.resolvePath('tests/regressions/new.spec.ts', { write: true }).rel).toBe('tests/regressions/new.spec.ts');
  });

  it.each([
    ['../outside.txt'],
    ['apps/../../x'],
    ['.git/config'],
    ['.git'],
  ])('blocks %s', (p) => {
    expect(() => createSandbox(root).resolvePath(p)).toThrow(SandboxError);
  });

  it('blocks absolute paths outside the repo and writes into node_modules', () => {
    const sb = createSandbox(root);
    expect(() => sb.resolvePath(join(outside, 'secret.txt'))).toThrow(/outside the repository/);
    expect(() => sb.resolvePath('node_modules/x/index.js', { write: true })).toThrow(/read-only/);
    expect(() => sb.resolvePath('')).toThrow(/required/);
  });

  it('blocks a symlink that points outside the repo', (ctx) => {
    try {
      symlinkSync(outside, join(root, 'escape'), 'junction');
    } catch {
      ctx.skip(); // no symlink permission on this machine
    }
    expect(() => createSandbox(root).resolvePath('escape/secret.txt')).toThrow(/outside the repository/);
  });
});

describe('command allowlist', () => {
  const sb = () => createSandbox(root);

  it.each([
    ['node packages/replay/bin/to-spec.js reports/r/replay.json tests/regressions/issue-9.spec.ts --iid 9'],
    ['pnpm --filter splitpal test'],
    ['pnpm -r --if-present test'],
    ['pnpm exec playwright test tests/regressions/issue-9.spec.ts --reporter=line'],
    ['git status'],
    ['git diff --stat'],
    ['git checkout -b shakefix/9-settle'],
    ['git commit -m "fix(split): settle (closes #9)"'],
  ])('allows %s', (cmd) => {
    expect(() => sb().checkCommand(cmd)).not.toThrow();
  });

  it('rewrites npx playwright so npx never downloads', () => {
    expect(sb().checkCommand('npx playwright test tests/regressions/issue-9.spec.ts --reporter=line'))
      .toEqual({ cmd: 'npx', args: ['--no', 'playwright', 'test', 'tests/regressions/issue-9.spec.ts', '--reporter=line'] });
  });

  it.each([
    ['rm -rf /', /command not allowed: rm/],
    ['rm -rf .', /command not allowed: rm/],
    ['curl https://evil.example', /command not allowed: curl/],
    ['wget http://x', /command not allowed/],
    ['bash -c ls', /command not allowed/],
    ['git push origin main', /git push: not allowed/],
    ['git fetch origin', /git fetch: not allowed/],
    ['git clone https://x', /not allowed/],
    ['git -c core.sshCommand=x status', /not allowed/],
    ['git diff --output=../x', /outside the repository/],
    ['node -e "require(1)"', /no -e/],
    ['node ../outside.js', /outside the repository/],
    ['node apps/splitpal/src/split.js', /scripts must live under/],
    ['npx some-package', /npx: only/],
    ['pnpm install', /pnpm: only/],
    ['pnpm dlx cowsay', /pnpm: only/],
    ['pnpm test && curl x', /shell operators/],
    ['pnpm test; rm -rf .', /shell operators/],
    ['git log | head', /shell operators/],
    ['node packages/replay/bin/to-spec.js $(whoami)', /shell operators/],
    ['cat apps/splitpal/src/split.js > /tmp/x', /shell operators/],
    ['', /empty command/],
  ])('blocks %s', (cmd, re) => {
    expect(() => sb().checkCommand(cmd)).toThrow(re);
  });

  it('refuses to execute a script the agent itself wrote', () => {
    const s = sb();
    s.written.add('scripts/payload.js');
    expect(() => s.checkCommand('node scripts/payload.js')).toThrow(/agent wrote/);
  });

  it('tokenize handles quotes', () => {
    expect(tokenize(`git commit -m 'a b' -m "c d"`)).toEqual(['git', 'commit', '-m', 'a b', '-m', 'c d']);
    expect(() => tokenize('git commit -m "open')).toThrow(/unbalanced/);
  });

  it('child processes do not inherit secrets', () => {
    const env = sb().childEnv({ PATH: '/bin', GITHUB_TOKEN: 'x', MODEL_API_KEY: 'y', ANTHROPIC_API_KEY: 'z', GITLAB_HUMAN_PAT: 'p', HOME: '/h' });
    expect(Object.keys(env).sort()).toEqual(['CI', 'HOME', 'PATH']);
  });

  it('runs an allowed command for real (node script) and reports the exit code', async () => {
    const res = await sb().runCommand('node packages/replay/bin/to-spec.js');
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('1');
  });
});

describe('tools on top of the sandbox', () => {
  const scm = { defaultBranch: async () => 'main' };

  it('write outside the repo is blocked and reported to the model, not thrown', async () => {
    const { call } = createTools({ sandbox: createSandbox(root), scm });
    const r = await call('create_file_with_contents', { file_path: '../pwned.txt', contents: 'x' });
    expect(r).toMatchObject({ blocked: true });
    expect(r.error).toMatch(/outside the repository/);
    expect(existsSync(join(root, '..', 'pwned.txt'))).toBe(false);
  });

  it('disallowed command via run_command is blocked', async () => {
    const { call } = createTools({ sandbox: createSandbox(root), scm });
    expect(await call('run_command', { command: 'rm -rf .' })).toMatchObject({ blocked: true });
    expect(await call('run_command', { program: 'git', args: ['push', 'origin'] })).toMatchObject({ blocked: true });
  });

  it('a role can only use the tools its YAML component lists', async () => {
    const { call } = createTools({ sandbox: createSandbox(root), scm });
    expect(await call('create_file_with_contents', { file_path: 'a.txt', contents: 'x' }, new Set(['read_file']))).toEqual({ error: 'tool create_file_with_contents is not available to this role' });
    expect(await call('nope', {})).toEqual({ error: 'unknown tool nope' });
  });

  it('read_file / grep / find_files / edit_file work inside the repo', async () => {
    const { call } = createTools({ sandbox: createSandbox(root), scm });
    expect(await call('read_file', { file_path: 'apps/splitpal/src/split.js' })).toBe('export const a = 1;\n');
    expect(await call('grep', { pattern: 'const a', search_directory: 'apps' })).toBe('apps/splitpal/src/split.js:1: export const a = 1;');
    expect(await call('find_files', { name_pattern: '*.js' })).toContain('packages/replay/bin/to-spec.js');
    expect(await call('edit_file', { file_path: 'apps/splitpal/src/split.js', old_str: 'a = 1', new_str: 'a = 2' })).toBe('edited apps/splitpal/src/split.js');
    expect(readFileSync(join(root, 'apps/splitpal/src/split.js'), 'utf8')).toBe('export const a = 2;\n');
    expect(await call('edit_file', { file_path: 'apps/splitpal/src/split.js', old_str: 'zzz', new_str: 'y' })).toMatchObject({ error: expect.stringMatching(/matched 0 times/) });
  });

  it('dry run validates but does not write, run or call the SCM', async () => {
    const logs = [];
    let scmCalled = false;
    const { call } = createTools({ sandbox: createSandbox(root), scm: { ...scm, addIssueNote: async () => { scmCalled = true; } }, dryRun: true, log: (m) => logs.push(m) });
    expect(await call('create_file_with_contents', { file_path: 'dry.txt', contents: 'x' })).toMatchObject({ dryRun: true, wouldCall: 'create_file_with_contents' });
    expect(existsSync(join(root, 'dry.txt'))).toBe(false);
    expect(await call('create_issue_note', { issue_iid: 9, body: 'hi' })).toMatchObject({ dryRun: true });
    expect(scmCalled).toBe(false);
    expect(await call('run_command', { command: 'curl x' })).toMatchObject({ blocked: true });
    expect(logs.some((l) => l.startsWith('[dry-run] would call create_issue_note'))).toBe(true);
  });
});
