import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffFlow, buildProof } from '../src/diff.js';

export const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fx = (p) => JSON.parse(readFileSync(join(FIX, p), 'utf8'));
export const fxText = (p) => readFileSync(join(FIX, p), 'utf8');

/** The B1 naive-fix scenario: baseline change-tip flow (bill 9) + the user's replay (bill 4). */
export function b1Proof() {
  const replay = fx('b1/replay.json');
  const tip = diffFlow(fx('b1/change-tip.base.json'), fx('b1/change-tip.head.json'));
  const rb = fx('b1/replay.base.json');
  const rh = fx('b1/replay.head.json');
  const rep = diffFlow(rb, rh);
  return buildProof({
    mr: 42, base: 'a1b2c3d', head: 'e4f5a6b', rid: replay.rid,
    flows: [
      { flow: 'change-tip', source: 'e2e', changes: tip, routes: ['/bill/9'] },
      {
        flow: 'replay-r_20261011_8f3a2c', source: 'replay', changes: rep,
        routes: [...new Set([...rb.steps, ...rh.steps].map((s) => s.route))].sort(),
        testids: ['confirm-settle-btn', 'save-bill-btn', 'settle-btn', 'settled-banner', 'total-input'],
      },
    ],
  });
}
