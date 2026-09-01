// Undo/redo over the editable model.
//
// Snapshots deliberately exclude bitmaps. A dozen 12MP photos held twice per
// history entry would exhaust memory in a handful of edits, and the pixels never
// change anyway: what changes is order, framing, spans and layout params. So a
// snapshot stores the arrangement and references photos by id, and restoring
// re-attaches the live bitmaps from the pool.

const MAX = 60;
let past = [], future = [], suspended = false;

function snapshot(state) {
  return {
    order: state.pool.map((p) => p.id),
    photos: state.pool.map((p) => ({
      id: p.id, span: p.span,
      tf: { ...p.tf, adj: { ...p.tf.adj } },
      hasCut: !!p.cut,
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
  state.pool = snap.order.map((id) => byId.get(id)).filter(Boolean);
  for (const rec of snap.photos) {
    const p = byId.get(rec.id);
    if (!p) continue;
    p.span = rec.span;
    p.tf = { ...rec.tf, adj: { ...rec.tf.adj } };
    // A cutout is a bitmap, so it is not in the snapshot. Undoing past the point
    // where it was made cannot resurrect it; clearing the flag is the honest
    // outcome rather than showing a "cut" badge with nothing behind it. The
    // blob must go too: it is what persistence writes, so leaving it would
    // resurrect the undone cutout on the next reload.
    if (!rec.hasCut) { p.cut = null; p.cutBlob = null; }
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
