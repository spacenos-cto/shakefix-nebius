// Mission Control: the tab bar (Patients · Live feed · Second Opinion · Receipts · Numbers) and the
// four new tabs. DOM glue only; the logic lives in tabs.js, feed.js, opinion.js, receipts.js, numbers.js.
// main.js owns polling and the Patients tab; it calls onBoard() after every poll.

import './mission.css';
import { formatDuration } from './metrics.js';
import { fixtureTimeline } from './timeline.js';
import { TABS, searchWithTab, tabFromSearch, tabKeyTarget } from './tabs.js';
import { ago, buildFeed, eventsFromCard, transitionEvents } from './feed.js';
import { controlsScore, proofBars, proofTotals } from './opinion.js';
import { receipts } from './receipts.js';
import { numberTiles, shakeToLiveSeries, sparkline, tween } from './numbers.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let ctx = null; // {demo, intakeUrl, gitlabProjectUrl, heroRun, pageLoad, fetchJson, el, safeHref}
let activeTab = tabFromSearch(location.search);
let cards = [];
let prevCards = null;
let serverMetrics = {};
const transitions = [];

export function initMissionControl(deps) {
  ctx = deps;
  const { el } = ctx;
  const list = $('tabs');
  list.replaceChildren(...TABS.map((t) => el('button', {
    type: 'button', role: 'tab', id: `tab-${t.id}`, class: `tab tab-${t.id}`, 'aria-controls': `panel-${t.id}`, 'data-tab': t.id, title: t.hint,
  }, t.id === 'feed' ? el('span', { class: 'live-dot', 'aria-hidden': 'true' }) : null, t.label)));
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[role="tab"]');
    if (b) selectTab(b.dataset.tab);
  });
  list.addEventListener('keydown', (e) => {
    const next = tabKeyTarget(activeTab, e.key);
    if (!next) return;
    e.preventDefault();
    selectTab(next, { focus: true });
  });
  showTab();
}

/** Called by main.js after every board poll. */
export function onBoard(nextCards, payload) {
  cards = nextCards ?? [];
  if (payload) {
    // Keep every state the board has shown (a card's own events only describe its current state) and
    // every change between two polls; buildFeed() merges the overlaps.
    transitions.unshift(...transitionEvents(prevCards, cards), ...cards.flatMap(eventsFromCard));
    const seen = new Set();
    const unique = transitions.filter((e) => { const k = `${e.rid}:${e.key}:${e.at}`; return !seen.has(k) && seen.add(k); });
    transitions.splice(0, transitions.length, ...unique.slice(0, 300));
    prevCards = cards;
    serverMetrics = payload.metrics ?? {};
  }
  renderActiveTab(false);
}

function selectTab(id, { focus = false } = {}) {
  const changed = id !== activeTab;
  activeTab = id;
  try { history.replaceState(null, '', searchWithTab(location.search, id) || location.pathname); } catch { /* sandboxed */ }
  showTab();
  if (focus) $(`tab-${id}`)?.focus();
  if (changed) renderActiveTab(true);
}

function showTab() {
  for (const t of TABS) {
    const on = t.id === activeTab;
    const b = $(`tab-${t.id}`);
    b?.setAttribute('aria-selected', String(on));
    b?.setAttribute('tabindex', on ? '0' : '-1');
    $(`panel-${t.id}`).hidden = !on;
  }
  document.body.dataset.tab = activeTab;
}

function renderActiveTab(entering) {
  if (!ctx) return;
  if (activeTab === 'feed') renderFeed(entering);
  else if (activeTab === 'opinion') renderOpinion(entering);
  else if (activeTab === 'receipts') renderReceipts();
  else if (activeTab === 'numbers') renderNumbers(entering);
}

// ---- Live feed -------------------------------------------------------------------------------
const feedTimelines = new Map(); // rid -> {card, tl, key, fetchedAt}
const seenFeed = new Set();
let feedRendered = false;
let feedFetching = false;

