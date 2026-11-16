// Paint's healing: the pixels for the spot healing brush, the healing
// brush and the clone stamp (paint-editor.js paints their strokes).
//
// Healing works the way Adjust's spot removal does (retouch.js): the
// source's texture is copied in, and the difference between what was
// there and the source, along the edge of what's painted, is spread
// smoothly over the inside (a membrane, relaxed on a small grid). Adjust's
// spots are circles; a stroke is any shape, so here the edge is wherever
// the stroke stops, not a circle's edge. Picking a source for spot healing
// is Retouch.autoSource's way too: the place nearby whose surroundings
// look most like the stroke's, never overlapping it.
//
// Everything is RGBA ImageData in layer pixels: `D` what's there now (in a
// box round the stroke), `S` the source (the same box, shifted), `M` the
// stroke (its alpha is how much of each pixel is healed).

const PaintHeal = {
    // A stroke's pixels from (dx, dy) away (spot heal): the box `area`
    // (ImageData at ax, ay) has the stroke's box (bx, by, M) inside it with
    // room round it to look; R is the brush's radius. Returns { dx, dy }
    findSource(area, ax, ay, M, bx, by, R) {
        const aw = area.width, ah = area.height, bw = M.width, bh = M.height, A = M.data;
        const Y = Retouch.luma(area);
        const inM = (x, y) => x >= 0 && y >= 0 && x < bw && y < bh ? A[(y * bw + x) * 4 + 3] : 0;
        // The stroke's pixels, and a ring just outside it (what the
        // source's ring should match), a few hundred of each
        const inside = [], ring = [];
        const reach = [2, Math.max(3, Math.round(R * 0.3)), Math.max(4, Math.round(R * 0.6))];
        let x0 = bw, y0 = bh, x1 = -1, y1 = -1;
        for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
                const a = A[(y * bw + x) * 4 + 3];
                if (a >= 128) {
                    inside.push([x, y]);
                    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
                } else if (a < 32) {
                    for (const k of reach) {
                        if (inM(x - k, y) >= 128 || inM(x + k, y) >= 128 || inM(x, y - k) >= 128 || inM(x, y + k) >= 128) { ring.push([x, y]); break; }
                    }
                }
            }
        }
        const fallback = { dx: Math.round(R * 2.5), dy: 0 };
        if (!inside.length) return fallback;
        const thin = (list, most) => {
            if (list.length <= most) return list;
            const step = list.length / most, out = [];
            for (let i = 0; i < most; i++) out.push(list[Math.floor(i * step)]);
            return out;
        };
        const ins = thin(inside, 300), rng = thin(ring, 400);
        // (in the area: the stroke's box is at bx - ax, by - ay in it)
        const ox = bx - ax, oy = by - ay;
        const at = (x, y) => Y[(y + oy) * aw + x + ox];
        const want = rng.map(([x, y]) => at(x, y));
        const wantMean = want.length ? want.reduce((a, b) => a + b, 0) / want.length : ins.reduce((a, [x, y]) => a + at(x, y), 0) / ins.length;
        // How far to look: a few brushes, or a few times the stroke's width
        // (whichever's further), all the way round
        const ext = Math.max(1, Math.min(x1 - x0, y1 - y0) / 2);
        const dists = [...new Set([2.3, 3, 4, 5.5].map(k => k * R).concat([2.3, 3, 4].map(k => k * ext + R)).map(Math.round))];
        let best = null;
        for (const dist of dists) {
            for (let a = 0; a < 24; a++) {
                const t = a / 24 * Math.PI * 2 + dist;
                const dx = Math.round(Math.cos(t) * dist), dy = Math.round(Math.sin(t) * dist);
                // (every pixel of the stroke: a thin crossing is easily missed)
                let ok = true;
                for (const [x, y] of inside) {
                    const u = x + dx + ox, v = y + dy + oy;
                    if (u < 0 || v < 0 || u >= aw || v >= ah || inM(x + dx, y + dy) >= 32) { ok = false; break; }
                }
                if (!ok) continue;
                let e = 0, n = 0;
                for (let i = 0; i < rng.length; i++) {
                    const [x, y] = rng[i], u = x + dx + ox, v = y + dy + oy;
                    if (u < 0 || v < 0 || u >= aw || v >= ah) continue;
                    const d = Y[v * aw + u] - want[i];
                    e += d * d;
                    n++;
                }
                if (rng.length && n < rng.length * 0.6) continue;
                e /= Math.max(1, n);
                // Its inside should be as plain as the stroke's surroundings
                let s = 0;
                for (const [x, y] of ins) { const d = at(x + dx, y + dy) - wantMean; s += d * d; }
                s /= ins.length;
                const score = e + 0.5 * s + 0.0004 * dist / Math.max(1, R);
                if (!best || score < best.score) best = { score, dx, dy };
            }
        }
        return best ? { dx: best.dx, dy: best.dy } : fallback;
    },

    // The stroke healed: S (the source) in the colour and brightness round
    // the stroke in D. Returns new ImageData: S plus the difference spread
    // over the inside, with M's alpha (S's where it's thinner)
    heal(D, S, M) {
        const w = M.width, h = M.height, d = D.data, s = S.data, m = M.data;
        // Cells: up to 64 along the long side, at least a pixel each
        const G = Math.max(3, Math.min(64, Math.max(w, h)));
        const cell = Math.max(w, h) / G;
        const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2; // a ring all round
        const N = gw * gh;
        const val = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
        const cnt = new Float32Array(N), fixed = new Uint8Array(N);
        const ci = (x) => Math.min(gw - 1, Math.floor(x / cell) + 1), cj = (y) => Math.min(gh - 1, Math.floor(y / cell) + 1);
        // The difference, cell by cell, from the pixels the stroke barely
        // reaches (and that have a source, and something there)
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                if (m[i + 3] >= 32 || !s[i + 3] || !d[i + 3]) continue;
                const k = cj(y + 0.5) * gw + ci(x + 0.5);
                for (let c = 0; c < 3; c++) val[c][k] += d[i + c] - s[i + c];
                cnt[k]++;
            }
        }
        let mean = [0, 0, 0], n = 0;
        for (let k = 0; k < N; k++) {
            if (!cnt[k]) continue;
            for (let c = 0; c < 3; c++) { val[c][k] /= cnt[k]; mean[c] += val[c][k]; }
            fixed[k] = 1;
            n++;
        }
        const out = new ImageData(w, h), o = out.data;
        if (n) {
            mean = mean.map(v => v / n);
            for (let k = 0; k < N; k++) if (!fixed[k]) for (let c = 0; c < 3; c++) val[c][k] = mean[c];
            // The ring of cells all round, if empty, holds the mean
            for (let k = 0; k < N; k++) if (!fixed[k]) {
                const gi = k % gw, gj = (k - gi) / gw;
                if (gi === 0 || gj === 0 || gi === gw - 1 || gj === gh - 1) fixed[k] = 1;
            }
            // Relaxed (over-relaxed Gauss–Seidel), as retouch.js does
            const iters = Math.min(600, 20 + Math.max(gw, gh) * 8);
            for (let it = 0; it < iters; it++) {
                for (let gj = 1; gj < gh - 1; gj++) {
                    for (let gi = 1; gi < gw - 1; gi++) {
                        const k = gj * gw + gi;
                        if (fixed[k]) continue;
                        for (let c = 0; c < 3; c++) {
                            const v = val[c];
                            v[k] += 1.85 * ((v[k - 1] + v[k + 1] + v[k - gw] + v[k + gw]) / 4 - v[k]);
                        }
                    }
                }
            }
        }
        // Each pixel: the source plus the field there (smoothly between
        // the cells' middles)
        for (let y = 0; y < h; y++) {
            const fy = (y + 0.5) / cell + 0.5, j0 = Math.min(gh - 2, Math.max(0, Math.floor(fy))), ty = Math.min(1, Math.max(0, fy - j0));
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                if (!m[i + 3] || !s[i + 3]) continue;
                const fx = (x + 0.5) / cell + 0.5, i0 = Math.min(gw - 2, Math.max(0, Math.floor(fx))), tx = Math.min(1, Math.max(0, fx - i0));
                const k = j0 * gw + i0;
                for (let c = 0; c < 3; c++) {
                    let f = 0;
                    if (n) {
                        const v = val[c];
                        const top = v[k] + (v[k + 1] - v[k]) * tx, bot = v[k + gw] + (v[k + gw + 1] - v[k + gw]) * tx;
                        f = top + (bot - top) * ty;
                    }
                    o[i + c] = s[i + c] + f; // (clamped by the array)
                }
                o[i + 3] = Math.round(m[i + 3] * s[i + 3] / 255);
            }
        }
        return out;
    }
};
