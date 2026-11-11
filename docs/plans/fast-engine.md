# A fast engine for jEditor (plan; nothing built yet)

Asked for 2026-11-11 (through the Wrangler): make jEditor as fast as possible by
moving the heavy image work into a native engine, area by area: decoding and
thumbnails first, then Adjust, then Paint. The desktop apps come first; the web
keeps today's code (or, later, a lighter WebAssembly build of the same core).

**Waiting for the owner's OK before anything is built.** Decisions for the owner
are at the end.

## In one paragraph

A **Rust** engine (`engine/`), one library with a plain C interface, **inside
each desktop app's own process**: a DLL the Windows app (C#) loads, linked
straight into the Mac and Linux app if it becomes Tauri (the lighter-desktop
plan, #165), or an N-API addon while it's still Electron. **The page sends
settings, the engine owns the pixels**: it reads files, makes thumbnails and
previews, and does Export, Save edits and Convert from file to file, so a
full-size photo never crosses into the page. What the page does show (a
thumbnail, a screen-sized preview) comes back as a URL the page loads like any
picture, served by the app from the engine's memory. The GPU work runs through
**wgpu** (D3D12 on Windows, Metal on the Mac, Vulkan on Linux), with the shaders
written once in WGSL, the same language WebGPU uses in a browser.

## What's slow today (measured)

Measured 2026-11-11 in this repo's cloud container: Chromium (the engine
WebView2 and Electron both are), 4 cores, **no real GPU** (WebGL runs on
SwiftShader, the CPU), so GPU numbers here are pessimistic and the CPU numbers
are roughly a mid laptop's. Before Phase 1 starts, the same measurements are
taken on the owner's Windows PC and a Mac (Phase 0), and those become the
baseline.

### Thumbnails and decoding (`test/grid-speed.perf.js`, web, 520 photos)

400 camera JPEGs (12 MP, ~3 MB), 60 iPhone-size HEICs (12 MP, **without** a
thumbnail inside), 60 DNGs (with a 12 MP preview inside).

| | cold (nothing cached) | warm (cached) |
|---|--:|--:|
| Folder usable | 327 ms | 332 ms |
| First screen of thumbnails | **3.6 s** | 0.8 s |
| All JPEG thumbnails | **12.6 s** (~31 ms each, 4 at a time) | 1.4 s |
| All HEIC thumbnails | **54 s** (~0.9 s each) | 1.4 s |
| All DNG thumbnails | 4.3 s | 0.9 s |
| Resizing the tiles (slider) | 30 of 32 frames dropped, 1.7 s busy | same |
| Back to the grid from a photo | ~150 ms a frame | same |

- **JPEG:** each thumbnail decodes the whole 12 MP photo, then shrinks it
  (`createImageBitmap` with `resizeWidth`): ~110 ms for 24 MP on one core. A
  native decoder can decode straight to 1/8 size from the JPEG's own blocks
  (libjpeg-turbo's scaled decode), which skips almost all of that.
- **HEIC:** the iPhone's own thumbnail is used when there is one (since #162,
  ~30 ms). Without one, libheif in WebAssembly decodes the whole photo,
  single-threaded, ~1–2 s. That's the worst case on the grid, and it's also what
  opening a HEIC in the viewer costs.
- **RAW:** only the JPEG preview inside is ever shown; the sensor data is never
  developed (no demosaicing), so a RAW without a full-size preview can't be
  edited properly at all.
- **Not the engine's job:** the tile resize and back-to-grid jank are the page's
  own layout (DOM work, long tasks on the main thread). An engine won't fix
  those; they're for the Photos agent, and they're listed here so nobody expects
  them to change.

### Adjust (a 24 MP photo, `Develop` in `app/develop.js`)

