import './style.css';
import { COLUMNS, columnFor, computeMetrics, formatDuration, ledgerPatterns, normalizeBoard } from './metrics.js';
import { demoBoard, demoLedger, tick } from './fixtures.js';
import { fixtureTimeline, stageRows, stopwatchLine } from './timeline.js';
import { ledgerEntriesFromMemory, medicalRecords } from './records.js';
import { COLUMN_EXPLAIN, METRIC_EXPLAIN, STAGE_EXPLAIN, caseStory, journey } from './explain.js';
import { initMissionControl, onBoard } from './mission.js';
// The recorded hero run (issue #4 → MR !1), shared with the intake's DEMO_MODE.
import heroRun from '../../services/intake/src/demo/hero-run.json';

const POLL_MS = 5000;
const params = new URLSearchParams(location.search);
const INTAKE_URL = (params.get('intake') || import.meta.env.VITE_INTAKE_URL || '').replace(/\/+$/, '');
const DEMO = params.has('demo') || !INTAKE_URL;
const GITLAB_PROJECT_URL = (import.meta.env.VITE_GITLAB_PROJECT_URL || '').replace(/\/+$/, '');

const $ = (id) => document.getElementById(id);
let demoState = DEMO ? demoBoard() : null;
let lastCards = [];
let lastOk = null;
const pageLoad = Date.now();
/** Open case: {rid, title, iid, mrIid, fixture?: true}; its timeline is refreshed with the board. */
let openCaseRef = null;
let caseTimeline = null;

// ---- view modes: Explain (plain English) and Visual (one patient journey) -----------------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};
const flag = (param, key) => (params.has(param) ? params.get(param) !== '0' : store.get(key) === '1');
const view = { explain: flag('explain', 'sf-explain'), visual: params.get('view') === 'visual' || (!params.has('view') && store.get('sf-visual') === '1') };
let selectedPhase = null;

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

function issueLink(card) {
  if (card.issueUrl) return card.issueUrl;
  if (GITLAB_PROJECT_URL && card.iid != null) return `${GITLAB_PROJECT_URL}/-/issues/${card.iid}`;
  return null;
}

function mrLink(card) {
  if (card.mrUrl) return card.mrUrl;
  if (GITLAB_PROJECT_URL && card.mrIid != null) return `${GITLAB_PROJECT_URL}/-/merge_requests/${card.mrIid}`;
  return null;
}

