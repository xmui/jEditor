#!/usr/bin/env node
// Bumps the app version everywhere it lives:
//   npm run bump 1.3.1
// Updates app/version.js (UI + service worker cache) and package.json.

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

console.log(`Version bumped to ${version} (app/version.js + package.json).`);
console.log(`Tag with: git tag v${version} && git push --tags  → publishes a release with standalone.html`);
