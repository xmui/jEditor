# Lighter desktop apps: Mac and Linux off Electron

*Plan only (2026-11-11); nothing is built yet. Waiting for the owner's pick.*

**Goal:** jEditor's desktop apps as native and fast as possible, still on Windows, Mac and Linux. Windows already runs the page in the system's own web view (WebView2, `src/`). Step 1 moves the Mac and Linux host (`mac/`, Electron 44) onto the system's web view as well: WKWebView on the Mac, WebKitGTK on Linux.

## The one big thing: WebKit has no File System Access

Whichever host is picked, this is most of the work. The page edits files through folder handles. That covers about 350 calls (`getFileHandle`, `getDirectoryHandle`, `createWritable`, `removeEntry`, `move`, `entries`, `queryPermission`, …), plus `showOpenFilePicker`/`showSaveFilePicker` and the drop that mints a handle (`getAsFileSystemHandle`). Chromium has all of it, which is why the Mac app is Electron today (PLAN.md, Decisions). Safari's WebKit and WebKitGTK have none of it for real folders on disk.

**So the new host gives the page its own handles.** A small JS file makes `FileSystemDirectoryHandle` and `FileSystemFileHandle` objects that look the same to the page. They're backed by the host: list, stat, read (whole or a range), write (a temp file, renamed into place on `close()`, as Chromium does), mkdir, remove, move. The page's own code doesn't change. The same file serves the Mac, Linux and, later, the iPad app (PLAN.md phase 7 needs exactly this). The bridge's drag-and-drop trick for minting handles goes away; `folderHandle(path)` just makes one.

**dataDir moves out of OPFS** to a real folder (`~/Library/Application Support/jEditor/data`, `~/.local/share/jeditor/data`) through the same handles. That gets rid of WebKit's OPFS differences, and it means `cacheFolder` can come to the Mac and Linux almost for free.

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

## Migration order

0. **Spike (2–3 days, nothing shipped):**
   - Run `test/ui.test.js` in Playwright's WebKit with a stub of the handles, to list what breaks in the engine.
   - Make a Tauri shell that loads `app/` on the Mac and Linux, and measure size, start time and memory against 1.51.0.
   - Check `ImageDecoder`, canvas limits and Adjust/Paint speed on a 600 dpi scan.
1. **The handles (about a week):** the JS handles and the host's file calls.
   - Prove them first **under Electron**, with a switch: `test/mac.test.js` passes on Chromium with the new handles, so their bugs are kept apart from WebKit's.
   - Then in Playwright WebKit.
2. **The host's core in Rust:** the requests, drives, moves and the updater, with Rust tests of their own. The window is kept apart from them, so they can be tested without one.
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
