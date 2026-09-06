// Pure framing geometry: which part of the source a photo shows, and how much
// zoom a straighten needs so the cell has no empty corner.
//
// No DOM and no canvas on purpose. compose.js and the crop editor both need
// this maths and must agree exactly, and keeping it here means it can be tested
// in node without a browser, which is the only automated coverage this geometry
// gets.

/**
 * The source rectangle a crop selects, in source pixels, always inside the image.
 *
 * The clamp is not defensive tidiness. Per the canvas spec, a source rectangle
 * that hangs outside the image is clipped to the image AND the destination is
 * clipped in the same proportion, so an out-of-range crop does not fail loudly:
 * it quietly draws smaller than the cell and leaves collage background showing
 * where the photo should be. Measured at cx 0.75 with cw 0.5: half the cell.
 */
export function cropRect(tf, iw, ih) {
  const cw = Math.min(1, Math.max(1e-4, tf.cw ?? 1));
  const ch = Math.min(1, Math.max(1e-4, tf.ch ?? 1));
  const cx = Math.min(1 - cw, Math.max(0, tf.cx ?? 0));
  const cy = Math.min(1 - ch, Math.max(0, tf.cy ?? 0));
  return { sx: cx * iw, sy: cy * ih, sw: cw * iw, sh: ch * ih };
}

/**
 * The smallest zoom at which a dw x dh rectangle, rotated by `rot` degrees about
 * its centre, still covers a w x h cell centred on the same point.
 *
 * Rotating the cell by -rot into the photo's frame gives an axis-aligned
 * footprint of (w|cos| + h|sin|) by (w|sin| + h|cos|); a centred box contains a
 * centred box exactly when it contains its corners, and the footprint's extremes
 * are those corners, so this is exact rather than an upper bound.
 *
 * Cover-fit alone never hides these corners: at zoom 1 the drawn rectangle is
 * tight in one axis by construction, and any rotation needs more in that same
 * axis. Returns exactly 1 when rot is 0, so it cannot disturb an existing photo.
 */
export function coverZoom(dw, dh, w, h, rot) {
  const a = (rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return Math.max((w * c + h * s) / dw, (w * s + h * c) / dh);
}

/**
 * How far the photo may be panned before the cell shows background, in the
 * rotated frame the offset actually lives in (compose applies ox/oy inside
 * ctx.rotate, while the cell footprint stays centred on the origin).
 */
export function panLimit(dw, dh, w, h, rot) {
  const a = (rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return {
    x: Math.max(0, (dw - (w * c + h * s)) / 2),
    y: Math.max(0, (dh - (w * s + h * c)) / 2),
  };
}
