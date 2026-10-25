// Discharge Certificate page: certificate.html?rid=<rid>&intake=<intake url>
// Reads GET /v1/reports/:rid/certificate and checks it with GET /v1/certificates/verify.
// Without an intake it shows a SAMPLE built from the recorded hero run (unsigned).
import './style.css';
import './certificate.css';
import heroRun from '../../services/intake/src/demo/hero-run.json';

const params = new URLSearchParams(location.search);
const INTAKE_URL = (params.get('intake') || import.meta.env.VITE_INTAKE_URL || '').replace(/\/+$/, '');
const RID = params.get('rid') || '';
const RID_RE = /^r_\d{8}_[0-9a-f]{6}$/;

const $ = (id) => document.getElementById(id);

const STAGE_LABELS = {
  shaken: 'Shaken: the reporter shook the phone',
  issue_created: 'Admitted: GitLab issue created',
  mr_opened: 'Operated: merge request opened',
  second_opinion: 'Second Opinion: behavior diff checked',
  merged: 'Merged',
  deployed: 'Discharged: live in production',
  verified: '👍 Reporter confirmed the fix',
};
const STAGE_KEYS = Object.keys(STAGE_LABELS);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c))); // text only: titles come from users
  }
  return node;
}

function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** "11m 42s" (same format as the intake's stopwatch). */
export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Issue titles look like "🩺 [shake] settle button does nothing (/bill/7)"; the patient line drops the tag. */
export const patientName = (title) => String(title || 'Unnamed patient').replace(/^\s*🩺\s*/u, '').replace(/^\[[\w-]+\]\s*/, '');

const fmtTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
};

function boardHref(rid) {
  const q = new URLSearchParams();
  if (INTAKE_URL) q.set('intake', INTAKE_URL);
  if (rid) q.set('rid', rid);
  const s = q.toString();
  return `./index.html${s ? `?${s}` : ''}`;
}

function showMessage(title, text, { link = true, rid = RID } = {}) {
  $('cert').hidden = true;
  $('message').hidden = false;
  $('print').hidden = true;
  $('message-title').textContent = title;
  $('message-text').textContent = text;
  $('message-link').hidden = !link;
  $('message-link').href = boardHref(rid);
  document.title = `${title} · ShakeFix`;
}

/** Certificate-shaped SAMPLE from the recorded hero run (DEMO mode, no intake). */
function sampleCertificate() {
  const t0 = Date.parse(heroRun.recordedAt);
  const stages = Object.fromEntries(STAGE_KEYS.map((k) => {
    const s = heroRun.stages.find((x) => x.key === k);
    return [k, s ? new Date(t0 + s.offsetS * 1000).toISOString() : null];
  }));
  const ms = (a, b) => (a && b ? Date.parse(b) - Date.parse(a) : null);
  return {
    sample: true,
    schema: 'shakefix.certificate/v1',
    rid: heroRun.rid,
    title: heroRun.title,
    state: stages.verified ? 'verified' : 'deployed',
    issue: { iid: heroRun.issueIid, url: heroRun.issueUrl },
    mr: { iid: heroRun.mrIid, url: heroRun.mrUrl },
    stages,
    durations: { shakeToDeployedMs: ms(stages.shaken, stages.deployed), shakeToVerifiedMs: ms(stages.shaken, stages.verified) },
    humanTouches: heroRun.humanTouches ?? 0,
    proof: { intended: heroRun.proof?.intended ?? null, unintended: heroRun.proof?.unintended ?? null },
    verdict: stages.verified ? 'confirmed' : 'awaiting',
    issuedAt: new Date().toISOString(),
    digest: null,
    signature: null,
    signed: false,
  };
}

