// One-click demo collages. The sample photos are DRAWN, not downloaded: no
// network, no copyright, and a first visit shows the whole product in one
// click. Each recipe only turns the same knobs a user has, so a demo is also
// a lesson in what the controls do.

import { SAMPLES } from './demo-art.js';
import { state, addPhoto } from './state.js';
import { makeThumb } from './tools.js';
import { makeText } from './overlays.js';
import { applyStyle, STYLES } from './presets.js';
import * as H from './history.js';
import { showToast as toast } from './utils.js';

const styleByName = (name) => STYLES.find((s) => s.name === name);

// pick: indexes into SAMPLES; without it, the first `photos` samples load.
const RECIPES = {
  postcards: { photos: 8, layout: 'scatter', ratio: '3:2', style: 'prints' },
  heart:     { photos: 8, layout: 'heart', ratio: '1:1', style: 'pastel' },
  meme: {
    photos: 1, pick: [3], layout: 'grid', cols: 1, ratio: '1:1', style: 'noir',
    overlays: () => [
      makeText({ text: 'CHANGED THE LAYOUT AGAIN', x: 0, y: 0.02, w: 1, h: 0.16 }),
      makeText({ text: 'LOST NOTHING', x: 0, y: 0.82, w: 1, h: 0.16 }),
    ],
  },
  gallery:   { photos: 8, layout: 'masonry', cols: 4, ratio: '3:2', style: 'gallery' },
};

let built = null;   // the same 8 rendered canvases serve every recipe

async function samplePhotos(recipe) {
  if (!built) {
    built = SAMPLES.map((s) => {
      const cv = document.createElement('canvas');
      cv.width = s.w; cv.height = s.h;
      // Each demo canvas is read back twice (blob + bitmap): hint it.
      s.draw(cv.getContext('2d', { willReadFrequently: true }), s.w, s.h);
      return cv;
    });
  }
  const idx = recipe.pick
    || [...Array(Math.min(recipe.photos, SAMPLES.length)).keys()];
  const out = [];
  for (const i of idx) {
    // A real blob per photo, so demo photos persist and restore like any other.
    const blob = await new Promise((r) => built[i].toBlob(r, 'image/png'));
    const bitmap = await createImageBitmap(built[i]);
    out.push({ bitmap, blob, name: SAMPLES[i].name });
  }
  return out;
}

async function loadDemo(name, repaint) {
  const r = RECIPES[name];
  if (!r) return;
  H.mark(state);
  const photos = await samplePhotos(r);
  state.pool.length = 0;
  state.overrides.clear();
  state.overlays = [];
  state.selectedOverlay = null;
  state.selected = null;
  for (const ph of photos) {
    const p = addPhoto(ph);
    p.thumb = await makeThumb(ph.bitmap);
  }
  state.layout = r.layout;
  state.params.ratio = r.ratio;
  if (r.cols) state.params.cols = r.cols;
  applyStyle(state, styleByName(r.style));
  if (r.overlays) state.overlays = r.overlays();
  repaint();
  toast('Demo loaded. Every control still applies: switch the layout, nothing is lost.');
}

let armed = null, armTimer = 0, loading = false;

export function wireDemos({ repaint }) {
  document.querySelectorAll('[data-demo]').forEach((b) => {
    b.addEventListener('click', async () => {
      // One demo at a time: disabling only the clicked button would let its
      // sibling start a second load into the half-replaced pool.
      if (loading) return;
      const name = b.dataset.demo;
      // Replacing real photos wants a confirming second click. Undo restores
      // the arrangement but cannot resurrect removed bitmaps, so the guard is
      // the protection, not undo.
      if (state.pool.length && armed !== name) {
        armed = name;
        clearTimeout(armTimer);
        // The armed state lives on the chips themselves, not only in a toast
        // that fades: both chips for this demo (rail + empty state) light up.
        const arm = (on) => document.querySelectorAll(`[data-demo="${name}"]`)
          .forEach((x) => x.classList.toggle('is-armed', on));
        arm(true);
        armTimer = setTimeout(() => { armed = null; arm(false); }, 3500);
        toast('This replaces your current photos. Click again to load the demo.');
        return;
      }
      armed = null;
      document.querySelectorAll('[data-demo].is-armed')
        .forEach((x) => x.classList.remove('is-armed'));
      loading = true;
      b.disabled = true;
      try { await loadDemo(name, repaint); }
      finally { loading = false; b.disabled = false; }
    });
  });
}
