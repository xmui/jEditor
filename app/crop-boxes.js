// Auto crop's map-to-boxes and full-resolution refine (docs/auto-crop-plan.md,
// "What jEditor's own version needs"). A map says, for each pixel of a small
// copy of the scan, how likely it is to be part of a print. Today it's the
// classical photo/bed mask (PhotoFind's flood from the edge); later it can
// be a trained model's. Either way the rest is the same:
//
//   1. The map into prints: cut at the halfway mark, holes filled (a dark
//      sky or a black frame inside a print doesn't split it), each blob's
//      outline, blobs much smaller than the biggest dropped (dust, labels,
//      shadows), and the smallest rectangle round each, at any tilt.
//   2. Each box fitted to the scan itself, at the most detail Auto has: a
//      few angles either side of the box's, each scored by how sharp the
//      bed-to-print edge is along its sides; the box's own angle kept unless
//      one clearly beats it. Then each side placed on its edge, past the
//      edge's whole transition (a shadow, a print's dark edge), not on its
//      middle. A side against the edge of the scan is open: cut off by the
//      scan, so there's no edge to look for.

const CropBoxes = {
    // The most detail the refine reads (long side, px)
    MAX_EDGE: 4000,

    // ---- 1. Map → boxes ----

    // The classical map: 1 where the bed, flooded in from the scan's edge,
    // didn't reach. → { map, bg, bgShare } or null
    classical(px, fine = false) {
        const { d, w, h } = px;
        const S = PhotoFind.smooth(d, w, h);
        const bg = PhotoFind.background(S, w, h);
        if (!bg.clusters.length) return null;
        const reached = PhotoFind.flood(S, w, h, bg, fine);
        const map = new Float32Array(w * h);
        let bed = 0;
        for (let p = 0; p < map.length; p++) { map[p] = reached[p] ? 0 : 1; bed += reached[p]; }
        const L = new Float32Array(w * h);
        for (let p = 0; p < L.length; p++) L[p] = S[0][p] * 0.3 + S[1][p] * 0.59 + S[2][p] * 0.11;
        return { map, bg, bgShare: bed / (w * h), S, L };
    },

    // The prints on a map (w × h, 0…1): { cx, cy, w, h, angle, area, fill,
    // touches } in the map's pixels, in reading order. keep: a blob this
    // share of the biggest's size or more counts
    boxes(map, w, h, { cut = 0.5, keep = 0.2, min = 0.004 } = {}) {
        let m = new Uint8Array(w * h);
        for (let p = 0; p < m.length; p++) m[p] = map[p] >= cut ? 1 : 0;
        // Thin strands (dust, a hair) don't join prints
        m = PhotoFind.morph(PhotoFind.morph(m, w, h, 1, true), w, h, 1, false);
        m = this.fill(m, w, h);
        const { label, groups } = PhotoFind.components(m, w, h);
        const sized = groups.filter(g => g.pts.length >= w * h * min);
        const most = sized.reduce((s, g) => Math.max(s, g.pts.length), 0);
        const out = [];
        for (const g of sized) {
            if (g.pts.length < most * keep) continue;
            const r = PhotoFind.rect(g.pts, w, label, g.id);
            if (!r) continue;
            r.touches = PhotoFind.touching(r, w, h);
            out.push(r);
        }
        // Reading order: rows of prints top to bottom, each left to right
        const row = Math.max(1, h * 0.1);
        return out.sort((a, b) => Math.round(a.cy / row) - Math.round(b.cy / row) || a.cx - b.cx);
    },

    // Holes filled: what the outside, flooded in from the edge, doesn't reach
    fill(m, w, h) {
        const n = w * h;
        const out = new Uint8Array(n);
        const queue = new Int32Array(n);
        let head = 0, tail = 0;
        const go = (q) => { if (!m[q] && !out[q]) { out[q] = 1; queue[tail++] = q; } };
        for (let x = 0; x < w; x++) { go(x); go((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { go(y * w); go(y * w + w - 1); }
        while (head < tail) {
            const p = queue[head++], x = p % w;
            if (x > 0) go(p - 1);
            if (x < w - 1) go(p + 1);
            if (p >= w) go(p - w);
            if (p < n - w) go(p + w);
        }
        for (let p = 0; p < n; p++) out[p] = out[p] ? 0 : 1;
        return out;
    },

    // ---- 2. Each box fitted to the scan ----

    // The source's brightness, at up to MAX_EDGE: { L, w, h, k }
    luma(src, W, H) {
        const k = Math.min(1, this.MAX_EDGE / Math.max(W, H));
        const w = Math.max(16, Math.round(W * k)), h = Math.max(16, Math.round(H * k));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(src, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        canvas.width = canvas.height = 0;
        const L = new Float32Array(w * h);
        for (let p = 0, i = 0; p < L.length; p++, i += 4) L[p] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        return { L, w, h, k };
    },

    // A box (in img's pixels) fitted to img: { ...box, angle, w, h, cx, cy,
    // sharp }. open: [top, bottom, left, right], true where the scan cut
    // the print off. beds: the bed's brightnesses. coarse: how many of
    // img's pixels one of the map's is
    refine(box, img, open, beds, coarse = 1) {
        const { L, w, h } = img;
        const at = (x, y) => {
            const xi = Math.max(0, Math.min(w - 2, Math.floor(x))), yi = Math.max(0, Math.min(h - 2, Math.floor(y)));
            const fx = Math.min(1, Math.max(0, x - xi)), fy = Math.min(1, Math.max(0, y - yi)), p = yi * w + xi;
            return (L[p] * (1 - fx) + L[p + 1] * fx) * (1 - fy) + (L[p + w] * (1 - fx) + L[p + w + 1] * fx) * fy;
        };
        // How far either side of a side to look: as far as the map can be
        // off (a few of its pixels), so photo detail further in isn't taken
        // for the edge
        const R = Math.max(4, Math.round(4 * coarse));
        const STEP = 0.5, K = 48;
        const offs = [];
        for (let o = -R; o <= R; o += STEP) offs.push(o);
        // The four sides at an angle: outward normal n, along t, distance d
        // from the centre, half-length len (as PhotoFind.refine)
        const sides = (deg) => {
            const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
            return [
                { n: [s, -c], d: box.h / 2, len: box.w / 2, t: [c, s] },
                { n: [-s, c], d: box.h / 2, len: box.w / 2, t: [c, s] },
                { n: [-c, -s], d: box.w / 2, len: box.h / 2, t: [-s, c] },
                { n: [c, s], d: box.w / 2, len: box.h / 2, t: [-s, c] }
            ];
        };
        // Brightness across a side at each offset, along 85% of it (clear
        // of the corners). mean: lined up with the edge it's a sharp step;
        // at the wrong angle, smeared over the side's sag (so it scores the
        // angle). Otherwise the median, so photo detail at a few points
        // doesn't move the side.
        const profile = (sd, mean = false) => offs.map(o => {
            const v = [];
            for (let k = 0; k < K; k++) {
                const tp = (-0.85 + 1.7 * k / (K - 1)) * sd.len;
                const x = box.cx + sd.t[0] * tp + sd.n[0] * (sd.d + o), y = box.cy + sd.t[1] * tp + sd.n[1] * (sd.d + o);
                if (x >= 0 && y >= 0 && x < w && y < h) v.push(at(x, y));
            }
            if (v.length < K / 2) return NaN;
            if (mean) return v.reduce((a, b) => a + b, 0) / v.length;
            v.sort((p, q) => p - q);
            return v[v.length >> 1];
        });
        const slope = (p) => p.map((_, i) => i > 0 && i < p.length - 1 ? Math.abs(p[i + 1] - p[i - 1]) / 2 : 0);
        const sharp = (deg) => {
            let sum = 0;
            sides(deg).forEach((sd, i) => {
                if (open[i]) return;
                const g = slope(profile(sd, true));
                sum += Math.max(0, ...g.filter(Number.isFinite));
            });
            return sum;
        };
        // The angle: a degree either side in tenths, kept only if clearly
        // sharper than the box's own
        const own = sharp(box.angle);
        let angle = box.angle, best = own;
        for (let da = -1; da <= 1.0001; da += 0.1) {
            if (Math.abs(da) < 0.05) continue;
            const v = sharp(box.angle + da);
            if (v > best) { best = v; angle = box.angle + da; }
        }
        if (best < own * 1.05) { angle = box.angle; best = own; }
        // Each side on its edge: the strongest step whose outer side is
        // bed, then past the step's whole width, inward
        const moves = sides(angle).map((sd, i) => {
            if (open[i]) return 0;
            const p = profile(sd), g = slope(p);
            const fin = g.filter(Number.isFinite).sort((a, b) => a - b);
            const typical = fin.length ? fin[fin.length >> 1] : 0;
            const order = g.map((v, j) => j).filter(j => Number.isFinite(g[j])).sort((a, b) => g[b] - g[a]);
            for (const j of order) {
                const peak = g[j];
                if (peak < 2 || peak < typical * 4) break;
                const out = p[Math.min(p.length - 1, j + Math.round(3 / STEP))];
                if (!Number.isFinite(out) || (beds.length && Math.min(...beds.map(b => Math.abs(out - b))) > 40)) continue;
                let k = j;
                while (k > 1 && g[k - 1] > peak * 0.5) k--;
                return offs[k];
            }
            return 0;
        });
        const [top, bottom, left, right] = moves;
        const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const du = (right - left) / 2, dv = (bottom - top) / 2;
        return {
            ...box, angle, sharp: best,
            w: box.w + left + right, h: box.h + top + bottom,
            cx: box.cx + c * du - s * dv, cy: box.cy + s * du + c * dv
        };
    },

    // ---- What Auto uses ----

    // The photo on a scan, as PhotoFind.single returns it (same checks for
    // whether it's a scan at all), found through the map and fitted at
    // full detail. → { tilt, corners, found, scale, finder } or null
    single(src, W, H, { feeder = false, strict = false } = {}) {
        const px = PhotoFind.pixels(src, W, H);
        let a = this.classical(px);
        let rects = a ? this.boxes(a.map, px.w, px.h) : [];
        if (a && !rects.length) {
            // A closer look (a pale print on a pale lid), whose finds must
            // be clean rectangles: it also sees lid texture
            const b = this.classical(px, true);
            if (b) {
                a = b;
                rects = this.boxes(b.map, px.w, px.h).filter(r => r.fill >= 0.9 && r.w >= px.w * 0.06 && r.h >= px.h * 0.05);
            }
        }
        if (!a || !rects.length) return null;
        const { w, h } = px;
        const r0 = rects.slice().sort((p, q) => q.area - p.area)[0];
        if (r0.fill < 0.7) return null;
        if (r0.w >= w * 0.97 && r0.h >= h * 0.97) return null;
        const t = r0.touches;
        const sides = [t.top, t.bottom, t.left, t.right].filter(Boolean).length;
        if (sides > 2 || (t.top && t.bottom) || (t.left && t.right)) return null;
        if (strict && (a.bg.share < 0.4 || a.bgShare < 0.08 || a.bg.clusters[0].noise > 14)) return null;
        if (!feeder && strict && sides === 2 && a.bgShare < 0.2) return null;
        // Today's coarse refine first (a white border's outer edge, on a
        // white lid the flood leaks into), then the full-detail one
        const r = PhotoFind.refine(r0, a.L, w, h, a.S, a.bg);
        const img = this.luma(src, W, H);
        const fx = img.w / w, fy = img.h / h;
        const box = { ...r, cx: r.cx * fx, cy: r.cy * fy, w: r.w * fx, h: r.h * fy };
        const beds = a.bg.clusters.map(cl => cl.c[0] * 0.3 + cl.c[1] * 0.59 + cl.c[2] * 0.11);
        const fine = this.refine(box, img, [t.top, t.bottom, t.left, t.right], beds, Math.max(fx, fy));
        const sx = W / img.w, sy = H / img.h;
        const corners = PhotoFind.corners(fine).map(([x, y]) => [x * sx, y * sy]);
        return { tilt: fine.angle, corners, found: 4 - sides, scale: Math.max(sx, sy), finder: 'boxes' };
    }
};
