# jEditor for Windows: plan

## Why a Windows app, and why it can work without admin

The lab has one Windows PC (an Epson FastFoto FF-680W and a Plustek OpticBook A300). The web app works there but has limits a browser can't get past: permission prompts, no way to look up from a folder to its order, a `.jeditor` folder that isn't really hidden, no Recycle Bin, and no scanning. See the "native Windows app and in-app scanning" notes in jEditor's PLAN.md for the full list.

**Lab PC test (2026-10-12):** MultiMC, an unsigned portable .exe, ran from the user's own folder without admin. So nothing on that PC blocks unsigned apps run from user folders (no AppLocker rule, no Smart App Control). A per-user install of jEditor runs there too. Expect at most a one-time SmartScreen "More info → Run anyway", since a new app has no reputation yet.

## How it's built

- **.NET 8 WinForms + WebView2.** Not Tauri, and not a rewrite of jEditor's ~12.6k lines. WebView2 is Edge's engine, so jEditor runs as it does in Edge. The deciding feature is `CoreWebView2Environment.CreateWebFileSystemDirectoryHandle` (stable since WebView2 SDK 1.0.2651.64; pinned at 1.0.4258.31): the app makes a real `FileSystemDirectoryHandle` for any path, with edit permission already granted, and posts it to the page. jEditor's File System Access code then works unchanged, with no permission prompts. C# also has NTwain for TWAIN scanning, and easy access to the Recycle Bin, Explorer's thumbnails and the rest of Windows.
- **A separate repo, with jEditor as a submodule.** jEditor itself has no changes for this: `src/bridge.js` runs before jEditor's scripts and replaces `showDirectoryPicker`. The only things it relies on in jEditor are the `app` object (`openDirectory`, `files`, `rotateImage`, `isLoading`) for opening a folder from the command line and for the smoke test, and `data-theme` on `<html>` for the title bar.
- **The UI ships as files.** The `app` folder sits beside the exe, so a UI change never needs a rebuild. `--ui <folder>` runs the UI from a jEditor checkout in dev mode, where CSS changes show live.
- **No admin anywhere.** It's a self-contained exe, because a shared .NET runtime would need admin to install. The installer is Inno Setup with `PrivilegesRequired=lowest`: `%LOCALAPPDATA%\Programs\jEditor`, the user's Start menu, and the uninstall entry in HKCU. CI checks nothing lands in Program Files or HKLM.
- **Origin `https://jeditor.example/`, fixed.** IndexedDB and localStorage (settings, recent orders, the flags cache) are stored under it.

## Phases

1. **Done (this PR): the shell.** The window, the folder picker and handle bridge, dev mode, remembered window position, a dark or light title bar, opening a folder from the command line, the per-user installer and portable zip, and CI with a smoke test on real Windows. Still to try on the lab PC (see the checklist in the PR).
2. **Recent orders by path, and orders found from any folder.** Store the path of each opened folder, so a subfolder of an order can be recognised even when the order isn't on the Recent list. Recent orders reopen from the path, so they keep working after the WebView2 profile is reset.
3. **Real Recycle Bin.** Delete to the Recycle Bin instead of `.jeditor/trash` (Ctrl+Z still restores). Make `.jeditor` truly hidden (the Hidden attribute).
4. **Faster thumbnails.** Use Explorer's thumbnail cache, or decode on every CPU core in the app. Measure first with jEditor's debug console (`Ctrl+Shift+D`) on a big real order: native helps most if the time goes on thumbnails and reading files, especially on network drives.
5. **Scanning in jEditor (TWAIN).** First de-risk on the lab PC (~30 minutes): install NAPS2 (free) and scan from each scanner through its TWAIN driver. Watch for Epson Scan 2's TWAIN popping up its own window or batch-scanning slowly, and for the Plustek driver being 32-bit only (it would then need a 32-bit helper process). Then: per-order scan settings, naming at scan time, and replacing "needs rescan" photos in place.
6. **Later, if wanted.** An update check (download the new setup, run it, still no admin). A right-click "Open with jEditor" on folders (per-user, in HKCU). Code signing, to drop the SmartScreen warning.

## Things WebView2 might do differently from Chrome

Check these on the lab PC:

- Dragging a folder in: WebView2 should hand over a folder handle, as Chrome does, and the app allows editing it without a prompt.
- Watching the folder: jEditor uses `FileSystemObserver` where it exists and checks every so often otherwise. Which one runs in WebView2 depends on the Edge version installed. Either way photos from the scanner show up, just less instantly with polling.
- Recent orders after a restart: the stored handles need permission again, which the app grants without asking.
