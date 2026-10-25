// Tiny JS source scanner for the blast-radius graph (no parser dependency).
//
// mask(src) returns a copy of the source with comments, string/template text and regex bodies
// blanked out (same length, newlines kept), plus the literals it found. On masked code, brace
// matching and identifier regexes are safe: a "{" inside a string can no longer confuse them.
// Good enough for the vanilla ESM that CareRx is written in; not a general JS parser.

const REGEX_PREV_CHARS = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_PREV_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'else', 'do']);

/**
 * @param {string} src
 * @returns {{ code: string, strings: Array<{start:number,end:number,value:string,quote:string}>,
 *             regexes: Array<{start:number,end:number,body:string,flags:string}> }}
 */
export function mask(src) {
  const out = src.split('');
  const strings = [];
  const regexes = [];
  const blank = (i) => { if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' '; };
  let i = 0;
  let braceDepth = 0;
  const tplStack = []; // { depth, rec } for each open `${`
  let lastSig = '';
  let lastWord = '';

  const readTemplate = (start) => {
    // i points just after the opening backtick (or after the `}` closing an expression).
    const rec = start;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { blank(i); blank(i + 1); rec.value += src[i + 1] ?? ''; i += 2; continue; }
      if (c === '`') { rec.end = i + 1; i += 1; return 'closed'; }
      if (c === '$' && src[i + 1] === '{') {
        rec.value += '*';
        i += 2;
        braceDepth += 1;
        tplStack.push({ depth: braceDepth, rec });
        return 'expr';
      }
      rec.value += c;
      blank(i);
      i += 1;
    }
    rec.end = src.length;
    return 'closed';
  };

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { blank(i); i += 1; }
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i += 1) blank(i);
      continue;
    }
    if (c === '\'' || c === '"') {
      const start = i;
      let value = '';
      i += 1;
      while (i < src.length && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { value += src[i + 1] ?? ''; blank(i); blank(i + 1); i += 2; continue; }
        value += src[i];
        blank(i);
        i += 1;
      }
      i += 1;
      strings.push({ start, end: i, value, quote: c });
      lastSig = c;
      lastWord = '';
      continue;
    }
    if (c === '`') {
      const rec = { start: i, end: -1, value: '', quote: '`' };
      strings.push(rec);
      i += 1;
      readTemplate(rec);
      lastSig = '`';
      lastWord = '';
      continue;
    }
    if (c === '/' && (lastSig === '' || REGEX_PREV_CHARS.has(lastSig) || REGEX_PREV_WORDS.has(lastWord))) {
      const start = i;
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j += 1;
      }
      if (src[j] === '/') {
        const body = src.slice(start + 1, j);
        let k = j + 1;
        while (k < src.length && /[a-z]/i.test(src[k])) k += 1;
        for (let b = start + 1; b < j; b += 1) blank(b);
        regexes.push({ start, end: k, body, flags: src.slice(j + 1, k) });
        i = k;
        lastSig = '/';
        lastWord = '';
        continue;
      }
    }
    if (c === '{') braceDepth += 1;
    if (c === '}') {
      const top = tplStack[tplStack.length - 1];
      if (top && top.depth === braceDepth) {
        tplStack.pop();
        braceDepth -= 1;
        i += 1;
        readTemplate(top.rec);
        lastSig = '`';
        lastWord = '';
        continue;
      }
      braceDepth -= 1;
    }
    if (/[A-Za-z_$0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j += 1;
      lastWord = src.slice(i, j);
      lastSig = 'a';
      i = j;
      continue;
    }
    if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
    i += 1;
  }
  strings.sort((a, b) => a.start - b.start);
  return { code: out.join(''), strings, regexes };
}

const OPEN = { '(': ')', '[': ']', '{': '}' };

/** Index just after the bracket that closes the one at `open` (masked code). -1 if unbalanced. */
export function matchClose(code, open) {
  const stack = [];
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (OPEN[c]) stack.push(OPEN[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i + 1;
    }
  }
  return -1;
}

/** Brace depth ({} only) at each index of masked code. */
export function depthMap(code) {
  const depth = new Int32Array(code.length + 1);
  let d = 0;
  for (let i = 0; i < code.length; i += 1) {
    depth[i] = d;
    if (code[i] === '{') d += 1;
    else if (code[i] === '}') d -= 1;
  }
  depth[code.length] = d;
  return depth;
}

/** End of an arrow-function expression body starting at `start` (masked code). */
export function expressionEnd(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i;
      depth -= 1;
    } else if (depth === 0 && (c === ';' || c === ',')) return i;
    else if (depth === 0 && c === '\n') {
      const before = code.slice(start, i).trimEnd();
      const after = code.slice(i + 1).trimStart();
      const cont = /[=+\-*/%&|^!?:,.(<>]$/.test(before) || /^[.?:+\-*/%&|^)\]]/.test(after);
      if (!cont && before.length) return i;
    }
  }
  return code.length;
}

/** Line number (1-based) of index `idx` in `src`. */
export function lineAt(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i += 1) if (src[i] === '\n') line += 1;
  return line;
}

/** The string literal that starts exactly at `idx`, if any. */
export function stringAt(strings, idx) {
  let lo = 0;
  let hi = strings.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (strings[mid].start === idx) return strings[mid];
    if (strings[mid].start < idx) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** Literal strings fully inside [start, end). */
export function stringsIn(strings, start, end) {
  return strings.filter((s) => s.start >= start && s.end <= end);
}

/** Convert a template/route-ish path with `*` placeholders to `:param` style. */
export function starsToParams(path) {
  return path.replace(/\*/g, ':param');
}

/** Same route? `/api/prescriptions/:id` vs `/api/prescriptions/:param` vs `/api/prescriptions/42`. */
export function pathsMatch(a, b) {
  const sa = a.split('/').filter(Boolean);
  const sb = b.split('/').filter(Boolean);
  if (sa.length !== sb.length) return false;
  return sa.every((s, k) => s === sb[k] || s.startsWith(':') || sb[k].startsWith(':') || s === '*' || sb[k] === '*');
}
