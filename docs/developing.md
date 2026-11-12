# Developing jEditor

How jEditor is built, how to change it, and how releases are made. What comes next is in [PLAN.md](../PLAN.md).

## How it works

- `src/`: a small .NET 8 WinForms app hosting WebView2, Edge's engine. It serves the `app` folder at `https://jeditor.example/`. That address must never change, because jEditor's settings and recent orders are stored under it.
- `src/bridge.js`: runs in the page before jEditor does. It replaces the browser's folder picker with Windows' own, and the app hands the page a real folder handle made by WebView2 (`CreateWebFileSystemDirectoryHandle`), with permission to edit already granted. The UI's file code is standard web code (the File System Access API), so it also runs in Chrome and in the tests. The bridge also turns off the service worker, reports the theme for the title bar, and runs dev mode and the smoke test.
- `src/Scanner.cs`: scanning into the open order with [NAPS2.Sdk](https://github.com/cyanfish/naps2) (LGPL-2.1; its DLLs and license ship beside the exe, not inside it, so they can be replaced). TWAIN scanners with 64-bit drivers and WIA scanners work in the app's own process; the scanner's own window sets size and resolution. TWAIN needs `TWAINDSM.dll`, which scanner drivers install in System32 (or put one in `_win64\` beside the exe). `--fake-scanner` adds a test scanner that needs no hardware.
- `app/`: the UI. It ships beside the exe.
- `docs/`: how to use jEditor, installing it, this page, and the plan from its web app days.
- `installer/jEditor.iss`: the per-user installer (Inno Setup).
- `mac/native/`: the Mac app's native toolbar (Objective-C++, Node-API): an NSToolbar per window, drawn in Liquid Glass on macOS 26, its items mirroring the page's top row (`bridge.js`); built universal by `node mac/native/build.js` (on a Mac, after `npm ci` there).
- `mac/`: the Mac app, in Electron (Chromium, as WebView2 is). `main.js` serves the `app` folder at `app://jeditor/` (fixed, like the Windows address) and drops a folder onto the page to give it a real folder handle for any path, with permission granted; `bridge.js` takes the drop in the page, replaces the folder picker with the Mac's, and gives jEditor `JEditorNative`. The projects' data is kept in the app's private storage.

The UI never assumes Windows. Everything an app adds goes through `window.JEditorNative` (made by `src/bridge.js`), which is `null` in a browser. Each app says what it is and lists what it can do (`platform`, `features`), and `app/host.js` hides what it can't (`Host.has('scan')`, `data-needs="scan"`) and puts the system's own words into the page: Explorer or Finder, the Recycle Bin or the Trash. The UI tests run it with no app (the web), the Windows app, and an app with only the core; `test/mac.test.js` runs the real Mac app.

## Changing the look

The UI is plain HTML, CSS and JavaScript: the `app` folder here, shipped beside `jEditor.exe`. Colors, type and spacing are in `app/tokens.css`. Changing the UI never needs the exe to be rebuilt. To try a change:

```
jEditor.exe --ui C:\path\to\jEditor\app
```

That runs the UI from that folder in **dev mode**:

- saving a `.css` file restyles the window at once, keeping the open folder
- saving any other file reloads the page
- `F5` or `Ctrl+R` reloads, and `F12` opens DevTools

A Debug build (`dotnet run --project src`) does this on its own with the repo's `app` folder. `JEDITOR_UI=<folder>` does the same as `--ui`.

`npm start` also serves `app/` at http://localhost:3000 for a quick look in Chrome, without the Windows side (no folder picker bridge, so Chrome asks for permission as it always did).

## Building

On Windows, with the .NET 8 SDK and [Inno Setup 6](https://jrsoftware.org/isdl.php):

```
git clone https://github.com/xmui/jEditor
cd jEditor
./scripts/build.ps1            # dist\: publish\, the portable zip and the setup
./scripts/smoke-test.ps1       # the built app opens a folder and saves a rotation
```

On a Mac, with Node 20:

```
npm ci && (cd mac && npm ci)
npm run mac                    # runs the Mac app from this checkout (the UI from app/)
node mac/build.js              # dist/jEditor-x.y.z-mac.dmg, for Apple silicon and Intel
node scripts/smoke-test-mac.js # the built app opens a folder, edits, deletes and undoes
```

On Linux, the same with `node mac/build.js`: `dist/jEditor-x.y.z-linux.AppImage`, `.deb` and `.pacman` (x64; the pacman package needs `bsdtar`, from libarchive-tools); `node scripts/smoke-test-mac.js` then smoke-tests `dist/linux-unpacked`.

`npm run test:mac` runs the Mac app's tests: the real app on folders on disk. Electron runs on Linux too, so they run there as well (`xvfb-run npm run test:mac` without a screen).

`npm test` runs the tests in headless Chrome, on any OS: the bridge's, then the UI's (sorting, rotation, crop, flags, folders and much more). Set `CHROME_PATH` if Chrome isn't found. The project also compiles on Linux and macOS (`dotnet build src`), which is handy for checking a change, but it only runs on Windows.

Every push builds on GitHub Actions: the tests, then on Windows the build, the smoke test and an install/uninstall test, on a Mac the Mac app's tests, its build and its smoke test, and on Linux the same tests as the Linux app, its AppImage, .deb and pacman package, and install tests of the .deb on Ubuntu and the pacman package in an Arch Linux container. The setup, the zip, the .dmg and the Linux packages from each run are on the run's page under **Artifacts**.

### The engine

`engine/` is jEditor's engine: the heavy image work in Rust, run by the desktop apps instead of the page ([the plan](plans/fast-engine.md)). The page asks for results by URL and gets pictures back; full-size pixels never go to the page. It's the `engine` feature (`Host.has('engine')`), and today's JavaScript stays the fallback for the web and for whatever the engine can't do.

- **What it does so far (Phase 1, first slice):** JPEG grid thumbnails, decoded straight to about the size wanted (libjpeg's scaled decode), turned as their EXIF says, on every core. `engine/src/thumb.rs`, `exif.rs`; the C interface the apps call is in `engine/src/lib.rs` (`je_thumbnail_file`, `je_free`, `je_version`).
- **HEIC (`engineHeic`):** with the cargo feature `heif`, grid thumbnails of HEICs too (`engine/src/heif.rs`): libheif with libde265 decodes the photo natively, many at once, or uses the photo's own thumbnail when it's big enough. libheif and libde265 are LGPL, so they're linked dynamically and ship as their own DLLs beside the engine's (`heif.dll`, `libde265.dll`, with their licenses in `licenses\`). They come from vcpkg: `scripts/engine-heif.ps1` installs `libheif[core,libde265]:x64-windows`, never vcpkg's default `hevc` feature, which is the x265 encoder (GPL; the script fails if x265 is there). `je_formats` tells the app what the engine reads; the bridge lists `engineHeic` only then.
- **In the Windows app:** `jeditor_engine.dll` beside `jEditor.exe`, loaded by `src/Engine.cs`, which answers the page's `https://engine.jeditor.example/thumb?w=…&path=…` (a host of its own, with CORS for the UI's origin) (a JPEG, or 204 when the engine can't make it and the page does). The bridge lists `engine` only when the DLL loaded, and gives the page `JEditorNative.engineThumb(dir, relPath, w)`; the page's side is `engineThumbnail` in `app/script.js`. Not in the Mac and Linux app yet.
- **Building:** `src/jEditor.csproj` runs `cargo build --release --lib` in `engine/` on Windows and ships the DLL. It needs [Rust](https://rustup.rs) (MSVC) and [nasm](https://www.nasm.us) (for libjpeg's SIMD) on the PATH; without them the app still builds, without the engine. With libheif in vcpkg (`VCPKG_ROOT`, after `scripts/engine-heif.ps1`) it builds the engine with `heif` and ships libheif's DLLs. CI (`scripts/build.ps1` with `CI=true`) requires both. On Linux, `cargo test --features heif` uses the system's libheif (`libheif-dev`, `libheif-plugin-libde265`). On any OS, `cargo build --release` in `engine/` builds the library and the bench.
- **Testing:** `cargo test --release` in `engine/` (EXIF orientation, sizes and turns, bad files as errors); `test/bridge.test.js` checks the page uses the engine's thumbnails and falls back; the smoke test (`scripts/smoke-test.ps1`) has the real app's engine make one.
- **Timing:** `cargo run --release --bin engine-bench -- <folder of JPEGs>` (the engine alone, against a full decode); `ONLY=windows node test/grid-speed.perf.js` (the Windows app's grid; `JEDITOR_NO_ENGINE=1` turns the engine off for the before); `node test/engine-speed.perf.js` (Adjust, Export and Paint in Chrome, the next phases' baseline).

### Releasing

```
npm run bump 1.x.y     # sets the version in app/version.js, package.json and package-lock.json
```

Add what changed to the top of `app/changelog.js`: it's what the app shows under **What's new**, and the release notes. The tests fail if the current version has no entry. When the bump lands on `main`, the Release workflow builds, tests and publishes the setup, the zip, the Mac .dmg, the Linux AppImage, .deb and pacman package, and `standalone.html` as release `v1.x.y`. Every push to `main` also deploys the web app (the Web app workflow), once the tests pass. Running Release by hand from the Actions tab releases the current version again as `v1.x.y-2` (for a fix to the Windows side alone).

**Betas.** Work that's ready to try but not to release goes to the `beta` branch. Bump the version there past the last release (`npm run bump 1.x.0`, newer than what's out), and every push to `beta` publishes a beta, `v1.x.0-beta.N`, as a GitHub prerelease, built and smoke-tested like a release. The apps with Settings → Updates → Beta builds turned on offer it; Homebrew and the website stay on releases. When it's ready, merge `beta` into `main` with its changelog entry: the release is newer than all its betas, so everyone on a beta moves to it. A changelog entry that only went out as a beta is marked `beta: true`; the release's notes take in the items of those just below it, so they say everything new since the last release. Unfinished features can ship turned off, in Settings → Experimental (`app/experiments.js`).

If you change `app/icon.png`, run `node scripts/make-icons.js` (the web icons) and `python3 scripts/make-icon.py` (the exe's icon).

### Command line

| | |
|---|---|
| `jEditor.exe [folder]` | open that folder (given a photo: its folder) |
| `--ui <folder>` | run the UI from that folder, in dev mode |
| `--log <file>` | write a log |
| `--smoke-test <folder>` | open the folder, rotate a photo, check it's saved, then exit 0 (passed) or 1 (failed) |
| `--user-data <folder>` | a different WebView2 profile |

See [PLAN.md](../PLAN.md) for what's next.
