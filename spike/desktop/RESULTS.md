# Step 0 spike results (docs/plans/lighter-desktop.md, #165)

*2026-11-16. Nothing shipped: these tools live here only, and the app and builds are unchanged.*

**Where it ran:** a Linux cloud container: Ubuntu 24.04, 4 CPUs, **no GPU**, Xvfb.
- Playwright WebKit 27.2.
- System WebKitGTK 2.52.6 for Tauri.
- Electron 44.5.1 running the real `mac/main.js`.

**Not measured here:**
- **No Mac.** The WKWebView numbers and the Mac's canvas caps need the Mac runner or the owner's Mac.
- **No GPU.** WebGL runs on the CPU (SwiftShader, llvmpipe), so the WebGL timings are only comparisons, not real speeds.

## 1. test/ui.test.js in WebKit, with stubbed handles

`node spike/desktop/run-in-webkit.js` runs the suite unchanged, with WebKit in Chromium's place. The suite's own in-memory handles (`page-helpers.js`) are the stub. Each page gets its own persistent profile, because WebKit's throwaway profiles have no OPFS (`UnknownError`). When a section throws, it's logged and the suite carries on.

- **Chromium** (headless shell 156): 609 passed, 0 failed.
- **WebKit:** 549 passed, 44 failed, plus 2 sections that threw.

Most failures come from tests that use WebKit's **own OPFS handles** as the folder. The host's handles will replace those, but they must cover these gaps.

| What breaks | Cause | Fix |
|---|---|---|
| Rename, flags carried by a rename, search after a rename, history (~10) | WebKit's `move(newName)` and `move(dir)` throw "Not enough arguments". Only `move(dir, name)` works | The host's handles accept all three forms, as Chromium does |
| Rotation, caches, snapshot (~6) | No `queryPermission` on WebKit's handles; `script.js:352` calls it without checking | The host's handles have it (always `granted`). Or guard it, as `recents.js` already does |
| Batch Auto crop, test set, kept edits' Save over the original (~12) | `NotFoundError` from OPFS in Save over the original | Likely the same OPFS gaps. Recheck once the handles exist |
| Liquid glass (3) | No SVG backdrop bend | Expected (plan): Liquid gets the plain glass |
| Grid zoom: the highlighted photo drifts 2–5 px | A real layout/scroll difference | Fix in step 1 |
| Adjust: the GPU and the CPU differ by 28 levels in grading/looks tiles | A real WebGL difference (software GL here) | Recheck on a GPU |
| Ctrl+C copy as it looks; the zip download; the tour's highlight; folder details' selection; some sections' "Failed to load resource" | Clipboard, download and engine differences | Look into each in step 1 |
| The standalone `file://` page | WebKit blocks `file://` fetches (Origin null) | Doesn't matter: the desktop app uses its own scheme |

**Also missing in WebKit:** `showDirectoryPicker`, `getAsFileSystemHandle` and `FileSystemObserver`, as the plan expected.

## 2. The Tauri shell against Electron (Linux)

`spike/desktop/tauri` is a Tauri v2 window loading `app/` unchanged. `measure.js` gives the median of 5 runs, the time to the page's load, and memory as PSS across all processes after 8 s idle on the start screen. No folder was open, because the spike has no host calls yet.

| | Tauri v2 (WebKitGTK 2.52) | Electron 44 (real `mac/main.js`) |
|---|---|---|
| App, unpacked | 9.9 MB binary, `app/` inside it (system WebKitGTK) | 283 MB Electron + `app/` 15 MB |
| Download, compressed | **~7 MB** (.deb-sized) | ~91 MB Electron alone (xz) |
| Start to the page loaded | 0.90–0.96 s | 0.33–0.46 s |
| ↳ of which a blank page | 0.73 s | – |
| Memory, idle | 438 MB, or **~230 MB** with `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 488 MB |
| Processes | 3 | 6 |

The page itself loads equally fast in both engines: 0.19 s in WebKit and 0.22 s in Chromium (`pageload.js`). So Tauri's slower start here is WebKitGTK starting up on this GPU-less box, not jEditor. This needs measuring on a real Linux desktop and on the Mac before taking it as a result. The DMA-BUF figure is also an Xvfb artefact.

## 3. ImageDecoder, canvas limits, a 600 dpi scan

The scan is 4960×7016 (35 MP), measured with `bigscan.js` and `test/engine-speed.perf.js`.

| | Chromium | WebKit |
|---|---|---|
| `ImageDecoder` | Decodes at the size asked for (1/8: 24 ms) | **Exists but always decodes full size** (300 ms) and reports no `rotation`. **With `file.stream()`, which is how `script.js:3497` feeds it, it hangs at random.** Thumbnails would stall rather than fall back. Step 1 must check for `rotation` before decoding, or use the host thumbnail call |
| Decode 35 MP / 320 px thumbnail | 103 / 140 ms | 376 / 297 ms (decoding is 2–3× slower) |
| Adjust export path 35 MP (WebGL) | 3.9 s | **1.5 s** |
| Adjust export with Detail, 35 MP (CPU JS) | 9.2 s | **15.4 s** |
| Adjust Detail, 2048² block, CPU / 24 MP export with Detail | 1.8 s / 9.8 s | **4.4 s / 23.0 s** (JavaScriptCore is 2–2.5× slower than V8 on this) |
| Adjust tables per slider step | 6 ms | 10 ms |
| Paint: 200-dab stroke / undo snapshot / three 3000² layers composited | 10 / 11 / 28 ms | 8 / 21 / 64 ms |
| Canvas limits: 80 live 3000² layers, one 16384² canvas | All fine | All fine (on Linux; the Mac's WKWebView caps total canvas area, so check on the Mac) |

## Files

- `run-in-webkit.js`: any browser suite run in WebKit.
- `probe.js`, `probe-persistent.js`: one snippet run in the page.
- `measure.js`, `electron-timing.js`: start time and memory.
- `pageload.js`: the engine's own page load.
- `bigscan.js`: the 35 MP checks.
- `tauri/`: the shell (`cargo build --release`; needs `libwebkit2gtk-4.1-dev`).