function safeHref(url) {
  try {
    const u = new URL(url, location.href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** 👍 / 👎 reporter verdict on the current fix ("the patient's verdict"). */
function verdictChip(card) {
  if (card.verdict === 'confirmed') {
    return el('span', { class: 'chip verdict-confirmed', title: 'Reporter confirmed the fix' }, '👍 verified');
  }
  if (card.verdict === 'rejected') {
    return el('span', { class: 'chip verdict-rejected', title: 'Reporter says it is still broken' }, '👎 still broken');
  }
  return null;
}

function renderCard(card, now) {
  const end = card.fixedAt ?? now;
  const elapsed = card.createdAt ? formatDuration(end - card.createdAt) : '—';
  const iHref = safeHref(issueLink(card));
  const mHref = safeHref(mrLink(card));
  const proof = card.proof.known
    ? el('span', { class: `proof ${card.proof.unintended ? 'bad' : 'good'}`, title: 'Second Opinion: intended / unintended' },
        `${card.proof.intended}✓ ${card.proof.unintended}✗`)
    : el('span', { class: 'proof dim' }, 'Second Opinion —');

  return el('article', { class: `card sev${card.sev} state-${card.state}`, 'data-rid': card.rid, tabindex: '0', role: 'button', 'aria-label': `Timeline for #${card.iid ?? '?'}: ${card.title}` },
    el('header', {},
      iHref ? el('a', { href: iHref, target: '_blank', rel: 'noopener' }, `#${card.iid ?? '?'}`) : el('span', {}, `#${card.iid ?? '?'}`),
      el('span', { class: `sev chip sev${card.sev}` }, `sev${card.sev}`),
      card.autonomy === 'supervised' ? el('span', { class: 'chip warn' }, 'supervised') : null,
      card.state === 'rolled-back' ? el('span', { class: 'chip bad' }, 'rolled back') : null,
      card.state === 'needs-info' ? el('span', { class: 'chip warn' }, 'needs info') : null,
      card.state === 'reopened' ? el('span', { class: 'chip bad' }, 'reopened') : null,
      verdictChip(card),
      card.humanTouches != null ? el('span', { class: 'chip', title: 'human actions on this case' }, `✋ ${card.humanTouches}`) : null,
    ),
    el('h3', {}, card.title),
    el('footer', { class: 'mono' },
      el('span', { title: card.fixedAt ? 'shake → fixed' : 'since shake' }, `⏱ ${elapsed}`),
      mHref ? el('a', { href: mHref, target: '_blank', rel: 'noopener' }, `!${card.mrIid}`) : card.mrIid != null ? el('span', {}, `!${card.mrIid}`) : null,
      proof,
      card.reoperations ? el('span', { class: 'chip', title: 'sent back to surgery by Second Opinion' }, `re-op ×${card.reoperations}`) : null,
    ),
  );
}

function renderBoard(cards) {
  const now = Date.now();
  const board = $('board');
  const cols = COLUMNS.map((col) => {
    const inCol = cards
      .filter((c) => columnFor(c) === col.id)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const ex = COLUMN_EXPLAIN[col.id];
    return el('section', { class: `col col-${col.id}`, 'aria-label': col.title },
      el('h2', {}, col.title, el('span', { class: 'count mono' }, String(inCol.length))),
      view.explain && ex ? el('div', { class: 'explain' }, el('p', {}, ex.plain), el('p', { class: 'prevents' }, 'Prevents: ', ex.prevents)) : null,
      inCol.length ? inCol.map((c) => renderCard(c, now)) : el('p', { class: 'empty dim' }, 'No patients'),
    );
  });
  board.replaceChildren(...cols);
  for (const node of board.querySelectorAll('.card')) {
    const card = cards.find((c) => c.rid === node.dataset.rid);
    const open = () => openCase(card);
    node.addEventListener('click', (e) => { if (!e.target.closest('a')) open(); });
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }
}

// ---- case timeline + live stopwatch ------------------------------------------------------
function openCase(card, { scroll = true } = {}) {
  if (!card) return;
  openCaseRef = { rid: card.rid, title: card.title, iid: card.iid, mrIid: card.mrIid, fixture: DEMO && card.rid === heroRun.rid };
  caseTimeline = null;
  try { history.replaceState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), rid: card.rid })}`); } catch { /* sandboxed */ }
  loadCase();
  if (scroll) $('case').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeCase() {
  openCaseRef = null;
  caseTimeline = null;
  $('case').hidden = true;
  const q = new URLSearchParams(location.search);
  q.delete('rid');
  try { history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname); } catch { /* sandboxed */ }
}

async function loadCase() {
  const c = openCaseRef;
  if (!c) return;
  if (c.fixture) {
    caseTimeline = fixtureTimeline(heroRun, pageLoad, Date.now());
  } else if (DEMO) {
    caseTimeline = { unavailable: 'This is fixture data. Connect an intake (?intake=…) to see a real case timeline.' };
  } else {
    try {
      caseTimeline = await fetchJson(`${INTAKE_URL}/v1/reports/${encodeURIComponent(c.rid)}/timeline`);
    } catch (err) {
      caseTimeline = { unavailable: `Timeline unavailable (${err.message}).` };
    }
  }
  renderCase();
}

function renderCase() {
  const c = openCaseRef;
  if (!c) return;
  const tl = caseTimeline;
  $('case').hidden = false;
  $('case-title').textContent = `#${c.iid ?? '?'} · ${c.title}`;
  $('case-links').textContent = [`rid ${c.rid}`, c.mrIid != null ? `MR !${c.mrIid}` : null, tl?.demo ? 'DEMO REPLAY' : null].filter(Boolean).join(' · ');
  // Discharged (deployed/verified) live cases get a signed Discharge Certificate.
  if (!DEMO && !tl?.demo && ['deployed', 'verified'].includes(tl?.state)) {
    const href = `./certificate.html?${new URLSearchParams({ rid: c.rid, intake: INTAKE_URL })}`;
    $('case-links').append(' · ', el('a', { href, class: 'link' }, 'Certificate →'));
  }
  if (!tl || tl.unavailable) {
    $('stopwatch').textContent = '—';
    $('stages').replaceChildren();
    $('case-note').textContent = tl?.unavailable ?? 'Loading…';
    return;
  }
  const rows = stageRows(tl);
  const current = rows.findLastIndex((r) => r.reached);
  $('stages').className = view.visual ? 'stages visual' : 'stages';
  $('case-story').textContent = view.explain ? caseStory(rows) : '';
  $('stages').replaceChildren(...rows.map((r, i) =>
    el('li', { class: [r.reached ? 'reached' : '', i === current && tl.running !== false && !tl.endedAt ? 'current' : ''].filter(Boolean).join(' ') || null },
      el('strong', {}, r.label),
      view.explain && STAGE_EXPLAIN[r.key] ? el('span', { class: 'explain' }, STAGE_EXPLAIN[r.key].plain, ' ', el('em', {}, `Prevents: ${STAGE_EXPLAIN[r.key].prevents}`)) : null,
      el('span', { class: 't' }, r.reached ? `+${r.sinceShake} · ${new Date(r.at).toLocaleTimeString()}` : 'not yet'),
      r.source && r.source !== 'recorded' ? el('span', { class: 'src', title: 'where this time comes from (DEMO_MODE fixture)' }, r.source) : null,
    )));
  $('case-note').textContent = tl.demo
    ? 'DEMO REPLAY of the recorded hero run (issue #4 → MR !1). Stages tagged "estimated" or "scripted" were not timed in that run.'
    : 'Times come from the intake: the shake, GitLab webhooks, CI and the reporter\'s 👍. Human touches = approvals, merges, notes, pushes and edits by people.';
  tickStopwatch();
}

