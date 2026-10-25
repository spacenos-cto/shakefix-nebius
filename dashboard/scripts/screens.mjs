// Mission Control screenshots (demo fixtures) + a 375px no-horizontal-scroll check on every tab.
// Usage: (cd dashboard && npx vite --port 5181) in one shell, then: node dashboard/scripts/screens.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BOARD_URL || 'http://localhost:5181/';
const OUT = fileURLToPath(new URL('../docs/screens/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?demo=1&tab=feed`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(11_000); // two demo ticks: the live case moves and new rows stream in
  await page.screenshot({ path: `${OUT}live-feed.png` });

  await page.getByRole('tab', { name: 'Second Opinion' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}second-opinion.png` });

  await page.keyboard.press('ArrowRight'); // Receipts, by keyboard
  await page.keyboard.press('ArrowRight'); // Numbers
  await page.waitForTimeout(1600); // count-up finishes
  if (!page.url().includes('tab=numbers')) throw new Error(`URL not in sync: ${page.url()}`);
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: `${OUT}numbers.png` });

  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  phone.on('pageerror', (e) => errors.push(e.message));
  for (const tab of ['patients', 'feed', 'opinion', 'receipts', 'numbers']) {
    await phone.goto(`${BASE}?demo=1&tab=${tab}`, { waitUntil: 'networkidle' });
    await phone.waitForTimeout(400);
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    console.log(`375px ${tab}: scrollWidth ${w}${w > 375 ? '  <-- horizontal scroll' : ''}`);
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
console.log(`screens saved to ${OUT}`);
