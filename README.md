# jEditor

A photo viewer for rotating, cropping and straightening folders of photos, built for working through scan orders. It edits the files on your disk directly; nothing is uploaded. How to use it: [docs/using-jeditor.md](docs/using-jeditor.md).

One UI (`app/`), three ways to run it:

| | Status | What it has |
|---|---|---|
| **Windows app** | Released | Everything: the core below, plus scanning, camera tethering, the projects sidebar with drives, the Recycle Bin, several windows and updates. |
| **Web** | https://xmui.github.io/jEditor/, and `standalone.html` with each release | The core, in Chrome or Edge: open, view, rotate, crop and straighten, flags, search, rename, move, delete with undo, export, duplicates, Auto crop and watching the folder. |
| **Mac app** | Released (not signed by Apple yet) | The core, with no permission prompts, the Mac's own folder picker, folders opened from Finder (Open With, or onto the Dock icon) and Show in Finder; the sidebar (projects, pinned folders, drives, Eject), several windows and Split, updates, and Liquid Glass (on macOS 26, the Mac's own toolbar). Not yet: scanning, the camera, the Trash. |

[PLAN.md](PLAN.md) has how the three fit together and what comes next. Scanning and tethering are Windows-only for now.

The Windows app also:

- **installs without admin rights.** It goes into your own user folder, like many apps do.
- **opens folders without asking for permission.** There's no "Let site edit files?" prompt, not even for a recent order after a restart.
- **uses Windows' own folder picker,** which opens where you picked the last folder, so the next order is a click away.
- **opens a folder given to it,** for example `jEditor.exe "D:\Orders\Smith"`.

## Installing on Windows

Download **jEditor-Setup-x.y.z.exe** from [Releases](../../releases) and run it. It installs for you only, in `%LOCALAPPDATA%\Programs\jEditor`, with a Start menu shortcut. It doesn't ask for admin rights.

The first time, Windows may say "Windows protected your PC", because the app isn't signed. Click **More info**, then **Run anyway**. It only asks once.

