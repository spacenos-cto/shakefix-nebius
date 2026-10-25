// Pixel diff helper (pixelmatch, threshold 0.1). Used only to flag visual-only changes.

import pixelmatch from 'pixelmatch';
import pngjs from 'pngjs';

const { PNG } = pngjs;

function crop(png, w, h) {
  if (png.width === w && png.height === h) return png.data;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) png.data.copy(out, y * w * 4, y * png.width * 4, y * png.width * 4 + w * 4);
  return out;
}

/** Number of differing pixels between two PNG buffers (size mismatch adds the non-overlapping area). */
export function pixelDiffCount(bufA, bufB, threshold = 0.1) {
  if (!bufA || !bufB) return 0;
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const overlap = pixelmatch(crop(a, w, h), crop(b, w, h), null, w, h, { threshold });
  const extra = Math.abs(a.width * a.height - b.width * b.height);
  return overlap + extra;
}
