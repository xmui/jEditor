// Descreen kit: the restore kit's scenes printed in dots, as a magazine or
// newspaper prints a photo (test/restore-kit/halftone.js), found by
// Develop.findScreen and descreened by Detail's first step, scored by
// ΔE2000 against the dots mixed as a picture made smaller mixes them (so
// that every size of the photo matches: halftone.js). The scores are kept in
// test/restore-kit/descreen-scores.json; this fails if a case gets worse,
// if a screen is missed or its spacing is wrong, or if a photo that isn't
// printed is said to be.
//   node test/descreen.test.js           check against the scores
//   node test/descreen.test.js --update  write the new scores
const fs = require('fs');
const path = require('path');
const { scenes } = require('./restore-kit/scenes');
const { halftone } = require('./restore-kit/halftone');
const { meanDE } = require('./restore-kit/deltae');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'develop.js'), 'utf8');
const ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
const Develop = new Function('ImageData', src + ';return Develop;')(ImageData);

// [scene, dots' spacing in px, black only]: 150 lpi at 600 and 900 dpi,
// 133 lpi at 1200 dpi, 85 lpi newsprint at 600 dpi
const CASES = [
    ['family', 4, false], ['beach', 6, false], ['interior', 9, false],
    ['grass', 5, false], ['family', 7, true], ['beach', 3, true]
];
const CASE_SLACK = 0.15;
const MEAN_SLACK = 0.05;
const SPACING_OFF = 0.06;   // how far off the spacing found may be (a share)

const fails = [];
const rows = CASES.map(([scene, period, mono]) => {
    const h = halftone(scenes[scene](), { period, mono });
    const found = Develop.findScreen(h.print, h.w, h.h);
    const id = `${scene}/${mono ? 'mono' : 'cmyk'}@${period}`;
    if (!found) fails.push(id + ': no screen found');
    else if (Math.abs(found.screen - period) / period > SPACING_OFF) fails.push(`${id}: spacing found ${found.screen}, not ${period}`);
    const adj = { descreen: 100, screen: found ? found.screen : period };
    const out = new Uint8ClampedArray(h.print);
    Develop.applyDetail(out, h.w, h.h, Develop.detail(Develop.full(adj)), 1);
    return { id, printed: +meanDE(h.ideal, h.print).toFixed(3), descreened: +meanDE(h.ideal, out).toFixed(3), found: found && found.screen, strength: found && found.strength };
});
const mean = +(rows.reduce((s, r) => s + r.descreened, 0) / rows.length).toFixed(3);

// Not printed: a photo (with its grain), and the same at a quarter: nothing found
for (const scene of ['family', 'beach', 'grass', 'interior', 'sunset']) {
    const h = halftone(scenes[scene](), { period: 5 });
    const f = Develop.findScreen(h.ideal, h.w, h.h);
    if (f) fails.push(`${scene} (not printed): a screen found, ${JSON.stringify(f)}`);
    const s = scenes[scene]();
    const f2 = Develop.findScreen(s.px, s.w, s.h);
    if (f2) fails.push(`${scene} (small, not printed): a screen found, ${JSON.stringify(f2)}`);
}

// Every size the same: descreened and then made small, the same as the
// print made small (a thumbnail), in tone (both smoothed: a small print's
// leftover moiré isn't tone)
const SIZES_APART = 0.8;
{
    const down = (px, w, h, f) => {
        const W = w / f | 0, H = h / f | 0, o = new Uint8ClampedArray(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            for (let c = 0; c < 3; c++) {
                let s = 0;
                for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += px[((y * f + j) * w + x * f + i) * 4 + c];
                o[(y * W + x) * 4 + c] = s / (f * f);
            }
            o[(y * W + x) * 4 + 3] = 255;
        }
        return { px: o, w: W, h: H };
    };
    const smooth = ({ px, w, h }) => {
        const q = new Uint8ClampedArray(px);
        for (let c = 0; c < 3; c++) {
            const pl = new Float32Array(w * h);
            for (let i = 0; i < w * h; i++) pl[i] = px[i * 4 + c];
            const b = Develop.gauss(pl, w, h, 2, 6);
            for (let i = 0; i < w * h; i++) q[i * 4 + c] = b[i];
        }
        return q;
    };
    let apart = 0;
    for (const [scene, period, mono] of CASES) {
        const h = halftone(scenes[scene](), { period, mono });
        const out = new Uint8ClampedArray(h.print);
        Develop.applyDetail(out, h.w, h.h, Develop.detail(Develop.full({ descreen: 100, screen: period })), 1);
        apart += meanDE(smooth(down(out, h.w, h.h, 6)), smooth(down(h.print, h.w, h.h, 6)));
    }
    apart /= CASES.length;
    console.log(`  full size descreened, made small, against a thumbnail: ${apart.toFixed(2)} apart`);
    if (apart > SIZES_APART) fails.push(`descreened and made small is ${apart.toFixed(2)} from a thumbnail (most ${SIZES_APART})`);
}

