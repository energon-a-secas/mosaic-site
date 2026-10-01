import { state, addPhoto, replacePhoto, selectedPhoto } from './state.js';
import { makeThumb } from './tools.js';
import { mark } from './history.js';
import { showToast } from './utils.js';

const isHeic = (file) => /\.(heic|heif)$/i.test(file.name || '') || /image\/(heic|heif)/i.test(file.type || '');

export function wireImport({ repaint, ready }) {
  let queue = Promise.resolve();
  const status = document.querySelector('#importStatus');
  async function ingest(files) {
    const list = [...files].filter((file) => file.type.startsWith('image/') || !file.type);
    if (!list.length) { showToast('Choose image files, such as JPG, PNG, or WebP.'); return; }
    const failed = [];
    let added = 0;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      status.textContent = `Opening photo ${i + 1} of ${list.length}…`;
      let bitmap, committed = false;
      try {
        // Try the browser's decoder first. Safari can open HEIC; rejecting the
        // extension up front made the most common iPhone import fail there too.
        bitmap = await createImageBitmap(file);
        const thumb = await makeThumb(bitmap, 200);
        if (!added) mark(state);
        const photo = addPhoto({ bitmap, name: file.name || `Photo ${state.nextId}`, blob: file });
        photo.thumb = thumb;
        committed = true;
        added++;
      } catch { failed.push(file); }
      finally { if (!committed) bitmap?.close(); }
    }
    const summary = added ? `${added} photo${added === 1 ? '' : 's'} added.` : 'No photos were added.';
    if (failed.some(isHeic)) showToast(`${summary} This browser could not open HEIC. Export those photos as JPEG and try again.`);
    else if (failed.length) showToast(`${summary} ${failed.length} file${failed.length === 1 ? '' : 's'} could not be opened. Try JPG, PNG, or WebP.`);
    else showToast(summary);
  }
  async function replace(file, original) {
    let bitmap, thumb, committed = false;
    status.textContent = 'Opening replacement photo…';
    try {
      bitmap = await createImageBitmap(file);
      thumb = await makeThumb(bitmap, 200, original.tf);
      // File picking and decoding are asynchronous. Never replace a different
      // selection or resurrect a photo removed while the image was opening.
      if (!state.pool.includes(original)) {
        showToast('That photo is no longer in the collage. Select a photo to replace.');
        return;
      }
      mark(state);
      replacePhoto(original, { bitmap, thumb, name: file.name || original.name, blob: file });
      committed = true;
      showToast(original.cut
        ? 'Photo replaced. Framing and colour kept; background erasing reset.'
        : 'Photo replaced. Framing and colour kept.');
    } catch {
      showToast(isHeic(file)
        ? 'This browser could not open HEIC. Try a JPEG. Your original photo is still here.'
        : 'This image could not be opened. Try JPG, PNG, or WebP. Your original photo is still here.');
    } finally {
      if (!committed) { bitmap?.close(); thumb?.close(); }
    }
  }
  const enqueue = (files, original = null) => {
    const batch = [...files];
    if (!batch.length) return;
    queue = queue.then(async () => {
      await ready();
      const buttons = [...document.querySelectorAll('[data-act="add"], [data-act="replace"], #emptyChoose, [data-demo]')];
      buttons.forEach((button) => { button.disabled = true; });
      status.hidden = false;
      try { await (original ? replace(batch[0], original) : ingest(batch)); }
      finally {
        buttons.forEach((button) => { button.disabled = false; });
        status.hidden = true;
        repaint();
      }
    }).catch(() => {
      showToast('These photos could not be opened. Try a smaller batch.');
    });
  };
  const file = document.querySelector('#file');
  document.querySelectorAll('[data-act="add"], #emptyChoose').forEach((button) => {
    button.addEventListener('click', () => file.click());
  });
  file.addEventListener('change', () => { enqueue(file.files); file.value = ''; });
  const replacementFile = document.querySelector('#replacementFile');
  let replacementTarget = null;
  document.querySelector('[data-act="replace"]').addEventListener('click', () => {
    replacementTarget = selectedPhoto();
    if (replacementTarget) replacementFile.click();
  });
  replacementFile.addEventListener('change', () => {
    if (replacementTarget) enqueue(replacementFile.files, replacementTarget);
    replacementTarget = null;
    replacementFile.value = '';
  });
  replacementFile.addEventListener('cancel', () => { replacementTarget = null; });
  let dragDepth = 0;
  document.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); dragDepth++;
    document.body.classList.add('is-dropping');
  });
  document.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('is-dropping'); }
  });
  document.addEventListener('drop', (event) => {
    dragDepth = 0; document.body.classList.remove('is-dropping');
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault(); enqueue(event.dataTransfer.files);
  });
  addEventListener('paste', (event) => {
    if (document.body.classList.contains('editor-open')) return;
    const items = [...(event.clipboardData?.items || [])].filter((item) => item.type.startsWith('image/'));
    if (!items.length) return;
    event.preventDefault(); enqueue(items.map((item) => item.getAsFile()).filter(Boolean));
  });
}
