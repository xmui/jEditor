# jEditor

jEditor is a minimalist, high-performance local photo viewer and editor optimized for bulk rotation, cropping and straightening — built for working through scan orders fast. Everything runs in your browser; files are read and written directly on your disk — nothing is uploaded anywhere. The current version is shown on the start screen and in [Releases](../../releases).

## ✨ Features
- **Instant lossless rotation**: JPEGs rotate by patching the EXIF orientation flag — no re-encoding, no quality loss, including scanner files whose EXIF has no orientation tag yet. Previews rotate the moment you click, rotations stack (two clicks = 180°), and saves happen silently in the background.
- **Crop & Straighten**: fine straightening (0.1° steps) with a **Level** tool — draw along a horizon or print edge and it snaps level. The crop always stays inside the straightened photo, so there are never empty corners. Print-size presets (4×6, 5×7, 8×10, 11×14, square…), **Previous** reuses the last crop for a batch with the same borders, and **Save & Next** moves straight on to the next photo.
- **Keeps what matters**: crops keep EXIF (capture date, camera), the ICC colour profile, DPI, XMP and IPTC. Files are saved in their original format; PNG stays lossless.
- **Instant viewer**: photos either side of the current one are pre-decoded, big scans are shown from a cached screen-sized preview, and the full-resolution original loads when you zoom in. Edits always use the original file.
- **Find duplicates** *(work in progress)*: spots exact copies and re-scans of the same print — even when rotated or exposed differently — and lets you review them side by side and trash the extras (Ctrl+Z restores).
- **Customizable keyboard shortcuts**: press `?` to see every shortcut and rebind any of them.
- **Adaptive liquid-glass UI**: the header and control surfaces sample the photo behind them and flip between dark and light glass to stay readable.
- **Memory optimized**: worker-generated thumbnails and previews, cached across sessions, handle 1000+ photo folders.

## 🚀 Just want to use it?

**Option A — Install as an app (PWA).** Open the hosted app (GitHub Pages: `https://<owner>.github.io/jEditor/`) in Chrome or Edge and click the **Install** icon in the address bar. You get a standalone desktop app with its own window and icon that also works offline. *(One-time repo setup: Settings → Pages → Source: "GitHub Actions".)*

**Option B — Single file.** Download **`standalone.html`** from the [Releases page](../../releases) and double-click it. No server, no install — all features including saving work straight from the local file.

Then:
1. **Open**: Click *Open Folder* (or drag and drop a folder/images in).
2. **Review**: Arrow keys or `Space` to flip between single and grid view.
3. **Rotate**: `[` / `]` (or the buttons). In grid view this rotates every selected photo.
4. **Crop & straighten**: `C`; `L` for the level tool, `,` / `.` to nudge the angle; `Enter` saves, `Shift+Enter` saves and opens the next photo, `Esc` cancels.
5. Changes are written straight back to your files; `Ctrl+Z` undoes.

> Chrome or Edge required for saving (File System Access API). Firefox/Safari can view but not save.

## ⌨️ Shortcuts
Press `?` in the app for the full list — every shortcut can be rebound there. The defaults:

| Key | Action |
|---|---|
| `←` / `→` | Previous / next photo (`↑` / `↓` move by rows in the grid) |
| `[` / `]`, `,` / `.`, `Shift` + `←` / `→` | Rotate left / right (whole selection in grid view) |
| `Space` · `G` · `S` | Toggle grid / single view · grid · single |
| `C` | Crop & straighten |
| `+` / `-` / `0` | Zoom in / out / fit |
| `I` · `F` | File info · fullscreen |
| `F2` | Rename (batch rename in grid) |
| `Delete` | Move to `.jeditor-trash` |
| `Ctrl` + `Z` | Undo |
| `Ctrl` + `A` | Select all (grid) |
| `D` | Find duplicates *(work in progress)* |
| `R` | Rescan folder |
| `?` | Keyboard shortcuts |

**In Crop & Straighten:** `Enter` save · `Shift+Enter` save & next · `Esc` cancel · `[` / `]` rotate 90° · `,` / `.` straighten ±0.1° · `<` / `>` ±1° · `0` zero the angle · `L` level tool · `A` next aspect ratio · `X` swap portrait/landscape · `P` previous crop · `R` reset.

**In Find duplicates:** `1`–`9` mark/unmark · `K` keep suggested, mark the rest · `Enter` trash marked & next · `N` not duplicates · `←` / `→` previous / next group · `Esc` close.

## 🛠 Development
```bash
npm install
npm start          # serve app/ at http://localhost:3000
npm test           # headless-Chromium test suite (needs Chrome; set CHROME_PATH if not found)
npm run build      # regenerate standalone.html
npm run bump 1.x.y # bump the version (app/version.js + package.json)
```
The app itself is dependency-free vanilla JS in `app/`: `script.js` (viewer, grid, rotation, shortcuts), `crop.js` (Crop & Straighten), `meta.js` (JPEG/PNG metadata), `dupes.js` (duplicate finder).

**Releases are automatic**: bump with `npm run bump 1.x.y`, commit, merge to `main` — the Release workflow tags `v1.x.y`, builds `standalone.html`, and publishes the GitHub Release by itself (it can also be run manually from the Actions tab). Merging to `main` also redeploys the PWA to GitHub Pages. The version appears on the app's start screen, and the test suite fails if `app/version.js` and `package.json` ever disagree.

If you change `app/icon.png`, run `node scripts/make-icons.js` to regenerate the PWA launcher icons.

Windows users without Node can run `start.bat` to serve the app locally instead.

---
*Created with focus on speed and flow.*