async function refreshFeedTimelines() {
  if (ctx.demo || feedFetching) return;
  feedFetching = true;
  const now = Date.now();
  const recent = [...cards].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 15);
  try {
    await Promise.all(recent.map(async (card) => {
      const have = feedTimelines.get(card.rid);
      if (have && have.key === card.updatedAt && now - have.fetchedAt < 30_000) { have.card = card; return; }
      try {
        const tl = await ctx.fetchJson(`${ctx.intakeUrl}/v1/reports/${encodeURIComponent(card.rid)}/timeline`);
        feedTimelines.set(card.rid, { card, tl, key: card.updatedAt, fetchedAt: now });
      } catch {
        feedTimelines.delete(card.rid); // fall back to what the board card knows
      }
    }));
  } finally {
    feedFetching = false;
  }
}

function feedTimelineMap() {
  if (ctx.demo) {
    // The recorded hero run replays from page load; the fixture cards fill in the rest.
    const h = ctx.heroRun;
    const card = { rid: h.rid, iid: h.issueIid, title: h.title };
    return new Map([[h.rid, { card, tl: fixtureTimeline(h, ctx.pageLoad, Date.now()) }]]);
  }
  const live = new Set(cards.map((c) => c.rid));
  return new Map([...feedTimelines].filter(([rid]) => live.has(rid)));
}

function renderFeed() {
  drawFeed();
  if (!ctx.demo) refreshFeedTimelines().then(() => { if (activeTab === 'feed') drawFeed(); });
}

function drawFeed() {
  const { el } = ctx;
  const now = Date.now();
  const rows = buildFeed({ cards, timelines: feedTimelineMap(), transitions });
  const animate = feedRendered && !reducedMotion();
  $('feed').replaceChildren(...(rows.length
    ? rows.map((r) => el('li', { class: `feed-row ev-${r.key}${animate && !seenFeed.has(r.id) ? ' fresh' : ''}` },
        el('time', { class: 'mono', datetime: new Date(r.at).toISOString(), title: new Date(r.at).toLocaleString() },
          new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          el('span', { class: 'ago' }, ago(r.at, now))),
        el('span', { class: 'feed-icon', 'aria-hidden': 'true' }, r.icon),
        el('span', { class: 'feed-case mono', title: r.title }, `#${r.iid ?? '?'}`),
        el('div', { class: 'feed-text' },
          el('strong', {}, r.label), ' ',
          el('span', { class: 'dim-2' }, r.text),
          r.source ? el('span', { class: 'src mono', title: 'where this time comes from (DEMO_MODE fixture)' }, r.source) : null),
      ))
    : [el('li', { class: 'empty dim' }, 'No events yet. Shake a phone on the Try page to start one.')]));
  for (const r of rows) seenFeed.add(r.id);
  feedRendered = true;
  const latest = rows[0];
  $('feed-meta').textContent = [ctx.demo ? 'DEMO REPLAY' : 'LIVE', plural(rows.length, 'event'), latest ? `last ${ago(latest.at, now)}` : null].filter(Boolean).join(' · ');
}

// ---- Second Opinion --------------------------------------------------------------------------
let controlsRaw;
let controlsLoadedAt = 0;

async function loadControls() {
  if (controlsRaw !== undefined && Date.now() - controlsLoadedAt < 60_000) return;
  controlsLoadedAt = Date.now();
  try { controlsRaw = await ctx.fetchJson('./controls.json'); } catch { controlsRaw = null; }
}

const pctText = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

