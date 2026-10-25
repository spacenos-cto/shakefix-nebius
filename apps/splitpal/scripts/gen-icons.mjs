// Generates the SplitPal PWA icons (PNG) with no dependencies.
// Design: ink-black rounded square, fire-orange disc cut by a cream diagonal "split" bar.
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const INK = [0x11, 0x11, 0x11];
const FIRE = [0xe8, 0x5d, 0x26];
const CREAM = [0xf0, 0xec, 0xe5];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** maskable: full-bleed background (safe zone respected), else rounded corners with transparency. */
function icon(size, { maskable = false } = {}) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const radius = size * (maskable ? 0.3 : 0.36);
  const corner = size * 0.22;
  const bar = size * 0.045;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let a = 255;
      if (!maskable) {
        const dx = Math.max(corner - px, 0, px - (size - corner));
        const dy = Math.max(corner - py, 0, py - (size - corner));
        if (Math.hypot(dx, dy) > corner) a = 0;
      }
      let col = INK;
      const inDisc = Math.hypot(px - c, py - c) <= radius;
      // diagonal bar from bottom-left to top-right through the centre
      const distToDiag = Math.abs(px - c + (py - c)) / Math.SQRT2;
      if (inDisc) col = distToDiag <= bar ? CREAM : FIRE;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = col[0];
      raw[i + 1] = col[1];
      raw[i + 2] = col[2];
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'icon-192.png': icon(192),
  'icon-512.png': icon(512),
  'maskable-512.png': icon(512, { maskable: true }),
  'apple-touch-icon.png': icon(180, { maskable: true }),
};
for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(outDir, name), buf);
  console.log(`wrote public/icons/${name} (${buf.length} bytes)`);
}
