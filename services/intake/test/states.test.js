import { describe, expect, it } from 'vitest';
import { STATE_LABELS, issueIidFromBranch, mapGitlabEvent, nextState, stateFromLabels } from '../src/states.js';

const L = (...t) => t.map((title) => ({ title }));
const issueEvt = (labels, extra = {}) => ({
  object_kind: 'issue',
  object_attributes: { iid: 41, title: 'T', action: 'update', description: '<!-- shakefix:rid=r_20261011_8f3a01 -->\n## x', ...extra },
  labels: L(...labels),
});

describe('label → state', () => {
  it.each([
    [['shakefix'], null],
    [['shakefix', 'shakefix::triaging'], 'triaging'],
    [['shakefix', 'shakefix::in-surgery'], 'in-surgery'],
    [['shakefix', 'shakefix::proof'], 'proof'],
    [['shakefix', 'shakefix::ready'], 'proof'],
    [['shakefix', 'shakefix::unintended'], 'proof'],
    [['shakefix', 'shakefix::deployed'], 'deployed'],
    [['shakefix', 'shakefix::rolled-back', 'shakefix::deployed'], 'rolled-back'],
    [['shakefix', 'needs-human', 'shakefix::unintended'], 'needs-human'],
    [['shakefix', 'needs-info', 'shakefix::triaging'], 'needs-info'],
    [['shakefix', 'shakefix::deployed', 'shakefix::verified'], 'verified'],
    [['shakefix', 'shakefix::verified', 'shakefix::rolled-back'], 'rolled-back'],
    [['shakefix', 'shakefix::reopened'], 'reopened'],
    [['shakefix', 'shakefix::reopened', 'shakefix::triaging'], 'triaging'],
    [['shakefix', 'shakefix::reopened', 'shakefix::deployed'], 'deployed'],
  ])('%j → %s', (labels, state) => {
    expect(stateFromLabels(labels)).toBe(state);
  });
});

describe('mapGitlabEvent', () => {
  it('issue event: extracts rid marker, iid and label state', () => {
    const m = mapGitlabEvent(issueEvt(['shakefix', 'shakefix::in-surgery']));
    expect(m).toMatchObject({ kind: 'issue', rid: 'r_20261011_8f3a01', issueIid: 41, state: 'in-surgery', authoritative: true });
  });

  it('issue open with only shakefix label → received (hint)', () => {
    const m = mapGitlabEvent(issueEvt(['shakefix'], { action: 'open' }));
    expect(m).toMatchObject({ state: 'received', authoritative: false });
  });

  it('issue reopen → triaging (authoritative)', () => {
    expect(mapGitlabEvent(issueEvt(['shakefix'], { action: 'reopen' }))).toMatchObject({ state: 'triaging', authoritative: true });
  });

  it('MR on shakefix/<iid>-slug branch → in-surgery hint with mrIid', () => {
    const m = mapGitlabEvent({
      object_kind: 'merge_request',
      object_attributes: { iid: 42, action: 'open', state: 'opened', source_branch: 'shakefix/41-settle-noop' },
      labels: [],
    });
    expect(m).toMatchObject({ issueIid: 41, mrIid: 42, state: 'in-surgery', authoritative: false });
  });

  it('MR with "Closes #41" and shakefix::ready label → proof', () => {
    const m = mapGitlabEvent({
      object_kind: 'merge_request',
      object_attributes: { iid: 43, action: 'update', source_branch: 'feature/x', description: 'Fix. Closes #41' },
      labels: L('shakefix::ready'),
    });
    expect(m).toMatchObject({ issueIid: 41, mrIid: 43, state: 'proof', authoritative: true });
  });

  it('MR merged → proof hint', () => {
    const m = mapGitlabEvent({
      object_kind: 'merge_request',
      object_attributes: { iid: 42, action: 'merge', state: 'merged', source_branch: 'shakefix/41-x' },
    });
    expect(m.state).toBe('proof');
  });

  it('unrelated MR is ignored', () => {
    expect(mapGitlabEvent({ object_kind: 'merge_request', object_attributes: { iid: 1, source_branch: 'main' } })).toBeNull();
  });

  it('MR pipeline running on shakefix branch → proof hint', () => {
    const m = mapGitlabEvent({
      object_kind: 'pipeline',
      object_attributes: { ref: 'refs/merge-requests/42/head', status: 'running' },
      merge_request: { iid: 42, source_branch: 'shakefix/41-x' },
    });
    expect(m).toMatchObject({ issueIid: 41, mrIid: 42, state: 'proof', authoritative: false });
  });

  it('pipeline on main is ignored', () => {
    expect(mapGitlabEvent({ object_kind: 'pipeline', object_attributes: { ref: 'main', status: 'success' } })).toBeNull();
  });

  it('unknown event kinds are ignored', () => {
    expect(mapGitlabEvent({ object_kind: 'push' })).toBeNull();
  });

  it('issueIidFromBranch', () => {
    expect(issueIidFromBranch('shakefix/7-foo')).toBe(7);
    expect(issueIidFromBranch('shakefix/7')).toBe(7);
    expect(issueIidFromBranch('feature/7-foo')).toBeNull();
  });
});

