// The focus editor: one photo, full screen, precise tools. This is where the
// "remove specific things by hand" promise is kept: erase and restore brushes,
// a magic wand keyed to the clicked colour, and the automatic edge fill, all
// over local pixels. Nothing leaves the browser.
//
// The model is three canvases at working resolution:
//   src   original pixels, never modified
//   mask  alpha only: opaque = kept, transparent = removed
//   work  what you see: colour source composited through the mask
// Colour adjustments preview by rebuilding the colour source with the same
// filters.js pipeline the collage uses, so the editor cannot disagree with
// the export. Undo stores alpha diffs cropped to each stroke's bounding box,
// which is what makes full-resolution editing affordable.

import { state } from './state.js';
import * as H from './history.js';
import { applyFx, fxKey, isIdentity, PRESET_NAMES } from './filters.js';
import { removeBackground, tintThumb } from './tools.js';
import { showToast as toast, echoRanges } from './utils.js';
import { makeCanvas, makeStamp, wandErase, readAlphaInto, readAlphaRect,
         cropAlpha, writeAlphaRect, bakeCut, fullyOpaque } from './editor-tools.js';
import { wireInput } from './editor-input.js';

// Photos above this edge are edited at reduced resolution: three full-size
// RGBA buffers of a 48MP shot is over half a gigabyte of pixels. 4200 keeps
// every 12MP phone photo native and still exceeds the largest export width.
const MAX_DIM = 4200;
const UNDO_MAX = 25;

let ed = null;    // the active session; null when the editor is closed
let deps = null;  // { onApplied } injected by events.js

const $ = (s) => document.querySelector(s);
export const isEditorOpen = () => !!ed;

// ── session ──────────────────────────────────────────────────────────────────

export function openEditor(photo) {
  if (ed) return;
  const bmp = photo.bitmap;
  const k = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const hint = { willReadFrequently: true };
  const src = makeCanvas(w, h, bmp, hint);
  const mask = makeCanvas(w, h, photo.cut || null, hint);
  const maskCtx = mask.getContext('2d');
  if (!photo.cut) { maskCtx.fillStyle = '#fff'; maskCtx.fillRect(0, 0, w, h); }
  const work = $('#edCanvas');
  work.width = w; work.height = h;

  ed = {
    photo, w, h, src, mask, maskCtx,
    workCtx: work.getContext('2d'),
    srcData: null,                       // lazy, only the wand needs it
    color: null, colorKey: null,         // fx'd colour source, null = src
    tf: { ...photo.tf, adj: { ...photo.tf.adj } },
    tool: 'erase', brush: 48, soft: 0.5, tol: 32,
    stampCv: null, stampKey: '',
    stroke: null, pan: null, pinch: null, space: false, applying: false,
    pointers: new Map(),
    // A live mirror of the mask's alpha, updated after every operation, so a
    // stroke's before-state is already in hand without a full-image read.
    fullBuf: new Uint8ClampedArray(w * h),
    past: [], future: [],
    view: { x: 0, y: 0, s: 1 }, fitS: 1,
    fxTimer: null, raf: 0, escArmed: 0,
    prevFocus: document.activeElement,
  };
  readAlphaInto(maskCtx, w, h, ed.fullBuf);
  document.body.classList.add('editor-open');
  inertTargets().forEach((el) => { el.inert = true; });
  $('#editor').hidden = false;
  $('[data-ed-name]').textContent = photo.name;
  $('#editor').focus();
  // The brush ring waits for the first pointer move; parked at the origin it
  // reads as a glitch.
  $('#edCursor').style.left = '-999px';
  $('#edCursor').style.top = '-999px';
  fitView();
  syncEditor();
  rebuildWork();
  scheduleColor(0);   // the photo may arrive with adjustments already on it
}

/** Everything behind the dialog: inert while the editor owns the page. */
const inertTargets = () =>
  ['.board', '.sheet-tabs', '.header-bar', '.neo-footer']
    .map((s) => document.querySelector(s)).filter(Boolean);

function closeEditor() {
  if (!ed) return;
  clearTimeout(ed.fxTimer);
  if (ed.raf) cancelAnimationFrame(ed.raf);
  ed.color?.close?.();
  const prev = ed.prevFocus;
  ed = null;
  document.body.classList.remove('editor-open');
  inertTargets().forEach((el) => { el.inert = false; });
  $('#editor').hidden = true;
  $('#edCursor').hidden = true;
  prev?.focus?.();
}

