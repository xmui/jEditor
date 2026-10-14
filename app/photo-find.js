// Finds photos on scans: prints on a flatbed's glass (one or many, each
// cropped by Auto crop or boxed in Preview and crop) and the photo on a
// sheet-feeder page.
//
//   1. The background: the colours round the scan's edge (a lid, a feeder's
//      backing and the plain fill past a short photo: up to three).
//   2. Flooded in from the edge, step by small step, so lid shading and a
//      backing that darkens are followed, but a print's edge stops it.
//      Whatever the flood didn't reach is a print (its inside too).
//   3. Each print: a group of those pixels; prints that touch are parted by
//      eating away at the group until it comes apart.
//   4. Each fitted with the smallest rectangle round it, at any tilt.
//   5. Each side moved to the strongest straight edge near it: the print's
//      very edge, or a white border's outer edge on a white lid (which the
//      flood can leak into), never a shadow.
//
// Works on a copy about 1000 px across; everything it returns is in the
// source's pixels.

const PhotoFind = {
    EDGE: 1000,

    // The source (an image, canvas or bitmap, W × H) small enough to work on
    pixels(src, W, H, edge = this.EDGE) {
        const k = Math.min(1, edge / Math.max(W, H));
        const w = Math.max(16, Math.round(W * k)), h = Math.max(16, Math.round(H * k));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        canvas.width = canvas.height = 0;
        return { d, w, h, sx: W / w, sy: H / h };
    },

    // ---- The pieces ----

    // 3 × 3 average of R, G and B (scanner grain and JPEG blocks smoothed)
    smooth(d, w, h) {
        const n = w * h;
        const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (let c = 0; c < 3; c++) {
            const row = new Float32Array(n), o = out[c];
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const a = x > 0 ? x - 1 : x, b = x < w - 1 ? x + 1 : x;
                    row[y * w + x] = (d[(y * w + a) * 4 + c] + d[(y * w + x) * 4 + c] + d[(y * w + b) * 4 + c]) / 3;
                }
            }
            for (let y = 0; y < h; y++) {
                const ya = y > 0 ? y - 1 : y, yb = y < h - 1 ? y + 1 : y;
                for (let x = 0; x < w; x++) o[y * w + x] = (row[ya * w + x] + row[y * w + x] + row[yb * w + x]) / 3;
            }
        }
        return out;
    },

    dist(r, g, b, c) {
        return Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]);
    },

    // The background's colours: what most of the edge ring agrees on, up to
    // three (each at least an eighth of the ring). → { clusters: [{ c, noise }], share }
    background(S, w, h) {
        const [R, G, B] = S;
        const t = Math.max(2, Math.round(Math.min(w, h) * 0.012));
        const ring = [];
        const step = Math.max(1, Math.round((2 * (w + h) * t) / 6000));
        let k = 0;
        for (let y = 0; y < h; y++) {
            const edgeRow = y < t || y >= h - t;
            for (let x = 0; x < w; x++) {
                if (!edgeRow && x >= t && x < w - t) { x = w - t - 1; continue; }
                if (k++ % step) continue;
                const p = y * w + x;
                ring.push([R[p], G[p], B[p]]);
            }
        }
        const total = ring.length;
        let rest = ring;
        const clusters = [];
        for (let round = 0; round < 3 && rest.length; round++) {
            const bins = new Map();
            for (const v of rest) {
                const key = (v[0] >> 4) << 8 | (v[1] >> 4) << 4 | (v[2] >> 4);
                bins.set(key, (bins.get(key) || 0) + 1);
            }
            let top = -1, most = 0;
            for (const [key, c] of bins) if (c > most) { most = c; top = key; }
            let c = [((top >> 8) << 4) + 8, (((top >> 4) & 15) << 4) + 8, ((top & 15) << 4) + 8];
            let members = [];
            for (let it = 0; it < 3; it++) {
                members = rest.filter(v => this.dist(v[0], v[1], v[2], c) <= 36);
                if (!members.length) break;
                c = [0, 1, 2].map(i => members.reduce((s, v) => s + v[i], 0) / members.length);
            }
            if (members.length < total * 0.12) break;
            const ds = members.map(v => this.dist(v[0], v[1], v[2], c)).sort((a, b) => a - b);
            clusters.push({ c, noise: ds[ds.length >> 1], n: members.length });
            const near = new Set(members);
            rest = rest.filter(v => !near.has(v));
        }
        const share = clusters.reduce((s, cl) => s + cl.n, 0) / Math.max(1, total);
        return { clusters, share };
    },

    // Background, flooded in from the edge: 1 where it reaches
    flood(S, w, h, bg) {
        const [R, G, B] = S;
        const n = w * h;
        const noise = Math.max(1, ...bg.clusters.map(c => c.noise));
        const near = Math.max(30, noise * 5);   // a seed on the edge: this close to a background colour
        const far = Math.max(70, noise * 9);    // nothing further from one is background
        const stepMax = Math.max(6, noise * 2.2); // and each step along the way small
        const nearest = (p) => {
            let m = Infinity;
            for (const cl of bg.clusters) m = Math.min(m, this.dist(R[p], G[p], B[p], cl.c));
            return m;
        };
        const out = new Uint8Array(n);
        const queue = new Int32Array(n);
        let head = 0, tail = 0;
        const seed = (p) => { if (!out[p] && nearest(p) <= near) { out[p] = 1; queue[tail++] = p; } };
        for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
        const go = (p, q) => {
            if (out[q]) return;
            if (Math.abs(R[q] - R[p]) + Math.abs(G[q] - G[p]) + Math.abs(B[q] - B[p]) > stepMax) return;
            if (nearest(q) > far) return;
            out[q] = 1;
            queue[tail++] = q;
        };
        while (head < tail) {
            const p = queue[head++];
            const x = p % w;
            if (x > 0) go(p, p - 1);
            if (x < w - 1) go(p, p + 1);
            if (p >= w) go(p, p - w);
            if (p < n - w) go(p, p + w);
        }
        return out;
    },

    // Square erosion (or dilation) of a 0/1 mask, radius r, via running sums
    morph(m, w, h, r, erode) {
        if (r <= 0) return m.slice();
        const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
        const want = erode ? 2 * r + 1 : 1;
        for (let y = 0; y < h; y++) {
            let s = 0;
            const o = y * w;
            for (let x = -r; x < w + r; x++) {
                const add = x + r < w && x + r >= 0 ? m[o + x + r] : (erode ? 0 : 0);
                const drop = x - r - 1 >= 0 && x - r - 1 < w ? m[o + x - r - 1] : 0;
                s += add - drop;
                if (x >= 0 && x < w) tmp[o + x] = erode ? (s >= want ? 1 : 0) : (s > 0 ? 1 : 0);
            }
        }
        for (let x = 0; x < w; x++) {
            let s = 0;
            for (let y = -r; y < h + r; y++) {
                const add = y + r < h && y + r >= 0 ? tmp[(y + r) * w + x] : 0;
                const drop = y - r - 1 >= 0 && y - r - 1 < h ? tmp[(y - r - 1) * w + x] : 0;
                s += add - drop;
                if (y >= 0 && y < h) out[y * w + x] = erode ? (s >= want ? 1 : 0) : (s > 0 ? 1 : 0);
            }
        }
        return out;
    },

    // Groups of 1s (4-connected): a label per pixel, and each group's pixels
    components(m, w, h) {
        const n = w * h;
        const label = new Int32Array(n);
        const groups = [];
        const stack = new Int32Array(n);
        for (let p0 = 0; p0 < n; p0++) {
            if (!m[p0] || label[p0]) continue;
            const id = groups.length + 1;
            const pts = [];
            let top = 0;
            stack[top++] = p0;
            label[p0] = id;
            while (top) {
                const p = stack[--top];
                pts.push(p);
                const x = p % w;
                if (x > 0 && m[p - 1] && !label[p - 1]) { label[p - 1] = id; stack[top++] = p - 1; }
                if (x < w - 1 && m[p + 1] && !label[p + 1]) { label[p + 1] = id; stack[top++] = p + 1; }
                if (p >= w && m[p - w] && !label[p - w]) { label[p - w] = id; stack[top++] = p - w; }
                if (p < n - w && m[p + w] && !label[p + w]) { label[p + w] = id; stack[top++] = p + w; }
            }
            groups.push({ id, pts });
        }
        return { label, groups };
    },

    // Convex hull of points (monotone chain)
    hull(points) {
        const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (p.length < 3) return p;
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [], upper = [];
        for (const q of p) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
            lower.push(q);
        }
        for (let i = p.length - 1; i >= 0; i--) {
            const q = p[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
            upper.push(q);
        }
        upper.pop();
        lower.pop();
        return lower.concat(upper);
    },

    // The smallest rectangle round a group's pixels, at any tilt (rotating
    // calipers on its outline). Angle: clockwise, −45…45°
    rect(pts, w, label, id) {
        // The outline: each edge pixel's outer corners (inner ones can't
        // be on the hull)
        const corners = [];
        const n = label.length;
        const mine = (q) => q >= 0 && q < n && label[q] === id;
        for (const p of pts) {
            const x = p % w, y = (p - x) / w;
            if (x > 0 && x < w - 1 && mine(p - 1) && mine(p + 1) && mine(p - w) && mine(p + w)) continue;
            corners.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
        }
        const hull = this.hull(corners);
        let best = null;
        for (let i = 0; i < hull.length; i++) {
            const a = hull[i], b = hull[(i + 1) % hull.length];
            const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
            const c = Math.cos(ang), s = Math.sin(ang);
            let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
            for (const [x, y] of hull) {
                const u = x * c + y * s, v = -x * s + y * c;
                if (u < u0) u0 = u;
                if (u > u1) u1 = u;
                if (v < v0) v0 = v;
                if (v > v1) v1 = v;
            }
            const area = (u1 - u0) * (v1 - v0);
            if (!best || area < best.area) best = { area, ang, u0, u1, v0, v1 };
        }
        if (!best) return null;
        let { ang, u0, u1, v0, v1 } = best;
        const c = Math.cos(ang), s = Math.sin(ang);
        const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
        let rw = u1 - u0, rh = v1 - v0;
        let deg = ang * 180 / Math.PI;
        // Into −45…45°, the sides swapping as it turns a quarter
        while (deg > 45) { deg -= 90; [rw, rh] = [rh, rw]; }
        while (deg <= -45) { deg += 90; [rw, rh] = [rh, rw]; }
        return { cx: um * c - vm * s, cy: um * s + vm * c, w: rw, h: rh, angle: deg, area: pts.length, fill: pts.length / Math.max(1, rw * rh) };
    },

    corners(r) {
        const a = r.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
            const x = i * r.w / 2, y = j * r.h / 2;
            return [r.cx + x * c - y * s, r.cy + x * s + y * c];
        });
    },

    // Prints that touch come out as one group, not a rectangle: eaten away
    // until it parts, each piece then grown back
    split(g, w, h) {
        const xs = g.pts.map(p => p % w), ys = g.pts.map(p => (p - (p % w)) / w);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        const bw = Math.max(...xs) - x0 + 1, bh = Math.max(...ys) - y0 + 1;
        const m = new Uint8Array(bw * bh);
        for (let i = 0; i < g.pts.length; i++) m[(ys[i] - y0) * bw + (xs[i] - x0)] = 1;
        const unit = Math.max(2, Math.round(Math.min(w, h) * 0.008));
        for (let r = unit; r <= Math.min(w, h) * 0.06; r += unit) {
            const er = this.morph(m, bw, bh, r, true);
            const { label, groups } = this.components(er, bw, bh);
            const big = groups.filter(q => q.pts.length >= g.pts.length * 0.06);
            if (big.length < 2) continue;
            const rects = big.map(q => {
                const rr = this.rect(q.pts, bw, label, q.id);
                if (!rr) return null;
                return { ...rr, cx: rr.cx + x0, cy: rr.cy + y0, w: rr.w + 2 * r, h: rr.h + 2 * r, area: q.pts.length };
            }).filter(Boolean);
            if (rects.length >= 2) return rects;
        }
        return null;
    },

    // Each side moved to the strongest straight edge near it. The flood's
    // edge is usually the print's own; on a white lid it can be a white
    // border's inner edge, the print's real edge a little way out.
    refine(rect, L, w, h) {
        const a = rect.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const size = Math.min(rect.w, rect.h);
        const inward = Math.max(2, size * 0.03), outward = Math.max(3, size * 0.07);
        const sample = (x, y) => {
            const xi = Math.max(0, Math.min(w - 2, Math.floor(x))), yi = Math.max(0, Math.min(h - 2, Math.floor(y)));
            const fx = x - xi, fy = y - yi, p = yi * w + xi;
            return (L[p] * (1 - fx) + L[p + 1] * fx) * (1 - fy) + (L[p + w] * (1 - fx) + L[p + w + 1] * fx) * fy;
        };
        // Sides: [normal (outward), half-size along normal, half-size along side, side direction]
        const sides = [
            { n: [s, -c], d: rect.h / 2, len: rect.w / 2, t: [c, s] },   // top
            { n: [-s, c], d: rect.h / 2, len: rect.w / 2, t: [c, s] },   // bottom
            { n: [-c, -s], d: rect.w / 2, len: rect.h / 2, t: [-s, c] }, // left
            { n: [c, s], d: rect.w / 2, len: rect.h / 2, t: [-s, c] }    // right
        ];
        const moves = sides.map(sd => {
            const K = 24;
            const offs = [];
            for (let o = -inward; o <= outward; o += 0.5) offs.push(o);
            // Edge strength across the side at each offset: the median of
            // the brightness step along the normal (most of the side must
            // have the edge: one photo detail doesn't count)
            const strength = offs.map(o => {
                const vals = [];
                for (let k = 0; k < K; k++) {
                    const tpos = (-0.8 + 1.6 * k / (K - 1)) * sd.len;
                    const bx = rect.cx + sd.t[0] * tpos + sd.n[0] * (sd.d + o);
                    const by = rect.cy + sd.t[1] * tpos + sd.n[1] * (sd.d + o);
                    if (bx < 1 || by < 1 || bx > w - 2 || by > h - 2) continue;
                    vals.push(Math.abs(sample(bx + sd.n[0], by + sd.n[1]) - sample(bx - sd.n[0], by - sd.n[1])));
                }
                if (vals.length < K / 2) return 0;
                vals.sort((p, q) => p - q);
                return vals[vals.length >> 1];
            });
            const base = strength.slice().sort((p, q) => p - q)[strength.length >> 1];
            // The flood's own edge (offset 0) unless a clearly straight edge
            // is near: the strongest within a pixel or two, or further out a
            // white border's outer edge (bright and plain up to it)
            let best = 0, bestS = -1;
            offs.forEach((o, i) => {
                if (Math.abs(o) <= 2 && strength[i] > bestS) { bestS = strength[i]; best = o; }
            });
            let out = best;
            offs.forEach((o, i) => {
                if (o < size * 0.012 || strength[i] < Math.max(6, base * 3) || strength[i] < bestS * 0.25) return;
                // The band between: bright and even (a border, not a shadow
                // or the next print)
                let sum = 0, sum2 = 0, cnt = 0;
                for (let k = 0; k < 12; k++) {
                    const tpos = (-0.7 + 1.4 * k / 11) * sd.len;
                    for (let f = 0.25; f < 1; f += 0.25) {
                        const v = sample(rect.cx + sd.t[0] * tpos + sd.n[0] * (sd.d + o * f), rect.cy + sd.t[1] * tpos + sd.n[1] * (sd.d + o * f));
                        sum += v; sum2 += v * v; cnt++;
                    }
                }
                const mean = sum / cnt, sd2 = Math.sqrt(Math.max(0, sum2 / cnt - mean * mean));
                if (mean > 150 && sd2 < 22 && o > out) out = o;
            });
            return out;
        });
        // Opposite sides move the centre and the size
        const [top, bottom, left, right] = moves;
        const dv = (bottom - top) / 2, du = (right - left) / 2;
        return {
            ...rect,
            w: rect.w + left + right,
            h: rect.h + top + bottom,
            cx: rect.cx + c * du - s * dv,
            cy: rect.cy + s * du + c * dv
        };
    },

    // ---- What callers use ----

    // Every print: the analysis behind single, all and at
    analyse(px) {
        const { d, w, h } = px;
        const S = this.smooth(d, w, h);
        const bg = this.background(S, w, h);
        if (!bg.clusters.length) return null;
        const reached = this.flood(S, w, h, bg);
        let fg = new Uint8Array(w * h);
        let bgCount = 0;
        for (let p = 0; p < fg.length; p++) { fg[p] = reached[p] ? 0 : 1; bgCount += reached[p]; }
        // Thin strands (dust, a hair) don't join prints
        fg = this.morph(this.morph(fg, w, h, 1, true), w, h, 1, false);
        const L = new Float32Array(w * h);
        for (let p = 0; p < L.length; p++) L[p] = S[0][p] * 0.3 + S[1][p] * 0.59 + S[2][p] * 0.11;
        const { label, groups } = this.components(fg, w, h);
        const minArea = w * h * 0.004;
        const rects = [];
        for (const g of groups) {
            if (g.pts.length < minArea) continue;
            let r = this.rect(g.pts, w, label, g.id);
            if (!r) continue;
            let parts = r.fill < 0.82 && g.pts.length > minArea * 3 ? this.split(g, w, h) : null;
            for (const one of parts || [r]) {
                const fine = this.refine(one, L, w, h);
                fine.id = g.id;
                rects.push(fine);
            }
        }
        const edge = 1.5;
        for (const r of rects) {
            const cs = this.corners(r);
            r.touches = {
                top: cs.some(([, y]) => y <= edge), bottom: cs.some(([, y]) => y >= h - edge),
                left: cs.some(([x]) => x <= edge), right: cs.some(([x]) => x >= w - edge)
            };
        }
        return { rects, bg, bgShare: bgCount / (w * h), label, w, h };
    },

    toSource(r, px) {
        const { sx, sy } = px;
        return {
            corners: this.corners(r).map(([x, y]) => [x * sx, y * sy]),
            tilt: r.angle,
            cx: r.cx * sx, cy: r.cy * sy, w: r.w * sx, h: r.h * sy
        };
    },

    // The photo on a scan, for Auto crop: as CropAuto.detect returns it
    // ({ tilt, corners, found, scale }), or null when there's none, or
    // nothing round it to take off. feeder: a sheet-feeder page (the photo
    // at its leading edge). strict: no idea what it is (the crop editor's
    // Auto on any photo): only a scan that plainly is one.
    single(src, W, H, { feeder = false, strict = false } = {}) {
        const px = this.pixels(src, W, H);
        const a = this.analyse(px);
        if (!a || !a.rects.length) return null;
        const { w, h } = px;
        const r = a.rects.slice().sort((p, q) => q.area - p.area)[0];
        if (r.fill < 0.7) return null;
        // Nothing round it: already cropped
        if (r.w >= w * 0.97 && r.h >= h * 0.97) return null;
        const t = r.touches;
        const sides = [t.top, t.bottom, t.left, t.right].filter(Boolean).length;
        // A print on the glass sits clear of the edge, or against a corner;
        // a feeder's photo against its leading edge. A photo whose own
        // plain sky reached the edge touches three sides: not a print.
        if (sides > 2 || (t.top && t.bottom) || (t.left && t.right)) return null;
        if (strict && (a.bg.share < 0.4 || a.bgShare < 0.08 || a.bg.clusters[0].noise > 14)) return null;
        if (!feeder && strict && sides === 2) {
            // Against a corner: fine, but then most of the rest is bed
            if (a.bgShare < 0.2) return null;
        }
        const out = this.toSource(r, px);
        return { tilt: out.tilt, corners: out.corners, found: 4 - sides, scale: Math.max(px.sx, px.sy), finder: 'photo' };
    },

    // Every print on the glass (Preview and crop): { cx, cy, w, h, angle }
    // in the source's pixels, biggest first
    all(src, W, H) {
        const px = this.pixels(src, W, H);
        const a = this.analyse(px);
        if (!a) return [];
        const { w, h } = px;
        return a.rects
            .filter(r => r.fill >= 0.65 && r.w >= w * 0.035 && r.h >= h * 0.025 && !(r.w >= w * 0.97 && r.h >= h * 0.97))
            .sort((p, q) => q.area - p.area)
            .map(r => this.toSource(r, px));
    },

    // The print at (x, y) in the source's pixels, or the nearest one close
    // by; null if none
    at(src, W, H, x, y) {
        const px = this.pixels(src, W, H);
        const a = this.analyse(px);
        if (!a) return null;
        const qx = x / px.sx, qy = y / px.sy;
        const inside = (r) => {
            const ang = -r.angle * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
            const dx = qx - r.cx, dy = qy - r.cy;
            const u = dx * c - dy * s, v = dx * s + dy * c;
            return Math.max(Math.abs(u) - r.w / 2, Math.abs(v) - r.h / 2, 0);
        };
        const near = Math.min(px.w, px.h) * 0.03;
        const best = a.rects.map(r => ({ r, d: inside(r) })).filter(o => o.d <= near && o.r.fill >= 0.5)
            .sort((p, q) => p.d - q.d || p.r.area - q.r.area)[0];
        return best ? this.toSource(best.r, px) : null;
    }
};
