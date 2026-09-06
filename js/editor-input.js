// Pointer, wheel and keyboard wiring for the focus editor. Split from
// editor.js purely along the input seam: everything here translates events
// into calls on the ops the editor passes in, and holds no session state of
// its own. ctx.getEd() is read per event, so a session swap mid-gesture can
// never act on the wrong photo.

export function wireInput(ctx) {
  const { getEd, viewport, toImage, zoomAt, fitView, applyView,
          strokeStart, strokeMove, strokeEnd, cancelStroke, wandAt,
          undoEd, redoEd, closeEditor, syncEditor, sizeCursor, toast,
          fxKey, cropDown, cropMove, cropUp, nudgeCrop, framingChanged } = ctx;
  const vp = viewport();

  vp.addEventListener('pointerdown', (e) => {
    const ed = getEd();
    if (!ed) return;
    e.preventDefault();
    vp.setPointerCapture?.(e.pointerId);
    ed.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ed.pointers.size === 2) {
      cancelStroke();   // the first finger's accidental dab must not survive
      ed.pan = null;
      const [a, b] = [...ed.pointers.values()];
      const r = vp.getBoundingClientRect();
      ed.pinch = {
        d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        s0: ed.view.s, x0: ed.view.x, y0: ed.view.y,
        cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top,
      };
      return;
    }
    // The crop frame owns its own drags: check before the brush tools, or a
    // handle pull would paint a stroke underneath it.
    if (cropDown(ed, e)) return;
    const { ix, iy } = toImage(e);
    if (ed.tool === 'crop') return;
    if (ed.tool === 'pan' || ed.space || e.button === 1) {
      ed.pan = { sx: e.clientX, sy: e.clientY, x0: ed.view.x, y0: ed.view.y };
    } else if (ed.tool === 'wand') {
      wandAt(ix, iy);
    } else {
      strokeStart(ix, iy);
    }
  });

  vp.addEventListener('pointermove', (e) => {
    const ed = getEd();
    if (!ed) return;
    if (ed.pointers.has(e.pointerId)) {
      ed.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const { ix, iy, vx, vy } = toImage(e);
    const cur = document.querySelector('#edCursor');
    cur.style.left = `${vx}px`;
    cur.style.top = `${vy}px`;
    if (ed.pinch && ed.pointers.size >= 2) {
      const [a, b] = [...ed.pointers.values()];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const s2 = Math.min(12, Math.max(ed.fitS * 0.25, ed.pinch.s0 * (d / ed.pinch.d0)));
      const g = s2 / ed.pinch.s0;
      ed.view.s = s2;
      ed.view.x = ed.pinch.cx - (ed.pinch.cx - ed.pinch.x0) * g;
      ed.view.y = ed.pinch.cy - (ed.pinch.cy - ed.pinch.y0) * g;
      applyView();
      return;
    }
    if (ed.pan) {
      ed.view.x = ed.pan.x0 + (e.clientX - ed.pan.sx);
      ed.view.y = ed.pan.y0 + (e.clientY - ed.pan.sy);
      applyView();
      return;
    }
    if (cropMove(ed, e)) return;
    if (ed.stroke) strokeMove(ix, iy);
  });

  const endPointer = (e) => {
    const ed = getEd();
    if (!ed) return;
    ed.pointers.delete(e.pointerId);
    if (ed.pointers.size < 2) ed.pinch = null;
    if (cropUp()) { syncEditor(); return; }
    if (ed.stroke) strokeEnd();
    ed.pan = null;
  };
  vp.addEventListener('pointerup', endPointer);
  vp.addEventListener('pointercancel', endPointer);
  vp.addEventListener('pointerleave', () => {
    if (getEd()) document.querySelector('#edCursor').style.left = '-999px';
  });

  vp.addEventListener('wheel', (e) => {
    if (!getEd()) return;
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  addEventListener('keydown', (e) => {
    const ed = getEd();
    if (!ed) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoEd(); else undoEd();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (ed.applying) return;
      // Runs even with focus on a slider: Escape must always answer. It
      // discards, so anything worth keeping (strokes OR colour changes) arms
      // a first-press warning and only a second press closes.
      const dirty = ed.past.length > 0 || fxKey(ed.tf) !== fxKey(ed.photo.tf)
      || framingChanged(ed.tf, ed.photo.tf);
      if (dirty && Date.now() - ed.escArmed > 2200) {
        ed.escArmed = Date.now();
        toast('Press Escape again to discard, or use Done to keep the edit.');
      } else closeEditor();
      return;
    }
    if (typing || mod) return;
    if (k === 'e') { ed.tool = 'erase'; syncEditor(); }
    else if (k === 'r') { ed.tool = 'restore'; syncEditor(); }
    else if (k === 'w') { ed.tool = 'wand'; syncEditor(); }
    else if (k === 'v') { ed.tool = 'pan'; syncEditor(); }
    else if (k === 'c') { ed.tool = 'crop'; syncEditor(); }
    else if (ed.tool === 'crop' && k.startsWith('arrow')) {
      // Shift resizes rather than moves, which is the same modifier the
      // pointer drag uses for shape, and keeps the frame reachable without one.
      const d = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      if (d) { e.preventDefault(); nudgeCrop(ed, d[0], d[1], e.shiftKey); }
    }
    else if (k === '[') { ed.brush = Math.max(6, ed.brush / 1.2); syncEditor(); sizeCursor(); }
    else if (k === ']') { ed.brush = Math.min(300, ed.brush * 1.2); syncEditor(); sizeCursor(); }
    else if (k === '0') fitView();
    else if (k === ' ') { ed.space = true; e.preventDefault(); }
  });
  addEventListener('keyup', (e) => {
    const ed = getEd();
    if (ed && e.key === ' ') ed.space = false;
  });
  // Alt-tabbing away with space held would leave pan latched on.
  addEventListener('blur', () => { const ed = getEd(); if (ed) ed.space = false; });

  addEventListener('resize', () => { if (getEd()) fitView(); });
}
