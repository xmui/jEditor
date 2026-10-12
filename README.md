# jEditor for Windows

[jEditor](https://github.com/xmui/jEditor) as a Windows app. It's the same jEditor, with the same look and the same features, in its own window. It also:

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

The UI is jEditor's own HTML and CSS: the `app` folder beside `jEditor.exe`. Colours, type and spacing are in `app/tokens.css`. Changing the UI never needs the exe to be rebuilt. To try a change:

```
jEditor.exe --ui C:\path\to\jEditor\app
```

That runs the UI from that folder in **dev mode**:

- saving a `.css` file restyles the window at once, keeping the open folder
- saving any other file reloads the page
- `F5` or `Ctrl+R` reloads, and `F12` opens DevTools

A Debug build (`dotnet run --project src`) does this on its own with the `jeditor` submodule's UI. `JEDITOR_UI=<folder>` does the same as `--ui`.

The UI comes from jEditor, so changes to it belong there. This repo picks up a new jEditor by moving the `jeditor` submodule:

```
git -C jeditor pull origin main
git add jeditor && git commit -m "jEditor x.y.z"
```

When that lands on `main`, a release with the new version is made by itself. A fix to the Windows app alone is released from the Actions tab (Release → Run workflow).

## How it works

- `src/`: a small .NET 8 WinForms app hosting WebView2, Edge's engine. It serves the `app` folder at `https://jeditor.example/`. That address must never change, because jEditor's settings and recent orders are stored under it.
- `src/bridge.js`: runs in the page before jEditor does. It replaces the browser's folder picker with Windows' own, and the app hands the page a real folder handle made by WebView2 (`CreateWebFileSystemDirectoryHandle`), with permission to edit already granted. jEditor's file code runs unchanged; it doesn't know it's in an app. The bridge also turns off the service worker, reports the theme for the title bar, and runs dev mode and the smoke test.
- `jeditor/`: jEditor itself, as a git submodule. Its `app` folder ships beside the exe.
- `installer/jEditor.iss`: the per-user installer (Inno Setup).

## Building

On Windows, with the .NET 8 SDK and [Inno Setup 6](https://jrsoftware.org/isdl.php):

```
git clone --recurse-submodules https://github.com/xmui/jeditor-windows
cd jeditor-windows
./scripts/build.ps1            # dist\: publish\, the portable zip and the setup
./scripts/smoke-test.ps1       # the built app opens a folder and saves a rotation
```

`npm test` runs the bridge's tests in headless Chrome (any OS). The project also compiles on Linux and macOS (`dotnet build src`), which is handy for checking a change, but it only runs on Windows.

Every push builds on GitHub Actions: the bridge tests, then on Windows the build, the smoke test and an install/uninstall test. The setup and the zip from each run are on the run's page under **Artifacts**.

### Command line

| | |
|---|---|
| `jEditor.exe [folder]` | open that folder (given a photo: its folder) |
| `--ui <folder>` | run the UI from that folder, in dev mode |
| `--log <file>` | write a log |
| `--smoke-test <folder>` | open the folder, rotate a photo, check it's saved, then exit 0 (passed) or 1 (failed) |
| `--user-data <folder>` | a different WebView2 profile |

See [PLAN.md](PLAN.md) for what's next.
