// Runs every tests/e2e/*.flow.json baseline flow against the demo app (CareRx; SplitPal's flows live in apps/splitpal/e2e).
//
//   BASE_URL=http://localhost:8080 npx playwright test tests/e2e            (all flows)
//   BASE_URL=https://... npx playwright test tests/e2e --grep @smoke       (smoke only)
//
// Server must run with test hooks (`pnpm --filter carerx start:test`) for the per-flow
// reset; without hooks the reset is skipped and flows run against live data.
//
// `expectFailUntilFixed: "C3"` marks a flow that fails on purpose while a seeded bug is live.
// Such flows are soft: the result is recorded as an annotation either way, so a correct fix
// never turns CI red. The fixing MR should delete the field from the flow file.
import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

type Action = {
  t: number;
  type: 'click' | 'input' | 'change' | 'navigate' | 'submit';
  testid?: string;
  selector: string;
  value?: string;
  route: string;
};
type Expectation = { testid: string; state: 'visible' | 'hidden' | 'text'; text?: string } | null;
type Flow = {
  name: string;
  tags?: string[];
  startRoute: string;
  actions: Action[];
  expectation: Expectation;
  expectFailUntilFixed?: string;
};

const BASE_URL = (process.env.BASE_URL || process.env.SPLITPAL_URL || 'http://localhost:8080').replace(/\/+$/, '');
const FIXED_NOW = process.env.SHAKEFIX_TEST_NOW || '2026-10-11T10:00:00.000Z';

/** Walks up from cwd to find tests/e2e (works whether Playwright runs from repo root or elsewhere). */
function flowsDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'tests', 'e2e');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return resolve('tests/e2e');
}

function loadFlows(): Flow[] {
  const dir = flowsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith('.flow.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Flow);
}

const locate = (page: Page, a: { testid?: string; selector: string }) =>
  a.testid ? page.getByTestId(a.testid) : page.locator(a.selector);

async function runAction(page: Page, a: Action) {
  switch (a.type) {
    case 'navigate':
      await page.goto(BASE_URL + (a.value || a.route));
      return;
    case 'click':
      await locate(page, a).click();
      return;
    case 'input':
      await locate(page, a).fill(a.value ?? '');
      return;
    case 'change': {
      const target = locate(page, a);
      const tag = await target.evaluate((el) => el.tagName.toLowerCase());
      const kind = await target.evaluate((el) => (el as HTMLInputElement).type);
      if (tag === 'select') await target.selectOption(a.value ?? '');
      else if (kind === 'checkbox' || kind === 'radio') await target.setChecked(a.value !== 'false');
      else await target.fill(a.value ?? '');
      return;
    }
    case 'submit':
      await locate(page, a).press('Enter');
      return;
  }
}

async function checkExpectation(page: Page, exp: Expectation) {
  if (!exp) return;
  const target = page.getByTestId(exp.testid);
  if (exp.state === 'visible') await expect(target).toBeVisible();
  else if (exp.state === 'hidden') await expect(target).toBeHidden();
  else await expect(target).toContainText(exp.text ?? '');
}

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

for (const flow of loadFlows()) {
  const tag = (flow.tags || []).map((t) => `@${t}`);
  test(`flow: ${flow.name}`, { tag }, async ({ page, request }) => {
    // A flow flagged expectFailUntilFixed is non-blocking either way: red while the seeded bug is
    // live, green once an agent fixes it. (test.fail() would turn every correct fix red.)
    const soft = Boolean(flow.expectFailUntilFixed);

    // Reseed (hooks only; 404 when hooks are off, which we tolerate).
    await request.post(`${BASE_URL}/api/__test/reset`).catch(() => undefined);

    // Fixed clock for same-origin API calls (honoured only with test hooks).
    await page.route(
      (url) => url.origin === new URL(BASE_URL).origin && url.pathname.startsWith('/api/'),
      (route) => route.continue({ headers: { ...route.request().headers(), 'x-test-now': FIXED_NOW } }),
    );

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const body = async () => {
      await page.goto(BASE_URL + flow.startRoute);
      await expect(page.getByTestId('app-version')).toBeVisible();
      for (const action of flow.actions) await runAction(page, action);
      await checkExpectation(page, flow.expectation);
      expect(errors, 'uncaught page errors').toEqual([]);
      await expect(page.getByTestId('error-banner')).toHaveCount(0);
    };
    if (!soft) return body();
    try {
      await body();
      test.info().annotations.push({ type: 'seeded-bug-fixed', description: `${flow.expectFailUntilFixed} now passes; remove expectFailUntilFixed` });
    } catch (err) {
      test.info().annotations.push({ type: 'seeded-bug-live', description: `${flow.expectFailUntilFixed}: ${String((err as Error).message).split(/\r?\n/)[0]}` });
    }
  });
}
