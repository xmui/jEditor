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

### Phase A — correctness foundation (recommended next)
1. **Kill index-based state entirely.** Make the file object the unit of
   identity: `selection: Set<file>`, `currentFile` instead of `currentIndex`.
   Every remaining "wrong photo" class of bug disappears. (~half-day refactor.)
2. **Lossless JPEG rotation.** Today every 90° rotate decodes → canvas →
   re-encodes JPEG at 0.95, degrading quality on each click and stripping EXIF.
   Rotate by rewriting the EXIF orientation tag when possible, or re-encode
   only once on save. This also makes bulk rotation near-instant (no pixel
   work at all).
3. **Preserve file type on save.** PNG/WebP currently survive by accident of
   `fileData.type`; add an explicit type map and keep PNG lossless.
4. **A test harness.** The smoke test used on this branch (headless Chromium +
   static server) should live in the repo (`npm test`) so regressions like the
   init crash can't ship again.

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
