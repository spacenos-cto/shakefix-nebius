// Pure behavior diff (§11.3). Input: two normalized captures of the same flow.
//
// Capture shape (written by capture.js, see raw/<flow>/<side>/capture.json):
// { flow, side, error: string|null,
//   steps: [ { i, route, texts: {testid: text}, screenshot?: string,
//              api: [{method, path, status, body}], db: [{op, table, fields}] } ] }

import { HIDDEN, ABSENT, NONE, joinPath, stableStringify } from './normalize.js';

const CHANNEL_ORDER = { screen: 0, api: 1, db: 2 };

/** Recursive JSON diff by path. Returns [{path, before, after}] in deterministic order. */
export function jsonDiff(a, b, path = '$') {
  if (stableStringify(a) === stableStringify(b)) return [];
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const p = joinPath(path, i);
      if (i >= a.length) out.push({ path: p, before: ABSENT, after: b[i] });
      else if (i >= b.length) out.push({ path: p, before: a[i], after: ABSENT });
      else out.push(...jsonDiff(a[i], b[i], p));
    }
    return out;
  }
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const out = [];
    for (const k of keys) {
      const p = joinPath(path, k);
      if (!(k in a)) out.push({ path: p, before: ABSENT, after: b[k] });
      else if (!(k in b)) out.push({ path: p, before: a[k], after: ABSENT });
      else out.push(...jsonDiff(a[k], b[k], p));
    }
    return out;
  }
  return [{ path, before: a, after: b }];
}

