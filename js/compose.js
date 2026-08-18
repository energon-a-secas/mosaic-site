import { PRESET_NAMES } from './filters.js';
import { drawOverlay } from './overlays.js';
export { PRESET_NAMES as FILTER_NAMES };

// One render path. Contract 3: preview and export call compose() with a different
// scale and nothing else. A separate export routine is how the preview and the
// saved file drift apart, and that drift is only discovered after the user has
// already saved something wrong.

/** Perceived lightness of a hex colour, for picking a contrasting hairline. */
function lumaOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** Draw one photo into a cell rect, honouring its own transform. */
function drawPhoto(ctx, photo, r, radius, mask) {
  // fx is the colour-corrected bitmap, baked by filters.js. ctx.filter is not
  // Baseline (Safari disables it), so colour must already be in the pixels.
  const img = photo.fx || photo.cut || photo.bitmap;
  ctx.save();
  ctx.beginPath();
  if (mask === 'circle') {
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, 0, Math.PI * 2);
  } else if (ctx.roundRect) {
    ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  } else {
    ctx.rect(r.x, r.y, r.w, r.h);
  }
  ctx.clip();

  const tf = photo.tf;
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.rotate((tf.rot * Math.PI) / 180);
  ctx.scale(tf.flipH ? -1 : 1, tf.flipV ? -1 : 1);

  // Cover the cell, then apply the photo's own zoom and offset on top.
  const base = Math.max(r.w / img.width, r.h / img.height);
  const s = base * tf.zoom;
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, -dw / 2 + tf.ox * r.w, -dh / 2 + tf.oy * r.h, dw, dh);
  ctx.restore();
}

/**
 * Render the whole collage.
 * `scale` is the only difference between what you see and what you export.
 */
export function compose(ctx, cells, placement, opts) {
  const { W, H, background, params, emptyCells = true, overlays = [] } = opts;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  cells.forEach((c, i) => {
    const r = { x: c.x * W, y: c.y * H, w: c.w * W, h: c.h * H };
    const photo = placement[i];
    if (!photo) {
      if (!emptyCells) return;
      ctx.save();
      // Keyed to the collage background, not to the theme: the canvas can be any
      // colour the user picks, so a fixed white stroke vanishes on a light one.
      ctx.strokeStyle = lumaOf(background) > 0.55 ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.20)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      if (c.mask === 'circle') {
        ctx.beginPath();
        ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, params.radius); ctx.stroke();
      } else ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
      return;
    }
    drawPhoto(ctx, photo, r, params.radius, c.mask);
  });

  // Second pass, in array order, so z-order is just the array. Same function as
  // the export path, so preview and file cannot disagree (contract 3).
  for (const o of overlays) drawOverlay(ctx, o, W, H);
  ctx.restore();
}

/** Export at an arbitrary pixel width through the same path as the preview. */
export async function exportBlob(cells, placement, opts, pxWidth, type = 'image/png') {
  const H = Math.round(pxWidth / opts.ar);
  const cv = document.createElement('canvas');
  cv.width = pxWidth; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  compose(ctx, cells, placement, {
    ...opts, W: pxWidth, H, overlays: opts.overlays || [],
    params: { ...opts.params, radius: opts.params.radius * (pxWidth / opts.previewW) },
    emptyCells: false,
  });
  return new Promise((res) => cv.toBlob(res, type, 0.94));
}
