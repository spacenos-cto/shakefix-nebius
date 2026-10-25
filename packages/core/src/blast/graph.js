// Static import/call graph over an app folder (default apps/carerx), no parser dependency.
//
// Nodes ("defs"): top-level functions, arrow consts, object-literal methods (`api.refill`),
// Express route handlers (`ROUTE POST /api/prescriptions/:id/refills`) and one `<module>` node
// per file for top-level code. Edges: a def references another def (call or callback), resolved
// via same-file names and ESM imports; plus `http` edges from a client function whose body holds
// an `/api/...` literal to the matching server route.
//
// Walks: forward from replay touchpoints (route + testids -> view -> its imports) or backwards
// from changed files/functions (callers), up to `hops` (default 3).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { parseModule, referencesIn } from './module.js';
import { clientRoutes, serverRoutes, matchClientRoute, testidMatches, componentFor } from './routes.js';
import { pathsMatch } from './source.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'public', 'test', 'tests', '.git']);
const JS = /\.(m?js|jsx)$/;

export const defId = (file, name) => `${file}#${name}`;

function listFiles(root, dir = root, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) listFiles(root, full, out);
    } else if (JS.test(name) && !/\.(test|spec)\.m?js$/.test(name) && !/\.config\.m?js$/.test(name)) {
      out.push(relative(root, full).split(sep).join('/'));
    }
  }
  return out;
}

/**
 * Build the graph for an app folder.
 * @param {string} appDir absolute path
 * @param {{ files?: Record<string,string> }} [opts] files: in-memory {relPath: source} (tests)
 */
