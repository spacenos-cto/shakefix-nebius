// Start / stop a SplitPal server (built dist/, test hooks on) for one build flavour.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitHealthy(url, ms = 20_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${url}/healthz`);
      if (r.ok) return;
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`SplitPal did not become healthy at ${url} (${last?.message ?? 'timeout'})`);
}

/**
 * @param {{appDir: string, evalBug?: string|null, demo?: boolean}} o  appDir = apps/splitpal (built)
 * @returns {Promise<{url: string, stop: () => Promise<void>, logs: string[]}>}
 */
export async function startSplitpal({ appDir, evalBug = null }) {
  const port = await freePort();
  const env = { ...process.env, SHAKEFIX_TEST_HOOKS: '1', PORT: String(port) };
  delete env.EVAL_BUG;
  delete env.DEMO_MODE;
  delete env.INTAKE_URL;
  if (evalBug) env.EVAL_BUG = evalBug;
  const child = spawn(process.execPath, [join(appDir, 'server', 'index.js'), '--test-hooks', `--port=${port}`], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitHealthy(url);
  } catch (e) {
    child.kill();
    throw new Error(`${e.message}\n${logs.join('')}`);
  }
  return {
    url,
    logs,
    stop: () => new Promise((resolve) => {
      if (child.exitCode != null) return resolve();
      child.once('exit', () => resolve());
      child.kill();
    }),
  };
}
