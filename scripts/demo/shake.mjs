#!/usr/bin/env node
// File a real ShakeFix report against a live SplitPal, the way a user's phone does: drive the app,
// open the SDK reporter, type a note, Send. The SDK records the replay; the intake opens the issue.
//   node scripts/demo/shake.mjs --url https://<app> --scenario c3 [--note "..."] [--video out/]
// Scenarios are short scripted user paths for the seeded bugs (CareRx C1-C4, SplitPal B*) on production.
// The SDK hides its UI from automated browsers, so this script clears navigator.webdriver for its
// own context only; it never touches a site you do not own.
import { chromium } from '@playwright/test';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({ options: {
  url: { type: 'string' }, scenario: { type: 'string' }, note: { type: 'string' }, video: { type: 'string' },
  'dry-run': { type: 'boolean' },
} });

const SCENARIOS = {
  // ---- CareRx (the demo app) ----
  // C3: one tap on Pay charges the copay twice.
  c3: {
    note: 'I paid my $12 copay for my heart pills once and it charged me $24.',
    async run(page) {
      await page.goto('/rx/1');
      await page.getByTestId('refill-btn').click();
      await page.getByTestId('pay-btn').click();
      await page.waitForURL(/\/orders\/\d+/);
      await page.waitForTimeout(1200);
    },
  },
  // C2: turning off health-data sharing does not stick.
  c2: {
    note: 'I turned off sharing my health data, it said Saved, but when I came back it was on again.',
    async run(page) {
      await page.goto('/settings');
      await page.getByTestId('privacy-share-toggle').uncheck();
      await page.waitForTimeout(800);
      await page.reload();
      await page.getByTestId('privacy-share-toggle').waitFor();
      await page.waitForTimeout(800);
    },
  },
  // C4: levothyroxine 50 mcg shown as 50 mg (supervised: a pharmacist must approve the fix).
  c4: {
    note: 'My thyroid pill says 50 mg but the bottle says 50 mcg. Which is it?',
    async run(page) {
      await page.goto('/rx/2');
      await page.getByTestId('rx-strength').waitFor();
      await page.waitForTimeout(1200);
    },
  },
  // C1: the refill control can't be reached with a screen reader or keyboard.
  c1: {
    note: "My mother uses a screen reader. On the refill screen it reads nothing for the refill button and she can't reorder her heart medicine.",
    async run(page) {
      await page.goto('/rx/1');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(1200);
    },
  },
  // ---- SplitPal (previous demo app, evals) ----
  // B2: blank second name crashes the bill view.
  b2: {
    note: 'Saved a bill with an empty second name and the bill page crashed.',
    async run(page) {
      await page.goto('/bill/new');
      await page.getByTestId('title-input').pressSequentially('Team lunch', { delay: 60 });
      await page.getByTestId('total-input').pressSequentially('300', { delay: 80 });
      await page.getByTestId('person-input-0').pressSequentially('Asha', { delay: 80 });
      await page.getByTestId('add-person-btn').click();
      await page.getByTestId('save-bill-btn').click();
      await page.waitForURL(/\/bill\/\d+/);
    },
  },
  // Tip race: two quick tip changes, the last one can be lost (requests are not serialised).
  'tip-race': {
    note: 'Changed the tip to 5% then quickly to 10% and it went back to 5%.',
    async run(page) {
      await page.goto('/bill/9');
      await page.getByTestId('tip-select').selectOption('5');
      await page.getByTestId('tip-select').selectOption('10');
      await page.waitForTimeout(1500);
    },
  },
  // B5: list shows one person too few.
  b5: {
    note: 'Dinner at Toit says 2 people on the home screen but we split it three ways.',
    async run(page) {
      await page.goto('/');
      await page.getByTestId('bill-row-7').waitFor();
      await page.waitForTimeout(1200);
    },
  },
  // B6: the name in Settings is not saved.
  b6: {
    note: 'Typed my name in Settings, went back, and the name was gone.',
    async run(page) {
      await page.goto('/settings');
      await page.getByTestId('settings-name-input').pressSequentially('Priya', { delay: 70 });
      await page.getByTestId('settings-name-input').press('Tab');
      await page.getByRole('link', { name: 'Split' }).click();
      await page.getByRole('link', { name: 'Settings' }).click();
      await page.getByTestId('settings-name-input').waitFor();
      await page.waitForTimeout(800);
    },
  },
  // B7: new bills ignore the default currency from Settings.
  b7: {
    note: 'Default currency is USD in Settings but my new bill shows rupees.',
    async run(page) {
      await page.goto('/settings');
      await page.getByTestId('default-currency-select').selectOption('USD');
      await page.goto('/bill/new');
      await page.getByTestId('title-input').pressSequentially('Brunch', { delay: 60 });
      await page.getByTestId('total-input').pressSequentially('80', { delay: 80 });
      await page.getByTestId('person-input-0').pressSequentially('Sam', { delay: 80 });
      await page.getByTestId('save-bill-btn').click();
      await page.waitForURL(/\/bill\/\d+/);
      await page.waitForTimeout(1200);
    },
  },
  // B8: 20% tip missing from the picker.
  b8: {
    note: 'There is no 20% tip option, it stops at 15%.',
    async run(page) {
      await page.goto('/bill/3');
      await page.getByTestId('tip-select').click();
      await page.waitForTimeout(1200);
    },
  },
  // B1: settle a bill whose total does not split evenly.
  b1: {
    note: 'Marked everyone as paid and confirmed, but the bill never shows as settled.',
    async run(page) {
      await page.goto('/bill/7');
      await page.getByTestId('settle-btn').click();
      for (const b of await page.locator('[data-testid^="pay-"][data-testid$="-btn"]').all()) await b.click();
      await page.getByTestId('confirm-settle-btn').click();
      await page.waitForTimeout(1500);
    },
  },
};

const sc = SCENARIOS[o.scenario];
if (!o.url || !sc) {
  console.error(`usage: shake.mjs --url <app> --scenario ${Object.keys(SCENARIOS).join('|')}`);
  process.exit(2);
}
const browser = await chromium.launch();
const ctx = await browser.newContext({
  baseURL: o.url.replace(/\/+$/, ''),
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  ...(o.video ? { recordVideo: { dir: o.video, size: { width: 390, height: 844 } } } : {}),
});
await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
const page = await ctx.newPage();
try {
  await sc.run(page);
  const sdk = page.locator('#shakefix-root');
  await sdk.waitFor({ state: 'attached', timeout: 10_000 });
  await sdk.evaluate((h) => h.shadowRoot.querySelector('button.bubble').click());
  await page.waitForTimeout(1500);
  await sdk.evaluate((h, note) => { const t = h.shadowRoot.querySelector('textarea'); t.value = note; t.dispatchEvent(new Event('input', { bubbles: true })); }, o.note || sc.note);
  if (o['dry-run']) {
    console.log('dry run: reporter filled, not sent');
  } else {
    const sent = new Date().toISOString();
    const resp = page.waitForResponse((r) => r.url().endsWith('/v1/reports') && r.request().method() === 'POST', { timeout: 30_000 });
    await sdk.evaluate((h) => h.shadowRoot.querySelector('button.btn.primary').click());
    const r = await resp;
    const body = await r.json().catch(() => ({}));
    console.log(JSON.stringify({ sent, status: r.status(), rid: body.rid, issue: body.issueIid ?? body.iid, url: body.issueUrl }));
  }
} finally {
  await ctx.close();
  await browser.close();
}
