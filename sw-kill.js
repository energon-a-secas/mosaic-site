// The rollback worker. Copy this over sw.js and deploy to undo offline support.
//
// A service worker is the one deploy artifact `git revert` cannot retract: a
// browser that has installed one keeps using it, so deleting sw.js from the
// site does not reliably remove it from anybody's machine. The documented way
// out is to ship a worker that unregisters itself, which is this file.
//
// It has NO fetch handler on purpose. Chrome treats a worker without one as
// transparent, so every request goes to the network as if no worker existed,
// starting with the very first load rather than after the unregister lands.
//
// It also does NOT call clients.navigate() to force tabs to reload, which the
// canonical version of this pattern does. Mosaic has no beforeunload, a 700ms
// save debounce, and a focus editor that only persists its cutout on Done, so
// a forced reload here is silent data loss. Tabs pick this up on their own
// next navigation, which is soon enough for a rollback.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
  })());
});