async function applyEditor() {
  if (ed.applying) return;
  ed.applying = true;   // Cancel and Escape refuse while the commit is in flight
  const p = ed.photo, mine = ed;
  const btn = $('[data-ed="done"]');
  btn.disabled = true; btn.textContent = 'Working…';
  try {
    const opaque = fullyOpaque(ed.maskCtx, ed.w, ed.h);
    H.mark(state);
    if (opaque) {
      p.cut = null; p.cutBlob = null;
    } else {
      const cv = bakeCut(ed.src, ed.mask);
      p.cut = await createImageBitmap(cv);
      p.cutBlob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    }
    p.tf.filter = mine.tf.filter;
    p.tf.adj = { ...mine.tf.adj };
    p.fx = null; p.fxKey = null;
    p.thumb = await tintThumb(p);
  } finally {
    btn.disabled = false; btn.textContent = 'Done';
    mine.applying = false;
  }
  closeEditor();
  deps.onApplied(p);
}

async function downloadEdited(type) {
  const mine = ed;
  const p = mine.photo;
  const fx = isIdentity(mine.tf) ? null : await applyFx(mine.src, mine.tf);
  if (ed !== mine) return;   // closed while the colour pass ran
  let cv = bakeCut(fx || mine.src, mine.mask);
  if (type === 'image/jpeg') {
    // JPEG has no alpha; flatten over white rather than letting it go black.
    const flat = makeCanvas(mine.w, mine.h);
    const c = flat.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, mine.w, mine.h);
    c.drawImage(cv, 0, 0);
    cv = flat;
  }
  const blob = await new Promise((r) => cv.toBlob(r, type, 0.94));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name.replace(/\.[^.]+$/, '')}-edited.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Saved the edited photo');
}

// ── view ─────────────────────────────────────────────────────────────────────

const viewport = () => $('#edViewport');

function fitView() {
  const vp = viewport();
  const s = Math.min(vp.clientWidth / ed.w, vp.clientHeight / ed.h) * 0.94;
  ed.fitS = s;
  ed.view = { s, x: (vp.clientWidth - ed.w * s) / 2, y: (vp.clientHeight - ed.h * s) / 2 };
  applyView();
}

function applyView() {
  const { x, y, s } = ed.view;
  $('#edCanvas').style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  $('[data-ed-zoom]').textContent = `${Math.round(s * 100)}%`;
  sizeCursor();
}

function zoomAt(cx, cy, k) {
  const s2 = Math.min(12, Math.max(ed.fitS * 0.25, ed.view.s * k));
  const g = s2 / ed.view.s;
  ed.view.x = cx - (cx - ed.view.x) * g;
  ed.view.y = cy - (cy - ed.view.y) * g;
  ed.view.s = s2;
  applyView();
}

function toImage(e) {
  const r = viewport().getBoundingClientRect();
  return {
    ix: (e.clientX - r.left - ed.view.x) / ed.view.s,
    iy: (e.clientY - r.top - ed.view.y) / ed.view.s,
    vx: e.clientX - r.left, vy: e.clientY - r.top,
  };
}

// ── mask edits ───────────────────────────────────────────────────────────────

function stamp() {
  const key = `${ed.brush}|${ed.soft}`;
  if (ed.stampKey !== key) {
    ed.stampCv = makeStamp(Math.max(4, Math.round(ed.brush)), ed.soft);
    ed.stampKey = key;
  }
  return ed.stampCv;
}

function pushHistory(entry) {
  ed.past.push(entry);
  if (ed.past.length > UNDO_MAX) ed.past.shift();
  ed.future.length = 0;
  syncEditor();
}

/** Refresh the alpha mirror for one rect after the mask changed there. */
function syncBuf(rect) {
  const a = readAlphaRect(ed.maskCtx, rect);
  for (let y = 0; y < rect.h; y++) {
    const row = (rect.y + y) * ed.w + rect.x;
    for (let x = 0; x < rect.w; x++) ed.fullBuf[row + x] = a[y * rect.w + x];
  }
}

function strokeRect(st) {
  const x = Math.max(0, Math.floor(st.minX)), y = Math.max(0, Math.floor(st.minY));
  return {
    x, y,
    w: Math.min(ed.w - 1, Math.ceil(st.maxX)) - x + 1,
    h: Math.min(ed.h - 1, Math.ceil(st.maxY)) - y + 1,
  };
}

function strokeStart(ix, iy) {
  // fullBuf already holds the pre-stroke alpha: no full-image read needed.
  ed.stroke = { minX: ix, minY: iy, maxX: ix, maxY: iy, lx: ix, ly: iy };
  stampAt(ix, iy);
}

function stampAt(x, y) {
  const d = ed.brush, r = d / 2;
  const c = ed.maskCtx;
  c.globalCompositeOperation = ed.tool === 'erase' ? 'destination-out' : 'source-over';
  c.drawImage(stamp(), x - r, y - r, d, d);
  c.globalCompositeOperation = 'source-over';
  const st = ed.stroke;
  st.minX = Math.min(st.minX, x - r - 2); st.maxX = Math.max(st.maxX, x + r + 2);
  st.minY = Math.min(st.minY, y - r - 2); st.maxY = Math.max(st.maxY, y + r + 2);
  rebuildWork();
}