function tickStopwatch() {
  if (!openCaseRef || !caseTimeline || caseTimeline.unavailable) return;
  if (openCaseRef.fixture) caseTimeline = fixtureTimeline(heroRun, pageLoad, Date.now());
  $('stopwatch').textContent = stopwatchLine(caseTimeline, Date.now());
}

// ---- Medical Records (.shakefix/memory/index.json → memory.json) ------------------------
function renderRecords(index) {
  const r = medicalRecords(index);
  if (!r) {
    $('speedup').textContent = 'No medical record yet. Every discharged case adds one.';
    $('hotspots').replaceChildren();
    $('lessons').replaceChildren();
    return;
  }
  $('speedup').textContent = `${r.speedup.text} · ${r.cases} case${r.cases === 1 ? '' : 's'}`;
  $('hotspots').replaceChildren(...(r.hotspots.length
    ? r.hotspots.map((h) => el('li', {},
        el('span', { class: 'pattern mono', title: h.kind }, `${h.kind === 'route' ? '⇢ ' : ''}${h.label}`),
        el('span', { class: 'bar', style: `--n:${Math.min(h.count, 10)}` }),
        el('span', { class: 'count mono' }, `×${h.count}`),
        h.lastIid != null ? el('span', { class: 'dim mono' }, `#${h.lastIid}`) : el('span', {}),
      ))
    : [el('li', { class: 'dim' }, 'No hotspots yet.')]));
  $('lessons').replaceChildren(...(r.lessons.length
    ? r.lessons.map((l) => el('li', {}, el('span', { class: 'mono' }, l.id), l.text, ' ', el('span', { class: 'dim mono' }, `(${l.source}${l.case != null ? ` · #${l.case}` : ''})`)))
    : [el('li', { class: 'dim' }, 'No lessons yet.')]));
}

// One source for both side panels: .shakefix/memory/index.json (copied to memory.json at build).
async function loadMemory() {
  let index = null;
  try { index = await fetchJson('./memory.json'); } catch { index = null; }
  renderRecords(index);
  const entries = ledgerEntriesFromMemory(index);
  renderLedger(DEMO && !entries.length ? demoLedger : entries);
}

function renderMetricHelp() {
  for (const [id, text] of Object.entries(METRIC_EXPLAIN)) {
    const card = $(id)?.closest('.metric');
    if (!card) continue;
    let help = card.querySelector('.explain');
    if (!view.explain) { help?.remove(); continue; }
    if (!help) card.append(help = el('p', { class: 'explain' }));
    help.textContent = text;
  }
}

// ---- Visual mode: the board as one track ---------------------------------------------------
function renderJourney(cards) {
  $('journey').hidden = !view.visual;
  if (!view.visual) return;
  const { main, offRamp } = journey(cards);
  const phaseNode = (p, i) => el('li', { class: `phase phase-${p.id}${p.cards.length ? ' busy' : ''}${selectedPhase === p.id ? ' selected' : ''}`, 'data-phase': p.id },
    el('button', { type: 'button', class: 'node', 'aria-label': `${p.title}: ${p.cards.length} patient${p.cards.length === 1 ? '' : 's'}. Show what this step does.` },
      el('span', { class: 'icon', 'aria-hidden': 'true' }, p.icon),
      el('span', { class: 'n mono' }, String(p.cards.length))),
    el('span', { class: 'label' }, i != null ? `${i + 1}. ${p.title}` : p.title),
    el('div', { class: 'patients' }, p.cards.slice(0, 6).map((c) =>
      el('button', { type: 'button', class: `patient sev${c.sev}`, 'data-rid': c.rid, title: c.title }, `#${c.iid ?? '?'}`)),
      p.cards.length > 6 ? el('span', { class: 'dim mono' }, `+${p.cards.length - 6}`) : null),
  );
  $('track').replaceChildren(...main.map((p, i) => phaseNode(p, i)));
  $('offramp').replaceChildren(el('span', { class: 'dim mono' }, 'off-ramp ↓ when the robot is unsure'), phaseNode(offRamp));
  const sel = [...main, offRamp].find((p) => p.id === selectedPhase);
  $('phase-info').replaceChildren(...(sel
    ? [el('h3', {}, `${sel.icon} ${sel.title}`), el('p', {}, sel.plain), el('p', { class: 'prevents' }, 'Prevents: ', sel.prevents)]
    : [el('p', { class: 'dim' }, 'Tap a step to see what it does and which disaster it prevents. Tap a patient for its timeline.')]));
  for (const node of $('journey').querySelectorAll('.phase > .node')) {
    node.addEventListener('click', () => { const id = node.parentElement.dataset.phase; selectedPhase = selectedPhase === id ? null : id; renderJourney(lastCards); });
  }
  for (const b of $('journey').querySelectorAll('.patient')) {
    b.addEventListener('click', () => openCase(lastCards.find((c) => c.rid === b.dataset.rid)));
  }
}

function applyView({ save = false } = {}) {
  document.body.classList.toggle('explain-on', view.explain);
  document.body.classList.toggle('visual-on', view.visual);
  $('btn-explain').setAttribute('aria-pressed', String(view.explain));
  $('btn-visual').setAttribute('aria-pressed', String(view.visual));
  $('explain-intro').hidden = !view.explain;
  if (save) {
    store.set('sf-explain', view.explain ? '1' : '0');
    store.set('sf-visual', view.visual ? '1' : '0');
    const q = new URLSearchParams(location.search);
    q.delete('explain'); q.delete('view');
    if (view.explain) q.set('explain', '1');
    if (view.visual) q.set('view', 'visual');
    try { history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname); } catch { /* sandboxed */ }
  }
  renderBoard(lastCards);
  renderJourney(lastCards);
  renderMetricHelp();
  renderCase();
}

function renderMetrics(cards, serverMetrics) {
  const m = computeMetrics(cards, serverMetrics);
  $('m-median').textContent = formatDuration(m.medianMs);
  $('m-last').textContent = `last: ${formatDuration(m.lastMs)}`;
  $('m-handsoff').textContent = m.handsOffPct == null ? '—' : `${m.handsOffPct}%`;
  $('m-handsoff-sub').textContent = `of ${m.finished} finished case${m.finished === 1 ? '' : 's'}`;
  $('m-unintended').textContent = String(m.unintendedCaught);
  $('m-rollbacks').textContent = String(m.rollbacks);
  $('m-confirmed').textContent = m.confirmedPct == null ? '—' : `${m.confirmedPct}%`;
  $('m-confirmed-sub').textContent = `${m.confirmed} 👍 · ${m.rejected} 👎 · ${m.awaitingVerdict} awaiting`;
}

function renderLedger(entries) {
  const patterns = ledgerPatterns(entries);
  $('patterns').replaceChildren(
    ...(patterns.length
      ? patterns.map((p) =>
          el('li', {},
            el('span', { class: 'pattern mono' }, p.pattern),
            el('span', { class: 'bar', style: `--n:${Math.min(p.count, 10)}` }),
            el('span', { class: 'count mono' }, `×${p.count}`),
            p.count > 1 ? el('span', { class: 'chip accent', title: 'same root cause seen again' }, 'family') : null,
          ))
      : [el('li', { class: 'dim' }, 'No entries yet. Every fix adds one.')]),
  );
  const recent = [...(Array.isArray(entries) ? entries : [])].reverse().slice(0, 6);
  $('entries').replaceChildren(
    ...recent.map((e) =>
      el('li', {},
        el('span', { class: 'mono' }, `#${e.iid ?? e.id}`), ' ',
        el('span', {}, e.rootCause ?? ''), ' ',
        el('span', { class: 'dim mono' }, e.route ?? ''),
      )),
  );
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function refresh() {
  let payload;
  if (DEMO) {
    payload = tick(demoState);
  } else {
    try {
      payload = await fetchJson(`${INTAKE_URL}/v1/board`);
      lastOk = new Date();
      $('mode').textContent = 'live';
      $('mode').className = 'chip live';
    } catch (err) {
      $('mode').textContent = `offline (${err.message})`;
      $('mode').className = 'chip bad';
      payload = null;
    }
  }
  if (payload) {
    lastCards = normalizeBoard(payload);
    // The intake in DEMO_MODE says so; label it on screen.
    $('demo-label').hidden = !(DEMO || payload.demo === true || (payload.items ?? []).some((i) => i.demo));
    if (!openCaseRef && params.get('rid')) openCase(lastCards.find((c) => c.rid === params.get('rid')), { scroll: false });
  }
  renderBoard(lastCards);
  renderJourney(lastCards);
  renderMetrics(lastCards, payload?.metrics ?? {});
  const stamp = DEMO ? new Date() : lastOk;
  $('updated').textContent = stamp ? `updated ${stamp.toLocaleTimeString()}` : '';
  if (openCaseRef && !openCaseRef.fixture) loadCase();
  onBoard(lastCards, payload);
}

function init() {
  if (DEMO) {
    $('mode').textContent = 'demo data';
    $('mode').className = 'chip warn';
    $('source').textContent = 'Demo mode: fixture data, no intake connected. The timeline shows the recorded hero run as a DEMO REPLAY.';
    $('demo-label').hidden = false;
  } else {
    $('source').textContent = `Source: ${INTAKE_URL}/v1/board`;
    const badge = el('a', { href: `${INTAKE_URL}/v1/badge.svg`, target: '_blank', rel: 'noopener' }, 'badge.svg');
    $('badge-hint').replaceChildren('README badge: ', badge);
  }
  $('case-close').addEventListener('click', closeCase);
  initMissionControl({ demo: DEMO, intakeUrl: INTAKE_URL, gitlabProjectUrl: GITLAB_PROJECT_URL, heroRun, pageLoad, fetchJson, el, safeHref });
  $('btn-explain').addEventListener('click', () => { view.explain = !view.explain; applyView({ save: true }); });
  $('btn-visual').addEventListener('click', () => { view.visual = !view.visual; applyView({ save: true }); });
  applyView();
  loadMemory();
  refresh();
  if (DEMO) openCase({ rid: heroRun.rid, title: heroRun.title, iid: heroRun.issueIid, mrIid: heroRun.mrIid }, { scroll: false });
  setInterval(refresh, POLL_MS);
  setInterval(tickStopwatch, 1000);
  setInterval(loadMemory, 60_000);
}

init();
