// Undo/redo over the editable model.
//
// Snapshots copy the arrangement and retain references to photos and their
// cached pixels, never duplicate pixel buffers. This lets undo restore a
// removed photo or cutout. References expire with the bounded history.

const MAX = 60;
let past = [], future = [], suspended = false;

function snapshot(state) {
  return {
    order: state.pool.map((p) => p.id),
    photos: state.pool.map((p) => ({
      id: p.id, span: p.span,
      // Retain references, not copies of pixel buffers. Removed photos can be
      // restored, and the bounded history releases them as entries expire.
      photo: p, cut: p.cut, cutBlob: p.cutBlob, fx: p.fx, fxKey: p.fxKey, thumb: p.thumb,
      tf: { ...p.tf, adj: { ...p.tf.adj } },
    })),
    overrides: [...state.overrides],
    overlays: state.overlays.map((o) => ({ ...o })),
    selectedOverlay: state.selectedOverlay,
    layout: state.layout,
    params: { ...state.params },
    background: state.background,
    bg2: state.bg2,
    bgAngle: state.bgAngle,
    borderColor: state.borderColor,
    selected: state.selected,
  };
}

function restore(state, snap) {
  const byId = new Map(state.pool.map((p) => [p.id, p]));
  for (const rec of snap.photos) byId.set(rec.id, rec.photo);
  state.pool = snap.order.map((id) => byId.get(id)).filter(Boolean);
  for (const rec of snap.photos) {
    const p = byId.get(rec.id);
    if (!p) continue;
    p.span = rec.span;
    p.tf = { ...rec.tf, adj: { ...rec.tf.adj } };
    p.cut = rec.cut; p.cutBlob = rec.cutBlob;
    p.fx = rec.fx; p.fxKey = rec.fxKey; p.thumb = rec.thumb;
  }
  state.overrides = new Map(snap.overrides);
  state.overlays = (snap.overlays || []).map((o) => ({ ...o }));
  state.selectedOverlay = snap.selectedOverlay ?? null;
  state.layout = snap.layout;
  state.params = { ...snap.params };
  state.background = snap.background;
  state.bg2 = snap.bg2 ?? null;
  state.bgAngle = snap.bgAngle ?? 135;
  state.borderColor = snap.borderColor ?? '#ffffff';
  state.selected = snap.selected;
}

/** Call before a change you want undoable. */
export function mark(state) {
  if (suspended) return;
  past.push(snapshot(state));
  if (past.length > MAX) past.shift();
  future.length = 0;
}

export function undo(state) {
  if (!past.length) return false;
  future.push(snapshot(state));
  suspended = true;
  restore(state, past.pop());
  suspended = false;
  return true;
}

export function redo(state) {
  if (!future.length) return false;
  past.push(snapshot(state));
  suspended = true;
  restore(state, future.pop());
  suspended = false;
  return true;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
export function reset() { past = []; future = []; }
