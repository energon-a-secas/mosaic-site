import { state, resolvePlacement, selectedPhoto, spansFor, selectedOverlayObj } from './state.js';
import { computeCells, aspect, USES_COLS, USES_SPAN } from './layouts.js';
import { compose, FILTER_NAMES } from './compose.js';

const $ = (s) => document.querySelector(s);
export const refs = {};

export function cacheRefs() {
  refs.canvas = $('#stage');
  refs.ctx = refs.canvas.getContext('2d');
  refs.strip = $('#strip');
  refs.count = $('#count');
  refs.inspector = $('#inspector');
  refs.empty = $('#empty');
}

/**
 * Cells for the current pool + params.
 * Spans depend on placement and placement depends on cell count, so this resolves
 * once with unit spans to learn the count, then re-runs with the real spans. Two
 * cheap passes beat threading photos into the layout engine, which contract 1
 * forbids.
 */
export function currentCells() {
  const n = Math.max(state.pool.length, 1);
  const ar = aspect(state.params.ratio);
  const first = computeCells(n, state.layout, state.params, [], ar);
  const spans = spansFor(resolvePlacement(first.length));
  return computeCells(n, state.layout, state.params, spans, ar);
}

export function currentPlacement(cells) {
  return resolvePlacement(cells.length);
}

export function drawStage() {
  const cells = currentCells();
  const placement = currentPlacement(cells);
  const ar = aspect(state.params.ratio);

  // Fit the stage to its box while keeping the chosen aspect exactly.
  const box = refs.canvas.parentElement.getBoundingClientRect();
  const maxW = Math.max(240, box.width - 32);
  const maxH = Math.max(200, box.height - 32);
  let W = maxW, H = W / ar;
  if (H > maxH) { H = maxH; W = H * ar; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  refs.canvas.width = Math.round(W * dpr);
  refs.canvas.height = Math.round(H * dpr);
  refs.canvas.style.width = `${Math.round(W)}px`;
  refs.canvas.style.height = `${Math.round(H)}px`;
  refs.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  compose(refs.ctx, cells, placement, {
    W, H, background: state.background, params: state.params,
    overlays: state.overlays,
  });
  refs.empty.hidden = state.pool.length > 0;
  return { cells, placement, W, H, ar };
}

export function drawStrip() {
  refs.count.textContent = state.pool.length
    ? `${state.pool.length} photo${state.pool.length > 1 ? 's' : ''}`
    : 'no photos yet';
  refs.strip.innerHTML = '';
  state.pool.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'thumb' + (state.selected === p.id ? ' is-sel' : '');
    li.draggable = true;
    li.dataset.id = p.id;
    li.dataset.index = String(i);
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 96;
    const c = cv.getContext('2d');
    const img = p.thumb || p.cut || p.bitmap;
    const s = Math.max(96 / img.width, 96 / img.height);
    c.drawImage(img, (96 - img.width * s) / 2, (96 - img.height * s) / 2,
      img.width * s, img.height * s);
    li.appendChild(cv);
    const del = document.createElement('button');
    del.className = 'thumb-x';
    del.type = 'button';
    del.dataset.del = p.id;
    del.setAttribute('aria-label', `Remove ${p.name}`);
    del.textContent = '×';
    li.appendChild(del);
    if (p.cut) {
      const b = document.createElement('span');
      b.className = 'thumb-cut'; b.textContent = 'cut';
      li.appendChild(b);
    }
    refs.strip.appendChild(li);
  });
}

export function drawTextInspector() {
  const el = document.querySelector('#textins');
  const o = selectedOverlayObj();
  el.hidden = !o;
  if (!o) return;
  for (const k of ['text', 'color', 'stroke', 'strokeRatio', 'rot', 'w']) {
    const f = el.querySelector(`[data-o="${k}"]`);
    if (f && f.value !== String(o[k])) f.value = o[k] === 'none' ? '#000000' : o[k];
  }
  el.querySelectorAll('[data-ofont]').forEach((b) =>
    b.classList.toggle('is-on', b.dataset.ofont === o.font));
  el.querySelectorAll('[data-o-align]').forEach((b) =>
    b.classList.toggle('is-on', b.dataset.oAlign === o.align));
  el.querySelector('[data-o-toggle="upper"]').classList.toggle('is-on', !!o.upper);
}

export function drawInspector() {
  const p = selectedPhoto();
  refs.inspector.hidden = !p || !!state.selectedOverlay;
  if (!p) return;
  refs.inspector.querySelector('[data-ins-name]').textContent = p.name;
  const set = (k, v) => {
    const el = refs.inspector.querySelector(`[data-tf="${k}"]`);
    if (el) el.value = String(v);
  };
  set('zoom', p.tf.zoom); set('ox', p.tf.ox); set('oy', p.tf.oy); set('rot', p.tf.rot);
  refs.inspector.querySelectorAll('[data-filter]').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.filter === p.tf.filter);
  });
  refs.inspector.querySelector('[data-flip="h"]').classList.toggle('is-on', p.tf.flipH);
  refs.inspector.querySelector('[data-flip="v"]').classList.toggle('is-on', p.tf.flipV);
  for (const k of ['bright', 'contrast', 'sat']) {
    const el = refs.inspector.querySelector(`[data-adj="${k}"]`);
    if (el) el.value = String(p.tf.adj[k]);
  }
  const heroBtn = refs.inspector.querySelector('[data-act="hero"]');
  heroBtn.classList.toggle('is-on', p.span === 2);
  heroBtn.hidden = !USES_SPAN.includes(state.layout);
  const cut = refs.inspector.querySelector('[data-act="restore"]');
  if (cut) cut.hidden = !p.cut;
}

export function buildFilterButtons() {
  const wrap = document.querySelector('[data-filters]');
  wrap.innerHTML = '';
  FILTER_NAMES.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.filter = f; b.textContent = f;
    wrap.appendChild(b);
  });
}

export function syncControls() {
  document.querySelectorAll('[data-layout]').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.layout === state.layout);
  });
  const cols = document.querySelector('[data-param="cols"]');
  cols.value = String(state.params.cols);
  document.querySelector('[data-cols-out]').textContent = String(state.params.cols);
  // Column count is meaningless for the shape and strip layouts.
  document.querySelector('[data-cols-row]').hidden = !USES_COLS.includes(state.layout);
  for (const k of ['gap', 'radius', 'pad']) {
    const el = document.querySelector(`[data-param="${k}"]`);
    if (el) el.value = String(state.params[k]);
  }
  document.querySelector('[data-param="ratio"]').value = state.params.ratio;
  document.querySelector('[data-param="background"]').value = state.background;
}

/** Undo/redo buttons reflect whether there is anything to undo. */
export function syncHistory(canUndo, canRedo) {
  const u = document.querySelector('[data-act="undo"]');
  const r = document.querySelector('[data-act="redo"]');
  if (u) u.disabled = !canUndo;
  if (r) r.disabled = !canRedo;
}

export function renderAll() {
  syncControls();
  drawStrip();
  drawInspector();
  drawTextInspector();
  return drawStage();
}