function strokeMove(ix, iy) {
  const st = ed.stroke;
  const dist = Math.hypot(ix - st.lx, iy - st.ly);
  const step = Math.max(1, ed.brush / 4);
  const n = Math.ceil(dist / step);
  for (let i = 1; i <= n; i++) {
    stampAt(st.lx + ((ix - st.lx) * i) / n, st.ly + ((iy - st.ly) * i) / n);
  }
  st.lx = ix; st.ly = iy;
}

function strokeEnd() {
  const st = ed.stroke;
  ed.stroke = null;
  if (!st) return;
  const rect = strokeRect(st);
  if (rect.w < 1 || rect.h < 1) return;
  pushHistory({ rect, a: cropAlpha(ed.fullBuf, ed.w, rect) });
  syncBuf(rect);
}

/**
 * Roll back an in-flight stroke without recording it. This is what a pinch
 * does to the accidental first-finger dab, so two-finger zoom never leaves a
 * mark or a history entry.
 */
function cancelStroke() {
  const st = ed.stroke;
  ed.stroke = null;
  if (!st) return;
  const rect = strokeRect(st);
  if (rect.w >= 1 && rect.h >= 1) {
    writeAlphaRect(ed.maskCtx, rect, cropAlpha(ed.fullBuf, ed.w, rect));
  }
  rebuildWork();
}

function wandAt(ix, iy) {
  const x = ix | 0, y = iy | 0;
  if (x < 0 || y < 0 || x >= ed.w || y >= ed.h) return;
  // The click point decides the message: an already-clear pixel is not a
  // tolerance problem, and blaming tolerance for it sends people the wrong way.
  if (ed.fullBuf[y * ed.w + x] === 0) {
    toast('Already transparent here. The restore brush brings it back.');
    return;
  }
  if (!ed.srcData) {
    ed.srcData = ed.src.getContext('2d').getImageData(0, 0, ed.w, ed.h).data;
  }
  const maskData = ed.maskCtx.getImageData(0, 0, ed.w, ed.h);
  const rect = wandErase(ed.srcData, maskData, ed.w, ed.h, x, y, ed.tol);
  if (!rect) { toast('Nothing similar enough here. Raise the tolerance.'); return; }
  ed.maskCtx.putImageData(maskData, 0, 0);
  pushHistory({ rect, a: cropAlpha(ed.fullBuf, ed.w, rect) });
  syncBuf(rect);
  rebuildWork();
}

async function autoCut(btn) {
  const mine = ed;
  btn.disabled = true; btn.textContent = 'Working…';
  const out = await removeBackground(mine.src, mine.tol);
  btn.disabled = false; btn.textContent = 'Auto detect';
  // Identity, not truthiness: a result computed for one photo must never land
  // in a different session's mask.
  if (ed !== mine) return;
  if (!out) { toast('No flat background found. Try a higher tolerance.'); return; }
  ed.maskCtx.clearRect(0, 0, ed.w, ed.h);
  ed.maskCtx.drawImage(out, 0, 0, ed.w, ed.h);
  const rect = { x: 0, y: 0, w: ed.w, h: ed.h };
  pushHistory({ rect, a: cropAlpha(ed.fullBuf, ed.w, rect) });
  syncBuf(rect);
  rebuildWork();
}

function resetMask() {
  ed.maskCtx.globalCompositeOperation = 'source-over';
  ed.maskCtx.fillStyle = '#fff';
  ed.maskCtx.fillRect(0, 0, ed.w, ed.h);
  const rect = { x: 0, y: 0, w: ed.w, h: ed.h };
  pushHistory({ rect, a: cropAlpha(ed.fullBuf, ed.w, rect) });
  ed.fullBuf.fill(255);
  rebuildWork();
}

function undoEd() {
  const e = ed.past.pop();
  if (!e) return;
  ed.future.push({ rect: e.rect, a: readAlphaRect(ed.maskCtx, e.rect) });
  writeAlphaRect(ed.maskCtx, e.rect, e.a);
  syncBuf(e.rect);
  rebuildWork(); syncEditor();
}

function redoEd() {
  const e = ed.future.pop();
  if (!e) return;
  ed.past.push({ rect: e.rect, a: readAlphaRect(ed.maskCtx, e.rect) });
  writeAlphaRect(ed.maskCtx, e.rect, e.a);
  syncBuf(e.rect);
  rebuildWork(); syncEditor();
}

// ── rendering ────────────────────────────────────────────────────────────────