// Off at a size where the dots can't be told apart, on where they can
{
    const a = Develop.full({ descreen: 80, screen: 6 });
    if (Develop.detail(a, 0.25)) fails.push('descreen on at a quarter of a 6 px screen (1.5 px: the dots are gone already)');
    if (!Develop.detail(a, 0.4)) fails.push('descreen off at 0.4 of a 6 px screen (2.4 px apart: they show)');
    const d = Develop.detail(Develop.full({ descreen: 80, screen: 6, sharpen: 40 }), 0.4);
    if (d.amount) fails.push('sharpening on in a preview at 0.4');
}

// In blocks (as a big photo is saved), the same as all at once
{
    const h = halftone(scenes.family(), { period: 8 });
    const d = Develop.detail(Develop.full({ descreen: 100, screen: 8, sharpen: 30 }));
    const whole = new Uint8ClampedArray(h.print);
    Develop.applyDetail(whole, h.w, h.h, d, 1);
    const read = (x, y, w, hh) => {
        const img = new ImageData(w, hh);
        for (let r = 0; r < hh; r++) img.data.set(h.print.subarray(((y + r) * h.w + x) * 4, ((y + r) * h.w + x + w) * 4), r * w * 4);
        return img;
    };
    let worst = 0;
    for (let y = 0; y < h.h; y += 128) for (let x = 0; x < h.w; x += 128) {
        const bw = Math.min(128, h.w - x), bh = Math.min(128, h.h - y);
        const b = Develop.detailBlock(read, x, y, bw, bh, h.w, h.h, d, 1);
        for (let r = 0; r < bh; r++) for (let c = 0; c < bw * 4; c++) {
            if (c % 4 === 3) continue;
            worst = Math.max(worst, Math.abs(b.data[r * bw * 4 + c] - whole[((y + r) * h.w + x) * 4 + c]));
        }
    }
    if (worst > 1) fails.push(`in blocks, up to ${worst} levels off doing it all at once`);
}

console.log('descreen kit (ΔE2000 against the dots evenly mixed; lower is better)');
console.log('  case                  printed  descreened  spacing found (strength)');
for (const r of rows) console.log('  ' + r.id.padEnd(22) + String(r.printed).padStart(7) + String(r.descreened).padStart(12) + '  ' + r.found + ' (' + r.strength + ')');
console.log('  ' + 'mean'.padEnd(22) + ''.padStart(7) + String(mean).padStart(12));

const file = path.join(__dirname, 'restore-kit', 'descreen-scores.json');
if (process.argv.includes('--update')) {
    const cases = {};
    for (const r of rows) cases[r.id] = r.descreened;
    fs.writeFileSync(file, JSON.stringify({ mean, cases }, null, 2) + '\n');
    console.log('  scores written');
} else if (fs.existsSync(file)) {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const r of rows) {
        const was = kept.cases[r.id];
        if (was === undefined) fails.push(r.id + ': no score kept (run with --update)');
        else if (r.descreened > was + CASE_SLACK) fails.push(`${r.id}: ${was} → ${r.descreened}`);
    }
    if (mean > kept.mean + MEAN_SLACK) fails.push(`mean: ${kept.mean} → ${mean}`);
} else fails.push('no scores kept: run node test/descreen.test.js --update');

if (fails.length) {
    for (const f of fails) console.log('  FAIL: ' + f);
    process.exit(1);
}
console.log('  ok');
