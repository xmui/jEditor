// Finds a print on a flatbed scan: the scanner bed (lid or background) is a
// uniform colour around the photo, so each side of the print shows up as a
// straight boundary between "bed" and "not bed". Each side is fitted as a
// line (robust to dust, shadows and photo content that happens to match the
// bed), which gives the print's tilt and its four corners.
//
// Sides where the print touches the edge of the scan (placed against the
// scanner's corner) have no bed to find; the scan edge stands in for them.

const CropAuto = {
    MAX_EDGE: 1600, // detection resolution (long side, px)

    // → { tilt (degrees, clockwise), corners [tl, tr, br, bl] in source px,
    //     found: number of sides found against the bed } or null
    detect(src, W, H) {
        const k = Math.min(1, this.MAX_EDGE / Math.max(W, H));
        const w = Math.max(32, Math.round(W * k)), h = Math.max(32, Math.round(H * k));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        canvas.width = canvas.height = 0;

        const bed = this.bedColour(d, w, h);
        if (!bed) return null;
        // A scan line is "bed" until it differs from the bed just before it
        // (a running average, so uneven lid lighting doesn't count) by more
        // than the bed's own noise — the print's edge. A few pixels in a row
        // must differ, so a speck of dust doesn't.
        const [br, bg, bb] = bed.rgb;
        const onBed = Math.max(45, bed.noise * 5);  // the line starts on the bed
        const step = Math.max(20, bed.noise * 3);   // and leaves it here
        const RUN = 3;
        const firstRun = (start, stride, count) => {
            const i0 = start * 4;
            let r = d[i0], g = d[i0 + 1], b = d[i0 + 2];
            if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) > onBed) return 0; // print at the edge
            let run = 0;
            for (let t = 1; t < count; t++) {
                const i = (start + t * stride) * 4;
                const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
                if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > step) {
                    if (++run === RUN) return t - RUN + 1;
                } else {
                    run = 0;
                    r += dr * 0.1; g += dg * 0.1; b += db * 0.1;
                }
            }
            return -1;
        };
        const limY = h, limX = w;
        const pts = { top: [], bottom: [], left: [], right: [] };
        for (let x = 0; x < w; x++) {
            const t = firstRun(x, w, limY);
            if (t >= 0) pts.top.push([x + 0.5, t]);
            const b = firstRun((h - 1) * w + x, -w, limY);
            if (b >= 0) pts.bottom.push([x + 0.5, h - b]);
        }
        for (let y = 0; y < h; y++) {
            const l = firstRun(y * w, 1, limX);
            if (l >= 0) pts.left.push([y + 0.5, l]);
            const r = firstRun(y * w + w - 1, -1, limX);
            if (r >= 0) pts.right.push([y + 0.5, w - r]);
        }

        // Fit each side's edge as a line
        const edge = { top: 0, bottom: h, left: 0, right: w };
        const across = (side) => side === 'top' || side === 'bottom' ? w : h;
        const fits = {};
        const tilts = [];
        for (const side of ['top', 'bottom', 'left', 'right']) {
            const fit = this.fitLine(pts[side], across(side));
            // Hugging the scan's edge: the print touches it, there's no edge to see
            if (!fit || Math.abs(fit.a + fit.b * across(side) / 2 - edge[side]) < 1.5) continue;
            fits[side] = fit;
            const deg = Math.atan(fit.b) * 180 / Math.PI;
            // top/bottom are y(x): slope down-right is clockwise; left/right
            // are x(y): slope down-left is clockwise
            tilts.push({ deg: side === 'top' || side === 'bottom' ? deg : -deg, weight: fit.inliers });
        }
        if (!tilts.length) return null;

        // Sides of one print agree on the tilt; drop any that doesn't
        const sorted = tilts.map(t => t.deg).sort((p, q) => p - q);
        const median = sorted[sorted.length >> 1];
        let sum = 0, weight = 0;
        for (const t of tilts) {
            if (Math.abs(t.deg - median) > 0.6) continue;
            sum += t.deg * t.weight;
            weight += t.weight;
        }
        const tilt = weight ? sum / weight : median;
        const slope = Math.tan(tilt * Math.PI / 180);

        // Sides without a clean line: against the scan's edge when most hits
        // are right at it, otherwise at the print's outermost extent (a low
        // percentile, so a speck of dust on the bed can't pull it out)
        const lines = {};
        let found = 0;
        for (const side of ['top', 'bottom', 'left', 'right']) {
            const fit = fits[side];
            const b = side === 'top' || side === 'bottom' ? slope : -slope;
            if (fit && Math.abs(Math.atan(fit.b) - Math.atan(b)) < 0.6 * Math.PI / 180) {
                lines[side] = fit;
                found++;
                continue;
            }
            const p = pts[side];
            const outward = side === 'top' || side === 'left' ? 1 : -1; // sort order: outermost first
            const atEdge = p.filter(([, v]) => Math.abs(v - edge[side]) <= 1).length;
            if (!p.length || atEdge > across(side) * 0.15) {
                lines[side] = { a: edge[side], b: 0 };
                continue;
            }
            const offs = p.map(([u, v]) => v - b * u).sort((x, y) => (x - y) * outward);
            lines[side] = { a: offs[Math.floor(offs.length * 0.1)], b };
        }
        // Two sides at least: one alone is as likely a horizon in a borderless photo
        if (found < 2) return null;

        // Corners: top/bottom are y = a + b·x, left/right are x = a + b·y
        const meet = (hz, vt) => {
            const x = (vt.a + vt.b * hz.a) / (1 - vt.b * hz.b);
            return [x, hz.a + hz.b * x];
        };
        const sx = W / w, sy = H / h;
        const corners = [
            meet(lines.top, lines.left), meet(lines.top, lines.right),
            meet(lines.bottom, lines.right), meet(lines.bottom, lines.left)
        ].map(([x, y]) => [x * sx, y * sy]);

        // Sanity: a print, not a sliver
        const span = (i, j) => Math.hypot(corners[i][0] - corners[j][0], corners[i][1] - corners[j][1]);
        if (Math.min(span(0, 1), span(3, 2)) < W * 0.1 || Math.min(span(0, 3), span(1, 2)) < H * 0.1) return null;
        return { tilt, corners, found, scale: Math.max(sx, sy), lines };
    },

    // The bed's colour: whichever corner colour most of the scan's outer ring
    // agrees with (a print pushed into one corner hides that corner, not
    // the other three). null when the ring has no dominant colour.
    bedColour(d, w, h) {
        const R = Math.max(2, Math.round(Math.min(w, h) * 0.008));
        const ring = [];
        const px = (x, y) => { const i = (y * w + x) * 4; ring.push([d[i], d[i + 1], d[i + 2]]); };
        const stepX = Math.max(1, Math.floor(w / 400)), stepY = Math.max(1, Math.floor(h / 400));
        for (let r = 0; r < R; r++) {
            for (let x = 0; x < w; x += stepX) { px(x, r); px(x, h - 1 - r); }
            for (let y = R; y < h - R; y += stepY) { px(r, y); px(w - 1 - r, y); }
        }
        const P = Math.max(4, Math.round(Math.min(w, h) * 0.015));
        const patch = (x0, y0) => {
            const m = [0, 0, 0];
            for (let y = y0; y < y0 + P; y++) for (let x = x0; x < x0 + P; x++) {
                const i = (y * w + x) * 4;
                m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2];
            }
            return m.map(v => v / (P * P));
        };
        const near = (p, c) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) <= 45;
        let best = null;
        for (const c of [patch(0, 0), patch(w - P, 0), patch(0, h - P), patch(w - P, h - P)]) {
            const n = ring.reduce((acc, p) => acc + (near(p, c) ? 1 : 0), 0);
            if (!best || n > best.n) best = { c, n };
        }
        if (best.n < ring.length * 0.45) return null;
        const match = ring.filter(p => near(p, best.c));
        const rgb = [0, 1, 2].map(k => {
            const v = match.map(p => p[k]).sort((p, q) => p - q);
            return v[v.length >> 1];
        });
        const noise = match.reduce((acc, p) =>
            acc + Math.abs(p[0] - rgb[0]) + Math.abs(p[1] - rgb[1]) + Math.abs(p[2] - rgb[2]), 0) / match.length;
        return { rgb, noise };
    },

    // Robust straight line v = a + b·u through (u, v) points: the line most
    // points lie on (RANSAC), then least squares on those. null when no line
    // has enough support along `across` (the side's length) to be an edge.
    fitLine(pts, across) {
        const n = pts.length;
        if (n < 20) return null;
        let seed = 9973;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const TOL = 1.5;
        const count = (a, b) => {
            let c = 0;
            for (const [u, v] of pts) if (Math.abs(v - (a + b * u)) <= TOL) c++;
            return c;
        };
        let best = null;
        for (let it = 0; it < 200; it++) {
            const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n);
            const du = pts[j][0] - pts[i][0];
            if (Math.abs(du) < across * 0.1) continue;
            const b = (pts[j][1] - pts[i][1]) / du;
            if (Math.abs(b) > 0.27) continue; // steeper than 15°: not a print edge
            const a = pts[i][1] - b * pts[i][0];
            const c = count(a, b);
            if (!best || c > best.c) best = { a, b, c };
        }
        if (!best) return null;
        let { a, b } = best;
        let inl = [];
        for (let pass = 0; pass < 2; pass++) {
            inl = pts.filter(([u, v]) => Math.abs(v - (a + b * u)) <= TOL);
            if (inl.length < 10) return null;
            let su = 0, sv = 0, suu = 0, suv = 0;
            for (const [u, v] of inl) { su += u; sv += v; suu += u * u; suv += u * v; }
            const den = inl.length * suu - su * su;
            if (!den) return null;
            b = (inl.length * suv - su * sv) / den;
            a = (sv - b * su) / inl.length;
        }
        let lo = Infinity, hi = -Infinity;
        for (const [u] of inl) { lo = Math.min(lo, u); hi = Math.max(hi, u); }
        if (inl.length < Math.max(20, n * 0.3) || hi - lo < across * 0.15) return null;
        return { a, b, inliers: inl.length };
    }
};
