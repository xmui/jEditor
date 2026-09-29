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
- **Delete.** Photos are moved to a `.jeditor-trash` folder inside the opened folder, not deleted. `Ctrl+Z` restores them. Emptying that folder is up to you.
- **Export.** Copies go to a `jEditor Export` folder, optionally resized.

Some programs, mostly older print and lab software, ignore the EXIF orientation tag and will show a rotated JPEG the old way round. Cropping writes the rotation into the pixels, so a photo that has been cropped is always upright.

## Crop and straighten

- Straighten in 0.1° steps with the slider or `,` / `.`. With the level tool (`L`), you draw a line along a horizon or the edge of a print and the angle is set from it.
- The crop box can't extend past the edge of the straightened photo, so there are no empty corners.
- Aspect presets: 4×6, 5×7, 8×10, 11×14, square, 3:4, 16:9, original and free. `X` swaps portrait and landscape.
- **Previous** (`P`) applies the last crop again. This is useful when a batch of scans has the same borders.
- The header shows the output size in pixels, and in inches when the file has a DPI.

## Finding duplicates (work in progress)

Press `D` in a folder. It looks for:

- exact copies (identical file contents), and
- the same print scanned more than once, including when it was turned, placed at a different angle, cropped slightly differently, exposed differently, or scanned in black and white.

Scanner bed and film borders are ignored when comparing. Matches are shown in groups, side by side, with a match percentage. The copy with the most pixels is suggested as the one to keep. `K` marks the others and `Enter` moves them to the trash.

It can still miss some re-scans or group photos that look alike, so check each group before trashing. The **Sensitivity** setting trades one for the other.

## Keyboard shortcuts

Press `?` in the app to see all of them. Any shortcut can be changed there. The defaults:

| Key | Action |
|---|---|
| `←` `→` | Previous / next photo (`↑` `↓` move by rows in the grid) |
| `[` `]` or `,` `.` or `Shift+←` `Shift+→` | Rotate left / right |
| `Space`, `G`, `S` | Toggle view, grid view, single view |
| `C` | Crop and straighten |
| `+` `-` `0` | Zoom in, zoom out, fit |
| `I` | File info |
| `F` | Fullscreen |
| `F2` | Rename (batch rename in grid view) |
| `Delete` | Move to trash |
| `Ctrl+Z` | Undo |
| `Ctrl+A` | Select all (grid view) |
| `D` | Find duplicates |
| `R` | Rescan the folder |
| `?` | Show shortcuts |

In crop and straighten: `Enter` save, `Shift+Enter` save and next, `Esc` cancel, `[` `]` rotate 90°, `,` `.` straighten ±0.1°, `<` `>` ±1°, `0` reset the angle, `L` level tool, `A` next aspect ratio, `X` swap orientation, `P` previous crop, `R` reset.

In find duplicates: `1`–`9` mark or unmark a photo, `K` keep the suggested photo and mark the rest, `Enter` trash marked and go to the next group, `N` not duplicates, `←` `→` previous / next group, `Esc` close.

## Development

```bash
npm install
npm start           # serves app/ at http://localhost:3000
npm test            # test suite in headless Chromium (set CHROME_PATH if Chrome isn't found)
npm run build       # rebuilds standalone.html
npm run bump 1.x.y  # sets the version in app/version.js, package.json and package-lock.json
```

The app is plain JavaScript with no dependencies, in `app/`:

- `script.js`: viewer, grid, rotation, file operations, shortcuts
- `crop.js`: crop and straighten
- `meta.js`: reading and copying JPEG/PNG metadata
- `dupes.js`: duplicate finder

To release, bump the version, commit, and merge to `main`. The Release workflow then tags the version, builds `standalone.html` and publishes a GitHub Release, and the Pages workflow deploys the web app. The tests fail if `app/version.js` and `package.json` disagree.

If you change `app/icon.png`, run `node scripts/make-icons.js` to regenerate the app icons. On Windows without Node, `start.bat` serves the app locally.
