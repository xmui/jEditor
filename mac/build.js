#!/usr/bin/env node
// Builds jEditor for Mac: dist/jEditor-<version>-mac.dmg (and the .app in
// dist/mac-universal). On a Mac, after `npm ci` here:
//
//   node build.js             universal: Apple silicon and Intel in one app
//   node build.js --dir       just the .app, for a quick try
//
// On Linux it builds jEditor for Linux instead (x64): an AppImage, which
// runs anywhere and updates itself, and a .deb (Debian, Ubuntu, Mint),
// dist/jEditor-<version>-linux.AppImage and jEditor-<version>-linux.deb,
// and a pacman package for Arch (jEditor-<version>-linux.pacman; building
// it needs bsdtar: libarchive-tools).
//
// The version is jEditor's (app/version.js). The UI (../app) goes in as
// Resources/app, so it's the same files as the Windows app's.
//
// Not signed with a Developer ID yet: the app is signed ad hoc ("-"),
// which Apple silicon needs to run it at all, and macOS asks once before
// opening it (System Settings → Privacy & Security → Open Anyway). With a
// Developer ID, set CSC_LINK / CSC_KEY_PASSWORD and APPLE_ID etc. and drop
// `identity` below to sign and notarize.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const builder = require('electron-builder');

const ROOT = path.join(__dirname, '..');
const version = /APP_VERSION = '([0-9.]+)'/.exec(fs.readFileSync(path.join(ROOT, 'app', 'version.js'), 'utf8'))[1];
const dirOnly = process.argv.includes('--dir');
const linux = process.platform === 'linux';

// The native toolbar (native/), built for both Macs if it isn't yet
const toolbarNode = path.join(__dirname, 'native', 'build', 'Release', 'toolbar.node');
if (!linux && !fs.existsSync(toolbarNode)) execFileSync(process.execPath, [path.join(__dirname, 'native', 'build.js')], { stdio: 'inherit' });

const config = {
    appId: 'com.xmui.jeditor',
    productName: 'jEditor',
    copyright: 'jEditor',
    directories: { output: path.join(ROOT, 'dist'), buildResources: path.join(__dirname, 'build') },
    files: ['main.js', 'preload.js', 'bridge.js', 'places.js', 'package.json', 'native/index.js', ...(linux ? [] : ['native/build/Release/toolbar.node'])],
    // A native module is loaded from disk, not from inside app.asar
    asarUnpack: ['native/build/Release/*.node'],
    extraResources: [{ from: path.join(ROOT, 'app'), to: 'app', filter: ['**/*'] }],
    // The Linux packages are called jeditor (apt remove jeditor, pacman -R jeditor)
    extraMetadata: { version, ...(linux ? { name: 'jeditor' } : {}) },
    asar: true,
    artifactName: linux ? 'jEditor-${version}-linux.${ext}' : 'jEditor-${version}-mac.${ext}',
    mac: {
        target: dirOnly ? [{ target: 'dir', arch: ['universal'] }] : [{ target: 'dmg', arch: ['universal'] }],
        category: 'public.app-category.photography',
        icon: path.join(ROOT, 'app', 'icon.png'),
        identity: '-',
        hardenedRuntime: false,
        gatekeeperAssess: false,
        minimumSystemVersion: '12.0',
        // Already universal (native/build.js), so the same in both halves
        x64ArchFiles: '**/toolbar.node',
        extendInfo: {
            // Finder's Open With, and the Dock: folders, and photos (their folder opens)
            CFBundleDocumentTypes: [
                { CFBundleTypeName: 'Folder', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.folder'] },
                { CFBundleTypeName: 'Photo', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.jpeg', 'public.png', 'org.webmproject.webp', 'public.tiff', 'com.compuserve.gif'] }
            ]
        }
    },
    linux: {
        target: dirOnly ? [{ target: 'dir', arch: ['x64'] }] : [{ target: 'AppImage', arch: ['x64'] }, { target: 'deb', arch: ['x64'] }, { target: 'pacman', arch: ['x64'] }],
        category: 'Graphics',
        icon: path.join(ROOT, 'app', 'icon.png'),
        executableName: 'jeditor',
        synopsis: 'Edit and sort a folder of photos',
        description: 'jEditor: flag, rotate, crop and sort the photos in a folder, right where they are.',
        maintainer: 'jEditor <jeditor@users.noreply.github.com>',
        // Opens a folder (Open With in the file manager), or a photo's folder
        mimeTypes: ['inode/directory', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/gif'],
        // The running window belongs to jeditor.desktop (package.json's desktopName)
        syncDesktopName: true
    },
    deb: { packageCategory: 'graphics' },
    // What Electron needs from Arch (it brings its own ffmpeg, re2 and the rest)
    pacman: { depends: ['gtk3', 'nss', 'alsa-lib', 'libcups', 'libxss', 'mesa', 'xdg-utils'] },
    dmg: {
        title: 'jEditor ${version}',
        contents: [
            { x: 150, y: 190, type: 'file' },
            { x: 390, y: 190, type: 'link', path: '/Applications' }
        ]
    },
    publish: null
};

builder.build({ targets: (linux ? builder.Platform.LINUX : builder.Platform.MAC).createTarget(), config })
    .then(files => console.log('Built:\n' + files.map(f => '  ' + path.relative(ROOT, f)).join('\n')))
    .catch(e => { console.error(e); process.exit(1); });
