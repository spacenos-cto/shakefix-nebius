// Voice note (docs/VOICE.md): the reporter says what went wrong instead of typing it.
// MediaRecorder, max 30 s, low bitrate. The intake transcribes it (ElevenLabs Scribe).

export const MAX_VOICE_MS = 30_000;
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

export function canRecordVoice(win) {
  return !!(win.MediaRecorder && win.navigator?.mediaDevices?.getUserMedia);
}

/** "audio/webm;codecs=opus" → "audio/webm" (the intake accepts the base type only). */
export function baseMime(type) {
  return String(type || '').split(';')[0].trim().toLowerCase();
}

/** E.164 from what the reporter typed: "+91 98765-43210" → "+919876543210"; null when not plausible. */
export function normalizePhone(input) {
  const s = String(input || '').replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

export function createVoiceRecorder({ win, maxMs = MAX_VOICE_MS, onTick = () => {}, onAutoStop = () => {} }) {
  let rec = null;
  let stream = null;
  let chunks = [];
  let started = 0;
  let timer = null;
  let stopTimer = null;
  let done = null;

  const mimeType = () => CANDIDATES.find((t) => win.MediaRecorder.isTypeSupported?.(t)) || '';

  async function start() {
    stream = await win.navigator.mediaDevices.getUserMedia({ audio: true });
    const type = mimeType();
    rec = new win.MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 24_000 });
    chunks = [];
    done = new Promise((resolve) => {
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        clearInterval(timer);
        clearTimeout(stopTimer);
        stream.getTracks().forEach((t) => t.stop());
        const mime = baseMime(rec.mimeType || type || 'audio/webm');
        resolve({ blob: new win.Blob(chunks, { type: mime }), mime, ms: Date.now() - started });
      };
    });
    started = Date.now();
    rec.start();
    timer = setInterval(() => onTick(Date.now() - started), 250);
    stopTimer = setTimeout(() => { if (rec?.state === 'recording') { rec.stop(); onAutoStop(); } }, maxMs);
  }

  async function stop() {
    if (rec && rec.state === 'recording') rec.stop();
    return done;
  }

  return { start, stop, get recording() { return rec?.state === 'recording'; } };
}

/** Blob → base64 (no data: prefix). FileReader fallback for engines without Blob.arrayBuffer(). */
export async function blobToBase64(blob) {
  if (typeof blob.arrayBuffer !== 'function') {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
