// Runtime replayer used by Second Opinion: drives a Playwright `page` through a replay.json or *.flow.json.
// Zero dependencies — the caller supplies the Playwright Page.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { normalizeFlow, planSteps } from './plan.js';

/**
 * Reads a replay.json or tests/e2e/<name>.flow.json and returns a normalised flow.
 * @param {string} path
 * @returns {Promise<{name: string, rid: string|null, note: string, startRoute: string, actions: object[], expectation: object|null, tags: string[], source: string}>}
 */
export async function loadFlow(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const fallback = basename(path).replace(/\.flow\.json$|\.json$/i, '');
  return { ...normalizeFlow(raw, fallback), source: path };
}

function locate(page, target) {
  return target.testid ? page.getByTestId(target.testid) : page.locator(target.selector);
}

async function resetData(page, baseURL) {
  try {
    const url = baseURL ? new URL('/api/__test/reset', baseURL).toString() : '/api/__test/reset';
    await page.request.post(url);
  } catch { /* hooks disabled or server unreachable: ignore, like the generated specs */ }
}

/** Executes one planned step against the page. */
export async function executeStep(page, step, { timeout } = {}) {
  const t = timeout ? { timeout } : {};
  switch (step.op) {
    case 'click': return locate(page, step.target).click(t);
    case 'fill': return locate(page, step.target).fill(step.value, t);
    case 'select': return locate(page, step.target).selectOption(step.value, t);
    case 'check': return locate(page, step.target).setChecked(step.value, t);
    case 'submit': return locate(page, step.target).evaluate((form) => form.requestSubmit(), undefined, t);
    case 'waitForURL': return page.waitForURL(new RegExp(step.pattern), t);
    case 'goto': return page.goto(step.route, t);
    default: return undefined; // skip
  }
}

/**
 * Checks a contract expectation without throwing. Returns true when met within `timeout` ms.
 * @param {import('@playwright/test').Page} page
 * @param {{testid: string, state: 'visible'|'hidden'|'text', text?: string}} exp
 */
export async function checkExpectation(page, exp, { timeout = 5000 } = {}) {
  const loc = page.getByTestId(exp.testid);
  try {
    if (exp.state === 'text') {
      const deadline = Date.now() + timeout;
      for (;;) {
        const txt = (await loc.first().textContent({ timeout: Math.max(1, deadline - Date.now()) }).catch(() => null)) ?? '';
        if (txt.trim() === String(exp.text ?? '').trim()) return true;
        if (Date.now() >= deadline) return false;
        await page.waitForTimeout(100);
      }
    }
    await loc.first().waitFor({ state: exp.state === 'hidden' ? 'hidden' : 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Replays a flow on `page`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object|string} flowOrReplay  replay.json / flow.json object, or a path to one
 * @param {{
 *   onStep?: (stepIndex: number, action: object) => void|Promise<void>,   // after each action (index into flow.actions; skipped steps too)
 *   onStart?: (flow: object) => void|Promise<void>,                        // after the initial goto(startRoute), before step 0
 *   baseURL?: string,          // prefix for startRoute/goto when the page context has no baseURL
 *   reset?: boolean,           // POST /api/__test/reset first (default true; failures ignored)
 *   timeout?: number,          // per-action timeout ms (default: Playwright's)
 *   checkExpectation?: boolean // evaluate flow.expectation at the end (default false; never throws)
 *   stopOnError?: boolean      // default true: throw on the first failing step (error.stepIndex is set)
 * }} [opts]
 * @returns {Promise<{flow: object, stepsRun: number, errors: {stepIndex: number, message: string}[], expectationMet: boolean|null}>}
 */
export async function runFlow(page, flowOrReplay, opts = {}) {
  const { onStep, onStart, baseURL, reset = true, timeout, stopOnError = true } = opts;
  const flow = typeof flowOrReplay === 'string' ? await loadFlow(flowOrReplay) : normalizeFlow(flowOrReplay);
  const abs = (route) => (baseURL ? new URL(route, baseURL).toString() : route);

  if (reset) await resetData(page, baseURL);
  await page.goto(abs(flow.startRoute), timeout ? { timeout } : {});
  if (onStart) await onStart(flow);

  const steps = planSteps(flow.actions);
  const errors = [];
  let stepsRun = 0;
  for (const step of steps) {
    try {
      await executeStep(page, step.op === 'goto' ? { ...step, route: abs(step.route) } : step, { timeout });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      errors.push({ stepIndex: step.index, message });
      if (stopOnError) {
        const e = new Error(`runFlow "${flow.name}" failed at step ${step.index} (${step.action.type} ${step.action.testid || step.action.selector || ''}): ${message}`);
        e.stepIndex = step.index;
        e.action = step.action;
        e.cause = err;
        throw e;
      }
    }
    stepsRun++;
    if (onStep) await onStep(step.index, step.action);
  }

  let expectationMet = null;
  if (opts.checkExpectation && flow.expectation) expectationMet = await checkExpectation(page, flow.expectation, { timeout: timeout ?? 5000 });
  return { flow, stepsRun, errors, expectationMet };
}
