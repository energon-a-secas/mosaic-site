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

/** The clip/stroke path for one cell rect. Shared by photo, border and shadow. */
function cellPath(ctx, r, radius, mask) {
  ctx.beginPath();
  if (mask === 'circle') {
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, 0, Math.PI * 2);
  } else if (ctx.roundRect) {
    ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  } else {
    ctx.rect(r.x, r.y, r.w, r.h);
  }
}

/** Solid colour or a two-stop linear gradient, angle in CSS degrees (0 = up). */
function bgPaint(ctx, background, bg2, bgAngle, W, H) {
  if (!bg2 || bg2 === background) return background;
  const a = (((bgAngle ?? 135) % 360) * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const L = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
  const g = ctx.createLinearGradient(
    W / 2 - dx * L, H / 2 - dy * L, W / 2 + dx * L, H / 2 + dy * L);
  g.addColorStop(0, background);
  g.addColorStop(1, bg2);
  return g;
}

/** Draw one photo into a cell rect, honouring its own transform. */
function drawPhoto(ctx, photo, r, radius, mask) {
  // fx is the colour-corrected bitmap, baked by filters.js. ctx.filter is not
  // Baseline (Safari disables it), so colour must already be in the pixels.
  const img = photo.fx || photo.cut || photo.bitmap;
  ctx.save();
  cellPath(ctx, r, radius, mask);
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
  const { W, H, background, bg2, bgAngle, borderColor, params,
          emptyCells = true, overlays = [] } = opts;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = bgPaint(ctx, background, bg2, bgAngle, W, H);
  ctx.fillRect(0, 0, W, H);

  const border = params.border || 0;
  cells.forEach((c, i) => {
    let r = { x: c.x * W, y: c.y * H, w: c.w * W, h: c.h * H };
    ctx.save();
    // Scatter cells arrive rotated; everything below draws in the cell's own
    // frame so photo, shadow and border all tilt together.
    if (c.rot) {
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.rotate((c.rot * Math.PI) / 180);
      r = { x: -r.w / 2, y: -r.h / 2, w: r.w, h: r.h };
    }
    const photo = placement[i];
    if (!photo) {
      if (emptyCells) {
        // Keyed to the collage background, not to the theme: the canvas can be
        // any colour the user picks, so a fixed white stroke vanishes on a light one.
        ctx.strokeStyle = lumaOf(background) > 0.55 ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.20)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        cellPath(ctx, r, params.radius, c.mask);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    // A rotated or bordered cell reads as a physical print, so it gets paper
    // (the border colour) and a soft shadow under it. Sized off W so the export
    // carries the same look as the preview.
    if (c.rot !== undefined || border > 0) {
      // Shadow blur and offset ignore the CTM (per spec), so scale them by the
      // device ratio: the preview draws under a dpr transform, exports do not,
      // and without this the preview shows half the export's shadow on HiDPI.
      const dev = ctx.canvas.width / W;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.28)';
      ctx.shadowBlur = W * 0.012 * dev;
      ctx.shadowOffsetY = W * 0.004 * dev;
      cellPath(ctx, r, params.radius, c.mask);
      ctx.fillStyle = borderColor || '#ffffff';
      ctx.fill();
      ctx.restore();
    }
    drawPhoto(ctx, photo, r, params.radius, c.mask);
    // Selection ring: preview-only chrome. drawStage passes selectedId, the
    // export paths never do, so the ring can never land in a saved file.
    if (opts.selectedId && photo.id === opts.selectedId) {
      ctx.save();
      cellPath(ctx, r, params.radius, c.mask);
      ctx.clip();
      ctx.strokeStyle = '#f43f5e';   // the site accent
      ctx.lineWidth = 5;             // clipped to the inside: 2.5px visible
      ctx.stroke();
      ctx.restore();
    }
    if (border > 0) {
      // Stroke clipped to the cell: a centred stroke's outer half is cut away,
      // leaving a true inner border that never widens the gap.
      ctx.save();
      cellPath(ctx, r, params.radius, c.mask);
      ctx.clip();
      ctx.strokeStyle = borderColor || '#ffffff';
      ctx.lineWidth = border * 2;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  });

  // Second pass, in array order, so z-order is just the array. Same function as
  // the export path, so preview and file cannot disagree (contract 3).
  for (const o of overlays) drawOverlay(ctx, o, W, H);
  ctx.restore();
}

/**
 * One photo, square, through the SAME renderer as everything else.
 *
 * batchThumbnails used to reimplement the transform maths by hand, which made it
 * a third render path in a codebase whose contract 3 says there is one. It
 * silently lacked masks and corner radius, and would have silently lacked
 * captions the moment overlays shipped. A single full-bleed cell fed to compose()
 * gets all of that for free and cannot drift again.
 */
export async function exportThumb(photo, size, bg) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  compose(ctx, [{ x: 0, y: 0, w: 1, h: 1 }], [photo], {
    W: size, H: size,
    background: bg.background, bg2: bg.bg2, bgAngle: bg.bgAngle,
    params: { radius: 0 },   // full-bleed crop: no corner, and no border either
    emptyCells: false,
    overlays: [],   // a per-photo thumbnail is not the collage
  });
  return new Promise((res) => cv.toBlob(res, 'image/png', 0.94));
}

/** Export at an arbitrary pixel width through the same path as the preview. */
export async function exportBlob(cells, placement, opts, pxWidth, type = 'image/png') {
  const H = Math.round(pxWidth / opts.ar);
  const cv = document.createElement('canvas');
  cv.width = pxWidth; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const k = pxWidth / opts.previewW;
  compose(ctx, cells, placement, {
    ...opts, W: pxWidth, H, overlays: opts.overlays || [],
    params: { ...opts.params,
      radius: opts.params.radius * k,
      border: (opts.params.border || 0) * k },
    emptyCells: false,
  });
  return new Promise((res) => cv.toBlob(res, type, 0.94));
}
