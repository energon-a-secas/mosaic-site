// Geometry tests for js/frame.js. No dependencies, no DOM: `node tests/frame.test.mjs`.
//
// This is the only automated coverage Mosaic's rendering has. It exists because
// the framing maths is the part where being subtly wrong looks like a design
// choice rather than a bug: a cell that leaks background at 2 degrees, or a crop
// that quietly draws at half size, both render without throwing anything.
import { cropRect, coverZoom, panLimit } from '../js/frame.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; } else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

// Deterministic PRNG: a failing case must be reproducible, which Math.random is not.
let seed = 20260905;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const between = (lo, hi) => lo + rnd() * (hi - lo);

/** Brute force: is the w x h cell covered by a dw x dh rect rotated by rot? */
function covered(dw, dh, w, h, rot, ox = 0, oy = 0) {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  for (const [px, py] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) {
    // Into the photo's frame: undo the rotation, then remove the pan offset.
    const rx = px * c + py * s - ox;
    const ry = -px * s + py * c - oy;
    if (Math.abs(rx) > dw / 2 + 1e-9 || Math.abs(ry) > dh / 2 + 1e-9) return false;
  }
  return true;
}

// ── 1. coverZoom is exactly 1 when nothing is rotated ────────────────────────
// If this drifts, every existing photo in every saved session silently re-frames.
let worst = 0;
for (let i = 0; i < 5000; i++) {
  const w = between(40, 1600), h = between(40, 1600);
  const sw = between(200, 6000), sh = between(200, 6000);
  const base = Math.max(w / sw, h / sh);
  worst = Math.max(worst, Math.abs(coverZoom(sw * base, sh * base, w, h, 0) - 1));
}
ok('coverZoom is 1.0 at rot 0', worst < 1e-12, `worst deviation ${worst.toExponential(2)}`);

// ── 2. coverZoom is exact, not an upper bound ────────────────────────────────
// Just below it the cell must leak; at it the cell must be covered.
let tight = 0, leaks = 0;
for (let i = 0; i < 4000; i++) {
  const w = between(40, 1200), h = between(40, 1200);
  const sw = between(200, 5000), sh = between(200, 5000);
  const rot = between(-45, 45);
  const base = Math.max(w / sw, h / sh);
  const dw1 = sw * base, dh1 = sh * base;
  const z = coverZoom(dw1, dh1, w, h, rot);
  if (!covered(dw1 * z * (1 + 1e-9), dh1 * z * (1 + 1e-9), w, h, rot)) leaks++;
  if (covered(dw1 * z * (1 - 1e-6), dh1 * z * (1 - 1e-6), w, h, rot)) tight++;
}
ok('coverZoom covers at the returned zoom', leaks === 0, `${leaks} leaked`);
ok('coverZoom is minimal, not slack', tight === 0, `${tight} covered below it`);

// ── 3. cover-fit alone never hides a straighten's corners ────────────────────
// The claim the whole coverZoom exists for. Any rotation at zoom 1 must leak.
let hidden = 0;
for (const [w, h] of [[400, 400], [400, 300], [640, 360], [900, 300]]) {
  for (const rot of [1, 2, 5, 15, 45]) {
    const sw = 4032, sh = 3024;
    const base = Math.max(w / sw, h / sh);
    if (covered(sw * base, sh * base, w, h, rot)) hidden++;
  }
}
ok('zoom 1 always leaks under rotation', hidden === 0, `${hidden} cases covered without help`);

// ── 4. cropRect always lands inside the source ───────────────────────────────
// An overhanging source rect does not blank: the spec clips it AND scales the
// destination in proportion, so the cell quietly under-covers.
let outside = 0;
for (const tf of [
  { cx: 0.75, cy: 0, cw: 0.5, ch: 1 },      // overhangs right
  { cx: -0.1, cy: -0.4, cw: 0.5, ch: 0.5 }, // negative origin
  { cx: 0.2, cy: 0.2, cw: 5, ch: 5 },       // absurd size
  { cx: 0.9, cy: 0.9, cw: 0, ch: 0 },       // degenerate, spec says nothing paints
  {},                                        // no crop at all
]) {
  const { sx, sy, sw, sh } = cropRect(tf, 4000, 3000);
  if (sx < -1e-9 || sy < -1e-9 || sw <= 0 || sh <= 0 ||
      sx + sw > 4000 + 1e-9 || sy + sh > 3000 + 1e-9) outside++;
}
ok('cropRect stays inside the source', outside === 0, `${outside} escaped`);

const full = cropRect({}, 4000, 3000);
ok('no crop means the whole photo',
   full.sx === 0 && full.sy === 0 && full.sw === 4000 && full.sh === 3000);

// A photo saved before crop existed must frame identically.
const legacy = cropRect({ zoom: 1.4, ox: 0.2, rot: 0 }, 1234, 987);
ok('a pre-crop session defaults to full frame',
   legacy.sw === 1234 && legacy.sh === 987);

// ── 5. panLimit matches brute-force corner containment ───────────────────────
let panWrong = 0;
for (let i = 0; i < 3000; i++) {
  const w = between(40, 900), h = between(40, 900);
  const rot = between(-45, 45);
  const sw = between(200, 4000), sh = between(200, 4000);
  const base = Math.max(w / sw, h / sh);
  const z = Math.max(1.05, coverZoom(sw * base, sh * base, w, h, rot) * between(1, 1.6));
  const dw = sw * base * z, dh = sh * base * z;
  const lim = panLimit(dw, dh, w, h, rot);
  if (!covered(dw, dh, w, h, rot, lim.x * 0.999, lim.y * 0.999)) panWrong++;   // inside: must cover
  if (lim.x > 1 && covered(dw, dh, w, h, rot, lim.x * 1.02, 0)) panWrong++;    // outside: must leak
}
ok('panLimit is the exact pan boundary', panWrong === 0, `${panWrong} disagreements`);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
