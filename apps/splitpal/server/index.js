// SplitPal API + static server (Express, ESM, no build step).
//
//   node server/index.js                      -> serves dist/ (run `vite build` first)
//   node server/index.js --dev                -> Vite dev middleware (HMR), same origin API
//   node server/index.js --test-hooks         -> enables /api/__test/* and x-test-now
//   node server/index.js --port=8080
//
// Env equivalents: PORT, SHAKEFIX_TEST_HOOKS=1, NODE_ENV=development (dev mode),
// APP_VERSION (footer version), INTAKE_URL (rewrites the SDK data-endpoint at runtime),
// EVAL_BUG=E5,E7 (eval-only seeded bugs, evals/; unset = clean), DEMO_MODE=1 (labels the UI "DEMO REPLAY"
// and tells the SDK the intake replays a recorded run; docs/DEMO.md).
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sharesFor, grandTotal, isFullySettled } from '../src/lib/split.js';
import { tipAmount, isValidTip, isValidCustomTip } from '../src/lib/tip.js';
import { isValidCurrency } from '../src/lib/currency.js';
import { toCents, fromCents } from '../src/lib/money.js';
import { sessionStatus } from '../src/auth/session.js';
import { activeEvalBugs, evalBug } from '../src/evalBugs.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const distDir = join(root, 'dist');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const argValue = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const PORT = Number(argValue('port') || process.env.PORT || 8080);
const TEST_HOOKS = flag('test-hooks') || process.env.SHAKEFIX_TEST_HOOKS === '1';
const DEV = flag('dev') || process.env.NODE_ENV === 'development';
const APP_VERSION = process.env.APP_VERSION || '';
const INTAKE_URL = (process.env.INTAKE_URL || '').replace(/\/+$/, '');
const EVAL_BUGS = [...activeEvalBugs()];
const DEMO_MODE = process.env.DEMO_MODE === '1';

// ---------------------------------------------------------------- store

