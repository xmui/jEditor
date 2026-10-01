#!/usr/bin/env node
// Builds a single-document version of app/index.html with every script
// and stylesheet inlined.
//
//   node scripts/build-standalone.js             → standalone.html
//       Works opened straight from disk (file://) in Chrome/Edge: icon
//       inlined, no manifest or service worker.
//
//   node scripts/build-standalone.js --site DIR  → DIR/ for GitHub Pages
//       The installable web app: keeps the manifest, icons and service
//       worker. One document means a browser can never mix an old
//       index.html with a newer script.js — Pages lets each file be cached
//       for up to 10 minutes, which could break startup after a deploy.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const siteArg = process.argv.indexOf('--site');
const SITE = siteArg !== -1 ? path.resolve(process.argv[siteArg + 1] || '_site') : null;

const read = (name) => fs.readFileSync(path.join(APP, name), 'utf8');
const fail = (msg) => { console.error('build-standalone: ' + msg); process.exit(1); };

let html = read('index.html');

// Inline every local script and stylesheet the page references. With a
// replacement callback, `$` sequences in the sources are used literally.
// A `</script>` inside a source would end the inline block early, so it's
// escaped.
const inlined = [];
html = html.replace(/<script src="([\w.-]+\.js)"><\/script>/g, (m, file) => {
    inlined.push(file);
    return `<script>\n${read(file).replace(/<\/script/gi, '<\\/script')}\n</script>`;
});
html = html.replace(/<link rel="stylesheet" href="([\w.-]+\.css)">/g, (m, file) => {
    inlined.push(file);
    return `<style>\n${read(file)}\n</style>`;
});
for (const must of ['script.js', 'version.js', 'style.css']) {
    if (!inlined.includes(must)) fail(`expected ${must} to be referenced by app/index.html`);
}
if (/<script src=|<link rel="stylesheet"/.test(html)) fail('a script or stylesheet was not inlined');

if (!SITE) {
    // A local file: no PWA manifest or service worker; icon inlined
    if (!html.includes('<link rel="manifest" href="manifest.json">')) fail('manifest link not found');
    html = html.replace('<link rel="manifest" href="manifest.json">', '');
    html = html.replace(/<script>\s*\/\/ Service workers[^]*?<\/script>/, '');
    const iconDataUri = 'data:image/png;base64,' + fs.readFileSync(path.join(APP, 'icon.png')).toString('base64');
    html = html.split('icon.png').join(iconDataUri);
    const out = path.join(ROOT, 'standalone.html');
    fs.writeFileSync(out, html);
    console.log(`Built ${path.relative(ROOT, out)} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
} else {
    // The web app: the page plus the files the manifest and service worker need
    fs.rmSync(SITE, { recursive: true, force: true });
    fs.mkdirSync(SITE, { recursive: true });
    fs.writeFileSync(path.join(SITE, 'index.html'), html);
    const assets = ['version.js', 'manifest.json', 'icon.png', 'icon-192.png', 'icon-maskable-512.png'];
    for (const f of assets) fs.copyFileSync(path.join(APP, f), path.join(SITE, f));
    // Service worker: same code, precaching what this build contains
    const precache = ['./', './index.html', ...assets.map(f => './' + f)];
    const sw = read('sw.js').replace(/const ASSETS = \[[^]*?\];/, () =>
        `const ASSETS = ${JSON.stringify(precache, null, 4)};`);
    if (!sw.includes(JSON.stringify(precache, null, 4))) fail('could not set the service worker asset list');
    fs.writeFileSync(path.join(SITE, 'sw.js'), sw);
    console.log(`Built ${path.relative(ROOT, SITE) || SITE}/ (index.html ${(html.length / 1024).toFixed(0)} KB, ${assets.length + 2} files)`);
}
