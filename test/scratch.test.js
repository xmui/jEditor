// Scratch kit: the restore kit's scenes, made bigger, with scratches and
// creases drawn over them (test/restore-kit/scratch.js); the lines put
// along them by hand and found by Retouch.findScratches, then filled
// (Retouch.linePixels), and scored by ΔE2000 against the clean scene on
// the pixels the damage touched. Scores are kept in
// test/restore-kit/scratch-scores.json; this fails if a case gets worse,
// if a scratch is missed, or if one is found on a photo with none.
//   node test/scratch.test.js           check against the scores
//   node test/scratch.test.js --update  write the new scores
const fs = require('fs');
const path = require('path');
const { scenes } = require('./restore-kit/scenes');
const { scratched, curve } = require('./restore-kit/scratch');
const { lab, de2000 } = require('./restore-kit/deltae');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'retouch.js'), 'utf8');
const Retouch = new Function(src + ';return Retouch;')();

const LIGHT = [246, 244, 238], DARK = [28, 26, 24];
const CASES = {
    'family/scratches': ['family', [
        { pts: [[30, 20], [420, 300]], width: 2, colour: LIGHT },
        { pts: [[300, 10], [250, 350]], width: 3, colour: LIGHT },
        { pts: [[60, 340], [460, 250]], width: 1.5, colour: LIGHT }]],
    'beach/crease': ['beach', [
        { pts: curve([20, 60], [240, 220], [470, 120]), width: 4, colour: [232, 228, 220], ragged: 0.35, alpha: 0.8 }]],
    'grass/scratches': ['grass', [
        { pts: [[120, 0], [140, 359]], width: 2, colour: LIGHT },
        { pts: [[0, 200], [479, 170]], width: 2.5, colour: LIGHT }]],
    'interior/dark': ['interior', [
        { pts: [[200, 0], [215, 359]], width: 2, colour: DARK },
        { pts: curve([20, 300], [200, 200], [460, 280]), width: 3, colour: DARK, alpha: 0.75 }]]
};
const CASE_SLACK = 0.25, MEAN_SLACK = 0.1;

// ΔE on the damaged pixels only
const deOn = (a, b, mask) => {
    let s = 0, n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) { s += de2000(lab(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]), lab(b[i * 4], b[i * 4 + 1], b[i * 4 + 2])); n++; }
    return s / Math.max(1, n);
};
const fill = (img, list) => {
    const out = { width: img.w, height: img.h, data: new Uint8ClampedArray(img.px) };
    for (const s of Retouch.cleanSpots(list) || []) {
        const b = Retouch.lineBox(img.w, img.h, s);
        // the whole picture as the box (a line's own box would do the same)
        Retouch.linePixels(out, 0, 0, b, s);
    }
    return out.data;
};

const fails = [];
const rows = Object.entries(CASES).map(([id, [scene, lines]]) => {
    const img = scratched(scenes[scene](), lines);
    const W = img.w, H = img.h;
    // By hand: a drag along each, its width fitted
    const Y = Retouch.luma({ width: W, height: H, data: img.px });
    const hand = lines.map(L => {
        const pts = L.pts.flatMap(([x, y]) => [x / W, y / H]);
        const r = Retouch.fitLine(Y, W, H, pts);
        if (!r) fails.push(`${id}: no scratch fitted along a drag`);
        return { t: 'line', x: pts[0], y: pts[1], sx: pts[0], sy: pts[1], r: r || 2 / H, f: 0.3, o: 1, pts };
    });
    const found = Retouch.findScratches({ width: W, height: H, data: img.px });
    // How much of the damage the lines found cover
    let hit = 0, all = 0;
    const mark = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(0) };
    for (const s of found) {
        const b = Retouch.lineBox(W, H, s);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            for (let k = 0; k + 1 < b.P.length; k++) {
                const [ax, ay] = b.P[k], [bx, by] = b.P[k + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
                const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / l2));
                if (Math.hypot(x + 0.5 - ax - dx * t, y + 0.5 - ay - dy * t) < b.R) { mark.data[(y * W + x) * 4] = 1; break; }
            }
        }
    }
    for (let i = 0; i < W * H; i++) if (img.damage[i]) { all++; if (mark.data[i * 4]) hit++; }
    const covered = hit / Math.max(1, all);
    return {
        id, lines: lines.length, found: found.length, covered: +covered.toFixed(3),
        damaged: +deOn(img.clean, img.px, img.damage).toFixed(3),
        hand: +deOn(img.clean, fill(img, hand), img.damage).toFixed(3),
        auto: +deOn(img.clean, fill(img, found), img.damage).toFixed(3)
    };
});
for (const r of rows) if (r.covered < 0.8) fails.push(`${r.id}: the lines found cover ${Math.round(r.covered * 100)}% of the damage (at least 80%)`);

// Not scratched: nothing found
for (const scene of ['family', 'beach', 'grass', 'interior', 'sunset']) {
    const img = scratched(scenes[scene](), []);
    const f = Retouch.findScratches({ width: img.w, height: img.h, data: img.px });
    if (f.length) fails.push(`${scene} (not scratched): ${f.length} line${f.length === 1 ? '' : 's'} found`);
}

const mean = (k) => +(rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(3);
console.log('scratch kit (ΔE2000 on the damaged pixels against the clean scene; lower is better)');
console.log('  case                damaged    by hand   found  (lines found / drawn, damage covered)');
for (const r of rows) console.log('  ' + r.id.padEnd(20) + String(r.damaged).padStart(7) + String(r.hand).padStart(11) + String(r.auto).padStart(8) + `  (${r.found} / ${r.lines}, ${Math.round(r.covered * 100)}%)`);
console.log('  ' + 'mean'.padEnd(20) + ''.padStart(7) + String(mean('hand')).padStart(11) + String(mean('auto')).padStart(8));

const file = path.join(__dirname, 'restore-kit', 'scratch-scores.json');
if (process.argv.includes('--update')) {
    const cases = {};
    for (const r of rows) cases[r.id] = { hand: r.hand, auto: r.auto };
    fs.writeFileSync(file, JSON.stringify({ hand: mean('hand'), auto: mean('auto'), cases }, null, 2) + '\n');
    console.log('  scores written');
} else if (fs.existsSync(file)) {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const r of rows) {
        const was = kept.cases[r.id];
        if (!was) { fails.push(r.id + ': no score kept (run with --update)'); continue; }
        for (const k of ['hand', 'auto']) if (r[k] > was[k] + CASE_SLACK) fails.push(`${r.id} (${k}): ${was[k]} → ${r[k]}`);
    }
    for (const k of ['hand', 'auto']) if (mean(k) > kept[k] + MEAN_SLACK) fails.push(`mean (${k}): ${kept[k]} → ${mean(k)}`);
} else fails.push('no scores kept: run node test/scratch.test.js --update');

if (fails.length) {
    for (const f of fails) console.log('  FAIL: ' + f);
    process.exit(1);
}
console.log('  ok');
