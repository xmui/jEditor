# jEditor

A photo viewer for rotating, cropping and straightening folders of photos, built for working through scan orders. It runs in the browser and edits the files on your disk directly. Nothing is uploaded.

It needs Chrome or Edge to save changes, because it uses the File System Access API. Firefox and Safari can view photos but not save.

## Getting it

- **Web app:** open https://xmui.github.io/jEditor/ in Chrome or Edge. Use the install button in the address bar if you want it in its own window. It works offline once installed.
- **Single file:** download `standalone.html` from [Releases](../../releases) and open it. No server or install needed, and saving works from the local file.

The version number is shown on the start screen.

## Using it

1. Click **Open Folder**, or drag a folder onto the window. Subfolders are included.
2. Move through photos with `←` / `→`. `Space` switches between single view and grid.
3. Rotate with `[` / `]`. In grid view this rotates every selected photo.
4. Press `C` to crop and straighten. `Enter` saves, `Shift+Enter` saves and opens the next photo, `Esc` cancels.
5. `Ctrl+Z` undoes the last rotation, crop, rename or delete.

Changes are saved to the original files as you go.

## What it does to your files

- **Rotation.** JPEGs are rotated by changing the EXIF orientation tag, so the image data isn't recompressed. This works on scanner files that have no orientation tag yet. PNG and WebP are re-encoded; PNG stays lossless. GIFs aren't rotated, because that would lose the animation.
- **Crop and straighten.** The photo is re-encoded in its original format (JPEG at quality 95). EXIF data (capture date, camera), the ICC colour profile, DPI, XMP and IPTC are carried over. The orientation tag is reset, since the pixels are now upright.
- **Rename.** Files are renamed in place. If the new names overlap the old ones (shifting a numbered sequence, say), they go through temporary names first. If a rename fails part-way, every file gets its original name back.
- **Delete.** Photos are moved to `.jeditor/trash` inside the opened folder, not deleted. `Ctrl+Z` restores them.
- **Export.** Copies go to a `jEditor Export` folder, optionally resized.

## The .jeditor folder

jEditor keeps its own data in a `.jeditor` folder inside the folder you open:

- `trash/` holds deleted photos.
- `cache/` holds thumbnails and duplicate-finder data.

Because the cache travels with the folder, a second computer opening the same order (on a shared drive, say) gets its thumbnails and duplicate data straight away. In a 2000-photo test, thumbnails were ready in about 10 seconds instead of 27, and a duplicate scan took 5 seconds instead of 20. The large screen-sized previews aren't stored there, to keep the folder small.

When an order is finished, use **Clean Up Folder…** (right-click the grid background, or in Customize controls). It empties the trash and removes the cache; your photos aren't touched. Do this before copying an order to a customer: on Windows a folder starting with a dot is not hidden, so `.jeditor` would otherwise go along with the photos, deleted ones included. To stop jEditor writing a cache at all, untick **Save cache in the folder** in Customize controls. The trash is still used either way.

Folders opened with earlier versions may have a `.jeditor-trash` folder; Clean Up Folder removes that too.

Some programs, mostly older print and lab software, ignore the EXIF orientation tag and will show a rotated JPEG the old way round. Cropping writes the rotation into the pixels, so a photo that has been cropped is always upright.

## Crop and straighten

It works like Lightroom or Apple Photos: the crop frame stays in the middle of the screen and the photo moves behind it.

- Drag a corner or edge to resize. When you let go, the view zooms so the crop fills the screen again. Drag a handle past the edge of the screen to zoom out and make the crop bigger. Hold `Shift` to keep the shape, or `Alt` to resize from the centre.
- Drag inside the frame to move the photo. Drag outside it to rotate.
- Straighten with the slider, or `,` / `.` in 0.1° steps. The photo turns around the middle of the crop and zooms in just enough to hide the corners, so there are never empty corners.
- To level something, hold `Ctrl` (`⌘` on a Mac) and draw a line along a horizon or the edge of a print. The level tool (`L`) does the same without the key.
- **Auto** (`Shift+A`) finds the print on a scan, straightens it and crops to its edges. It needs a plain scanner lid or background around the photo, and it leaves a few pixels' margin so none of the bed shows. Turn on **Every photo** to run Auto on each photo as it opens. With `Shift+Enter` (save and next), a scan order then becomes: check the crop, press `Shift+Enter`, repeat.
- `Ctrl+Z` inside the editor undoes the last adjustment; `Ctrl+Shift+Z` redoes it.
- Aspect presets: 4×6, 5×7, 8×10, 11×14, square, 3:4, 16:9, original and free. `X` swaps portrait and landscape. A preset fits inside the current crop, so choosing one after Auto never takes in the bed.
- **Previous** (`P`) applies the last crop again. This is useful when a batch of scans has the same borders.
- The header shows the output size in pixels, and in inches when the file has a DPI.

## Renaming

