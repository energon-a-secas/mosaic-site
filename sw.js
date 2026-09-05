// Mosaic service worker: the app itself, available without the network.
//
// The product's claim is that photos never leave the browser. They never did,
// but the APP still needed the network to start, which made "works offline"
// something a user had to take on faith. This closes that.
//
// Three rules decide everything below.
//
// 1. CODE IS NETWORK-FIRST. The ES-module graph is all-or-nothing: one stale
//    module with a renamed export white-screens the whole app. So scripts,
//    styles and navigations go to the network first and fall back to the cache
//    only when it fails. The `cache: 'no-cache'` is required, not decorative:
//    without it the browser's own HTTP cache answers this worker's fetch from
//    the same 600s-max-age copy we are trying to get past, and network-first
//    quietly becomes cache-first.
//
// 2. CROSS-ORIGIN IS NEVER CACHED. cdn.neorgon.org sends no CORS headers, so
//    the only way to store base.css would be an opaque response: unreadable,
//    unverifiable, and padded by megabytes against the SAME storage quota that
//    holds the user's photos. Losing someone's collage to cache a stylesheet
//    is a bad trade. Offline the page renders without the CDN's spacing and
//    type tokens, which is measurably ugly and entirely usable.
//    projects/neorgon-cdn-site/scripts/setup-r2-cors.sh fixes this at the
//    source; when it has run, those assets can move into the precache.
//
// 3. THE CACHE SELF-HEALS. Every successful same-origin GET is written back,
//    so a precache list that drifts makes the app slower on one load, never
//    broken. scripts/check-precache.py is what stops it drifting silently.
//
// Rollback: copy sw-kill.js over this file and deploy. See CLAUDE.md.

const VERSION = 'mosaic-v1';

// PRECACHE-BEGIN  (scripts/check-precache.py --list regenerates this; it is
// checked by `make smoke`, and nothing rewrites it automatically)
const PRECACHE = [
  '/',
  '/apple-touch-icon.png',
  '/css/neorgon-footer.css',
  '/css/neorgon-header.css',
  '/css/neorgon-themes.css',
  '/css/style.css',
  '/favicon.ico',
  '/favicon.svg',
  '/js/app.js',
  '/js/autosave.js',
  '/js/compose.js',
  '/js/demo-art.js',
  '/js/demos.js',
  '/js/editor-input.js',
  '/js/editor-tools.js',
  '/js/editor.js',
  '/js/events.js',
  '/js/filters.js',
  '/js/gestures.js',
  '/js/history.js',
  '/js/layouts.js',
  '/js/neorgon-footer.js',
  '/js/neorgon-header.js',
  '/js/overlays.js',
  '/js/presets.js',
  '/js/register-sw.js',
  '/js/render.js',
  '/js/state.js',
  '/js/store.js',
  '/js/tools.js',
  '/js/utils.js',
  '/logo.svg',
  '/site.webmanifest',
];
// PRECACHE-END

const isCode = (req) =>
  req.mode === 'navigate' || req.destination === 'script' || req.destination === 'style';

self.addEventListener('install', (e) => {
  // Per entry, never cache.addAll: addAll rejects the WHOLE install if any one
  // path 404s, which turns a single renamed file into "no offline support at
  // all", silently. allSettled degrades to "that one file is missing" instead.
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const results = await Promise.allSettled(PRECACHE.map((p) => cache.add(new Request(p, { cache: 'reload' }))));
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? PRECACHE[i] : null))
      .filter(Boolean);
    if (failed.length) console.warn('[sw] precache missed', failed);
  })());
  // Deliberately NO skipWaiting here. A tab mid-edit keeps the worker it
  // started with until the page asks for the swap; see js/register-sw.js.
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // rule 2

  if (isCode(req)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });   // rule 1
        if (fresh && fresh.ok) {
          const cache = await caches.open(VERSION);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const hit = await caches.match(req);
        if (hit) return hit;
        // Only navigations fall back to the shell, so a missing asset stays a
        // missing asset instead of being answered with a page of HTML.
        if (req.mode === 'navigate') {
          const shell = await caches.match('/index.html') || await caches.match('/');
          if (shell) return shell;
        }
        throw new Error('offline and not cached');
      }
    })());
    return;
  }

  // Everything else same-origin: cache-first, and write back what we fetch so
  // the cache heals itself (rule 3).
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      const cache = await caches.open(VERSION);
      // put() throws on 206, Vary:*, and a disturbed body, so never bare.
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  })());
});
