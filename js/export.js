import { state } from './state.js';
import { currentCells, currentPlacement } from './render.js';
import { exportBlob } from './compose.js';
import { aspect } from './layouts.js';
import { applyFx, fxKey, isIdentity } from './filters.js';
import { showToast } from './utils.js';

let format = 'png', busy = false;

export function syncExport() {
  const width = Number(document.querySelector('#exportSize').value);
  const height = Math.round(width / aspect(state.params.ratio));
  document.querySelector('#exportDimensions').textContent = `${width} × ${height} pixels · ${format.toUpperCase()}`;
  document.querySelector('#downloadCollage').disabled = !state.pool.length || busy;
  document.querySelector('#exportHint').textContent = state.pool.length
    ? 'Saved to your downloads. On a phone, open the image to save it to Photos.'
    : 'Add photos to download your collage.';
}

export function wireExport({ previewWidth }) {
  document.querySelectorAll('[data-fmt]').forEach((button) => {
    button.addEventListener('click', () => {
      format = button.dataset.fmt;
      document.querySelectorAll('[data-fmt]').forEach((b) => {
        b.classList.toggle('is-on', b === button);
        b.setAttribute('aria-pressed', String(b === button));
      });
      syncExport();
    });
  });
  document.querySelector('#exportSize').addEventListener('change', syncExport);
  const button = document.querySelector('#downloadCollage');
  button.addEventListener('click', async () => {
    if (busy || !state.pool.length) return;
    busy = true;
    button.querySelector('span').textContent = 'Preparing image…';
    button.setAttribute('aria-busy', 'true');
    syncExport();
    try {
      // A download immediately after moving a colour slider must include it,
      // even if the preview's debounced colour bake has not run yet.
      for (const photo of [...state.pool]) {
        const key = fxKey(photo.tf);
        if (photo.fxKey !== key) {
          const fx = isIdentity(photo.tf) ? null : await applyFx(photo.cut || photo.bitmap, photo.tf);
          if (fxKey(photo.tf) === key) { photo.fx = fx; photo.fxKey = key; }
        }
      }
      const width = Number(document.querySelector('#exportSize').value);
      const fmt = format;
      const cells = currentCells();
      const blob = await exportBlob(cells, currentPlacement(cells), {
        background: state.background, bg2: state.bg2, bgAngle: state.bgAngle,
        borderColor: state.borderColor, params: { ...state.params },
        overlays: state.overlays.map((overlay) => ({ ...overlay })),
        ar: aspect(state.params.ratio), previewW: previewWidth(),
      }, width, fmt === 'jpeg' ? 'image/jpeg' : 'image/png');
      if (!blob) throw new Error('No image was created');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mosaic-${width}px.${fmt === 'jpeg' ? 'jpg' : 'png'}`;
      document.body.append(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast('Your collage is ready. Check your downloads.');
    } catch {
      showToast('The image could not be saved. Try a smaller image size.');
    } finally {
      busy = false;
      button.querySelector('span').textContent = 'Download collage';
      button.removeAttribute('aria-busy');
      syncExport();
    }
  });
}
