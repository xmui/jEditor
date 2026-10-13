# jEditor: plan

## Why a Windows app, and why it can work without admin

The lab has one Windows PC (an Epson FastFoto FF-680W and a Plustek OpticBook A300). The web app worked there but had limits a browser can't get past: permission prompts, no way to look up from a folder to its order, a `.jeditor` folder that isn't really hidden, no Recycle Bin, and no scanning. See "Native Windows app and in-app scanning" in [docs/jeditor-plan.md](docs/jeditor-plan.md) for the full list, and the lab's scanners.

**Lab PC test (2026-10-12):** MultiMC, an unsigned portable .exe, ran from the user's own folder without admin. So nothing on that PC blocks unsigned apps run from user folders (no AppLocker rule, no Smart App Control). A per-user install of jEditor runs there too. Expect at most a one-time SmartScreen "More info → Run anyway", since a new app has no reputation yet.

## How it's built

- **.NET 8 WinForms + WebView2.** Not Tauri, and not a rewrite of jEditor's ~12.6k lines. WebView2 is Edge's engine, so jEditor runs as it does in Edge. The deciding feature is `CoreWebView2Environment.CreateWebFileSystemDirectoryHandle` (stable since WebView2 SDK 1.0.2651.64; pinned at 1.0.4258.31): the app makes a real `FileSystemDirectoryHandle` for any path, with edit permission already granted, and posts it to the page. jEditor's File System Access code then works unchanged, with no permission prompts. C# also has NTwain for TWAIN scanning, and easy access to the Recycle Bin, Explorer's thumbnails and the rest of Windows.
- **One repo.** It started with jEditor (the web app, xmui/jEditor) as a submodule; on 2026-10-12 the UI moved in, with its history, and the web app was retired. Its old plan is in [docs/jeditor-plan.md](docs/jeditor-plan.md). The UI is still standard web code: `src/bridge.js` runs before it and replaces `showDirectoryPicker`. The bridge relies on the `app` object (`openDirectory`, `files`, `rotateImage`, `isLoading`) for opening a folder from the command line and for the smoke test, and on `data-theme` on `<html>` for the title bar. The UI's tests (`test/ui.test.js`) still run it in Chrome.
- **The UI ships as files.** The `app` folder sits beside the exe, so a UI change never needs a rebuild. `--ui <folder>` runs the UI from a checkout in dev mode, where CSS changes show live.
- **No admin anywhere.** It's a self-contained exe, because a shared .NET runtime would need admin to install. The installer is Inno Setup with `PrivilegesRequired=lowest`: `%LOCALAPPDATA%\Programs\jEditor`, the user's Start menu, and the uninstall entry in HKCU. CI checks nothing lands in Program Files or HKLM.
- **Origin `https://jeditor.example/`, fixed.** IndexedDB and localStorage (settings, recent orders, the flags cache) are stored under it.

## Phases

1. **Done (this PR): the shell.** The window, the folder picker and handle bridge, dev mode, remembered window position, a dark or light title bar, opening a folder from the command line, the per-user installer and portable zip, and CI with a smoke test on real Windows. Still to try on the lab PC (see the checklist in the PR).
2. **Recent orders by path, and orders found from any folder.** Store the path of each opened folder, so a subfolder of an order can be recognised even when the order isn't on the Recent list. Recent orders reopen from the path, so they keep working after the WebView2 profile is reset.
3. **Real Recycle Bin.** Delete to the Recycle Bin instead of `.jeditor/trash` (Ctrl+Z still restores). Make `.jeditor` truly hidden (the Hidden attribute).
4. **Faster thumbnails.** Use Explorer's thumbnail cache, or decode on every CPU core in the app. Measure first with jEditor's debug console (`Ctrl+Shift+D`) on a big real order: native helps most if the time goes on thumbnails and reading files, especially on network drives.
5. **Scanning in jEditor (TWAIN).** Checked on the lab PC: both scanners have 64-bit TWAIN drivers (`C:\Windows\twain_64\escndv2` and `Plustek`), and the lab doesn't use any FastFoto-app extras, so Epson Scan 2 covers it. Built (1.20.0) on NAPS2.Sdk (LGPL-2.1, its DLLs beside the exe): Scan in the toolbar → scanner, folder, names → the scanner's own window → each photo saved into the order as it arrives, named next in the folder's sequence. NAPS2's own settings mode is not used: it forces a fixed page size (Letter), which would give each photo a margin; the driver's window auto-detects each photo's size. Needs `TWAINDSM.dll` (scanner drivers install it in System32). The smoke test scans with a built-in test scanner (`--fake-scanner`). Next: per-order resolution without the driver window (our own TWAIN capability setup: auto-size, dpi, feeder, duplex), and replacing "needs rescan" photos in place.
6. **Sidebar: projects, pinned folders, drives.** Built in 1.20.0 as a Browse tab, redesigned in 1.21.0 from the lab's answers: a floating panel (Ctrl+B) with the open project's card (name, path, photos, Scan, Explorer, pin), its folders, Projects (a projects folder chosen in the app, newest first, photo counts, dates, search; recent ones from elsewhere), Pinned (jEditor's pins and Explorer's Quick Access) and This PC (drives open out in place; USB marked New, with Eject). Clicking a folder opens it as the project. No project status (not wanted). "Order" became "project" on screen.
6. **Later, if wanted.** An update check (download the new setup, run it, still no admin). A right-click "Open with jEditor" on folders (per-user, in HKCU). Code signing, to drop the SmartScreen warning.

## Things WebView2 might do differently from Chrome

Check these on the lab PC:

- Dragging a folder in: WebView2 should hand over a folder handle, as Chrome does, and the app allows editing it without a prompt.
- Watching the folder: jEditor uses `FileSystemObserver` where it exists and checks every so often otherwise. Which one runs in WebView2 depends on the Edge version installed. Either way photos from the scanner show up, just less instantly with polling.
- Recent orders after a restart: the stored handles need permission again, which the app grants without asking.
