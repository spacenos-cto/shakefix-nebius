// Playwright capture (§11.2). Runs one flow against one URL in a fresh chromium context and
// records, after every step: screenshot, {testid: text}, /api/* JSON responses, DB audit writes.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeApiEntry, normalizeAudit, normalizeTextMap, routeOf } from './normalize.js';

export const FIXED_NOW = '2026-10-11T10:00:00Z';
export const CONTEXT_OPTIONS = Object.freeze({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  timezoneId: 'UTC',
  locale: 'en-US',
  extraHTTPHeaders: { 'x-test-now': FIXED_NOW },
});

const IS_JSON = /\bjson\b/i;

/** Resolve the flow runner: packages/replay if present, else the local fallback. */
export async function loadRunner(log = () => {}) {
  try {
    const mod = await import('../../replay/lib/flow-runner.js');
    if (typeof mod.runFlow === 'function') return { runFlow: mod.runFlow, loadFlow: mod.loadFlow, source: 'replay' };
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') log(`warn: replay runner failed to load (${err.message}); using fallback`);
  }
  const fb = await import('./fallback-runner.js');
  log('warn: ../replay/lib/flow-runner.js not found; using built-in fallback runner');
  return { runFlow: fb.runFlow, loadFlow: fb.loadFlow, source: 'fallback' };
}

export async function launchBrowser() {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({
    args: ['--font-render-hinting=none', '--disable-skia-runtime-opts'],
    // Optional override for local runs where the pinned browser build is not installed.
    executablePath: process.env.PROOF_CHROMIUM_PATH || undefined,
  });
}

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}${path}`;
}

function firstLine(err) {
  // eslint-disable-next-line no-control-regex
  return String(err?.message || err).replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 200);
}

/** Visible [data-testid] -> innerText (inputs/selects report their value). Duplicate ids get #2, #3... */
function collectTexts() {
  const out = {};
  for (const el of document.querySelectorAll('[data-testid]')) {
    const st = getComputedStyle(el);
    if (!el.getClientRects().length || st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
    let k = el.getAttribute('data-testid');
    const tag = el.tagName;
    const t = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ? el.value : el.innerText;
    if (k in out) { let n = 2; while (`${k}#${n}` in out) n++; k = `${k}#${n}`; }
    out[k] = t ?? '';
  }
  return out;
}

/**
 * Did the user's flow "pass" on this side? Same rule as the generated regression spec:
 * the expectation holds (when there is one), no uncaught page error and no error banner.
 */
export async function flowOutcome(page, expectationMet, pageErrors, stepError) {
  let errorBanner = false;
  try { errorBanner = (await page.getByTestId('error-banner').count()) > 0; } catch { /* page gone */ }
  const passed = !stepError && expectationMet !== false && !pageErrors.length && !errorBanner;
  return { passed, expectationMet, pageErrors: pageErrors.length, errorBanner, ...(stepError ? { stepError } : {}) };
}

/**
 * Capture one flow on one side.
 * @returns capture object {flow, side, url, error, appVersion, steps:[...]} (also written to capture.json)
 */
