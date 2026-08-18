// Overlays: text, bubbles and shapes that float over the collage.
//
// Contract 2a. An overlay is positioned in fractions of the CANVAS, never of a
// cell, because cells are produced by a pure layout function and destroyed on
// every parameter change. Anything anchored to a cell dies with it, which is why
// a caption cannot be a property of a photo.
//
// The text engine follows the conventions the classic image macro actually uses:
// stroke BEFORE fill (reversed, the stroke eats half the glyph and letters look
// anemic), round joins so heavy strokes do not grow miter spikes on M/W/A/V, and
// a downward search for the font size that fits both axes.

// Impact is absent on Android and most Linux; Arial Black is the heavy fallback
// that keeps the look. Never let it fall through to a regular-weight system font.
export const FONTS = {
  impact: 'Impact, Haettenschweiler, "Franklin Gothic Bold", "Arial Black", sans-serif',
  black: '"Arial Black", "Helvetica Neue", Helvetica, sans-serif',
  serif: '"Times New Roman", Times, Georgia, "Liberation Serif", serif',
  mono: '"Courier New", Courier, monospace',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

let seq = 1;

export function makeText(partial = {}) {
  return {
    id: `o${seq++}`, type: 'text',
    x: 0.06, y: 0.04, w: 0.88, h: 0.20, rot: 0,
    text: 'TOP TEXT',
    font: 'impact', color: '#ffffff', stroke: '#000000',
    strokeRatio: 0.125,     // lineWidth = fontSize/8, the middle of the range
    upper: true, align: 'center', lineHeight: 1.05,
    maxLines: 3, minSize: 7,
    ...partial,
  };
}

/** Ten generic box layouts. No template images, so nothing copyrighted ships. */
export const PRESETS = {
  'top + bottom': () => [
    makeText({ text: 'TOP TEXT', x: 0, y: 0, w: 1, h: 0.2 }),
    makeText({ text: 'BOTTOM TEXT', x: 0, y: 0.8, w: 1, h: 0.2 }),
  ],
  'top only': () => [makeText({ text: 'TOP TEXT', x: 0, y: 0, w: 1, h: 0.28 })],
  'bottom only': () => [makeText({ text: 'BOTTOM TEXT', x: 0, y: 0.72, w: 1, h: 0.28 })],
  'caption bar': () => [makeText({
    text: 'when the layout finally changes without losing your photos',
    x: 0.04, y: 0.02, w: 0.92, h: 0.16,
    font: 'sans', color: '#111111', stroke: 'none', upper: false, align: 'left',
  })],
  'two panel': () => [
    makeText({ text: 'BEFORE', x: 0, y: 0.40, w: 0.5, h: 0.1 }),
    makeText({ text: 'AFTER', x: 0.5, y: 0.40, w: 0.5, h: 0.1 }),
  ],
  'corner label': () => [makeText({
    text: 'MOSAIC', x: 0.6, y: 0.88, w: 0.36, h: 0.09, font: 'black',
  })],
};

// ── measuring ────────────────────────────────────────────────────────────────

function lines(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const out = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const t = `${cur} ${words[i]}`;
    if (ctx.measureText(t).width <= maxW || out.length + 1 >= maxLines) cur = t;
    else { out.push(cur); cur = words[i]; }
  }
  out.push(cur);
  return out.slice(0, maxLines);
}

function measure(ctx, ls) {
  let w = 0, asc = 0, desc = 0;
  for (const l of ls) {
    const m = ctx.measureText(l);
    // actualBoundingBox beats .width, which is advance width and ignores overhang.
    const lw = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0) || m.width;
    if (lw > w) w = lw;
    asc = Math.max(asc, m.actualBoundingBoxAscent || 0);
    desc = Math.max(desc, m.actualBoundingBoxDescent || 0);
  }
  return { w, asc, desc };
}

/** Largest integer size whose wrapped block fits both axes. */
function fitSize(ctx, o, boxW, boxH, family) {
  const usableW = boxW * 0.97, usableH = boxH * 0.92;
  let size = Math.floor(boxH);
  const text = o.upper ? String(o.text).toUpperCase() : String(o.text);
  while (size > o.minSize) {
    ctx.font = `${size}px ${family}`;
    const ls = lines(ctx, text, usableW, o.maxLines);
    const m = measure(ctx, ls);
    const blockH = (ls.length - 1) * size * o.lineHeight + m.asc + m.desc;
    const stroke = size * o.strokeRatio;
    if (m.w + stroke <= usableW && blockH + stroke <= usableH) return { size, ls, m };
    size -= 1;
  }
  ctx.font = `${o.minSize}px ${family}`;
  const ls = lines(ctx, text, usableW, o.maxLines);
  return { size: o.minSize, ls, m: measure(ctx, ls) };
}

// ── drawing ──────────────────────────────────────────────────────────────────

export function drawOverlay(ctx, o, W, H) {
  const r = { x: o.x * W, y: o.y * H, w: o.w * W, h: o.h * H };
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  if (o.rot) ctx.rotate((o.rot * Math.PI) / 180);

  if (o.type === 'bubble') drawBubble(ctx, o, r);

  const family = FONTS[o.font] || FONTS.impact;
  const { size, ls, m } = fitSize(ctx, o, r.w, r.h, family);
  ctx.font = `${size}px ${family}`;
  ctx.textAlign = o.align;
  // "top" is the top of the em square, not of the ink, and Impact's em box is
  // tall. Positioning by measured ascent is what actually centres the ink.
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const step = size * o.lineHeight;
  const blockH = (ls.length - 1) * step + m.asc + m.desc;
  const startY = -blockH / 2 + m.asc;
  const ax = o.align === 'left' ? -r.w / 2 + r.w * 0.02
    : o.align === 'right' ? r.w / 2 - r.w * 0.02 : 0;

  ls.forEach((line, i) => {
    const y = startY + i * step;
    if (o.stroke && o.stroke !== 'none') {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = Math.max(2, size * o.strokeRatio);
      ctx.strokeText(line, ax, y);   // stroke FIRST
    }
    ctx.fillStyle = o.color;
    ctx.fillText(line, ax, y);       // then fill, restoring the inner half
  });
  ctx.restore();
}

function drawBubble(ctx, o, r) {
  const rad = Math.min(r.w, r.h) * 0.25;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-r.w / 2, -r.h / 2, r.w, r.h, rad);
  else ctx.rect(-r.w / 2, -r.h / 2, r.w, r.h);
  // Tail continues the same path so body and tail share one outline, no seam.
  const tx = (o.tailX ?? 0.3) * r.w - r.w / 2, ty = r.h / 2;
  ctx.moveTo(tx - r.w * 0.08, ty - 1);
  ctx.lineTo(tx + r.w * 0.02, ty + r.h * 0.34);
  ctx.lineTo(tx + r.w * 0.10, ty - 1);
  ctx.closePath();
  ctx.fillStyle = o.bubbleFill || '#ffffff';
  ctx.fill();
  ctx.strokeStyle = o.bubbleStroke || '#111111';
  ctx.lineWidth = Math.max(2, Math.min(r.w, r.h) * 0.02);
  ctx.stroke();
}

/** Front-to-back hit test, so the topmost overlay wins. */
export function overlayAt(overlays, fx, fy) {
  for (let i = overlays.length - 1; i >= 0; i--) {
    const o = overlays[i];
    if (fx >= o.x && fx <= o.x + o.w && fy >= o.y && fy <= o.y + o.h) return o;
  }
  return null;
}
