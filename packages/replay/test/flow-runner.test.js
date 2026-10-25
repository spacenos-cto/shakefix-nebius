import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFlow, loadFlow } from '../lib/flow-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => join(here, 'fixtures', n);

/** Records every Playwright call the runner makes. */
function fakePage({ failOn } = {}) {
  const calls = [];
  const loc = (desc) => {
    const op = (name) => async (...args) => {
      calls.push([name, desc, ...args.filter((a) => typeof a !== 'object' || Array.isArray(a))]);
      if (failOn && failOn === `${name} ${desc}`) throw new Error('element not found');
    };
    return { click: op('click'), fill: op('fill'), selectOption: op('selectOption'), setChecked: op('setChecked'), evaluate: op('evaluate'),
      first() { return this; }, waitFor: op('waitFor'), textContent: async () => '' };
  };
  return {
    calls,
    request: { post: async (url) => { calls.push(['reset', url]); } },
    goto: async (url) => { calls.push(['goto', url]); },
    waitForURL: async (re) => { calls.push(['waitForURL', String(re)]); },
    getByTestId: (id) => loc(`testid=${id}`),
    locator: (sel) => loc(`css=${sel}`),
    waitForTimeout: async () => {},
  };
}

describe('loadFlow', () => {
  it('normalises a replay.json', async () => {
    const f = await loadFlow(fx('b1-settle.replay.json'));
    expect(f).toMatchObject({ name: 'r_20261011_8f3a2b', rid: 'r_20261011_8f3a2b', startRoute: '/', tags: [] });
    expect(f.actions).toHaveLength(16);
  });
  it('normalises a flow.json', async () => {
    const f = await loadFlow(fx('change-currency.flow.json'));
    expect(f).toMatchObject({ name: 'change-currency', rid: null, startRoute: '/bill/1', tags: ['smoke'] });
    expect(f.expectation).toEqual({ testid: 'bill-total', state: 'text', text: '$90.00' });
  });
});

describe('runFlow', () => {
  it('resets, goes to startRoute, replays every action and calls onStep after each', async () => {
    const page = fakePage();
    const seen = [];
    const res = await runFlow(page, fx('b1-settle.replay.json'), { onStep: (i, a) => seen.push([i, a.type]), baseURL: 'http://localhost:8080' });
    expect(res.stepsRun).toBe(16);
    expect(res.errors).toEqual([]);
    expect(res.expectationMet).toBeNull();
    expect(seen.map((s) => s[0])).toEqual([...Array(16).keys()]);
    expect(seen[1]).toEqual([1, 'navigate']);
    expect(page.calls[0]).toEqual(['reset', 'http://localhost:8080/api/__test/reset']);
    expect(page.calls[1]).toEqual(['goto', 'http://localhost:8080/']);
    expect(page.calls).toContainEqual(['fill', 'testid=total-input', '1000']);
    expect(page.calls).toContainEqual(['selectOption', 'testid=tip-select', '10']);
    expect(page.calls.at(-1)).toEqual(['click', 'testid=confirm-settle-btn']);
  });

  it('accepts an object, honours reset:false and goto for non-caused navigations', async () => {
    const page = fakePage();
    const flow = { startRoute: '/settings', actions: [{ t: 0, type: 'navigate', selector: 'window', route: '/' }] };
    await runFlow(page, flow, { reset: false });
    expect(page.calls).toEqual([['goto', '/settings'], ['goto', '/']]);
  });

  it('throws with stepIndex on failure by default; collects errors with stopOnError:false', async () => {
    const page = fakePage({ failOn: 'click testid=settle-btn' });
    await expect(runFlow(page, fx('b1-settle.replay.json'))).rejects.toMatchObject({ stepIndex: 13 });
    const page2 = fakePage({ failOn: 'click testid=settle-btn' });
    const res = await runFlow(page2, fx('b1-settle.replay.json'), { stopOnError: false });
    expect(res.errors).toEqual([{ stepIndex: 13, message: 'element not found' }]);
    expect(res.stepsRun).toBe(16);
  });

  it('checkExpectation:true reports whether the expectation held', async () => {
    const res = await runFlow(fakePage(), fx('b1-settle.replay.json'), { checkExpectation: true });
    expect(res.expectationMet).toBe(true);
  });
});
