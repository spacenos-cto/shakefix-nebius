import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

// Repo files the board reads at runtime, served in dev and emitted into dist/ at build time.
// (No public/ dir: keeps the repo free of a second copy.)
const JSON_FILES = [
  // Medical Record index (docs/MEMORY.md): an object, or null while it does not exist yet. It feeds the
  // Medical Records panel and the Ledger panel (.shakefix/ledger/index.json is no longer written by agents).
  { name: 'memory.json', src: resolve(here, '../.shakefix/memory/index.json'), fallback: 'null', valid: (v) => v && typeof v === 'object' && !Array.isArray(v) },
];

function read(f) {
  if (!existsSync(f.src)) return f.fallback;
  try {
    const parsed = JSON.parse(readFileSync(f.src, 'utf8'));
    return f.valid(parsed) ? JSON.stringify(parsed) : f.fallback;
  } catch {
    return f.fallback;
  }
}

function repoJson() {
  return {
    name: 'shakefix-repo-json',
    configureServer(server) {
      for (const f of JSON_FILES) {
        server.middlewares.use(`/${f.name}`, (_req, res) => {
          res.setHeader('content-type', 'application/json');
          res.end(read(f));
        });
      }
    },
    generateBundle() {
      for (const f of JSON_FILES) this.emitFile({ type: 'asset', fileName: f.name, source: read(f) });
    },
  };
}

export default defineConfig({
  base: './', // GitLab Pages serves the project under a sub-path
  plugins: [repoJson()],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { index: resolve(here, 'index.html'), try: resolve(here, 'try.html'), certificate: resolve(here, 'certificate.html'), judges: resolve(here, 'judges.html') } } },
  server: { fs: { allow: [resolve(here, '..')] } }, // the demo fixture lives in services/intake
});
