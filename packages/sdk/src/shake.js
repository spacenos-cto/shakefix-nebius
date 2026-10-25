// Shake detection, exactly per BUILD_SPEC §7.1:
// jolt = |dx|+|dy|+|dz| of accelerationIncludingGravity between consecutive samples;
// a jolt > 15 is a "hit"; 3 hits within 1000 ms = shake.

export const JOLT_THRESHOLD = 15;
export const HITS_REQUIRED = 3;
export const WINDOW_MS = 1000;

export function jolt(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

/**
 * Pure, testable detector. Feed it samples; it calls onShake when 3 jolts > 15 land within 1 s.
 * @param {{onShake: () => void, threshold?: number, hits?: number, windowMs?: number}} opts
 */
export function createShakeDetector({ onShake, threshold = JOLT_THRESHOLD, hits: required = HITS_REQUIRED, windowMs = WINDOW_MS }) {
  let last = null;
  let hits = [];
  return {
    /** @param {{x:number|null,y:number|null,z:number|null}|null|undefined} a  @param {number} now ms */
    sample(a, now) {
      if (!a || a.x == null || a.y == null || a.z == null) return false;
      let fired = false;
      if (last) {
        const j = jolt(a, last);
        if (j > threshold) {
          hits.push(now);
          hits = hits.filter((t) => now - t < windowMs);
        }
        if (hits.length >= required) {
          hits = [];
          fired = true;
          onShake();
        }
      }
      last = { x: a.x, y: a.y, z: a.z };
      return fired;
    },
    reset() {
      last = null;
      hits = [];
    },
    get hitCount() {
      return hits.length;
    },
  };
}

export function needsMotionPermission(win = globalThis) {
  const DME = win.DeviceMotionEvent;
  return !!DME && typeof DME.requestPermission === 'function';
}

export function supportsMotion(win = globalThis) {
  return typeof win.DeviceMotionEvent !== 'undefined';
}

/**
 * Requests iOS motion permission when required (must run inside a user gesture),
 * then attaches the devicemotion listener. Idempotent. Resolves true when listening.
 */
export function createShakeController({ win = globalThis, onShake, now = () => win.performance?.now?.() ?? Date.now() }) {
  let listening = false;
  const detector = createShakeDetector({ onShake });
  const handler = (e) => detector.sample(e.accelerationIncludingGravity, now());

  async function enableShake() {
    if (listening) return true;
    if (!supportsMotion(win)) return false;
    if (needsMotionPermission(win)) {
      try {
        const r = await win.DeviceMotionEvent.requestPermission();
        if (r !== 'granted') return false;
      } catch {
        return false;
      }
    }
    win.addEventListener('devicemotion', handler);
    listening = true;
    return true;
  }

  function disable() {
    if (!listening) return;
    win.removeEventListener('devicemotion', handler);
    listening = false;
    detector.reset();
  }

  return { enableShake, disable, get listening() { return listening; }, detector };
}
