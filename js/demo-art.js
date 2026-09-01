// Procedural sample "photos" for the first-run demo collage. Eight minimal
// vector-poster scenes sharing one dusk palette (cream and amber sinking through
// coral and rose into plum, indigo and deep teal) so a collage of them reads as
// a designed set. Pure 2D canvas, fully deterministic (index-hashed jitter, no
// randomness, no clock, no DOM). Each draw() paints the full w x h area and
// leaks no context state.

const TAU = Math.PI * 2;

// Shared dusk palette, light to dark, plus the sea family.
const P = {
  cream: '#fbe6c0', gold: '#f6c778', amber: '#f2a65c', coral: '#e28366',
  rose: '#c06e78', mauve: '#8c5c84', plum: '#5c4a80', dusk: '#3b3f6f',
  indigo: '#252b56', night: '#171b38',
  seafoam: '#7fae9f', sea: '#2f6e70', teal: '#23555c', tealDark: '#16333c',
};

/** Deterministic stand-in for randomness: integer hash of (i, salt) to [0, 1). */
function rnd(i, salt = 0) {
  let x = (i * 374761393 + salt * 668265263) >>> 0;
  x = ((x ^ (x >>> 13)) * 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function lingrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

/** Vertical gradient fill over a rect. */
function vgrad(ctx, x, y, wd, ht, stops) {
  ctx.fillStyle = lingrad(ctx, y, y + ht, stops);
  ctx.fillRect(x, y, wd, ht);
}

function sky(ctx, w, h, stops) {
  vgrad(ctx, 0, 0, w, h, stops);
}

function disc(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Soft radial halo. Pass an rgba() color carrying its own alpha. */
function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(246, 199, 120, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * Silhouette landform: two stacked sine waves filled down to the bottom edge.
 * An optional crest color strokes a highlight along the top line.
 */
function ridge(ctx, w, h, baseY, amp, f1, f2, phase, color, crest) {
  const yAt = (t) => baseY
    + Math.sin(t * f1 * TAU + phase) * amp
    + Math.sin(t * f2 * TAU + phase * 2.17) * amp * 0.38;
  const N = 150;
  ctx.beginPath();
  ctx.moveTo(-8, h + 8);
  for (let i = 0; i <= N; i++) ctx.lineTo(-8 + (w + 16) * (i / N), yAt(i / N));
  ctx.lineTo(w + 8, h + 8);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (crest) {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      ctx[i ? 'lineTo' : 'moveTo'](-8 + (w + 16) * (i / N), yAt(i / N));
    }
    ctx.strokeStyle = crest;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

/** Thin wavy ribbon, used for foam lines and foreground water bands. */
function waveBand(ctx, w, y, amp, thick, phase, color) {
  const yAt = (t) => y + Math.sin(t * TAU * 2.2 + phase) * amp;
  const N = 110;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    ctx[i ? 'lineTo' : 'moveTo'](-8 + (w + 16) * (i / N), yAt(i / N));
  }
  for (let i = N; i >= 0; i--) ctx.lineTo(-8 + (w + 16) * (i / N), yAt(i / N) + thick);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Pointed leaf: two mirrored quadratic curves, rotated about its stem end. */
function leaf(ctx, x, y, len, wid, ang, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

const qAt = (t, a, c, b) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;
const qSlope = (t, a, c, b) => 2 * (1 - t) * (c - a) + 2 * t * (b - c);

/** Curved stem with alternating leaves that shrink toward the tip. */
function frondBranch(ctx, p0, pc, p1, n, len, wid, color, lw) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.quadraticCurveTo(pc[0], pc[1], p1[0], p1[1]);
  ctx.stroke();
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const x = qAt(t, p0[0], pc[0], p1[0]);
    const y = qAt(t, p0[1], pc[1], p1[1]);
    const ang = Math.atan2(qSlope(t, p0[1], pc[1], p1[1]), qSlope(t, p0[0], pc[0], p1[0]));
    const shrink = 1 - t * 0.45;
    leaf(ctx, x, y, len * shrink, wid * shrink, ang + (i % 2 ? 1.05 : -1.05), color);
  }
}

export const SAMPLES = [
  {
    name: 'ridge.png', w: 900, h: 1200,
    draw(ctx, w, h) {
      ctx.save();
      sky(ctx, w, h, [[0, P.indigo], [0.28, P.plum], [0.46, P.rose], [0.6, P.coral], [0.76, P.amber], [1, P.gold]]);
      glow(ctx, w * 0.5, h * 0.45, 330, 'rgba(251, 230, 192, 0.85)');
      disc(ctx, w * 0.5, h * 0.45, 92, P.cream);
      ridge(ctx, w, h, h * 0.57, 32, 1.3, 3.4, 0.9, P.mauve);
      ridge(ctx, w, h, h * 0.66, 40, 1.1, 2.7, 2.1, P.plum);
      ridge(ctx, w, h, h * 0.75, 46, 0.9, 2.3, 4.2, P.dusk);
      ridge(ctx, w, h, h * 0.85, 50, 0.8, 2.6, 5.6, P.indigo);
      ridge(ctx, w, h, h * 0.95, 40, 0.7, 2.1, 1.5, P.night);
      ctx.restore();
    },
  },
  {
    name: 'tide.png', w: 1200, h: 900,
    draw(ctx, w, h) {
      ctx.save();
      const hz = h * 0.52, sx = w * 0.6;
      sky(ctx, w, h, [[0, P.indigo], [0.2, P.plum], [0.34, P.mauve], [0.44, P.rose], [0.52, P.coral], [1, P.amber]]);
      glow(ctx, sx, hz - 30, 300, 'rgba(246, 199, 120, 0.9)');
      disc(ctx, sx, hz - 46, 66, P.gold);
      vgrad(ctx, 0, hz, w, h - hz, [[0, P.sea], [0.45, P.teal], [1, P.tealDark]]);
      // Broken light path, widening and fading toward the viewer.
      for (let i = 0; i < 12; i++) {
        const t = i / 11;
        const wd = 30 + t * 240;
        ctx.globalAlpha = 0.55 - t * 0.38;
        ctx.fillStyle = P.gold;
        ctx.fillRect(sx - wd / 2 + (rnd(i, 3) - 0.5) * 70 * t, hz + 8 + t * t * (h - hz - 70), wd, 4 + t * 7);
      }
      ctx.globalAlpha = 0.35;
      waveBand(ctx, w, hz + (h - hz) * 0.3, 5, 4, 1.2, P.seafoam);
      waveBand(ctx, w, hz + (h - hz) * 0.55, 7, 5, 3.8, P.seafoam);
      ctx.globalAlpha = 1;
      waveBand(ctx, w, h * 0.9, 11, h * 0.15, 2.6, P.night);
      waveBand(ctx, w, h * 0.9, 11, 6, 2.6, P.seafoam);
      ctx.restore();
    },
  },
  {
    name: 'nocturne.png', w: 900, h: 1200,
    draw(ctx, w, h) {
      ctx.save();
      const stops = [[0, P.night], [0.55, P.indigo], [1, P.dusk]];
      sky(ctx, w, h, stops);
      for (let i = 0; i < 130; i++) {
        ctx.globalAlpha = 0.25 + 0.65 * rnd(i, 5);
        disc(ctx, w * rnd(i, 1), h * 0.78 * rnd(i, 2), 1 + 1.8 * rnd(i, 4) + (i % 23 === 0 ? 1.6 : 0), P.cream);
      }
      ctx.globalAlpha = 1;
      const mx = w * 0.6, my = h * 0.2;
      disc(ctx, mx, my, 80, P.cream);
      // Carve the shadow side inside a clip, refilling with the sky's own
      // gradient, so the crescent seam is invisible and nothing outside leaks.
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, 80, 0, TAU);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(mx - 34, my - 14, 70, 0, TAU);
      ctx.fillStyle = lingrad(ctx, 0, h, stops);
      ctx.fill();
      ctx.restore();
      glow(ctx, mx + 16, my + 8, 200, 'rgba(251, 230, 192, 0.25)');
      ridge(ctx, w, h, h * 0.8, 46, 0.9, 2.4, 3.3, P.indigo);
      ridge(ctx, w, h, h * 0.92, 40, 0.8, 2.0, 0.6, P.night);
      ctx.restore();
    },
  },
  {
    name: 'skyline.png', w: 1200, h: 900,
    draw(ctx, w, h) {
      ctx.save();
      const wt = h * 0.8;
      sky(ctx, w, h, [[0, P.night], [0.3, P.indigo], [0.55, P.plum], [0.75, P.mauve], [1, P.rose]]);
      const mx = w * 0.66;
      glow(ctx, mx, h * 0.42, 320, 'rgba(246, 199, 120, 0.5)');
      disc(ctx, mx, h * 0.42, 110, P.gold);
      // Far bank of towers: hazier, shorter. The river fill trims their feet.
      for (let i = 0; i < 15; i++) {
        const u = w / 15;
        ctx.fillStyle = P.dusk;
        ctx.fillRect(i * u - u * 0.2, wt - h * (0.1 + 0.14 * rnd(i, 12)), u * (0.75 + 0.5 * rnd(i, 11)), h * 0.4);
      }
      // Near bank: tall, dark, a few spires, sparse lit windows.
      for (let i = 0; i < 9; i++) {
        const u = w / 9;
        const bw = u * (0.6 + 0.45 * rnd(i, 21));
        const bh = h * (0.16 + 0.24 * rnd(i, 22));
        const bx = i * u - u * 0.12;
        ctx.fillStyle = P.night;
        ctx.fillRect(bx, wt - bh, bw, bh);
        if (i % 3 === 1) ctx.fillRect(bx + bw / 2 - 4, wt - bh - 46 - 40 * rnd(i, 23), 8, 60);
        ctx.fillStyle = P.amber;
        const cols = Math.floor(bw / 30), rows = Math.floor(bh / 42);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (rnd(i * 131 + r * 17 + c, 31) < 0.28) {
              ctx.fillRect(bx + 12 + c * 30, wt - bh + 14 + r * 42, 9, 14);
            }
          }
        }
      }
      // River: moonlight path plus stray light from the windows.
      vgrad(ctx, 0, wt, w, h - wt, [[0, P.tealDark], [1, P.night]]);
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const wd = 24 + t * 130;
        ctx.globalAlpha = 0.45 - t * 0.28;
        ctx.fillStyle = P.gold;
        ctx.fillRect(mx - wd / 2 + (rnd(i, 41) - 0.5) * 50 * t, wt + 6 + t * (h - wt - 24), wd, 4 + t * 4);
      }
      for (let i = 0; i < 16; i++) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = P.amber;
        ctx.fillRect(w * rnd(i, 51), wt + (h - wt) * 0.85 * rnd(i, 52) + 6, 16 + 40 * rnd(i, 53), 3);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
  },
  {
    name: 'frond.png', w: 900, h: 1200,
    draw(ctx, w, h) {
      ctx.save();
      sky(ctx, w, h, [[0, P.gold], [0.5, P.amber], [1, P.coral]]);
      disc(ctx, w * 0.52, h * 0.32, 290, P.cream);
      frondBranch(ctx, [w * 0.94, h * 1.04], [w * 1.0, h * 0.42], [w * 0.5, h * 0.1], 9, 160, 48, P.teal, 10);
      frondBranch(ctx, [w * 0.06, h * 1.04], [w * 0.0, h * 0.46], [w * 0.6, h * 0.16], 11, 200, 62, P.tealDark, 14);
      for (let i = 0; i < 3; i++) {
        disc(ctx, w * (0.6 + 0.05 * i), h * (0.19 - 0.025 * i), 13 - 2 * i, P.rose);
      }
      leaf(ctx, w * 0.86, h * 1.02, 480, 140, -1.95, P.night);
      ctx.restore();
    },
  },
  {
    name: 'tessel.png', w: 1000, h: 1000,
    draw(ctx, w, h) {
      ctx.save();
      ctx.fillStyle = P.cream;
      ctx.fillRect(0, 0, w, h);
      const m = 76, gap = 24;
      const cell = (w - m * 2 - gap * 3) / 4;
      const palette = [P.indigo, P.coral, P.teal, P.plum, P.rose];
      // Hand-set motif per cell (5 is the focal eclipse); no adjacent repeats.
      const types = [0, 1, 2, 3, 2, 5, 4, 1, 1, 3, 0, 2, 4, 0, 1, 3];
      for (let i = 0; i < 16; i++) {
        const r = Math.floor(i / 4), c = i % 4;
        const x = m + c * (cell + gap), y = m + r * (cell + gap);
        // (4r + 2c) mod 5 never matches a neighbour, so colors never touch twins.
        const col = palette[(r * 4 + c * 2) % 5];
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        const k = (r + c) % 4;
        switch (types[i]) {
          case 0: {
            // Quarter disc swung out of one corner; the corner walks the grid.
            const cx = x + (k === 1 || k === 2 ? cell : 0);
            const cy = y + (k >= 2 ? cell : 0);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, cell, (k * TAU) / 4, ((k + 1) * TAU) / 4);
            ctx.closePath();
            ctx.fill();
            break;
          }
          case 1:
            ctx.beginPath();
            ctx.arc(x + cell / 2, y + cell, cell / 2, Math.PI, TAU);
            ctx.closePath();
            ctx.fill();
            break;
          case 2:
            disc(ctx, x + cell / 2, y + cell / 2, cell * 0.42, col);
            break;
          case 3: {
            const pts = [[x, y], [x + cell, y], [x + cell, y + cell], [x, y + cell]];
            const q = (r * 2 + c) % 4;
            ctx.beginPath();
            ctx.moveTo(pts[q][0], pts[q][1]);
            ctx.lineTo(pts[(q + 1) % 4][0], pts[(q + 1) % 4][1]);
            ctx.lineTo(pts[(q + 2) % 4][0], pts[(q + 2) % 4][1]);
            ctx.closePath();
            ctx.fill();
            break;
          }
          case 4:
            ctx.beginPath();
            ctx.arc(x + cell / 2, y + cell / 2, cell * 0.32, 0, TAU);
            ctx.lineWidth = cell * 0.16;
            ctx.stroke();
            break;
          case 5:
            ctx.fillStyle = P.indigo;
            ctx.fillRect(x, y, cell, cell);
            disc(ctx, x + cell / 2, y + cell / 2, cell * 0.34, P.gold);
            ctx.beginPath();
            ctx.arc(x + cell / 2, y + cell / 2, cell * 0.44, 0, TAU);
            ctx.lineWidth = 6;
            ctx.strokeStyle = P.cream;
            ctx.stroke();
            break;
        }
      }
      ctx.restore();
    },
  },
  {
    name: 'dunes.png', w: 1200, h: 900,
    draw(ctx, w, h) {
      ctx.save();
      sky(ctx, w, h, [[0, P.plum], [0.3, P.mauve], [0.52, P.rose], [0.7, P.coral], [1, P.amber]]);
      glow(ctx, w * 0.7, h * 0.42, 300, 'rgba(251, 230, 192, 0.8)');
      disc(ctx, w * 0.7, h * 0.42, 88, P.cream);
      ridge(ctx, w, h, h * 0.52, 26, 0.55, 1.6, 1.1, P.gold, P.cream);
      ridge(ctx, w, h, h * 0.62, 34, 0.5, 1.4, 3.9, P.amber, P.gold);
      ridge(ctx, w, h, h * 0.73, 40, 0.45, 1.3, 2.4, P.coral);
      ridge(ctx, w, h, h * 0.84, 44, 0.4, 1.2, 5.2, P.rose);
      ridge(ctx, w, h, h * 0.95, 36, 0.5, 1.5, 0.4, P.plum);
      ctx.restore();
    },
  },
  {
    name: 'beacon.png', w: 900, h: 1200,
    draw(ctx, w, h) {
      ctx.save();
      const hz = h * 0.6;
      sky(ctx, w, h, [[0, P.night], [0.25, P.indigo], [0.42, P.dusk], [0.54, P.mauve], [0.6, P.rose], [1, P.rose]]);
      for (let i = 0; i < 50; i++) {
        ctx.globalAlpha = 0.2 + 0.55 * rnd(i, 62);
        disc(ctx, w * rnd(i, 61), h * 0.34 * rnd(i, 63), 1 + 1.4 * rnd(i, 64), P.cream);
      }
      ctx.globalAlpha = 1;
      ridge(ctx, w, h, hz * 0.985, 10, 1.4, 3.2, 2.8, P.dusk);
      vgrad(ctx, 0, hz, w, h - hz, [[0, P.teal], [0.4, P.tealDark], [1, P.night]]);
      ctx.globalAlpha = 0.3;
      waveBand(ctx, w, hz + (h - hz) * 0.25, 4, 4, 0.8, P.seafoam);
      waveBand(ctx, w, hz + (h - hz) * 0.5, 6, 5, 3.1, P.seafoam);
      ctx.globalAlpha = 1;
      // Headland, then the tower: tapered body, bands, gallery, lamp, dome.
      const head = [[0.3, 1.01], [0.42, 0.83], [0.5, 0.755], [0.58, 0.73], [0.88, 0.725], [1.01, 0.77], [1.01, 1.01]];
      ctx.beginPath();
      head.forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](w * px, h * py));
      ctx.closePath();
      ctx.fillStyle = P.night;
      ctx.fill();
      const tx = w * 0.71, base = h * 0.728, th = h * 0.16;
      ctx.beginPath();
      ctx.moveTo(tx - 34, base);
      ctx.lineTo(tx - 20, base - th);
      ctx.lineTo(tx + 20, base - th);
      ctx.lineTo(tx + 34, base);
      ctx.closePath();
      ctx.fillStyle = P.cream;
      ctx.fill();
      ctx.fillStyle = P.indigo;
      ctx.fillRect(tx - 27, base - th * 0.62, 54, 18);
      ctx.fillRect(tx - 31, base - th * 0.28, 62, 18);
      ctx.fillStyle = P.night;
      ctx.fillRect(tx - 26, base - th - 10, 52, 10);
      ctx.fillStyle = P.amber;
      ctx.fillRect(tx - 14, base - th - 42, 28, 32);
      ctx.fillStyle = P.night;
      ctx.beginPath();
      ctx.arc(tx, base - th - 42, 16, Math.PI, TAU);
      ctx.fill();
      const ly = base - th - 26;
      glow(ctx, tx, ly, 110, 'rgba(246, 199, 120, 0.75)');
      // Beam: a wide faint fan with a brighter core, sweeping out to sea.
      ctx.fillStyle = P.gold;
      for (const [a, d1, d2] of [[0.3, -0.14, 0.05], [0.45, -0.085, -0.01]]) {
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.moveTo(tx - 12, ly);
        ctx.lineTo(-8, ly + d1 * h);
        ctx.lineTo(-8, ly + d2 * h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
  },
];
