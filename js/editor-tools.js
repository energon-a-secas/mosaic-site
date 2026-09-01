// Pixel operations for the focus editor. Everything here works on plain
// canvases and ImageData: no editor state, no DOM beyond creating canvases,
// and no network. This is the "local, no services" half of manual background
// removal: every byte stays in the page.

/**
 * A canvas of the given size, optionally painted with an image scaled to fit.
 * ctxOpts matter here: context attributes only apply on the FIRST getContext
 * call, so a canvas that will be read back repeatedly must be born with
 * willReadFrequently, not hinted later.
 */
export function makeCanvas(w, h, img, ctxOpts) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', ctxOpts);
  if (img) ctx.drawImage(img, 0, 0, w, h);
  return cv;
}

/**
 * A round brush stamp: white core fading to transparent. softness 0 is a hard
 * (still anti-aliased) edge; 1 fades all the way from the centre.
 */
export function makeStamp(d, softness) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = d;
  const ctx = cv.getContext('2d');
  const r = d / 2;
  if (softness <= 0.02) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r, r, Math.max(0.5, r - 0.5), 0, Math.PI * 2);
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(r, r, r * (1 - softness), r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, d, d);
  }
  return cv;
}

/**
 * Erase the contiguous region whose ORIGINAL colour matches the clicked pixel.
 * Matching on the source keeps the selection stable no matter what is already
 * erased. Writes alpha into maskData, feathers the boundary one pixel the same
 * way the automatic edge fill does, and returns the dirty rect, or null when
 * the click removed nothing new.
 */
export function wandErase(srcData, maskData, w, h, x0, y0, tolerance) {
  const s = srcData, m = maskData.data;
  const i0 = y0 * w + x0;
  const r0 = s[i0 * 4], g0 = s[i0 * 4 + 1], b0 = s[i0 * 4 + 2];
  const tol2 = tolerance * tolerance * 3;
  // 0 = untouched, 1 = visited and rejected, 2 = removed
  const seen = new Uint8Array(w * h);
  const stack = [i0];
  let minX = x0, maxX = x0, minY = y0, maxY = y0, removed = 0;
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    const dr = s[i * 4] - r0, dg = s[i * 4 + 1] - g0, db = s[i * 4 + 2] - b0;
    if (dr * dr + dg * dg + db * db > tol2) { seen[i] = 1; continue; }
    seen[i] = 2;
    if (m[i * 4 + 3] !== 0) removed++;
    m[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    // Pre-checking seen keeps the stack from filling with duplicates, which
    // on a large flat region is the difference between MBs and hundreds of MBs.
    if (x > 0 && !seen[i - 1]) stack.push(i - 1);
    if (x < w - 1 && !seen[i + 1]) stack.push(i + 1);
    if (y > 0 && !seen[i - w]) stack.push(i - w);
    if (y < h - 1 && !seen[i + w]) stack.push(i + w);
  }
  if (!removed) return null;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      if (seen[i] !== 2) continue;
      if (x > 0 && m[(i - 1) * 4 + 3] === 255) m[(i - 1) * 4 + 3] = 140;
      if (x < w - 1 && m[(i + 1) * 4 + 3] === 255) m[(i + 1) * 4 + 3] = 140;
      if (y > 0 && m[(i - w) * 4 + 3] === 255) m[(i - w) * 4 + 3] = 140;
      if (y < h - 1 && m[(i + w) * 4 + 3] === 255) m[(i + w) * 4 + 3] = 140;
    }
  }
  // Widen by the feather ring so undo captures it too.
  const x1 = Math.max(0, minX - 1), y1 = Math.max(0, minY - 1);
  return {
    x: x1, y: y1,
    w: Math.min(w - 1, maxX + 1) - x1 + 1,
    h: Math.min(h - 1, maxY + 1) - y1 + 1,
  };
}

/** Copy the whole mask's alpha channel into a reusable flat buffer. */
export function readAlphaInto(ctx, w, h, buf) {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0, n = w * h; i < n; i++) buf[i] = d[i * 4 + 3];
}

/** The alpha channel of one rect, as a flat buffer (for redo capture). */
export function readAlphaRect(ctx, rect) {
  const d = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
  const out = new Uint8ClampedArray(rect.w * rect.h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

/** Cut one rect's alpha out of a full-image flat buffer. */
export function cropAlpha(buf, imgW, rect) {
  const out = new Uint8ClampedArray(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    const row = (rect.y + y) * imgW + rect.x;
    for (let x = 0; x < rect.w; x++) out[y * rect.w + x] = buf[row + x];
  }
  return out;
}

/**
 * Write a stored alpha rect back into the mask. Colour channels of restored
 * pixels are irrelevant: everything downstream reads the mask's alpha only.
 */
export function writeAlphaRect(ctx, rect, alpha) {
  const id = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  for (let i = 0; i < alpha.length; i++) id.data[i * 4 + 3] = alpha[i];
  ctx.putImageData(id, rect.x, rect.y);
}

/** Original pixels through the mask's alpha: the photo with its background gone. */
export function bakeCut(colorSrc, maskCv) {
  const cv = makeCanvas(maskCv.width, maskCv.height, colorSrc);
  const ctx = cv.getContext('2d');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCv, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return cv;
}

/** True when no pixel of the mask is even slightly transparent. */
export function fullyOpaque(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false;
  return true;
}