/** Group entries by key, keeping per-key occurrence index (#0, #1, ...) in arrival order. */
function indexByKey(entries, keyFn) {
  const map = new Map();
  for (const e of entries) {
    const k = keyFn(e);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

function flatten(steps, field) {
  const out = [];
  for (const s of steps || []) for (const e of s[field] || []) out.push({ ...e, _step: s.i, _route: s.route });
  return out;
}

/** Screen channel: per step, per testid text diff; pixel diff only for visual-only steps. */
export function diffScreens(base, head, pixel = {}) {
  const out = [];
  const bs = base.steps || [];
  const hs = head.steps || [];
  const n = Math.max(bs.length, hs.length);
  for (let i = 0; i < n; i++) {
    const b = bs[i];
    const h = hs[i];
    const route = h?.route ?? b?.route ?? '/';
    const bt = b?.texts || {};
    const ht = h?.texts || {};
    const ids = [...new Set([...Object.keys(bt), ...Object.keys(ht)])].sort();
    let textChanged = false;
    for (const testid of ids) {
      const before = testid in bt ? bt[testid] : HIDDEN;
      const after = testid in ht ? ht[testid] : HIDDEN;
      if (before === after) continue;
      textChanged = true;
      out.push({
        channel: 'screen', where: `${route} · ${testid}`, before, after,
        ctx: { kind: 'text', step: i, route, testid, shots: shots(b, h) },
      });
    }
    if (!b || !h) {
      if (!textChanged) {
        out.push({
          channel: 'screen', where: `${route} · (step ${i + 1})`,
          before: b ? 'step ran' : '(missing step)', after: h ? 'step ran' : '(missing step)',
          ctx: { kind: 'step', step: i, route, shots: shots(b, h) },
        });
      }
      continue;
    }
    const px = Number(pixel[i] || 0);
    if (!textChanged && px > 0) {
      out.push({
        channel: 'screen', where: `${route} · (visual)`, before: 'baseline', after: `visual change (${px} px)`,
        ctx: { kind: 'visual', step: i, route, pixels: px, shots: shots(b, h) },
      });
    }
  }
  return out;
}

function shots(b, h) {
  return { before: b?.screenshot ?? null, after: h?.screenshot ?? null };
}

/** API channel: flow-level match by `METHOD path` + occurrence index (tolerates step slippage). */
export function diffApi(base, head) {
  const out = [];
  const key = (e) => `${e.method} ${e.path}`;
  const bm = indexByKey(flatten(base.steps, 'api'), key);
  const hm = indexByKey(flatten(head.steps, 'api'), key);
  const keys = [...new Set([...bm.keys(), ...hm.keys()])].sort();
  for (const k of keys) {
    const bl = bm.get(k) || [];
    const hl = hm.get(k) || [];
    if (!bl.length || !hl.length) {
      const e = (hl[0] || bl[0]);
      out.push({
        channel: 'api', where: k,
        before: bl.length ? `${bl[0].status} (called ×${bl.length})` : NONE,
        after: hl.length ? `${hl[0].status} (called ×${hl.length})` : NONE,
        ctx: { kind: hl.length ? 'endpoint-added' : 'endpoint-removed', step: e._step, route: e._route, endpoint: k },
      });
      continue;
    }
    const n = Math.max(bl.length, hl.length);
    for (let j = 0; j < n; j++) {
      const b = bl[j];
      const h = hl[j];
      const at = h || b;
      const ctx = { step: at._step, route: at._route, endpoint: k };
      if (!b || !h) {
        out.push({
          channel: 'api', where: `${k} · calls`, before: bl.length, after: hl.length,
          ctx: { ...ctx, kind: 'call-count' },
        });
        break;
      }
      if (b.status !== h.status) {
        out.push({ channel: 'api', where: `${k} · status`, before: b.status, after: h.status, ctx: { ...ctx, kind: 'status' } });
      }
      for (const d of jsonDiff(b.body, h.body)) {
        out.push({ channel: 'api', where: `${k} · ${d.path}`, before: d.before, after: d.after, ctx: { ...ctx, kind: 'body', path: d.path } });
      }
    }
  }
  return out;
}

/** DB channel: flow-level match by `op table` + occurrence; field-level diffs. */
export function diffDb(base, head) {
  const out = [];
  const key = (e) => `${e.op} ${e.table}`;
  const bm = indexByKey(flatten(base.steps, 'db'), key);
  const hm = indexByKey(flatten(head.steps, 'db'), key);
  const keys = [...new Set([...bm.keys(), ...hm.keys()])].sort();
  for (const k of keys) {
    const bl = bm.get(k) || [];
    const hl = hm.get(k) || [];
    const n = Math.max(bl.length, hl.length);
    for (let j = 0; j < n; j++) {
      const b = bl[j];
      const h = hl[j];
      const at = h || b;
      const ctx = { step: at._step, route: at._route, table: at.table, op: at.op };
      if (!b || !h) {
        out.push({
          channel: 'db', where: k,
          before: b ? b.fields : NONE, after: h ? h.fields : NONE,
          ctx: { ...ctx, kind: h ? 'op-added' : 'op-removed' },
        });
        continue;
      }
      const fields = [...new Set([...Object.keys(b.fields || {}), ...Object.keys(h.fields || {})])].sort();
      for (const f of fields) {
        const bv = f in (b.fields || {}) ? b.fields[f] : ABSENT;
        const hv = f in (h.fields || {}) ? h.fields[f] : ABSENT;
        if (stableStringify(bv) === stableStringify(hv)) continue;
        out.push({ channel: 'db', where: `${k} · ${f}`, before: bv, after: hv, ctx: { ...ctx, kind: 'field', field: f } });
      }
    }
  }
  return out;
}

/** Flow errors: one side failed to complete the flow. */
export function diffErrors(base, head) {
  const be = base.error || null;
  const he = head.error || null;
  if (be === he) return [];
  const steps = head.steps || [];
  const route = steps.length ? steps[steps.length - 1].route : '/';
  return [{
    channel: 'screen', where: `${route} · (flow error)`,
    before: be ? `error: ${be}` : 'completed', after: he ? `error: ${he}` : 'completed',
    ctx: { kind: 'flow-error', step: Math.max(0, steps.length - 1), route },
  }];
}

function dedupKey(c) {
  return `${c.channel}|${c.where}|${stableStringify(c.before)}|${stableStringify(c.after)}`;
}

/** Sort + dedup the changes for one flow. Deterministic. */
export function orderChanges(changes) {
  const sorted = [...changes].sort((a, b) =>
    (a.ctx?.step ?? 0) - (b.ctx?.step ?? 0) ||
    CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel] ||
    (a.where < b.where ? -1 : a.where > b.where ? 1 : 0) ||
    (dedupKey(a) < dedupKey(b) ? -1 : dedupKey(a) > dedupKey(b) ? 1 : 0));
  const seen = new Set();
  const visualSeen = new Set();
  const out = [];
  for (const c of sorted) {
    // A visual-only change is reported once per route; a text change once per where+before+after.
    const k = c.ctx?.kind === 'visual' ? `visual|${c.where}` : dedupKey(c);
    const set = c.ctx?.kind === 'visual' ? visualSeen : seen;
    if (set.has(k)) continue;
    set.add(k);
    out.push(c);
  }
  return out;
}

/** Diff one flow (base vs head captures). `pixel` maps step index -> differing pixel count. */
export function diffFlow(base, head, { pixel = {} } = {}) {
  return orderChanges([
    ...diffErrors(base, head),
    ...diffScreens(base, head, pixel),
    ...diffApi(base, head),
    ...diffDb(base, head),
  ]);
}

const changeKey = (c) => `${c.channel}|${c.where}|${JSON.stringify(c.before)}|${JSON.stringify(c.after)}`;

/**
 * Split a flow's changes into those that repeat in a second base/head run (stable) and those that
 * don't (flaky: app timing, not the fix). Pixel-only rows are judged by channel+where.
 */
export function splitStable(first, second) {
  const again = new Set((second ?? []).map(changeKey));
  const stable = [];
  const flaky = [];
  for (const c of first ?? []) {
    // Visual-only rows need the pixel pass, which the recheck skips: keep them, never drop silently.
    const seen = c.ctx?.kind === 'visual' || again.has(changeKey(c));
    (seen ? stable : flaky).push(c);
  }
  return { stable, flaky };
}

/**
 * Build a shakefix.proof/v1 document from per-flow diffs.
 * flows: [{flow, source, changes, routes?, testids?}] in desired order.
 * Assigns stable ids c1..cn across all flows in order.
 */
export function buildProof({ mr = null, base = '', head = '', rid, flows }) {
  let n = 0;
  const outFlows = flows.map((f) => {
    const entry = {
      flow: f.flow,
      changes: f.changes.map((c) => ({ id: `c${++n}`, channel: c.channel, where: c.where, before: c.before, after: c.after, ctx: c.ctx })),
    };
    if (f.source) entry.source = f.source;
    if (f.routes) entry.routes = f.routes;
    if (f.testids) entry.testids = f.testids;
    if (f.reproduction) entry.reproduction = f.reproduction;
    if (f.flaky?.length) entry.flaky = f.flaky.map((c) => ({ channel: c.channel, where: c.where, before: c.before, after: c.after }));
    return entry;
  });
  const doc = { schema: 'shakefix.proof/v1', mr: mr ?? null, base: String(base ?? ''), head: String(head ?? '') };
  if (rid) doc.rid = rid;
  doc.flows = outFlows;
  doc.summary = { changes: n };
  const flaky = outFlows.reduce((k, f) => k + (f.flaky?.length ?? 0), 0);
  if (flaky) doc.summary.flaky = flaky;
  return doc;
}

/** All changes across flows, with their flow name attached (non-mutating). */
export function allChanges(proof) {
  const out = [];
  for (const f of proof.flows || []) for (const c of f.changes || []) out.push({ ...c, flow: f.flow });
  return out;
}
