// One render path. Contract 3: preview and export call compose() with a different
// scale and nothing else. A separate export routine is how the preview and the
// saved file drift apart, and that drift is only discovered after the user has
// already saved something wrong.

const FILTERS = {
  none: '', mono: 'grayscale(1)', warm: 'saturate(1.25) sepia(.28)',
  cool: 'saturate(1.1) hue-rotate(-12deg) brightness(1.04)',
  faded: 'contrast(.85) brightness(1.12) saturate(.8)',
  punch: 'contrast(1.25) saturate(1.35)',
};
export const FILTER_NAMES = Object.keys(FILTERS);

/**
 * A preset and the numeric sliders compose into one filter string rather than
 * fighting: the preset sets the look, the sliders trim it. Identity values are
 * dropped so an untouched photo pays no filter cost at all.
 */
export function filterString(tf) {
  const a = tf.adj || { bright: 100, contrast: 100, sat: 100 };
  const parts = [FILTERS[tf.filter] || ''];
  if (a.bright !== 100) parts.push(`brightness(${a.bright / 100})`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast / 100})`);
  if (a.sat !== 100) parts.push(`saturate(${a.sat / 100})`);
  return parts.filter(Boolean).join(' ');
}

/** Draw one photo into a cell rect, honouring its own transform. */
function drawPhoto(ctx, photo, r, radius, mask) {
  const img = photo.cut || photo.bitmap;
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
  ctx.filter = filterString(tf);
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
  const { W, H, background, params, emptyCells = true } = opts;
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
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
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
    ...opts, W: pxWidth, H,
    params: { ...opts.params, radius: opts.params.radius * (pxWidth / opts.previewW) },
    emptyCells: false,
  });
  return new Promise((res) => cv.toBlob(res, type, 0.94));
}
