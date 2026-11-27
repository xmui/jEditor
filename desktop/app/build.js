#!/usr/bin/env node
// Builds jEditor Tauri (this folder): the Mac app on the system's own web
// view, built on betas beside the Electron one (docs/plans/lighter-desktop.md,
// step 3). On a Mac, with Rust (rustup):
//
//   node desktop/app/build.js      universal (Apple silicon and Intel):
//                                  dist/jEditor-<version>-mac-tauri.dmg, and
//                                  the app in dist/mac-tauri/jEditor Tauri.app
//
// On Linux it builds just the program, dist/linux-tauri/jeditor, for the
// smoke test (the Linux packages come with step 4).
//
// The version is jEditor's (app/version.js); the UI (../../app) goes in as
// Resources/app, the same files as the other apps'. Signed ad hoc ("-"),
// as the Electron app is.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const version = /APP_VERSION = '([0-9.]+)'/.exec(fs.readFileSync(path.join(ROOT, 'app', 'version.js'), 'utf8'))[1];
const CLI = '@tauri-apps/cli@2.12.4';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: __dirname, ...opts });
fs.mkdirSync(DIST, { recursive: true });

if (process.platform === 'darwin') {
    run('rustup', ['target', 'add', 'aarch64-apple-darwin', 'x86_64-apple-darwin']);
    run('npx', ['--yes', CLI, 'build', '--target', 'universal-apple-darwin', '--bundles', 'app,dmg', '--config', JSON.stringify({ version })]);
    const bundle = path.join(__dirname, 'target', 'universal-apple-darwin', 'release', 'bundle');
    const dmg = fs.readdirSync(path.join(bundle, 'dmg')).find(n => n.endsWith('.dmg'));
    const out = path.join(DIST, `jEditor-${version}-mac-tauri.dmg`);
    fs.copyFileSync(path.join(bundle, 'dmg', dmg), out);
    const app = path.join(DIST, 'mac-tauri', 'jEditor Tauri.app');
    fs.rmSync(app, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(app), { recursive: true });
    run('ditto', [path.join(bundle, 'macos', 'jEditor Tauri.app'), app]);
    console.log('Built:\n  ' + path.relative(ROOT, out) + '\n  ' + path.relative(ROOT, app));
} else {
    run('cargo', ['build', '--release', '--locked']);
    const out = path.join(DIST, 'linux-tauri', 'jeditor');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'target', 'release', 'jeditor'), out);
    fs.chmodSync(out, 0o755);
    console.log('Built:\n  ' + path.relative(ROOT, out));
}
