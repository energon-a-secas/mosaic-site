import { state, addPhoto, removePhoto, movePhoto, swapCells, selectedPhoto,
         shufflePool, freshTf, addOverlay, removeOverlay, selectedOverlayObj } from './state.js';
import { renderAll, drawStage, drawStrip, refs,
         syncHistory, syncControls } from './render.js';
import { makeThumb, tintThumb, batchThumbnails, fitAspect } from './tools.js';
import * as H from './history.js';
import { applyFx, fxKey, isIdentity } from './filters.js';
import { makeText, PRESETS, FONTS } from './overlays.js';
import { wireStage } from './gestures.js';
import { loadSession, clearSession } from './store.js';
import { scheduleSave, resumeSaving } from './autosave.js';
import { showToast as toast, echoRanges } from './utils.js';
import { openEditor, isEditorOpen, wireEditor } from './editor.js';
import { STYLES, applyStyle, styleSwatch, toggleMono } from './presets.js';
import { wireDemos } from './demos.js';
import { wireWorkspace } from './workspace.js';
import { wireImport } from './import.js';
import { wireExport, syncExport } from './export.js';

let dragFrom = null;      // strip reorder


let sessionReady = Promise.resolve();

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
const fxTimers = new Map();

/**
 * Bake colour into a photo's pixels, because ctx.filter is not Baseline.
 * Debounced: a slider drag fires per pixel of travel, and a full-resolution pass
 * is far too slow for that. The stage keeps showing the last good bake meanwhile.
 */
function scheduleFx(photo, delay = 180) {
  clearTimeout(fxTimers.get(photo.id));
  fxTimers.set(photo.id, setTimeout(async () => {
    fxTimers.delete(photo.id);
    const key = fxKey(photo.tf);
    if (photo.fxKey === key) return;
    if (isIdentity(photo.tf)) {
      photo.fx = null; photo.fxKey = key;
      photo.thumb = await makeThumb(photo.cut || photo.bitmap, 200, photo.tf);
      drawStrip(); repaintStage(); return;
    }
    const source = photo.cut || photo.bitmap;
    const fx = await applyFx(source, photo.tf);
    if (!state.pool.includes(photo) || fxKey(photo.tf) !== key || (photo.cut || photo.bitmap) !== source) return;
    photo.fx = fx;
    photo.fxKey = key;
    photo.thumb = await tintThumb(photo);
    drawStrip();
    repaintStage();
  }, delay));
}

function repaint() {
  lastFrame = renderAll();
  syncHistory(H.canUndo(), H.canRedo());
  echoRanges();
  syncExport();
  syncMoveControls();
  for (const photo of state.pool) {
    if (photo.fxKey !== fxKey(photo.tf) && (photo.fx || !isIdentity(photo.tf))) scheduleFx(photo, 0);
  }
  scheduleSave();
}
const repaintStage = () => { lastFrame = drawStage(); echoRanges(); syncExport(); };
/** Mark before a change so it can be undone, then apply it. */
const edit = (fn) => { H.mark(state); fn(); repaint(); };

function syncMoveControls() {
  const index = lastFrame.placement.findIndex((p) => p?.id === state.selected);
  document.querySelectorAll('[data-photo-move]').forEach((button) => {
    const next = index + Number(button.dataset.photoMove);
    button.disabled = index < 0 || next < 0 || next >= lastFrame.placement.length || !lastFrame.placement[next];
  });
}

function moveSelected(direction) {
  const index = lastFrame.placement.findIndex((p) => p?.id === state.selected);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= lastFrame.placement.length) return;
  edit(() => swapCells(index, next, lastFrame.placement));
}

