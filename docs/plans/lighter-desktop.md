# Lighter desktop apps: Mac and Linux off Electron

*Planned 2026-11-11. Tauri v2 picked (the owner's go came through the Wrangler). **Done:** step 0, the spike (results below), step 1, the app's own handles behind a switch, off by default (#251, with the Mac and Linux app tests fixed in #253); step 2, the host's core in Rust, `desktop/core`, with tests of its own; and step 3's first part, the Mac app on Tauri (`desktop/app`), built on betas next to Electron as jEditor Tauri. **Next:** the rest of step 3 (the Photos library and macOS 26's toolbar), then step 4, Linux. Releases stay on Electron.*

**Goal:** jEditor's desktop apps as native and fast as possible, still on Windows, Mac and Linux. Windows already runs the page in the system's own web view (WebView2, `src/`). Step 1 moves the Mac and Linux host (`mac/`, Electron 44) onto the system's web view as well: WKWebView on the Mac, WebKitGTK on Linux.

## The one big thing: WebKit has no File System Access

Whichever host is picked, this is most of the work. The page edits files through folder handles. That covers about 350 calls (`getFileHandle`, `getDirectoryHandle`, `createWritable`, `removeEntry`, `move`, `entries`, `queryPermission`, …), plus `showOpenFilePicker`/`showSaveFilePicker` and the drop that mints a handle (`getAsFileSystemHandle`). Chromium has all of it, which is why the Mac app is Electron today (PLAN.md, Decisions). Safari's WebKit and WebKitGTK have none of it for real folders on disk.

**So the new host gives the page its own handles.** A small JS file makes `FileSystemDirectoryHandle` and `FileSystemFileHandle` objects that look the same to the page. They're backed by the host: list, stat, read (whole or a range), write (a temp file, renamed into place on `close()`, as Chromium does), mkdir, remove, move. The page's own code doesn't change. The same file serves the Mac, Linux and, later, the iPad app (PLAN.md phase 7 needs exactly this). The bridge's drag-and-drop trick for minting handles goes away; `folderHandle(path)` just makes one.

**dataDir moves out of OPFS** to a real folder (`~/Library/Application Support/jEditor/data`, `~/.local/share/jeditor/data`) through the same handles. That gets rid of WebKit's OPFS differences, and it means `cacheFolder` can come to the Mac and Linux almost for free.

### Bridging the file layer, sized

Windows gets real handles from WebView2 (`CreateWebFileSystemDirectoryHandle`, `src/MainForm.cs`). On WebKit the host makes them itself. Each part of the page's file layer, and what it takes:

| The page uses | How it's bridged | Size | Page change |
|---|---|---|---|
| Directory and file handles: `entries`/`keys`/`values`, `getFileHandle`, `getDirectoryHandle`, `removeEntry`, `move`, `resolve`, `isSameEntry` | JS classes, one host call each, keyed by path. Errors carry the same names (`NotFoundError`, `TypeMismatchError`, `InvalidModificationError`) | ~400 lines of JS + ~300 of Rust | None |
| `getFile()` | A real `File`, its bytes fetched from a custom scheme (`jfs://`, Range-capable), not passed as JSON | in the above | **Listing a folder** calls `getFile()` on every photo only for size and date (`script.js` ~1635, 1685, 1821). Reading every file there would make a 2,000-scan folder crawl, so those 3 places ask `Host.stat(handle)` (one host call for the whole folder; Chromium falls back to `getFile()`) |
| `createWritable` / `write` / `close` | Chunks streamed to a temp file, renamed into place on `close()`, as Chromium does | ~100 + ~80 | None |
| `queryPermission` / `requestPermission` | Always `granted` (the app has the disk, as on Windows) | tiny | None |
| `showDirectoryPicker`, `showOpenFilePicker`, `showSaveFilePicker` | The system's dialogs, returning handles | ~60 | None |
| A folder dropped from Finder or Files (`getAsFileSystemHandle`, `script.js` 1572, `places.js` 880) | The host gets the drop's paths. The bridge patches `DataTransferItem.getAsFileSystemHandle` to return handles for them | ~60 | None |
| `FileSystemObserver` (`watch.js`) | The host watches the folder (FSEvents, inotify; Rust's `notify`) and the bridge gives the page a `FileSystemObserver` with Chrome's record shape. Without it, `watch.js` already falls back to polling | ~120 + ~100 | None |
| Handles kept in IndexedDB (`recents.js`: the recent folders) | WebKit can't store a made-up handle in IndexedDB. The bridge stores `{ path }` in its place and turns it back into a handle on the way out (wrapping `put` and `get` on that store) | ~80 | None, or a 2-line hook in `recents.js` if the wrapping proves fragile |
| OPFS (`dataDir`) | A real folder through the same handles (above) | none extra | None |
| Workers | No handle goes to a worker today; they get bytes | none | None |

**In all:** about 900 lines of JS (shared by the Mac, Linux and a future iPad app) and 600 of Rust. The page changes in 3 places (`Host.stat`), plus maybe 2 lines in `recents.js`.

**Parity:**
- **Low risk:** the page code is the same everywhere, and the `features` lists don't change.
- **The risk:** the made-up handles behaving slightly differently from Chromium's in an edge case (an error's name, a half-written file, a move across drives).
- **Covering it:** the handles first replace Chromium's own under Electron, and `test/mac.test.js` and `test/ui.test.js` must pass with them before WebKit is involved (step 1). A conformance test runs the same file operations against both, and stays in `npm test`.

### How it fits the fast engine

A native engine that decodes and renders on the GPU through the host gives the page results, not files. The host already knows every handle's path, so the page tells the engine *which* photo and *what* edit, and the engine reads the file from disk itself. Heavy bytes never cross into JS, which makes the handles' `getFile()` cost matter far less.

- **In Tauri the engine is Rust** (`wgpu`: Metal on the Mac, Vulkan on Linux, DX12 on Windows) in the same process as the host. Thumbnails and previews come back as images on the custom scheme (`<img src="jimg://…">`), with no JS decode.
- **The same engine can be a DLL** that the Windows host (C#) loads, so it's one engine for all three apps.
- **Live editing** sends preview-size frames. Drawing straight into a GPU layer under the web view is possible later, per platform.
- **With Electron,** the engine would be an N-API addon with the same copies, plus Chromium's own GPU process next to it. That's one more reason the Rust host fits.

*I haven't seen the owner's plan for the engine. The above is how a Tauri host would carry one, to be checked against that plan.*

## Tauri v2 or a Swift app plus a GTK app

| | **Tauri v2** (Rust; WKWebView on Mac, WebKitGTK on Linux) | **Swift WKWebView app (Mac) + WebKitGTK app (Linux)** | Electron today |
|---|---|---|---|
| Hosts to keep in parity | **1** for Mac and Linux (as now), + Windows C# | **2** (Swift, and C/Rust/Vala for GTK), + Windows C# | 1 + Windows |
| Download (Mac, universal) | ~15–20 MB (the page is 14 MB of it) | ~15–18 MB | ~150 MB |
| Download (Linux) | `.deb`/Arch ~10 MB (uses the system's WebKitGTK); AppImage ~80–100 MB if it bundles WebKitGTK | same | ~110 MB |
| Cold start (Mac, to the page) | ~0.3–0.5 s | ~0.3 s | ~1–2 s |
| Memory, idle with a folder open | ~80–120 MB | ~70–110 MB | ~200–300 MB |
| Packaging | Built in: `.app`/`.dmg` (universal), signing and notarizing, AppImage, `.deb`, `.rpm`. No pacman: Arch is built from the `.deb` | Xcode/`xcodebuild` + `create-dmg`; Linux packaging written by hand | electron-builder |
| Updater | `tauri-plugin-updater` (Mac, AppImage); our own GitHub check kept for betas, `.deb` and Arch | All our own (port of `mac/main.js`) | Our own |
| Photos library (`photos.mm`) | Kept as Objective-C++, built with the `cc` crate, called through a thin C API (the N-API glue goes) | Called straight from Swift (best fit) | N-API addon |
| Native toolbar (`toolbar.mm`, Liquid Glass) | Kept, attached to Tauri's `NSWindow` (`ns_window()`) | Rewritten in Swift, simplest | N-API addon |
| iPad later | Tauri v2 does iOS too (Swift plugins), so the same host | The Swift code carries straight over | Not possible |
| Tests driving the real app | Linux: WebDriver (`tauri-driver` + WebKitWebDriver). Mac: no WebDriver for WKWebView | The same limits | Playwright `_electron` |

The figures are typical numbers for these stacks, not jEditor's. Step 0 measures them.

**Also looked at:**
- **Wails v3** (Go, the same web views): like Tauri, with less packaging and fewer users. There's no reason to pick it over Tauri.
- **Electrobun** (Bun, the system web view or a bundled CEF per platform): could put CEF on Linux and WebKit on the Mac. It's too young to ship on yet; worth another look.
- **CEF or Neutralino:** CEF is Chromium again, so it doesn't save any size. Neutralino's native side is too thin for Photos, drives and moves.
- **Staying on Electron, or a slimmer Chromium host:** this needs no file bridge, so the page runs exactly as on Windows. But the app stays ~150 MB, is slow to start and heavy on memory, and a GPU engine would have to sit beside Chromium's own GPU process. Bridging the file layer is about 1,500 lines with a clear way to test it, so it isn't a reason to stay.

## What changes for the page (WebKit against Chromium)

| | Mac (WKWebView, macOS 12+) | Linux (WebKitGTK 2.4x) | What we do |
|---|---|---|---|
| File System Access (folders, pickers, permissions, `move`) | No | No | The host's handles (above); pickers become the host's dialogs |
| OPFS | Yes, with differences between versions | Depends on the distro's version | dataDir becomes a real folder (above) |
| WebCodecs `ImageDecoder` (the scaled JPEG decode, 4× faster thumbnails of scans) | Not in WebKit yet (check in step 0) | No | It already falls back to a full decode. Better: a host thumbnail call (ImageIO's `CGImageSourceCreateThumbnailAtIndex` on the Mac, libjpeg scaling on Linux), likely faster than Chromium's |
| WebGPU | Yes (macOS 26) | No | Not used today (Adjust is WebGL). Fine |
| WebGL2, OffscreenCanvas, workers, `createImageBitmap`, WASM | Yes | Yes; speed depends on the GPU driver and compositing | **The Linux risk:** measure Adjust and Paint on a big scan |
| HEIC | Decoded by the system (fast) | No | The WASM decoder stays for Linux and Windows |
| AVIF | Yes | Yes when built with libavif (most distros) | WASM encoder unchanged |
| JPEG XL | Yes (Safari 17+) | Optional | WASM decoder stays where it's missing |
| Colour | Display P3 canvases, real colour management | sRGB | Better for judging colour on a Mac |
| Liquid glass (SVG filter behind an element) | Unbent, as in Safari | Unbent | Settings → Glass → Liquid gets the plain glass; the Mac's native toolbar keeps the real Liquid Glass |
| Canvas memory limits | WebKit caps the total canvas area | Same | **Risk** for Paint with many layers on big scans. Test in step 0 |

## What the host needs (the Electron side to port)

`mac/main.js` handles about 50 requests. They're grouped below, about 2,700 lines of JS and Objective-C in all:

- **Files:** the handles above, `exists`, `reveal`, `pickFolder`/`pickPath`, `makeFolder`, `renameFolder`, `countPhotos`, `listDir`, `listProjects`.
- **Drives (`places.js`):** `/Volumes`, `/proc/mounts`, `/run/media`, Eject (`diskutil`, `udisksctl`), the drive-came event.
- **Moving and copying (`move.js`):** `copyFolder`/`moveFolder` with progress and Cancel, `folderSize`, `transfer`/`undoTransfer` between windows, `folderMove` (copy, check, then remove).
- **Windows:** `newWindow`, `split`, `state`, `windows`, `holdClose`/`closeWindow`, menus, `titleBar`, traffic lights, themes.
- **Mac only:** Photos (`photosAccess`, `photosLibrary`, `photosAssets`, `photosSave`, `photosAdd`), `permissions` (privacy settings), the NSToolbar.
- **Updater:** the GitHub release check (beta channel), the `.dmg` swapped in place, the AppImage replaced in place, `.deb`/Arch through the system.
- **The smoke test** (`--smoke-test`), the log, and Finder/Dock/command line opening a folder.

`mac/bridge.js` stays the page's side, almost unchanged. Only its transport changes: `window.jeditorMac.request` becomes Tauri's `invoke` or `webkit.messageHandlers`. Its `features` list stays the same, so `test/parity.test.js` and `docs/platforms.md` don't move.

**Homebrew:** the cask (`Casks/jeditor.rb`) only changes its URL and checksum.

**Signing:** the same Developer ID and notarizing. WKWebView needs none of Electron's hardened-runtime JIT exceptions. The bundle id stays `com.xmui.jeditor`, so the Photos and folder permissions people gave carry over.

## Recommendation

**Tauri v2 for both Mac and Linux, with the page's file handles provided by the host.**

- It keeps one host for two systems, as Electron does now. That's the simplest way to keep parity, and a Swift app plus a GTK app would make three hosts to keep in step.
- It ships signing, notarizing, the `.dmg`, AppImage and `.deb` out of the box, and it can grow into the iPad app.
- Photos and the toolbar stay the Objective-C++ that already works.
- A Swift app is a little more native on the Mac. Pick it instead only if the Mac matters much more than Linux, or if the iPad app comes soon.

**Linux moves only if WebKitGTK passes step 0** (Adjust and Paint fast enough on a big scan, on Ubuntu LTS and Fedora). If it doesn't, Linux stays on Electron for now. With the shared handles and bridge, keeping that host is cheap, and the Mac still moves.

## Step 0: what the spike found

Measured on Linux only, in a container with no GPU and no Mac (Xvfb). The tools and full notes are on the branch `claude/desktop-spike` (`spike/desktop/RESULTS.md`); nothing from it shipped.

| Check | Result |
|---|---|
| `test/ui.test.js` in Playwright WebKit, with stubbed handles | 549 pass, 44 fail (Chromium: 609, 0). Most failures are WebKit's own handles: `move(newName)` throws and there's no `queryPermission`, which the host's handles cover (step 1). 3 are the Liquid glass bend, as expected. A few are real: grid zoom drifts 2–5 px, GPU and CPU grading differ slightly, clipboard copy, the zip download |
| Size (Linux) | Tauri ~7 MB compressed (a 9.9 MB binary with `app/` inside), against Electron ~91 MB |
| Start, to the page loaded | Tauri 0.9 s, Electron 0.4 s. The page itself loads equally fast in both (~0.2 s); the gap is WebKitGTK starting on a box with no GPU (a blank page takes 0.73 s). To measure again on a real desktop and a Mac |
| Memory, idle | Tauri ~230 MB (438 MB counting Xvfb's DMA-BUF cost), Electron 488 MB |
| `ImageDecoder` | Exists in WebKit but never scales, and **hangs at random when fed by `file.stream()`**, as the page does. Fixed in step 1: the scaled path is skipped when `VideoFrame` has no `rotation`, and the scan uses `Host.stat()` instead of reading files |
| Canvas limits | 80 live 3000² layers and one 16384² canvas are fine on Linux. The Mac's cap is still untested |
| Adjust on a 35 MP scan | WebGL export is faster in WebKit (1.5 s, against 3.9 s). The CPU JavaScript (Detail) is 2–2.5× slower: export with Detail 15 s, against 9 s. Move Detail to WebGL or WASM, or later the engine |
| Paint on the same scan | Fine: a stroke 8 ms; compositing 64 ms, against 28 ms |

**In short:** nothing rules Tauri out. To plan for: the handles' gaps (done in step 1), the `ImageDecoder` hang (worked around in step 1), and Detail on JavaScriptCore. Still open, and needing a real machine: Linux start time on a desktop with a GPU, and everything on the Mac.

## Step 1: done (#251, #253)

- `mac/handles.js` and `mac/fs-host.js`: the app's own directory and file handles, backed by the host. Errors carry Chromium's names. Writes go to a swap file beside the photo and replace it only on `close()`. A file's bytes come from `/__fs` with Range support. The handles survive IndexedDB, so Recents works; the pickers and drag-and-drop go through the host.
- They switch on with `JEDITOR_HOST_HANDLES=1` or `--host-handles`, and are **off by default**.
- `Host.stat()` gives a file's size and date without reading it; Watch and the scan use it.
- `test/handles-conformance.js`: 49 behaviour checks, with answers recorded from Chromium's real handles. `test/handles.test.js` runs them in Chromium and Playwright WebKit, then jEditor in WebKit on a real folder. `test/mac.test.js` runs them in Electron with the switch off and on.
- #253 brought the Mac and Linux app tests back to green (the docked sidebar, the row of modes, the traffic lights), and fixed two layout bugs they found.

## Step 2: done (the host's core in Rust)

`desktop/core` is a Rust library, `jeditor-core`, with no window and no network. The Tauri shell (step 3) wires it to the window. Each module is the Rust twin of a part of the Electron host, and gives the same answers:

| Module | Twin of | What it does |
|---|---|---|
| `fs_host` | `mac/fs-host.js` | The page's file requests (list, stat, child, remove, move, open/write/seek/truncate/close/abort), with Chromium's error names; `getFile()`'s bytes, Range included, for the `jfs://` scheme |
| `places` | `mac/places.js` | Drives (`/Volumes`; `/media`, `/run/media` and `/proc/mounts` on Linux; `JEDITOR_VOLUMES` for tests), the usual folders (XDG names on Linux), a folder's folders and photos, projects newest first, photo counts, new folders, renames, eject, a whole folder copied |
| `moves` | `mac/move.js`, `src/FolderMove.cs` | The projects folder moved item by item: renamed on one disk; across disks copied, checked byte by byte, then the original removed |
| `update` | Updates in `mac/main.js` | Which release is newer (betas and `-N` included), which download is this app's, a download hashed as it comes and used only if its SHA-256 matches, the Mac app swapped in place, the package installer's command |

The shell does what needs the system or the network: fetching, `hdiutil` and `codesign`, the relaunch, watching the drive folders (`Places::drive_dirs`).

**Tests:**
- `cargo test` in `desktop/core`: 34 tests on real folders, including a move across disks where the runner has one (`/dev/shm`).
- The `jeditor-core` binary serves the file requests a JSON line at a time. With `JEDITOR_CORE` set, `test/handles.test.js` runs all 49 conformance checks on it in Chromium and WebKit, then jEditor itself in WebKit (open, thumbnails, rotate, rename, delete, undo, Recents). All pass, the same as Node's `fs-host.js`.
- CI's `tests` job builds the core, runs its tests, and sets `JEDITOR_CORE` for `npm test`.

## Step 3: the Mac on Tauri (first part)

`desktop/app` is the Tauri shell, `jeditor-app`. It wires the core to the window and serves the page; the page, `mac/bridge.js` and `mac/handles.js` are the same files as in the Electron app.

- **The page** is served at `app://jeditor/` from `Resources/app`, with `desktop/app/host.js`, `handles.js` and `bridge.js` before jEditor's own scripts. `host.js` gives the bridge the `window.jeditorMac` that Electron's `preload.js` does. Requests are POSTs on the app's scheme (`/__host/request`), a handle's bytes go as they are (`/__host/write`), and the app's messages come in through `eval`. Tauri's own IPC isn't used.
- **The handles are always the app's own** (WebKit has none for folders on disk), and jEditor's data is a real folder (`<app data>/data`, through the same handles), not OPFS.
- **Every request of `mac/main.js` is answered,** from `src/host.rs` on the core:
  - files, the sidebar, copies and moves, between windows;
  - the dialogs, windows, menus, closing with Keep your changes?, Split;
  - permissions, updates, and the smoke test.
- **Drops from Finder:** Tauri's own drop handler would take every drag, the page's own too (thumbnails onto the sidebar, Paint's layers), so it's off. WebKit doesn't say where a dropped file is, so the app reads the paths off the Mac's drag pasteboard as the drag comes in (`dragPaths`).
- **It installs beside the Electron app,** as *jEditor Tauri* (`com.xmui.jeditor.tauri`), with its own settings and data. It updates itself to the newest beta with a `jEditor-<version>-mac-tauri.dmg`: the core tells that download from the Electron app's (`App::MacTauri`).
- **Not yet:**
  - the Photos library (`photos.mm`): the feature isn't listed, so the page doesn't offer it;
  - macOS 26's toolbar (`toolbar.mm`): the page keeps its own pills;
  - moving the traffic lights after the window opens: Tauri can't yet, so they stay where they open;
  - a theme hiding them;
  - menu keys for a theme's menus.
- **Built and tested:**
  - `node desktop/app/build.js` makes the universal `.dmg`.
  - CI's `mac-tauri` job (with `build:mac`) builds it, runs `scripts/smoke-test-mac.js` on it (the same test as the Electron app's), and takes screenshots (`scripts/shots-tauri.js`).
  - A beta with the Mac app has it too (`release.yml`, `mac-tauri`). A beta goes out without it if it fails.
- **On Linux,** the same shell runs on WebKitGTK and passes the smoke test (`cargo build` in `desktop/app`, then `xvfb-run -a node scripts/smoke-test-mac.js desktop/app/target/debug/jeditor`). Its packages and drops are step 4.

## Migration order

0. **Spike (done; results above):**
   - Run `test/ui.test.js` in Playwright's WebKit with a stub of the handles, to list what breaks in the engine.
   - Make a Tauri shell that loads `app/` on the Mac and Linux, and measure size, start time and memory against 1.51.0.
   - Check `ImageDecoder`, canvas limits and Adjust/Paint speed on a 600 dpi scan.
1. **The handles (done: #251, #253):** the JS handles and the host's file calls.
   - Prove them first **under Electron**, with a switch: `test/mac.test.js` passes on Chromium with the new handles, so their bugs are kept apart from WebKit's.
   - Then in Playwright WebKit.
2. **The host's core in Rust (done):** the requests, drives, moves and the updater, with Rust tests of their own. The window is kept apart from them, so they can be tested without one.
3. **The Mac on Tauri:**
   - The window, menus, `toolbar.mm`, `photos.mm`, signing, the `.dmg` and the Homebrew cask.
   - Built on betas next to the Electron build; releases stay on Electron until the Mac suite passes.
4. **Linux on Tauri** (if step 0 passed): AppImage, `.deb`, and Arch made from the `.deb`, with their updates.
5. **Electron goes:** remove `mac/node_modules` and electron-builder, and update the docs (`platforms.md`, the Liquid row, PLAN.md Decisions).

**Tests after the move:**
- **Mac:** the page and bridge run in Playwright's WebKit against the real Rust core, served for the test. The core has its own tests. The real `.app` is checked on the Mac runner by `--smoke-test`, as now.
- **Linux:** the real app is driven end to end through `tauri-driver`.
- `test/parity.test.js` is unchanged.

## Risks

1. **Projects' data in Electron's storage.** Flags, edits, the cache and settings (`localStorage`) are in Chromium's OPFS, which nothing else can read. The last Electron release must copy them to the plain data folder before it updates to the new app, or people lose their flags and edits. This must ship and be checked before anything else.
2. **The handles must behave exactly like Chromium's:** errors (`NotFoundError`, `TypeMismatchError`), writes that land only on `close()`, and `move` across folders. The whole page depends on them. Step 1 tests them under Chromium first for this reason.
3. **WebKitGTK speed and versions:** WebGL and canvas speed vary by GPU driver, and older distros ship older WebKitGTK. A bundled AppImage is big again. This is the main reason Linux is gated on step 0.
4. **No WebDriver for WKWebView on the Mac**, so the real Mac app is tested less directly than with Playwright `_electron` today. The smoke test and the core's tests have to cover the gap.
5. **WebKit's canvas memory caps** could hurt Paint with many layers on big scans.
6. **Rust is new to the repo:** a third language next to C# and JS, and a longer CI build on Mac and Linux (cached).
7. **The Liquid bend is lost** in Settings → Glass on the Mac and Linux. The native toolbar's Liquid Glass stays.
