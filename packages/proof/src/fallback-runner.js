// Minimal flow runner used ONLY when ../replay/lib/flow-runner.js is unavailable.
// Same signature: runFlow(page, flowOrReplay, { onStep }) — navigates to startRoute relative to the
// context baseURL, replays actions, and awaits onStep(i, action) after each action.

function locate(page, a) {
  if (a.testid) return page.getByTestId(a.testid).first();
  return page.locator(a.selector).first();
}

export async function runFlow(page, flow, { onStep } = {}) {
  await page.goto(flow.startRoute || '/', { waitUntil: 'domcontentloaded' });
  const actions = flow.actions || [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    switch (a.type) {
      case 'navigate':
        await page.goto(a.value || a.route || '/', { waitUntil: 'domcontentloaded' });
        break;
      case 'click':
        await locate(page, a).click();
        break;
      case 'input':
        await locate(page, a).fill(String(a.value ?? ''));
        break;
      case 'change': {
        const loc = locate(page, a);
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
        if (tag === 'select') await loc.selectOption(String(a.value ?? ''));
        else await loc.fill(String(a.value ?? ''));
        break;
      }
      case 'submit':
        await locate(page, a).evaluate((el) => (el.form || el).requestSubmit?.());
        break;
      default:
        throw new Error(`unknown action type ${a.type}`);
    }
    if (onStep) await onStep(i, a);
  }
}

export async function loadFlow(path) {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8'));
}
