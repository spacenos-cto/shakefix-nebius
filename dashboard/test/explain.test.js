import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS } from '../src/metrics.js';
import { STAGES } from '../src/timeline.js';
import { COLUMN_EXPLAIN, STAGE_EXPLAIN, caseStory, journey } from '../src/explain.js';

test('every board column and timeline stage has plain-English copy', () => {
  for (const c of COLUMNS) {
    assert.ok(COLUMN_EXPLAIN[c.id]?.plain && COLUMN_EXPLAIN[c.id]?.prevents, c.id);
  }
  for (const [key] of STAGES) assert.ok(STAGE_EXPLAIN[key]?.plain && STAGE_EXPLAIN[key]?.prevents, key);
});

test('journey keeps column order and splits off the needs-human off-ramp', () => {
  const j = journey([{ rid: 'a', state: 'proof' }, { rid: 'b', state: 'needs-human' }, { rid: 'c', state: 'verified' }]);
  assert.deepEqual(j.main.map((p) => p.id), ['triage', 'surgery', 'proof', 'recovery', 'discharged', 'verified']);
  assert.equal(j.offRamp.id, 'human');
  assert.deepEqual(j.main.find((p) => p.id === 'proof').cards.map((c) => c.rid), ['a']);
  assert.deepEqual(j.offRamp.cards.map((c) => c.rid), ['b']);
  assert.equal(journey(null).main.length, 6);
});

test('caseStory says where the case is and what comes next', () => {
  const rows = [
    { key: 'shaken', label: 'Shaken', reached: true },
    { key: 'issue_created', label: 'Issue created', reached: false },
  ];
  assert.match(caseStory(rows), /shook their phone.*Next: issue created\./);
  assert.match(caseStory([{ key: 'verified', label: '👍 Reporter confirmed', reached: true }]), /Case closed\.$/);
  assert.equal(caseStory([]), 'Waiting for the first event.');
});