function rebuildWork() {
  if (!ed || ed.raf) return;
  ed.raf = requestAnimationFrame(() => {
    if (!ed) return;
    ed.raf = 0;
    const c = ed.workCtx;
    c.clearRect(0, 0, ed.w, ed.h);
    c.drawImage(ed.color || ed.src, 0, 0, ed.w, ed.h);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(ed.mask, 0, 0);
    c.globalCompositeOperation = 'source-over';
  });
}

function scheduleColor(delay = 150) {
  const mine = ed;
  clearTimeout(ed.fxTimer);
  ed.fxTimer = setTimeout(async () => {
    if (ed !== mine) return;
    if (isIdentity(mine.tf)) {
      mine.color?.close?.();
      mine.color = null; mine.colorKey = null; rebuildWork(); return;
    }
    const key = fxKey(mine.tf);
    if (mine.colorKey === key) return;
    const bmp = await applyFx(mine.src, mine.tf);
    if (ed !== mine) { bmp?.close?.(); return; }
    mine.color?.close?.();
    mine.color = bmp; mine.colorKey = key;
    rebuildWork();
  }, delay);
}

// ── UI sync ──────────────────────────────────────────────────────────────────

function sizeCursor() {
  const cur = $('#edCursor');
  const d = ed.brush * ed.view.s;
  cur.style.width = `${d}px`;
  cur.style.height = `${d}px`;
}

function syncEditor() {
  document.querySelectorAll('[data-ed-tool]').forEach((b) => {
    const on = b.dataset.edTool === ed.tool;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('[data-ed="undo"]').disabled = !ed.past.length;
  $('[data-ed="redo"]').disabled = !ed.future.length;
  $('#edBrush').value = String(ed.brush);
  $('#edSoft').value = String(ed.soft);
  $('#edTol').value = String(ed.tol);
  for (const k of ['bright', 'contrast', 'sat', 'temp']) {
    $(`[data-ed-adj="${k}"]`).value = String(ed.tf.adj[k] ?? (k === 'temp' ? 0 : 100));
  }
  document.querySelectorAll('[data-ed-filter]').forEach((b) =>
    b.classList.toggle('is-on', b.dataset.edFilter === ed.tf.filter));
  const brushy = ed.tool === 'erase' || ed.tool === 'restore';
  $('#edCursor').hidden = !brushy;
  viewport().dataset.tool = ed.tool;
  echoRanges($('#editor'));
}

// ── wiring (once) ────────────────────────────────────────────────────────────

export function wireEditor(depsIn) {
  deps = depsIn;
  const vp = viewport();

  // Filter chips, from the same list the collage sidebar uses.
  const wrap = $('[data-ed-filters]');
  PRESET_NAMES.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.edFilter = f; b.textContent = f;
    wrap.appendChild(b);
  });

  $('#editor').addEventListener('click', (e) => {
    if (!ed) return;
    const t = e.target.closest('[data-ed-tool]');
    if (t) { ed.tool = t.dataset.edTool; syncEditor(); return; }
    const f = e.target.closest('[data-ed-filter]');
    if (f) { ed.tf.filter = f.dataset.edFilter; syncEditor(); scheduleColor(0); return; }
    const act = e.target.closest('[data-ed]')?.dataset.ed;
    if (!act) return;
    if (act === 'done') applyEditor();
    else if (act === 'cancel') { if (!ed.applying) closeEditor(); }
    else if (act === 'undo') undoEd();
    else if (act === 'redo') redoEd();
    else if (act === 'zoomin') zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1.25);
    else if (act === 'zoomout') zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1 / 1.25);
    else if (act === 'zoomfit') fitView();
    else if (act === 'auto') autoCut(e.target.closest('[data-ed]'));
    else if (act === 'resetmask') resetMask();
    else if (act === 'noadjust') { ed.tf.filter = 'none'; ed.tf.adj = { bright: 100, contrast: 100, sat: 100, temp: 0 }; syncEditor(); scheduleColor(0); }
    else if (act === 'savepng') downloadEdited('image/png');
    else if (act === 'savejpg') downloadEdited('image/jpeg');
  });

  $('#editor').addEventListener('input', (e) => {
    if (!ed) return;
    const id = e.target.id;
    if (id === 'edBrush') { ed.brush = Number(e.target.value); sizeCursor(); }
    else if (id === 'edSoft') ed.soft = Number(e.target.value);
    else if (id === 'edTol') ed.tol = Number(e.target.value);
    const adj = e.target.closest('[data-ed-adj]');
    if (adj) { ed.tf.adj[adj.dataset.edAdj] = Number(e.target.value); scheduleColor(); }
    echoRanges($('#editor'));
  });

  wireInput({
    getEd: () => ed, viewport, toImage, zoomAt, fitView, applyView,
    strokeStart, strokeMove, strokeEnd, cancelStroke, wandAt,
    undoEd, redoEd, closeEditor, syncEditor, sizeCursor, toast, fxKey,
  });
}