function render(c) {
  $('message').hidden = true;
  $('cert').hidden = false;
  $('print').hidden = false;
  $('sample').hidden = !c.sample;
  const name = patientName(c.title);
  document.title = `Discharge Certificate · ${name}`;
  $('patient').textContent = name;
  $('ids').textContent = [c.issue?.iid != null ? `issue #${c.issue.iid}` : null, c.mr?.iid != null ? `MR !${c.mr.iid}` : null, `rid ${c.rid}`].filter(Boolean).join(' · ');
  $('board-link').href = boardHref(c.sample ? null : c.rid);

  // Big numbers
  const live = c.durations?.shakeToDeployedMs;
  $('n-live').textContent = formatDuration(live);
  $('n-live-sub').textContent = c.durations?.shakeToVerifiedMs != null ? `shake → 👍 ${formatDuration(c.durations.shakeToVerifiedMs)}` : 'from the shake to production';
  $('n-touches').textContent = c.humanTouches ?? '—';
  $('n-touches-sub').textContent = c.humanTouches === 0 ? 'no person touched the fix' : 'approvals, merges, notes, pushes, edits';
  const { intended, unintended } = c.proof ?? {};
  const proof = $('n-proof');
  if (unintended == null) {
    proof.textContent = 'n/a';
    proof.className = '';
    $('n-proof-sub').textContent = 'no behavior diff recorded';
  } else {
    proof.textContent = unintended === 0 ? 'Clean' : `${unintended} unintended`;
    proof.className = unintended === 0 ? 'good' : 'bad';
    $('n-proof-sub').textContent = `${intended ?? 0} intended · ${unintended} unintended change${unintended === 1 ? '' : 's'}`;
  }

  // Timeline
  const t0 = Date.parse(c.stages?.shaken ?? '');
  const reached = STAGE_KEYS.filter((k) => c.stages?.[k]);
  const last = reached[reached.length - 1];
  $('timeline').replaceChildren(...STAGE_KEYS.map((k) => {
    const at = c.stages?.[k];
    const since = at && Number.isFinite(t0) ? Date.parse(at) - t0 : null;
    return el('li', { class: [at ? 'reached' : '', k === last ? 'final' : ''].filter(Boolean).join(' ') || null },
      el('strong', {}, STAGE_LABELS[k]),
      el('span', { class: 't' },
        at ? [k !== 'shaken' && since != null ? el('span', { class: 'plus' }, `+${formatDuration(since)}`) : null, el('time', { datetime: at }, fmtTime(at))] : 'not recorded'));
  }));

  // Verdict + links
  const verdictText = { confirmed: '👍 Confirmed by the reporter', rejected: '👎 Rejected by the reporter', awaiting: 'Awaiting the reporter' };
  $('verdict').textContent = verdictText[c.verdict] ?? verdictText.awaiting;
  $('verdict').className = `cert-verdict ${c.verdict ?? 'awaiting'}`;
  const link = (label, url) => {
    const href = safeHref(url);
    return el('li', {}, href ? el('a', { href, target: '_blank', rel: 'noopener' }, `${label} ↗`) : el('span', { class: 'dim' }, label));
  };
  $('links').replaceChildren(
    c.issue?.iid != null ? link(`Issue #${c.issue.iid}`, c.issue.url) : null,
    c.mr?.iid != null ? link(`Merge request !${c.mr.iid}`, c.mr.url) : null,
    el('li', {}, el('a', { href: boardHref(c.sample ? null : c.rid) }, 'Case on the ER Board')),
  );

  // Seal
  const verify = $('verify');
  if (c.sample) {
    $('digest').textContent = 'sample — no digest';
    $('sig-line').textContent = 'Connect an intake (?intake=…&rid=…) to see a real, signed certificate.';
    verify.disabled = true;
  } else {
    $('digest').textContent = c.digest;
    $('sig-line').textContent = c.signed
      ? `HMAC-SHA256 signature ${c.signature.slice(0, 16)}… over the digest of: ${(c.evidenceFields ?? []).join(', ')}.`
      : 'Unsigned: this intake has no CERT_SIGNING_KEY, so the digest cannot be verified.';
    verify.disabled = !c.signed;
    verify.onclick = () => verifyCert(c);
  }
  $('issued').textContent = `Issued ${fmtTime(c.issuedAt)}`;
  $('schema').textContent = c.schema;
}

async function verifyCert(c) {
  const out = $('verify-result');
  out.className = 'verify-result';
  out.textContent = 'Checking…';
  try {
    const q = new URLSearchParams({ rid: c.rid, digest: c.digest, signature: c.signature });
    const res = await fetch(`${INTAKE_URL}/v1/certificates/verify?${q}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status}`);
    const v = await res.json();
    if (v.valid && v.current !== false) {
      out.className = 'verify-result ok';
      out.textContent = '✓ Signature valid';
    } else if (v.valid) {
      out.className = 'verify-result warn';
      out.textContent = '✓ Signature valid · the case has changed since this was issued';
    } else {
      out.className = 'verify-result bad';
      out.textContent = '✗ Signature not valid';
    }
  } catch (err) {
    out.className = 'verify-result bad';
    out.textContent = `Could not verify (${err.message})`;
  }
}

async function load() {
  if (!INTAKE_URL) {
    render(sampleCertificate());
    return;
  }
  if (!RID_RE.test(RID)) {
    showMessage('Which patient?', 'This link has no valid case id. Open a discharged case on the ER Board and follow its "Certificate →" link.', { rid: null });
    return;
  }
  showMessage('Loading certificate…', '', { link: false });
  let res;
  try {
    res = await fetch(`${INTAKE_URL}/v1/reports/${encodeURIComponent(RID)}/certificate`, { headers: { accept: 'application/json' }, cache: 'no-store' });
  } catch (err) {
    showMessage('The ER is unreachable', `Could not reach the intake (${err.message}). Try again in a moment.`);
    return;
  }
  if (res.status === 404) {
    showMessage('No such patient', `There is no case ${RID} on file. The link may be mistyped, or the intake was restarted.`, { rid: null });
    return;
  }
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    const state = body.state ? ` (current state: ${body.state})` : '';
    showMessage('Not discharged yet', `This case is still in the ER${state}. The certificate is issued once the fix is live in production.`);
    return;
  }
  if (!res.ok) {
    showMessage('Certificate unavailable', `The intake answered ${res.status}. Try again in a moment.`);
    return;
  }
  render(await res.json());
}

$('print').addEventListener('click', () => window.print());
$('copy-link').addEventListener('click', async (e) => {
  try {
    await navigator.clipboard.writeText(location.href);
    e.target.textContent = 'Link copied';
  } catch {
    e.target.textContent = 'Copy failed';
  }
  setTimeout(() => { e.target.textContent = 'Copy link'; }, 1600);
});
load();
