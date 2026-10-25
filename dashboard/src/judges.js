// "For judges" page: the problem, the 3-minute path, criteria → claim → evidence, and the signed
// certificates fetched and verified live from the intake. judges.html?intake=<intake url>
import './style.css';
import './judges.css';
import { REPO, VIDEO_URL, STEPS, CRITERIA, CASES, formatDuration } from './judges-data.js';

const params = new URLSearchParams(location.search);
const INTAKE_URL = (params.get('intake') || import.meta.env.VITE_INTAKE_URL || '').replace(/\/+$/, '');
const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
}
const link = (href, text) => el('a', { href, text, target: '_blank', rel: 'noopener' });

function renderStatic() {
  $('repo-link').href = REPO;
  if (VIDEO_URL) { $('video-link').href = VIDEO_URL; $('video-link').hidden = false; }
  $('steps').replaceChildren(...STEPS.map((s) => el('li', {}, el('strong', { text: s.title }), ' ', s.text, ' ', link(s.href, s.cta + ' →'))));
  $('criteria-list').replaceChildren(...CRITERIA.map((c) => el('article', { class: 'jd-crit' },
    el('header', {}, el('h3', { text: c.name }), el('p', { class: 'dim small', text: c.question })),
    el('p', { class: 'jd-claim', text: c.claim }),
    el('ul', { class: 'jd-evidence' }, c.evidence.map((e) => el('li', {}, link(e.href, e.label), e.note ? el('span', { class: 'dim', text: ` · ${e.note}` }) : null))),
  )));
}

function certCard(c, cert, verified) {
  const live = cert?.durations?.shakeToDeployedMs;
  const signedText = verified === true ? '✓ signature verified now' : verified === false ? '✗ signature did not verify' : cert?.signed ? 'signed (not verified yet)' : 'unsigned';
  const signedClass = verified === true ? 'ok' : verified === false ? 'bad' : 'dim';
  const certPage = `./certificate.html?rid=${encodeURIComponent(c.rid)}${INTAKE_URL ? `&intake=${encodeURIComponent(INTAKE_URL)}` : ''}`;
  return el('article', { class: `jd-cert ${c.autonomy}` },
    el('p', { class: 'jd-cert-case mono', text: `#${c.iid} · ${c.autonomy}` }),
    el('h3', { text: c.title }),
    el('div', { class: 'jd-cert-nums' },
      el('div', {}, el('span', { class: 'dim small', text: 'Shake → live' }), el('strong', { class: 'mono', text: live != null ? formatDuration(live) : c.fallback })),
      el('div', {}, el('span', { class: 'dim small', text: 'Touches' }), el('strong', { class: 'mono', text: cert ? String(cert.humanTouches) : '—' })),
      el('div', {}, el('span', { class: 'dim small', text: 'Second Opinion' }), el('strong', { class: 'mono', text: cert?.proof ? `${cert.proof.unintended} unintended` : '—' })),
    ),
    el('p', { class: 'small dim', text: c.touchNote }),
    el('p', { class: `small mono ${signedClass}`, text: signedText }),
    el('p', { class: 'small' }, link(certPage, 'Open certificate'), ' · ', link(`${REPO}/-/work_items/${c.iid}`, `issue #${c.iid}`), ' · ', link(`${REPO}/-/merge_requests/${c.mr}`, `MR !${c.mr}`)),
  );
}

async function renderCerts() {
  $('intake-line').textContent = INTAKE_URL ? `intake: ${INTAKE_URL}` : '';
  $('certs').replaceChildren(...CASES.map((c) => certCard(c, null, null)));
  if (!INTAKE_URL) { $('certs-note').textContent = 'No intake configured: showing recorded values. Add ?intake=<url> to fetch and verify live.'; return; }
  let ok = 0;
  let busy = 0;
  const cards = await Promise.all(CASES.map(async (c) => {
    try {
      const res = await fetch(`${INTAKE_URL}/v1/reports/${encodeURIComponent(c.rid)}/certificate`);
      if (res.status === 429) busy++;
      if (!res.ok) throw new Error(String(res.status));
      const cert = await res.json();
      let verified = null;
      if (cert.signed && cert.digest && cert.signature) {
        const q = new URLSearchParams({ rid: c.rid, digest: cert.digest, signature: cert.signature });
        const v = await fetch(`${INTAKE_URL}/v1/certificates/verify?${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        verified = v ? v.valid === true : null;
      }
      if (verified) ok++;
      if (c.iid === 14 && cert.durations?.shakeToDeployedMs != null) $('hero-time').textContent = formatDuration(cert.durations.shakeToDeployedMs);
      return certCard(c, cert, verified);
    } catch {
      return certCard(c, null, null);
    }
  }));
  $('certs').replaceChildren(...cards);
  $('certs-note').textContent = `${ok} of ${CASES.length} certificates fetched and verified just now from ${INTAKE_URL}.`
    + (busy ? ' The intake is rate-limiting this browser: reload in a minute to verify the rest.' : '');
}

renderStatic();
renderCerts();
