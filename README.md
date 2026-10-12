# jEditor

A photo viewer for rotating, cropping and straightening folders of photos, built for working through scan orders, as a Windows app. It edits the files on your disk directly. How to use it: [docs/using-jeditor.md](docs/using-jeditor.md).

It started as a web app ([xmui/jEditor](https://github.com/xmui/jEditor), now retired; its history is here too). As an app it also:

- **installs without admin rights.** It goes into your own user folder, like many apps do.
- **opens folders without asking for permission.** There's no "Let site edit files?" prompt, not even for a recent order after a restart.
- **uses Windows' own folder picker,** which opens where you picked the last folder, so the next order is a click away.
- **opens a folder given to it,** for example `jEditor.exe "D:\Orders\Smith"`.

## Installing

Download **jEditor-Setup-x.y.z.exe** from [Releases](../../releases) and run it. It installs for you only, in `%LOCALAPPDATA%\Programs\jEditor`, with a Start menu shortcut. It doesn't ask for admin rights.

The first time, Windows may say "Windows protected your PC", because the app isn't signed. Click **More info**, then **Run anyway**. It only asks once.

To update, run the newer setup. To uninstall, use Settings → Apps. jEditor's settings and recent orders are kept in `%LOCALAPPDATA%\jEditor` either way.

There's also a **portable** zip. Unzip it anywhere and run `jEditor.exe`, with nothing to install.

jEditor needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11 and up-to-date Windows 10. If it's missing, jEditor offers to download it from Microsoft. It installs without admin rights too.

## Changing the look

The UI is plain HTML, CSS and JavaScript: the `app` folder here, shipped beside `jEditor.exe`. Colours, type and spacing are in `app/tokens.css`. Changing the UI never needs the exe to be rebuilt. To try a change:

```
jEditor.exe --ui C:\path\to\jeditor-windows\app
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
- `app/`: the UI. It ships beside the exe.
- `docs/`: how to use jEditor, and the plan from its web app days.
- `installer/jEditor.iss`: the per-user installer (Inno Setup).

## Building

On Windows, with the .NET 8 SDK and [Inno Setup 6](https://jrsoftware.org/isdl.php):

```
git clone https://github.com/xmui/jeditor-windows
cd jeditor-windows
./scripts/build.ps1            # dist\: publish\, the portable zip and the setup
./scripts/smoke-test.ps1       # the built app opens a folder and saves a rotation
```

`npm test` runs the tests in headless Chrome, on any OS: the bridge's, then the UI's (sorting, rotation, crop, flags, folders and much more). Set `CHROME_PATH` if Chrome isn't found. The project also compiles on Linux and macOS (`dotnet build src`), which is handy for checking a change, but it only runs on Windows.

Every push builds on GitHub Actions: the tests, then on Windows the build, the smoke test and an install/uninstall test. The setup and the zip from each run are on the run's page under **Artifacts**.

### Releasing

```
npm run bump 1.x.y     # sets the version in app/version.js, package.json and package-lock.json
```

Add what changed to the top of `app/changelog.js`: it's what the app shows under **What's new**, and the release notes. The tests fail if the current version has no entry. When the bump lands on `main`, the Release workflow builds, tests and publishes the setup and the zip as release `v1.x.y`. Running Release by hand from the Actions tab releases the current version again as `v1.x.y-2` (for a fix to the Windows side alone).

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
