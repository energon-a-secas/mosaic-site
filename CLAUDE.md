# CLAUDE.md: Mosaic

Photo collage maker plus a local photo editor: layouts that never own photos, a
full-screen focus editor with manual background removal (brushes + wand, all
canvas pixels, no services), and one-click demos drawn in the browser.

**Live:** mosaic.neorgon.com · **Port:** 8867

## Run

```bash
make serve
```

Then open http://localhost:8867. It must be served over HTTP. The app is ES modules, and `file://` blocks them.

```bash
node tests/frame.test.mjs
```

The only automated coverage the rendering has. `js/frame.js` is deliberately
DOM-free so the framing geometry can be tested without a browser, which matters
because being subtly wrong there looks like a design choice rather than a bug:
a cell that leaks background at 2 degrees, or a crop that quietly draws at half
size, both render without throwing anything.

## Architecture

| Module | Lines | Owns |
|---|---:|---|
| `js/events.js` | 492 | `wire` |
| `js/editor.js` | 489 | focus editor session, ops, `openEditor`, `isEditorOpen`, `wireEditor` |
| `js/demo-art.js` | 421 | `SAMPLES`: 8 procedural demo scenes, deterministic |
| `js/layouts.js` | 250 | `computeCells`, `USES_COLS`, `USES_SPAN`, `aspect` |
| `js/render.js` | 207 | `refs`, `cacheRefs`, `currentCells`, `currentPlacement`, `drawStage` |
| `js/compose.js` | 198 | `compose`, `exportThumb`, `exportBlob` |
| `js/overlays.js` | 172 | `FONTS`, `makeText`, `PRESETS`, `drawOverlay`, `overlayAt` |
| `js/gestures.js` | 154 | `wireStage` |
| `js/editor-tools.js` | 147 | brush stamps, `wandErase`, alpha helpers, `bakeCut` |
| `js/filters.js` | 141 | `PRESET_NAMES`, `fxKey`, `isIdentity`, `applyFx` |
| `js/editor-input.js` | 148 | `wireInput`: editor pointer, wheel and keyboard |
| `js/editor-crop.js` | 135 | the crop overlay: `syncCrop`, `cropDown/Move/Up`, `nudgeCrop`, `isCropped` |
| `js/frame.js` | 57 | `cropRect`, `coverZoom`, `panLimit`: pure geometry, no DOM, tested in node |
| `js/tools.js` | 136 | `removeBackground`, `makeThumb`, `tintThumb`, `batchThumbnails`, `fitAspect` |
| `js/state.js` | 124 | `LAYOUTS`, `state`, `freshTf`, `addPhoto`, `removePhoto` |
| `js/demos.js` | 109 | `wireDemos`: recipes over the demo art |
| `js/store.js` | 138 | `saveSession`, `loadSession`, `resetSaveCache`, `clearSession`, `CONFLICT` |
| `js/history.js` | 88 | `mark`, `undo`, `redo`, `canUndo`, `canRedo` |
| `js/register-sw.js` | 62 | `registerServiceWorker`: registration and the update handshake |
| `js/autosave.js` | 31 | `scheduleSave`, `sessionLost`, `resumeSaving`: the debounce and the two-tab rule |
| `js/presets.js` | 44 | `STYLES`, `applyStyle`, `toggleMono` |
| `js/utils.js` | 40 | `$`, `showToast`, `echoRanges` |
| `js/app.js` | 6 | none |

Offline (root, not in `js/`): `sw.js` is the worker, `sw-kill.js` is the rollback.
The precache array between the `PRECACHE-BEGIN/END` markers in `sw.js` is checked
by `scripts/check-precache.py` and by smoke check 27; nothing rewrites it for you.

Vendored from `packages/neorgon-ui/`: never edit in place, run the sync script instead: `js/neorgon-footer.js`, `js/neorgon-header.js`.

## Data

IndexedDB (db `mosaic`): store `photos` holds `{id, i, name, blob, span, tf,
cutBlob}` rows (the original file blob plus, when a cutout exists, the baked
PNG of it), `tf` now carries the crop as four flat fractions (`cx, cy, cw, ch`), which ride
the existing shallow spreads. Store `meta` holds the arrangement under key `session` (layout,
params, background, bg2, bgAngle, borderColor, overrides, overlays, schema 3).
Old schema-2 sessions load fine: every new field defaults. Undo history is
memory-only and resets on reload.

## Conventions

- Zero build step. Plain ES modules loaded by `js/app.js`.
- Header and footer come from the shared kits. Do not add site-local `.neo-footer` or `.header-bar` CSS.
- No single JS file over ~500 lines. It currently holds.

## Gotchas

- **Responsive blocks live at the END of `css/style.css`, and must stay there.**
  They override the base `.board`/`.rail`/`.side` rules at equal specificity,
  so source order is the entire mechanism. They used to sit at the top of the
  file, where the base rules silently beat them and phones rendered the canvas
  in a 260px grid column.
