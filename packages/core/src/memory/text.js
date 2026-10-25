// Deterministic text + set similarity for the Medical Record (no vector DB, no dependencies).
//   tokenize()      lower-case word tokens; camelCase split; tiny stop list; plural "s" folded
//   tfidfCosine()   cosine between two token lists, IDF from a small corpus (smoothed)
//   jaccard()       |A n B| / |A u B|
//   overlap()       |A n B| / min(|A|, |B|)
//   normalizeRoute  /bill/7/settle -> /bill/:id/settle
//   normalizeTestid bill-row-7 -> bill-row-n

const STOP = new Set(
  ('a an and are as at be but by can do does for from has have in into is it its of on or so that the then this to ' +
    'was were when where which while with not no yes after before still just only also than too very get got ' +
    'none null undefined true false').split(' '),
);

/** Split camelCase / PascalCase words: roundMoney -> round Money. */
const splitCamel = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

/** Fold a trailing plural "s" (bills -> bill) but keep short words and "ss" (class). */
const fold = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

export function tokenize(text) {
  const raw = String(text ?? '');
  const out = [];
  // Whole identifiers first (roundmoney), then their camelCase parts (round, money).
  for (const word of raw.split(/[^A-Za-z0-9]+/)) {
    if (!word) continue;
    const parts = splitCamel(word).split(/\s+/);
    const whole = word.toLowerCase();
    if (parts.length > 1 && whole.length > 2 && !/^\d+$/.test(whole)) out.push(fold(whole));
    for (const p of parts) {
      const w = p.toLowerCase();
      if (w.length < 2 || /^\d+$/.test(w) || STOP.has(w)) continue;
      out.push(fold(w));
    }
  }
  return out;
}

/** Term frequencies of a token list. */
export function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/** Smoothed IDF over a corpus of token lists: ln((N + 1) / (df + 1)) + 1. */
export function idfOf(corpus) {
  const df = new Map();
  for (const doc of corpus) for (const t of new Set(doc)) df.set(t, (df.get(t) || 0) + 1);
  const n = corpus.length;
  return (t) => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1;
}

/** TF-IDF vector (Map term -> weight). */
export function tfidf(tokens, idf) {
  const v = new Map();
  for (const [t, f] of termFreq(tokens)) v.set(t, f * idf(t));
  return v;
}

/** Cosine similarity of two sparse vectors; also returns the top shared terms by contribution. */
export function cosine(a, b, topN = 3) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const shared = [];
  for (const [t, w] of a) {
    na += w * w;
    const wb = b.get(t);
    if (wb) {
      dot += w * wb;
      shared.push([t, w * wb]);
    }
  }
  for (const w of b.values()) nb += w * w;
  const score = na && nb ? dot / Math.sqrt(na * nb) : 0;
  shared.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  return { score, terms: shared.slice(0, topN).map(([t]) => t) };
}

export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function overlap(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

export const intersect = (a, b) => {
  const B = new Set(b);
  return [...new Set(a)].filter((x) => B.has(x));
};

/** /bill/7/settle?x=1 -> /bill/:id/settle. Numeric, hex-ish and rid segments become :id. */
export function normalizeRoute(route) {
  if (route === undefined || route === null || route === '') return '';
  let r = String(route).trim();
  try {
    if (/^https?:\/\//i.test(r)) r = new URL(r).pathname;
  } catch { /* keep as is */ }
  r = r.split(/[?#]/)[0];
  const segs = r.split('/').filter(Boolean).map((s) => {
    if (s.startsWith(':')) return ':id';
    if (/^\d+$/.test(s) || /^r_\d{8}_[0-9a-f]{6}$/i.test(s) || /^[0-9a-f]{8,}$/i.test(s) || /^[0-9a-f-]{32,36}$/i.test(s)) return ':id';
    return s.toLowerCase();
  });
  return `/${segs.join('/')}`;
}

/** Route similarity: 1 same, 0.6 one is a prefix of the other, 0.3 same first segment, else 0. */
export function routeSimilarity(a, b) {
  const x = normalizeRoute(a);
  const y = normalizeRoute(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const xs = x.split('/').filter(Boolean);
  const ys = y.split('/').filter(Boolean);
  const n = Math.min(xs.length, ys.length);
  if (n > 0 && xs.slice(0, n).join('/') === ys.slice(0, n).join('/')) return 0.6;
  if (xs[0] && xs[0] === ys[0]) return 0.3;
  return 0;
}

/** bill-row-7 -> bill-row-n, person-input-2 -> person-input-n. Names (pay-Asha-btn) are kept. */
export function normalizeTestid(t) {
  return String(t ?? '').trim().replace(/-\d+(?=-|$)/g, '-n');
}

export const basename = (p) => String(p ?? '').split(/[\\/]/).pop();

/** Path normalisation for file comparisons: forward slashes, no leading ./, no :line suffix. */
export function normalizePath(p) {
  return String(p ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/:\d+(:\d+)?$/, '');
}

export function median(nums) {
  const a = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export const round2 = (n) => Math.round(n * 100) / 100;
