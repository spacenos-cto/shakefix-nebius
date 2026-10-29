#!/usr/bin/env node
// Hosted live demo of ShakeFix's Second Opinion on NVIDIA Nemotron (Nebius Token Factory).
//
// One page, one button: the real double-charge case (packages/proof/test/fixtures/b1) goes through the
// same labelProof() the CI gate uses, with ONE live /chat/completions call to Nemotron per click.
//
// Spend is hard-capped: every live call first takes a slot from an atomic Firestore counter
// (nemotronLive/counter.calls); once it passes LIVE_CAP the page serves the latest live result
// instead of calling the model. Also: one call in flight at a time, one call per visitor per
// RATE_WINDOW_MS. Deploy with --max-instances 1.
//
// Env: MODEL_PROVIDER=openai-compatible, MODEL_BASE_URL, MODEL_NAME, MODEL_API_KEY (Secret Manager),
//      PROOF_MAX_TOKENS=8000, LIVE_CAP=30, STORE=firestore|memory, PORT.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProof, diffFlow, labelProof, labelerModelFromEnv, allChanges } from '../../packages/proof/src/index.js';
import { createModel } from '../../packages/core/src/model/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = process.env.FIXTURE_DIR || join(HERE, '..', '..', 'packages', 'proof', 'test', 'fixtures', 'b1');
const PAGE = readFileSync(process.env.PAGE_FILE || join(HERE, 'index.html'), 'utf8');
const CAP = Number(process.env.LIVE_CAP || 30);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 90_000);
const PORT = Number(process.env.PORT || 8080);

/** The real "naive fix" case: a double-charge fix that also drops a cent on an untouched bill. */
function fixtureCase() {
  const fx = (p) => JSON.parse(readFileSync(join(FIX, p), 'utf8'));
  const replay = fx('replay.json');
  const rb = fx('replay.base.json');
  const rh = fx('replay.head.json');
  const proof = buildProof({
    mr: 42, base: 'a1b2c3d', head: 'e4f5a6b', rid: replay.rid,
    flows: [
      { flow: 'change-tip', source: 'e2e', changes: diffFlow(fx('change-tip.base.json'), fx('change-tip.head.json')), routes: ['/bill/9'] },
      {
        flow: 'replay-r_20261011_8f3a2c', source: 'replay', changes: diffFlow(rb, rh),
        routes: [...new Set([...rb.steps, ...rh.steps].map((s) => s.route))].sort(),
        testids: ['confirm-settle-btn', 'save-bill-btn', 'settle-btn', 'settled-banner', 'total-input'],
      },
    ],
  });
  return { proof, issueText: readFileSync(join(FIX, 'issue.md'), 'utf8'), replays: [replay] };
}

const view = (proof) => allChanges(proof).map((c) => ({
  where: c.where || c.id, channel: c.channel, before: c.before, after: c.after, label: c.label, reason: c.reason, disputed: !!c.disputed,
}));

// ---------- store: atomic counter + latest live result ----------

function memoryStore() {
  let calls = 0;
  let last = null;
  return { name: 'memory', take: async () => ++calls, used: async () => calls, getLast: async () => last, setLast: async (r) => { last = r; } };
}

