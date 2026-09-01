// One-click canvas styles. A style sets the canvas: spacing, corners, border,
// background. It never touches photos, layouts or captions, so applying one is
// always safe, reversible with one undo, and composable with any layout.

export const STYLES = [
  { name: 'clean',   bg: '#ffffff', bg2: null, gap: 10, radius: 6,  pad: 28, border: 0,  borderColor: '#ffffff' },
  { name: 'gallery', bg: '#101114', bg2: null, gap: 22, radius: 0,  pad: 44, border: 0,  borderColor: '#ffffff' },
  { name: 'prints',  bg: '#e9e4da', bg2: null, gap: 18, radius: 2,  pad: 34, border: 10, borderColor: '#ffffff' },
  { name: 'sunset',  bg: '#f59e0b', bg2: '#7c3aed', angle: 160, gap: 14, radius: 12, pad: 30, border: 0, borderColor: '#ffffff' },
  { name: 'ocean',   bg: '#0ea5e9', bg2: '#0f172a', angle: 180, gap: 12, radius: 10, pad: 30, border: 0, borderColor: '#ffffff' },
  { name: 'pastel',  bg: '#fbe3ee', bg2: '#dbeafe', angle: 120, gap: 16, radius: 18, pad: 34, border: 6, borderColor: '#ffffff' },
  { name: 'noir',    bg: '#0a0a0a', bg2: null, gap: 4,  radius: 0,  pad: 12, border: 0,  borderColor: '#ffffff' },
];

export function applyStyle(state, s) {
  state.background = s.bg;
  state.bg2 = s.bg2;
  state.bgAngle = s.angle ?? 135;
  state.params.gap = s.gap;
  state.params.radius = s.radius;
  state.params.pad = s.pad;
  state.params.border = s.border;
  state.borderColor = s.borderColor;
}

/** The CSS background for a style chip's swatch, so the chip shows its result. */
export function styleSwatch(s) {
  return s.bg2 ? `linear-gradient(${s.angle ?? 135}deg, ${s.bg}, ${s.bg2})` : s.bg;
}

/** True when every photo is already black and white. */
export const allMono = (pool) =>
  pool.length > 0 && pool.every((p) => p.tf.filter === 'mono' || p.tf.filter === 'noir');

/**
 * Toggle the whole pool black and white in one step. Turning it off returns
 * every photo to no filter, which is the only honest inverse: the pre-toggle
 * per-photo filters are not stored anywhere once overwritten.
 */
export function toggleMono(pool) {
  const on = allMono(pool);
  for (const p of pool) p.tf.filter = on ? 'none' : 'mono';
  return !on;
}
