// Screenshot via html2canvas, lazy-loaded from jsDelivr (pinned) at report time.
// [data-private] elements and masked inputs are blanked in the clone. Any failure → null (report still sends).

export const HTML2CANVAS_VERSION = '1.4.1';
export const HTML2CANVAS_ESM = `https://cdn.jsdelivr.net/npm/html2canvas@${HTML2CANVAS_VERSION}/dist/html2canvas.esm.js`;
export const HTML2CANVAS_UMD = `https://cdn.jsdelivr.net/npm/html2canvas@${HTML2CANVAS_VERSION}/dist/html2canvas.min.js`;
const MAX_B64 = 1_400_000; // keep the whole report under the intake's 2 MB cap

let loading = null;

function loadScript(doc, src) {
  return new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('html2canvas load failed'));
    doc.head.appendChild(s);
  });
}

export function loadHtml2Canvas(win = window) {
  if (win.html2canvas) return Promise.resolve(win.html2canvas);
  if (!loading) {
    const url = HTML2CANVAS_ESM;
    loading = import(/* @vite-ignore */ url)
      .then((m) => m.default || m)
      .catch(() => loadScript(win.document, HTML2CANVAS_UMD).then(() => win.html2canvas))
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot timeout')), ms))]);
}

function downscale(doc, canvas, factor) {
  const c = doc.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * factor));
  c.height = Math.max(1, Math.round(canvas.height * factor));
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

/**
 * @param {{win?: Window, ignore?: (el: Element) => boolean, isMasked?: (el: Element) => boolean, timeoutMs?: number}} opts
 * @returns {Promise<string|null>} raw base64 PNG (no data: prefix) or null
 */
export async function captureScreenshot({ win = window, ignore = () => false, isMasked = () => true, timeoutMs = 8000 } = {}) {
  try {
    const html2canvas = await withTimeout(loadHtml2Canvas(win), timeoutMs);
    const doc = win.document;
    const canvas = await withTimeout(
      html2canvas(doc.body, {
        scale: 0.6,
        logging: false,
        useCORS: true,
        backgroundColor: null,
        ignoreElements: ignore,
        onclone: (cloneDoc) => {
          cloneDoc.querySelectorAll('[data-private]').forEach((el) => {
            el.style.setProperty('background', '#111', 'important');
            el.style.setProperty('color', 'transparent', 'important');
            el.querySelectorAll('img,svg,canvas,video').forEach((m) => m.style.setProperty('visibility', 'hidden', 'important'));
          });
          // Mirror the recorder's masking: non-allowlisted field values never leave the device.
          const origFields = doc.querySelectorAll('input,textarea');
          const cloneFields = cloneDoc.querySelectorAll('input,textarea');
          cloneFields.forEach((el, i) => {
            const orig = origFields[i];
            if (orig && isMasked(orig) && el.value) el.value = '•'.repeat(Math.min(8, el.value.length));
          });
        },
      }),
      timeoutMs,
    );
    let out = canvas;
    let b64 = out.toDataURL('image/png').split(',')[1] || '';
    for (let f = 0.6; b64.length > MAX_B64 && f > 0.1; f -= 0.2) {
      out = downscale(doc, canvas, f);
      b64 = out.toDataURL('image/png').split(',')[1] || '';
    }
    return b64.length && b64.length <= MAX_B64 ? b64 : null;
  } catch {
    return null;
  }
}
