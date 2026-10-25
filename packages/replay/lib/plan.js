// Shared step planner: turns replay.json / *.flow.json actions into concrete Playwright operations.
// Used by both the code generator (to-spec.js) and the runtime runner (flow-runner.js) so they never drift.

export const MASKED_PLACEHOLDER = 'ShakeFix test';
const SUBMIT_AFTER_CLICK_MS = 1000;

/**
 * Normalises a replay.json or a tests/e2e/<name>.flow.json into one flow shape.
 * @returns {{name: string, rid: string|null, note: string, startRoute: string, actions: object[], expectation: object|null, tags: string[]}}
 */
export function normalizeFlow(input, fallbackName = 'flow') {
  if (!input || typeof input !== 'object') throw new TypeError('flow/replay must be an object');
  if (!Array.isArray(input.actions)) throw new TypeError('flow/replay is missing an "actions" array');
  return {
    name: String(input.name || input.rid || fallbackName),
    rid: input.rid || null,
    note: String(input.note || ''),
    startRoute: typeof input.startRoute === 'string' && input.startRoute ? input.startRoute : '/',
    actions: input.actions,
    expectation: input.expectation && input.expectation.testid ? input.expectation : null,
    tags: Array.isArray(input.tags) ? input.tags : [],
  };
}

/** A path segment that looks like a generated id (digits, uuid, or ≥6 chars mixing letters and digits). */
export function isIdSegment(seg) {
  return /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || (/^[A-Za-z0-9_-]{6,}$/.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg));
}

/**
 * Regex source matching a full URL whose path equals `route`, with id-like segments wildcarded
 * (a fresh reseed may hand out different ids). Slashes are escaped so it can be emitted as a /literal/.
 */
export function routePattern(route) {
  const path = String(route || '/').split(/[?#]/)[0] || '/';
  const segs = path.split('/').map((s, i) => (i > 0 && s && isIdSegment(s) ? '[^/?#]+' : s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
  return `^[a-z][a-z0-9+.-]*:\\/\\/[^/]+${segs.join('\\/')}(?:[?#].*)?$`;
}

export function targetOf(action) {
  if (action.testid) return { testid: action.testid };
  if (action.selector && action.selector !== 'window') return { selector: action.selector };
  return null;
}

/**
 * @typedef {{index: number, action: object, op: 'click'|'fill'|'select'|'check'|'submit'|'waitForURL'|'goto'|'skip',
 *            target?: {testid?: string, selector?: string}, value?: string|boolean, masked?: boolean,
 *            route?: string, pattern?: string, reason?: string}} Step
 * @returns {Step[]}
 */
export function planSteps(actions) {
  const steps = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const prev = actions[i - 1];
    const target = targetOf(a);
    const base = { index: i, action: a };
    switch (a.type) {
      case 'click':
        steps.push(target ? { ...base, op: 'click', target } : { ...base, op: 'skip', reason: 'click without target' });
        break;
      case 'input': {
        if (!target) { steps.push({ ...base, op: 'skip', reason: 'input without target' }); break; }
        const masked = a.value === undefined;
        steps.push({ ...base, op: 'fill', target, value: masked ? MASKED_PLACEHOLDER : String(a.value), masked });
        break;
      }
      case 'change': {
        if (!target) { steps.push({ ...base, op: 'skip', reason: 'change without target' }); break; }
        if (a.value === 'true' || a.value === 'false') steps.push({ ...base, op: 'check', target, value: a.value === 'true' });
        else if (a.value === undefined) steps.push({ ...base, op: 'skip', reason: 'change value was masked' });
        else steps.push({ ...base, op: 'select', target, value: String(a.value) });
        break;
      }
      case 'submit': {
        const followsClick = prev && prev.type === 'click' && (a.t ?? 0) - (prev.t ?? 0) <= SUBMIT_AFTER_CLICK_MS;
        if (followsClick) steps.push({ ...base, op: 'skip', reason: 'submit caused by the previous click' });
        else if (target) steps.push({ ...base, op: 'submit', target });
        else steps.push({ ...base, op: 'skip', reason: 'submit without target' });
        break;
      }
      case 'navigate': {
        const route = a.route || '/';
        // A navigation right after a user interaction is caused by the app → wait for it.
        // Otherwise (back button, deep link) → drive it ourselves.
        // A navigate carrying `value` is a full page load the user did (reload, typed URL): always drive it.
        const caused = !a.value && prev && ['click', 'submit', 'change', 'input'].includes(prev.type);
        steps.push(caused ? { ...base, op: 'waitForURL', route, pattern: routePattern(route) } : { ...base, op: 'goto', route: a.value || route });
        break;
      }
      default:
        steps.push({ ...base, op: 'skip', reason: `unknown action type "${a.type}"` });
    }
  }
  return steps;
}
