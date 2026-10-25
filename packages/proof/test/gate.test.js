import { describe, it, expect } from 'vitest';
import { evaluateGate, parseYaml, parseDiffFiles, policyHits, limitViolations, EXIT } from '../src/gate.js';
import { applyRules, buildTouchContext } from '../src/label.js';
import { fx, fxText, b1Proof } from './helpers.js';

const policy = parseYaml(fxText('policy.yml'));

function labeled(proof) {
  return applyRules(proof, buildTouchContext({ proof, replays: [fx('b1/replay.json')] }));
}
const blocked = labeled(b1Proof()); // 1 unintended
const clean = (() => {
  const p = structuredClone(blocked);
  p.flows = p.flows.filter((f) => f.flow !== 'change-tip');
  return p;
})();
const files = parseDiffFiles('3\t1\tapps/splitpal/src/lib/split.ts\n12\t0\ttests/regressions/b1.spec.ts\n');

describe('parseYaml (policy subset)', () => {
  it('parses .shakefix/policy.yml', () => {
    expect(policy).toEqual({
      version: 1,
      autonomy_default: 'hands-off',
      rules: [
        { match: 'apps/splitpal/src/auth/**', autonomy: 'supervised', reason: 'Authentication changes always need a human.' },
        { match: 'infra/**', autonomy: 'assisted' },
        { match: '**/*.sql', autonomy: 'supervised' },
      ],
      limits: { max_files_changed: 5, max_lines_changed: 60, forbid_new_dependencies: true },
      proof: { block_on_unintended: true, max_reoperations: 1 },
    });
  });
});

describe('parseDiffFiles', () => {
  it('reads numstat, plain paths, binaries and renames', () => {
    expect(parseDiffFiles('1\t2\ta.js\n-\t-\timg.png\nb.js\n0\t0\tsrc/{old => new}/c.js\n')).toEqual([
      { path: 'a.js', added: 1, deleted: 2 },
      { path: 'img.png', added: 0, deleted: 0 },
      { path: 'b.js', added: null, deleted: null },
      { path: 'src/new/c.js', added: 0, deleted: 0 },
    ]);
  });
});

describe('evaluateGate (§11.7, §15)', () => {
  it('0 unintended → ready (exit 0)', () => {
    const r = evaluateGate({ proof: clean, policy, files });
    expect(r.code).toBe(EXIT.READY);
    expect(r.status).toBe('ready');
  });

  it('B1 naive fix, first time → unintended (exit 10) with exactly 1 unintended', () => {
    const r = evaluateGate({ proof: blocked, policy, files, labels: ['shakefix', 'shakefix::proof'] });
    expect(r.code).toBe(10);
    expect(r.counts.unintended).toBe(1);
    expect(r.reason).toBe('1 unintended change(s) (re-operation 1 of 1)');
  });

  it('second time (label shakefix::unintended present) → needs-human (exit 11)', () => {
    const r = evaluateGate({ proof: blocked, policy, files, labels: ['shakefix::unintended'] });
    expect(r.code).toBe(11);
    expect(r.status).toBe('needs-human');
  });

  it('second time via PROOF_ATTEMPT=2 → exit 11', () => {
    expect(evaluateGate({ proof: blocked, policy, files, attempt: 2 }).code).toBe(11);
  });

  it('unintended by the rules but disputed by the model → needs-human (exit 11), no re-operation', () => {
    const p = structuredClone(blocked);
    for (const f of p.flows) for (const c of f.changes) if (c.label === 'unintended') c.disputed = true;
    const r = evaluateGate({ proof: p, policy, files });
    expect(r.code).toBe(EXIT.NEEDS_HUMAN);
    expect(r.reason).toMatch(/a human decides/);
  });

  it('second iteration with 0 unintended passes even with shakefix::unintended label', () => {
    expect(evaluateGate({ proof: clean, policy, files, labels: ['shakefix::unintended'] }).code).toBe(0);
  });

  it('policy hit (auth/**) → exit 11 even when Second Opinion is clean (B4)', () => {
    const f = parseDiffFiles('1\t1\tapps/splitpal/src/auth/session.ts\n');
    const r = evaluateGate({ proof: clean, policy, files: f });
    expect(r.code).toBe(11);
    expect(r.reason).toBe('policy: apps/splitpal/src/auth/session.ts matches "apps/splitpal/src/auth/**" (supervised) — Authentication changes always need a human.');
    expect(policyHits(policy, parseDiffFiles('db/migrate/001.sql')).length).toBe(1);
  });

  it('limits: files, lines, lockfile → exit 11', () => {
    const many = parseDiffFiles(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `1\t0\t${x}.js`).join('\n'));
    expect(evaluateGate({ proof: clean, policy, files: many }).reason).toMatch(/files changed 6 > max_files_changed 5/);
    const big = parseDiffFiles('50\t11\tsrc/a.js');
    expect(evaluateGate({ proof: clean, policy, files: big }).reason).toMatch(/lines changed 61 > max_lines_changed 60/);
    const lock = parseDiffFiles('1\t0\tpnpm-lock.yaml');
    expect(evaluateGate({ proof: clean, policy, files: lock }).reason).toMatch(/lockfile changed/);
  });

  it('needs-human label already present → exit 11', () => {
    expect(evaluateGate({ proof: clean, policy, files, labels: ['needs-human'] }).code).toBe(11);
  });

  it('block_on_unintended: false lets unintended through', () => {
    const p = { ...policy, proof: { block_on_unintended: false } };
    expect(evaluateGate({ proof: blocked, policy: p, files }).code).toBe(0);
  });

  it('unlabeled changes count as unintended (conservative)', () => {
    expect(evaluateGate({ proof: b1Proof(), policy, files }).counts.unintended).toBe(10);
  });

  it('rejects a non-proof document', () => {
    expect(() => evaluateGate({ proof: { schema: 'x' }, policy })).toThrow(/shakefix.proof\/v1/);
  });
});

describe('limits: Medical Record bookkeeping (docs/MEMORY.md)', () => {
  it('.shakefix/memory/** never counts toward max files / lines', () => {
    const policy = { limits: { max_files_changed: 1, max_lines_changed: 10 } };
    const files = [
      { path: 'apps/splitpal/src/lib/split.js', added: 4, deleted: 2 },
      { path: '.shakefix/memory/cases/12.json', added: 60, deleted: 0 },
    ];
    expect(limitViolations(policy, files)).toEqual([]);
    expect(limitViolations(policy, [...files, { path: 'apps/x.js', added: 1, deleted: 0 }])).toHaveLength(1);
  });
});
