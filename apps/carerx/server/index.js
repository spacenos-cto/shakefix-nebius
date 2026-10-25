// CareRx API + static server (Express, ESM). The ShakeFix demo app: a prescription refill app
// for older patients, with deliberately seeded bugs (SEEDED_BUGS.md).
//
//   node server/index.js                      -> serves dist/ (run `vite build` first)
//   node server/index.js --dev                -> Vite dev middleware, same origin API
//   node server/index.js --test-hooks         -> enables /api/__test/* and x-test-now
//   node server/index.js --port=8080
//
// Env: PORT, SHAKEFIX_TEST_HOOKS=1, NODE_ENV=development, APP_VERSION, INTAKE_URL (rewrites the SDK
// data-endpoint at runtime), DEMO_MODE=1 (labels the UI "DEMO REPLAY").
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formatStrength } from '../src/dosing/strength.js';
import { fromCents, toCents } from '../src/lib/money.js';
import { sameDay } from '../src/lib/dates.js';

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
const DEMO_MODE = process.env.DEMO_MODE === '1';

// ---------------------------------------------------------------- store

const seed = JSON.parse(readFileSync(join(here, 'seed.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
// Every visitor (cookie crx_sid) gets their own copy of the seed data: judges trying the live demo,
// the post-deploy smoke test and Second Opinion's captures never see each other's refills or charges.
const SESSION_COOKIE = 'crx_sid';
const MAX_SESSIONS = 2000;
const sessions = new Map(); // sid -> store, insertion order = LRU

function freshStore() {
  return {
    patient: clone(seed.patient),
    privacy: clone(seed.privacy),
    card: clone(seed.card),
    prescriptions: clone(seed.prescriptions),
    orders: [],
    charges: [],
    nextOrder: 1001,
    nextCharge: 5001,
    audit: [],
  };
}

function storeFor(sid) {
  let store = sessions.get(sid);
  if (store) {
    sessions.delete(sid); // refresh LRU position
  } else {
    store = freshStore();
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  }
  sessions.set(sid, store);
  return store;
}

function audit(store, op, table, rowId, fields) {
  store.audit.push({ ts: Date.now(), op, table, rowId, fields: clone(fields) });
}

/** Prescription as returned by the API. */
function present(rx) {
  return { ...rx, strengthLabel: formatStrength(rx.strength, rx.unit) };
}

// ---------------------------------------------------------------- app

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // Cloud Run terminates TLS
app.use(express.json({ limit: '100kb' }));

// Fixed clock for tests: `x-test-now: <ISO>` (only with test hooks on).
app.use((req, _res, next) => {
  const header = TEST_HOOKS ? req.get('x-test-now') : undefined;
  const parsed = header ? Date.parse(header) : NaN;
  req.now = Number.isFinite(parsed) ? parsed : Date.now();
  next();
});

const cookieSid = (req) => /(?:^|;\s*)crx_sid=([A-Za-z0-9_-]{16,64})/.exec(req.get('cookie') || '')?.[1];
app.use('/api', (req, res, next) => {
  let sid = cookieSid(req);
  if (!sid) {
    sid = randomBytes(18).toString('base64url');
    // SameSite=None so the demo also works inside the Try page's phone frame (another site).
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    res.append('Set-Cookie', `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; Max-Age=86400; ${secure ? 'SameSite=None; Secure' : 'SameSite=Lax'}`);
  }
  req.store = storeFor(sid);
  next();
});

// /healthz is reserved by Google's front end on *.run.app, so expose /api/health too.
const health = (_req, res) => res.json({ ok: true, app: 'carerx', version: APP_VERSION || 'dev' });
app.get('/healthz', health);
app.get('/api/health', health);
// Which commit is live, so anyone can match production to the repository.
app.get('/api/version', (_req, res) => res.json({
  app: 'carerx',
  commit: APP_VERSION || 'dev',
  source: APP_VERSION ? `https://gitlab.com/nxt-spacenos-global/shakefix/-/commit/${APP_VERSION}` : null,
}));

const api = express.Router();

api.get('/me', (req, res) => {
  res.json({ ...req.store.patient, privacy: req.store.privacy, card: req.store.card });
});

api.patch('/me/privacy', (req, res) => {
  const body = req.body || {};
  const next = body.shareHealthData;
  if (typeof next === 'boolean' && next !== req.store.privacy.shareHealthData) {
    req.store.privacy.shareHealthData = next;
    audit(req.store, 'update', 'privacy', req.store.patient.id, { shareHealthData: next });
  }
  res.json({ ok: true, privacy: req.store.privacy });
});

api.get('/prescriptions', (req, res) => {
  res.json(req.store.prescriptions.map(present));
});

const findRx = (req) => req.store.prescriptions.find((r) => String(r.id) === String(req.params.id));

api.get('/prescriptions/:id', (req, res) => {
  const rx = findRx(req);
  if (!rx) return res.status(404).json({ error: 'prescription not found' });
  res.json(present(rx));
});

api.post('/prescriptions/:id/refills', (req, res) => {
  const rx = findRx(req);
  if (!rx) return res.status(404).json({ error: 'prescription not found' });
  if (rx.refillsLeft <= 0) return res.status(409).json({ error: 'No refills left. Ask your doctor for a new prescription.' });
  const ts = new Date(req.now).toISOString();
  const order = { id: req.store.nextOrder++, rxId: rx.id, drug: rx.drug, status: 'preparing', createdAt: ts };
  const charge = { id: req.store.nextCharge++, orderId: order.id, rxId: rx.id, amount: rx.copay, card: `${req.store.card.brand} •••• ${req.store.card.last4}`, at: ts };
  rx.refillsLeft -= 1;
  req.store.orders.push(order);
  req.store.charges.push(charge);
  audit(req.store, 'insert', 'orders', order.id, { rxId: rx.id, status: order.status });
  audit(req.store, 'insert', 'charges', charge.id, { orderId: order.id, rxId: rx.id, amount: charge.amount });
  audit(req.store, 'update', 'prescriptions', rx.id, { refillsLeft: rx.refillsLeft });
  res.status(201).json({ order, charge });
});

api.get('/orders', (req, res) => {
  res.json([...req.store.orders].reverse());
});

api.get('/orders/:id', (req, res) => {
  const order = req.store.orders.find((o) => String(o.id) === String(req.params.id));
  if (!order) return res.status(404).json({ error: 'order not found' });
  // What the patient was charged today for this medicine (the receipt they check).
  const today = req.store.charges.filter((c) => c.rxId === order.rxId && sameDay(c.at, req.now));
  const total = fromCents(today.reduce((s, c) => s + toCents(c.amount), 0));
  res.json({ ...order, chargesToday: today, chargedToday: total });
});

// Blast radius (public, read-only, aggregate). How many patients in the demo population used a
// route or component in the last 30 days. SYNTHETIC: CareRx has no real patients.
api.get('/insights/affected', (req, res) => {
  const pop = seed.population;
  const route = String(req.query.route || '');
  const component = String(req.query.component || '');
  const segment = String(req.query.segment || '');
  const counts = [pop.routes[route], pop.components[component], pop.segments[segment]].filter((n) => Number.isFinite(n));
  const patients = counts.length ? Math.min(...counts) : null;
  res.json({ patients, populationSize: pop.size, windowDays: pop.windowDays, refills: pop.refills, avgCopay: pop.avgCopay, synthetic: true, note: pop.note });
});

if (TEST_HOOKS) {
  api.post('/__test/reset', (req, res) => {
    Object.assign(req.store, freshStore());
    res.json({ ok: true });
  });
  api.get('/__test/audit', (req, res) => {
    const since = Number(req.query.since ?? 0) || 0;
    res.json(req.store.audit.filter((e) => e.ts >= since));
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
  if (DEMO_MODE) {
    out = out.replace('</head>', '    <meta name="shakefix-demo" content="1" />\n  </head>');
    out = out.replace(/(<script[^>]*shakefix-sdk\.js")/, '$1 data-demo="1"');
  }
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
    console.error('[carerx] dist/index.html missing. Run `npm run build` first (or start with --dev).');
    process.exit(1);
  }
  const indexHtml = transformHtml(readFileSync(join(distDir, 'index.html'), 'utf8'));
  app.get('/sw.js', (_req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    next();
  });
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('/shakefix-sdk.js', (_req, res) => res.type('js').send(SDK_STUB));
  app.get('*', (_req, res) => res.type('html').set('Cache-Control', 'no-cache').send(indexHtml));
}

app.listen(PORT, () => {
  console.log(`[carerx] listening on :${PORT} (${DEV ? 'dev' : 'prod'}${TEST_HOOKS ? ', test hooks ON' : ''}${DEMO_MODE ? ', DEMO_MODE' : ''}, version ${APP_VERSION || 'dev'})`);
});
