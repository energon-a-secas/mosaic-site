import { state, LAYOUTS, selectedPhoto, selectedOverlayObj } from './state.js';
import { computeCells, aspect, USES_COLS } from './layouts.js';
import { TEMPLATES, applyTemplate, matchesTemplate } from './templates.js';
import { STYLES } from './presets.js';

let activePanel = 'layout';
const mobile = matchMedia('(max-width: 1024px)');

/** Small previews use the actual layout geometry. No image assets to download. */
function layoutIcon(layout, cols, count, ratio) {
  const ar = aspect(ratio), width = 72, height = width / ar;
  const cells = computeCells(count, layout, { cols, gap: 12, pad: 12 }, [], ar);
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" fill="currentColor">`
    + cells.map((c) => `<rect x="${c.x * width}" y="${c.y * height}" width="${Math.max(0, c.w * width)}" height="${Math.max(0, c.h * height)}" rx="2"/>`).join('')
    + '</svg>';
}

export function openPanel(name, { focus = false } = {}) {
  if (name === 'photos' && !mobile.matches) name = 'layout';
  activePanel = name;
  const rail = document.querySelector('#rail'), side = document.querySelector('#side');
  const showingPhotos = name === 'photos' && mobile.matches;
  rail.toggleAttribute('data-open', !showingPhotos);
  side.toggleAttribute('data-open', showingPhotos);
  rail.inert = showingPhotos;
  side.inert = mobile.matches && !showingPhotos;
  document.querySelectorAll('[data-tool-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.toolPanel !== (name === 'photos' ? 'layout' : name);
  });
  document.querySelectorAll('[data-panel-target]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.panelTarget === name));
  });
  rail.scrollTop = 0;
  if (focus) {
    const heading = document.querySelector(showingPhotos ? '#side h2' : `#panel-${name} h2`);
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
}

export function wireWorkspace({ edit, repaint, editPhoto, moveSelected }) {
  const presets = document.querySelector('[data-templates]');
  for (const t of TEMPLATES) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'template-button'; button.dataset.template = t.id;
    button.innerHTML = layoutIcon('grid', t.cols, t.count, t.ratio)
      + `<strong>${t.name}</strong><small>${t.ratio}</small>`;
    button.addEventListener('click', () => edit(() => applyTemplate(state, t.id)));
    presets.append(button);
  }
  const layouts = document.querySelector('[data-layout-options]');
  for (const layout of LAYOUTS) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'chip layout-option'; button.dataset.layout = layout;
    button.innerHTML = layoutIcon(layout, 3, 6, '3:2') + `<span>${layout[0].toUpperCase() + layout.slice(1)}</span>`;
    layouts.append(button);
  }
  document.querySelectorAll('[data-panel-target]').forEach((button) => {
    button.addEventListener('click', () => openPanel(button.dataset.panelTarget, {
      focus: button.closest('.workspace-toolbar') !== null,
    }));
  });
  document.querySelectorAll('[data-photo-move]').forEach((button) => {
    button.addEventListener('click', () => moveSelected(Number(button.dataset.photoMove)));
  });
  document.querySelector('[data-act="editselected"]').addEventListener('click', () => {
    if (selectedOverlayObj()) openPanel('text', { focus: true });
    else if (selectedPhoto()) editPhoto(selectedPhoto());
  });
  document.querySelector('#captionList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-caption]');
    if (!button) return;
    state.selectedOverlay = button.dataset.caption;
    state.selected = null;
    repaint();
    document.querySelector('#otext').focus();
  });
  mobile.addEventListener('change', () => openPanel(activePanel));
  // Real chrome heights account for wrapping, device safe areas, and larger
  // text. Fixed pixel guesses put the final controls under the mobile bar.
  const main = document.querySelector('#main');
  const toolbar = document.querySelector('.workspace-toolbar');
  const header = document.querySelector('.header-bar');
  const navigation = document.querySelector('.mobile-tools');
  const measureChrome = () => {
    main.style.setProperty('--workspace-top', `${header.getBoundingClientRect().height + toolbar.getBoundingClientRect().height}px`);
    main.style.setProperty('--workspace-nav-height', `${navigation.getBoundingClientRect().height}px`);
  };
  const chromeSize = new ResizeObserver(measureChrome);
  [header, toolbar, navigation].forEach((element) => chromeSize.observe(element));
  measureChrome();
  openPanel(activePanel);
}

export function syncWorkspace() {
  for (const t of TEMPLATES) {
    document.querySelector(`[data-template="${t.id}"]`)?.setAttribute('aria-pressed', String(matchesTemplate(state, t)));
  }
  document.querySelectorAll('[data-style]').forEach((button) => {
    const s = STYLES.find((style) => style.name === button.dataset.style);
    const on = s && state.background === s.bg && state.bg2 === s.bg2
      && ['gap', 'pad', 'radius', 'border'].every((key) => state.params[key] === s[key]);
    button.classList.toggle('is-on', !!on);
    button.setAttribute('aria-pressed', String(!!on));
  });
  const count = state.pool.length;
  const cols = USES_COLS.includes(state.layout) ? ` · ${state.params.cols} column${state.params.cols === 1 ? '' : 's'}` : ` · ${state.layout}`;
  document.querySelector('#canvasBadge').textContent = state.params.ratio + cols;
  document.querySelector('.stage-wrap').classList.toggle('is-empty', !count);
  document.querySelector('#photosEmpty').hidden = !!count;
  const photo = selectedPhoto(), caption = selectedOverlayObj();
  const selected = !!photo || !!caption;
  document.querySelector('#selectionActions').hidden = !selected;
  document.querySelector('#stageHint').hidden = selected;
  document.querySelector('#stageHint').textContent = count
    ? 'Drag a photo to reframe. Pinch or scroll to zoom.'
    : 'Pick your photos. Find your layout. Make it yours.';
  document.querySelector('#photoOrder').hidden = !photo;
  document.querySelector('#selectionName').textContent = caption ? 'Caption selected' : photo?.name || '';
  document.querySelector('[data-act="editselected"]').textContent = caption ? 'Edit text' : 'Edit photo';
  // Placement, not pool order, is the order a user sees after explicit swaps.
  // Events owns the actual swap and updates the disabled boundary states.
  document.querySelectorAll('#selectionActions [data-photo-move]').forEach((b) => { b.hidden = !!caption; });
  for (const action of ['clear', 'allbw', 'shuffle']) {
    const button = document.querySelector(`[data-act="${action}"]`);
    button.disabled = count < (action === 'shuffle' ? 2 : 1);
  }
  const list = document.querySelector('#captionList');
  list.replaceChildren();
  for (const overlay of state.overlays) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'chip' + (overlay.id === state.selectedOverlay ? ' is-on' : '');
    button.dataset.caption = overlay.id;
    button.textContent = overlay.text || 'Empty caption';
    button.setAttribute('aria-pressed', String(overlay.id === state.selectedOverlay));
    list.append(button);
  }
}
