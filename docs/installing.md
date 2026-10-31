# Installing jEditor

The short version is in the [README](../README.md#get-it). This is the rest: where things go, first-run warnings, updating and removing.

## Windows

Download **jEditor-Setup-x.y.z.exe** from [Releases](https://github.com/xmui/jEditor/releases) and run it. It installs for you only, in `%LOCALAPPDATA%\Programs\jEditor`, with a Start menu shortcut. It doesn't ask for admin rights.

The first time, Windows may say "Windows protected your PC", because the app isn't signed. Click **More info**, then **Run anyway**. It only asks once.

Releases up to 1.35.1 are also in [xmui/jeditor-windows](https://github.com/xmui/jeditor-windows/releases), where the Windows app lived from 1.18.1 to 1.35.1; 1.35.1 and later look for updates here.

To update, use Settings → Updates, or run the newer setup. To uninstall, use Settings → Apps. jEditor's settings and recent orders are kept in `%LOCALAPPDATA%\jEditor` either way, and what it stores for each order (flags, edits, thumbnails) in a hidden `.jeditor-app` folder in your user folder (it was in `%LOCALAPPDATA%\jEditor\orders` until 1.50.1, and moves across by itself).

There's also a **portable** zip. Unzip it anywhere and run `jEditor.exe`, with nothing to install.

jEditor needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11 and up-to-date Windows 10. If it's missing, jEditor offers to download it from Microsoft. It installs without admin rights too.

## Mac

Download **jEditor-x.y.z-mac.dmg** from [Releases](https://github.com/xmui/jEditor/releases), open it and drag jEditor into Applications. It runs on Apple silicon and Intel Macs, macOS 12 or later.

Or with [Homebrew](https://brew.sh) (this repo is the tap):

```
brew tap xmui/jeditor https://github.com/xmui/jEditor
brew install --cask xmui/jeditor/jeditor
```

`brew upgrade --cask jeditor` updates it, and every release updates the cask (`Casks/jeditor.rb`).

It isn't signed by Apple yet, so the first time macOS won't open it. Go to **System Settings → Privacy & Security**, find "jEditor was blocked", and click **Open Anyway**. It only asks once.

To update, use Settings → Updates: jEditor downloads the new .dmg, checks it against GitHub's SHA-256, puts the new app in place of itself and opens again. No Apple Developer ID is needed: the new app is checked whole first (`codesign --verify`), and it never went through a browser, so macOS doesn't ask about it again (the first copy, from the website, still goes through Gatekeeper and Open Anyway). That needs jEditor in Applications (or another folder you can write to); run from Downloads or the .dmg, it opens the .dmg in Finder instead, to drag in. Because jEditor isn't signed with a Developer ID, macOS may ask again for Desktop, Documents and Downloads after an update. Or `brew upgrade`. jEditor's settings, recent folders and each project's flags and cache are kept in `~/Library/Application Support/jEditor`, never in your folders.

## Linux

From the [latest release](https://github.com/xmui/jEditor/releases/latest), for 64-bit Linux:

- **AppImage** (any distribution): download `jEditor-x.y.z-linux.AppImage`, make it executable (`chmod +x`, or Properties → Permissions in your file manager) and open it. Settings → Updates replaces it with the new version and restarts. It needs FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04 if it won't start).
- **.deb** (Debian, Ubuntu, Mint): `sudo apt install ./jEditor-x.y.z-linux.deb`. It's then in your applications, and in Open With for folders and photos. Settings → Updates downloads the new .deb and installs it (your password is asked for), then reopens jEditor; without the password, the .deb opens in your software installer instead.
- **Arch Linux** (and Manjaro, EndeavourOS): `sudo pacman -U jEditor-x.y.z-linux.pacman`. The same as the .deb: Settings → Updates installs the new one with `pacman -U` (your password is asked for), and `sudo pacman -R jeditor` removes it.

jEditor's settings and each project's data are kept in `~/.config/jEditor`, never in your folders. USB drives and cards mounted in `/media` or `/run/media` show in the sidebar under Locations.
