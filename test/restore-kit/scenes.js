// The restore kit's photos: drawn here, from a seed, so they're ours to use
// (no downloaded images, no licences) and the same on every machine. Each
// is RGBA at 160 × 120, sRGB, with the things a faded print hides: skin, a
// sky, foliage, greys, a white and a black, and a little grain.
//
//   const { scenes } = require('./scenes'); scenes.family() → { w, h, px }

const W = 160, H = 120;

function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// A canvas of sorts: fill shapes with a colour (sRGB 0–255), then grain
function picture(seed, draw) {
    const px = new Uint8ClampedArray(W * H * 4);
    const set = (x, y, c) => { const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
    const at = (x, y) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    const g = {
        fill(c) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, c); },
        // top to bottom
        vgrad(y0, y1, c0, c1) { for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) set(x, y, mix(c0, c1, (y - y0) / Math.max(1, y1 - y0 - 1))); },
        rect(x0, y0, x1, y1, c) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c); },
        // an ellipse, shaded a little (lighter at the top left), as a face or a ball is
        blob(cx, cy, rx, ry, c, shade = 0.18) {
            for (let y = Math.max(0, cy - ry); y < Math.min(H, cy + ry); y++) for (let x = Math.max(0, cx - rx); x < Math.min(W, cx + rx); x++) {
                const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
                if (d > 1) continue;
                const k = 1 + shade * (-(dx + dy) / 2) - shade * 0.5 * d;
                set(x, y, c.map(v => v * k));
            }
        },
        at, set
    };
    draw(g);
    // Grain, as film has: the same in every channel, a little
    const r = rng(seed);
    for (let i = 0; i < px.length; i += 4) {
        const n = (r() + r() + r() - 1.5) * 6;
        px[i] += n; px[i + 1] += n; px[i + 2] += n;
    }
    return { w: W, h: H, px };
}

// A strip of reference patches along the bottom: black, greys, white, and
// the dyes' own colours, as a print often has somewhere (a wall, a shirt)
function patches(g, y0) {
    const cols = [[22, 22, 22], [70, 70, 70], [125, 125, 125], [185, 185, 185], [240, 240, 238], [175, 60, 50], [70, 140, 70], [60, 80, 160], [220, 190, 60], [190, 90, 150]];
    const w = Math.floor(W / cols.length);
    cols.forEach((c, i) => g.rect(i * w, y0, i === cols.length - 1 ? W : (i + 1) * w, H, c));
}

const scenes = {
    // Indoors: a grey wall, a face, a red jumper, jeans, a plant, a white card
    family: () => picture(11, g => {
        g.vgrad(0, 100, [150, 146, 140], [118, 114, 108]);
        g.rect(0, 70, 160, 100, [120, 84, 60]); // a wooden table
        g.blob(62, 38, 15, 19, [214, 168, 138]); // face
        g.blob(62, 20, 17, 8, [58, 40, 30], 0.1); // hair
        g.blob(62, 78, 26, 20, [178, 46, 42]); // jumper
        g.rect(40, 92, 84, 100, [50, 62, 104]); // jeans
        g.blob(126, 50, 18, 26, [64, 120, 52]); // a plant
        g.rect(120, 74, 132, 96, [120, 72, 40]); // its pot
        g.rect(96, 56, 112, 70, [242, 242, 236]); // a card
        g.rect(2, 2, 10, 12, [16, 16, 16]); // a black frame corner
        patches(g, 100);
    }),
    // A beach: mostly sky, sea and sand
    beach: () => picture(23, g => {
        g.vgrad(0, 48, [92, 150, 214], [178, 210, 236]);
        g.vgrad(48, 66, [40, 120, 150], [70, 150, 160]);
        g.vgrad(66, 120, [226, 204, 162], [198, 170, 126]);
        g.blob(50, 80, 5, 12, [200, 150, 120]); // a person
        g.blob(110, 86, 10, 4, [230, 60, 50]); // a towel
        g.blob(130, 20, 9, 9, [250, 248, 240], 0.02); // the sun's glare
        g.rect(4, 108, 18, 118, [30, 30, 30]); // a bag's shadow
    }),
    // A lawn: green from edge to edge, a red ball, a white fence
    grass: () => picture(37, g => {
        g.vgrad(0, 22, [160, 196, 228], [196, 218, 236]);
        g.vgrad(22, 120, [86, 150, 60], [52, 110, 36]);
        for (let x = 6; x < 160; x += 18) g.rect(x, 26, x + 6, 50, [236, 236, 230]); // fence posts
        g.rect(0, 32, 160, 36, [236, 236, 230]);
        g.blob(96, 92, 12, 12, [200, 40, 36]); // ball
        g.blob(40, 96, 8, 6, [30, 36, 24], 0.05); // a dark shadow
    }),
    // Lamplight: a warm room, a dark sofa, a lamp, a grey cat
    interior: () => picture(53, g => {
        g.vgrad(0, 120, [176, 150, 116], [96, 78, 60]);
        g.rect(14, 64, 110, 104, [52, 40, 52]); // sofa
        g.blob(132, 30, 12, 14, [252, 236, 200], 0.04); // lamp
        g.rect(128, 44, 136, 104, [40, 36, 32]); // its stand
        g.blob(60, 58, 14, 9, [128, 126, 122]); // a grey cat
        g.rect(80, 20, 104, 44, [60, 90, 120]); // a picture on the wall
        patches(g, 108);
    })
};

module.exports = { scenes, W, H };
