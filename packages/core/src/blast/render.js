// Markdown + Mermaid rendering for the blast-radius report. Deterministic: same input, same bytes.

export const MARKER = '<!-- shakefix:blast-radius -->';

/** Safe Mermaid label text (always used inside `["..."]`). */
export function mermaidLabel(text) {
  return String(text ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/#/g, '#35;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/`/g, '#96;')
    .replace(/\(/g, '#40;')
    .replace(/\)/g, '#41;')
    .slice(0, 120);
}

const mdCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const fmt = (n) => Number(n).toLocaleString('en-US');

function defLabel(d) {
  if (d.kind === 'route') return `${d.method} ${d.path}`;
  return `${d.file} · ${d.name}`;
}

/**
 * @param {object} r report from blastRadius() (uses r.nodes / r.links / r.touchpoints / r.routes)
 */
// links: 'arrow' (-->) or 'plain' (---). Use 'plain' when a tool HTML-escapes '>' in notes.
export function renderMermaid(r, { links = 'arrow' } = {}) {
  const lines = ['graph LR'];
  const ids = new Map();
  const cls = { action: [], route: [], view: [], api: [], hit: [], changed: [] };
  const node = (key, label, kind) => {
    if (ids.has(key)) return ids.get(key);
    const id = `${kind[0]}${[...ids.keys()].filter((k) => k.startsWith(`${kind}:`)).length}`;
    ids.set(key, id);
    lines.push(`  ${id}["${mermaidLabel(label)}"]`);
    return id;
  };
  const edges = new Set();
  const edge = (a, b) => {
    const e = `  ${a} ${links === 'plain' ? '---' : '-->'} ${b}`;
    if (!edges.has(e)) { edges.add(e); lines.push(e); }
  };

  // user actions -> client route -> view
  const actions = r.touchpoints.filter((t) => t.testid).slice(-3);
  for (const t of actions) {
    const a = node(`action:${t.action}:${t.testid}`, `${t.action} ${t.testid}`, 'action');
    cls.action.push(a);
    if (t.pattern) {
      const rt = node(`route:${t.pattern}`, t.pattern, 'route');
      cls.route.push(rt);
      edge(a, rt);
    }
  }
  for (const cr of r.routes) {
    const rt = node(`route:${cr.pattern}`, cr.pattern, 'route');
    if (!cls.route.includes(rt)) cls.route.push(rt);
    if (cr.viewDef && r.nodes.some((n) => n.id === cr.viewDef)) {
      const v = node(`def:${cr.viewDef}`, defLabel(r.nodes.find((n) => n.id === cr.viewDef)), 'def');
      cls.view.push(v);
      edge(rt, v);
    }
  }
  for (const n of r.nodes) {
    const id = node(`def:${n.id}`, defLabel(n), 'def');
    if (n.kind === 'route') cls.api.push(id);
    if (n.primary) cls.hit.push(id);
    if (n.changed) cls.changed.push(id);
  }
  for (const [a, b] of r.links) {
    if (ids.has(`def:${a}`) && ids.has(`def:${b}`)) edge(ids.get(`def:${a}`), ids.get(`def:${b}`));
  }
  lines.push('  classDef action fill:#eef4ff,stroke:#3b6fd8,color:#1b2b4b');
  lines.push('  classDef route fill:#f3f0ff,stroke:#6b4fd8,color:#241b4b');
  lines.push('  classDef api fill:#fff6e5,stroke:#c98a00,color:#4b3600');
  lines.push('  classDef hit stroke:#c0392b,stroke-width:3px');
  lines.push('  classDef changed fill:#fde2e1,stroke:#c0392b,color:#5a1510');
  for (const [k, list] of Object.entries(cls)) {
    const uniq = [...new Set(list)];
    if (uniq.length && k !== 'view') lines.push(`  class ${uniq.join(',')} ${k}`);
  }
  return lines.join('\n');
}

export function headline(r) {
  const parts = [];
  const verb = r.mode === 'files' ? 'This change touches' : 'This bug touches';
  const routes = r.primary?.pattern ? [r.primary.pattern] : r.routes.map((x) => x.pattern);
  if (routes.length) parts.push(routes.slice(0, 3).map(code).join(', ') + (routes.length > 3 ? ` +${routes.length - 3}` : ''));
  else parts.push('no client route found');
  if (r.primary?.component) parts.push(code(r.primary.component));
  const p = r.population;
  if (Number.isFinite(p?.patients)) {
    const upTo = r.mode === 'files' && r.routes.length > 1 ? 'up to ' : '';
    const seg = r.segment ? ` (${r.segment} segment)` : '';
    parts.push(`**${upTo}${fmt(p.patients)} patients**${seg} in the last ${p.windowDays ?? '?'} days (${p.synthetic ? 'synthetic demo population' : 'population data'})`);
  } else {
    parts.push(`patients unknown (${p?.reason || 'no insights'})`);
  }
  return `${verb} ${parts.join(' · ')}`;
}

export function renderMarkdown(r, opts = {}) {
  const out = [MARKER, '### 💥 Blast Radius', '', headline(r), ''];
  const p = r.population;
  const views = [...new Set(r.routes.map((x) => x.view).filter(Boolean))];
  const fnCount = r.nodes.filter((n) => n.kind !== 'route').length;
  const fileCount = new Set(r.nodes.map((n) => n.file)).size;
  const endpoints = r.endpoints.map((e) => `${code(`${e.method} ${e.path}`)}${e.primary ? ` (fired by ${code(r.primary?.testid ?? 'action')})` : ''}`);
  const rows = [
    ['Route', r.routes.length ? r.routes.map((x) => code(x.pattern)).join(', ') : 'none found'],
    ['Component', r.primary?.component ? code(r.primary.component) : (r.touchpoints.filter((t) => t.component).map((t) => code(t.component)).join(', ') || '—')],
    ['View module', views.length ? views.map(code).join(', ') : '—'],
    [`Code paths (≤${r.hops} hops)`, `${fnCount} functions in ${fileCount} files`],
    ['API endpoints', endpoints.length ? endpoints.join(', ') : '—'],
    ['Changed', r.changed.defs.length ? r.changed.defs.map(code).join(', ') : '—'],
    [Number.isFinite(p?.windowDays) ? `Patients (last ${p.windowDays} d)` : 'Patients', Number.isFinite(p?.patients) ? `${fmt(p.patients)} of ${fmt(p.populationSize)} (${p.synthetic ? 'synthetic' : 'population data'})` : `unknown (${p?.reason || 'no insights'})`],
    ['Category', r.exposure.category],
    ['Graph source', r.source === 'orbit' ? 'GitLab Orbit + route extractor' : 'static import/call graph'],
  ];
  out.push('| | |', '|---|---|', ...rows.map(([k, v]) => `| ${mdCell(k)} | ${mdCell(v)} |`), '');
  out.push(`**Exposure:** ${r.exposure.text}`, '');
  out.push(`**Legal (qualitative, needs human review):** ${r.exposure.legal.text}`, '');
  const ctx = r.exposure.legal.sources ?? [];
  if (ctx.length) out.push(`**Real-world context (verified sources, not an estimate for this bug):** ${ctx.map((c) => `[${c.text}](${c.url})`).join(' · ')}`, '');
  out.push('```mermaid', renderMermaid(r, opts), '```', '');
  out.push(`<sub>Patient numbers come from a SYNTHETIC demo population (CareRx has no real patients). Formula: ${r.exposure.formula}.</sub>`);
  return out.join('\n');
}