- **Every `compose()` caller must pass the full background opts** (`background`,
  `bg2`, `bgAngle`, `borderColor`). The preview once omitted `bg2` and painted
  gradients as solid while the export would have rendered them: the exact
  preview/export drift contract 3 exists to prevent. Callers: `drawStage`,
  `exportBlob` (via events), `exportThumb`.
- **Adding a field to `state` means touching four serializers**: the
  `js/history.js` snapshot AND restore, `row()` in `js/store.js` (the per-photo writer, NOT the meta writer beneath it), and the
  `restoreSession` reader in `js/events.js`. Missing one is silent: the field
  works until the first undo or reload.
- **The editor works on a capped copy** (`MAX_DIM = 4200` in `js/editor.js`):
  three full-resolution RGBA buffers of a 48MP photo is over half a gigabyte.
  A cutout made in the editor is at the capped resolution; `compose` scales it
  into cells so nothing downstream notices.
- **Crop is geometry, colour is pixels, and they must not be confused.** The crop
  lives in `tf` as four flat fractions of the source and is applied by `compose`
  at draw time through the 9-argument `drawImage`. It is deliberately in NEITHER
  `fxKey` NOR `isIdentity`: `applyFx` bakes colour into a bitmap of the same
  dimensions, so putting crop in the cache key would re-run a full 12MP
  `ImageData` pass on every drag frame, and putting it in the skip predicate
  would force a pointless bake. Fractions and not pixels because the composed
  bitmap is one of three with different sizes (`bitmap` native, `cut` capped at
  `MAX_DIM`, `fx` inheriting whichever).
- **Flat crop fields, never a nested `tf.crop`.** Every serializer copies `tf`
  with a shallow spread and hand-copies only `adj`, which exists precisely
  because a shallow spread shares a nested object. A nested crop would be shared
  by reference into each undo snapshot, so dragging a handle would rewrite
  history in place.
- **`fxKey` cannot see framing, so the editor's dirty check has its own
  predicate.** `framingChanged` in `js/editor.js` is what makes Escape warn
  before discarding a crop-only edit; without it `js/editor-input.js` reads such
  an edit as clean and one press throws it away.
- **Rotation used to leak collage background, and `coverZoom` is what stops it.**
  Cover-fit alone never hides a rotation's empty corners: at zoom 1 the drawn
  rect is tight in one axis by construction and any rotation needs more in that
  same axis. Measured on a 400x400 cell before the fix: 509, 1161, 3006 and 6604
  transparent pixels at 1, 2, 5 and 12 degrees. `coverZoom` returns exactly 1 at
  `rot` 0, so no existing photo re-frames.
- **The film strip is a FOURTH render path.** `drawStrip` draws `p.thumb`
  directly and never goes through `compose`, so contract 3 does not cover it.
  The crop is baked into the thumb by `makeThumb(img, max, tf)` instead; every
  caller that regenerates a thumb must pass `photo.tf` or the strip and the
  collage will disagree about the same photo.
- **`ctx.filter` stays banned** (Safari ships it disabled): colour is matrix
  math over ImageData in `js/filters.js`, and the editor previews colour by
  re-baking through that same pipeline, never by CSS/canvas filters.
- **A save can be refused, and the caller must handle it.** `saveSession` returns
  `CONFLICT` when another tab has written since this one last synced. It is one
  transaction over both stores that reads the generation and aborts on a
  mismatch, because the pools cannot be merged and the old clear-then-put
  destroyed whichever tab saved second. `js/autosave.js` stops autosaving and
  says so; do not "fix" this by retrying.
- **The service worker never caches cross-origin.** `cdn.neorgon.org` sends no
  CORS headers, so the only way to store `base.css` is an opaque response,
  which is unverifiable and padded by megabytes against the same quota that
  holds the user's photos. Offline the page loses 16 spacing and type tokens
  and looks worse; it stays usable. `projects/neorgon-cdn-site/scripts/setup-r2-cors.sh`
  fixes it at the source, and once that has run those assets can be precached.
- **To roll back offline support, deploy `sw-kill.js` as `sw.js`.** Deleting
  `sw.js` does not reliably unregister an installed worker, so a service worker
  is the one deploy artifact `git revert` cannot retract.
- **Code is network-first, on purpose.** The ES-module graph is all-or-nothing:
  one stale module with a renamed export white-screens the app. The
  `cache: 'no-cache'` in `sw.js` is load-bearing, since without it the browser's
  own HTTP cache answers the worker's fetch and network-first silently becomes
  cache-first.
- **The editor owns the keyboard while open.** Main-app shortcut handlers in
  `js/events.js` early-return on `isEditorOpen()`; add new global shortcuts
  behind that guard or they fire during brush work.

## Do not touch

- `js/neorgon-*.js` and `css/neorgon-*.css`: vendored kits, regenerated by `packages/neorgon-ui/sync-*.sh`.
