# jEditor — Improvement Plan

## What was broken (fixed in this branch)

### 1. `init()` crashed halfway through — this is why sort "didn't work"
`script.js` wired up listeners for crop-panel elements (`btn-reset-crop`,
`crop-rotation-slider`, flip buttons, …) that were removed from `index.html`
when the app switched to Cropper.js. `getElementById` returned `null`,
`null.addEventListener` threw, and **every listener after that line never got
bound** — including the sort dropdown and the grid-size slider. Sort was dead
on arrival. Fixed by removing the dead bindings and the ~200 lines of
superseded hand-rolled crop geometry.

### 2. Crop never loaded
`index.html` lives inside `app/` but referenced `app/cropper.min.js` /
`app/cropper.min.css` — i.e. `app/app/…`, a 404. `Cropper` was undefined, so
crop mode silently did nothing. There was also a duplicate `id="btn-crop"`, so
the floating crop button was inert. Both fixed; the service worker now caches
the cropper assets too.

### 3. Rotating in the grid could rotate a photo you click afterwards
`rotateBulk` iterated `for (const index of this.selection)` with `await`
inside. JavaScript `Set` iterators **see elements added during iteration** —
clicking another photo mid-rotate cleared the selection and added the new
index, which the still-running loop then picked up and rotated. Fixed by
snapshotting the selected *file objects* before the loop (also survives a
re-sort happening mid-rotation).

### 4. Sort scrambled selection and "current photo"
Selection and `currentIndex` are stored as array indices, but sorting reorders
the array — after a sort they pointed at *different files*, which is another
way rotate could hit the wrong photo. `sortFiles` now remaps both to follow
the actual file objects.

### 5. Assorted crashes and races
- Pressing `R` (refresh) threw: `elements.loadingText` was never registered.
- Date/size sort couldn't work for individually dropped files (metadata was
  never captured) and legacy folder drops registered files *after* the initial
  sort ran. Both paths now await metadata before sorting.
- Rapid arrow-key navigation could display the wrong photo (out-of-order async
  loads); `loadIndex` now uses a load token.
- Failed rotations left the on-screen preview rotated while the file on disk
  wasn't; the preview now rolls back.
- Blob-URL and event-listener leaks in `loadIndex`/`saveCrop`; a plain grid
  click no longer decodes the full-resolution image into the hidden single
  view (perf).

## Roadmap to "actually good"

### Phase A — correctness foundation ✅ DONE
1. ✅ **Index-based state eliminated.** `currentFile` + `selection: Set<file>`;
   grid/strip DOM nodes carry direct file references. No index can ever go
   stale again.
2. ✅ **Lossless JPEG rotation.** 90° rotations patch the EXIF orientation
   flag (or insert a minimal EXIF segment) — no decode, no re-encode, no
   quality loss, near-instant bulk rotation. Non-JPEGs fall back to canvas
   (PNG stays pixel-lossless); GIF edits are refused rather than silently
   flattening animations.
3. ✅ **File type preserved on save** via an explicit extension→MIME map for
   both rotation fallback and crop.
4. ✅ **Test harness in-repo**: `npm test` boots the real app in headless
   Chromium — 34 checks covering boot, sort/selection identity, EXIF
   orientation math, the bulk-rotate race regression, PNG/GIF handling,
   adaptive glass, and `file://`/standalone operation. CI runs it on every
   push.

### Also shipped: fast grid scrolling (v1.4.0)
- **Root cause of the mid-grid lag fixed**: the cleanup logic revoked any
  thumbnail >150 positions from the *current photo* (which stays at #1 while
  you scroll), so scrolling to the middle destroyed and re-decoded
  thumbnails in a loop. Thumbnails (~10–30 KB each) are now kept for the
  whole session; only full-size images get trimmed.
- **Thumbnails generate in a Web Worker** (decode + downscale + encode all
  off the main thread) through a priority queue — scrolling never competes
  with image processing. Visible tiles jump the queue.
- **Whole-folder precache**: right after a folder loads, every thumbnail is
  generated in the background (with a progress pill for big folders), so
  scrolling anywhere only assigns already-cached object URLs.
- Tiles are no longer blanked when they leave the viewport; cached thumbs
  paint synchronously on re-render; `content-visibility: auto` skips
  offscreen tile rendering; transparency-safe PNG thumbs; the old
  "<200 KB files are their own thumbnail" path (which decoded full-res
  images in tiles) now only applies below 50 KB.