async function renderOpinion() {
  const { el } = ctx;
  const bars = proofBars(cards);
  const t = proofTotals(bars);
  $('opinion-totals').textContent = bars.length
    ? `${plural(bars.length, 'case')} checked · ${t.intended} intended · ${t.unintended} unintended · ${t.flaky} flaky`
    : '';
  const seg = (kind, n) => (n ? el('span', { class: `seg ${kind}`, style: `flex-grow:${n}`, title: `${n} ${kind}` }, String(n)) : null);
  $('opinion-bars').replaceChildren(...(bars.length
    ? bars.map((b) => el('li', { class: 'bar-row' },
        el('span', { class: 'bar-case mono' }, `#${b.iid ?? '?'}`),
        el('span', { class: 'bar-title', title: b.title }, b.title),
        el('span', { class: 'bar-track', role: 'img', 'aria-label': `${b.intended} intended, ${b.unintended} unintended, ${b.flaky} flaky` },
          el('span', { class: 'bar-fill', style: `width:${Math.max(10, Math.round(b.scale * 100))}%` },
            seg('intended', b.intended), seg('unintended', b.unintended), seg('flaky', b.flaky))),
        el('span', { class: `bar-verdict mono ${b.unintended ? 'bad' : 'ok'}` }, b.unintended ? 'caught' : 'clean')))
    : [el('li', { class: 'empty dim' }, 'No Second Opinion results yet.')]));

  await loadControls();
  const score = controlsScore(controlsRaw);
  if (!score) {
    $('controls').replaceChildren(el('p', { class: 'empty dim' }, 'No control runs yet.'));
    return;
  }
  const mark = (ok) => el('span', { class: 'tick', 'aria-hidden': 'true' }, ok == null ? '…' : ok ? '✓' : '✗');
  const state = (ok) => (ok == null ? 'pending' : ok ? 'ok' : 'bad');
  const tick = (ok, label) => el('li', { class: state(ok) }, mark(ok), label);
  $('controls').replaceChildren(
    el('ul', { class: 'score-ticks' },
      tick(score.recall == null ? null : score.recall === 1, `Blocked ${score.tp} of ${score.tp + score.fn} planted-bad MRs · recall ${pctText(score.recall)}`),
      tick(score.precision == null ? null : score.precision === 1, `${score.fp} good MR${score.fp === 1 ? '' : 's'} blocked by mistake · precision ${pctText(score.precision)}`),
      tick(score.ran ? score.correct === score.ran : null, `${score.correct} of ${score.ran} runs got the expected verdict${score.pending ? ` · ${score.pending} pending` : ''}`)),
    el('ol', { class: 'controls-list' }, score.rows.map((r) => {
      const ok = r.actual == null ? null : r.ok;
      return el('li', { class: state(ok) },
        mark(ok),
        el('span', { class: 'mono' }, r.mr != null ? `!${r.mr}` : '—'),
        el('span', { class: `chip kind-${r.kind}` }, r.kind),
        el('span', { class: 'mono dim' }, `expected ${r.expected} · got ${r.actual ?? '—'}`));
    })),
  );
}

// ---- Receipts --------------------------------------------------------------------------------
function renderReceipts() {
  const { el, safeHref } = ctx;
  const rows = receipts(cards, { gitlabProjectUrl: ctx.gitlabProjectUrl, intake: ctx.demo ? '' : ctx.intakeUrl });
  $('receipts-meta').textContent = plural(rows.length, 'discharged case');
  if (!rows.length) {
    $('receipts').replaceChildren(el('p', { class: 'empty dim' }, 'No discharged cases yet. The first fix that goes live lands here.'));
    return;
  }
  const link = (href, text) => { const h = href && safeHref(href); return h ? el('a', { href: h, target: '_blank', rel: 'noopener' }, text) : null; };
  const head = ['Case', 'Shipped', 'Shake → live', 'Human touches', 'Links', 'Certificate'];
  $('receipts').replaceChildren(el('table', { class: 'receipts' },
    el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, rows.map((r) => el('tr', {},
      el('td', { 'data-label': 'Case', class: 'case-cell' }, el('span', { class: 'mono accent' }, `#${r.iid ?? '?'}`), ' ', r.title,
        r.verdict === 'confirmed' ? el('span', { class: 'chip verdict-confirmed', title: 'Reporter confirmed the fix' }, '👍') : null),
      el('td', { 'data-label': 'Shipped', class: 'mono' }, r.fixedAt ? new Date(r.fixedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'),
      el('td', { 'data-label': 'Shake → live', class: 'mono strong' }, formatDuration(r.shakeToLiveMs)),
      el('td', { 'data-label': 'Human touches', class: 'mono' }, r.humanTouches == null ? '—' : `✋ ${r.humanTouches}`),
      el('td', { 'data-label': 'Links', class: 'links mono' }, el('span', { class: 'link-set' },
        link(r.links.issue, 'issue') ?? el('span', { class: 'dim' }, `#${r.iid ?? '?'}`),
        link(r.links.mr, 'MR') ?? (r.mrIid != null ? el('span', { class: 'dim' }, `!${r.mrIid}`) : null),
        link(r.links.pipeline, 'pipeline'))),
      el('td', { 'data-label': 'Certificate', class: 'cert' }, el('a', { class: 'cert-link', href: r.certificate }, 'Certificate →')),
    ))),
  ));
}

// ---- Numbers ---------------------------------------------------------------------------------
const shown = new Map(); // tile id -> value currently on screen (mid-animation too)
const aimed = new Map(); // tile id -> value the last animation was heading for
let tileAnim = 0;

function formatTile(format, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (format === 'duration') return formatDuration(v);
  if (format === 'pct') return `${Math.round(v)}%`;
  return String(Math.round(v));
}

function countUp(targets, fromZero) {
  const changed = fromZero || targets.some(([id, to]) => aimed.get(id) !== to);
  if (!changed) return;
  cancelAnimationFrame(tileAnim);
  for (const [id, to] of targets) aimed.set(id, to);
  // A new poll mid-animation continues from what is on screen instead of jumping back to 0.
  const starts = new Map(targets.map(([id]) => [id, fromZero || !Number.isFinite(shown.get(id)) ? 0 : shown.get(id)]));
  const draw = (t) => {
    for (const [id, to] of targets) {
      const node = $(id);
      const v = to == null ? null : t >= 1 ? to : tween(starts.get(id), to, t);
      node.textContent = formatTile(node.dataset.format, v);
      shown.set(id, v);
    }
  };
  if (reducedMotion()) { draw(1); return; }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / 1100);
    draw(t);
    if (t < 1) tileAnim = requestAnimationFrame(step);
  };
  tileAnim = requestAnimationFrame(step);
}

