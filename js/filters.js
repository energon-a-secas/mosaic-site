// Pixel-level colour pipeline.
//
// This exists because `ctx.filter` is NOT Baseline: caniuse puts it at 79.9%
// global, and Safari has it *disabled by default* through 26.5 on both desktop
// and iOS. Building filters on it means every iPhone silently renders photos
// unfiltered, with no error to notice. The first version of this app did exactly
// that, and one-engine testing did not catch it.
//
// So colour is done by hand: a 4x5 colour matrix (the same maths SVG
// feColorMatrix uses) composed with brightness and contrast, applied over
// ImageData. Works in every engine, and is exact at export size.

const IDENTITY = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];

/** a then b, as one matrix. */
function mul(b, a) {
  const out = new Array(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      out[r * 5 + c] =
        b[r * 5 + 0] * a[0 * 5 + c] +
        b[r * 5 + 1] * a[1 * 5 + c] +
        b[r * 5 + 2] * a[2 * 5 + c] +
        b[r * 5 + 3] * a[3 * 5 + c] +
        (c === 4 ? b[r * 5 + 4] : 0);
    }
  }
  return out;
}

// Luminance coefficients per the filter-effects spec.
const LR = 0.2126, LG = 0.7152, LB = 0.0722;

const saturate = (s) => [
  LR + (1 - LR) * s, LG - LG * s,       LB - LB * s,       0, 0,
  LR - LR * s,       LG + (1 - LG) * s, LB - LB * s,       0, 0,
  LR - LR * s,       LG - LG * s,       LB + (1 - LB) * s, 0, 0,
  0, 0, 0, 1, 0,
];

const grayscale = (a) => saturate(1 - a);

const sepia = (a) => [
  0.393 + 0.607 * (1 - a), 0.769 - 0.769 * (1 - a), 0.189 - 0.189 * (1 - a), 0, 0,
  0.349 - 0.349 * (1 - a), 0.686 + 0.314 * (1 - a), 0.168 - 0.168 * (1 - a), 0, 0,
  0.272 - 0.272 * (1 - a), 0.534 - 0.534 * (1 - a), 0.131 + 0.869 * (1 - a), 0, 0,
  0, 0, 0, 1, 0,
];

function hueRotate(deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [
    LR + c * (1 - LR) + s * (-LR),     LG + c * (-LG) + s * (-LG),      LB + c * (-LB) + s * (1 - LB),     0, 0,
    LR + c * (-LR) + s * (0.143),      LG + c * (1 - LG) + s * (0.140), LB + c * (-LB) + s * (-0.283),     0, 0,
    LR + c * (-LR) + s * (-(1 - LR)),  LG + c * (-LG) + s * (LG),       LB + c * (1 - LB) + s * (LB),      0, 0,
    0, 0, 0, 1, 0,
  ];
}

// Warm/cool white balance: push red up and blue down (or the reverse) around
// the axis a photographer's temperature slider uses. t is -1..1.
const temperature = (t) => [
  1 + 0.24 * t, 0, 0, 0, 0,
  0, 1 + 0.05 * t, 0, 0, 0,
  0, 0, 1 - 0.24 * t, 0, 0,
  0, 0, 0, 1, 0,
];

// The presets, expressed as matrices instead of CSS filter strings.
const PRESETS = {
  none:  () => IDENTITY,
  mono:  () => grayscale(1),
  noir:  () => grayscale(1),
  warm:  () => mul(sepia(0.28), saturate(1.25)),
  cool:  () => mul(hueRotate(-12), saturate(1.1)),
  faded: () => saturate(0.8),
  punch: () => saturate(1.35),
};
export const PRESET_NAMES = Object.keys(PRESETS);

// Brightness and contrast are scalar, so they ride alongside the matrix rather
// than inside it; contrast pivots around mid-grey the way the CSS filter does.
const EXTRA = {
  noir:  { bright: 1.02, contrast: 1.38 },
  faded: { bright: 1.12, contrast: 0.85 },
  cool:  { bright: 1.04, contrast: 1 },
  punch: { bright: 1, contrast: 1.25 },
};

/** A stable signature, so a cached render is only rebuilt when something changed. */
export function fxKey(tf) {
  const a = tf.adj || {};
  return `${tf.filter}|${a.bright}|${a.contrast}|${a.sat}|${a.temp || 0}`;
}

/** True when the photo needs no colour work at all, so we can skip the pass. */
export function isIdentity(tf) {
  const a = tf.adj || {};
  return (!tf.filter || tf.filter === 'none') &&
    a.bright === 100 && a.contrast === 100 && a.sat === 100 && !(a.temp || 0);
}

/**
 * Bake filter + adjustments into a new bitmap.
 * Called only when the signature changes, never per frame.
 */
export async function applyFx(img, tf) {
  if (isIdentity(tf)) return null;

  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = id.data;

  const adj = tf.adj || { bright: 100, contrast: 100, sat: 100, temp: 0 };
  let m = (PRESETS[tf.filter] || PRESETS.none)();
  if (adj.sat !== 100) m = mul(saturate(adj.sat / 100), m);
  if (adj.temp) m = mul(temperature(adj.temp / 100), m);

  const ex = EXTRA[tf.filter] || { bright: 1, contrast: 1 };
  const bright = (adj.bright / 100) * ex.bright;
  const contrast = (adj.contrast / 100) * ex.contrast;
  const inter = 0.5 * (1 - contrast) * 255;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let nr = m[0] * r + m[1] * g + m[2] * b + m[4] * 255;
    let ng = m[5] * r + m[6] * g + m[7] * b + m[9] * 255;
    let nb = m[10] * r + m[11] * g + m[12] * b + m[14] * 255;
    nr = nr * bright * contrast + inter;
    ng = ng * bright * contrast + inter;
    nb = nb * bright * contrast + inter;
    d[i]     = nr < 0 ? 0 : nr > 255 ? 255 : nr;
    d[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
    d[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
  }
  ctx.putImageData(id, 0, 0);
  return createImageBitmap(cv);
}
