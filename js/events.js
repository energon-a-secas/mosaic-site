import { state, addPhoto, removePhoto, movePhoto, swapCells, selectedPhoto,
         shufflePool, freshTf, addOverlay, removeOverlay, selectedOverlayObj } from './state.js';
import { renderAll, drawStage, currentCells, currentPlacement, refs, syncHistory,
         syncControls } from './render.js';
import { exportBlob } from './compose.js';
import { aspect } from './layouts.js';
import { removeBackground, makeThumb, batchThumbnails, fitAspect } from './tools.js';
import * as H from './history.js';
import { applyFx, fxKey, isIdentity } from './filters.js';
import { makeText, PRESETS, FONTS, overlayAt } from './overlays.js';
import { saveSession, loadSession, clearSession } from './store.js';
import { showToast as toast } from './utils.js';

let dragFrom = null;      // strip reorder
let cellDrag = null;      // stage cell swap
let ovlDrag = null;       // overlay being dragged

async function ingest(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  H.mark(state);
  for (const f of list) {
    try {
      const bmp = await createImageBitmap(f);
      const p = addPhoto({ bitmap: bmp, name: f.name, blob: f });
      p.thumb = await makeThumb(bmp);
      if (!isIdentity(p.tf)) { p.fx = await applyFx(bmp, p.tf); p.fxKey = fxKey(p.tf); }
    } catch {
      toast(`Could not read ${f.name}`);
    }
  }
  repaint();
}

/** Which cell is under a pointer event, or -1. */
function cellAt(ev) {
  const { cells, W, H } = lastFrame;
  const r = refs.canvas.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width * W;
  const y = (ev.clientY - r.top) / r.height * H;
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    if (x >= c.x * W && x <= (c.x + c.w) * W && y >= c.y * H && y <= (c.y + c.h) * H) return i;
  }
  return -1;
}

let lastFrame = { cells: [], placement: [], W: 1, H: 1, ar: 1 };
let saveTimer = null, fxTimer = null;

/**
 * Bake colour into a photo's pixels, because ctx.filter is not Baseline.
 * Debounced: a slider drag fires per pixel of travel, and a full-resolution pass
 * is far too slow for that. The stage keeps showing the last good bake meanwhile.
 */
function scheduleFx(photo, delay = 180) {
  clearTimeout(fxTimer);
  fxTimer = setTimeout(async () => {
    const key = fxKey(photo.tf);
    if (photo.fxKey === key) return;
    if (isIdentity(photo.tf)) { photo.fx = null; photo.fxKey = key; repaintStage(); return; }
    photo.fx = await applyFx(photo.cut || photo.bitmap, photo.tf);
    photo.fxKey = key;
    repaintStage();
  }, delay);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSession(state), 700);
}

function repaint() {
  lastFrame = renderAll();
  syncHistory(H.canUndo(), H.canRedo());
  scheduleSave();
}
const repaintStage = () => { lastFrame = drawStage(); };
/** Mark before a change so it can be undone, then apply it. */
const edit = (fn) => { H.mark(state); fn(); repaint(); };

