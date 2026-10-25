import { describe, it, expect } from 'vitest';
import { issueOfSpec, recheckResults } from '../src/recheck.js';

const spec = (file, status) => ({ title: file, file, tests: [{ status, results: [{ status: status === 'unexpected' ? 'failed' : 'passed' }] }] });

describe('recheck', () => {
  it('reads the issue from a regression spec path', () => {
    expect(issueOfSpec('tests/regressions/issue-14.spec.ts')).toBe(14);
    expect(issueOfSpec('regressions\\issue-16-r2.spec.ts')).toBe(16);
    expect(issueOfSpec('tests/e2e/pay.spec.ts')).toBe(null);
  });

  it('lists every checked case and only the ones that fail again', () => {
    const report = {
      suites: [
        { file: 'regressions/issue-14.spec.ts', specs: [spec('regressions/issue-14.spec.ts', 'expected')] },
        { file: 'regressions/issue-16.spec.ts', specs: [spec('regressions/issue-16.spec.ts', 'unexpected')] },
        { file: 'regressions/issue-17.spec.ts', specs: [spec('regressions/issue-17.spec.ts', 'flaky')] },
        { file: 'e2e/smoke.spec.ts', specs: [spec('e2e/smoke.spec.ts', 'unexpected')] },
      ],
    };
    expect(recheckResults(report)).toEqual({ checked: [14, 16, 17], failed: [16] });
  });

  it('handles nested describe suites and an empty report', () => {
    const report = { suites: [{ file: 'regressions/issue-15.spec.ts', suites: [{ specs: [spec(undefined, 'unexpected')] }] }] };
    expect(recheckResults(report)).toEqual({ checked: [15], failed: [15] });
    expect(recheckResults({})).toEqual({ checked: [], failed: [] });
  });
});
