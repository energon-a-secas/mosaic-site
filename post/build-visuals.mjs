// Diagrams for the Mosaic post. Every layout rectangle is produced by calling
// the site's own engine at build time, and the colour pass names come from the
// same module the app ships. A diagram here cannot disagree with the code
// without failing to build.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCells, aspect } from '../js/layouts.js';
import { PRESET_NAMES } from '../js/filters.js';
import { frame, heading, footnote, esc, INK, DIM, MUTE, LINE, ACCENT } from './diagram-kit.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));

// The only values that cannot be imported, in one place:
// PHOTO is a 12MP phone frame (4032x3024); BRUSH is the editor's default
// brush diameter (js/editor.js session default, not exported).
const PHOTO = { w: 4032, h: 3024 };
const BRUSH = 48;

// ── 03: one pool, three engines ──────────────────────────────────────────────
// Eight photos through grid, heart and scatter. The cells below are the real
// output of computeCells(), scaled onto three mini canvases.
function pureLayouts() {
  const W = 1560, H = 780;
  const params = { cols: 3, gap: 12, pad: 24 };
  const ar = aspect('3:2');
  const mini = { w: 420, h: 280, y: 300 };
  const xs = [90, 570, 1050];
  const names = ['grid', 'heart', 'scatter'];
  let body = heading(90, 96, 'mosaic', 'One pool, three engines',
    'The same eight photos; only the layout function changes');

  names.forEach((name, i) => {
    const cells = computeCells(8, name, params, [], ar);
    const ox = xs[i], oy = mini.y;
    let g = `<rect x="${ox}" y="${oy}" width="${mini.w}" height="${mini.h}" rx="12" fill="rgba(255,255,255,.04)" stroke="${LINE}"/>`;
    cells.forEach((c) => {
      const x = ox + c.x * mini.w, y = oy + c.y * mini.h;
      const w = c.w * mini.w, h = c.h * mini.h;
      if (c.mask === 'circle') {
        const r = Math.min(w, h) / 2;
        g += `<circle cx="${(x + w / 2).toFixed(1)}" cy="${(y + h / 2).toFixed(1)}" r="${r.toFixed(1)}" fill="${ACCENT}" fill-opacity=".28" stroke="${ACCENT}" stroke-width="2"/>`;
      } else if (c.rot) {
        g += `<g transform="rotate(${c.rot} ${(x + w / 2).toFixed(1)} ${(y + h / 2).toFixed(1)})"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${ACCENT}" fill-opacity=".2" stroke="${ACCENT}" stroke-width="2"/></g>`;
      } else {
        g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${ACCENT}" fill-opacity=".28" stroke="${ACCENT}" stroke-width="2"/>`;
      }
    });
    g += `<text x="${ox + mini.w / 2}" y="${oy + mini.h + 46}" text-anchor="middle" fill="${INK}" font-size="26" font-weight="600">${esc(name)}</text>`;
    body += g;
  });

  body += footnote(90, H - 40,
    'Every shape above is the output of computeCells() from js/layouts.js, called at build time.');
  return frame(W, H, body);
}