export function wire() {
  wireWorkspace({ edit, repaint, editPhoto: openEditor, moveSelected });
  wireImport({ repaint, ready: () => sessionReady });
  wireExport({ previewWidth: () => lastFrame.W });

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
    el.addEventListener('input', () => { if (armed || el.type !== 'range') { H.mark(state); armed = false; } });
    el.addEventListener('input', () => {
      const k = el.dataset.param;
      if (k === 'ratio') state.params.ratio = el.value;
      else if (k === 'background') state.background = el.value;
      else if (k === 'bg2') state.bg2 = el.value;
      else if (k === 'bgangle') state.bgAngle = Number(el.value);
      else if (k === 'borderColor') state.borderColor = el.value;
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
    state.selected = li.dataset.id;
    state.selectedOverlay = null;
    repaint();
  });
  refs.strip.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.thumb');
    if (li) { dragFrom = Number(li.dataset.index); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', li.dataset.id); }
  });
  refs.strip.addEventListener('dragover', (e) => e.preventDefault());
  refs.strip.addEventListener('drop', (e) => {
    if (dragFrom === null) return;
    e.preventDefault(); e.stopPropagation();
    const li = e.target.closest('.thumb');
    if (li && dragFrom !== null) edit(() => {
      state.pool = lastFrame.placement.filter(Boolean);
      state.overrides.clear();
      movePhoto(dragFrom, Number(li.dataset.index));
    });
    dragFrom = null;
  });

  refs.strip.addEventListener('dragend', () => { dragFrom = null; });

  wireStage({ repaint, repaintStage, edit, lastFrameRef: () => lastFrame,
              cellAt });

  // Double-clicking a photo on the canvas is the fast lane into the editor.
  refs.canvas.addEventListener('dblclick', (e) => {
    const i = cellAt(e);
    const p = i >= 0 ? lastFrame.placement[i] : null;
    if (p) openEditor(p);
  });

  // ── inspector ─────────────────────────────────────────────────────────────
  const ins = refs.inspector;
  let insArmed = null;
  ins.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('[data-tf],[data-adj]');
    if (c) insArmed = c;
  });
  ins.addEventListener('keydown', (e) => {
    if (e.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) insArmed = e.target;
  });
  ins.addEventListener('change', repaint);
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
    if (act === 'reset') { edit(() => { p.tf = freshTf(); }); scheduleFx(p, 0); }
    else if (act === 'editphoto') { openEditor(p); }
    else if (act === 'hero') {
      edit(() => { p.span = p.span === 2 ? 1 : 2; });
    } else if (act === 'fit') {
      edit(() => fitAspect(p, 1));
    }
  });

  document.querySelector('[data-act="clear"]').addEventListener('click', () => {
    if (!state.pool.length) return;
    edit(() => { state.pool.length = 0; state.overrides.clear(); state.selected = null;
                 state.overlays = []; state.selectedOverlay = null; });
    clearSession();
    resumeSaving();
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
        { background: state.background, bg2: state.bg2, bgAngle: state.bgAngle },
        (i, t) => { b.textContent = `${i}/${t}`; });
      b.disabled = false; b.textContent = `${size}px`;
      toast(`Saved ${n} thumbnail${n > 1 ? 's' : ''}`);
    });
  });

  // ── canvas styles, gradient toggle, all black and white ───────────────────
  const styleWrap = document.querySelector('[data-styles]');
  STYLES.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip chip--style'; b.dataset.style = s.name;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = styleSwatch(s);
    b.append(sw, document.createTextNode(s.name));
    b.addEventListener('click', () => edit(() => applyStyle(state, s)));
    styleWrap.appendChild(b);
  });
  document.querySelector('[data-act="bgmode"]').addEventListener('click', () => {
    edit(() => { state.bg2 = state.bg2 ? null : '#7c3aed'; });
  });
  document.querySelector('[data-act="allbw"]').addEventListener('click', () => {
    if (!state.pool.length) { toast('Add photos first'); return; }
    H.mark(state);
    const on = toggleMono(state.pool);
    // One shared debounce timer cannot serve twenty photos, so bake in order,
    // repainting as each lands: the collage turns black and white progressively.
    // The batch is a snapshot: a photo removed mid-bake must not make the live
    // for...of skip its neighbour, and a key captured before the await keeps a
    // mid-bake filter change from stamping stale pixels as current.
    const batch = [...state.pool];
    (async () => {
      for (const p of batch) {
        if (!state.pool.includes(p)) continue;
        const key = fxKey(p.tf);
        const fx = isIdentity(p.tf) ? null : await applyFx(p.cut || p.bitmap, p.tf);
        if (!state.pool.includes(p) || fxKey(p.tf) !== key) continue;
        p.fx = fx;
        p.fxKey = key;
        p.thumb = await tintThumb(p);
        repaintStage();
      }
      drawStrip();
    })();
    repaint();
    toast(on ? 'Everything black and white' : 'Colour restored');
  });

  // ── demos and the focus editor ────────────────────────────────────────────
  wireDemos({ repaint });
  wireEditor({ onApplied: (p) => { repaint(); scheduleFx(p, 0); } });

  // ── keyboard ──────────────────────────────────────────────────────────────
  // Single-key bindings stay off text fields so typing never triggers them.
  // The focus editor owns the keyboard while it is open.
  addEventListener('keydown', (e) => {
    if (isEditorOpen()) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      if (e.shiftKey ? H.redo(state) : H.undo(state)) repaint();
      return;
    }
    if (typing || mod) return;
    const p = selectedPhoto();
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedOverlay) { e.preventDefault(); edit(() => removeOverlay(state.selectedOverlay)); }
      else if (p) { e.preventDefault(); edit(() => removePhoto(p.id)); }
    } else if (e.key.toLowerCase() === 'h' && p) {
      edit(() => { p.span = p.span === 2 ? 1 : 2; });
    } else if (e.key.toLowerCase() === 'r') {
      if (state.pool.length > 1) edit(shufflePool);
    } else if (e.key === 'Escape') {
      state.selected = null; state.selectedOverlay = null; repaint();
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

  document.querySelector('[data-act="addtext"]').addEventListener('click', () => {
    edit(() => { state.selected = null; addOverlay(makeText({ text: 'Your text', y: 0.72, h: 0.16, font: 'sans', strokeRatio: 0.045, upper: false })); });
    document.querySelector('#otext').focus();
    document.querySelector('#otext').select();
  });
  document.querySelector('[data-act="addbubble"]').addEventListener('click', () => {
    edit(() => { state.selected = null; addOverlay(makeText({
      type: 'bubble', text: 'say something', x: 0.1, y: 0.1, w: 0.5, h: 0.2,
      font: 'sans', color: '#111111', stroke: 'none', upper: false,
    })); });
    document.querySelector('#otext').focus();
    document.querySelector('#otext').select();
  });

  const tins = document.querySelector('#textins');
  let textArmed = null;
  tins.addEventListener('input', (ev) => {
    const o = selectedOverlayObj(); const el = ev.target.closest('[data-o]');
    if (!o || !el) return;
    if (textArmed === el) { H.mark(state); textArmed = null; }
    const k = el.dataset.o;
    o[k] = el.type === 'range' ? Number(el.value) : el.value;
    repaintStage();
    scheduleSave();
  });
  tins.addEventListener('change', repaint);
  const armText = (ev) => { if (ev.target.matches('[data-o]')) textArmed = ev.target; };
  tins.addEventListener('focusin', armText);
  tins.addEventListener('pointerdown', armText);
  tins.addEventListener('keydown', (ev) => {
    if (ev.target.type === 'range' && (ev.key.startsWith('Arrow') || ['Home', 'End'].includes(ev.key))) armText(ev);
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

  new ResizeObserver(repaintStage).observe(refs.canvas.parentElement);
  lastFrame = renderAll();
  syncExport();
  const main = document.querySelector('#main');
  main.inert = true;
  main.setAttribute('aria-busy', 'true');
  sessionReady = restoreSession().finally(() => { main.inert = false; main.removeAttribute('aria-busy'); });
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
      if (row.cutBlob) {
        // A corrupt stored cutout must not block the photo itself.
        try { p.cut = await createImageBitmap(row.cutBlob); p.cutBlob = row.cutBlob; }
        catch { /* keep the photo, lose the cutout */ }
      }
      p.thumb = await tintThumb(p);
      if (!isIdentity(p.tf)) { p.fx = await applyFx(p.cut || bmp, p.tf); p.fxKey = fxKey(p.tf); }
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
      state.bg2 = m.bg2 ?? null;
      state.bgAngle = m.bgAngle ?? 135;
      state.borderColor = m.borderColor || '#ffffff';
      state.nextId = Math.max(state.nextId, m.nextId || 0);
      state.overlays = (m.overlays || []).map((o) => ({ ...o }));
    }
    toast(`Restored ${saved.rows.length} photo${saved.rows.length > 1 ? 's' : ''}`);
  } catch (error) {
    console.warn('Mosaic could not restore the saved collage:', error);
    toast('Could not restore the last session');
  }
  H.reset();
  repaint();
}

export { repaint };
