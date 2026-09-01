// Stage gestures. Contract 4a decides who owns the bare drag:
//
//   overlay drag  >  wheel/pinch zoom  >  shift+drag swap  >  drag to pan
//
// Panning wins the free gesture because framing a photo happens many times per
// collage and swapping two cells happens a handful of times. A mode toggle was
// rejected: a mode you can forget you are in is worse than a modifier you hold.

import { state, swapCells, selectedOverlayObj } from './state.js';
import { overlayAt } from './overlays.js';
import * as H from './history.js';
import { refs } from './render.js';

let cellDrag = null;   // shift + drag, cell to cell
let ovlDrag = null;    // caption being moved
let panDrag = null;    // photo being reframed inside its cell
let pinch = null;      // two-finger zoom
let wheelSettle = null;
const pointers = new Map();

/** Clamp so a photo can never be dragged fully out of its own cell. */
function clampPan(p) {
  const lim = 0.5 + p.tf.zoom * 0.5;
  p.tf.ox = Math.max(-lim, Math.min(lim, p.tf.ox));
  p.tf.oy = Math.max(-lim, Math.min(lim, p.tf.oy));
}

export function wireStage({ repaint, repaintStage, edit, lastFrameRef, cellAt, scheduleFxIfNeeded }) {
  const canvas = refs.canvas;
  const lf = lastFrameRef;
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const o = overlayAt(state.overlays, fx, fy);
    if (o) {
      // Front-to-back: a pointer on an overlay never reaches the cell beneath.
      H.mark(state);
      ovlDrag = { o, dx: fx - o.x, dy: fy - o.y };
      state.selectedOverlay = o.id; state.selected = null;
      canvas.setPointerCapture?.(e.pointerId);
      repaint();
      return;
    }
    state.selectedOverlay = null;
    const i = cellAt(e);
    if (i < 0) { repaint(); return; }
    const p = lf().placement[i];
    state.selected = p ? p.id : null;

    if (e.shiftKey) {
      // Swapping is rare, so it pays the modifier (contract 4a).
      cellDrag = i;
    } else if (p) {
      const cell = lf().cells[i];
      panDrag = {
        photo: p, sx: e.clientX, sy: e.clientY,
        ox: p.tf.ox, oy: p.tf.oy,
        cw: cell.w * lf().W, ch: cell.h * lf().H,
        rot: cell.rot || 0,
      };
      H.mark(state);
      canvas.setPointerCapture?.(e.pointerId);
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    repaint();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ph = pinch.photo;
      ph.tf.zoom = Math.max(1, Math.min(6, pinch.zoom * (d / pinch.d0)));
      clampPan(ph);
      scheduleFxIfNeeded(ph);
      repaintStage();
      return;
    }

    if (panDrag) {
      const p = panDrag.photo;
      // ox/oy are fractions of the CELL, so a pixel delta divides by cell size.
      // Flip inverts the axis, or the photo would run away from the pointer.
      // A scatter cell is rotated, so the screen delta first rotates into the
      // cell's own frame or a horizontal drag drifts diagonally.
      let dx = e.clientX - panDrag.sx, dy = e.clientY - panDrag.sy;
      if (panDrag.rot) {
        const a = (-panDrag.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        const rx = dx * c - dy * s, ry = dx * s + dy * c;
        dx = rx; dy = ry;
      }
      const fx = p.tf.flipH ? -1 : 1, fy = p.tf.flipV ? -1 : 1;
      p.tf.ox = panDrag.ox + (dx / panDrag.cw) * fx;
      p.tf.oy = panDrag.oy + (dy / panDrag.ch) * fy;
      clampPan(p);
      repaintStage();
      return;
    }

    if (!ovlDrag) return;
    const r = canvas.getBoundingClientRect();
    ovlDrag.o.x = Math.max(-0.2, Math.min(1.2, (e.clientX - r.left) / r.width - ovlDrag.dx));
    ovlDrag.o.y = Math.max(-0.2, Math.min(1.2, (e.clientY - r.top) / r.height - ovlDrag.dy));
    repaintStage();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerup', (e) => {
    endPointer(e);
    if (ovlDrag) { ovlDrag = null; repaint(); return; }
    // repaint() must always run here: it is what syncs the inspector, the
    // undo buttons and the save debounce after a reframe. A stray call to a
    // never-defined helper used to throw first and skip all three.
    if (panDrag) { panDrag = null; repaint(); return; }
    if (cellDrag === null) return;
    const j = cellAt(e);
    if (j >= 0 && j !== cellDrag) edit(() => swapCells(cellDrag, j, lf().placement));
    cellDrag = null;
  });

  // Wheel zooms the photo under the cursor. No modifier: nothing else on the
  // stage wants the wheel, and requiring one for the second-most-common framing
  // action would be gratuitous.
  canvas.addEventListener('wheel', (e) => {
    const i = cellAt(e);
    if (i < 0) return;
    const p = lf().placement[i];
    if (!p) return;
    e.preventDefault();
    state.selected = p.id;
    p.tf.zoom = Math.max(1, Math.min(6, p.tf.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    clampPan(p);
    repaintStage();
    clearTimeout(wheelSettle);
    wheelSettle = setTimeout(() => { H.mark(state); repaint(); }, 260);
  }, { passive: false });

  // Two fingers start a pinch on the cell they land on.
  canvas.addEventListener('pointerdown', (e) => {
    if (pointers.size !== 2 || pinch) return;
    const i = cellAt(e);
    const p = i >= 0 ? lf().placement[i] : null;
    if (!p) return;
    const [a, b] = [...pointers.values()];
    panDrag = null;
    pinch = { photo: p, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: p.tf.zoom };
    H.mark(state);
  });

}
