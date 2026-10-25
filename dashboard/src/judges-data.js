// Content of the "For judges" page. Every claim points at evidence a judge can open. Pure data.

export const REPO = 'https://gitlab.com/nxt-spacenos-global/shakefix';
export const VIDEO_URL = 'https://www.youtube.com/watch?v=SOZXeF82qZ0'; // demo video (2:52, live case #18)
const blob = (p) => `${REPO}/-/blob/main/${p}`;
const tree = (p) => `${REPO}/-/tree/main/${p}`;
const issue = (n) => `${REPO}/-/work_items/${n}`;
const mr = (n) => `${REPO}/-/merge_requests/${n}`;

export const STEPS = [
  { title: 'Break it yourself.', text: 'Pick a CareRx bug in a phone frame and press Shake. A real GitLab issue opens and the agents start.', href: './try.html', cta: 'Try page' },
  { title: 'Open issue #14.', text: 'Margaret was charged $24 for a $12 copay. The thread holds the whole case: her taps, the failing test, the fix, the deploy, her 👍.', href: issue(14), cta: 'Issue #14' },
  { title: 'Open MR !12.', text: 'A 3-line fix, the Second Opinion behaviour diff (screen, API, database) and Fix Confidence, then merge, deploy and smoke test.', href: mr(12), cta: 'MR !12' },
  { title: 'Check the referee.', text: 'Control MRs with answers committed before they ran: a planted bad fix must be blocked, a harmless change must pass.', href: mr(10), cta: 'Control !10' },
  { title: 'Check the signatures.', text: 'The certificates below are fetched from Cloud Run and verified as you read this.', href: '#proof', cta: 'Live proof' },
];

