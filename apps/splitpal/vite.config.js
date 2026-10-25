import { defineConfig } from 'vite';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Where the ShakeFix SDK bundle may live (first match wins).
const SDK_CANDIDATES = [
  process.env.SHAKEFIX_SDK_PATH,
  join(here, '..', '..', 'packages', 'sdk', 'dist', 'shakefix-sdk.js'),
].filter(Boolean);

/** Copies packages/sdk/dist/shakefix-sdk.js into dist/ when it exists; skips quietly otherwise. */
function shakefixSdk() {
  return {
    name: 'splitpal:shakefix-sdk',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%VITE_INTAKE_URL%', (process.env.VITE_INTAKE_URL || '').replace(/\/+$/, '')),
    },
    closeBundle() {
      const outDir = join(here, 'dist');
      if (existsSync(join(outDir, 'shakefix-sdk.js'))) return; // already shipped via public/
      const src = SDK_CANDIDATES.find((p) => existsSync(p));
      if (!src) {
        console.warn('[splitpal] shakefix-sdk.js not found; skipping (server serves a no-op stub).');
        return;
      }
      mkdirSync(outDir, { recursive: true });
      copyFileSync(src, join(outDir, 'shakefix-sdk.js'));
      console.log(`[splitpal] copied ${src} -> dist/shakefix-sdk.js`);
    },
  };
}

export default defineConfig({
  plugins: [shakefixSdk()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
