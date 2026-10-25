// Builds the single browser bundle dist/shakefix-sdk.js (IIFE).
// Usage: node build.mjs [--minify]
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const minify = process.argv.includes('--minify');

await build({
  entryPoints: [join(here, 'src/browser.js')],
  outfile: join(here, 'dist/shakefix-sdk.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // es2020: keeps the runtime `import(url)` used to lazy-load html2canvas from the CDN.
  target: ['es2020'],
  minify,
  sourcemap: false,
  legalComments: 'none',
  define: { __SHAKEFIX_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `/*! shakefix-sdk v${pkg.version} | MIT */` },
  logLevel: 'info',
});
