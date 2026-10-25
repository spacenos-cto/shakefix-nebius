// Blast Radius: which routes, components and code paths a bug (replay) or a change (MR files)
// touches, how many SYNTHETIC demo patients used them, and a Mermaid graph. docs/BLAST-RADIUS.md.
import { resolve } from 'node:path';
import { changedDefs, defId, handlerTargets, loadGraph, touchpointsFromReplay, walk } from './graph.js';
import { orbitConfig, orbitEdges } from './orbit.js';
import { fetchAffected } from './affected.js';
import { CATEGORIES, detectCategory, exposureFor } from './exposure.js';
import { renderMarkdown, renderMermaid, headline, mermaidLabel, MARKER } from './render.js';

export { buildGraph, loadGraph, walk, handlerTargets, touchpointsFromReplay, changedDefs } from './graph.js';
export { clientRoutes, serverRoutes, regexToPattern, matchClientRoute, componentFor } from './routes.js';
export { orbitConfig, orbitEdges, callsQuery, parseRows } from './orbit.js';
export { fetchAffected, affectedUrl } from './affected.js';
export { CATEGORIES, detectCategory, exposureFor } from './exposure.js';
export { renderMarkdown, renderMermaid, headline, mermaidLabel, MARKER };

/** Strip the app prefix (`apps/carerx/`) from repo-relative paths. */
export function normalizeFiles(files, appPrefix) {
  const pre = appPrefix ? `${appPrefix.replace(/\\/g, '/').replace(/\/+$/, '')}/` : '';
  return files
    .map((f) => String(f).trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean)
    .map((f) => (pre && f.startsWith(pre) ? f.slice(pre.length) : f));
}

/** Clone the graph's edges so Orbit edges can be merged without mutating a shared graph. */
function withExtraEdges(graph, extra) {
  const edges = new Map([...graph.edges].map(([k, v]) => [k, new Set(v)]));
  for (const [a, b] of extra) {
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a).add(b);
  }
  return { ...graph, edges };
}

function mapOrbitNode(graph, node, appPrefix) {
  const pre = appPrefix ? `${appPrefix}/` : '';
  const file = node.file.startsWith(pre) ? node.file.slice(pre.length) : node.file;
  if (graph.defs.has(defId(file, node.name))) return defId(file, node.name);
  const hit = [...graph.defs.values()].find((d) => node.file.endsWith(d.file) && (d.name === node.name || d.name.endsWith(`.${node.name}`)));
  return hit?.id ?? null;
}

/**
 * @param {object} opts
 * @param {string} [opts.appDir]      absolute app folder (default: <repo>/apps/carerx)
 * @param {string} [opts.appPrefix]   repo-relative app path (default: apps/carerx)
 * @param {object} [opts.graph]       prebuilt graph (tests)
 * @param {object} [opts.replay]      shakefix.replay/v1
 * @param {string[]} [opts.files]     changed files (repo- or app-relative; `file#fn` allowed)
 * @param {string} [opts.appUrl]      CareRx base URL for /api/insights/affected
 * @param {object} [opts.env]         env for Orbit config
 * @param {Function} [opts.fetch]
 * @param {number} [opts.hops]        default 3
 * @param {string} [opts.category]    override detection
 * @param {string} [opts.segment]     override the category's segment
 * @param {boolean} [opts.orbit]      false = never call Orbit
 */
