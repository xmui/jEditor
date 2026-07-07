# jEditor

jEditor is a minimalist, high-performance local photo viewer and editor optimized for bulk rotation and precise cropping. Everything runs in your browser; files are read and written directly on your disk — nothing is uploaded anywhere. The current version is shown on the start screen and in [Releases](../../releases).

## ✨ Features
- **Instant lossless rotation**: JPEGs rotate by patching the EXIF orientation flag — no re-encoding, no quality loss. Previews rotate the moment you click, rotations stack (two clicks = 180°), and saves happen silently in the background.
- **Precise cropping**: Cropper.js-powered crop with rotate, saved back to the original file in its original format (PNG stays lossless).
- **Adaptive liquid-glass UI**: the header and control surfaces sample the photo behind them and flip between dark and light glass to stay readable.
- **Memory optimized**: lazy thumbnails and object-URL recycling handle 1000+ photo folders.

## 🚀 Just want to use it?
Download **`standalone.html`** (from the [Releases page](../../releases) or the repo root) and double-click it. It opens in Chrome or Edge and works immediately — no server, no install. All features including saving work from the local file.

Then:
1. **Open**: Click *Open Folder* (or drag and drop a folder/images in).
2. **Review**: Arrow keys or `Space` to flip between single and grid view.
3. **Rotate**: `[` / `]` (or the buttons). In grid view this rotates every selected photo.
4. **Crop**: `C` or the crop button; `Enter` saves, `Esc` cancels.
5. Changes are written straight back to your files.

> Chrome or Edge required for saving (File System Access API). Firefox/Safari can view but not save.

## ⌨️ Shortcuts
| Key | Action |
|---|---|
| `←` / `→` | Previous / next photo |
| `Shift` + `←` / `→` | Rotate left / right |
| `[` / `]` or `,` / `.` | Rotate left / right (bulk in grid view) |
| `Space` | Toggle grid / single view |
| `C` | Crop |
| `Enter` / `Esc` | Save / cancel crop; open photo / back to grid |
| `R` | Rescan folder for new photos |
| `F2` | Debug console |

## 🛠 Development
```bash
npm install
npm start          # serve app/ at http://localhost:3000
npm test           # headless-Chromium test suite (needs Chrome; set CHROME_PATH if not found)
npm run build      # regenerate standalone.html
npm run bump 1.x.y # bump the version (app/version.js + package.json)
```
The app itself is dependency-free vanilla JS in `app/` (Cropper.js is vendored).

**Every update gets a version number**: bump with `npm run bump`, commit, then `git tag v1.x.y && git push --tags` — CI builds `standalone.html` and attaches it to a GitHub Release automatically. The version appears on the app's start screen, and the test suite fails if `app/version.js` and `package.json` ever disagree.

Windows users without Node can run `start.bat` to serve the app locally instead.

---
*Created with focus on speed and flow.*