Releases up to 1.35.1 are also in [xmui/jeditor-windows](https://github.com/xmui/jeditor-windows/releases), where the Windows app lived from 1.18.1 to 1.35.1; 1.35.1 and later look for updates here.

To update, use Settings → Updates, or run the newer setup. To uninstall, use Settings → Apps. jEditor's settings and recent orders are kept in `%LOCALAPPDATA%\jEditor` either way.

There's also a **portable** zip. Unzip it anywhere and run `jEditor.exe`, with nothing to install.

jEditor needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11 and up-to-date Windows 10. If it's missing, jEditor offers to download it from Microsoft. It installs without admin rights too.

## Installing on a Mac

Download **jEditor-x.y.z-mac.dmg** from [Releases](../../releases), open it and drag jEditor into Applications. It runs on Apple silicon and Intel Macs, macOS 12 or later.

Or with [Homebrew](https://brew.sh) (this repo is the tap):

```
brew tap xmui/jeditor https://github.com/xmui/jEditor
brew install --cask xmui/jeditor/jeditor
```

`brew upgrade --cask jeditor` updates it, and every release updates the cask (`Casks/jeditor.rb`).

It isn't signed by Apple yet, so the first time macOS won't open it. Go to **System Settings → Privacy & Security**, find "jEditor was blocked", and click **Open Anyway**. It only asks once.

To update, use Settings → Updates (it downloads the new .dmg and opens it: drag jEditor into Applications again), or `brew upgrade`. jEditor's settings, recent folders and each project's flags and cache are kept in `~/Library/Application Support/jEditor`, never in your folders.

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

## How it works

- `src/`: a small .NET 8 WinForms app hosting WebView2, Edge's engine. It serves the `app` folder at `https://jeditor.example/`. That address must never change, because jEditor's settings and recent orders are stored under it.
- `src/bridge.js`: runs in the page before jEditor does. It replaces the browser's folder picker with Windows' own, and the app hands the page a real folder handle made by WebView2 (`CreateWebFileSystemDirectoryHandle`), with permission to edit already granted. The UI's file code is standard web code (the File System Access API), so it also runs in Chrome and in the tests. The bridge also turns off the service worker, reports the theme for the title bar, and runs dev mode and the smoke test.
- `src/Scanner.cs`: scanning into the open order with [NAPS2.Sdk](https://github.com/cyanfish/naps2) (LGPL-2.1; its DLLs and license ship beside the exe, not inside it, so they can be replaced). TWAIN scanners with 64-bit drivers and WIA scanners work in the app's own process; the scanner's own window sets size and resolution. TWAIN needs `TWAINDSM.dll`, which scanner drivers install in System32 (or put one in `_win64\` beside the exe). `--fake-scanner` adds a test scanner that needs no hardware.
- `app/`: the UI. It ships beside the exe.
- `docs/`: how to use jEditor, and the plan from its web app days.
- `installer/jEditor.iss`: the per-user installer (Inno Setup).
- `mac/native/`: the Mac app's native toolbar (Objective-C++, Node-API): an NSToolbar per window, drawn in Liquid Glass on macOS 26, its items mirroring the page's top row (`bridge.js`); built universal by `node mac/native/build.js` (on a Mac, after `npm ci` there).
- `mac/`: the Mac app, in Electron (Chromium, as WebView2 is). `main.js` serves the `app` folder at `app://jeditor/` (fixed, like the Windows address) and drops a folder onto the page to give it a real folder handle for any path, with permission granted; `bridge.js` takes the drop in the page, replaces the folder picker with the Mac's, and gives jEditor `JEditorNative`. The projects' data is kept in the app's private storage.

The UI never assumes Windows. Everything an app adds goes through `window.JEditorNative` (made by `src/bridge.js`), which is `null` in a browser. Each app says what it is and lists what it can do (`platform`, `features`), and `app/host.js` hides what it can't (`Host.has('scan')`, `data-needs="scan"`) and puts the system's own words into the page: Explorer or Finder, the Recycle Bin or the Trash. The UI tests run it with no app (the web), the Windows app, and an app with only the core; `test/mac.test.js` runs the real Mac app.

## Installing on Linux

From the [latest release](https://github.com/xmui/jEditor/releases/latest), for 64-bit Linux:

- **AppImage** (any distribution): download `jEditor-x.y.z-linux.AppImage`, make it executable (`chmod +x`, or Properties → Permissions in your file manager) and open it. Settings → Updates replaces it with the new version and restarts. It needs FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04 if it won't start).
- **.deb** (Debian, Ubuntu, Mint): `sudo apt install ./jEditor-x.y.z-linux.deb`. It's then in your applications, and in Open With for folders and photos. Update it by installing the new .deb.
- **Arch Linux** (and Manjaro, EndeavourOS): `sudo pacman -U jEditor-x.y.z-linux.pacman`. The same as the .deb; update it by installing the new one, and `sudo pacman -R jeditor` removes it.

jEditor's settings and each project's data are kept in `~/.config/jEditor`, never in your folders. USB drives and cards mounted in `/media` or `/run/media` show in the sidebar under Locations.

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

### Releasing

```
npm run bump 1.x.y     # sets the version in app/version.js, package.json and package-lock.json
```

Add what changed to the top of `app/changelog.js`: it's what the app shows under **What's new**, and the release notes. The tests fail if the current version has no entry. When the bump lands on `main`, the Release workflow builds, tests and publishes the setup, the zip, the Mac .dmg and `standalone.html` as release `v1.x.y`. Every push to `main` also deploys the web app (the Web app workflow), once the tests pass. Running Release by hand from the Actions tab releases the current version again as `v1.x.y-2` (for a fix to the Windows side alone).

If you change `app/icon.png`, run `node scripts/make-icons.js` (the web icons) and `python3 scripts/make-icon.py` (the exe's icon).

### Command line

| | |
|---|---|
| `jEditor.exe [folder]` | open that folder (given a photo: its folder) |
| `--ui <folder>` | run the UI from that folder, in dev mode |
| `--log <file>` | write a log |
| `--smoke-test <folder>` | open the folder, rotate a photo, check it's saved, then exit 0 (passed) or 1 (failed) |
| `--user-data <folder>` | a different WebView2 profile |

See [PLAN.md](PLAN.md) for what's next.