### Also shipped: instant previews (v1.3.0)
- **Rotation preview is decoupled from the disk write.** Clicking rotate
  CSS-rotates every preview of that photo instantly; requests stack
  (right+right = 180° shown immediately, right+left cancels). A per-file
  queue drains to disk in the background. Because EXIF rotation changes no
  pixels, cached preview bitmaps stay valid — a lag counter per preview
  compensates with CSS, so nothing is ever re-read or re-decoded after a
  rotation. Single view scale-fits at odd quarter turns.
- **Stacked toasts**: every rotation batch gets its own progress pill;
  overlapping operations stack under each other instead of overwriting.
- **Versioning discipline**: `app/version.js` is the single source of truth
  (start screen, service-worker cache name, package.json via
  `npm run bump x.y.z`); the test suite fails on version drift.

### Also shipped alongside Phase A
- **Download-and-run**: `npm run build` produces a self-contained
  `standalone.html` that works double-clicked from disk (File System Access
  API is available on `file://` in Chrome/Edge, so saving works too). Tagged
  releases attach it automatically via GitHub Actions.
- **Adaptive liquid glass**: the brightness sampler now measures the top and
  bottom bands of the photo separately; header and control surfaces flip
  between dark/light glass independently, with hysteresis to prevent
  flicker, stronger blur/saturation, and readable text everywhere (the crop
  toolbar and loading pill included).

### Shipped in v1.9.0 — scan-order workflow
- **Crop & Straighten rebuilt** (Cropper.js removed): reads the photo from
  disk after any pending rotation lands (fixes rotate-then-crop silently
  reverting the rotation), level tool, crop constrained to the rotated
  image, print-size presets, Previous crop, Save & Next.
- **Metadata kept on re-encode**: EXIF, ICC, DPI, XMP, IPTC (`meta.js`).
- **Lossless rotation for scanner JPEGs** (EXIF without an Orientation tag).
- **Instant viewer**: pre-decoded neighbours, screen-sized cached previews,
  full resolution on zoom.
- **Keyboard shortcut registry** with a rebinding panel (`?`).
- **Duplicate finder (WIP)**: exact + rotation-invariant perceptual matches,
  side-by-side culling.
- Fixes: blank screen after opening a folder, Ctrl+key shortcuts
  triggering plain-key actions, grid Up/Down after resizing, quadratic scan.

### Shipped in v1.9.1 — duplicate finder accuracy
Field report: ~16 of 600 photos grouped with photos that looked nothing
alike. Reproduced on 340 real photos turned into simulated scan orders:
the 64-bit hash measured the scanner bed, not the photo, so unrelated
scans matched, and transitive grouping chained them together (142 of 393
wrongly grouped). Now: crop to the print, straighten it, compare
brightness-normalised layout *and* detail maps across rotations and crop
insets, complete-linkage grouping. Same benchmark: 0 wrongly grouped;
89 of 95 true duplicates found, including re-scans tilted 3–4° further,
re-cropped, re-exposed or black & white.

### Next up
- Duplicate finder: tune thresholds on real scan orders; compare zoom;
  remember "not duplicates" across sessions.
- Replace native `prompt()`/`alert()` dialogs (rename, batch rename,
  export) with in-app modals.
- Auto-detect the print on a flatbed scan (find edges → angle + crop).
- Virtualized grid for 10k+ photo folders.

### Phase B — performance
1. **Thumbnail decode in a worker** (`OffscreenCanvas` + `createImageBitmap`
   already used — move the canvas/toBlob step off the main thread) so grid
   scrolling never janks.
2. **Virtualized grid** for 1000+ photos: render only visible rows instead of
   one DOM node per file.
3. **Persist thumbnails** in the Cache API or IndexedDB keyed by
   name+size+mtime so reopening a folder is instant.
4. **Downscale the crop preview**: hand Cropper.js a screen-sized bitmap and
   apply the crop rectangle to the full-res original only on save.

### Phase C — structure & tooling
1. Split `script.js` (still ~1500 lines) into modules: `state.js`, `fs.js`,
   `grid.js`, `viewer.js`, `crop.js`; adopt Vite for dev server + build.
2. Replace the PowerShell build scripts (`build_standalone.ps1`, etc.) with a
   cross-platform npm script that inlines assets into `standalone.html`.
3. `standalone.html` is a build artifact — generate it in CI instead of
   committing it.
4. README says `npm start` / `npm run build` but there is no `package.json`;
   add one.

### Phase D — UX polish
1. Undo (keep the pre-edit blob in memory until the next edit or navigation).
2. Proper range-select in grid (shift-click from last clicked, not from
   `currentIndex`).
3. Visible "unsaved / saving / saved" indicator per photo instead of a global
   spinner.
4. Sort order persistence (localStorage) and a "Date taken" (EXIF) sort mode.
