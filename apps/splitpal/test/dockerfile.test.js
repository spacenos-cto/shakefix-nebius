// Guard: every ../src file the server imports must be copied into the runtime image.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('Dockerfile runtime stage', () => {
  it('copies every src module the server imports', () => {
    const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
    const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    const copied = [...docker.matchAll(/^COPY (src\/\S+)/gm)].map((m) => m[1]);
    const imports = [...server.matchAll(/from '\.\.\/(src\/[^']+)'/g)].map((m) => m[1]);
    for (const imp of imports) {
      expect(copied.some((c) => imp === c || imp.startsWith(c + '/')), `${imp} not copied`).toBe(true);
    }
  });
});
