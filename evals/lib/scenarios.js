// Scenario files: evals/scenarios/<id>.json. Validated so a typo fails fast instead of skewing the score.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = ['bug', 'trap'];
const TRAPS = ['not-reproducible', 'feature-request', 'prompt-injection'];
const ACTION_TYPES = ['click', 'input', 'change', 'navigate', 'submit'];

export function validateScenario(s, file = s?.id) {
  const err = (m) => { throw new Error(`scenario ${file}: ${m}`); };
  if (!s || typeof s !== 'object') err('not an object');
  if (!/^[A-Z]\d{1,2}$/.test(String(s.id))) err('id must look like B1 / E10 / T3');
  if (!KINDS.includes(s.kind)) err(`kind must be ${KINDS.join('|')}`);
  if (s.kind === 'trap' && !TRAPS.includes(s.trap)) err(`trap must be ${TRAPS.join('|')}`);
  if (typeof s.title !== 'string' || !s.title) err('title missing');
  if (typeof s.note !== 'string') err('note missing');
  if (s.evalBug != null && !/^E\d{1,2}$/.test(s.evalBug)) err('evalBug must be null or E<n>');
  if (!s.steps || typeof s.steps.startRoute !== 'string' || !Array.isArray(s.steps.actions)) err('steps.startRoute / steps.actions missing');
  for (const a of s.steps.actions) {
    if (!ACTION_TYPES.includes(a.type)) err(`bad action type ${a.type}`);
    if (!a.testid && !a.selector) err('action needs testid or selector');
  }
  if (s.expectation != null) {
    const e = s.expectation;
    if (!e.testid || !['visible', 'hidden', 'text'].includes(e.state)) err('expectation must be {testid, state}');
    if (e.state === 'text' && typeof e.text !== 'string') err('text expectation needs text');
  }
  return s;
}

export function loadScenarios(dir, { only = null } = {}) {
  const want = only ? new Set(only.map((x) => x.toUpperCase())) : null;
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => validateScenario(JSON.parse(readFileSync(join(dir, f), 'utf8')), f));
  const order = (id) => ({ B: 0, E: 1, T: 2 }[id[0]] * 100 + Number(id.slice(1)));
  return all.filter((s) => !want || want.has(s.id)).sort((a, b) => order(a.id) - order(b.id));
}