export function wire() {
  // ── import ────────────────────────────────────────────────────────────────
  const file = document.querySelector('#file');
  document.querySelector('[data-act="add"]').addEventListener('click', () => file.click());
  document.querySelector('#empty').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { ingest(file.files); file.value = ''; });

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => {
    stop(e); document.body.classList.add('is-dropping');
  }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => {
    if (t === 'drop') stop(e);
    if (e.relatedTarget) return;
    document.body.classList.remove('is-dropping');
  }));
  document.addEventListener('drop', (e) => {
    document.body.classList.remove('is-dropping');
    if (e.dataTransfer?.files?.length) ingest(e.dataTransfer.files);
  });

  // ── layout controls ───────────────────────────────────────────────────────
  // The whole point: any of these can change at any time and no photo is lost.
  document.querySelectorAll('[data-layout]').forEach((b) => {
    b.addEventListener('click', () => edit(() => { state.layout = b.dataset.layout; }));
  });
  document.querySelectorAll('[data-param]').forEach((el) => {
    // Mark on the FIRST input of a gesture, not on pointerdown: clicking a slider
    // without moving it used to push a history entry, so the next undo did nothing
    // visible and looked broken.
    let armed = false;
    const arm = () => { armed = true; };
    el.addEventListener('pointerdown', arm);
    el.addEventListener('keydown', (ev) => { if (ev.key.startsWith('Arrow')) arm(); });
    el.addEventListener('input', () => { if (armed) { H.mark(state); armed = false; } });
    el.addEventListener('input', () => {
      const k = el.dataset.param;
      if (k === 'ratio') state.params.ratio = el.value;
      else if (k === 'background') state.background = el.value;
      else state.params[k] = Number(el.value);
      // Stage only. A layout slider does not change any thumbnail, and rebuilding
      // twenty canvases per input event is the single worst hitch in the app.
      repaintStage();
      syncControls();
      scheduleSave();
    });
    el.addEventListener('change', repaint);
  });

  // ── strip: select, delete, reorder ────────────────────────────────────────
  refs.strip.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { edit(() => removePhoto(del.dataset.del)); return; }
    const li = e.target.closest('.thumb');
    if (!li) return;
    state.selected = state.selected === li.dataset.id ? null : li.dataset.id;
    repaint();
  });
  refs.strip.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.thumb');
    if (li) { dragFrom = Number(li.dataset.index); e.dataTransfer.effectAllowed = 'move'; }
  });
  refs.strip.addEventListener('dragover', (e) => e.preventDefault());
  refs.strip.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    const li = e.target.closest('.thumb');
    if (li && dragFrom !== null) edit(() => movePhoto(dragFrom, Number(li.dataset.index)));
    dragFrom = null;
  });

  // ── stage: click to select, drag one cell onto another to swap ────────────
  refs.canvas.addEventListener('pointerdown', (e) => {
    const r = refs.canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const o = overlayAt(state.overlays, fx, fy);
    if (o) {
      // Front-to-back: a pointer on an overlay never reaches the cell beneath.
      H.mark(state);
      ovlDrag = { o, dx: fx - o.x, dy: fy - o.y };
      state.selectedOverlay = o.id; state.selected = null;
      refs.canvas.setPointerCapture?.(e.pointerId);
      repaint();
      return;
    }
    state.selectedOverlay = null;
    const i = cellAt(e);
    if (i < 0) { repaint(); return; }
    cellDrag = i;
    const p = lastFrame.placement[i];
    state.selected = p ? p.id : null;
    repaint();
  });
  refs.canvas.addEventListener('pointermove', (e) => {
    if (!ovlDrag) return;
    const r = refs.canvas.getBoundingClientRect();
    ovlDrag.o.x = Math.max(-0.2, Math.min(1.2, (e.clientX - r.left) / r.width - ovlDrag.dx));
    ovlDrag.o.y = Math.max(-0.2, Math.min(1.2, (e.clientY - r.top) / r.height - ovlDrag.dy));
    repaintStage();
  });
  refs.canvas.addEventListener('pointerup', (e) => {
    if (ovlDrag) { ovlDrag = null; repaint(); return; }
    if (cellDrag === null) return;
    const j = cellAt(e);
    if (j >= 0 && j !== cellDrag) edit(() => swapCells(cellDrag, j, lastFrame.placement));
    cellDrag = null;
  });

  // ── inspector ─────────────────────────────────────────────────────────────
  const ins = refs.inspector;
  let insArmed = null;
  ins.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('[data-tf],[data-adj]');
    if (c) insArmed = c;
  });
  ins.addEventListener('input', (e) => {
    const p = selectedPhoto();
    if (!p) return;
    if (insArmed) { H.mark(state); insArmed = null; }
    const tf = e.target.closest('[data-tf]');
    if (tf) { p.tf[tf.dataset.tf] = Number(tf.value); repaintStage(); return; }
    const adj = e.target.closest('[data-adj]');
    if (adj) { p.tf.adj[adj.dataset.adj] = Number(adj.value); repaintStage(); scheduleFx(p); }
  });
  ins.addEventListener('click', async (e) => {
    const p = selectedPhoto();
    if (!p) return;
    const f = e.target.closest('[data-filter]');
    if (f) { edit(() => { p.tf.filter = f.dataset.filter; }); scheduleFx(p, 0); return; }
    const fl = e.target.closest('[data-flip]');
    if (fl) {
      const key = fl.dataset.flip === 'h' ? 'flipH' : 'flipV';
      edit(() => { p.tf[key] = !p.tf[key]; });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reset') { edit(() => { p.tf = freshTf(); }); scheduleFx(p, 0); } else if (act === 'cutout') {
      const btn = e.target.closest('[data-act]');
      btn.disabled = true; btn.textContent = 'Working…';
      const tol = Number(ins.querySelector('[data-tol]').value);
      const out = await removeBackground(p.bitmap, tol);
      btn.disabled = false; btn.textContent = 'Remove background';
      if (!out) { toast('No flat background found. Try a higher tolerance.'); return; }
      H.mark(state); p.cut = out; p.fxKey = null; p.thumb = await makeThumb(out); repaint(); scheduleFx(p, 0);
    } else if (act === 'hero') {
      edit(() => { p.span = p.span === 2 ? 1 : 2; });
    } else if (act === 'fit') {
      edit(() => fitAspect(p, 1));
    } else if (act === 'restore') {
      H.mark(state); p.cut = null; p.fxKey = null; p.thumb = await makeThumb(p.bitmap); repaint(); scheduleFx(p, 0);
    }
  });

  // ── export ────────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-export]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!state.pool.length) { toast('Add a photo first'); return; }
      const px = Number(b.dataset.export);
      const cells = currentCells();
      const blob = await exportBlob(cells, currentPlacement(cells), {
        background: state.background, params: state.params, overlays: state.overlays,
        ar: aspect(state.params.ratio), previewW: lastFrame.W,
      }, px);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mosaic-${state.layout}-${px}px.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Exported at ${px}px wide`);
    });
  });

  document.querySelector('[data-act="clear"]').addEventListener('click', () => {
    if (!state.pool.length) return;
    edit(() => { state.pool.length = 0; state.overrides.clear(); state.selected = null;
                 state.overlays = []; state.selectedOverlay = null; });
    clearSession();
  });

  // ── undo / redo / shuffle / batch thumbnails ──────────────────────────────
  document.querySelector('[data-act="undo"]').addEventListener('click', () => {
    if (H.undo(state)) repaint();
  });
  document.querySelector('[data-act="redo"]').addEventListener('click', () => {
    if (H.redo(state)) repaint();
  });
  document.querySelector('[data-act="shuffle"]').addEventListener('click', () => {
    if (state.pool.length > 1) edit(shufflePool);
  });
  document.querySelectorAll('[data-thumbs]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!state.pool.length) { toast('Add photos first'); return; }
      const size = Number(b.dataset.thumbs);
      b.disabled = true;
      const n = await batchThumbnails(state.pool, size,
        (i, t) => { b.textContent = `${i}/${t}`; });
      b.disabled = false; b.textContent = `${size}px`;
      toast(`Saved ${n} thumbnail${n > 1 ? 's' : ''}`);
    });
  });

  // ── keyboard ──────────────────────────────────────────────────────────────
  // Single-key bindings stay off text fields so typing never triggers them.
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey ? H.redo(state) : H.undo(state)) repaint();
      return;
    }
    if (typing || mod) return;
    const p = selectedPhoto();
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (p) { e.preventDefault(); edit(() => removePhoto(p.id)); }
    } else if (e.key.toLowerCase() === 'h' && p) {
      edit(() => { p.span = p.span === 2 ? 1 : 2; });
    } else if (e.key.toLowerCase() === 'r') {
      if (state.pool.length > 1) edit(shufflePool);
    } else if (e.key === 'Escape') {
      state.selected = null; repaint();
    } else if (/^[1-8]$/.test(e.key)) {
      edit(() => { state.params.cols = Number(e.key); });
    }
  });

  // ── text and memes ────────────────────────────────────────────────────────
  const presetWrap = document.querySelector('[data-presets]');
  Object.keys(PRESETS).forEach((name) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = name;
    b.addEventListener('click', () => edit(() => {
      state.overlays = PRESETS[name]();
      state.selectedOverlay = state.overlays[0]?.id ?? null;
    }));
    presetWrap.appendChild(b);
  });
  const fontWrap = document.querySelector('[data-ofonts]');
  Object.keys(FONTS).forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.ofont = f; b.textContent = f;
    fontWrap.appendChild(b);
  });

  document.querySelector('[data-act="addtext"]').addEventListener('click', () =>
    edit(() => addOverlay(makeText({ text: 'YOUR TEXT', y: 0.4 }))));
  document.querySelector('[data-act="addbubble"]').addEventListener('click', () =>
    edit(() => addOverlay(makeText({
      type: 'bubble', text: 'say something', x: 0.1, y: 0.1, w: 0.5, h: 0.2,
      font: 'sans', color: '#111111', stroke: 'none', upper: false,
    }))));

  const tins = document.querySelector('#textins');
  tins.addEventListener('input', (ev) => {
    const o = selectedOverlayObj(); const el = ev.target.closest('[data-o]');
    if (!o || !el) return;
    const k = el.dataset.o;
    o[k] = el.type === 'range' ? Number(el.value) : el.value;
    repaintStage();
  });
  tins.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('[data-o]')) H.mark(state);
  });
  tins.addEventListener('click', (ev) => {
    const o = selectedOverlayObj(); if (!o) return;
    const f = ev.target.closest('[data-ofont]');
    if (f) { edit(() => { o.font = f.dataset.ofont; }); return; }
    const al = ev.target.closest('[data-o-align]');
    if (al) { edit(() => { o.align = al.dataset.oAlign; }); return; }
    const tg = ev.target.closest('[data-o-toggle]');
    if (tg) { edit(() => { o[tg.dataset.oToggle] = !o[tg.dataset.oToggle]; }); return; }
    if (ev.target.closest('[data-act="delovl"]')) edit(() => removeOverlay(o.id));
  });

  // Paste an image straight in: the dominant meme input path.
  addEventListener('paste', (ev) => {
    const items = [...(ev.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/'));
    if (!items.length) return;
    ev.preventDefault();
    ingest(items.map((i) => i.getAsFile()).filter(Boolean));
  });

  addEventListener('resize', repaintStage);
  restoreSession();
}

/** Re-open the last session. Failure here must never block an empty editor. */
async function restoreSession() {
  const saved = await loadSession();
  if (!saved) { repaint(); return; }
  try {
    for (const row of saved.rows) {
      const bmp = await createImageBitmap(row.blob);
      const p = addPhoto({ bitmap: bmp, name: row.name, blob: row.blob, id: row.id });
      p.span = row.span || 1;
      p.tf = { ...freshTf(), ...row.tf, adj: { ...freshTf().adj, ...(row.tf?.adj || {}) } };
      p.thumb = await makeThumb(bmp);
      if (!isIdentity(p.tf)) { p.fx = await applyFx(bmp, p.tf); p.fxKey = fxKey(p.tf); }
    }
    // Keep minting above every restored id, or the next import collides with one.
    const maxN = saved.rows.reduce((n, r) => Math.max(n, parseInt(String(r.id).slice(1), 10) || 0), 0);
    state.nextId = Math.max(state.nextId, maxN + 1);
    const m = saved.meta;
    if (m) {
      state.overrides = new Map(m.overrides || []);
      state.layout = m.layout || state.layout;
      state.params = { ...state.params, ...(m.params || {}) };
      state.background = m.background || state.background;
      state.nextId = Math.max(state.nextId, m.nextId || 0);
      state.overlays = (m.overlays || []).map((o) => ({ ...o }));
    }
    toast(`Restored ${saved.rows.length} photo${saved.rows.length > 1 ? 's' : ''}`);
  } catch {
    toast('Could not restore the last session');
  }
  H.reset();
  repaint();
}

export { repaint };
