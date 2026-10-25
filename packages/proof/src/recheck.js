// Re-check (done stays done): after every production deploy, every past case's regression spec runs
// against production. A spec that fails again means that patient's bug is back. Pure.

const SPEC_RE = /(?:^|[\\/])issue-(\d+)(?:-r\d+)?\.spec\.ts$/;

/** Issue iid from a regression spec path, or null. */
export function issueOfSpec(file) {
  const m = SPEC_RE.exec(String(file ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * From a Playwright JSON report, the regression specs that ran and the issues whose spec failed.
 * A spec counts as failed when any of its tests ended "failed" or "timedOut" (flaky = passed on retry).
 * @returns {{checked: number[], failed: number[]}} sorted, de-duplicated issue iids
 */
export function recheckResults(report) {
  const checked = new Set();
  const failed = new Set();
  const visit = (suite, file) => {
    const f = suite.file ?? file;
    const iid = issueOfSpec(f);
    for (const spec of suite.specs ?? []) {
      const sIid = issueOfSpec(spec.file ?? f) ?? iid;
      if (sIid == null) continue;
      checked.add(sIid);
      const statuses = (spec.tests ?? []).flatMap((t) => (t.results ?? []).map((r) => r.status));
      const final = (spec.tests ?? []).map((t) => t.status);
      if (final.includes('unexpected') || (!final.length && statuses.some((s) => s === 'failed' || s === 'timedOut'))) failed.add(sIid);
    }
    for (const child of suite.suites ?? []) visit(child, f);
  };
  for (const s of report?.suites ?? []) visit(s, s.file);
  const sort = (set) => [...set].sort((a, b) => a - b);
  return { checked: sort(checked), failed: sort(failed) };
}
