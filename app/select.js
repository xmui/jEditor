// Select: masks found in the photo itself, for Adjust's Sky and Subject
// masks (adjust-masks.js). There's no model to run in the browser, so it's
// done the old way, from colour, brightness, texture and sharpness, on a
// small copy of the whole photo (as on disk):
//
//   sky:     smooth, bright (or blue) ground along the top, grown down
//            until an edge stops it, then the same colours seen through
//            gaps lower down (between branches), and its edge refined by
//            which colour each pixel is nearer, sky or not
//   subject: what stands out from the colours round the frame's edge and
//            is sharper than the background, nearer the middle counting
//            more; the biggest such region (and those nearly as big), holes
//            filled, then refined a few times by the colours inside and out
//
// Each gives a soft map (0–1) on the photo, stored compactly with the mask
// (`map: { w, h, d }`, 16 levels, run-length coded) so it's the same every
// time the photo is shown, and drawn into the brush maps (develop.js), so
// the GPU and the CPU need nothing new. It can be touched up with the brush.

const Select = {
    EDGE: 320,      // the copy looked at, its long side
    STORE: 256,     // the map kept, its long side

    // ---- The picture ----

    // A small copy of a canvas or bitmap: { w, h, r, g, b, L } (0–1 floats)
    prepare(src, edge = this.EDGE) {
        const s = Math.min(1, edge / Math.max(src.width, src.height));
        const w = Math.max(8, Math.round(src.width * s)), h = Math.max(8, Math.round(src.height * s));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.imageSmoothingQuality = 'high';
        g.drawImage(src, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        c.width = c.height = 0;
        const n = w * h, r = new Float32Array(n), gg = new Float32Array(n), b = new Float32Array(n), L = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            r[i] = d[i * 4] / 255; gg[i] = d[i * 4 + 1] / 255; b[i] = d[i * 4 + 2] / 255;
            L[i] = 0.299 * r[i] + 0.587 * gg[i] + 0.114 * b[i];
        }
        return { w, h, r, g: gg, b, L };
    },

    blur(src, w, h, rad) {
        return Retouch.blur(src, w, h, Math.max(1, Math.round(rad)));
    },

    // Colour edges: the biggest change to a neighbour, of any channel
    edges(P) {
        const { w, h } = P;
        const E = new Float32Array(w * h);
        const ch = [P.r, P.g, P.b].map(c => this.blur(c, w, h, 1));
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const xl = x > 0 ? i - 1 : i, xr = x < w - 1 ? i + 1 : i, yu = y > 0 ? i - w : i, yd = y < h - 1 ? i + w : i;
            let m = 0;
            for (const c of ch) m = Math.max(m, Math.hypot(c[xr] - c[xl], c[yd] - c[yu]) / 2);
            E[i] = m;
        }
        return E;
    },

    // Texture: how much the brightness varies right round each pixel
    texture(P) {
        const { w, h, L } = P;
        const mean = this.blur(L, w, h, 1);
        const sq = new Float32Array(w * h);
        for (let i = 0; i < sq.length; i++) { const d = L[i] - mean[i]; sq[i] = d * d; }
        const v = this.blur(sq, w, h, 1);
        for (let i = 0; i < v.length; i++) v[i] = Math.sqrt(v[i]);
        return v;
    },

    // ---- Sky ----

    sky(src) {
        const P = this.prepare(src);
        const { w, h, r, g, b, L } = P;
        const n = w * h;
        const E = this.edges(P), T = this.texture(P);
        const skyLike = (i) => {
            if (L[i] < 0.3 || T[i] > 0.035) return false;
            const sat = Math.max(r[i], g[i], b[i]) - Math.min(r[i], g[i], b[i]);
            const blue = b[i] - (r[i] + g[i]) / 2;
            return blue > 0.02 || (sat < 0.18 && L[i] > 0.5) || L[i] > 0.75;
        };
        // Seeds: along the top
        const mask = new Uint8Array(n);
        const stack = [];
        const top = Math.max(2, Math.round(h * 0.12));
        let seeds = 0;
        for (let y = 0; y < top; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (skyLike(i)) { mask[i] = 1; stack.push(i); seeds++; }
        }
        if (seeds < w * top * 0.15) return null;
        // Grown down and across until an edge
        const step = (i, j) => Math.abs(r[i] - r[j]) + Math.abs(g[i] - g[j]) + Math.abs(b[i] - b[j]);
        while (stack.length) {
            const i = stack.pop();
            const x = i % w, y = (i - x) / w;
            for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
                if (j < 0 || mask[j]) continue;
                if (E[j] > 0.045 || T[j] > 0.05 || L[j] < 0.22 || step(i, j) > 0.06) continue;
                mask[j] = 1;
                stack.push(j);
            }
        }
        let area = 0, lowest = 0;
        for (let i = 0; i < n; i++) if (mask[i]) { area++; lowest = Math.max(lowest, Math.floor(i / w)); }
        if (area < n * 0.03) return null;
        // The sky's colour row by row (it changes towards the horizon)
        const rows = [];
        for (let y = 0; y < h; y++) {
            let k = 0, sr = 0, sg = 0, sb = 0;
            for (let x = 0; x < w; x++) { const i = y * w + x; if (mask[i]) { k++; sr += r[i]; sg += g[i]; sb += b[i]; } }
            rows.push(k ? { k, c: [sr / k, sg / k, sb / k] } : null);
        }
        const rowColour = (y) => {
            for (let d = 0; d < h; d++) {
                const a = rows[y - d], c = rows[y + d];
                if (a && a.k > 2) return a.c;
                if (c && c.k > 2) return c.c;
            }
            return null;
        };
        // Sky seen through gaps, above where the sky reaches
        const soft = new Float32Array(n);
        for (let i = 0; i < n; i++) soft[i] = mask[i];
        for (let y = 0; y <= Math.min(h - 1, lowest); y++) {
            const sc = rowColour(y);
            if (!sc) continue;
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (mask[i] || T[i] > 0.09) continue;
                const d = Math.abs(r[i] - sc[0]) + Math.abs(g[i] - sc[1]) + Math.abs(b[i] - sc[2]);
                if (d < 0.12) soft[i] = Math.max(soft[i], 1 - d / 0.12);
            }
        }
        // The edge: each pixel near it as near the sky's colour as it is
        // to what's round it that isn't sky
        const out = this.refineEdge(P, soft, (y) => rowColour(y));
        return this.done(out, w, h);
    },

    // Near the boundary of a soft mask, each pixel set by whether its colour
    // is nearer the masked colour (fg(y), or the local masked mean) or the
    // unmasked colour round it
    refineEdge(P, m, fg) {
        const { w, h, r, g, b } = P;
        const n = w * h;
        const sm = this.blur(m, w, h, 1);
        // Local means of the colours in and out (7×7, by box sums)
        const inW = new Float32Array(n), outW = new Float32Array(n);
        const inC = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], outC = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (let i = 0; i < n; i++) {
            const k = m[i] > 0.5 ? 1 : 0;
            inW[i] = k; outW[i] = 1 - k;
            [r, g, b].forEach((c, j) => { inC[j][i] = c[i] * k; outC[j][i] = c[i] * (1 - k); });
        }
        const R = 3;
        const bw = [inW, outW, ...inC, ...outC].map(a => this.blur(a, w, h, R));
        const out = new Float32Array(sm);
        for (let i = 0; i < n; i++) {
            if (sm[i] <= 0.03 || sm[i] >= 0.97) continue;
            const y = Math.floor(i / w);
            const wi = bw[0][i], wo = bw[1][i];
            if (wo < 1e-3) continue;
            let ci = wi > 1e-3 ? [bw[2][i] / wi, bw[3][i] / wi, bw[4][i] / wi] : (fg && fg(y));
            if (!ci) continue;
            const co = [bw[5][i] / wo, bw[6][i] / wo, bw[7][i] / wo];
            const di = Math.abs(r[i] - ci[0]) + Math.abs(g[i] - ci[1]) + Math.abs(b[i] - ci[2]);
            const dout = Math.abs(r[i] - co[0]) + Math.abs(g[i] - co[1]) + Math.abs(b[i] - co[2]);
            const p = dout / Math.max(1e-4, di + dout);
            out[i] = Math.min(1, Math.max(0, (p - 0.5) * 2.5 + 0.5));
        }
        return out;
    },

    // ---- Subject ----

    subject(src) {
        const P = this.prepare(src, 256);
        const { w, h, r, g, b, L } = P;
        const n = w * h;
        // Opponent colours: brightness, red–green, yellow–blue
        const f = (i) => [L[i] * 1.2, (r[i] - g[i]), ((r[i] + g[i]) / 2 - b[i])];
        // The background's colours: k-means of the frame's edge
        const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
        const border = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (x < band || y < band || x >= w - band || y >= h - band) border.push(f(y * w + x));
        }
        const bg = this.kmeans(border, 5);
        const dist = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
        const C = new Float32Array(n);
        for (let i = 0; i < n; i++) { const p = f(i); let d = Infinity; for (const c of bg) d = Math.min(d, dist(p, c)); C[i] = d; }
        this.normalise(C, 0.98);
        // Sharpness: detail energy, compared between the middle and the edge
        const E = this.edges(P);
        const F = this.blur(E, w, h, 3);
        let mid = 0, kMid = 0, edge = 0, kEdge = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (x < band || y < band || x >= w - band || y >= h - band) { edge += F[i]; kEdge++; }
            else if (Math.abs(x / w - 0.5) < 0.25 && Math.abs(y / h - 0.5) < 0.25) { mid += F[i]; kMid++; }
        }
        const focusGain = Math.min(1, Math.max(0, (mid / Math.max(1, kMid)) / Math.max(1e-4, edge / Math.max(1, kEdge)) - 1.2));
        this.normalise(F, 0.95);
        // Together, the middle counting more
        let S = new Float32Array(n);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const dx = x / w - 0.5, dy = y / h - 0.52;
            const prior = Math.exp(-(dx * dx) / (2 * 0.28 * 0.28) - (dy * dy) / (2 * 0.32 * 0.32));
            S[i] = (0.65 * C[i] + 0.35 * F[i] * focusGain + 0.25 * C[i] * (1 - focusGain)) * (0.3 + 0.7 * prior);
        }
        S = this.blur(S, w, h, 2);
        const t = this.otsu(S);
        let mask = new Uint8Array(n);
        for (let i = 0; i < n; i++) mask[i] = S[i] > t ? 1 : 0;
        mask = this.biggest(mask, w, h, 0.25);
        this.fillHoles(mask, w, h);
        let area = mask.reduce((a, v) => a + v, 0);
        if (area < n * 0.01 || area > n * 0.92) return null;
        // Refined by the colours in and out, near the boundary
        for (let it = 0; it < 3; it++) {
            const inside = [], outside = [];
            for (let i = 0; i < n; i += 2) (mask[i] ? inside : outside).push(f(i));
            if (inside.length < 8 || outside.length < 8) break;
            const fg = this.kmeans(inside, 3), bk = this.kmeans(outside, 4);
            const dec = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const p = f(i);
                let df = Infinity, db = Infinity;
                for (const c of fg) df = Math.min(df, dist(p, c));
                for (const c of bk) db = Math.min(db, dist(p, c));
                dec[i] = db - df;
            }
            const sd = this.blur(dec, w, h, 1);
            const near = this.blur(Float32Array.from(mask), w, h, 4);
            for (let i = 0; i < n; i++) if (near[i] > 0.02 && near[i] < 0.98) mask[i] = sd[i] > 0 ? 1 : 0;
            mask = this.biggest(mask, w, h, 0.25);
            this.fillHoles(mask, w, h);
        }
        area = mask.reduce((a, v) => a + v, 0);
        if (area < n * 0.01 || area > n * 0.92) return null;
        const soft = this.blur(Float32Array.from(mask), w, h, 1);
        return this.done(soft, w, h);
    },

    // ---- Helpers ----

    kmeans(pts, k, iters = 8) {
        if (!pts.length) return [[0, 0, 0]];
        k = Math.min(k, pts.length);
        // Spread out to start: the first, then each the farthest from those so far
        const cs = [pts[0].slice()];
        while (cs.length < k) {
            let best = null, bd = -1;
            for (let i = 0; i < pts.length; i += Math.max(1, pts.length >> 9)) {
                let d = Infinity;
                for (const c of cs) d = Math.min(d, Math.hypot(pts[i][0] - c[0], pts[i][1] - c[1], pts[i][2] - c[2]));
                if (d > bd) { bd = d; best = pts[i]; }
            }
            cs.push(best.slice());
        }
        for (let it = 0; it < iters; it++) {
            const sum = cs.map(() => [0, 0, 0, 0]);
            for (const p of pts) {
                let bi = 0, bd = Infinity;
                cs.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = j; } });
                const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
            }
            sum.forEach((s, j) => { if (s[3]) cs[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
        }
        return cs;
    },

    // Scaled so the value at percentile p is 1 (and capped there)
    normalise(a, p) {
        const sorted = Float32Array.from(a).sort();
        const top = Math.max(1e-6, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
        for (let i = 0; i < a.length; i++) a[i] = Math.min(1, a[i] / top);
    },

    otsu(a) {
        const bins = new Float64Array(256);
        let mx = 0;
        for (const v of a) mx = Math.max(mx, v);
        if (mx <= 0) return 1;
        for (const v of a) bins[Math.min(255, Math.floor(v / mx * 255))]++;
        const total = a.length;
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * bins[i];
        let sumB = 0, wB = 0, best = 0, at = 0;
        for (let i = 0; i < 256; i++) {
            wB += bins[i];
            if (!wB) continue;
            const wF = total - wB;
            if (!wF) break;
            sumB += i * bins[i];
            const mB = sumB / wB, mF = (sum - sumB) / wF;
            const between = wB * wF * (mB - mF) ** 2;
            if (between > best) { best = between; at = i; }
        }
        return (at + 0.5) / 255 * mx;
    },

    // The biggest region, and any at least `keep` times its size
    biggest(mask, w, h, keep) {
        const n = w * h, lab = new Int32Array(n).fill(-1), sizes = [];
        for (let s = 0; s < n; s++) {
            if (!mask[s] || lab[s] >= 0) continue;
            const id = sizes.length, stack = [s];
            lab[s] = id;
            let k = 0;
            while (stack.length) {
                const i = stack.pop();
                k++;
                const x = i % w, y = (i - x) / w;
                for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
                    if (j >= 0 && mask[j] && lab[j] < 0) { lab[j] = id; stack.push(j); }
                }
            }
            sizes.push(k);
        }
        if (!sizes.length) return mask;
        const most = Math.max(...sizes);
        const out = new Uint8Array(n);
        for (let i = 0; i < n; i++) if (lab[i] >= 0 && sizes[lab[i]] >= most * keep) out[i] = 1;
        return out;
    },

    // Holes inside a region filled (what the frame's edge can't reach)
    fillHoles(mask, w, h) {
        const n = w * h, out = new Uint8Array(n), stack = [];
        const push = (i) => { if (!mask[i] && !out[i]) { out[i] = 1; stack.push(i); } };
        for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
        while (stack.length) {
            const i = stack.pop();
            const x = i % w, y = (i - x) / w;
            if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
            if (y > 0) push(i - w); if (y < h - 1) push(i + w);
        }
        for (let i = 0; i < n; i++) if (!out[i]) mask[i] = 1;
    },

    // A soft map at w × h, resized to be kept: { w, h, d } (or null if empty)
    done(m, w, h) {
        let any = false;
        for (const v of m) if (v > 0.06) { any = true; break; }
        if (!any) return null;
        const s = Math.min(1, this.STORE / Math.max(w, h));
        const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
        const q = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            // Area average of the cells it covers
            const x0 = Math.floor(x / s), x1 = Math.max(x0 + 1, Math.floor((x + 1) / s));
            const y0 = Math.floor(y / s), y1 = Math.max(y0 + 1, Math.floor((y + 1) / s));
            let sum = 0, k = 0;
            for (let yy = y0; yy < Math.min(h, y1); yy++) for (let xx = x0; xx < Math.min(w, x1); xx++) { sum += m[yy * w + xx]; k++; }
            q[y * W + x] = Math.round(Math.min(1, Math.max(0, sum / Math.max(1, k))) * 15);
        }
        return { w: W, h: H, d: this.encode(q) };
    },

    // ---- Kept compactly ----
    //
    // 16 levels, run-length coded: each run a hex digit (its level) and its
    // length in base 36, runs separated by dots: "0ab.f1c.…"

    encode(q) {
        let out = '', i = 0;
        while (i < q.length) {
            let j = i + 1;
            while (j < q.length && q[j] === q[i]) j++;
            out += q[i].toString(16) + (j - i).toString(36) + '.';
            i = j;
        }
        return out;
    },

    // Levels 0–15 (Uint8Array of w × h), or null if it doesn't add up
    decode(map) {
        if (!map || !Number.isInteger(map.w) || !Number.isInteger(map.h) || typeof map.d !== 'string') return null;
        const n = map.w * map.h;
        if (map.w < 1 || map.h < 1 || map.w > 1024 || map.h > 1024) return null;
        const q = new Uint8Array(n);
        let o = 0;
        for (const run of map.d.split('.')) {
            if (!run) continue;
            const v = parseInt(run[0], 16), len = parseInt(run.slice(1), 36);
            if (!(v >= 0 && v <= 15) || !(len > 0) || o + len > n) return null;
            q.fill(v, o, o + len);
            o += len;
        }
        return o === n ? q : null;
    }
};
