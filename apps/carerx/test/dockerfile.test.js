import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
const server = readFileSync(join(root, 'server', 'index.js'), 'utf8');

describe('Dockerfile', () => {
  it('copies every source directory the server imports at runtime', () => {
    const imports = [...server.matchAll(/from '\.\.\/(src\/[^/']+)\//g)].map((m) => m[1]);
    for (const dir of new Set(imports)) expect(dockerfile).toContain(`COPY ${dir} ./${dir}`);
  });
});
