# Platforms: what runs where, and how we decide

jEditor is one web app (`app/`) in four places: the Windows app (`src/`), the Mac and Linux apps (`mac/`, one Electron host), and a browser. This page is the record of what each one has. `test/parity.test.js` checks the table below against the code on every `npm test`, so the table can't drift from what the apps actually do.

## How we decide

1. **Every feature is for every platform unless there's a reason it can't be.** Windows comes first (the lab runs it), so a feature is made and tested there, then brought to the others.
2. **A feature is exclusive only for one of three reasons**, and its row in the table gives it:
   - **system**: only that system has the thing, such as Mica, Liquid Glass, Quick Access, or the Mac's privacy settings. These stay exclusive by design.
   - **not yet**: it needs native work that hasn't been done for the other systems, such as a scanner, a camera or disc burning. The **Gaps** section below says what it would take to bring each one over.
   - **browser**: a browser can't do it (paths on disk, its own windows, the system's bin).
3. **Code asks for the feature, never the platform.** The app lists what it has in `JEditorNative.features` (`src/bridge.js`, `mac/bridge.js`), the page asks `Host.has('feature')` or marks the element `data-needs="feature"`, and an app without it never shows it (`app/host.js`). Checking `Host.platform()` or `Host.mac()` is only for wording and feel: the names of things, the keys, how a trackpad scrolls.
4. **Every pull request that adds a feature says which platforms it's for.** An exclusive one gets a feature name, a row here, and an entry in the comment at the top of `app/host.js`. Otherwise `npm test` fails.
5. **Build and try it where it's for.** Pull requests build Windows only. Add the `build:mac` or `build:linux` label when the change is for those too (see `CLAUDE.md`).

## Features an app may have

Checked by `test/parity.test.js`: each ✓ must match the app's `features` list, and any other cell means that app doesn't list it. A row whose feature isn't in this build yet (it's coming in a beta) is skipped until it is.

| Feature | What | Windows | Mac | Linux | Web | Why exclusive |
|---|---|:-:|:-:|:-:|:-:|---|
| `reveal` | Show in Explorer / Finder / Files | ✓ | ✓ | ✓ | | browser |
| `places` | Sidebar: projects, pinned folders, drives | ✓ | ✓ | ✓ | | browser |
| `windows` | Several windows, Split, moving photos between them | ✓ | ✓ | ✓ | | browser |
| `updates` | Finds and installs a new version | ✓ | ✓ | ✓ | always current | browser (the web is always current) |
| `recycle` | Deleted photos go to the system's bin, and Ctrl+Z brings them back | ✓ | | | | not yet on Mac and Linux; browser |
| `scan` | Scanning into the project (TWAIN, WIA) | ✓ | | | | not yet on Mac and Linux; browser |
| `camera` | Tethered shooting | ✓ | | | | not yet on Mac and Linux; browser |
| `log` | The app's log, in Settings | ✓ | | | | not yet on Mac and Linux; browser |
| `burn` | Burning a project onto a CD or DVD | ✓ | | | | not yet on Mac and Linux; browser |
| `themes` | Themes in Settings → Appearance (an experiment in betas), with their own title bar | ✓ | ✓ | ✓ | | browser (by choice: the web keeps today's look) |
| `quickAccess` | Explorer's Quick Access in the sidebar's Pinned | ✓ | | | | system |
| `backdrop` | Mica or Acrylic behind the window | ✓ | | | | system |
| `permissions` | The Mac's privacy settings jEditor needs, in one window | | ✓ | | | system |

Linux updates cover the AppImage, the `.deb` and the Arch package. The Mac app also has the macOS 26 native toolbar (Liquid Glass, `mac/native/`), which is the Mac host's own and not a page feature.

## The same everywhere

Settings → Glass → Liquid bends what's under the glass where the page's web engine can draw an SVG filter behind an element: Chromium, so the Windows app (WebView2), the Mac and Linux apps (Electron), Chrome and Edge. Safari and Firefox get the same glass unbent. It isn't an app feature, so it has no row: `app/liquid.js` asks the browser.

These don't depend on the app, so every platform has them: viewing, rotating, cropping and Auto crop, flags, rename, move, duplicates, import from a card, Save edits when done, and export. Adjust and Paint, and the experiments in **Settings → Experimental**, are the same everywhere too.

Some things work everywhere but are kept in a different place:

- **A project's data** (flags, edits, the thumbnail cache, Auto crop's originals): in the apps it's kept in jEditor's own storage (`dataDir`). In a browser it's kept in a `.jeditor` folder inside the project (`app/folder-cache.js`).
- **Auto crop's test scans:** the app's storage, or the browser's private storage.

## Only on the web

| What | Where | Why |
|---|---|---|
| Open photos without a folder, and Save through the share sheet (iPhone, iPad, Android, Firefox) | `app/picked.js` | Those browsers can't open folders. The apps can, so they don't need this. |
| Install as an app (Chrome on Android; Add to Home Screen on iPhone) | `app/start.js` | The apps are installed already. |

## Gaps: not yet, to decide

Each of these is exclusive only because nobody has built it for the other systems yet. Here's roughly what each would take.

| Gap | Mac | Linux | Size |
|---|---|---|---|
| `recycle` | Electron's `shell.trashItem` moves a photo to the Trash. Ctrl+Z also needs to find it there and put it back. | The same, to the desktop's trash (freedesktop). | small |
| `log` | The Electron host writes a log file, and the page shows it as on Windows. | The same. | small |
| Pinned from the system (like `quickAccess`) | Finder's sidebar favourites can't be read easily, so probably not. | GTK bookmarks (`~/.config/gtk-3.0/bookmarks`) | small (Linux) |
| `burn` | `drutil` / `hdiutil burn` | `xorriso` / `growisofs` | medium |
| `scan` | ImageCaptureCore, for scanners with a Mac (ICA) driver | SANE | large |
| `camera` | gphoto2, or the camera maker's SDK | gphoto2 | large |

When one of these is closed, its row above gets a ✓ in that column, and the test checks it.
