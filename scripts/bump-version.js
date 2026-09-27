#!/usr/bin/env node
// Bumps the app version everywhere it lives:
//   npm run bump 1.3.1
// Updates app/version.js (UI + service worker cache), package.json and
// package-lock.json.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('Usage: npm run bump <major.minor.patch>   e.g. npm run bump 1.3.1');
    process.exit(1);
}

const versionFile = path.join(ROOT, 'app', 'version.js');
fs.writeFileSync(versionFile, fs.readFileSync(versionFile, 'utf8')
    .replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${version}'`));

const pkgFile = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

// Keep the lockfile's copy in step so `npm install` doesn't dirty the tree
const lockFile = path.join(ROOT, 'package-lock.json');
if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
}

console.log(`Version bumped to ${version} (app/version.js, package.json, package-lock.json).`);
console.log('Commit and merge to main — the Release workflow tags and publishes automatically.');