export function buildGraph(appDir, opts = {}) {
  const sources = opts.files ?? Object.fromEntries(listFiles(appDir).map((f) => [f, readFileSync(join(appDir, f), 'utf8')]));
  const fileNames = Object.keys(sources).sort();
  const mods = new Map(fileNames.map((f) => [f, parseModule(sources[f], f)]));
  const defs = new Map();
  const edges = new Map(); // from -> Set(to)
  const kinds = new Map(); // `${from}->${to}` -> 'ref' | 'http'

  const addEdge = (from, to, kind = 'ref') => {
    if (from === to || !defs.has(from) || !defs.has(to)) return;
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(to);
    kinds.set(`${from}->${to}`, kind);
  };

  const resolveSpec = (fromFile, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
    for (const cand of [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`]) if (mods.has(cand)) return cand;
    return null;
  };

  // ---- nodes
  const server = [];
  for (const mod of mods.values()) {
    for (const d of mod.defs) defs.set(defId(mod.file, d.name), { id: defId(mod.file, d.name), ...pick(d), kind: d.kind });
    for (const r of serverRoutes(mod)) {
      const name = `ROUTE ${r.method} ${r.fullPath}`;
      const id = defId(mod.file, name);
      defs.set(id, { id, name, file: mod.file, kind: 'route', start: r.start, end: r.end, line: r.line, method: r.method, path: r.fullPath });
      server.push(defs.get(id));
    }
    defs.set(defId(mod.file, '<module>'), { id: defId(mod.file, '<module>'), name: '<module>', file: mod.file, kind: 'module', start: 0, end: mod.code.length, line: 1 });
  }

  // ---- import bindings per file: local -> {file, imported}
  const bindings = new Map();
  for (const mod of mods.values()) {
    const b = new Map();
    for (const imp of mod.imports) {
      const target = resolveSpec(mod.file, imp.from);
      if (!target) continue;
      for (const x of imp.bindings) b.set(x.local, { file: target, imported: x.imported });
    }
    bindings.set(mod.file, b);
  }

  const resolveRef = (file, ref) => {
    const mod = mods.get(file);
    const local = mod.defs.find((d) => d.name === ref.name);
    if (local) return ref.member && defs.has(defId(file, `${ref.name}.${ref.member}`)) ? defId(file, `${ref.name}.${ref.member}`) : defId(file, ref.name);
    if (ref.member && defs.has(defId(file, `${ref.name}.${ref.member}`))) return defId(file, `${ref.name}.${ref.member}`);
    const b = bindings.get(file).get(ref.name);
    if (!b) return null;
    if (b.imported === '*') return ref.member ? defId(b.file, ref.member) : null;
    const name = ref.member && defs.has(defId(b.file, `${b.imported}.${ref.member}`)) ? `${b.imported}.${ref.member}` : b.imported;
    return defs.has(defId(b.file, name)) ? defId(b.file, name) : null;
  };

  // ---- edges
  for (const mod of mods.values()) {
    const ranges = [...mod.defs, ...serverRoutes(mod).map((r) => ({ ...r, name: `ROUTE ${r.method} ${r.fullPath}` }))];
    for (const d of ranges) {
      const from = defId(mod.file, d.name);
      for (const ref of referencesIn(mod.code, d.start, d.end)) {
        const to = resolveRef(mod.file, ref);
        if (to) addEdge(from, to);
      }
      for (const ep of mod.endpointsIn(d.start, d.end)) {
        for (const s of server) if (s.method === ep.method && pathsMatch(s.path, ep.path)) addEdge(from, s.id, 'http');
      }
    }
    // top-level code outside any def / route
    const outside = (i) => !ranges.some((d) => i >= d.start && i < d.end);
    for (const ref of referencesIn(mod.code, 0, mod.code.length)) {
      if (!outside(ref.index)) continue;
      const to = resolveRef(mod.file, ref);
      if (to) addEdge(defId(mod.file, '<module>'), to);
    }
  }

  // ---- client routes + testids per file
  let router = null;
  for (const mod of mods.values()) {
    const resolveImport = (local) => {
      const b = bindings.get(mod.file).get(local);
      return b ? { file: b.file, name: b.imported } : mod.defs.find((d) => d.name === local) ? { file: mod.file, name: local } : null;
    };
    const routes = clientRoutes(mod, resolveImport);
    if (routes.length && (!router || routes.length > router.routes.length)) {
      router = { file: mod.file, routes: routes.map((r) => ({ ...r, viewDef: r.viewFile ? defId(r.viewFile, resolveImport(r.view).name) : null })) };
    }
  }
  const testids = Object.fromEntries([...mods.values()].map((m) => [m.file, [...new Set(m.testids.map((t) => t.id))].sort()]));

  return { appDir, mods, defs, edges, kinds, server, router, testids, bindings };
}

const pick = (d) => ({ name: d.name, file: d.file, start: d.start, end: d.end, line: d.line, exported: d.exported ?? false });

/** Reverse adjacency. */
function callers(graph) {
  const rev = new Map();
  for (const [from, tos] of graph.edges) for (const to of tos) {
    if (!rev.has(to)) rev.set(to, new Set());
    rev.get(to).add(from);
  }
  return rev;
}

/** BFS. Returns Map(id -> hop) and the traversed edge list. */
export function walk(graph, starts, { hops = 3, direction = 'forward' } = {}) {
  const adj = direction === 'forward' ? graph.edges : callers(graph);
  const seen = new Map(starts.filter((s) => graph.defs.has(s)).map((s) => [s, 0]));
  const used = [];
  let frontier = [...seen.keys()].sort();
  for (let h = 1; h <= hops && frontier.length; h += 1) {
    const next = [];
    for (const id of frontier) {
      for (const to of [...(adj.get(id) ?? [])].sort()) {
        const e = direction === 'forward' ? [id, to] : [to, id];
        used.push(e);
        if (!seen.has(to)) { seen.set(to, h); next.push(to); }
      }
    }
    frontier = next.sort();
  }
  const uniq = [...new Map(used.map((e) => [`${e[0]}->${e[1]}`, e])).values()].sort((a, b) => `${a}`.localeCompare(`${b}`));
  return { reached: seen, edges: uniq };
}

/**
 * Which nested handler functions does the element with `testid` fire? (`onclick: () => { pay(); }`)
 * Returns graph def ids reached through those handlers (e.g. api.js#api.refill).
 */
export function handlerTargets(graph, file, testid) {
  const mod = graph.mods.get(file);
  if (!mod) return [];
  const hit = mod.testids.find((t) => testidMatches(t.id, testid));
  if (!hit) return [];
  // enclosing call `(` of the element's attribute object
  let depth = 0;
  let open = -1;
  for (let i = hit.at - 1; i >= 0; i -= 1) {
    const c = mod.code[i];
    if (c === ')' || c === ']' || c === '}') depth += 1;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth === 0 && c === '(') { open = i; break; }
      if (depth > 0) depth -= 1;
    }
  }
  if (open < 0) return [];
  let close = open;
  for (let d = 0, i = open; i < mod.code.length; i += 1) {
    const c = mod.code[i];
    if (c === '(' || c === '[' || c === '{') d += 1;
    else if (c === ')' || c === ']' || c === '}') { d -= 1; if (d === 0) { close = i + 1; break; } }
  }
  const out = new Set();
  const visit = (start, end, guard) => {
    for (const ref of referencesIn(mod.code, start, end)) {
      const inner = mod.nested.find((n) => n.name === ref.name);
      if (inner && !guard.has(inner.name)) {
        guard.add(inner.name);
        visit(inner.start, inner.end, guard);
        continue;
      }
      const b = graph.bindings.get(file).get(ref.name);
      if (b) {
        const name = ref.member && graph.defs.has(defId(b.file, `${b.imported}.${ref.member}`)) ? `${b.imported}.${ref.member}` : b.imported;
        if (graph.defs.has(defId(b.file, name))) out.add(defId(b.file, name));
      }
    }
  };
  visit(open, close, new Set());
  return [...out].sort();
}

/** Replay -> touchpoints [{action, route, pattern, testid, component, view, viewDef}]. */
export function touchpointsFromReplay(graph, replay) {
  const routes = graph.router?.routes ?? [];
  const out = [];
  const startRoute = matchClientRoute(routes, replay?.startRoute);
  const actions = Array.isArray(replay?.actions) ? replay.actions : [];
  for (const a of actions) {
    const r = matchClientRoute(routes, a.route || replay?.startRoute);
    const viewFile = r?.viewFile ?? null;
    out.push({
      action: a.type || 'action',
      route: a.route || replay?.startRoute || null,
      pattern: r?.pattern ?? null,
      testid: a.testid || null,
      component: a.testid ? componentFor(a.testid, viewFile ? graph.testids[viewFile] : []) : null,
      view: viewFile,
      viewDef: r?.viewDef ?? null,
    });
  }
  if (!out.length && startRoute) {
    out.push({ action: 'visit', route: replay.startRoute, pattern: startRoute.pattern, testid: null, component: null, view: startRoute.viewFile, viewDef: startRoute.viewDef });
  }
  return out;
}

/** Map changed files (app-relative, optional `#fn`) to def ids. */
export function changedDefs(graph, files) {
  const out = new Set();
  const unknown = [];
  for (const raw of files) {
    const [file, fn] = raw.split('#');
    if (!graph.mods.has(file)) { unknown.push(raw); continue; }
    const mod = graph.mods.get(file);
    const names = fn ? [fn] : [...mod.defs.map((d) => d.name), ...[...graph.defs.values()].filter((d) => d.file === file && d.kind === 'route').map((d) => d.name)];
    for (const n of names) if (graph.defs.has(defId(file, n))) out.add(defId(file, n));
    if (!fn && !names.length) out.add(defId(file, '<module>'));
  }
  return { defs: [...out].sort(), unknown };
}

export function loadGraph(appDir) {
  if (!existsSync(appDir)) throw new Error(`app folder not found: ${appDir}`);
  return buildGraph(appDir);
}
