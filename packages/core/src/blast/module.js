// Per-file facts for the blast-radius graph: imports, top-level definitions (functions, arrow
// consts, object-literal methods), nested functions, Express routes, client API calls and testids.
import { depthMap, expressionEnd, lineAt, mask, matchClose, stringAt, stringsIn } from './source.js';

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'async', 'new', 'const', 'let', 'var',
  'import', 'export', 'from', 'default', 'class', 'extends', 'super', 'this', 'true', 'false', 'null', 'undefined', 'else',
  'try', 'finally', 'throw', 'case', 'break', 'continue', 'do', 'in', 'of', 'instanceof', 'void', 'delete', 'yield', 'static',
]);
const HTTP = ['get', 'post', 'put', 'patch', 'delete', 'all'];

/** Body range of a function whose parameter list opens at `paren` (masked code). */
function functionBody(code, paren) {
  const afterParams = matchClose(code, paren);
  if (afterParams < 0) return null;
  let k = afterParams;
  while (k < code.length && /\s/.test(code[k])) k += 1;
  if (code.startsWith('=>', k)) {
    k += 2;
    while (k < code.length && /\s/.test(code[k])) k += 1;
  }
  if (code[k] === '{') {
    const end = matchClose(code, k);
    return end < 0 ? null : { start: k, end };
  }
  return { start: k, end: expressionEnd(code, k) };
}

