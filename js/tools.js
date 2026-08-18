// Per-photo image operations that do not belong to layout or compositing.
//
// Background removal here is GEOMETRIC, not semantic: a flood fill from the edges
// with a colour tolerance. It is genuinely good on flat or evenly-lit backdrops
// (product shots, screenshots, studio portraits) and genuinely weak on hair and
// foliage. A semantic cutout needs a real segmentation model, which means a WASM
// binary and a build step; this fleet is zero-build, so that is a fleet-level
// decision rather than something to smuggle in here. See docs/delivery/PLAN.md.

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

/** Downscale for the strip, so a 12MP import does not repaint at full size. */
export async function makeThumb(img, max = 200) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * s));
  cv.height = Math.max(1, Math.round(img.height * s));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
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
export async function batchThumbnails(pool, size, onEach) {
  let n = 0;
  for (const p of pool) {
    const img = p.fx || p.cut || p.bitmap;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const c = cv.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.save();
    c.translate(size / 2, size / 2);
    c.rotate((p.tf.rot * Math.PI) / 180);
    c.scale(p.tf.flipH ? -1 : 1, p.tf.flipV ? -1 : 1);
    const s = Math.max(size / img.width, size / img.height) * p.tf.zoom;
    c.drawImage(img, -img.width * s / 2 + p.tf.ox * size,
      -img.height * s / 2 + p.tf.oy * size, img.width * s, img.height * s);
    c.restore();
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png', 0.94));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.name.replace(/\.[^.]+$/, '')}-${size}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    onEach?.(++n, pool.length);
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
