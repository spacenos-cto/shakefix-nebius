// Each test starts a fresh SDK; the recorder's per-tab buffer must not carry over between tests.
import { beforeEach } from 'vitest';

beforeEach(() => {
  try { window.sessionStorage.clear(); } catch { /* no DOM */ }
});
