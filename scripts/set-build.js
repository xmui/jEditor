#!/usr/bin/env node
// Stamps the release a build is for into app/version.js, so the build
// knows exactly what it is: v1.41.0, v1.41.0-2, or a beta, v1.42.0-beta.3
// (the Release workflow runs this before building each app).
//   node scripts/set-build.js v1.42.0-beta.3

const fs = require('fs');
const path = require('path');

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+(-\d+|-beta\.\d+)?$/.test(tag || '')) {
    console.error('Usage: node scripts/set-build.js v<major.minor.patch>[-N|-beta.N]');
    process.exit(1);
}
const file = path.join(__dirname, '..', 'app', 'version.js');
const line = `const APP_BUILD = '${tag}';`;
let text = fs.readFileSync(file, 'utf8').replace(/\n?const APP_BUILD = '[^']*';\n?/, '\n');
fs.writeFileSync(file, text.replace(/\n*$/, '\n') + line + '\n');
console.log(`app/version.js: ${line}`);
