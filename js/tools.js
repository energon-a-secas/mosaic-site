// Per-photo image operations that do not belong to layout or compositing.
//
// Background removal here is GEOMETRIC, not semantic: a flood fill from the edges
// with a colour tolerance. It is genuinely good on flat or evenly-lit backdrops
// (product shots, screenshots, studio portraits) and genuinely weak on hair and
// foliage. A semantic cutout needs a real segmentation model, which means a WASM
// binary and a build step; this fleet is zero-build, so that is a fleet-level
// decision rather than something to smuggle in here. See docs/delivery/PLAN.md.

import { cropRect } from './frame.js';

function toCanvas(img) {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  cv.getContext('2d').drawImage(img, 0, 0);
  return cv;
}

/**
 * Remove a flat background by flood-filling inward from every edge pixel.
 * Returns a new bitmap with alpha punched out, or null if nothing was removed.
 */
export async function removeBackground(img, tolerance = 32) {
  const cv = toCanvas(img);
  const ctx = cv.getContext('2d');
  const { width: w, height: h } = cv;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const seen = new Uint8Array(w * h);
  const stack = [];

  // Seed from all four edges: a background touches the frame, a subject usually
  // does not. Seeding from one corner alone misses a two-tone backdrop.
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }

  const sample = (i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
  const seeds = stack.slice(0, Math.min(stack.length, 400));
  let sr = 0, sg = 0, sb = 0;
  for (const i of seeds) { const [r, g, b] = sample(i); sr += r; sg += g; sb += b; }
  sr /= seeds.length; sg /= seeds.length; sb /= seeds.length;

  const tol2 = tolerance * tolerance * 3;
  let removed = 0;
  while (stack.length) {
    const i = stack.pop();
    if (i < 0 || i >= w * h || seen[i]) continue;
    const [r, g, b] = sample(i);
    const dr = r - sr, dg = g - sg, db = b - sb;
    if (dr * dr + dg * dg + db * db > tol2) continue;
    seen[i] = 1; d[i * 4 + 3] = 0; removed++;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  if (!removed) return null;

  // Soften the boundary so the cutout does not read as a sticker.
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] !== 0) continue;
    // The x guards matter: without them a pixel at x=0 feathers the PREVIOUS
    // row's last pixel, leaving stray semi-transparent dots down the far edge.
    const x = i % w;
    const nb = [];
    if (x > 0) nb.push(i - 1);
    if (x < w - 1) nb.push(i + 1);
    nb.push(i - w, i + w);
    for (const j of nb) {
      if (j < 0 || j >= w * h) continue;
      if (d[j * 4 + 3] === 255) d[j * 4 + 3] = 140;
    }
  }
  ctx.putImageData(id, 0, 0);
  return createImageBitmap(cv);
}

/**
 * The photo's strip thumbnail with its current colour baked in, so the strip
 * agrees with the canvas. At thumb size the colour pass is effectively free.
 */
export async function tintThumb(photo) {
  const { applyFx, isIdentity } = await import('./filters.js');
  const t = await makeThumb(photo.cut || photo.bitmap, 200, photo.tf);
  if (isIdentity(photo.tf)) return t;
  return (await applyFx(t, photo.tf)) || t;
}

/** Downscale for the strip, so a 12MP import does not repaint at full size. */
export async function makeThumb(img, max = 200, tf = null) {
  // The strip is a fourth render path: js/render.js drawStrip draws this thumb
  // directly and never goes through compose, so the crop has to be baked here
  // or the strip tile and the collage cell disagree about the same photo.
  const { sx, sy, sw, sh } = tf ? cropRect(tf, img.width, img.height)
                                : { sx: 0, sy: 0, sw: img.width, sh: img.height };
  const s = Math.min(1, max / Math.max(sw, sh));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw * s));
  cv.height = Math.max(1, Math.round(sh * s));
  // Hinted: a tinted thumb is read back more than once, and the canvas is tiny.
  cv.getContext('2d', { willReadFrequently: true })
    .drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return createImageBitmap(cv);
}

/**
 * Export every photo as its own square thumbnail.
 *
 * This is the "make thumbnails" half of the request, and it is a different job
 * from exporting the collage: each photo gets cropped to a square by its own
 * framing, so a batch of product shots comes out uniform. Downloads are staggered
 * because browsers throttle or silently drop a burst of them.
 */
export async function batchThumbnails(pool, size, bg, onEach) {
  const { exportThumb } = await import('./compose.js');
  let n = 0;
  for (const p of pool) {
    const blob = await exportThumb(p, size, bg);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.name.replace(/\.[^.]+$/, '')}-${size}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    onEach?.(++n, pool.length);
    // Browsers throttle or silently drop a burst of downloads.
    await new Promise((r) => setTimeout(r, 320));
  }
  return n;
}

/** Crop a photo to an aspect by adjusting its own zoom, non-destructively. */
export function fitAspect(photo, cellAr) {
  const ar = photo.bitmap.width / photo.bitmap.height;
  photo.tf.zoom = ar > cellAr ? 1 : cellAr / ar;
  photo.tf.ox = 0; photo.tf.oy = 0;
}
