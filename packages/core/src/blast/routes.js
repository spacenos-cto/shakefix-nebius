// Route extraction for the blast-radius report.
//   client routes: the SPA router's `routes` array (apps/carerx/src/main.js): pattern -> view module
//   server routes: Express `app|router.get/post/put/patch/delete(path, ...)`, with `app.use(prefix, router)`
//   testids:       which data-testid values each view module renders
import { parseModule } from './module.js';
import { matchClose, pathsMatch } from './source.js';

/** `^\/rx\/(?<id>[^/]+)\/refill$` -> `/rx/:id/refill`. */
export function regexToPattern(body) {
  let p = body.replace(/^\^/, '').replace(/\$$/, '');
  p = p.replace(/\(\?<([\w$]+)>[^)]*\)/g, ':$1');
  p = p.replace(/\((?!\?)[^)]*\)/g, ':param');
  p = p.replace(/\\\//g, '/').replace(/\\(.)/g, '$1');
  return p || '/';
}

/** Client routes from the router module. Returns [{pattern, regex, view, viewFile, title, line}]. */
export function clientRoutes(mod, resolveImport) {
  const out = [];
  const m = /\b(?:const|let|var)\s+routes\s*=\s*\[/.exec(mod.code);
  if (!m) return out;
  const open = m.index + m[0].length - 1;
  const end = matchClose(mod.code, open);
  if (end < 0) return out;
  // each `{ ... }` entry at depth 1 of the array
  let k = open + 1;
  while (k < end) {
    const brace = mod.code.indexOf('{', k);
    if (brace < 0 || brace >= end) break;
    const close = matchClose(mod.code, brace);
    if (close < 0) break;
    const entry = mod.code.slice(brace, close);
    const rx = mod.regexes.find((r) => r.start > brace && r.end <= close);
    const pathLit = /\b(?:path|pattern)\s*:\s*(?=['"`])/.exec(entry);
    let pattern = null;
    let regex = null;
    if (rx) {
      pattern = regexToPattern(rx.body);
      try { regex = new RegExp(rx.body, rx.flags); } catch { regex = null; }
    } else if (pathLit) {
      const lit = mod.strings.find((s) => s.start === brace + pathLit.index + pathLit[0].length);
      if (lit) pattern = lit.value;
    }
    const view = /\b(?:view|component|render)\s*:\s*([\w$]+)/.exec(entry)?.[1] ?? null;
    const titleAt = /\btitle\s*:\s*(?=['"`])/.exec(entry);
    const title = titleAt ? mod.strings.find((s) => s.start === brace + titleAt.index + titleAt[0].length)?.value ?? null : null;
    if (pattern) {
      const imp = view ? resolveImport(view) : null;
      out.push({ pattern, regex, view, viewFile: imp?.file ?? null, title, line: lineOf(mod.src, brace) });
    }
    k = close;
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/** Server routes for one module, with router mount prefixes applied. */
export function serverRoutes(mod) {
  const prefix = (router) => {
    if (mod.routers.app.has(router)) return '';
    const mount = mod.routers.mounts.find((x) => x.router === router);
    return mount ? joinPath(prefix(mount.parent), mount.prefix) : '';
  };
  return mod.routes
    .filter((r) => r.path.startsWith('/'))
    .map((r) => ({ ...r, fullPath: joinPath(prefix(r.router), r.path), file: mod.file }));
}

function joinPath(a, b) {
  const s = `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`;
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

/** Concrete path or pattern -> matching client route. */
export function matchClientRoute(routes, path) {
  if (!path) return null;
  const clean = String(path).replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  return routes.find((r) => r.pattern === clean)
    ?? routes.find((r) => r.regex && r.regex.test(clean))
    ?? routes.find((r) => pathsMatch(r.pattern, clean))
    ?? null;
}

/** testid pattern ('rx-row-*') matches a concrete testid ('rx-row-3')? */
export function testidMatches(pattern, id) {
  if (!pattern.includes('*')) return pattern === id;
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
  return re.test(id);
}

/** Component name for insights: `rx-row-3` rendered from `rx-row-*` -> `rx-row`. */
export function componentFor(testid, renderedPatterns = []) {
  if (!testid) return null;
  const hit = renderedPatterns.find((p) => p.includes('*') && testidMatches(p, testid));
  return hit ? hit.replace(/[-_]?\*.*$/, '') : testid;
}

export { parseModule };