function firestoreStore() {
  const md = 'http://metadata.google.internal/computeMetadata/v1';
  let tok = { value: '', exp: 0 };
  let project = process.env.GOOGLE_CLOUD_PROJECT || '';
  const meta = async (path) => {
    const res = await fetch(`${md}/${path}`, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!res.ok) throw new Error(`metadata ${path} -> ${res.status}`);
    return res;
  };
  const auth = async () => {
    if (!project) project = await (await meta('project/project-id')).text();
    if (Date.now() < tok.exp) return tok.value;
    const t = await (await meta('instance/service-accounts/default/token')).json();
    tok = { value: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
    return tok.value;
  };
  const base = () => `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const docName = (id) => `projects/${project}/databases/(default)/documents/nemotronLive/${id}`;
  const call = async (method, url, body) => {
    const token = await auth();
    const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`firestore ${method} -> ${res.status} ${await res.text()}`);
    return res.json();
  };
  return {
    name: 'firestore',
    // Atomic server-side increment; the returned value is this call's slot number.
    async take() {
      await auth();
      const out = await call('POST', `${base()}:commit`, {
        writes: [{ transform: { document: docName('counter'), fieldTransforms: [{ fieldPath: 'calls', increment: { integerValue: '1' } }] } }],
      });
      return Number(out.writeResults[0].transformResults[0].integerValue);
    },
    async used() {
      await auth();
      const d = await call('GET', `${base()}/nemotronLive/counter`);
      return Number(d?.fields?.calls?.integerValue || 0);
    },
    async getLast() {
      await auth();
      const d = await call('GET', `${base()}/nemotronLive/last`);
      return d?.fields?.json?.stringValue ? JSON.parse(d.fields.json.stringValue) : null;
    },
    async setLast(r) {
      await auth();
      await call('PATCH', `${base()}/nemotronLive/last`, { fields: { json: { stringValue: JSON.stringify(r) } } });
    },
  };
}

const store = process.env.STORE === 'memory' ? memoryStore() : firestoreStore();

// ---------- the live call ----------

const llm = labelerModelFromEnv(process.env);
const MODEL = process.env.MODEL_NAME || '';
const rules = (() => {
  // Rules-only pass (no model): what the deterministic labeller says before Nemotron weighs in.
  const c = fixtureCase();
  return labelProof(c.proof, { issueText: c.issueText, replays: c.replays, llm: createModel({ provider: 'none' }) });
})();

let inFlight = null;
const lastByIp = new Map();

async function runLive() {
  const c = fixtureCase();
  const t0 = Date.now();
  const res = await labelProof(c.proof, { issueText: c.issueText, replays: c.replays, llm });
  return {
    at: new Date().toISOString(),
    ms: Date.now() - t0,
    model: MODEL,
    labeler: res.labeler,
    error: res.labeler === 'llm' ? undefined : res.error,
    summary: res.proof.summary,
    changes: view(res.proof),
  };
}

// ---------- http ----------

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, PAGE, 'text/html; charset=utf-8');
  // Not /healthz: Cloud Run's front end reserves that path.
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, store: store.name, model: MODEL, live: !!llm && llm.name !== 'none' });

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const r = await rules;
    const [used, last] = await Promise.all([store.used(), store.getLast()]);
    return send(res, 200, {
      cap: CAP, used: Math.min(used, CAP), remaining: Math.max(0, CAP - used), busy: !!inFlight, model: MODEL,
      rules: { summary: r.proof.summary, changes: view(r.proof) }, last,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    if (!llm || llm.name === 'none') return send(res, 503, { error: 'live model not configured' });
    if (inFlight) return send(res, 409, { error: 'Another visitor\'s live call is running. Try again in a few seconds.' });
    const ip = ipOf(req);
    const wait = (lastByIp.get(ip) || 0) + RATE_WINDOW_MS - Date.now();
    if (wait > 0) return send(res, 429, { error: `One live call per visitor every ${Math.round(RATE_WINDOW_MS / 1000)}s. Try again in ${Math.ceil(wait / 1000)}s.`, last: await store.getLast() });
    inFlight = (async () => {
      const slot = await store.take();
      if (slot > CAP) return { capped: true };
      lastByIp.set(ip, Date.now());
      const result = { ...(await runLive()), slot };
      if (result.labeler === 'llm') await store.setLast(result);
      return { result };
    })();
    try {
      const out = await inFlight;
      if (out.capped) return send(res, 429, { error: `All ${CAP} live calls for this demo are used. Showing the latest live result.`, capped: true, last: await store.getLast() });
      return send(res, 200, { ...out.result, cap: CAP, remaining: Math.max(0, CAP - out.result.slot) });
    } finally {
      inFlight = null;
    }
  }
  return send(res, 404, { error: 'not found' });
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
  });
}).listen(PORT, () => console.log(`nemotron-live on :${PORT} (store=${store.name}, cap=${CAP}, model=${MODEL || 'none'})`));
