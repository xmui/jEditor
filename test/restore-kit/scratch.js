// Scratched and creased photos for the scratch kit: a kit scene made
// bigger (as a scan is) with lines drawn over it, the way scans have them:
// light scratches (a scratched print, dust in a film's scratch), a dark one
// (a scratch on a slide), and a crease (a bent print: a light, slightly
// ragged line that wanders). All made here, the same on every machine.
//
//   scratched(scene, lines, scale) → { w, h, px, clean, damage, lines }
//     lines: [{ pts: [[x, y], …] (in the big picture's pixels), width,
//              colour: [r, g, b], ragged }]
//     damage: 1 where a line touched the picture (what's scored)

const { enlarge } = require('./halftone');

function scratched(scene, lines, scale = 3) {
    const { W, H, rgb } = enlarge(scene, scale);
    const clean = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { for (let c = 0; c < 3; c++) clean[i * 4 + c] = rgb[i * 3 + c]; clean[i * 4 + 3] = 255; }
    const px = new Uint8ClampedArray(clean), damage = new Uint8Array(W * H);
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const L of lines) {
        // ragged: the width wanders along it
        const segs = [];
        for (let k = 0; k + 1 < L.pts.length; k++) segs.push([L.pts[k], L.pts[k + 1]]);
        const x0 = Math.max(0, Math.floor(Math.min(...L.pts.map(p => p[0])) - L.width - 2)), x1 = Math.min(W, Math.ceil(Math.max(...L.pts.map(p => p[0])) + L.width + 2));
        const y0 = Math.max(0, Math.floor(Math.min(...L.pts.map(p => p[1])) - L.width - 2)), y1 = Math.min(H, Math.ceil(Math.max(...L.pts.map(p => p[1])) + L.width + 2));
        const wob = Array.from({ length: 64 }, () => 1 + (L.ragged || 0) * (rnd() - 0.5) * 2);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            let d = Infinity, along = 0;
            for (const [[ax, ay], [bx, by]] of segs) {
                const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
                const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / l2));
                const dd = Math.hypot(x + 0.5 - ax - dx * t, y + 0.5 - ay - dy * t);
                if (dd < d) { d = dd; along = (ax + dx * t + ay + dy * t) / 6; }
            }
            const half = L.width / 2 * wob[Math.floor(Math.abs(along)) % 64];
            const cover = Math.max(0, Math.min(1, half + 0.5 - d));
            if (cover <= 0) continue;
            const i = y * W + x, a = cover * (L.alpha || 0.9);
            for (let c = 0; c < 3; c++) px[i * 4 + c] = px[i * 4 + c] + (L.colour[c] - px[i * 4 + c]) * a;
            damage[i] = 1;
        }
    }
    return { w: W, h: H, px, clean, damage, lines };
}

// A gentle curve through a, b, c, as points
function curve(a, b, c, n = 12) {
    const out = [];
    for (let k = 0; k <= n; k++) {
        const t = k / n, u = 1 - t;
        out.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]);
    }
    return out;
}

module.exports = { scratched, curve };
