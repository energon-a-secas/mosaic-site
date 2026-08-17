// The model. One rule governs everything here, and it is the reason this tool
// exists: a layout NEVER owns photos. See docs/delivery/CONTRACTS.md, contract 1.
//
// The tool this replaces binds photos to a layout when you submit them, so asking
// for a fourth column after placing three photos has nowhere to put them and the
// app refuses. Here the pool is the truth, the layout is a pure function of how
// many photos there are, and placement is re-derived on every change.

export const LAYOUTS = ['grid', 'masonry', 'strip', 'heart', 'circle', 'diamond'];

export const state = {
  pool: [],              // Photo[] — ordered, stable ids, layout-agnostic
  overrides: new Map(),  // cellIndex -> photoId, only explicit user swaps
  layout: 'grid',
  params: { cols: 3, gap: 12, radius: 8, pad: 24, ratio: '4:5' },
  background: '#0f1214',
  selected: null,        // photoId
  nextId: 1,
};

export function addPhoto({ bitmap, name, w, h }) {
  const photo = {
    id: `p${state.nextId++}`,
    name, bitmap, w, h,
    // Contract 2: framing lives on the photo, so it survives every layout change.
    tf: { zoom: 1, ox: 0, oy: 0, rot: 0, flipH: false, flipV: false, filter: 'none' },
    cut: null,           // background-removed bitmap, when the user has made one
  };
  state.pool.push(photo);
  return photo;
}

export function removePhoto(id) {
  const i = state.pool.findIndex((p) => p.id === id);
  if (i < 0) return;
  state.pool.splice(i, 1);
  for (const [cell, pid] of [...state.overrides]) {
    if (pid === id) state.overrides.delete(cell);
  }
  if (state.selected === id) state.selected = null;
}

export function movePhoto(from, to) {
  if (to < 0 || to >= state.pool.length) return;
  const [p] = state.pool.splice(from, 1);
  state.pool.splice(to, 0, p);
}

/** The photo shown in each cell. Overrides win; everything else falls in pool order. */
export function resolvePlacement(cellCount) {
  const taken = new Set();
  const out = new Array(cellCount).fill(null);
  for (let i = 0; i < cellCount; i++) {
    const pid = state.overrides.get(i);
    const p = pid && state.pool.find((x) => x.id === pid);
    if (p) { out[i] = p; taken.add(p.id); }
  }
  const rest = state.pool.filter((p) => !taken.has(p.id));
  let k = 0;
  for (let i = 0; i < cellCount; i++) if (!out[i] && k < rest.length) out[i] = rest[k++];
  return out;
}

/**
 * Swap what is in two cells. Recorded as overrides so the arrangement survives a
 * layout change; overrides for cells that stop existing are deliberately KEPT, so
 * going 4 -> 3 -> 4 columns returns you to the arrangement you had.
 */
export function swapCells(a, b, placement) {
  const pa = placement[a], pb = placement[b];
  if (pa) state.overrides.set(b, pa.id); else state.overrides.delete(b);
  if (pb) state.overrides.set(a, pb.id); else state.overrides.delete(a);
}

export const byId = (id) => state.pool.find((p) => p.id === id) || null;
export const selectedPhoto = () => byId(state.selected);
