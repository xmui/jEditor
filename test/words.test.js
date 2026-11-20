// The app's words name no other app or brand (the owner, for 2.0): every
// explanation says what a thing does, not which app it's like. The only
// names kept are the keyboard shortcut profiles that match another app's
// keys (KEY_PROFILES in script.js), since that's what they are.
//
// Checks the text the app shows: the page (comments left out) and the
// strings in its scripts (comments left out). The guide and the changelog
// are left to their own pass. Runs without a browser.

const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'app');

const BRANDS = /\b(Lightroom|Photoshop|Photomator|Pixelmator|Apple Photos|Capture One|Affinity Photo|Procreate|GIMP|Snapseed|Darktable|Google Photos|Windows Photos|iPhoto|FastFoto|Epson|Plustek|Canva)\b/;
const SKIP = new Set(['changelog.js', 'guide.js']);

let passed = 0, failed = 0;
function check(name, ok, detail) {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// The shortcut profiles' names: allowed
const script = fs.readFileSync(path.join(APP, 'script.js'), 'utf8');
const profiles = script.slice(script.indexOf('KEY_PROFILES: {'));
const allowed = new Set([...profiles.slice(0, profiles.indexOf('\n    },\n')).matchAll(/\bname: '([^']+)'/g)].map(m => m[1]));
// A file signature, not words anyone reads (meta.js: a JPEG's IPTC block)
allowed.add('Photoshop 3.0\\0');

// A script without its comments, then its string literals
function strings(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
        if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue; }
        if (c === '/' && /[(,=:[!&|?{};]\s*$/.test(src.slice(Math.max(0, i - 20), i))) {
            // a regular expression: skip it, with its classes
            let j = i + 1, cls = false;
            while (j < src.length && (cls || src[j] !== '/') && src[j] !== '\n') {
                if (src[j] === '\\') j++;
                else if (src[j] === '[') cls = true;
                else if (src[j] === ']') cls = false;
                j++;
            }
            i = j + 1;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') {
            let j = i + 1;
            while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
            out.push(src.slice(i + 1, j));
            i = j + 1;
            continue;
        }
        i++;
    }
    return out;
}

const found = [];
for (const f of fs.readdirSync(APP).filter(f => /\.(js|html)$/.test(f) && !SKIP.has(f)).sort()) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8');
    const texts = f.endsWith('.html') ? [src.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '')] : strings(src);
    for (const t of texts) {
        if (allowed.has(t)) continue;
        for (const line of t.split('\n')) {
            const m = line.match(BRANDS);
            if (m) found.push(`${f}: ${m[0]} in "${line.trim().slice(0, 90)}"`);
        }
    }
}

console.log('words: no other app or brand named');
check('the shortcut profiles are found (the names allowed)', allowed.size > 2 && allowed.has('jEditor'), [...allowed].join(', '));
check('no other app or brand is named in the app\'s text (only the shortcut profiles)', found.length === 0, found.join('; '));
// The test itself catches one
check('a brand in a string is caught, and one in a comment isn\'t', strings('// as in Lightroom\nconst a = "like Lightroom";').some(s => BRANDS.test(s)) && !strings('// as in Lightroom\nconst a = 1;').some(s => BRANDS.test(s)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
