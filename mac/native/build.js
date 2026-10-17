#!/usr/bin/env node
// Builds the native toolbar for the Mac app's Electron: build/Release/
// toolbar.node, for Apple silicon and Intel in one (lipo). Not on a Mac:
// nothing to build (the app then keeps the page's own top row).
//
//   npm ci && node build.js            universal
//   node build.js --arch arm64         one architecture (a quick try)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') {
    console.log('The native toolbar is built on a Mac only; skipped.');
    process.exit(0);
}

const electron = require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json')).version;
const gyp = require.resolve('node-gyp/bin/node-gyp.js');
const i = process.argv.indexOf('--arch');
const archs = i > 0 ? [process.argv[i + 1]] : ['arm64', 'x64'];
const out = path.join(__dirname, 'build', 'Release', 'toolbar.node');
const parts = [];

for (const arch of archs) {
    execFileSync(process.execPath, [gyp, 'rebuild', `--target=${electron}`, `--arch=${arch}`,
        '--dist-url=https://electronjs.org/headers'], { cwd: __dirname, stdio: 'inherit' });
    const part = path.join(__dirname, `toolbar-${arch}.node`);
    fs.copyFileSync(out, part);
    parts.push(part);
}
execFileSync('lipo', ['-create', ...parts, '-output', out], { stdio: 'inherit' });
parts.forEach(p => fs.rmSync(p));
execFileSync('lipo', ['-info', out], { stdio: 'inherit' });