export async function blastRadius(opts = {}) {
  const hops = Math.max(1, Math.min(3, Number(opts.hops) || 3));
  const appPrefix = (opts.appPrefix ?? 'apps/carerx').replace(/\\/g, '/').replace(/\/+$/, '');
  let graph = opts.graph ?? loadGraph(opts.appDir ?? resolve(import.meta.dirname, '../../../..', ...appPrefix.split('/')));
  const replay = opts.replay ?? null;
  const files = normalizeFiles(opts.files ?? [], appPrefix);
  const f = opts.fetch ?? globalThis.fetch;

  const touchpoints = replay ? touchpointsFromReplay(graph, replay) : [];
  const primary = [...touchpoints].reverse().find((t) => t.testid && t.pattern) ?? touchpoints.at(-1) ?? null;
  const changed = changedDefs(graph, files);
  const viewStarts = [...new Set(touchpoints.map((t) => t.viewDef).filter(Boolean))].sort();

  // ---- Orbit (optional): callers of changed defs, callees of touched views
  let source = 'static';
  const cfg = orbitConfig(opts.env ?? {});
  if (opts.orbit !== false && cfg.enabled) {
    const asTarget = (id) => { const d = graph.defs.get(id); return d && d.kind !== 'route' && d.kind !== 'module' ? { name: d.name.split('.').at(-1), filePath: `${appPrefix}/${d.file}` } : null; };
    const extra = [];
    const callersE = await orbitEdges(cfg, changed.defs.map(asTarget).filter(Boolean), { direction: 'callers', fetch: f });
    const calleesE = await orbitEdges(cfg, viewStarts.map(asTarget).filter(Boolean), { direction: 'callees', fetch: f });
    for (const e of [...(callersE ?? []), ...(calleesE ?? [])]) {
      const a = mapOrbitNode(graph, e.from, appPrefix);
      const b = mapOrbitNode(graph, e.to, appPrefix);
      if (a && b && a !== b) extra.push([a, b]);
    }
    if (extra.length) {
      graph = withExtraEdges(graph, extra);
      source = 'orbit';
    }
  }

  // ---- walks
  const fwd = walk(graph, viewStarts, { hops, direction: 'forward' });
  const primaryStarts = primary?.view && primary?.testid ? handlerTargets(graph, primary.view, primary.testid) : [];
  const prim = walk(graph, primaryStarts, { hops: Math.max(1, hops - 1), direction: 'forward' });
  const rev = walk(graph, changed.defs, { hops, direction: 'reverse' });

  const reached = new Map();
  for (const m of [fwd.reached, rev.reached]) for (const [id, h] of m) if (!reached.has(id) || reached.get(id) > h) reached.set(id, h);
  const isShown = (id) => graph.defs.get(id)?.kind !== 'module';
  const changedSet = new Set(changed.defs);
  const nodes = [...reached.keys()].filter(isShown).sort().map((id) => {
    const d = graph.defs.get(id);
    return {
      id, name: d.name, file: d.file, kind: d.kind, line: d.line, hop: reached.get(id),
      ...(d.kind === 'route' ? { method: d.method, path: d.path } : {}),
      primary: prim.reached.has(id), changed: changedSet.has(id),
    };
  });
  const shown = new Set(nodes.map((n) => n.id));
  const links = [...new Map([...fwd.edges, ...rev.edges].filter(([a, b]) => shown.has(a) && shown.has(b)).map((e) => [`${e[0]}->${e[1]}`, e])).values()]
    .sort((x, y) => `${x[0]}->${x[1]}`.localeCompare(`${y[0]}->${y[1]}`));

  // ---- client routes touched: replay routes + routes whose view the change reaches
  const clientRoutes = graph.router?.routes ?? [];
  const routeSet = new Map();
  for (const t of touchpoints) {
    const cr = clientRoutes.find((x) => x.pattern === t.pattern);
    if (cr) routeSet.set(cr.pattern, cr);
  }
  for (const cr of clientRoutes) if (cr.viewDef && rev.reached.has(cr.viewDef)) routeSet.set(cr.pattern, cr);
  const routes = [...routeSet.values()].map((x) => ({ pattern: x.pattern, view: x.viewFile, viewDef: x.viewDef, title: x.title }))
    .sort((a, b) => (a.pattern === primary?.pattern ? -1 : b.pattern === primary?.pattern ? 1 : a.pattern.localeCompare(b.pattern)));

  const endpoints = nodes.filter((n) => n.kind === 'route').map((n) => ({ method: n.method, path: n.path, file: n.file, line: n.line, primary: n.primary }))
    .sort((a, b) => (b.primary - a.primary) || `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));

  // ---- category, population, exposure
  const testids = touchpoints.map((t) => t.testid).filter(Boolean);
  const category = opts.category && CATEGORIES[opts.category] ? opts.category : detectCategory({ note: replay?.note ?? '', testids, files });
  const segment = opts.segment !== undefined ? (opts.segment || null) : CATEGORIES[category].segment;
  let population;
  const appUrl = opts.appUrl || null;
  if (primary?.pattern || primary?.component) {
    population = await fetchAffected(appUrl, { route: primary.pattern, component: primary.component, segment }, { fetch: f });
  } else if (routes.length) {
    const all = [];
    for (const r of routes) all.push(await fetchAffected(appUrl, { route: r.pattern, segment }, { fetch: f }));
    population = all.filter((x) => Number.isFinite(x.patients)).sort((a, b) => b.patients - a.patients)[0] ?? all[0];
  } else {
    population = await fetchAffected(null, {}, { fetch: f });
    population.reason = 'no client route touched';
  }
  const exposure = exposureFor(category, Number.isFinite(population.patients) ? population : null);

  const report = {
    schema: 'shakefix.blast/v1',
    mode: replay ? (files.length ? 'replay+files' : 'replay') : 'files',
    source,
    app: appPrefix,
    hops,
    touchpoints: touchpoints.map(({ viewDef, ...t }) => t),
    primary: primary ? { route: primary.route, pattern: primary.pattern, testid: primary.testid, component: primary.component, view: primary.view } : null,
    routes,
    endpoints,
    nodes,
    links,
    changed: { files, defs: changed.defs, unknown: changed.unknown },
    category,
    segment,
    population,
    exposure,
  };
  report.headline = headline(report);
  report.mermaid = renderMermaid(report, { links: opts.links });
  report.markdown = renderMarkdown(report, { links: opts.links });
  return report;
}

