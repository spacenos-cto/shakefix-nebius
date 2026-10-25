// Voice note + "Call me" in the reporter sheet (docs/VOICE.md). MediaRecorder is faked in jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShakeFix } from '../src/index.js';
import { baseMime, blobToBase64, canRecordVoice, normalizePhone } from '../src/voice.js';

describe('voice helpers', () => {
  it('normalizes phone numbers to E.164 or rejects them', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('(+1) 415.555.0100')).toBe('+14155550100');
    expect(normalizePhone('98765 43210')).toBeNull();
    expect(normalizePhone('+0 123')).toBeNull();
  });
  it('strips codecs from the mime type and encodes blobs', async () => {
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(await blobToBase64(new Blob(['ABC']))).toBe('QUJD');
  });
  it('detects recording support', () => {
    expect(canRecordVoice({ navigator: {} })).toBe(false);
    expect(canRecordVoice({ MediaRecorder: function () {}, navigator: { mediaDevices: { getUserMedia() {} } } })).toBe(true);
  });
});

class FakeRecorder {
  static isTypeSupported(t) { return t === 'audio/webm;codecs=opus'; }
  constructor(stream, opts) { this.mimeType = opts.mimeType; this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable({ data: new Blob(['voice-bytes'], { type: this.mimeType }) });
    this.onstop();
  }
}

describe('reporter sheet with voice and call-me', () => {
  let sf;
  let posted;
  const root = () => document.getElementById('shakefix-root').shadowRoot;
  const button = (text) => [...root().querySelectorAll('button')].find((b) => b.textContent.includes(text));

  function boot(cfg = {}) {
    sf = createShakeFix({ endpoint: 'https://intake.example/v1/reports', app: 'carerx', automationUi: true, ...cfg }, { win: window });
    sf.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true }));
  }

  beforeEach(() => {
    posted = [];
    document.body.innerHTML = '<span data-testid="app-version">vdeadbee</span>';
    window.html2canvas = vi.fn(async () => ({ width: 10, height: 10, toDataURL: () => 'data:image/png;base64,QUJD' }));
    window.fetch = vi.fn(async (url, init) => {
      posted.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ rid: 'r_20261011_aaaaaa' }) };
    });
    window.MediaRecorder = FakeRecorder;
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) },
    });
  });
  afterEach(() => {
    sf._internals.recorder.stop();
    sf._internals.consoleCap.stop();
    sf._internals.networkCap.stop();
    document.getElementById('shakefix-root')?.remove();
    delete window.MediaRecorder;
    delete window.navigator.mediaDevices;
    delete window.html2canvas;
  });

  it('records a voice note and sends it with the report', async () => {
    boot();
    const mic = root().querySelector('.mic');
    mic.click();
    await vi.waitFor(() => expect(mic.getAttribute('data-state')).toBe('recording'));
    mic.click();
    await vi.waitFor(() => expect(root().textContent).toContain('Voice note ✓'));
    button('Send').click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const body = JSON.parse(posted[0].init.body);
    expect(body.voiceNote.mime).toBe('audio/webm');
    expect(atob(body.voiceNote.audio)).toBe('voice-bytes');
    expect(body.callback).toBeUndefined();
  });

  it('hides the mic when recording is not possible or turned off', () => {
    boot({ voice: false });
    expect(root().querySelector('.voice').classList.contains('hidden')).toBe(true);
  });

  it('call-me is off unless enabled; when on, a valid number is required', async () => {
    boot({ callMe: true });
    const callRow = [...root().querySelectorAll('.toggle')].find((t) => t.textContent.includes('Call me'));
    expect(callRow.classList.contains('hidden')).toBe(false);
    callRow.querySelector('.switch').click();
    root().querySelector('.phone').value = '98765';
    button('Send').click();
    expect(root().querySelector('.err').textContent).toContain('country code');
    expect(posted).toHaveLength(0);
    root().querySelector('.phone').value = '+91 98765 43210';
    button('Send').click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(posted[0].init.body).callback).toEqual({ phone: '+919876543210', consent: true });
    await vi.waitFor(() => expect(root().textContent).toContain("We'll call you when it's fixed."));
  });

  it('call-me is hidden by default', () => {
    boot();
    const callRow = [...root().querySelectorAll('.toggle')].find((t) => t.textContent.includes('Call me'));
    expect(callRow.classList.contains('hidden')).toBe(true);
  });
});
