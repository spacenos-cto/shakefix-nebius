import { describe, it, expect, vi } from 'vitest';
import { createShakeDetector, createShakeController, jolt, JOLT_THRESHOLD } from '../src/shake.js';

const rest = { x: 0, y: 0, z: 9.8 };
const hit = { x: 10, y: 10, z: 9.8 }; // jolt from rest = 20 > 15

describe('jolt maths', () => {
  it('sums absolute axis deltas', () => {
    expect(jolt({ x: 1, y: -2, z: 3 }, { x: -1, y: 2, z: 0 })).toBe(2 + 4 + 3);
  });
  it('threshold is 15', () => expect(JOLT_THRESHOLD).toBe(15));
});

describe('shake detector (3 jolts > 15 within 1 s)', () => {
  it('fires on the third hit inside the window', () => {
    const onShake = vi.fn();
    const d = createShakeDetector({ onShake });
    d.sample(rest, 0);
    d.sample(hit, 100);
    d.sample(rest, 200);
    expect(onShake).not.toHaveBeenCalled();
    d.sample(hit, 300);
    expect(onShake).toHaveBeenCalledTimes(1);
  });

  it('does not count a jolt of exactly 15', () => {
    const onShake = vi.fn();
    const d = createShakeDetector({ onShake });
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 15, y: 0, z: 0 };
    [a, b, a, b, a].forEach((s, i) => d.sample(s, i * 50));
    expect(onShake).not.toHaveBeenCalled();
    expect(d.hitCount).toBe(0);
  });

  it('a jolt of 15.01 counts', () => {
    const onShake = vi.fn();
    const d = createShakeDetector({ onShake });
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 15.01, y: 0, z: 0 };
    [a, b, a, b].forEach((s, i) => d.sample(s, i * 50));
    expect(onShake).toHaveBeenCalledTimes(1);
  });

  it('hits spread over more than 1 s do not fire', () => {
    const onShake = vi.fn();
    const d = createShakeDetector({ onShake });
    d.sample(rest, 0);
    d.sample(hit, 0); // hit 1 at t=0
    d.sample(hit, 600); // no jolt (same sample)
    d.sample(rest, 600); // hit 2 at 600
    d.sample(hit, 1100); // hit 3 at 1100 → hit 1 expired (1100 - 0 >= 1000)
    expect(onShake).not.toHaveBeenCalled();
    expect(d.hitCount).toBe(2);
  });

  it('resets hits after firing (needs 3 fresh hits)', () => {
    const onShake = vi.fn();
    const d = createShakeDetector({ onShake });
    const seq = [rest, hit, rest, hit, rest, hit];
    seq.forEach((s, i) => d.sample(s, i * 10));
    expect(onShake).toHaveBeenCalledTimes(1);
    expect(d.hitCount).toBe(2);
  });

  it('ignores null acceleration', () => {
    const d = createShakeDetector({ onShake: vi.fn() });
    expect(d.sample(null, 0)).toBe(false);
    expect(d.sample({ x: null, y: 1, z: 1 }, 0)).toBe(false);
  });
});

describe('permission path', () => {
  function fakeWin(requestPermission) {
    const listeners = {};
    function DeviceMotionEvent() {}
    if (requestPermission) DeviceMotionEvent.requestPermission = requestPermission;
    return {
      DeviceMotionEvent,
      addEventListener: (t, fn) => { listeners[t] = fn; },
      removeEventListener: (t) => { delete listeners[t]; },
      listeners,
    };
  }

  it('iOS: listens only when permission granted', async () => {
    const win = fakeWin(vi.fn().mockResolvedValue('granted'));
    const c = createShakeController({ win, onShake: vi.fn(), now: () => 0 });
    expect(await c.enableShake()).toBe(true);
    expect(win.listeners.devicemotion).toBeTypeOf('function');
  });

  it('iOS: denied → false, no listener', async () => {
    const win = fakeWin(vi.fn().mockResolvedValue('denied'));
    const c = createShakeController({ win, onShake: vi.fn() });
    expect(await c.enableShake()).toBe(false);
    expect(win.listeners.devicemotion).toBeUndefined();
  });

  it('Android: no permission API → listens immediately', async () => {
    const win = fakeWin(null);
    const onShake = vi.fn();
    let t = 0;
    const c = createShakeController({ win, onShake, now: () => (t += 50) });
    expect(await c.enableShake()).toBe(true);
    [rest, hit, rest, hit].forEach((a) => win.listeners.devicemotion({ accelerationIncludingGravity: a }));
    expect(onShake).toHaveBeenCalledTimes(1);
  });

  it('no DeviceMotionEvent → false', async () => {
    const c = createShakeController({ win: { addEventListener() {} }, onShake: vi.fn() });
    expect(await c.enableShake()).toBe(false);
  });
});
