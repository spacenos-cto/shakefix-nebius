// IIFE entry: <script src="/shakefix-sdk.js" data-endpoint="https://intake…/v1/reports" data-app="splitpal" data-version="a1b2c3d"></script>
// Exposes window.ShakeFix = { open(trigger), enableShake(), getReplay(note), askVerdict(rid), version }.
import { createShakeFix, readScriptConfig } from './index.js';

(function boot(win) {
  if (!win || !win.document || (win.ShakeFix && win.ShakeFix.__live)) return;
  const doc = win.document;
  const script =
    doc.currentScript ||
    doc.querySelector('script[data-endpoint][src*="shakefix"]') ||
    doc.querySelector('script[src*="shakefix-sdk"]');
  const cfg = { ...readScriptConfig(script), ...(win.ShakeFixConfig || {}) };
  const sf = createShakeFix(cfg, { win });
  sf.start();
  win.ShakeFix = {
    __live: true,
    version: sf.version,
    open: (trigger) => sf.open(trigger || 'bubble'),
    enableShake: () => sf.enableShake(),
    getReplay: (note) => sf.getReplay(note),
    // Shows the "Fixed ✓ — is it working for you now?" sheet for a report id (testing / demos).
    askVerdict: (rid) => sf.askVerdict(rid),
    // True when the intake runs DEMO_MODE (a recorded run replay); the UI shows "DEMO REPLAY".
    get demo() { return sf.demo; },
  };
  try { win.dispatchEvent(new CustomEvent('shakefix:ready')); } catch { /* old browsers */ }
})(typeof window !== 'undefined' ? window : undefined);