// ── 01: three canvases ───────────────────────────────────────────────────────
// The editor model: source is never modified, tools write only the mask, the
// view is one composite. The colour chip row is imported from filters.js.
function threeCanvases() {
  const W = 1560, H = 900;
  const bx = [110, 610, 1110], bw = 340, bh = 240, by = 280;
  const boxes = [
    { t: 'SOURCE', s: 'original pixels', d: 'never modified' },
    { t: 'MASK', s: 'alpha only', d: 'opaque = kept' },
    { t: 'VIEW', s: 'source through mask', d: 'what you see' },
  ];
  let body = heading(110, 96, 'the editor', 'A cutout is an opinion about alpha',
    'Tools argue with the mask; the photo itself is never touched');

  boxes.forEach((b, i) => {
    body += `
    <rect x="${bx[i]}" y="${by}" width="${bw}" height="${bh}" rx="16" fill="rgba(255,255,255,.05)" stroke="${LINE}" stroke-width="1.5"/>
    <text x="${bx[i] + bw / 2}" y="${by + 74}" text-anchor="middle" fill="${ACCENT}" font-size="30" font-weight="700" letter-spacing="2">${esc(b.t)}</text>
    <text x="${bx[i] + bw / 2}" y="${by + 122}" text-anchor="middle" fill="${INK}" font-size="24">${esc(b.s)}</text>
    <text x="${bx[i] + bw / 2}" y="${by + 158}" text-anchor="middle" fill="${MUTE}" font-size="21">${esc(b.d)}</text>`;
  });
  const arrow = (x1, x2, y, label) => `
    <line x1="${x1}" y1="${y}" x2="${x2 - 14}" y2="${y}" stroke="${DIM}" stroke-width="2.5"/>
    <path d="M ${x2 - 14} ${y - 7} L ${x2} ${y} L ${x2 - 14} ${y + 7} Z" fill="${DIM}"/>
    <text x="${(x1 + x2) / 2}" y="${y - 16}" text-anchor="middle" fill="${MUTE}" font-size="19">${esc(label)}</text>`;
  body += arrow(bx[0] + bw, bx[1], by + bh / 2, 'colour pass reads it');
  body += arrow(bx[1] + bw, bx[2], by + bh / 2, 'destination-in');

  // What writes the mask
  const tools = ['erase brush: alpha down', 'restore brush: alpha up', 'wand: flood fill to zero', 'auto: edge fill to zero'];
  body += `
    <line x1="${bx[1] + bw / 2}" y1="${by + bh + 40}" x2="${bx[1] + bw / 2}" y2="${by + bh + 8}" stroke="${DIM}" stroke-width="2.5"/>
    <path d="M ${bx[1] + bw / 2 - 7} ${by + bh + 22} L ${bx[1] + bw / 2} ${by + bh + 8} L ${bx[1] + bw / 2 + 7} ${by + bh + 22} Z" fill="${DIM}"/>`;
  tools.forEach((t, i) => {
    body += `<text x="${bx[1] + bw / 2}" y="${by + bh + 84 + i * 38}" text-anchor="middle" fill="${DIM}" font-size="21">${esc(t)}</text>`;
  });

  // Colour presets, straight from the shipped module
  body += `<text x="${bx[0]}" y="${by + bh + 120}" fill="${MUTE}" font-size="19">colour presets, imported</text>`;
  body += `<text x="${bx[0]}" y="${by + bh + 150}" fill="${MUTE}" font-size="19">from js/filters.js:</text>`;
  body += `<text x="${bx[0]}" y="${by + bh + 190}" fill="${INK}" font-size="21" font-weight="600">${esc(PRESET_NAMES.join(' · '))}</text>`;

  body += footnote(110, H - 40,
    'Done bakes source x mask into the collage; Save exports it alone. Both read the same mask.');
  return frame(W, H, body);
}

// ── 02: what one undo step costs ─────────────────────────────────────────────
// Bars computed from the photo dimensions above; the claim is the sliver.
function undoCost() {
  const W = 1560, H = 760;
  const MB = (n) => n / (1024 * 1024);
  const fullRGBA = MB(PHOTO.w * PHOTO.h * 4);
  const fullAlpha = MB(PHOTO.w * PHOTO.h);
  // A representative stroke: the default brush swept a third of the frame,
  // bounding box widened by the stamp radius the way strokeEnd() does.
  const stroke = { w: PHOTO.w / 3 + BRUSH + 4, h: (BRUSH + 4) * 2 };
  const diff = MB(stroke.w * stroke.h);

  const rows = [
    { label: 'full RGBA snapshot', v: fullRGBA, note: 'the naive undo' },
    { label: 'alpha only, full frame', v: fullAlpha, note: 'better, still per stroke' },
    { label: 'alpha diff, stroke box', v: diff, note: 'what Mosaic stores' },
  ];
  const x = 470, bwMax = 860, y0 = 300, gap = 130, bh = 52;
  let body = heading(110, 96, 'undo', 'What one brush stroke costs to remember',
    `On a ${(PHOTO.w * PHOTO.h / 1e6).toFixed(0)} megapixel photo, ${PHOTO.w} x ${PHOTO.h}`);

  rows.forEach((r, i) => {
    const y = y0 + i * gap;
    const w = Math.max(6, (r.v / fullRGBA) * bwMax);
    body += `
    <text x="${x - 34}" y="${y + bh * 0.62}" text-anchor="end" fill="${INK}" font-size="24" font-weight="600">${esc(r.label)}</text>
    <rect x="${x}" y="${y}" width="${bwMax}" height="${bh}" rx="9" fill="rgba(255,255,255,.05)"/>
    <rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="${bh}" rx="9" fill="${ACCENT}" fill-opacity="${i === 2 ? '1' : '.55'}"/>
    <text x="${x + bwMax + 28}" y="${y + bh * 0.68}" fill="${i === 2 ? INK : DIM}" font-size="26" font-weight="700">${r.v >= 1 ? r.v.toFixed(1) + ' MB' : (r.v * 1024).toFixed(0) + ' KB'}</text>
    <text x="${x}" y="${y + bh + 34}" fill="${MUTE}" font-size="19">${esc(r.note)}</text>`;
  });

  body += footnote(110, H - 40,
    `Computed at build: width x height x bytes. The stroke box is the default ${BRUSH}px brush swept a third of the frame.`);
  return frame(W, H, body);
}

const files = {
  '01-three-canvases.svg': threeCanvases(),
  '02-undo-cost.svg': undoCost(),
  '03-pure-layouts.svg': pureLayouts(),
};
for (const [name, svg] of Object.entries(files)) {
  writeFileSync(join(OUT, name), svg);
  console.log(`wrote ${name} ${(svg.length / 1024).toFixed(1)}kb`);
}
