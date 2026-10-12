#!/usr/bin/env node
// Prints the release notes for a version from app/changelog.js, as
// Markdown (used by the Release workflow).
//
//   node scripts/release-notes.js [version]   (default: package.json's)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadChangelog() {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'changelog.js'), 'utf8');
    return vm.runInNewContext(src + '\n;CHANGELOG');
}

function notesFor(version, changelog = loadChangelog()) {
    const entry = changelog.find(e => e.version === version);
    if (!entry) return null;
    return entry.items.map(item => '- ' + item).join('\n') + '\n';
}

if (require.main === module) {
    const version = process.argv[2] || require(path.join(ROOT, 'package.json')).version;
    const notes = notesFor(version);
    if (!notes) {
        console.error(`release-notes: no entry for ${version} in app/changelog.js`);
        process.exit(1);
    }
    process.stdout.write(notes);
}

module.exports = { loadChangelog, notesFor };
