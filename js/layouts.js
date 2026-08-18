// Pure layout functions. Contract 1: these receive a COUNT, never the pool, and
// never read state. That restriction is what makes changing the layout safe at
// any moment: there is nothing here that can be holding a photo.
//
// Every cell is normalised 0..1 of the canvas, so the same numbers drive the
// on-screen preview and a 4000px export.

const cell = (x, y, w, h, extra = {}) => ({ x, y, w, h, ...extra });

// Contract 1b. Cells are normalised 0..1 on BOTH axes and the compositor maps
// them with x*W, y*H. So a gap of 0.03 is 24px wide on an 800px canvas and 30px
// tall on a 1000px one: at the shipped 4:5 default every gutter and margin was
// 25% taller than it was wide. The engine cannot ask the pool how tall the canvas
// is, so aspect arrives as a plain number, exactly as spans do.
const vy = (v, ar) => v * ar;

// Grid with span packing. A photo marked as a hero occupies a 2x2 block and the
// rest flow around it, which is the single most-asked collage feature.
//
// `spans` carries shape only, never photos (contract 1a). The packer walks a
// row-major occupancy map and drops each item in the first slot that fits; a 2x2
// that cannot fit the remaining width degrades to 1x1 rather than overflowing.
function grid(n, { cols, gap, pad, ar }, spans = []) {
  const C = Math.max(1, cols);
  const occ = [];
  const free = (r, c, w, h) => {
    if (c + w > C) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) {
      if (occ[y] && occ[y][x]) return false;
    }
    return true;
  };
  const fill = (r, c, w, h) => {
    for (let y = r; y < r + h; y++) {
      occ[y] = occ[y] || [];
      for (let x = c; x < c + w; x++) occ[y][x] = 1;
    }
  };

  const placed = [];
  for (let i = 0; i < n; i++) {
    let w = spans[i] === 2 ? 2 : 1, h = w;
    if (w > C) { w = 1; h = 1; }
    let r = 0, done = false;
    while (!done) {
      for (let c = 0; c <= C - w; c++) {
        if (free(r, c, w, h)) { fill(r, c, w, h); placed.push({ r, c, w, h }); done = true; break; }
      }
      if (!done) {
        if (w > 1) { w = 1; h = 1; }   // degrade before growing the canvas
        else r++;
      }
    }
  }

  const rows = Math.max(1, ...placed.map((p) => p.r + p.h));
  const gy = vy(gap, ar), py = vy(pad, ar);
  const cw = (1 - 2 * pad + gap) / C;
  const ch = (1 - 2 * py + gy) / rows;
  return placed.map((p) => cell(
    pad + p.c * cw, py + p.r * ch, p.w * cw - gy * 0 - gap, p.h * ch - gy,
  ));
}

// Column-balanced: each photo goes to the currently shortest column, so a mixed
// set of portraits and landscapes does not leave one column stranded.
function masonry(n, { cols, gap, pad, ar }) {
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
  const py = vy(pad, ar);
  const tallest = Math.max(...heights, 0.001) - gap;
  const scale = tallest > 0 ? (1 - 2 * py) / tallest : 1;
  return placed.map((p) => cell(
    pad + p.col * (colW + gap), py + p.top * scale, p.w, p.h * scale,
  ));
}

function strip(n, { gap, pad, ar }) {
  const w = (1 - 2 * pad + gap) / Math.max(n, 1) - gap;
  const py = vy(pad, ar);
  return Array.from({ length: n }, (_, i) =>
    cell(pad + i * (w + gap), py, w, 1 - 2 * py));
}

// Shape layouts place cells along a parametric outline and carry a mask so each
// photo is clipped to a disc.
//
// Two things make a shape actually READ as its shape rather than a blob. First the
// outline is normalised to its own bounding box, so a heart fills the canvas
// instead of sitting squashed in the middle. Second the disc size is derived from
// the smallest gap between neighbouring points rather than from a photo count, so
// twelve photos tighten the discs instead of overlapping into mush.
function onCurve(n, fn, { pad, ar }) {
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
  // Square in PIXELS, not in normalised space, so the disc is a circle and the
  // compositor's min() no longer throws away one axis.
  const h = vy(size, ar), py = vy(pad, ar), Sy = 1 - 2 * py;
  const fitX = S - size, fitY = Sy - h;
  return norm.map((p) => cell(
    pad + p.x * fitX,
    py + p.y * fitY,
    size, h, { mask: 'circle' },
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

const star = (n, p) => onCurve(n, (t) => {
  // Five-pointed outline: radius alternates between the tips and the inner well.
  const a = t * Math.PI * 2 - Math.PI / 2;
  const k = (t * 10) % 2 < 1 ? 1 : 0.45;
  return { x: Math.cos(a) * k, y: Math.sin(a) * k };
}, p);

const spiral = (n, p) => onCurve(n, (t) => {
  const turns = 2.4, a = t * Math.PI * 2 * turns;
  const r = 0.14 + t * 0.86;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}, p);

const wave = (n, p) => onCurve(n, (t) => ({
  x: t * 2 - 1, y: Math.sin(t * Math.PI * 2) * 0.55,
}), p);

const FNS = { grid, masonry, strip, heart, circle, diamond, star, spiral, wave };

/**
 * Cells for `n` photos. Pure: same inputs, same cells, no state, no photos.
 * `spans` is shape only (contract 1a) and is ignored by every layout but grid.
 */
export function computeCells(n, layout, params, spans = [], ar = 1) {
  const fn = FNS[layout] || grid;
  const p = {
    cols: params.cols, gap: params.gap / 400, pad: params.pad / 400,
    ar,   // canvas width / height, contract 1b
  };
  return fn(Math.max(n, 1), p, spans);
}

/** Layouts where a column count is meaningful. */
export const USES_COLS = ['grid', 'masonry'];
/** Layouts where a photo can be a 2x2 hero. */
export const USES_SPAN = ['grid'];

/** Canvas aspect, from the `w:h` preset. */
export function aspect(ratio) {
  const [w, h] = String(ratio).split(':').map(Number);
  return (w > 0 && h > 0) ? w / h : 1;
}
