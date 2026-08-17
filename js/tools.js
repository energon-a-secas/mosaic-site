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
    const x = i % w, y = (i / w) | 0;
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (j < 0 || j >= w * h) continue;
      if (d[j * 4 + 3] === 255) d[j * 4 + 3] = 140;
    }
    void x; void y;
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