export const CRITERIA = [
  {
    name: 'Technological implementation',
    question: 'How thoroughly does it use GitLab to automate the post-code lifecycle?',
    claim: 'One GitLab Duo custom flow (Triage Nurse, Surgeon, Attending, Discharge) started by a trigger, plus a pipeline that runs tests, SAST, dependency and secret scans, a Cloud Run preview per MR, Second Opinion, the gate, auto-merge, deploy, smoke test, automatic rollback and a re-check of every past case on production.',
    evidence: [
      { href: blob('.gitlab/duo/flows/shakefix.yml'), label: 'Duo flow: shakefix.yml', note: '4 agents, sandbox with Chromium for Playwright' },
      { href: blob('.gitlab-ci.yml'), label: '.gitlab-ci.yml', note: 'every stage, one file' },
      { href: `${REPO}/-/pipelines`, label: 'Pipeline history', note: 'the automation running' },
      { href: blob('packages/proof/src/confidence.js'), label: 'Fix Confidence formula', note: 'deterministic, no model decides' },
      { href: `${REPO}/-/pipelines/2938196742`, label: 'Rollback drill', note: 'forced smoke failure, traffic back in 40 s' },
    ],
  },
  {
    name: 'Design',
    question: 'A complete, coherent end-to-end workflow, not a proof of concept?',
    claim: 'One thread from a shake to the reporter\'s 👍, with every unhappy path handled: no reproduction means no fix; a side effect sends the fix back to surgery; dosing code waits for a pharmacist; a failed smoke test rolls back; a bug that returns reopens itself.',
    evidence: [
      { href: issue(14), label: 'Happy path: #14', note: 'shake → live → 👍' },
      { href: mr(14), label: 'Blocked, re-operated: MR !14', note: 'Second Opinion caught the agents\' own bugs twice' },
      { href: issue(17), label: 'Held by policy: #17', note: 'dosing, HOLD 80/100, a person merged' },
      { href: issue(10), label: 'Refused: #10', note: 'a feature request, not a bug' },
      { href: blob('scripts/ci/recheck.sh'), label: 'Stay fixed: recheck.sh', note: 'reopens a case whose bug comes back' },
    ],
  },
  {
    name: 'Potential impact',
    question: 'A credible, specific case for a real problem and a real audience?',
    claim: 'The people who depend most on a pharmacy app are the least able to report what goes wrong in it. CareRx\'s four bugs are each modelled on a documented failure: a broken privacy promise, a double charge, a refill button a screen reader can\'t name, and a dose shown in mg instead of mcg.',
    evidence: [
      { href: blob('docs/STATS.md'), label: 'Every statistic, with its source', note: 'read on the source page' },
      { href: 'https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising', label: 'FTC v. GoodRx, $1.5M', note: 'the C2 privacy bug' },
      { href: 'https://online.ecri.org/hubfs/ISMP/Resources/ISMP_ErrorProneAbbreviation_List.pdf', label: 'ISMP: µg “mistaken as mg”', note: 'the C4 dosing bug' },
      { href: blob('apps/carerx/SEEDED_BUGS.md'), label: 'The four seeded bugs' },
    ],
  },
  {
    name: 'Innovation / idea',
    question: 'How creative and novel, compared to existing concepts?',
    claim: 'Every other loop starts from a developer, a scanner or a metric and ends at a green pipeline. ShakeFix starts from the person who hit the bug and ends with them: their shake is the report, their taps become the test, and their 👍 is what closes the case. Second Opinion checks the AI\'s fix by comparing behaviour, not by reading the diff.',
    evidence: [
      { href: tree('packages/sdk'), label: 'Shake SDK', note: 'taps, errors, network, redacted screenshot' },
      { href: tree('packages/replay'), label: 'Replay → failing Playwright test' },
      { href: tree('packages/proof'), label: 'Second Opinion', note: 'side-by-side behaviour diff' },
      { href: './certificate.html', label: 'Signed certificate page' },
    ],
  },
  {
    name: 'Presentation',
    question: 'Does it show the automation end to end, for whom, and why it matters?',
    claim: 'The video follows one patient from shake to 👍 on a real phone. This page, the README and Mission Control link every claim to an issue, MR, pipeline or signed certificate.',
    evidence: [
      { href: blob('README.md'), label: 'README' },
      { href: blob('JUDGES.md'), label: 'JUDGES.md' },
      { href: './index.html', label: 'Mission Control', note: 'live board, Numbers tab' },
    ],
  },
  {
    name: 'Google Cloud (+0.2)',
    question: 'Deployed on Google Cloud, with the code in the repository?',
    claim: 'CareRx, the intake and every MR preview run on Cloud Run. Images are built by Cloud Build into Artifact Registry; cases live in Firestore; keys in Secret Manager; CI signs in with Workload Identity Federation (no JSON keys). All of it is Terraform.',
    evidence: [
      { href: 'https://carerx-pzd4uebegq-uc.a.run.app', label: 'CareRx on Cloud Run', note: 'live' },
      { href: 'https://carerx-pzd4uebegq-uc.a.run.app/api/version', label: 'Which commit is live', note: '/api/version links the deployed commit' },
      { href: 'https://intake-pzd4uebegq-uc.a.run.app/v1/health', label: 'Intake on Cloud Run', note: 'live' },
      { href: tree('infra'), label: 'infra/ (Terraform)' },
    ],
  },
];

export const CASES = [
  { iid: 14, mr: 12, rid: 'r_20261012_3d080f', autonomy: 'hands-off', title: 'Charged twice for one copay', fallback: '24m 51s', touchNote: 'The 1 touch is our intake\'s own 👍 note (webhook race, fixed after). No person touched code, review or merge.' },
  { iid: 16, mr: 14, rid: 'r_20261012_c15719', autonomy: 'hands-off', title: 'Refill button a screen reader can\'t name', fallback: '26m 03s', touchNote: 'The 1 touch is the same race, on the verified label. "14 unintended" is the first fix, which Second Opinion blocked; the merged fix scored GO 100/100. The certificate kept the old count, a recording bug fixed after this case.' },
  { iid: 15, mr: 13, rid: 'r_20261012_37cfbf', autonomy: 'supervised', title: 'Privacy opt-out ignored', fallback: '30m 35s', touchNote: 'The 1 touch is ours: we rebased the MR after breaking main ourselves.' },
  { iid: 17, mr: 15, rid: 'r_20261012_b0bac0', autonomy: 'supervised', title: 'Thyroid dose in mg, not mcg', fallback: '37m 55s', touchNote: 'Held by policy: dosing code always waits for a pharmacist. The 1 touch is that merge.' },
];

/** "24m 51s" / "1h 02m" from milliseconds (matches the certificate page). */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