Press `F2`, use **Rename…** on the selection bar, or right-click the grid background for **Rename All…**. It works on the selected photos or the whole folder.

- **New names** builds names from a pattern, such as `Smith_{###}` → `Smith_001.jpg`, `Smith_002.jpg`, …
- **Find & replace** changes part of the existing names, such as replacing `IMG_` with `Smith_`.

Patterns can use `{###}` for a sequence number (one digit per `#`), `{name}` for the current name, and `{date}` / `{time}` for when the photo was taken. Numbers follow the order you choose: the current sort, date taken, name, date modified or file size, ascending or descending, from any start number and step.

The preview shows every old and new name before anything changes. Duplicate names, names already used by other files, and characters Windows doesn't allow are flagged, and the rename won't run until they're fixed. The file extension is always kept, and `Ctrl+Z` undoes the whole rename in one step.

## Finding duplicates (work in progress)

Press `D` in a folder. It looks for:

- exact copies (identical file contents), and
- the same print scanned more than once, including when it was turned, placed at a different angle, cropped slightly differently, exposed differently, or scanned in black and white.

Scanner bed and film borders are ignored when comparing. Matches are shown in groups, side by side, with a match percentage. The copy with the most pixels is suggested as the one to keep. `K` marks the others and `Enter` moves them to the trash.

It can still miss some re-scans or group photos that look alike, so check each group before trashing. The **Sensitivity** setting trades one for the other.

## If it gets slow

Press `Ctrl+Shift+D` to open the debug console. The yellow lines at the top show what the app is holding and doing: memory, undo history, images decoded, background work, and how long recent photos took to load. A screenshot of it taken while things are slow is the most useful thing to include in a bug report.

It's built and tested for orders of 500–2000 photos. With 2000 scans at 1800×1200: the folder opens and shows the first photo in under half a second, thumbnails take about 20 seconds in the background, rotating all 2000 takes about 8 seconds, renaming them about 2 seconds, and a duplicate scan about 20 seconds. Bigger files take proportionally longer to thumbnail.

Undo keeps up to 50 steps. Rotations are undone by rotating back, so they don't use memory. Crops keep a copy of the original file so they can be undone, up to 256 MB in total; older crop steps are dropped after that.

## Keyboard shortcuts

Press `?` in the app to see all of them. Any shortcut can be changed there. The defaults:

| Key | Action |
|---|---|
| `←` `→` | Previous / next photo (`↑` `↓` move by rows in the grid) |
| `[` `]` or `,` `.` or `Shift+←` `Shift+→` | Rotate left / right |
| `Space`, `G`, `S` | Toggle view, grid view, single view |
| `C` | Crop and straighten |
| `+` `-` `0` | Zoom in, zoom out, fit (or double-click the photo: in to 100% on that spot, again to fit) |
| `I` | File info |
| `F` | Fullscreen |
| `F2` | Rename (the selected photos in grid view) |
| `Delete` | Move to trash |
| `Ctrl+Z` | Undo |
| `Ctrl+A` | Select all (grid view) |
| `D` | Find duplicates |
| `R` | Rescan the folder |
| `?` | Show shortcuts |

In crop and straighten: `Enter` save, `Shift+Enter` save and next, `Esc` cancel, `Shift+A` auto, `[` `]` rotate 90°, `,` `.` straighten ±0.1°, `<` `>` ±1°, `0` reset the angle, `L` level tool, `A` next aspect ratio, `X` swap orientation, `P` previous crop, `R` reset, `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo.

In find duplicates: `1`–`9` mark or unmark a photo, `K` keep the suggested photo and mark the rest, `Enter` trash marked and go to the next group, `N` not duplicates, `←` `→` previous / next group, `Esc` close.

## Development

```bash
npm install
npm start           # serves app/ at http://localhost:3000
npm test            # test suite in headless Chromium (set CHROME_PATH if Chrome isn't found)
npm run build       # rebuilds standalone.html
npm run build:site  # builds the web app into _site/ (what GitHub Pages serves)
npm run bump 1.x.y  # sets the version in app/version.js, package.json and package-lock.json
```

The app is plain JavaScript with no dependencies, in `app/`:

- `script.js`: viewer, grid, rotation, file operations, shortcuts
- `crop.js`: crop and straighten
- `crop-auto.js`: finding the print on a scan (Auto)
- `meta.js`: reading and copying JPEG/PNG metadata
- `dupes.js`: duplicate finder

To release, bump the version, commit, and merge to `main`. The Release workflow then tags the version, builds `standalone.html` and publishes a GitHub Release, and the Pages workflow builds and deploys the web app. Both builds inline every script and stylesheet into one page, so a browser never ends up mixing files from two versions. The tests fail if `app/version.js` and `package.json` disagree.

If you change `app/icon.png`, run `node scripts/make-icons.js` to regenerate the app icons. On Windows without Node, `start.bat` serves the app locally.
