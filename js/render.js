import { state, resolvePlacement, selectedPhoto } from './state.js';
import { computeCells, aspect } from './layouts.js';
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

/** Cells for the current pool + params. Exported so events can hit-test. */
export function currentCells() {
  return computeCells(Math.max(state.pool.length, 1), state.layout, state.params);
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

export function drawInspector() {
  const p = selectedPhoto();
  refs.inspector.hidden = !p;
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
  document.querySelector('[data-cols-row]').hidden =
    !['grid', 'masonry'].includes(state.layout);
  for (const k of ['gap', 'radius', 'pad']) {
    const el = document.querySelector(`[data-param="${k}"]`);
    if (el) el.value = String(state.params[k]);
  }
  document.querySelector('[data-param="ratio"]').value = state.params.ratio;
  document.querySelector('[data-param="background"]').value = state.background;
}

export function renderAll() {
  syncControls();
  drawStrip();
  drawInspector();
  return drawStage();
}
