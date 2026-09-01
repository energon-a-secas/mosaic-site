// ── Shared utilities ─────────────────────────────────────────
// Small, pure helper functions used across multiple modules.

/** Cached element lookup by ID. */
const _els = {};
export function $(id) {
  return _els[id] || (_els[id] = document.getElementById(id));
}

/**
 * Numeric readouts for sliders: every `<b data-echo="someInputId">` shows that
 * input's current value, the same idiom the Columns readout uses. Call after
 * any pass that sets slider values programmatically.
 */
export function echoRanges(scope = document) {
  scope.querySelectorAll('[data-echo]').forEach((b) => {
    const el = document.getElementById(b.dataset.echo);
    if (el) b.textContent = String(Math.round(Number(el.value) * 100) / 100);
  });
}

/** Show a temporary toast notification. */
let _toastTimer = null;
export function showToast(msg) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  // Announced by screen readers. Without these the toast is
  // invisible to anyone not looking at that corner of the screen.
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 2000);
}