export async function captureFlow({ browser, url, flow, flowName, side, outDir, runFlow, log = () => {} }) {
  const dir = join(outDir, 'raw', flowName, side);
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({ ...CONTEXT_OPTIONS, baseURL: url });
  try {
    if (context.clock?.setFixedTime) await context.clock.setFixedTime(new Date(FIXED_NOW));
  } catch { /* older playwright: header-only clock */ }

  const capture = { flow: flowName, side, url, error: null, appVersion: null, steps: [] };
  try {
    const reset = await context.request.post(joinUrl(url, '/api/__test/reset'));
    if (!reset.ok()) throw new Error(`POST /api/__test/reset -> HTTP ${reset.status()} (is SHAKEFIX_TEST_HOOKS=1?)`);

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(firstLine(err)));
    let seq = 0;
    let pending = [];
    let buffer = [];
    let auditSeen = 0;

    // App API requests still in flight: a page is not "stable" while one is pending (a cold preview
    // revision can take longer than the 150 ms stability window to answer the next view's fetch).
    let inflight = 0;
    const isAppApi = (req) => {
      try { const u = new URL(req.url()); return u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/__test'); } catch { return false; }
    };
    page.on('request', (req) => { if (isAppApi(req)) inflight++; });
    const settle = (req) => { if (isAppApi(req)) inflight = Math.max(0, inflight - 1); };
    page.on('requestfinished', settle);
    page.on('requestfailed', settle);

    page.on('response', (resp) => {
      let u;
      try { u = new URL(resp.url()); } catch { return; }
      if (!u.pathname.startsWith('/api/') || u.pathname.startsWith('/api/__test')) return;
      const order = seq++;
      pending.push((async () => {
        let body = null;
        try {
          if (IS_JSON.test(resp.headers()['content-type'] || '')) body = await resp.json();
        } catch { body = null; }
        buffer.push({ order, method: resp.request().method(), path: u.pathname, status: resp.status(), body });
      })());
    });

    const snap = async (i, action) => {
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      while (pending.length) {
        const p = pending; pending = [];
        await Promise.allSettled(p);
      }
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      // SPA navigations start after the click returns, so networkidle can resolve too early.
      // Wait until the route and visible text stop changing (two equal reads 150 ms apart, max 3 s).
      let rawTexts = {};
      let prev = null;
      for (let tries = 0; tries < 20; tries++) {
        const cur = await page.evaluate(collectTexts).catch(() => ({}));
        const key = page.url() + JSON.stringify(cur);
        rawTexts = cur;
        if (key === prev && inflight === 0) break;
        prev = key;
        await page.waitForTimeout(150);
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
      }
      if (capture.appVersion === null && rawTexts['app-version']) capture.appVersion = String(rawTexts['app-version']).trim();
      const shotName = `step-${String(i).padStart(2, '0')}.png`;
      await page.screenshot({
        path: join(dir, shotName), fullPage: true, animations: 'disabled', caret: 'hide',
        // Build-specific regions (version labels and the text around them) differ between any two builds.
        mask: [page.locator('[data-testid="app-version"]'), page.locator('[data-shakefix-mask]')],
      }).catch((err) => log(`warn: screenshot failed (${firstLine(err)})`));

      let db = [];
      try {
        const res = await context.request.get(joinUrl(url, '/api/__test/audit?since=0'));
        if (res.ok()) {
          const rows = await res.json();
          if (Array.isArray(rows)) { db = normalizeAudit(rows.slice(auditSeen)); auditSeen = rows.length; }
        }
      } catch (err) { log(`warn: audit fetch failed (${firstLine(err)})`); }

      const api = buffer.sort((a, b) => a.order - b.order).map(normalizeApiEntry);
      buffer = [];
      capture.steps.push({
        i,
        route: routeOf(page.url()),
        action: action ? { type: action.type, testid: action.testid ?? null } : null,
        texts: normalizeTextMap(rawTexts),
        screenshot: `raw/${flowName}/${side}/${shotName}`,
        api,
        db,
      });
    };

    try {
      // Second Opinion already reset the data above; the replay runner must not reset again mid-capture.
      const res = await runFlow(page, flow, { onStep: (i, action) => snap(i, action), baseURL: url, reset: false, checkExpectation: true });
      if (!capture.steps.length) await snap(0, null);
      capture.outcome = await flowOutcome(page, res?.expectationMet ?? null, pageErrors, null);
    } catch (err) {
      capture.error = firstLine(err);
      log(`  ${side}: flow error: ${capture.error}`);
      capture.outcome = await flowOutcome(page, null, pageErrors, capture.error);
    }
  } catch (err) {
    capture.error = firstLine(err);
    capture.fatal = true; // environment problem (reset hook, browser): the run must not pass silently
    log(`  ${side}: setup error: ${capture.error}`);
  } finally {
    await context.close().catch(() => {});
  }
  await writeFile(join(dir, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
  return capture;
}
