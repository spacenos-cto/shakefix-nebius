import { describe, expect, it } from 'vitest';
import {
  fixedPushPayload,
  flowGoal,
  issueBody,
  issueLabels,
  issueTitle,
  reoperateNote,
  replayCommitMessage,
  replayFilePath,
  rejectedNote,
  retriageNote,
  verdictReplayCommitMessage,
  verdictReplayPath,
  verifiedNote,
} from '../src/render.js';
import { makeReplay } from './helpers.js';

describe('issue title', () => {
  it('uses note and route', () => {
    expect(issueTitle(makeReplay())).toBe('🩺 [shake] settle button does nothing (/bill/7)');
  });

  it('falls back to the top console error, then a default', () => {
    expect(issueTitle(makeReplay({ note: '  ', console: [{ level: 'error', msg: 'TypeError: nope' }] }))).toBe(
      '🩺 [shake] TypeError: nope (/bill/7)',
    );
    expect(issueTitle(makeReplay({ note: '', actions: [], startRoute: '/' }))).toBe('🩺 [shake] bug report (/)');
  });

  it('truncates long notes', () => {
    const t = issueTitle(makeReplay({ note: 'x'.repeat(300) }));
    expect(t.length).toBeLessThan(110);
    expect(t).toContain('…');
  });
});

describe('issue labels', () => {
  it('are shakefix, sev::N, dup::<hash8>', () => {
    expect(issueLabels({ sev: 2, hash: 'deadbeef' })).toEqual(['shakefix', 'sev::2', 'dup::deadbeef']);
  });
});

describe('issue body (§8.3 template)', () => {
  const replay = makeReplay({ console: [{ level: 'error', msg: 'TypeError: x', stack: 'at settle (app.js:1)' }] });
  const body = issueBody({ replay, screenshotMarkdown: '![shot](/uploads/x/shot.png)' });

  it('starts with the contract rid marker', () => {
    expect(body.split('\n')[0]).toBe('<!-- shakefix:rid=r_20261011_8f3a01 -->');
  });

  it('contains header, screenshot, console error and the full replay', () => {
    expect(body).toContain('## 🩺 Patient intake');
    expect(body).toContain('**Reporter note:** settle button does nothing');
    expect(body).toContain('**Trigger:** shake · **Route:** `/bill/7` · **App version:** `a1b2c3d` · **Device:** iPhone, 390×844');
    expect(body).toContain('![shot](/uploads/x/shot.png)');
    expect(body).toContain('### Top console error\n```\nTypeError: x\nat settle (app.js:1)\n```');
    expect(body).toContain('### Replay (also at `reports/r_20261011_8f3a01/replay.json`)\n```json\n{');
    expect(body).toContain(JSON.stringify(replay, null, 2));
    expect(body.trimEnd().endsWith('_Filed automatically by ShakeFix intake. The ER team (Duo flow) will take it from here._')).toBe(true);
  });

  it('renders (none) and a placeholder when absent', () => {
    const b = issueBody({ replay: makeReplay(), screenshotMarkdown: null });
    expect(b).toContain('```\n(none)\n```');
    expect(b).toContain('_(no screenshot)_');
  });

  it('cannot break out of code fences', () => {
    const b = issueBody({ replay: makeReplay({ note: 'x', console: [{ level: 'error', msg: '```\n# injected' }] }) });
    expect(b.match(/```/g).length).toBe(4);
  });
});

describe('notes and misc', () => {
  it('re-operate mention matches the spec wording', () => {
    expect(reoperateNote({ account: '@ai-shakefix-grp', mr: 42 })).toBe(
      '@ai-shakefix-grp re-operate: Second Opinion found unintended changes on !42. See report.',
    );
  });

  it('commit path/message', () => {
    expect(replayFilePath('r_20261011_8f3a01')).toBe('reports/r_20261011_8f3a01/replay.json');
    expect(replayCommitMessage('r_20261011_8f3a01')).toBe('chore(report): r_20261011_8f3a01 [skip ci]');
  });

  it('flow goal and push payload', () => {
    expect(flowGoal(41)).toBe('ShakeFix: fix issue #41');
    expect(fixedPushPayload('/bill/7')).toEqual({ title: 'Fixed ✓', body: 'The bug you reported is gone. Pull to refresh.', url: '/bill/7' });
  });
});

describe('verdict notes', () => {
  it('fixed push payload carries the verdict link when given a rid', () => {
    expect(fixedPushPayload('/bill/7', { rid: 'r_20261011_8f3a01', verdictUrl: 'https://i.test/v1/reports/r_20261011_8f3a01/verdict', deviceId: 'dev_12345678' })).toEqual({
      title: 'Fixed ✓',
      body: 'The bug you reported is gone. Pull to refresh.',
      url: '/bill/7',
      kind: 'fixed',
      rid: 'r_20261011_8f3a01',
      tag: 'shakefix-r_20261011_8f3a01',
      verdictUrl: 'https://i.test/v1/reports/r_20261011_8f3a01/verdict',
      deviceId: 'dev_12345678',
    });
  });

  it('verified, rejected and re-triage wording', () => {
    expect(verifiedNote()).toBe('✅ Verified by the reporter — the patient confirms the fix.');
    expect(retriageNote({ account: '@ai-shakefix-grp' })).toBe('@ai-shakefix-grp re-triage: reporter rejected the fix, see latest replay');
    expect(verdictReplayPath('r_20261011_8f3a01', 2)).toBe('reports/r_20261011_8f3a01/replay-2.json');
    expect(verdictReplayCommitMessage('r_20261011_8f3a01', 2)).toMatch(/\[skip ci\]$/);
    const n = rejectedNote({ replay: makeReplay({ note: 'Still broken after fix', console: [{ level: 'error', msg: '```\n# injected' }] }), path: 'reports/r/replay-2.json' });
    expect(n.split('\n')[0]).toBe("👎 The reporter says it's still broken — new replay attached; back to triage.");
    expect(n).toContain('**Reporter note:** Still broken after fix');
    expect(n.match(/```/g).length).toBe(2); // cannot break out of the fence
  });
});

describe('links for people reading the issue', () => {
  it('issue body links to the live case on Mission Control; the verified note links the certificate', async () => {
    const { issueBody, verifiedNote } = await import('../src/render.js');
    const replay = { rid: 'r_20261012_abcdef', trigger: 'shake', note: 'x', app: { version: '1' }, device: { viewport: [390, 844], ua: '' }, actions: [], console: [], network: [] };
    expect(issueBody({ replay, trackUrl: 'https://board.example/?rid=r_20261012_abcdef' })).toContain('[Follow this case in Mission Control](https://board.example/?rid=r_20261012_abcdef)');
    expect(issueBody({ replay })).not.toContain('Mission Control');
    expect(verifiedNote({ certificateUrl: 'https://board.example/certificate.html?rid=r' })).toContain('📜 [Discharge Certificate](https://board.example/certificate.html?rid=r)');
  });
});
