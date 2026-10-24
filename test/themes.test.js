#!/usr/bin/env node
// Themes (app/themes.js, app/themes/): what a new feature has to give each
// theme, checked from the source, so a gap shows in `npm test` before
// anyone opens the theme. The look itself (cut off, overlapping, the wrong
// font in the page) is design/themes/audit.js's, which needs a browser.
//
//   - every toolbar button has an icon in every theme, and a dark variant
//     its own icon where the theme also has a light one
//   - every picture and font a theme's stylesheets name is there
//   - every rule in a theme's stylesheets is scoped to it, so nothing
//     leaks into jEditor's own look
//   - every menu bar command is one jEditor has
//   - words drawn on a canvas are in the theme's typeface (--font-ui), not
//     a fixed one: the page's own font check can't see them
//
//   node test/themes.test.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const THEMES = path.join(APP, 'themes');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Themes.LIST from app/themes.js: [{ id, skin, variants: [{ id, name, mode, css }] }]
const themesJs = read('app/themes.js');
const themes = [];
const list = themesJs.slice(themesJs.indexOf('LIST: ['), themesJs.indexOf('MENUS: {'));
for (const block of list.split(/\n        \{\n/).slice(1)) {
    const id = (block.match(/id: '(\w+)'/) || [])[1];
    const skin = (block.match(/skin: '(\w+)'/) || [])[1];
    const variants = [...block.matchAll(/\{ id: '(\w+)', name: '([^']+)', mode: '(\w+)'[^}]*css: \[([^\]]+)\]/g)]
        .map(([, vid, name, mode, css]) => ({ id: vid, name, mode, css: [...css.matchAll(/'([^']+)'/g)].map(m => m[1]) }));
    themes.push({ id, skin, variants });
}
const sheet = {};
const css = (f) => (sheet[f] = sheet[f] || noComments(fs.readFileSync(path.join(THEMES, f), 'utf8')));

console.log('themes');
check('app/themes.js lists its themes', themes.length > 0 && themes.every(t => t.id && t.skin && t.variants.length),
    themes.map(t => `${t.id}: ${t.variants.length} variants`).join(', '));

// ---- Toolbar buttons ----
// The ones Settings can place on the toolbar (data-hc); a theme gives each
// a picture with --ico (XP), --g (Snow Leopard) or background-image (1984)
const html = read('app/index.html');
const buttons = [...html.matchAll(/<button[^>]*\bid="(btn-[\w-]+)"[^>]*\bdata-hc=/g)].map(m => m[1]);
check('the toolbar\'s buttons are found (index.html, data-hc)', buttons.length > 0);
const iconIn = (files, id) => files.some(f => new RegExp(`#${id}(?![\\w-])[^{}]*\\{[^}]*(?:--ico|--g|background-image)\\s*:`).test(css(f)));
for (const t of themes) {
    for (const v of t.variants) {
        const none = buttons.filter(id => !iconIn(v.css, id));
        check(`${v.name}: every toolbar button has an icon`, !none.length, `none for ${none.join(', ')}`);
    }
    // A dark variant over a light one's stylesheets: the light one's icons
    // are drawn for a light toolbar, so it needs its own
    const light = t.variants.filter(v => v.mode === 'light');
    for (const v of t.variants.filter(v => v.mode === 'dark' && light.length)) {
        const own = v.css.filter(f => !light.some(l => l.css.includes(f)));
        const shared = buttons.filter(id => iconIn(v.css.filter(f => !own.includes(f)), id));
        const none = shared.filter(id => !iconIn(own, id));
        check(`${v.name}: its own icons for the dark toolbar (${own.join(', ') || 'no stylesheet of its own'})`, !none.length, `still the light one's for ${none.join(', ')}`);
    }
}

// ---- Files ----
const files = fs.readdirSync(THEMES, { recursive: true }).filter(f => f.endsWith('.css')).map(f => f.split(path.sep).join('/'));
const gone = [];
for (const f of files) {
    for (const [, raw] of css(f).matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        if (/^(data:|#|%23|https?:)/.test(raw)) continue;
        if (!fs.existsSync(path.resolve(THEMES, path.dirname(f), raw))) gone.push(`${f}: ${raw}`);
    }
}
check('every picture and font the stylesheets name is there', !gone.length, gone.join('; '));
for (const t of themes) {
    const missing = t.variants.flatMap(v => v.css).filter((f, i, a) => a.indexOf(f) === i && !fs.existsSync(path.join(THEMES, f)));
    check(`${t.id}: its stylesheets are there`, !missing.length, missing.join(', '));
}

// ---- Scoped ----
// Each selector starts with :root[data-skin="<its theme>"] (or, in
// docked.css, the docked layout), at the top level or inside @media
function selectors(text) {
    const out = [], stack = [];
    let buf = '';
    for (const ch of text) {
        if (ch === '{') {
            const head = buf.trim();
            buf = '';
            if (!head.startsWith('@') && stack.every(Boolean)) out.push(head);
            stack.push(/^@(media|supports|layer)\b/.test(head));
        } else if (ch === '}') { stack.pop(); buf = ''; }
        else if (ch === ';' && stack.every(Boolean)) buf = '';
        else buf += ch;
    }
    return out;
}
function split(sel) {
    const out = [];
    let depth = 0, buf = '';
    for (const ch of sel) {
        if (ch === '(' || ch === '[') depth++;
        if (ch === ')' || ch === ']') depth--;
        if (ch === ',' && !depth) { out.push(buf.trim()); buf = ''; } else buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}
for (const f of files) {
    const folder = f.includes('/') ? f.split('/')[0] : null;
    const skin = folder && (themes.find(t => t.id === folder) || {}).skin;
    const scope = skin ? new RegExp(`^:root\\[data-skin="${skin}"\\]`) : /^:root\[data-layout~?="/;
    const leaks = selectors(css(f)).flatMap(split).filter(s => !scope.test(s) && !/^(from|to|[\d.]+%)$/.test(s));
    check(`${f}: every rule is scoped to ${skin ? `data-skin="${skin}"` : 'the docked layout'}`, !leaks.length, leaks.slice(0, 5).join(' | '));
}

// ---- Menu bar ----
const script = read('app/script.js');
const kh = script.slice(script.indexOf('    keyHandlers() {'));
const handlers = new Set([...kh.slice(0, kh.indexOf('\n    },\n')).matchAll(/'([\w]+\.[\w]+)'\s*:/g)].map(m => m[1]));
const menus = themesJs.slice(themesJs.indexOf('MENUS: {'));
const commands = [...menus.slice(0, menus.indexOf('\n    },\n')).matchAll(/\['[^']+',\s*'([\w.]+)'/g)].map(m => m[1]);
const unknown = commands.filter(c => !handlers.has(c));
check(`the menu bar's ${commands.length} commands are jEditor's (keyHandlers in script.js)`, commands.length > 0 && !unknown.length, unknown.join(', '));

// ---- Canvas text ----
// A canvas can't inherit a font: read --font-ui (crop.js: themeColors)
const fixed = [];
for (const f of fs.readdirSync(APP).filter(f => f.endsWith('.js'))) {
    fs.readFileSync(path.join(APP, f), 'utf8').split('\n').forEach((line, i) => {
        if (/\.font\s*=\s*['"`][^'"`$]*\b(system-ui|sans-serif|serif|Segoe UI|Arial|Helvetica)\b/.test(line)) fixed.push(`app/${f}:${i + 1}`);
    });
}
check('words on a canvas are in the theme\'s typeface (--font-ui)', !fixed.length, `a fixed font at ${fixed.join(', ')}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
