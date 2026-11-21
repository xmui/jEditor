#!/usr/bin/env node
// Screenshots of the Tauri app (desktop/app), for its pull requests: the
// start screen, and a folder of photos open. On a Mac (CI's macos runner)
// with screencapture; on Linux under Xvfb with ImageMagick's import.
//
//   node scripts/shots-tauri.js "<path>/jEditor Tauri.app" <out folder>
//   xvfb-run -a -s "-screen 0 1440x900x24" node scripts/shots-tauri.js desktop/app/target/debug/jeditor <out folder>

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const mac = process.platform === 'darwin';
const target = path.resolve(process.argv[2] || '');
const out = path.resolve(process.argv[3] || 'shots');
const macos = path.join(target, 'Contents', 'MacOS');
const exe = fs.existsSync(macos) ? path.join(macos, fs.readdirSync(macos).find(n => !n.startsWith('.'))) : target;
if (!fs.existsSync(exe)) { console.error('No app at ' + target); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

// A few made-up photos: a 24-bit BMP each (a gradient and soft discs), made
// into JPEGs by the system's own tool
function bmp(w, h, seed) {
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const discs = Array.from({ length: 14 }, () => ({ x: rnd() * w, y: rnd() * h, r: 20 + rnd() * w / 5, c: [rnd() * 255, rnd() * 255, rnd() * 255] }));
    const c0 = [rnd() * 200, rnd() * 200, rnd() * 200], c1 = [rnd() * 200, rnd() * 200, rnd() * 200];
    const row = (w * 3 + 3) & ~3;
    const buf = Buffer.alloc(54 + row * h);
    buf.write('BM'); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14); buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = (x + y) / (w + h);
        let px = [0, 1, 2].map(i => c0[i] * (1 - t) + c1[i] * t);
        for (const d of discs) {
            const k = Math.max(0, 1 - Math.hypot(x - d.x, y - d.y) / d.r) * 0.7;
            px = px.map((v, i) => v * (1 - k) + d.c[i] * k);
        }
        const o = 54 + (h - 1 - y) * row + x * 3;
        buf[o] = px[2]; buf[o + 1] = px[1]; buf[o + 2] = px[0];
    }
    return buf;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jeditor-shots-'));
const folder = path.join(work, 'Summer 1998');
fs.mkdirSync(folder);
for (let i = 1; i <= 12; i++) {
    const [w, h] = i % 3 ? [360, 240] : [240, 360];
    const src = path.join(work, `p${i}.bmp`), dst = path.join(folder, `scan_${String(i).padStart(4, '0')}.jpg`);
    fs.writeFileSync(src, bmp(w, h, i * 7919));
    if (mac) execFileSync('sips', ['-s', 'format', 'jpeg', src, '--out', dst], { stdio: 'ignore' });
    else execFileSync('convert', [src, dst]);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function capture(name) {
    const file = path.join(out, name);
    if (mac) execFileSync('screencapture', ['-x', file]);
    else execFileSync('import', ['-window', 'root', file]);
    console.log('  ' + file);
}

(async () => {
    const profile = path.join(work, 'profile');
    for (const [name, args] of [['tauri-start.png', []], ['tauri-folder.png', [folder]]]) {
        const child = spawn(exe, [...args, '--user-data', profile], { stdio: 'ignore', env: { ...process.env, JEDITOR_SKIP_PERMISSIONS: '1' } });
        await sleep(9000);
        try { capture(name); } catch (e) { console.error('No screenshot: ' + e.message); }
        child.kill();
        await sleep(1500);
    }
    fs.rmSync(work, { recursive: true, force: true });
})();
