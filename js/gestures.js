// Canvas gestures share a history entry only when pixels actually move.
// A tap selects; drag reframes; two fingers zoom; Shift-drag swaps cells.
import { state, swapCells } from './state.js';
import { overlayAt } from './overlays.js';
import * as H from './history.js';
import { refs } from './render.js';

let cellDrag = null, ovlDrag = null, panDrag = null, pinch = null;
let wheelSettle = null;
const pointers = new Map();

function clampPan(photo) {
  const limit = 0.5 + photo.tf.zoom * 0.5;
  photo.tf.ox = Math.max(-limit, Math.min(limit, photo.tf.ox));
  photo.tf.oy = Math.max(-limit, Math.min(limit, photo.tf.oy));
}

function markGesture(gesture) {
  if (!gesture.marked) { H.mark(state); gesture.marked = true; }
}

export function wireStage({ repaint, repaintStage, edit, lastFrameRef, cellAt }) {
  const canvas = refs.canvas, frame = lastFrameRef;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture?.(event.pointerId);
    if (pointers.size > 1) {
      if (pointers.size === 2 && panDrag) {
        const [a, b] = [...pointers.values()];
        pinch = { photo: panDrag.photo, zoom: panDrag.photo.tf.zoom,
          d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), marked: panDrag.marked };
        panDrag = null;
      }
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const overlay = overlayAt(state.overlays, x, y);
    if (overlay) {
      ovlDrag = { overlay, dx: x - overlay.x, dy: y - overlay.y,
        sx: event.clientX, sy: event.clientY, marked: false };
      state.selectedOverlay = overlay.id; state.selected = null;
      repaint(); return;
    }
    state.selectedOverlay = null;
    const index = cellAt(event);
    const photo = index >= 0 ? frame().placement[index] : null;
    state.selected = photo?.id || null;
    if (event.shiftKey && photo) cellDrag = index;
    else if (photo) {
      const cell = frame().cells[index];
      panDrag = { photo, sx: event.clientX, sy: event.clientY,
        ox: photo.tf.ox, oy: photo.tf.oy,
        cw: cell.w * rect.width, ch: cell.h * rect.height,
        rot: cell.rot || 0, marked: false };
    }
    repaint();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (Math.abs(distance - pinch.d0) < 2 && !pinch.marked) return;
      markGesture(pinch);
      pinch.photo.tf.zoom = Math.max(1, Math.min(6, pinch.zoom * distance / pinch.d0));
      clampPan(pinch.photo); repaintStage(); return;
    }
    if (panDrag) {
      let dx = event.clientX - panDrag.sx, dy = event.clientY - panDrag.sy;
      if (Math.hypot(dx, dy) < 3 && !panDrag.marked) return;
      markGesture(panDrag);
      if (panDrag.rot) {
        const angle = -panDrag.rot * Math.PI / 180;
        const c = Math.cos(angle), s = Math.sin(angle);
        [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
      }
      const photo = panDrag.photo;
      photo.tf.ox = panDrag.ox + dx / panDrag.cw * (photo.tf.flipH ? -1 : 1);
      photo.tf.oy = panDrag.oy + dy / panDrag.ch * (photo.tf.flipV ? -1 : 1);
      clampPan(photo); repaintStage(); return;
    }
    if (ovlDrag) {
      if (Math.hypot(event.clientX - ovlDrag.sx, event.clientY - ovlDrag.sy) < 3 && !ovlDrag.marked) return;
      markGesture(ovlDrag);
      const rect = canvas.getBoundingClientRect();
      ovlDrag.overlay.x = Math.max(-0.2, Math.min(1.2, (event.clientX - rect.left) / rect.width - ovlDrag.dx));
      ovlDrag.overlay.y = Math.max(-0.2, Math.min(1.2, (event.clientY - rect.top) / rect.height - ovlDrag.dy));
      repaintStage();
    }
  });
  function finish(event) {
    pointers.delete(event.pointerId);
    if (cellDrag !== null && event.type === 'pointerup') {
      const target = cellAt(event);
      if (target >= 0 && target !== cellDrag) edit(() => swapCells(cellDrag, target, frame().placement));
    }
    cellDrag = null; panDrag = null; ovlDrag = null; pinch = null;
    repaint();
  }
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', (event) => {
    if (pointers.has(event.pointerId)) finish(event);
  });
  canvas.addEventListener('wheel', (event) => {
    const index = cellAt(event);
    const photo = index >= 0 ? frame().placement[index] : null;
    if (!photo) return;
    event.preventDefault();
    if (!wheelSettle) H.mark(state);
    state.selected = photo.id; state.selectedOverlay = null;
    photo.tf.zoom = Math.max(1, Math.min(6, photo.tf.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08)));
    clampPan(photo); repaintStage();
    clearTimeout(wheelSettle);
    wheelSettle = setTimeout(() => { wheelSettle = null; repaint(); }, 260);
  }, { passive: false });
}
