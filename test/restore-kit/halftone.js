// Printed photos for the descreen kit: a kit scene (scenes.js) made bigger
// and printed as a magazine or newspaper prints it, in dots of ink on a
// screen, then scanned. All made here, so it's the same on every machine.
//
//   halftone(scene, { period, mono, scale }) → { print, ideal, light }
//     print: as scanned (each pixel the average of the dots it covers)
//     ideal: the dots mixed as a picture made smaller mixes them (the
//            average of their encoded colours, each ink combination
//            weighted by how much of the paper it covers): what a perfect
//            descreen gives that matches the photo's previews and
//            thumbnails (the score is against this, so the inks' own
//            colour, which no descreen can change, isn't counted)
//     light: the same inks mixed in linear light, as the eye mixes them
//            (lighter: what the print really looks like; kept for
//            measuring, see docs/plan-adjust-paint.md)
//
// Colour is four screens, cyan 15°, magenta 75°, yellow 0°, black 45° (the
// usual angles, which make the rosette); mono is black alone at 45°, as a
// newspaper's black and white photo. A dot's coverage is what the ink's
// share of the pixel asks for (the spot is a round-to-square cosine dot,
// its coverage curve measured below so the share is exact).

const INK = {
    c: [0.14, 0.58, 0.88], m: [0.86, 0.2, 0.52], y: [0.94, 0.88, 0.1], k: [0.05, 0.05, 0.06]
};
const PAPER = [0.93, 0.92, 0.88];
const ANGLE = { c: 15, m: 75, y: 0, k: 45 };

const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const enc = (v) => { v = Math.min(1, Math.max(0, v)); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };

// The spot (cos u + cos v) / 2 is above t over this share of a cell:
// tabulated, so a coverage can be turned into the t that gives it
const T_STEPS = 512;
const AREA = (() => {
    const n = 128, vals = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        vals.push((Math.cos(2 * Math.PI * (i + 0.5) / n) + Math.cos(2 * Math.PI * (j + 0.5) / n)) / 2);
    }
    vals.sort((a, b) => b - a);
    // threshold for coverage a = the value a share of the way down
    const t = new Float32Array(T_STEPS + 1);
    for (let k = 0; k <= T_STEPS; k++) {
        const a = k / T_STEPS;
        t[k] = a <= 0 ? 1.01 : a >= 1 ? -1.01 : vals[Math.min(vals.length - 1, Math.round(a * vals.length) - 1)];
    }
    return t;
})();
const thresh = (a) => AREA[Math.round(Math.min(1, Math.max(0, a)) * T_STEPS)];

// sRGB → ink shares (simple under-colour removal: black takes 70% of the grey)
function inks(r, g, b, mono) {
    if (mono) {
        // black alone, darkening the paper to the pixel's lightness
        const Y = 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
        const Yp = 0.2126 * PAPER[0] + 0.7152 * PAPER[1] + 0.0722 * PAPER[2];
        const Yk = 0.2126 * INK.k[0] + 0.7152 * INK.k[1] + 0.0722 * INK.k[2];
        return { k: Math.min(1, Math.max(0, (Yp - Y) / (Yp - Yk))) };
    }
    let c = 1 - r / 255, m = 1 - g / 255, y = 1 - b / 255;
    const k = 0.7 * Math.min(c, m, y);
    const left = 1 - k;
    return { c: (c - k) / left, m: (m - k) / left, y: (y - k) / left, k };
}

// Bilinear: the little scene made `scale` times bigger
function enlarge(scene, scale) {
    const W = scene.w * scale, H = scene.h * scale, out = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const fx = Math.min(scene.w - 1, Math.max(0, (x + 0.5) / scale - 0.5)), fy = Math.min(scene.h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(scene.w - 1, x0 + 1), y1 = Math.min(scene.h - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        for (let c = 0; c < 3; c++) {
            const p = (xx, yy) => scene.px[(yy * scene.w + xx) * 4 + c];
            out[(y * W + x) * 3 + c] = (p(x0, y0) * (1 - tx) + p(x1, y0) * tx) * (1 - ty) + (p(x0, y1) * (1 - tx) + p(x1, y1) * tx) * ty;
        }
    }
    return { W, H, rgb: out };
}

function halftone(scene, { period = 5, mono = false, scale = 3, sub = 4 } = {}) {
    const { W, H, rgb } = enlarge(scene, scale);
    const print = new Uint8ClampedArray(W * H * 4), ideal = new Uint8ClampedArray(W * H * 4), light = new Uint8ClampedArray(W * H * 4);
    const names = mono ? ['k'] : ['c', 'm', 'y', 'k'];
    const rot = names.map(n => { const a = ANGLE[n] * Math.PI / 180; return [Math.cos(a) / period, Math.sin(a) / period]; });
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const share = inks(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], mono);
        const ts = names.map(n => thresh(share[n]));
        // the ideal: each ink spread evenly over the pixel (Demichel: the
        // screens are at different angles, so their overlaps are by chance)
        const id = PAPER.slice();
        names.forEach((n) => { for (let c = 0; c < 3; c++) id[c] *= 1 - share[n] * (1 - INK[n][c]); });
        // the mix: every combination of inks over the paper, by its share
        const mix = [0, 0, 0];
        for (let combo = 0; combo < 1 << names.length; combo++) {
            let wgt = 1;
            const refl = PAPER.slice();
            names.forEach((n, k) => {
                const on = combo >> k & 1;
                wgt *= on ? share[n] : 1 - share[n];
                if (on) for (let c = 0; c < 3; c++) refl[c] *= INK[n][c];
            });
            if (wgt) for (let c = 0; c < 3; c++) mix[c] += wgt * enc(refl[c]);
        }
        const acc = [0, 0, 0];
        for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
            const px = x + (sx + 0.5) / sub, py = y + (sy + 0.5) / sub;
            const refl = PAPER.slice();
            names.forEach((n, k) => {
                const [cs, sn] = rot[k];
                const u = px * cs + py * sn, v = -px * sn + py * cs;
                const spot = (Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v)) / 2;
                if (spot > ts[k]) for (let c = 0; c < 3; c++) refl[c] *= INK[n][c];
            });
            for (let c = 0; c < 3; c++) acc[c] += refl[c];
        }
        // the scanner: a little noise
        const noise = (rnd() + rnd() - 1) * 1.5;
        for (let c = 0; c < 3; c++) {
            print[i * 4 + c] = enc(acc[c] / (sub * sub)) + noise;
            ideal[i * 4 + c] = mix[c];
            light[i * 4 + c] = enc(id[c]);
        }
        print[i * 4 + 3] = ideal[i * 4 + 3] = light[i * 4 + 3] = 255;
    }
    return { w: W, h: H, print, ideal, light };
}

module.exports = { halftone };
