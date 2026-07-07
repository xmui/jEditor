#!/usr/bin/env node
// Builds standalone.html: a single self-contained file that works when
// opened directly from disk (file://) in Chrome/Edge — no server needed.
// All CSS, JS and the icon are inlined into app/index.html.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const OUT = path.join(ROOT, 'standalone.html');

const read = (name) => fs.readFileSync(path.join(APP, name), 'utf8');

let html = read('index.html');

const iconDataUri = 'data:image/png;base64,' +
    fs.readFileSync(path.join(APP, 'icon.png')).toString('base64');

// Replacement values are passed as functions so `$` sequences in the
// source files aren't interpreted as regex replacement patterns.
const replacements = [
    // Inline styles and scripts
    ['<link rel="stylesheet" href="cropper.min.css">', () => `<style>\n${read('cropper.min.css')}\n</style>`],
    ['<link rel="stylesheet" href="style.css">', () => `<style>\n${read('style.css')}\n</style>`],
    ['<script src="cropper.min.js"></script>', () => `<script>\n${read('cropper.min.js')}\n</script>`],
    ['<script src="script.js"></script>', () => `<script>\n${read('script.js')}\n</script>`],
    // PWA bits don't apply to a local file
    ['<link rel="manifest" href="manifest.json">', () => ''],
];

for (const [needle, replacement] of replacements) {
    if (!html.includes(needle)) {
        console.error(`build-standalone: expected to find ${JSON.stringify(needle)} in app/index.html`);
        process.exit(1);
    }
    html = html.replace(needle, replacement);
}

// Remove the service worker registration block entirely
html = html.replace(/<script>\s*\/\/ Service workers[^]*?<\/script>/, '');

// Inline the icon everywhere it is referenced
html = html.split('icon.png').join(iconDataUri);

fs.writeFileSync(OUT, html);
console.log(`Built ${path.relative(ROOT, OUT)} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
