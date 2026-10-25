import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRITERIA, CASES, STEPS, formatDuration } from '../src/judges-data.js';

test('formatDuration matches the certificate stopwatch', () => {
  assert.equal(formatDuration(1491271), '24m 51s');
  assert.equal(formatDuration(1563000), '26m 03s');
  assert.equal(formatDuration(45000), '45s');
  assert.equal(formatDuration(3720000), '1h 02m');
  assert.equal(formatDuration(NaN), '—');
});

test('every criterion has a claim and at least one evidence link', () => {
  assert.equal(CRITERIA.length, 6);
  for (const c of CRITERIA) {
    assert.ok(c.claim.length > 40, c.name);
    assert.ok(c.evidence.length >= 1, c.name);
    for (const e of c.evidence) assert.match(e.href, /^(https:\/\/|\.\/)/, `${c.name}: ${e.label}`);
  }
});

test('cases carry a report id and a fallback that matches the stopwatch format', () => {
  for (const c of CASES) {
    assert.match(c.rid, /^r_\d{8}_[0-9a-f]{6}$/);
    assert.match(c.fallback, /^\d+m \d{2}s$/);
  }
  assert.ok(STEPS.length >= 3 && STEPS.length <= 6);
});
