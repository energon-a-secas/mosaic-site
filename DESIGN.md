# Mosaic interface

Register: product. Someone at a kitchen table is arranging a few favorite photos
on a phone, with daylight in the room and a few minutes to finish. Light controls
and a neutral gray preview surround keep the interface clear without tinting
photographs. Photography supplies the visual interest.

## Layout and workflow

- Desktop: a small project toolbar above settings, a large preview, and photos.
- Up to 1024px: the preview stays above a scrolling control panel. A bottom bar
  switches between Layout, Style, Photos, Text, and Export. Panel contents stay
  inline; opening a tool never covers the preview with a drawer.
- Toolbar and bottom navigation heights are measured, including safe areas.
  A short landscape screen uses preview and controls side by side.
- The shared Neorgon header and footer retain their own styling and scripts.

## Defaults

- Grid, two columns, 16:9, small light margins and a narrow gap. A single photo
  fills the available row; importing more photos adds rows.
- Presets show actual layout geometry: side by side, square grid, stacked,
  portrait, story, and a 19:6 banner. Ratios and column counts remain editable.
- Saved collages retain their chosen layout and framing across reloads.
- PNG at 1600px wide is the initial export. Show exact width and height before
  downloading; offer 800px, 3000px, and JPEG without another dialog.
- New captions use a normal sans serif. Meme templates retain Impact styling.
- The photo editor opens on Crop; background erasing is an explicit tool choice.

## Visual language

System sans serif, fixed rem sizing, sentence case, compact descriptive headings.
Most body controls use 13px text, panel headings 18px (16px on mobile). Mobile
text fields and selects use 16px to avoid automatic iOS zoom.

The local tokens in css/style.css define light surfaces and a restrained rose
accent in OKLCH. The canvas surround has zero chroma. Accent marks primary
actions and selected tools; text and neutral outlines establish the rest of the
hierarchy. Controls share 8px corners and visible focus outlines. Motion is
limited to brief state transitions and respects reduced-motion preferences.

## Interaction

- Add photos and Export are always visible. Advanced shapes, borders, and photo
  adjustments use disclosure controls rather than a wall of settings.
- Photo selection uses real buttons with labels and pressed states. Touch and
  keyboard users have Move earlier / Move later controls; desktop dragging also
  reorders the visible arrangement.
- Tap selects, drag reframes, pinch or wheel zooms. A tap adds no undo entry;
  a gesture is one undoable action, saved at its end.
- Most controls have at least 44px touch targets. Icon buttons have names.
  Hidden mobile panels are inert; the full-screen editor makes the workspace
  behind it inert and returns focus when closed.
- Import reports progress and unsupported images. Export reports busy/failure
  states. Removing photos is reversible within the open session.

## Validation

`node tests/frame.test.mjs` covers framing geometry.
`node tests/workspace.test.mjs` covers defaults, layout extremes, preservation,
and undo. `python3 tests/browser-smoke.py` exercises Chromium and WebKit across
phone, landscape, tablet, and desktop sizes, including imports, downloads,
reordering, gestures, persistence, and an offline reload.
