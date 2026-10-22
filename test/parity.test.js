#!/usr/bin/env node
// Platform parity (docs/platforms.md): the table there says which app has
// which feature; this checks it against what each app lists
// (JEditorNative.features in src/bridge.js and mac/bridge.js) and what the
// page asks for (Host.has('…'), data-needs="…"), then prints what runs
// where. No browser: it reads the source.
//
//   node test/parity.test.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PLATFORMS = ['windows', 'mac', 'linux', 'web'];

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// An app's features line → { feature: Set of platforms }. In the Mac and
// Linux host, a list after `… === 'mac' ?` is the Mac's alone (and
// 'linux' likewise); any other condition (mac.updates: how it was
// packaged) is still both.
function features(file, platforms) {
    const line = read(file).split('\n').find(l => /^\s*features:/.test(l));
    if (!line) return null;
    const out = {};
    const add = (name, on) => { (out[name] = out[name] || new Set()); on.forEach(p => out[name].add(p)); };
    const only = /([^?:,(]+?)\?\s*\[([^\]]*)\]/g;
    let rest = line, m;
    while ((m = only.exec(line))) {
        const cond = m[1];
        const which = platforms.filter(p => new RegExp(`===\\s*'${p}'`).test(cond));
        for (const [, name] of m[2].matchAll(/'([A-Za-z]+)'/g)) add(name, which.length ? which : platforms);
        rest = rest.replace(m[0], '');
    }
    for (const [, name] of rest.matchAll(/'([A-Za-z]+)'/g)) add(name, platforms);
    return out;
}

// The page's own asks: Host.has('x') and data-needs="x y"
function asked() {
    const out = new Set();
    for (const f of fs.readdirSync(path.join(ROOT, 'app'))) {
        if (!/\.(js|html)$/.test(f)) continue;
        const s = read(path.join('app', f));
        for (const [, n] of s.matchAll(/Host\.has\('([A-Za-z]+)'\)/g)) out.add(n);
        for (const [, ns] of s.matchAll(/data-needs="([^"]+)"/g)) ns.split(/\s+/).forEach(n => out.add(n));
    }
    return out;
}

// docs/platforms.md's table: { feature: { windows, mac, linux, web } } (✓ or not)
function table() {
    const doc = read('docs/platforms.md');
    const start = doc.indexOf('| Feature |');
    if (start < 0) return null;
    const out = {};
    for (const line of doc.slice(start).split('\n').slice(2)) {
        if (!line.startsWith('|')) break;
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        const name = (cells[0].match(/^`([A-Za-z]+)`$/) || [])[1];
        if (!name) continue;
        out[name] = { windows: cells[2] === '✓', mac: cells[3] === '✓', linux: cells[4] === '✓', web: cells[5] === '✓' };
    }
    return out;
}

const win = features('src/bridge.js', ['windows']);
const mac = features('mac/bridge.js', ['mac', 'linux']);
const doc = table();
const uses = asked();
const hostDoc = read('app/host.js').split('\n').filter(l => l.startsWith('//')).join('\n');

console.log('platform parity');
check('the Windows app lists its features (src/bridge.js)', !!win && Object.keys(win).length > 0);
check('the Mac and Linux app lists its features (mac/bridge.js)', !!mac && Object.keys(mac).length > 0);
check('docs/platforms.md has the features table', !!doc && Object.keys(doc).length > 0);
if (!win || !mac || !doc) process.exit(1);

// What each platform really has, from the code
const has = {};
for (const src of [win, mac]) for (const [n, ps] of Object.entries(src)) {
    has[n] = has[n] || new Set();
    ps.forEach(p => has[n].add(p));
}
const inBuild = new Set([...Object.keys(has), ...uses]);

const undocumented = [...inBuild].filter(n => !doc[n]);
check('every feature an app lists or the page asks for has a row in docs/platforms.md', !undocumented.length,
    `add a row for: ${undocumented.join(', ')}`);

const unlisted = [...uses].filter(n => !has[n]);
check('every feature the page asks for is listed by some app', !unlisted.length,
    `no app lists: ${unlisted.join(', ')} (so nothing ever shows it)`);

const noHostDoc = [...inBuild].filter(n => !new RegExp(`^//\\s+${n}\\s`, 'm').test(hostDoc));
check('every feature is described at the top of app/host.js', !noHostDoc.length, `missing: ${noHostDoc.join(', ')}`);

const wrong = [];
for (const [n, row] of Object.entries(doc)) {
    if (!inBuild.has(n)) continue; // not in this build (a beta's): checked once it is
    for (const p of PLATFORMS) {
        const real = p !== 'web' && !!has[n] && has[n].has(p);
        if (row[p] !== real) wrong.push(`${n} on ${p}: the table says ${row[p] ? '✓' : 'no'}, the code says ${real ? 'yes' : 'no'}`);
    }
}
check('the table matches what each app lists', !wrong.length, wrong.join('; '));

// What runs where, as the code has it
const names = [...inBuild].sort((a, b) => (has[b] ? has[b].size : 0) - (has[a] ? has[a].size : 0) || a.localeCompare(b));
const col = (s, w) => String(s).padEnd(w);
console.log('\n  ' + col('feature', 13) + PLATFORMS.map(p => col(p, 9)).join(''));
for (const n of names) console.log('  ' + col(n, 13) + PLATFORMS.map(p => col(p !== 'web' && has[n] && has[n].has(p) ? '✓' : '·', 9)).join(''));
const later = Object.keys(doc).filter(n => !inBuild.has(n));
if (later.length) console.log(`\n  in the table, not in this build yet: ${later.join(', ')}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
