// Pure layout functions. Contract 1: these receive a COUNT, never the pool, and
// never read state. That restriction is what makes changing the layout safe at
// any moment: there is nothing here that can be holding a photo.
//
// Every cell is normalised 0..1 of the canvas, so the same numbers drive the
// on-screen preview and a 4000px export.

const cell = (x, y, w, h, extra = {}) => ({ x, y, w, h, ...extra });

function grid(n, { cols, gap, pad }) {
  const c = Math.max(1, cols);
  const rows = Math.max(1, Math.ceil(n / c));
  const out = [];
  for (let i = 0; i < c * rows; i++) {
    const cx = i % c, cy = Math.floor(i / c);
    out.push(cell(
      pad + cx * ((1 - 2 * pad + gap) / c),
      pad + cy * ((1 - 2 * pad + gap) / rows),
      (1 - 2 * pad + gap) / c - gap,
      (1 - 2 * pad + gap) / rows - gap,
    ));
  }
  return out.slice(0, Math.max(n, 1));
}

// Column-balanced: each photo goes to the currently shortest column, so a mixed
// set of portraits and landscapes does not leave one column stranded.
function masonry(n, { cols, gap, pad }) {
  const c = Math.max(1, cols);
  const colW = (1 - 2 * pad + gap) / c - gap;
  const heights = new Array(c).fill(0);
  const placed = [];
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 1; j < c; j++) if (heights[j] < heights[k]) k = j;
    // Deterministic pseudo-variation keyed on index: layouts must stay pure, so
    // Math.random() is not available to us. Same input, same picture, always.
    const h = colW * (0.85 + ((i * 37) % 60) / 100);
    placed.push({ col: k, top: heights[k], w: colW, h });
    heights[k] += h + gap;
  }
  const tallest = Math.max(...heights, 0.001) - gap;
  const scale = tallest > 0 ? (1 - 2 * pad) / tallest : 1;
  return placed.map((p) => cell(
    pad + p.col * (colW + gap), pad + p.top * scale, p.w, p.h * scale,
  ));
}

function strip(n, { gap, pad }) {
  const w = (1 - 2 * pad + gap) / Math.max(n, 1) - gap;
  return Array.from({ length: n }, (_, i) =>
    cell(pad + i * (w + gap), pad, w, 1 - 2 * pad));
}

// Shape layouts place cells along a parametric outline and carry a mask so each
// photo is clipped to a disc.
//
// Two things make a shape actually READ as its shape rather than a blob. First the
// outline is normalised to its own bounding box, so a heart fills the canvas
// instead of sitting squashed in the middle. Second the disc size is derived from
// the smallest gap between neighbouring points rather than from a photo count, so
// twelve photos tighten the discs instead of overlapping into mush.
function onCurve(n, fn, { pad }) {
  // Sample by ARC LENGTH, not by parameter. A heart traced at uniform t bunches
  // points around the cusp, which forced the disc size down to fit the tightest
  // pair and left the rest of the outline sparse. Walking equal distances along
  // the curve spaces every photo evenly, so the discs get as large as the shape
  // allows and the outline is legible.
  const DENSE = 720;
  const walk = Array.from({ length: DENSE + 1 }, (_, i) => fn(i / DENSE));
  const cum = [0];
  for (let i = 1; i <= DENSE; i++) {
    cum[i] = cum[i - 1] + Math.hypot(walk[i].x - walk[i - 1].x, walk[i].y - walk[i - 1].y);
  }
  const total = cum[DENSE] || 1;
  const pts = Array.from({ length: n }, (_, i) => {
    if (n === 1) return walk[0];
    const target = (i / n) * total;
    let lo = 0, hi = DENSE;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
    return walk[Math.min(lo, DENSE)];
  });

  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
  // One scale for both axes keeps the shape's proportions instead of stretching it.
  const k = Math.min(1 / spanX, 1 / spanY);
  const offX = (1 - spanX * k) / 2, offY = (1 - spanY * k) / 2;
  const norm = pts.map((p) => ({
    x: offX + (p.x - minX) * k,
    y: offY + (p.y - minY) * k,
  }));

  let gap = Infinity;
  for (let i = 0; i < norm.length && norm.length > 1; i++) {
    const a = norm[i], b = norm[(i + 1) % norm.length];
    gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y));
  }
  if (!Number.isFinite(gap)) gap = 0.5;

  // Solve for the largest disc that still does not overlap its neighbour.
  // Centres sit at pad + size/2 + p*(S - size), so the on-canvas distance between
  // neighbours is gap*(S - size). Requiring that to be >= size gives
  //   size <= gap*S / (1 + gap)
  // Deriving it this way matters: sizing off `gap` alone ignores that positions
  // are compressed into the padded box afterwards, which is how the first version
  // shipped discs that overlapped at twelve photos.
  const S = 1 - 2 * pad;
  const fit = (gap * S) / (1 + gap);
  const size = Math.max(0.05, Math.min(0.30, fit * 0.97));

  const span = S - size;
  return norm.map((p) => cell(
    pad + p.x * span,
    pad + p.y * span,
    size, size, { mask: 'circle' },
  ));
}

const heart = (n, p) => onCurve(n, (t) => {
  const a = t * Math.PI * 2;
  return {
    x: 16 * Math.sin(a) ** 3,
    y: -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)),
  };
}, p);

const circle = (n, p) => onCurve(n, (t) => {
  const a = t * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}, p);

const diamond = (n, p) => onCurve(n, (t) => {
  const s = t * 4, side = Math.floor(s) % 4, f = s - Math.floor(s);
  const pts = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
  const [x1, y1] = pts[side], [x2, y2] = pts[(side + 1) % 4];
  return { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f };
}, p);

const FNS = { grid, masonry, strip, heart, circle, diamond };

/** Cells for `n` photos. Pure: same inputs, same cells, no state, no photos. */
export function computeCells(n, layout, params) {
  const fn = FNS[layout] || grid;
  const p = { cols: params.cols, gap: params.gap / 400, pad: params.pad / 400 };
  return fn(Math.max(n, 1), p);
}

/** Canvas aspect, from the `w:h` preset. */
export function aspect(ratio) {
  const [w, h] = String(ratio).split(':').map(Number);
  return (w > 0 && h > 0) ? w / h : 1;
}
