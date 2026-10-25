import { describe, it, expect } from 'vitest';
import { assessInfra, infraSignalsFromReplay, pageRequest, probeApp } from '../src/infra.js';

describe('infra signals from a replay', () => {
  it('5xx, dropped requests and platform console errors are infra signals; app errors are not', () => {
    const s = infraSignalsFromReplay({
      network: [
        { method: 'GET', path: '/api/bills', status: 503, ms: 120 },
        { method: 'POST', path: '/api/bills', status: 0, ms: 30000 },
        { method: 'GET', path: '/api/bills/7', status: 200, ms: 90 },
      ],
      console: [
        { level: 'error', msg: 'TypeError: Failed to fetch' },
        { level: 'error', msg: "Cannot read properties of undefined (reading 'toUpperCase')" },
      ],
    });
    expect(s.map((x) => x.kind)).toEqual(['server-error', 'network', 'platform-error']);
  });

  it('a plain code bug (TypeError, 200s) is not suspected', () => {
    const signals = infraSignalsFromReplay({ network: [{ method: 'GET', path: '/api/bills', status: 200, ms: 80 }], console: [{ level: 'error', msg: 'TypeError: x is undefined' }] });
    expect(assessInfra({ signals, probe: { probed: true, ok: true, status: 200 } }).suspected).toBe(false);
  });

  it('one slow request is noise; two are a reason', () => {
    const slow = { method: 'GET', path: '/api/bills', status: 200, ms: 12000 };
    expect(assessInfra({ signals: infraSignalsFromReplay({ network: [slow] }) }).suspected).toBe(false);
    expect(assessInfra({ signals: infraSignalsFromReplay({ network: [slow, slow] }) }).suspected).toBe(true);
  });
});

describe('probeApp', () => {
  it('only probes allowlisted origins (no SSRF through a report)', async () => {
    let called = false;
    const r = await probeApp({ baseUrl: 'http://169.254.169.254/', allowedOrigins: ['https://app.example'], fetchImpl: async () => { called = true; } });
    expect(r).toEqual({ probed: false });
    expect(called).toBe(false);
  });
  it('reports a thrown fetch as a failed probe', async () => {
    const r = await probeApp({ baseUrl: 'https://app.example/x', allowedOrigins: ['https://app.example'], fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    expect(r).toMatchObject({ probed: true, ok: false, url: 'https://app.example/api/health' });
  });
});

describe('pageRequest', () => {
  const msg = { title: 'ShakeFix: possible infra problem (#9)', text: 'GET /api/bills → 503', url: 'https://gitlab.com/x/-/issues/9' };
  it('ntfy gets text with an urgent priority and a click-through', () => {
    const r = pageRequest('https://ntfy.sh/my-topic', msg);
    expect(r.headers).toMatchObject({ priority: 'urgent', click: msg.url });
    expect(r.body).toBe(msg.text);
  });
  it('Slack and Discord get their own JSON shapes', () => {
    expect(JSON.parse(pageRequest('https://hooks.slack.com/services/x', msg).body).text).toContain('#9');
    expect(JSON.parse(pageRequest('https://discord.com/api/webhooks/x', msg).body).content).toContain('#9');
  });
});
