// Pure regressions for the mobile starting layout and reversible photo actions.
// Run: node tests/workspace.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { state, addPhoto, removePhoto, resolvePlacement, swapCells } from '../js/state.js';
import { aspect, computeCells } from '../js/layouts.js';
import { TEMPLATES, applyTemplate } from '../js/templates.js';
import * as history from '../js/history.js';

test('a fresh collage uses two columns on a 16:9 canvas', () => {
  assert.equal(state.params.cols, 2);
  assert.equal(state.params.ratio, '16:9');
  const cells = computeCells(2, state.layout, state.params, [], aspect(state.params.ratio));
  assert.equal(cells.length, 2);
  assert.equal(cells[0].y, cells[1].y);
  assert.equal(cells[0].h, cells[1].h);
  assert.ok(cells[0].x + cells[0].w < cells[1].x);
});

test('one photo fills the row without an empty second column', () => {
  const cells = computeCells(1, 'grid', { cols: 2, pad: 0, gap: 0 }, [], 16 / 9);
  assert.deepEqual(cells, [{ x: 0, y: 0, w: 1, h: 1 }]);
});

test('every preset preserves photos, crops, captions and explicit ordering', () => {
  const photo = { id: 'original', tf: { zoom: 2, cx: .1, cw: .8 } };
  const model = { pool: [photo], overlays: [{ text: 'Keep me' }],
    overrides: new Map([[0, photo.id]]), params: { ...state.params } };
  for (const template of TEMPLATES) {
    applyTemplate(model, template.id);
    assert.equal(model.pool[0], photo);
    assert.equal(model.pool[0].tf.zoom, 2);
    assert.equal(model.pool[0].tf.cx, .1);
    assert.equal(model.overlays[0].text, 'Keep me');
    assert.equal(model.overrides.get(0), photo.id);
    assert.equal(model.params.ratio, template.ratio);
  }
});

test('spacing extremes never create negative cells, including 19:6 banners', () => {
  for (const ratio of ['1:1', '16:9', '19:6', '4:5', '9:16']) {
    for (const n of [1, 2, 8, 30]) {
      for (const layout of ['grid', 'masonry', 'strip', 'scatter', 'heart', 'circle']) {
        const cells = computeCells(n, layout, { cols: 8, pad: 80, gap: 48 }, [], aspect(ratio));
        assert.equal(cells.length, n);
        for (const cell of cells) {
          assert.ok(cell.w > 0 && cell.h > 0, `${layout}/${ratio}/${n}: ${JSON.stringify(cell)}`);
          assert.ok(Number.isFinite(cell.x) && Number.isFinite(cell.y));
        }
      }
    }
  }
});

test('delete, undo, redo, and clear preserve photo pixels and edits', () => {
  state.pool = []; state.overrides.clear(); history.reset();
  const bitmap = { width: 40, height: 30 };
  const p = addPhoto({ bitmap, name: 'Original', blob: {} });
  p.tf.zoom = 1.7; p.tf.adj.bright = 120;
  p.cut = { width: 20, height: 15 }; p.cutBlob = {};
  p.fx = {}; p.thumb = {};
  const originalCut = p.cut, originalThumb = p.thumb;
  history.mark(state);
  removePhoto(p.id);
  assert.equal(state.pool.length, 0);
  assert.ok(history.undo(state));
  assert.equal(state.pool[0], p);
  assert.equal(p.bitmap, bitmap);
  assert.equal(p.cut, originalCut);
  assert.equal(p.thumb, originalThumb);
  assert.equal(p.tf.zoom, 1.7);
  assert.equal(p.tf.adj.bright, 120);
  assert.ok(history.redo(state));
  assert.equal(state.pool.length, 0);
  history.undo(state);
  addPhoto({ bitmap, name: 'Second', blob: {} });
  history.mark(state);
  state.pool.length = 0;
  history.undo(state);
  assert.equal(state.pool.length, 2);
  assert.equal(state.pool[0].bitmap, bitmap);
});

test('touch reorder swaps the visible placement and can be undone', () => {
  history.reset(); state.overrides.clear();
  const original = resolvePlacement(2).map((p) => p.id);
  history.mark(state);
  swapCells(0, 1, resolvePlacement(2));
  assert.deepEqual(resolvePlacement(2).map((p) => p.id), [...original].reverse());
  history.undo(state);
  assert.deepEqual(resolvePlacement(2).map((p) => p.id), original);
});
