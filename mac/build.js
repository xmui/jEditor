#!/usr/bin/env node
// Builds jEditor for Mac: dist/jEditor-<version>-mac.dmg (and the .app in
// dist/mac-universal). On a Mac, after `npm ci` here:
//
//   node build.js             universal: Apple silicon and Intel in one app
//   node build.js --dir       just the .app, for a quick try
//
// The version is jEditor's (app/version.js). The UI (../app) goes in as
// Resources/app, so it's the same files as the Windows app's.
//
// Not signed with a Developer ID yet: the app is signed ad hoc ("-"),
// which Apple silicon needs to run it at all, and macOS asks once before
// opening it (System Settings → Privacy & Security → Open Anyway). With a
// Developer ID, set CSC_LINK / CSC_KEY_PASSWORD and APPLE_ID etc. and drop
// `identity` below to sign and notarize.

const fs = require('fs');
const path = require('path');
const builder = require('electron-builder');

const ROOT = path.join(__dirname, '..');
const version = /APP_VERSION = '([0-9.]+)'/.exec(fs.readFileSync(path.join(ROOT, 'app', 'version.js'), 'utf8'))[1];
const dirOnly = process.argv.includes('--dir');

const config = {
    appId: 'com.xmui.jeditor',
    productName: 'jEditor',
    copyright: 'jEditor',
    directories: { output: path.join(ROOT, 'dist'), buildResources: path.join(__dirname, 'build') },
    files: ['main.js', 'preload.js', 'bridge.js', 'places.js', 'package.json'],
    extraResources: [{ from: path.join(ROOT, 'app'), to: 'app', filter: ['**/*'] }],
    extraMetadata: { version },
    asar: true,
    artifactName: 'jEditor-${version}-mac.${ext}',
    mac: {
        target: dirOnly ? [{ target: 'dir', arch: ['universal'] }] : [{ target: 'dmg', arch: ['universal'] }],
        category: 'public.app-category.photography',
        icon: path.join(ROOT, 'app', 'icon.png'),
        identity: '-',
        hardenedRuntime: false,
        gatekeeperAssess: false,
        minimumSystemVersion: '12.0',
        extendInfo: {
            // Finder's Open With, and the Dock: folders, and photos (their folder opens)
            CFBundleDocumentTypes: [
                { CFBundleTypeName: 'Folder', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.folder'] },
                { CFBundleTypeName: 'Photo', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.jpeg', 'public.png', 'org.webmproject.webp', 'public.tiff', 'com.compuserve.gif'] }
            ]
        }
    },
    dmg: {
        title: 'jEditor ${version}',
        contents: [
            { x: 150, y: 190, type: 'file' },
            { x: 390, y: 190, type: 'link', path: '/Applications' }
        ]
    },
    publish: null
};

builder.build({ targets: builder.Platform.MAC.createTarget(), config })
    .then(files => console.log('Built:\n' + files.map(f => '  ' + path.relative(ROOT, f)).join('\n')))
    .catch(e => { console.error(e); process.exit(1); });