| | time |
|---|--:|
| Building the tables for one slider step (33³ colour table) | 8 ms (9 ms with 4 masks) |
| Live preview on screen | GPU (WebGL2), working copy at most 2560 px: already live |
| Tables applied on the CPU, 24 MP (no WebGL2) | 1.6 s |
| Detail (sharpen + noise), one 2048² block, CPU | **1.7 s** (24 MP ≈ 10 s) |
| Export path, tables only, 24 MP (`applyCanvas`) | 6.1 s* |
| Export path with Detail, 24 MP | **13.1 s*** |
| JPEG encode 24 MP (`toBlob`) | 0.2 s |

\* on SwiftShader. With a real GPU the tables part is much faster, but the
shape stays: `applyCanvas` reads every 2048² tile out of a canvas
(`getImageData`), uploads it, draws it, reads it back (`readPixels`) and puts it
back (`putImageData`), four copies of every pixel, and Detail is plain
JavaScript on one core.

So: **the live sliders are already fast** (small tables, a screen-sized working
copy on the GPU). What's slow is everything at **full size**: Detail, the 1:1
view, Export and Save edits with Detail, and the 2560 px cap itself (Adjust
never shows the photo's own pixels except in the 1:1 box).

### Paint (layers up to 3000 px)

| | time |
|---|--:|
| 200 soft brush dabs, radius 60, on a 3000² layer | 15 ms |
| The undo snapshot of a long stroke (two `getImageData`, 2600×1000) | 17 ms |
| Three 3000² layers composited | 38 ms |

Paint is **not slow today** at its size, because of the 3000 px cap. Its cost is
the cap: layers are smaller than the photo (a 24 MP photo is painted at ~9 MP
and scaled), and big filters (blur, liquify, healing) from the pro update
(PLAN.md, roadmap 7) will need the GPU. With a GPU-accelerated canvas, the undo
snapshots' read-backs also stall the GPU, so this needs measuring with a pen on
the owner's Windows PC (Phase 0).

## The architecture

### Rust, not C++

- **wgpu** is Rust: one GPU API over D3D12, Metal and Vulkan, and the same code
  runs on WebGPU in a browser. The shaders are WGSL, which is also WebGPU's, so
  the web can later run the very same shaders.
- **Tauri** is Rust: if the lighter desktop app goes that way, the engine links
  straight into it with no glue.
- **WebAssembly:** Rust compiles to it cleanly (`wasm-bindgen`, SIMD, threads
  where the page allows), so the web's lighter build is the same code.
- **Safety:** decoders read untrusted files (whatever's on a customer's card).
  Rust keeps our own parsing code memory-safe.
- The proven codecs are C, and Rust uses them as they are: libjpeg-turbo,
  libheif + libde265 (already in jEditor, as WebAssembly), libwebp, libavif,
  libjxl, libtiff, LibRaw (or the pure-Rust `rawler`). C++ would only win if we
  wanted a C++ library with no Rust equivalent, and none on the list needs it.

### Where it runs: inside the app, a helper only if needed

The engine is one library (`jeditor-engine`) with a C interface. It runs in the
app's own process, the shape the lighter-desktop plan (#165) has too:

- **Windows:** `jeditor_engine.dll`, loaded by the C# host (P/Invoke).
- **Mac and Linux on Tauri (#165):** a Rust crate, linked into the host.
- **Mac and Linux while still on Electron:** the same library as an N-API addon
  in the main process (as `mac/native` is today), so the engine doesn't wait for
  the host decision.

The risk of running in-process is a decoder crashing on a damaged file and
taking jEditor (and an unsaved painting) with it. Our own Rust code can't do
that; the C libraries (libheif, LibRaw) can. So the same library also builds as
**`jeditor-engine`, a small helper program**, and the app can hand just the
risky decoders to it (crash-safe, restartable, killable to cancel) if Phase 1's
testing on real customer files shows crashes or hangs. Off by default; the
owner decides.

### How the page talks to it

Three paths, each for what it's good at:

1. **Commands, through the bridge** (`JEditorNative.engine`, small JSON):
   `thumbnail`, `preview`, `export`, `convert`, `cancel`, progress events.
   Windows: `chrome.webview` messages, as the bridge does now; Mac/Linux: the
   preload's `request`. Tauri: its commands. The app calls the engine directly.
2. **Pictures for the screen, as URLs:** a thumbnail or a preview is
   `https://jeditor.example/engine/thumb?f=…&w=320` on Windows
   (`WebResourceRequested`), `jimg://…` in Tauri (#165's custom scheme), the
   `protocol.handle` the Electron app already has meanwhile. The page uses it in
   an `<img>` or `createImageBitmap`, as it does a file now, so the grid barely
   changes. The engine reads the file by its path itself (the host knows every
   handle's path) and hands the result's bytes straight to the web view. No base64, no
   JSON, and the thumbnail cache lives on disk in the engine's own format.
3. **Raw pixels for the page's own drawing** (Adjust's working copy, Paint's
   layers) when needed: Windows has `CoreWebView2SharedBuffer`, an ArrayBuffer
   over the app's memory, **no copy**. Electron can't hand the page outside
   memory (V8's memory cage), so it's one copy into an ArrayBuffer: under 1 ms
   for a screen-sized frame (5 MB), which is fine. Full-size pixels never take
   this path.

### How results reach the screen without copies

The rule that makes it work: **full-size pixels never go to the page.** The
engine decodes, adjusts, sharpens, composites the paint layers, encodes and
writes the file itself; the page only ever gets screen-sized pictures (a few MB,
through 2 or 3 above).

- **Thumbnails and the viewer:** a URL, so the web view decodes a small JPEG or
  PNG (or a raw RGBA frame) and draws it on its own GPU.
- **Adjust's live sliders:** stay in the page on WebGL2, as now (already live).
  The engine gives it a better working copy (the right size for the screen and
  zoom, decoded and with Detail done) and does the full-size work.
- **Later, if measurements show the frame copies matter:** a native GPU view
  under the page (a D3D/Metal/Vulkan surface where the photo is, the page
  transparent there and drawing the handles and masks on top). Truly zero-copy,
  but it can't sit under the Liquid glass filter or the themes' effects, and
  it's hard on Linux. Kept as Phase 6, only if needed.

### The same picture everywhere

Adjust's look must not change when the engine does it. So:

- The settings → tables code (`Develop.tables`, 8 ms) stays the one definition
  at first; the page sends the tables (a few hundred KB) with an export, and the
  engine applies them exactly as the shader does.
- Detail, the effects (vignette, grain, halation), masks, spots and Paint's
  blending are ported to WGSL and checked against `Develop.applyCPU` and today's
  output on test scenes: **`test/engine.test.js`**, every channel within ±1, in
  CI for each app that has the engine.
- Later, the tables move into Rust too and the web runs them as WebAssembly, so
  there's again one definition of every slider.

### Building and signing

- `engine/`: a Cargo workspace (`core`: the pipeline and cache; `gpu`: wgpu and
  the WGSL shaders; `codecs`: the C libraries; `cli`: the optional helper program; later
  `wasm`).
- **Windows:** built with MSVC on `windows-latest` (x64; ARM64 later),
  `jeditor_engine.dll` installed beside `jEditor.exe` by the installer and the
  portable zip.
- **Mac:** `aarch64` and `x86_64` built and joined (`lipo`) into a universal
  binary (linked into the Tauri app, or the `.node` addon in Electron's
  resources), signed with the app (ad hoc now, as
  the app is; with the Developer ID and notarised when the app is). The
  hardened runtime needs no extra entitlements: no JIT.
- **Linux:** x64, built against an old glibc (as old as the AppImage supports),
  in the AppImage, the `.deb` and the Arch package.
- **Signing:** the Windows app isn't signed today and the Mac app is signed ad
  hoc; the engine is signed the same way as its app, and moves with it when the
  apps get real certificates. A DLL or addon next to the app is seen by
  antivirus and Gatekeeper too, so signing it matters as much as the app.
- **CI:** Rust builds are slow cold (~5 min); cached (`rust-cache`) and rebuilt
  only when `engine/` changes, otherwise the last build's binaries are used.
  Builds follow CLAUDE.md as now: pull requests build Windows only.
- **Licences:** libheif and libde265 are LGPL, linked as their own library (as
  the WebAssembly one is kept as its own file today). LibRaw is LGPL/CDDL. On
  the Mac, HEIC goes through the system's ImageIO (hardware HEVC) instead.

### How it fits the lighter desktop app

The engine doesn't depend on the host, and it should come **before** the host
changes, because it helps that move:

- **Tauri (#165):** the engine links straight in, in the host's process; the
  URLs (path 2) are #165's custom scheme, the commands Tauri commands, files
  read by path. Nothing in `app/` changes. This plan and #165 have the same
  shape; the one addition here is the optional decode helper (above).
- **A system web view** (WebView2 stays on Windows; WKWebView on the Mac;
  WebKitGTK on Linux): Electron was picked for the Mac because only Chromium has
  the File System Access API (PLAN.md, Decisions). An engine that reads, writes,
  lists and watches folders itself can stand in for it, so the page needs it
  less. Planning the engine's file side with that in mind is what would make
  WKWebView and WebKitGTK possible. And WebKitGTK's own graphics are the
  weakest of the three, so the engine doing the heavy work matters most there.
- So: **the engine first, then decide the host,** with the engine's numbers
  in hand.

### The web

- Keeps today's code (WebGL2, the WebAssembly codecs). Nothing is taken away.
- **Later, a lighter WebAssembly build** of the same core for what JavaScript is
  worst at: Detail (SIMD, in a worker: expected several times faster than
  today's JS), RAW development. Not the decoders (the browser's own JPEG decode
  is already native), and not the native file side.
- Where the web lacks something, it gets a feature name and a "browser" row in
  `docs/platforms.md`. Proposed, added only when each is built:
  - `engine`: the native engine (Windows ✓ Mac ✓ Linux ✓ web —, *browser:
    native code; the web keeps today's code*). The page asks
    `Host.has('engine')` to choose the path, never the platform.
  - `rawDevelop`: full RAW development from the sensor data (the apps first;
    the web when the WebAssembly build has it).
  - `fullSizePaint`: Paint layers at the photo's full size, past 3000 px (the
    apps; the web keeps 3000 px, a browser's canvas and memory limit).

## The order, and what to expect

Estimates, from the numbers above and what these libraries do elsewhere; each
phase is measured before and after on Windows first, then the Mac.

| Phase | What | Expected gain | Size |
|---|---|---|---|
| **0** | Measure on the owner's Windows PC and a Mac: the grid test, an Adjust/Export/Paint test (`test/engine-speed.perf.js`, from the script used for this plan), and the parity scenes. No engine yet. | The real baseline | small |
| **1** | **Decoding and thumbnails** (Windows first, then Mac and Linux): the engine DLL/addon, the bridge commands, `/engine/` URLs, the engine's thumbnail cache. JPEG scaled decode, HEIC (libheif native, multi-threaded; ImageIO on the Mac), TIFF, JPEG XL, AVIF, WebP; RAW previews; EXIF orientation. Every core used, not 4 workers. | Cold JPEG thumbnails **~4–8× faster** (12.6 s → ~2–3 s for 400); HEIC without a thumbnail **~5–10×** (0.9 s → ~0.1–0.2 s each); opening a HEIC or TIFF in the viewer as fast as a JPEG; first screen of thumbnails under 1 s cold | large |
| **2** | **Adjust at full size:** Export, Save edits and Convert done by the engine file to file, with Detail, masks, spots, effects and the paint layers on the GPU. The 1:1 view from the engine. | Export of 24 MP with Detail **from seconds to well under 1 s**; Save edits on a selection of 100 photos in the background, every core | large |
| **3** | **Adjust's working copy from the engine:** the right size for the screen and zoom (no 2560 cap; zoomed in, the photo's own pixels), with Detail done, so Detail shows live at every zoom. The sliders stay on WebGL2. | Detail and 1:1 everywhere, live | medium |
| **4** | **RAW development** (`rawDevelop`): demosaic the sensor data (LibRaw or rawler), white balance and highlight recovery from the raw, into Adjust. | A new capability, not a speed-up | large |
| **5** | **Paint on the engine** (`fullSizePaint`): tiled layers at full size on the GPU, undo by tiles (no read-backs), the pro update's filters (blur, liquify, healing) as GPU passes. Only after Phase 0 shows where Paint's latency is with a pen. | Full-size layers; filters live on 24 MP | large |
| **6** | Optional: the web's WebAssembly build (Detail, RAW); a native GPU view under the page if frame copies show up in the numbers; the lighter desktop app with the engine inside. | | — |

**Every slice, in every phase:**

- ships behind a feature name (`Host.has('engine')` first, then the ones above
  as they come), with its row in `docs/platforms.md` and its line at the top of
  `app/host.js`;
- keeps today's JavaScript as the fallback: an app without the engine, or an
  engine that fails, works exactly as now (and the web runs it);
- comes with before-and-after numbers from the same tests, on Windows first,
  in its pull request.

Each phase is its own pull request into `beta` (or a few). The desktop apps
come first; the web follows only where a WebAssembly/WebGPU build is worth it.

**Who does it:** Phases 1–3 touch the shared files (`src/`, `mac/`,
`app/host.js`, `app/script.js` for the grid, `app/develop.js` and
`app/export.js` for Adjust). Phase 1 is the Photos agent's ground (the grid and
viewer), Phases 2–4 the Adjust agent's, Phase 5 the Paint agent's. The engine
itself (`engine/`) is new and shared. Each phase checks the open PRs first, as
CLAUDE.md says.

## Risks

- **Two definitions of Adjust drift apart** (the page's WebGL and the engine's
  WGSL): the parity test in CI on every app; later one definition in Rust,
  compiled to WebAssembly for the page.
- **Build time and CI minutes:** Rust adds a toolchain and minutes to every app
  build. Cached, rebuilt only when `engine/` changes; T-max to watch it.
- **A second program to ship and sign:** the installer, the portable zip, the
  Mac app's signing and notarisation, the Linux packages and their tests all
  take it in. More moving parts in every release.
- **Native decoders on customers' files:** a crash or a hang on a bad file,
  in the app's process. Our code is Rust; the C decoders are fuzzed in CI, and
  can be moved into the helper program if real files crash them.
- **GPU drivers:** wgpu on old Intel graphics or a VM can fail; the engine falls
  back to the CPU (SIMD Rust, still much faster than JavaScript), and the app to
  today's code.
- **HEVC:** decoding HEIC with libde265 is what jEditor already does in
  WebAssembly, so nothing changes there; the Mac uses the system's decoder.
- **Effort:** this is the biggest change since the Mac app. Phase 1 alone is
  several PRs. The gains are mostly in the cold grid, HEIC, Export and Detail;
  warm folders, scrolling and the live sliders are already fast and won't change
  much.

## For the owner to decide

1. **Go for Phase 0 and Phase 1** (measure on your Windows PC, then decoding and
   thumbnails on Windows first)?
2. **The engine inside the app** (as #165 has it; recommended), with the risky
   C decoders moved to a helper program only if real files crash them?
3. **The lighter desktop app waits** until Phase 1–2's numbers are in, and is
   decided with them?
4. **Licences:** fine to ship libheif/libde265 (as now) and LibRaw (LGPL) as
   native libraries?
