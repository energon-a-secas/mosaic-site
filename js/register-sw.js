// Registering the worker, and the update handshake.
//
// The worker deliberately does not call skipWaiting() during install, so a new
// version sits in `waiting` until this file asks for the swap. That ordering is
// the whole point: Mosaic holds unsaved brushwork and a 700ms save debounce, so
// a worker that activated the moment it downloaded could swap the module graph
// under a tab mid-stroke. The page asks, the worker obeys, the page reloads
// once.

import { showToast as toast } from './utils.js';

// Guards the reload. controllerchange fires once per swap, but a user who
// triggers two updates quickly can otherwise reload into a reload.
let refreshing = false;

function offerUpdate(worker) {
  toast('A new version of Mosaic is ready. Reload to use it.');
  // The toast is not clickable, so the swap happens on the next deliberate
  // reload rather than under the user's hands. Ask for it now; the browser
  // holds the new worker until every tab is gone or this page reloads.
  worker.postMessage({ type: 'SKIP_WAITING' });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// has no worker and localhost is fine, but a page opened straight
  // from disk should not log a scary error.
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        // Without this the browser may satisfy the worker's own imports from
        // the HTTP cache, and GitHub Pages sends max-age=600 on everything.
        updateViaCache: 'none',
      });

      // A worker can already be waiting from a previous visit, in which case
      // updatefound has long since fired and listening for it alone misses it.
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          // No controller means this is the first install, not an update:
          // there is nothing to tell the user about.
          if (next.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(next);
        });
      });
    } catch (err) {
      // Offline support is a bonus; failing to get it must never break the app.
      console.warn('[sw] registration failed', err);
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}
