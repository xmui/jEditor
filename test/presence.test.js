// Presence kit: Texture, Clarity and Dehaze (Develop.localPx).
//   Dehaze: the restore kit's scenes made bigger and hazed with distance
//     (the top far away, the most haze: I = J·t + A·(1 − t)), dehazed, and
//     scored by ΔE2000 against the clear scene. Scores are kept in
//     test/restore-kit/presence-scores.json; this fails if one gets worse.
//   Clarity and Texture: each raises its own band of contrast (and lowers
//     it below 0) more than the other's; Clarity leaves no big halo at an
//     edge.
//   All three: the same at every size (made at full size and then made
//     smaller, against made on the smaller picture), and the same in blocks
//     as all at once.
//   node test/presence.test.js           check against the scores
//   node test/presence.test.js --update  write the new scores
const fs = require('fs');
const path = require('path');
const { scenes } = require('./restore-kit/scenes');
const { enlarge } = require('./restore-kit/halftone');
const { meanDE } = require('./restore-kit/deltae');

const ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'develop.js'), 'utf8');
const Develop = new Function('ImageData', src + ';return Develop;')(ImageData);

const fails = [];
const big = (scene, scale) => {
    const { W, H, rgb } = enlarge(scenes[scene](), scale);
    const px = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { for (let c = 0; c < 3; c++) px[i * 4 + c] = rgb[i * 3 + c]; px[i * 4 + 3] = 255; }
    return { w: W, h: H, px };
};
const run = (img, adj) => {
    const out = new Uint8ClampedArray(img.px);
    const d = Develop.detail(Develop.full(adj), 1, img.w, img.h);
    if (d) Develop.applyDetail(out, img.w, img.h, d, 1);
    return out;
};
const half = (px, w, h) => {
    const W = w >> 1, H = h >> 1, o = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        for (let c = 0; c < 4; c++) {
            const at = (dx, dy) => px[((2 * y + dy) * w + 2 * x + dx) * 4 + c];
            o[(y * W + x) * 4 + c] = (at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4;
        }
    }
    return { w: W, h: H, px: o };
};
const luma = (px) => { const n = px.length / 4, Y = new Float32Array(n); for (let i = 0; i < n; i++) Y[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255; return Y; };
// How much contrast there is between two sizes of blur (a band)
const band = (px, w, h, r0, r1) => {
    const Y = luma(px), a = Develop.box3(Y, w, h, r0), b = Develop.box3(Y, w, h, r1);
    let s = 0;
    for (let i = 0; i < Y.length; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s / Y.length);
};

// ---- Dehaze ----
const HAZE = [236, 236, 240];
const hazed = (img) => {
    const out = new Uint8ClampedArray(img.px);
    for (let y = 0; y < img.h; y++) {
        const t = 0.35 + 0.6 * (y / (img.h - 1));
        for (let x = 0; x < img.w; x++) for (let c = 0; c < 3; c++) { const i = (y * img.w + x) * 4 + c; out[i] = img.px[i] * t + HAZE[c] * (1 - t); }
    }
    return { ...img, px: out };
};
const AMOUNTS = [25, 50, 75, 100];
const rows = ['family', 'beach', 'grass', 'interior'].map(scene => {
    const clean = big(scene, 3), hz = hazed(clean);
    const de = AMOUNTS.map(a => +meanDE(clean.px, run(hz, { dehaze: a })).toFixed(3));
    return { id: scene, hazy: +meanDE(clean.px, hz.px).toFixed(3), de, best: Math.min(...de) };
});
// On a clear photo, a little dehaze changes it a little
{
    const clear = big('family', 3);
    const de = meanDE(clear.px, run(clear, { dehaze: 25 }));
    if (de > 6) fails.push(`dehaze 25 on a clear photo moves it ${de.toFixed(2)} (at most 6)`);
    const fog = meanDE(clear.px, run(clear, { dehaze: -50 }));
    const lighter = luma(run(clear, { dehaze: -50 })).reduce((s, v) => s + v, 0) > luma(clear.px).reduce((s, v) => s + v, 0);
    if (!(fog > 3 && lighter)) fails.push(`dehaze −50 should put haze on (lighter, flatter): ΔE ${fog.toFixed(2)}`);
}

// ---- Clarity and Texture: their own bands ----
{
    const img = big('family', 6), W = img.w, H = img.h, long = Math.max(W, H);
    const L = Develop.LOCAL;
    const bc = Develop.boxFor(L.clarity * long), bt = Develop.boxFor(L.texture * long), bt0 = Develop.boxFor(L.texture * long / 3);
    const wide = (px) => band(px, W, H, bt, bc), fine = (px) => band(px, W, H, bt0, bt);
    const base = { wide: wide(img.px), fine: fine(img.px) };
    const cl = run(img, { clarity: 60 }), cln = run(img, { clarity: -60 }), tx = run(img, { texture: 60 }), txn = run(img, { texture: -60 });
    const r = (a, b) => +(a / b).toFixed(3);
    const got = { clarityWide: r(wide(cl), base.wide), clarityFine: r(fine(cl), base.fine), textureFine: r(fine(tx), base.fine), textureWide: r(wide(tx), base.wide), clarityLess: r(wide(cln), base.wide), textureLess: r(fine(txn), base.fine) };
    console.log('  bands (× as before): ' + JSON.stringify(got));
    if (!(got.clarityWide > 1.15 && got.clarityWide - 1 > (got.clarityFine - 1) * 1.5)) fails.push('clarity should raise the wide band, more than the fine one');
    if (!(got.textureFine > 1.15 && got.textureFine - 1 > (got.textureWide - 1) * 1.5)) fails.push('texture should raise the fine band, more than the wide one');
    if (!(got.clarityLess < 0.9 && got.textureLess < 0.9)) fails.push('below 0, clarity and texture should lower their bands');
}
// Clarity at an edge: no big halo
{
    const W = 600, H = 60, px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = x < W / 2 ? 70 : 180; px.set([v, v, v, 255], (y * W + x) * 4); }
    const out = run({ w: W, h: H, px }, { clarity: 100 });
    let lo = 255, hi = 0;
    for (let x = 0; x < W; x++) { const v = out[(30 * W + x) * 4]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const halo = Math.max(70 - lo, hi - 180);
    console.log(`  clarity 100 at an edge (70 | 180): ${lo}–${hi}, a halo of ${halo} levels`);
    if (halo > 24) fails.push(`clarity's halo at an edge is ${halo} levels (at most 24)`);
}

// ---- Every size the same ----
for (const [k, v] of [['clarity', 60], ['dehaze', 60], ['clarity', -60]]) {
    const img = hazed(big('beach', 6)), sm = half(img.px, img.w, img.h);
    const a = half(run(img, { [k]: v }), img.w, img.h).px, b = run(sm, { [k]: v });
    const de = meanDE(a, b);
    console.log(`  ${k} ${v}: made then made smaller, against made smaller: ${de.toFixed(2)}`);
    if (de > 1.5) fails.push(`${k} ${v} isn't the same at half the size (ΔE ${de.toFixed(2)}, at most 1.5)`);
}

// ---- In blocks, as all at once ----
{
    const img = hazed(big('family', 4)), adj = { clarity: 50, texture: 40, dehaze: 40 };
    const whole = run(img, adj);
    const d = Develop.detail(Develop.full(adj), 1, img.w, img.h);
    const read = (x, y, w, h) => { const o = new ImageData(w, h); for (let r = 0; r < h; r++) o.data.set(img.px.subarray(((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4), r * w * 4); return o; };
    let worst = 0;
    for (let y = 0; y < img.h; y += 200) for (let x = 0; x < img.w; x += 200) {
        const bw = Math.min(200, img.w - x), bh = Math.min(200, img.h - y);
        const b = Develop.detailBlock(read, x, y, bw, bh, img.w, img.h, d, 1);
        for (let r = 0; r < bh; r++) for (let c = 0; c < bw * 4; c++) if (c % 4 !== 3) worst = Math.max(worst, Math.abs(b.data[r * bw * 4 + c] - whole[((y + r) * img.w + x) * 4 + c]));
    }
    if (worst > 1) fails.push(`in blocks, up to ${worst} levels off doing it all at once`);
}

const mean = (k) => +(rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(3);
console.log('presence kit: dehaze (ΔE2000 against the clear scene; lower is better)');
console.log('  scene        hazy   dehaze ' + AMOUNTS.join('      '));
for (const r of rows) console.log('  ' + r.id.padEnd(10) + String(r.hazy).padStart(7) + r.de.map(v => String(v).padStart(9)).join(''));
console.log('  best, mean: ' + mean('best') + ' (hazy ' + mean('hazy') + ')');

const file = path.join(__dirname, 'restore-kit', 'presence-scores.json');
if (process.argv.includes('--update')) {
    const cases = {};
    for (const r of rows) cases[r.id] = r.best;
    fs.writeFileSync(file, JSON.stringify({ best: mean('best'), cases }, null, 2) + '\n');
    console.log('  scores written');
} else if (fs.existsSync(file)) {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const r of rows) if (kept.cases[r.id] === undefined) fails.push(r.id + ': no score kept'); else if (r.best > kept.cases[r.id] + 0.25) fails.push(`${r.id}: ${kept.cases[r.id]} → ${r.best}`);
    if (mean('best') > kept.best + 0.1) fails.push(`mean: ${kept.best} → ${mean('best')}`);
} else fails.push('no scores kept: run node test/presence.test.js --update');
for (const r of rows) if (!(r.best < r.hazy * 0.7)) fails.push(`${r.id}: dehaze should take most of the haze off (${r.hazy} → ${r.best})`);

if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
console.log('  ok');