const seed = JSON.parse(readFileSync(join(here, 'seed.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

const store = { bills: [], session: null, nextId: 1, audit: [] };

function reseed() {
  store.bills = clone(seed.bills);
  store.nextId = Math.max(0, ...store.bills.map((b) => b.id)) + 1;
  store.session = clone(seed.session);
  // Outside test mode there is no fixed clock, so the demo session starts "now".
  if (!TEST_HOOKS) store.session.issuedAt = new Date().toISOString();
  store.audit = [];
}
reseed();

function audit(op, table, rowId, fields) {
  store.audit.push({ ts: Date.now(), op, table, rowId, fields: clone(fields) });
}

const round2 = (x) => fromCents(toCents(x));

/** Bill as returned by the API: stored fields + computed money. */
function present(bill) {
  return {
    ...bill,
    tip: tipAmount(bill.total, bill.tipPct),
    grandTotal: round2(grandTotal(bill)),
    shares: sharesFor(bill),
  };
}

function summary(bill) {
  return {
    id: bill.id,
    title: bill.title,
    total: bill.total,
    currency: bill.currency,
    // SEEDED BUG B5: off by one, so the list says "2 people" for a bill split three ways.
    peopleCount: bill.people.length - 1,
    settled: bill.settled,
  };
}

// ---------------------------------------------------------------- app

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Fixed clock for tests: `x-test-now: <ISO>` (only with test hooks on).
app.use((req, _res, next) => {
  const header = TEST_HOOKS ? req.get('x-test-now') : undefined;
  const parsed = header ? Date.parse(header) : NaN;
  req.now = Number.isFinite(parsed) ? parsed : Date.now();
  next();
});

// /healthz is reserved by Google's front end on *.run.app, so expose /api/health too.
const health = (_req, res) => res.json({ ok: true, version: APP_VERSION || 'dev' });
app.get('/healthz', health);
app.get('/api/health', health);

const api = express.Router();

api.get('/bills', (_req, res) => {
  res.json(store.bills.map(summary));
});

api.post('/bills', (req, res) => {
  const body = req.body || {};
  const total = Number(body.total);
  if (!Number.isFinite(total) || total <= 0) {
    return res.status(400).json({ error: 'total must be a positive number' });
  }
  if (!Array.isArray(body.people) || body.people.length === 0) {
    return res.status(400).json({ error: 'people must be a non-empty array' });
  }
  const currency = body.currency ?? 'INR';
  if (!isValidCurrency(currency)) return res.status(400).json({ error: 'unsupported currency' });
  const tipPct = Number(body.tipPct ?? 0);
  if (!isValidTip(tipPct)) return res.status(400).json({ error: 'unsupported tip' });

  const ts = new Date(req.now).toISOString();
  const bill = {
    id: store.nextId++,
    title: String(body.title ?? '').trim() || 'Untitled bill',
    total: round2(total),
    currency,
    tipPct,
    // Names are stored exactly as typed (see SEEDED_BUGS.md, B2).
    // EVAL BUG E10 (off unless EVAL_BUG=E10): non-ASCII letters are stripped "to keep the DB safe",
    // so "Zoë" is saved as "Zo".
    people: body.people.map((p) => (p == null ? '' : evalBug('E10') ? String(p).replace(/[^\x20-\x7E]/g, '') : String(p))),
    settled: false,
    paid: [],
    createdAt: ts,
    updatedAt: ts,
  };
  store.bills.push(bill);
  const { id, createdAt, updatedAt, ...fields } = bill;
  audit('insert', 'bills', id, fields);
  res.status(201).json(present(bill));
});

const findBill = (req) => store.bills.find((b) => String(b.id) === String(req.params.id));

api.get('/bills/:id', (req, res) => {
  const bill = findBill(req);
  if (!bill) return res.status(404).json({ error: 'bill not found' });
  res.json(present(bill));
});

api.patch('/bills/:id', (req, res) => {
  const bill = findBill(req);
  if (!bill) return res.status(404).json({ error: 'bill not found' });
  const body = req.body || {};
  const changes = {};
  if ('title' in body) changes.title = String(body.title).trim() || bill.title;
  if ('tipPct' in body) {
    const tipPct = Number(body.tipPct);
    if (!isValidTip(tipPct) && !isValidCustomTip(body.tipPct)) return res.status(400).json({ error: 'unsupported tip' });
    changes.tipPct = tipPct;
  }
  if ('currency' in body) {
    if (!isValidCurrency(body.currency)) return res.status(400).json({ error: 'unsupported currency' });
    changes.currency = body.currency;
  }
  const changed = Object.fromEntries(Object.entries(changes).filter(([k, v]) => bill[k] !== v));
  if (Object.keys(changed).length) {
    Object.assign(bill, changed, { updatedAt: new Date(req.now).toISOString() });
    audit('update', 'bills', bill.id, changed);
  }
  res.json(present(bill));
});

api.post('/bills/:id/settle', (req, res) => {
  const bill = findBill(req);
  if (!bill) return res.status(404).json({ error: 'bill not found' });
  const paidNames = Array.isArray(req.body?.paid) ? req.body.paid.map(String) : [];
  const shares = sharesFor(bill);
  const paidShares = shares.filter((s) => paidNames.includes(s.name));
  const everyonePaid = shares.every((s) => paidNames.includes(s.name));
  const total = grandTotal(bill);
  const ok = everyonePaid && isFullySettled(total, paidShares);
  const paidTotal = round2(paidShares.reduce((sum, s) => sum + s.amount, 0));

  if (ok && !bill.settled) {
    Object.assign(bill, { settled: true, paid: shares.map((s) => s.name), updatedAt: new Date(req.now).toISOString() });
    audit('update', 'bills', bill.id, { settled: true, paid: bill.paid });
  }
  res.json({ ok, settled: bill.settled, paidTotal, total: round2(total), everyonePaid });
});

api.get('/session', (req, res) => {
  res.json(sessionStatus(store.session, req.now));
});

if (TEST_HOOKS) {
  api.post('/__test/reset', (_req, res) => {
    reseed();
    res.json({ ok: true });
  });
  api.get('/__test/audit', (req, res) => {
    const since = Number(req.query.since ?? 0) || 0;
    res.json(store.audit.filter((e) => e.ts >= since));
  });
}

api.use((_req, res) => res.status(404).json({ error: 'not found' }));
app.use('/api', api);

// ---------------------------------------------------------------- front-end

const SDK_STUB = '/* shakefix-sdk not bundled in this build */\n';

function transformHtml(html) {
  let out = html;
  if (APP_VERSION) out = out.replaceAll('__APP_VERSION__', APP_VERSION);
  if (INTAKE_URL) out = out.replace(/data-endpoint="[^"]*"/, `data-endpoint="${INTAKE_URL}/v1/reports"`);
  const metas = [];
  if (EVAL_BUGS.length) metas.push(`<meta name="splitpal-eval-bugs" content="${EVAL_BUGS.join(',')}" />`);
  if (DEMO_MODE) {
    metas.push('<meta name="shakefix-demo" content="1" />');
    out = out.replace(/(<script[^>]*shakefix-sdk\.js")/, '$1 data-demo="1"');
  }
  if (metas.length) out = out.replace('</head>', `    ${metas.join('\n    ')}\n  </head>`);
  return out;
}

if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
  app.use(vite.middlewares);
  app.get('/shakefix-sdk.js', (_req, res) => {
    const sdk = join(root, '..', '..', 'packages', 'sdk', 'dist', 'shakefix-sdk.js');
    res.type('js').send(existsSync(sdk) ? readFileSync(sdk, 'utf8') : SDK_STUB);
  });
  app.get('*', async (req, res, next) => {
    try {
      const raw = readFileSync(join(root, 'index.html'), 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, raw);
      res.type('html').send(transformHtml(html));
    } catch (err) {
      vite.ssrFixStacktrace?.(err);
      next(err);
    }
  });
} else {
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error('[splitpal] dist/index.html missing. Run `npm run build` first (or start with --dev).');
    process.exit(1);
  }
  const indexHtml = transformHtml(readFileSync(join(distDir, 'index.html'), 'utf8'));
  // Service worker must never be cached, or clients keep stale push handlers.
  app.get('/sw.js', (_req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    next();
  });
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('/shakefix-sdk.js', (_req, res) => res.type('js').send(SDK_STUB));
  app.get('*', (_req, res) => res.type('html').set('Cache-Control', 'no-cache').send(indexHtml));
}

app.listen(PORT, () => {
  console.log(
    `[splitpal] listening on :${PORT} (${DEV ? 'dev' : 'prod'}${TEST_HOOKS ? ', test hooks ON' : ''}${EVAL_BUGS.length ? `, EVAL_BUG=${EVAL_BUGS.join(',')}` : ''}${DEMO_MODE ? ', DEMO_MODE' : ''}, version ${APP_VERSION || 'dev'})`,
  );
});