describe('nextState', () => {
  it('authoritative transitions always apply (even backwards)', () => {
    expect(nextState('proof', { state: 'in-surgery', authoritative: true })).toBe('in-surgery');
  });

  it('hints only move forward', () => {
    expect(nextState('received', { state: 'in-surgery', authoritative: false })).toBe('in-surgery');
    expect(nextState('proof', { state: 'in-surgery', authoritative: false })).toBeNull();
  });

  it('hints never leave sticky states', () => {
    expect(nextState('deployed', { state: 'proof', authoritative: false })).toBeNull();
    expect(nextState('needs-human', { state: 'proof', authoritative: false })).toBeNull();
  });

  it('no-op when equal or empty', () => {
    expect(nextState('proof', { state: 'proof', authoritative: true })).toBeNull();
    expect(nextState('proof', { state: null })).toBeNull();
  });
});

describe('verdict states', () => {
  it('verified is sticky against hints; reopened moves forward on hints', () => {
    expect(nextState('verified', { state: 'proof', authoritative: false })).toBeNull();
    expect(nextState('verified', { state: 'reopened', authoritative: true })).toBe('reopened');
    expect(nextState('reopened', { state: 'in-surgery', authoritative: false })).toBe('in-surgery');
    expect(nextState('reopened', { state: 'received', authoritative: false })).toBeNull();
  });

  it('STATE_LABELS lists every pipeline label but not reopened', () => {
    expect(STATE_LABELS).toEqual(expect.arrayContaining(['shakefix::deployed', 'shakefix::verified', 'shakefix::ready']));
    expect(STATE_LABELS).not.toContain('shakefix::reopened');
  });
});

describe('outcomes and closing', () => {
  const issue = (action, labels) => ({ object_kind: 'issue', object_attributes: { action, iid: 6, description: 'ShakeFix report: shakefix:rid=r_20261010_498c49' }, labels: labels.map((title) => ({ title })) });
  it('a shipped fix reads as deployed even with needs-human still on it', () => {
    expect(mapGitlabEvent(issue('update', ['shakefix', 'needs-human', 'shakefix::deployed'])).state).toBe('deployed');
  });
  it('closing without a shipped fix moves the case to closed (off the board)', () => {
    const m = mapGitlabEvent(issue('close', ['shakefix', 'shakefix::proof']));
    expect(m).toMatchObject({ state: 'closed', authoritative: true });
    expect(nextState('proof', m)).toBe('closed');
  });
  it('closing a deployed case keeps it deployed', () => {
    expect(mapGitlabEvent(issue('close', ['shakefix', 'shakefix::deployed'])).state).toBe('deployed');
  });
});