function svgEl(tag, attrs = {}, ...kids) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const k of kids) node.append(k);
  return node;
}

function renderNumbers(entering) {
  const { el } = ctx;
  const n = numberTiles(cards, serverMetrics);
  countUp([
    ['n-median', n.median.ms],
    ['n-handsoff', n.handsOff.pct],
    ['n-unintended', n.unintended.value],
    ['n-rollbacks', n.rollbacks.value],
  ], entering);
  $('n-median-sub').textContent = `median of ${plural(n.median.n, 'discharged case')}`;
  $('n-handsoff-sub').textContent = `${n.handsOff.n} of ${n.handsOff.of} discharged, zero human touches`;
  $('n-unintended-sub').textContent = `in ${plural(n.unintended.cases, 'case')}, before merge`;

  const series = shakeToLiveSeries(cards);
  const W = 640;
  const H = 120;
  const sp = sparkline(series.map((p) => p.ms), { width: W, height: H, pad: 14 });
  $('spark-range').textContent = series.length ? `fastest ${formatDuration(sp.min)} · slowest ${formatDuration(sp.max)}` : '';
  if (!series.length) {
    $('spark').replaceChildren(el('p', { class: 'empty dim' }, 'No discharged cases yet.'));
    return;
  }
  const first = sp.points[0];
  const last = sp.points[sp.points.length - 1];
  const area = `${sp.path} L${last.x} ${H} L${first.x} ${H} Z`;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'spark', role: 'img', preserveAspectRatio: 'none',
    'aria-label': `Shake to live per case, oldest first: ${series.map((p) => `#${p.iid ?? '?'} ${formatDuration(p.ms)}`).join(', ')}`,
  },
  svgEl('defs', {}, svgEl('linearGradient', { id: 'spark-fill', x1: '0', x2: '0', y1: '0', y2: '1' },
    svgEl('stop', { offset: '0%', 'stop-color': '#ff5a1f', 'stop-opacity': '0.30' }),
    svgEl('stop', { offset: '100%', 'stop-color': '#ff5a1f', 'stop-opacity': '0' }))),
  svgEl('path', { d: area, class: 'spark-area' }),
  svgEl('path', { d: sp.path, class: 'spark-line', 'vector-effect': 'non-scaling-stroke' }));
  // Dots + labels are HTML on top of the stretched SVG so they stay round and legible at any width.
  const dots = el('ol', { class: 'spark-dots', 'aria-hidden': 'true' }, sp.points.map((pt, i) =>
    el('li', { style: `left:${(pt.x / W) * 100}%;top:${(pt.y / H) * 100}%`, class: i === sp.points.length - 1 ? 'last' : null, title: `#${series[i].iid ?? '?'} · ${formatDuration(series[i].ms)}` },
      el('span', { class: 'mono' }, `#${series[i].iid ?? '?'} · ${formatDuration(series[i].ms)}`))));
  $('spark').replaceChildren(svg, dots);
}
