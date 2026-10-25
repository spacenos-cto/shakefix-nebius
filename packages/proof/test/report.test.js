import { describe, it, expect } from 'vitest';
import { renderReport, fmtValue, fmtWhere } from '../src/report.js';
import { applyRules, buildTouchContext } from '../src/label.js';
import { fx, b1Proof } from './helpers.js';

// The §11.5 example, as a labeled proof.json.
const specProof = {
  schema: 'shakefix.proof/v1', mr: 42, base: 'a1b2c3d', head: 'e4f5a6b',
  flows: [{
    flow: 'settle-3-way', changes: [
      { id: 'c1', channel: 'screen', where: '/bill/7 · settled-banner', before: '(hidden)', after: 'Settled ✓', label: 'intended', reason: 'the reported bug' },
      { id: 'c2', channel: 'api', where: 'POST /api/bills/:id/settle · $.ok', before: false, after: true, label: 'intended' },
      { id: 'c3', channel: 'screen', where: '/bill/9 · tip-total', before: '₹49.99', after: '₹50.00', label: 'unintended', reason: 'tip math changed on an unrelated bill' },
    ],
  }],
  summary: { changes: 3, intended: 2, unintended: 1 },
};

describe('renderReport (§11.5)', () => {
  it('renders the spec example card exactly', () => {
    expect(renderReport(specProof)).toBe([
      '### 🩺 Second Opinion — Behavior Diff (main ⟷ !42)',
      '| | Channel | Where | Before → After | Verdict |',
      '|---|---|---|---|---|',
      '| ✓ | SCREEN | /bill/7 · settled-banner | hidden → "Settled ✓" | intended — the reported bug |',
      '| ✓ | API | POST /bills/:id/settle · ok | false → true | intended |',
      '| ✗ | SCREEN | /bill/9 · tip-total | ₹49.99 → ₹50.00 | **unintended** — tip math changed on an unrelated bill |',
      '',
      '**3 changes · 2 intended · 1 unintended** → ⛔ blocked',
      'Artifacts: screenshots, proof.json',
      '',
      '_— Second Opinion, ShakeFix ER_',
      '',
    ].join('\n'));
  });

  it('links artifacts and uses the target branch name when given', () => {
    const md = renderReport(specProof, { baseRef: 'develop', artifacts: { screenshots: 'https://x/raw', proof: 'https://x/proof.json' } });
    expect(md).toContain('(develop ⟷ !42)');
    expect(md).toContain('Artifacts: [screenshots](https://x/raw), [proof.json](https://x/proof.json)');
  });

  it('B1 rules-labeled proof shows the trap row and blocks', () => {
    const proof = b1Proof();
    const ruled = applyRules(proof, buildTouchContext({ proof, replays: [fx('b1/replay.json')] }));
    const md = renderReport(ruled);
    expect(md).toContain('| ✗ | SCREEN | /bill/9 · tip-total | ₹49.99 → ₹50.00 | **unintended** — rule: bill 9 is not touched by the replay |');
    expect(md).toContain('| ✓ | DB | update bills | none → {"settled":true} |');
    expect(md).toContain('**10 changes · 9 intended · 1 unintended** → ⛔ blocked');
  });

  it('reports ready when there are no changes', () => {
    const md = renderReport({ ...specProof, flows: [{ flow: 'x', changes: [] }] });
    expect(md).toContain('_No behavior changes between base and head._');
    expect(md).toContain('**0 changes · 0 intended · 0 unintended** → ✅ ready');
  });

  it('escapes pipes and formats values', () => {
    expect(fmtValue('a|b')).toBe('a|b');
    expect(fmtValue('')).toBe('""');
    expect(fmtValue(333.34)).toBe('333.34');
    expect(fmtWhere({ channel: 'api', where: 'GET /api/bills/:id · $.shares[0].amount' })).toBe('GET /bills/:id · shares[0].amount');
    const md = renderReport({ ...specProof, flows: [{ flow: 'x', changes: [{ id: 'c1', channel: 'screen', where: '/ · a', before: 'x|y', after: 'z', label: 'intended' }] }] });
    expect(md).toContain('x\\|y → z');
  });
});
