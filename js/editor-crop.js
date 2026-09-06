// The crop rectangle: a DOM overlay over the editor canvas.
//
// It is DOM and not canvas painting on purpose. rebuildWork() clears #edCanvas
// and re-composites it through destination-in inside a rAF after every stamp,
// so any chrome drawn there is wiped by the next brush stroke.
//
// The rectangle itself lives in ed.tf as cx/cy/cw/ch, fractions of the source,
// which is the same field compose renders from. There is no second copy to keep
// in sync and no "apply" step that could be missed: moving a handle IS the edit.

// Same local helper as editor.js:35: utils.js's $ is getElementById, and these
// are selectors.
const $ = (sel) => document.querySelector(sel);

const MIN = 0.04;                 // never crop below 4% of a side
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

let drag = null;                  // module-local: cleared whenever the tool changes

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Build the overlay once, lazily, inside the viewport. */
function els() {
  let root = $('#edCrop');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'edCrop';
  root.className = 'crop';
  root.hidden = true;
  const frame = document.createElement('div');
  frame.className = 'crop-frame';
  frame.dataset.h = 'move';
  for (const h of HANDLES) {
    const b = document.createElement('span');
    b.className = 'crop-h';
    b.dataset.h = h;
    frame.appendChild(b);
  }
  root.appendChild(frame);
  $('#edViewport').appendChild(root);
  return root;
}

/** Position the overlay from the current crop and view transform. */
export function syncCrop(ed) {
  const root = els();
  const on = ed && ed.tool === 'crop';
  root.hidden = !on;
  if (!on) return;
  const { x, y, s } = ed.view;
  const f = root.firstChild;
  f.style.left = `${x + (ed.tf.cx ?? 0) * ed.w * s}px`;
  f.style.top = `${y + (ed.tf.cy ?? 0) * ed.h * s}px`;
  f.style.width = `${(ed.tf.cw ?? 1) * ed.w * s}px`;
  f.style.height = `${(ed.tf.ch ?? 1) * ed.h * s}px`;
}

/** True when this pointer event belongs to the crop overlay. */
export function cropDown(ed, e) {
  if (!ed || ed.tool !== 'crop') return false;
  const t = e.target.closest?.('.crop-h, .crop-frame');
  if (!t) return false;
  drag = {
    h: t.dataset.h,
    ox: e.clientX, oy: e.clientY,
    start: { cx: ed.tf.cx ?? 0, cy: ed.tf.cy ?? 0, cw: ed.tf.cw ?? 1, ch: ed.tf.ch ?? 1 },
  };
  e.preventDefault();
  return true;
}

export function cropMove(ed, e) {
  if (!drag || !ed) return false;
  // Screen pixels to source fractions through the same view scale the overlay
  // is positioned with, so the rectangle tracks the pointer at any zoom.
  const dx = (e.clientX - drag.ox) / (ed.view.s * ed.w);
  const dy = (e.clientY - drag.oy) / (ed.view.s * ed.h);
  const st = drag.start;
  let { cx, cy, cw, ch } = st;

  if (drag.h === 'move') {
    cx = Math.min(1 - cw, Math.max(0, st.cx + dx));
    cy = Math.min(1 - ch, Math.max(0, st.cy + dy));
  } else {
    if (drag.h.includes('w')) { const nx = clamp01(st.cx + dx); cw = st.cx + st.cw - nx; cx = nx; }
    if (drag.h.includes('e')) { cw = clamp01(st.cx + st.cw + dx) - st.cx; }
    if (drag.h.includes('n')) { const ny = clamp01(st.cy + dy); ch = st.cy + st.ch - ny; cy = ny; }
    if (drag.h.includes('s')) { ch = clamp01(st.cy + st.ch + dy) - st.cy; }
    // A handle dragged past its opposite edge would invert the rectangle, which
    // reads to drawImage as a negative source size and paints nothing.
    if (cw < MIN) { if (drag.h.includes('w')) cx = st.cx + st.cw - MIN; cw = MIN; }
    if (ch < MIN) { if (drag.h.includes('n')) cy = st.cy + st.ch - MIN; ch = MIN; }
    if (e.shiftKey) {
      const a = st.cw / st.ch;                 // keep the aspect the drag began with
      if (cw / ch > a) cw = ch * a; else ch = cw / a;
      if (drag.h.includes('w')) cx = st.cx + st.cw - cw;
      if (drag.h.includes('n')) cy = st.cy + st.ch - ch;
    }
  }
  Object.assign(ed.tf, { cx, cy, cw, ch });
  syncCrop(ed);
  return true;
}

export function cropUp() {
  const was = !!drag;
  drag = null;
  return was;
}

/** Arrow keys: move the rectangle, or resize it with shift held. */
export function nudgeCrop(ed, kx, ky, resize) {
  const step = 0.01;
  const tf = ed.tf;
  if (resize) {
    tf.cw = Math.min(1 - (tf.cx ?? 0), Math.max(MIN, (tf.cw ?? 1) + kx * step));
    tf.ch = Math.min(1 - (tf.cy ?? 0), Math.max(MIN, (tf.ch ?? 1) + ky * step));
  } else {
    tf.cx = Math.min(1 - (tf.cw ?? 1), Math.max(0, (tf.cx ?? 0) + kx * step));
    tf.cy = Math.min(1 - (tf.ch ?? 1), Math.max(0, (tf.cy ?? 0) + ky * step));
  }
  syncCrop(ed);
}

/** Back to the whole photo. */
export function resetCrop(ed) {
  Object.assign(ed.tf, { cx: 0, cy: 0, cw: 1, ch: 1 });
  syncCrop(ed);
}

/** True when the photo is cropped at all, for the dirty check and the UI. */
export const isCropped = (tf) =>
  (tf.cx ?? 0) > 1e-6 || (tf.cy ?? 0) > 1e-6 || (tf.cw ?? 1) < 1 - 1e-6 || (tf.ch ?? 1) < 1 - 1e-6;

/** Drop any in-flight drag, e.g. when the tool changes or the editor closes. */
export function cancelCropDrag() { drag = null; }
