import { state, addPhoto, removePhoto, movePhoto, swapCells, byId, selectedPhoto } from './state.js';
import { renderAll, drawStage, currentCells, currentPlacement, refs } from './render.js';
import { exportBlob } from './compose.js';
import { aspect } from './layouts.js';
import { removeBackground, makeThumb } from './tools.js';
import { showToast as toast } from './utils.js';

let dragFrom = null;      // strip reorder
let cellDrag = null;      // stage cell swap

async function ingest(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  for (const f of list) {
    try {
      const bmp = await createImageBitmap(f);
      const p = addPhoto({ bitmap: bmp, name: f.name, w: bmp.width, h: bmp.height });
      p.thumb = await makeThumb(bmp);
    } catch {
      toast(`Could not read ${f.name}`);
    }
  }
  renderAll();
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
const repaint = () => { lastFrame = renderAll(); };
const repaintStage = () => { lastFrame = drawStage(); };

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
    b.addEventListener('click', () => { state.layout = b.dataset.layout; repaint(); });
  });
  document.querySelectorAll('[data-param]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = el.dataset.param;
      if (k === 'ratio') state.params.ratio = el.value;
      else if (k === 'background') state.background = el.value;
      else state.params[k] = Number(el.value);
      repaint();
    });
  });

  // ── strip: select, delete, reorder ────────────────────────────────────────
  refs.strip.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { removePhoto(del.dataset.del); repaint(); return; }
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
    if (li && dragFrom !== null) { movePhoto(dragFrom, Number(li.dataset.index)); repaint(); }
    dragFrom = null;
  });

  // ── stage: click to select, drag one cell onto another to swap ────────────
  refs.canvas.addEventListener('pointerdown', (e) => {
    const i = cellAt(e);
    if (i < 0) return;
    cellDrag = i;
    const p = lastFrame.placement[i];
    state.selected = p ? p.id : null;
    repaint();
  });
  refs.canvas.addEventListener('pointerup', (e) => {
    if (cellDrag === null) return;
    const j = cellAt(e);
    if (j >= 0 && j !== cellDrag) {
      swapCells(cellDrag, j, lastFrame.placement);
      repaint();
    }
    cellDrag = null;
  });

  // ── inspector ─────────────────────────────────────────────────────────────
  const ins = refs.inspector;
  ins.addEventListener('input', (e) => {
    const el = e.target.closest('[data-tf]');
    const p = selectedPhoto();
    if (!el || !p) return;
    p.tf[el.dataset.tf] = Number(el.value);
    repaintStage();
  });
  ins.addEventListener('click', async (e) => {
    const p = selectedPhoto();
    if (!p) return;
    const f = e.target.closest('[data-filter]');
    if (f) { p.tf.filter = f.dataset.filter; repaint(); return; }
    const fl = e.target.closest('[data-flip]');
    if (fl) {
      p.tf[fl.dataset.flip === 'h' ? 'flipH' : 'flipV'] =
        !p.tf[fl.dataset.flip === 'h' ? 'flipH' : 'flipV'];
      repaint(); return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reset') {
      p.tf = { zoom: 1, ox: 0, oy: 0, rot: 0, flipH: false, flipV: false, filter: 'none' };
      repaint();
    } else if (act === 'cutout') {
      const btn = e.target.closest('[data-act]');
      btn.disabled = true; btn.textContent = 'Working…';
      const tol = Number(ins.querySelector('[data-tol]').value);
      const out = await removeBackground(p.bitmap, tol);
      btn.disabled = false; btn.textContent = 'Remove background';
      if (!out) { toast('No flat background found. Try a higher tolerance.'); return; }
      p.cut = out; p.thumb = await makeThumb(out);
      repaint();
    } else if (act === 'restore') {
      p.cut = null; p.thumb = await makeThumb(p.bitmap); repaint();
    }
  });

  // ── export ────────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-export]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!state.pool.length) { toast('Add a photo first'); return; }
      const px = Number(b.dataset.export);
      const cells = currentCells();
      const blob = await exportBlob(cells, currentPlacement(cells), {
        background: state.background, params: state.params,
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
    state.pool.length = 0; state.overrides.clear(); state.selected = null;
    repaint();
  });

  addEventListener('resize', repaintStage);
  repaint();
}

export { repaint };
