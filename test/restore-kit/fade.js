// Fading, simulated the way dyes fade: in density, not in RGB. A colour
// print or slide has three dye layers: cyan (which takes red out of the
// light), magenta (green) and yellow (blue). Each pixel's red, green and
// blue are turned into those densities (D = −log10 of the light let
// through), each layer loses a share of its dye (k: what's left), with a
// little of each layer's loss showing in the others (the dyes aren't pure:
// Ando et al. 1997), a stain can add density (a print yellowing), and the
// fade can be stronger towards the edges (light and air get at them
// first). Then back to sRGB.
//
//   fade(img, PROFILES.slideRed) → a new { w, h, px }

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toGamma = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

// Each profile: k (dye left in the cyan, magenta and yellow layers),
// stain (density added to the red, green and blue records), edge (how much
// more is lost at the corners than in the middle, 0: evenly), and the
// cross-layer coupling (each layer's loss seen in its neighbours)
const PROFILES = {
    // An E-6 slide gone red/magenta: the yellow and cyan dyes lost, magenta kept
    slideRed: { k: [0.55, 0.92, 0.5], stain: [0, 0, 0], edge: 0, couple: 0.06 },
    // A C-41 print that lost its cyan: red/orange all over
    printCyan: { k: [0.48, 0.86, 0.84], stain: [0, 0.01, 0.02], edge: 0, couple: 0.05 },
    // A print yellowed by its paper: the dyes a little faded, a stain over all
    yellowStain: { k: [0.86, 0.85, 0.82], stain: [0.0, 0.035, 0.2], edge: 0, couple: 0.04 },
    // A print faded all over: flat and pale, the dyes about evenly
    fadedPrint: { k: [0.68, 0.72, 0.66], stain: [0.01, 0.01, 0.03], edge: 0, couple: 0.05 },
    // Cyan lost more at the edges than in the middle
    unevenCyan: { k: [0.62, 0.9, 0.86], stain: [0, 0, 0.02], edge: 0.7, couple: 0.05 }
};

function fade(img, p) {
    const { w, h } = img, src = img.px, px = new Uint8ClampedArray(src.length);
    const c = p.couple || 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // How far out: 0 in the middle, 1 at a corner
        const dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5;
        const r2 = (dx * dx + dy * dy) / 0.5;
        const D = [0, 1, 2].map(k => -Math.log10(Math.max(1e-3, toLinear(src[i + k] / 255))));
        // What each layer keeps here (less towards the edges)
        const keep = p.k.map(k => Math.max(0.05, 1 - (1 - k) * (1 + (p.edge || 0) * (r2 - 0.4))));
        const lost = D.map((d, k) => d * (1 - keep[k]));
        const out = D.map((d, k) => {
            let v = d * keep[k];
            // A little of the neighbours' loss shows here too
            for (let j = 0; j < 3; j++) if (j !== k) v -= c * lost[j];
            return Math.max(0, v + (p.stain[k] || 0));
        });
        for (let k = 0; k < 3; k++) px[i + k] = Math.round(toGamma(Math.min(1, Math.pow(10, -out[k]))) * 255);
        px[i + 3] = 255;
    }
    return { w, h, px };
}

module.exports = { fade, PROFILES };
