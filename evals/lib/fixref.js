// Grade a delivered fix: materialise it next to the repo, build SplitPal from it, run the scenario's
// regression spec against it and run the SplitPal unit tests. Works for:
//   - a git ref (an agent's fix branch, e.g. origin/shakefix/4-settle-split-cents = MR !1),
//   - a directory (the local agent runner's working copy).
// Nothing touches the repo's own working tree or index.
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { startSplitpal } from './splitpal.js';
import { runSpecs } from './reproduce.js';

/** Minimal ustar/pax reader for `git archive --format=tar` output. */
export function untar(buf, dest) {
  let off = 0;
  let longName = null;
  const written = [];
  const str = (b) => b.toString('utf8').replace(/\0.*$/s, '');
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const name = str(h.subarray(0, 100));
    const size = parseInt(str(h.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h.subarray(345, 500));
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const m = /\d+ path=([^\n]+)\n/.exec(body.toString('utf8'));
      longName = m ? m[1] : null;
      continue;
    }
    if (type === 'g') continue;
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    if (!path || path.includes('..')) continue;
    const target = join(dest, path);
    if (type === '5') mkdirSync(target, { recursive: true });
    else if (type === '0' || type === '\0') {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
      written.push(path);
    }
  }
  return written;
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: opts.encoding ?? 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: opts.timeout ?? 300_000, ...opts });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function link(target, path) {
  if (existsSync(path) || !existsSync(target)) return;
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'junction');
}

/** git archive <ref> apps/splitpal tests → dest; returns the files the ref changed vs `base`. */
export function materializeRef({ repoRoot, ref, dest, base = 'main' }) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const ar = sh('git', ['archive', '--format=tar', ref, '--', 'apps/splitpal', 'tests'], { cwd: repoRoot, encoding: 'buffer' });
  if (!ar.ok) throw new Error(`git archive ${ref} failed: ${String(ar.stderr)}`);
  untar(ar.stdout, dest);
  const diff = sh('git', ['diff', '--name-only', `${base}...${ref}`], { cwd: repoRoot });
  return diff.ok ? diff.stdout.split('\n').filter(Boolean) : [];
}

/** Make a materialised tree buildable: node_modules junctions + the SDK bundle (dist/ is not in git). */
export function prepareTree({ repoRoot, dir }) {
  link(join(repoRoot, 'node_modules'), join(dir, 'node_modules'));
  link(join(repoRoot, 'apps', 'splitpal', 'node_modules'), join(dir, 'apps', 'splitpal', 'node_modules'));
  const sdk = join(repoRoot, 'packages', 'sdk', 'dist', 'shakefix-sdk.js');
  if (existsSync(sdk)) {
    mkdirSync(join(dir, 'packages', 'sdk', 'dist'), { recursive: true });
    copyFileSync(sdk, join(dir, 'packages', 'sdk', 'dist', 'shakefix-sdk.js'));
  }
}

/**
 * Build + spec + unit for a prepared tree.
 * @returns {Promise<{graded: true, specPasses: boolean, unitGreen: boolean, specError: string|null, unitSummary: string}>}
 */
export async function gradeTree({ repoRoot, dir, specPath, log = () => {} }) {
  const app = join(dir, 'apps', 'splitpal');
  const vite = join(repoRoot, 'apps', 'splitpal', 'node_modules', 'vite', 'bin', 'vite.js');
  const b = sh(process.execPath, [vite, 'build', '--logLevel', 'error'], { cwd: app });
  if (!b.ok) return { graded: true, specPasses: false, unitGreen: false, specError: `build failed: ${(b.stderr || b.stdout).slice(-300)}`, unitSummary: 'not run (build failed)' };

  const vitest = join(repoRoot, 'apps', 'splitpal', 'node_modules', 'vitest', 'vitest.mjs');
  const u = sh(process.execPath, [vitest, 'run', '--reporter=dot'], { cwd: app, env: { ...process.env, EVAL_BUG: '' } });
  const unitSummary = (/Tests\s+(.+)/.exec(String(u.stdout).replace(/\u001b\[[0-9;]*m/g, ''))?.[1] ?? `exit ${u.status}`).trim();

  const server = await startSplitpal({ appDir: app });
  let spec;
  try {
    const specDir = join(dir, '.eval-spec');
    mkdirSync(specDir, { recursive: true });
    const copy = join(specDir, 'repro.spec.ts');
    writeFileSync(copy, readFileSync(specPath));
    spec = runSpecs({ repoRoot, dir: specDir, baseUrl: server.url, files: [copy] })['repro.spec.ts'];
  } finally {
    await server.stop();
  }
  log(`  fix: spec ${spec?.status} · unit ${unitSummary}`);
  return { graded: true, specPasses: spec?.status === 'passed', unitGreen: u.ok, specError: spec?.error ?? null, unitSummary };
}