/** Arrow / function expression right after `=` or `:` at index `k`: returns body range. */
function valueFunctionBody(code, k) {
  const rest = code.slice(k);
  const m = /^\s*(?:async\s+)?(?:function\b\s*\*?\s*[\w$]*\s*(?=\()|(?=\())/.exec(rest);
  if (m) {
    const paren = k + m[0].length;
    if (code[paren] !== '(') return null;
    const afterParams = matchClose(code, paren);
    if (afterParams < 0) return null;
    const tail = code.slice(afterParams);
    if (!/^\s*(=>|\{)/.test(tail) && !/function/.test(m[0])) return null; // a call, not a function
    return functionBody(code, paren);
  }
  const single = /^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*=>\s*/.exec(rest);
  if (single) {
    const start = k + single[0].length;
    if (code[start] === '{') {
      const end = matchClose(code, start);
      return end < 0 ? null : { start, end };
    }
    return { start, end: expressionEnd(code, start) };
  }
  return null;
}

/**
 * @param {string} src file contents
 * @param {string} file path relative to the app root, forward slashes
 */
export function parseModule(src, file) {
  const { code, strings, regexes } = mask(src);
  const depth = depthMap(code);
  const imports = [];
  const defs = [];
  const nested = [];
  const routes = [];
  const routers = { app: new Set(), router: new Set(), mounts: [] };

  // ---- imports
  for (const m of code.matchAll(/\bimport\s+([^;'"`]*?)\s*from\s*(?=['"])/g)) {
    const lit = stringAt(strings, m.index + m[0].length);
    if (!lit) continue;
    const clause = m[1].trim();
    const bindings = [];
    const ns = /\*\s*as\s+([\w$]+)/.exec(clause);
    if (ns) bindings.push({ local: ns[1], imported: '*' });
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) {
      for (const part of named[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const [imported, local] = part.split(/\s+as\s+/).map((s) => s.trim());
        bindings.push({ local: local || imported, imported });
      }
    }
    const def = /^([\w$]+)\s*(?:,|$)/.exec(clause);
    if (def) bindings.push({ local: def[1], imported: 'default' });
    imports.push({ from: lit.value, bindings });
  }

  const addDef = (list, name, kind, range, at, extra = {}) => {
    if (!range) return;
    list.push({ name, kind, file, start: range.start, end: range.end, line: lineAt(src, at), depth: depth[at], ...extra });
  };

  // ---- function declarations (any depth; depth 0 = graph node, deeper = nested helper)
  for (const m of code.matchAll(/\b(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    const range = functionBody(code, m.index + m[0].length - 1);
    const target = depth[m.index] === 0 ? defs : nested;
    addDef(target, m[2], 'function', range, m.index, { exported: Boolean(m[1]) });
  }

  // ---- const x = (...) => / function / object literal
  for (const m of code.matchAll(/\b(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    const at = m.index + m[0].length;
    const exported = Boolean(m[1]);
    const top = depth[m.index] === 0;
    const range = valueFunctionBody(code, at);
    if (range) {
      addDef(top ? defs : nested, m[2], 'function', range, m.index, { exported });
      continue;
    }
    if (top && code[at] === '{') {
      const end = matchClose(code, at);
      if (end < 0) continue;
      // object literal: methods become `obj.key` definitions
      const inner = code.slice(at + 1, end - 1);
      const base = at + 1;
      const memberRe = /(^|[,{\n])\s*([A-Za-z_$][\w$]*)\s*(:\s*|(?=\())/g;
      for (const mm of inner.matchAll(memberRe)) {
        const keyIdx = base + mm.index + mm[1].length;
        if (depth[keyIdx] !== 1) continue;
        const after = base + mm.index + mm[0].length;
        const r = mm[3].startsWith(':') ? valueFunctionBody(code, after) : functionBody(code, after);
        if (r) addDef(defs, `${m[2]}.${mm[2]}`, 'method', r, keyIdx, { exported, object: m[2] });
      }
    }
  }

  // ---- express: const app = express(); const api = express.Router(); app.use('/api', api)
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*express\s*\(\s*\)/g)) routers.app.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:express\s*\.\s*)?Router\s*\(\s*\)/g)) routers.router.add(m[1]);
  const isRouterVar = (v) => routers.app.has(v) || routers.router.has(v);
  for (const m of code.matchAll(/\b([\w$]+)\s*\.\s*use\s*\(\s*(?=['"`])/g)) {
    if (!isRouterVar(m[1])) continue;
    const lit = stringAt(strings, m.index + m[0].length);
    const rest = code.slice(lit.end, lit.end + 80);
    const target = /^\s*,\s*([\w$]+)\s*\)/.exec(rest);
    if (target && routers.router.has(target[1])) routers.mounts.push({ parent: m[1], prefix: lit.value, router: target[1] });
  }
  for (const m of code.matchAll(new RegExp(`\\b([\\w$]+)\\s*\\.\\s*(${HTTP.join('|')})\\s*\\(\\s*(?=['"\`])`, 'g'))) {
    if (!isRouterVar(m[1])) continue;
    const lit = stringAt(strings, m.index + m[0].length);
    const paren = code.indexOf('(', m.index + m[1].length);
    const end = matchClose(code, paren);
    if (!lit || end < 0) continue;
    routes.push({ router: m[1], method: m[2].toUpperCase(), path: lit.value, start: lit.end, end, line: lineAt(src, m.index) });
  }

  // ---- client API calls: request('POST', `/api/x/${id}`) or fetch('/api/x')
  const endpointsIn = (start, end) => {
    const lits = stringsIn(strings, start, end);
    const found = [];
    for (let k = 0; k < lits.length; k += 1) {
      const s = lits[k];
      if (!s.value.startsWith('/api/') && s.value !== '/api') continue;
      const prev = lits[k - 1];
      const between = prev ? code.slice(prev.end, s.start) : '';
      const method = prev && /^(GET|POST|PUT|PATCH|DELETE)$/.test(prev.value) && /^\s*,\s*$/.test(between) ? prev.value : 'GET';
      found.push({ method, path: s.value.replace(/\?.*$/, '').replace(/\*/g, ':param') });
    }
    return found;
  };

  // ---- testids rendered: testid: 'x' / 'data-testid': 'x' / data-testid="x"
  const testids = [];
  for (const m of code.matchAll(/(?:\btestid|['"]data-testid['"])\s*:\s*(?=['"`])/g)) {
    const lit = stringAt(strings, m.index + m[0].length);
    if (lit) testids.push({ id: lit.value, at: lit.start });
  }
  for (const s of strings) {
    for (const mm of s.value.matchAll(/data-testid="([^"]+)"/g)) testids.push({ id: mm[1], at: s.start });
  }

  return { file, src, code, strings, regexes, imports, defs, nested, routes, routers, testids, endpointsIn };
}

/** Identifier references in masked code range: [{name, member, index}] (member = `x.y` second part). */
export function referencesIn(code, start, end) {
  const refs = [];
  const re = /(?<![\w$.])([A-Za-z_$][\w$]*)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(code)) && m.index < end) {
    if (KEYWORDS.has(m[1])) continue;
    // skip object keys `{ name: ...`
    const before = code.slice(Math.max(0, m.index - 40), m.index).trimEnd();
    const after = code.slice(m.index + m[0].length).trimStart();
    if (!m[2] && after.startsWith(':') && /[{,]$/.test(before)) continue;
    refs.push({ name: m[1], member: m[2] || null, index: m.index });
  }
  return refs;
}
