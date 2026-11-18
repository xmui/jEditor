// Retouch: spot and dust removal, done on the photo itself before it's
// cropped (Adjust's Spot removal, adjust-spots.js, is the screen). Like
// every adjustment it's kept with the photo's edit (`adj.spots`), never in
// the file, and done again whenever the photo is shown.
//
// A spot is a circle on the photo copied over from somewhere else on it:
//   clone: the source as it is, feathered in at the edge
//   heal:  the source's texture in the colour and brightness round the
//          spot: the difference between the two at the circle's edge is
//          spread smoothly over the inside (a membrane, solved on a small
//          grid), so a speck on a sky or a face takes on its surroundings
// Places are on the photo as it is on disk, before any crop or turn — x
// across 0–1, y down 0–1 — and sizes in heights of the photo, as masks'
// are, so a crop later doesn't move them and any size of the photo (a
// thumbnail, the preview, the full photo) gets the same result.
//
//   spots: [{ t: 'heal'|'clone'|'eye'|'line', x, y, r, sx, sy, f, o, d, pts }]
//     x, y: the spot; sx, sy: where it's copied from; r: its radius;
//     f: feather (0–1 of the radius); o: opacity (0–1); d: found by the
//     dust or scratch finder (so they can be cleared together)
//     line: a scratch or crease, along pts ([x, y, x, y, …], 2 to 64
//     points), r half its width: each pixel on it is filled from the two
//     sides of the line straight across it, so what crosses the scratch
//     (an edge, a horizon) carries on through it (x, y: its first point,
//     and sx, sy the same: it has no source)
//
// The scratch finder looks for scratches and creases: thin, long lines
// much lighter or darker than what's either side of them (a ridge, not
// the edge of something, which is lighter one side than the other), and
// puts a line on each.
//
// The dust finder looks for specks on scans: small dots much darker or
// lighter than what's round them, on smooth parts of the photo (not on
// edges or texture), and puts a heal spot on each, its source picked from
// the surroundings that match best.

const Retouch = {
    MAX_SPOTS: 500,
    MIN_R: 0.0008,
    MAX_R: 0.25,
    LINE_POINTS: 64,

    // ---- Settings ----

    cleanSpots(list) {
        if (!Array.isArray(list)) return null;
        const num = (x) => typeof x === 'number' && isFinite(x);
        const r5 = (x) => +(+x).toFixed(5);
        const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
        const out = [];
        for (const s of list) {
            if (out.length >= this.MAX_SPOTS) break;
            if (!s || typeof s !== 'object' || ![s.x, s.y, s.r, s.sx, s.sy].every(num)) continue;
            const c = {
                t: s.t === 'clone' ? 'clone' : s.t === 'eye' ? 'eye' : 'heal',
                x: r5(clamp(s.x, -0.5, 1.5)), y: r5(clamp(s.y, -0.5, 1.5)),
                r: r5(clamp(s.r, this.MIN_R, this.MAX_R)),
                sx: r5(clamp(s.sx, -0.5, 1.5)), sy: r5(clamp(s.sy, -0.5, 1.5)),
                f: r5(clamp(num(s.f) ? s.f : 0.5, 0, 1)),
                o: r5(clamp(num(s.o) ? s.o : 1, 0.05, 1))
            };
            if (s.t === 'line') {
                const p = Array.isArray(s.pts) ? s.pts : [];
                if (p.length < 4 || p.length % 2 || !p.every(num)) continue;
                c.t = 'line';
                c.pts = p.slice(0, this.LINE_POINTS * 2).map(v => r5(clamp(v, -0.5, 1.5)));
                c.x = c.sx = c.pts[0];
                c.y = c.sy = c.pts[1];
            }
            if (s.d) c.d = 1;
            // Copied from itself: nothing to do
            if (c.t !== 'eye' && c.t !== 'line' && Math.abs(c.x - c.sx) < 1e-5 && Math.abs(c.y - c.sy) < 1e-5) continue;
            out.push(c);
        }
        return out.length ? out : null;
    },

    // The spots of an edit (or of adjustments), or null
    spotsOf(e) {
        const adj = e && (e.adj !== undefined ? e.adj : e);
        return (adj && Array.isArray(adj.spots) && adj.spots.length) ? adj.spots : null;
    },

    // Anything to do to the photo before it's cropped (its spots)
    needed(edit) {
        return !!this.spotsOf(edit);
    },

    // The whole photo (an ImageBitmap or canvas, as on disk) with its
    // spots: a canvas, or `src` itself when there's nothing to do
    async retouched(src, edit) {
        if (!this.needed(edit)) return src;
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(src, 0, 0);
        const spots = this.spotsOf(edit);
        if (spots) this.applySpots(ctx, c.width, c.height, spots);
        return c;
    },

    // ---- Doing them ----

    // Every spot, one after another (a later one sees the earlier ones'
    // work), onto a canvas holding the whole photo at W × H
    applySpots(ctx, W, H, spots) {
        for (const s of spots) this.applySpot(ctx, W, H, s);
    },

    // One spot's pixels: the box round it and round its source
    spotBoxes(W, H, s) {
        const R = Math.max(0.75, s.r * H);
        const cx = s.x * W, cy = s.y * H;
        const dx = (s.sx - s.x) * W, dy = (s.sy - s.y) * H;
        const x0 = Math.floor(cx - R - 1), y0 = Math.floor(cy - R - 1);
        const x1 = Math.ceil(cx + R + 1), y1 = Math.ceil(cy + R + 1);
        return { R, cx, cy, dx, dy, x0, y0, x1, y1 };
    },

    applySpot(ctx, W, H, s) {
        if (s.t === 'line') { this.applyLine(ctx, W, H, s); return; }
        const b = this.spotBoxes(W, H, s);
        // The spot's box on the canvas
        const bx0 = Math.max(0, b.x0), by0 = Math.max(0, b.y0), bx1 = Math.min(W, b.x1), by1 = Math.min(H, b.y1);
        if (bx1 <= bx0 || by1 <= by0) return;
        // And its source's (whole pixels: the shift is rounded, so the
        // texture is copied, not resampled)
        const ox = Math.round(b.dx), oy = Math.round(b.dy);
        const sx0 = Math.max(0, Math.min(W - 1, bx0 + ox)), sy0 = Math.max(0, Math.min(H - 1, by0 + oy));
        const sx1 = Math.max(sx0 + 1, Math.min(W, bx1 + ox)), sy1 = Math.max(sy0 + 1, Math.min(H, by1 + oy));
        const dst = ctx.getImageData(bx0, by0, bx1 - bx0, by1 - by0);
        const src = ctx.getImageData(sx0, sy0, sx1 - sx0, sy1 - sy0);
        this.spotPixels(dst, bx0, by0, src, sx0, sy0, ox, oy, b, s);
        ctx.putImageData(dst, bx0, by0);
    },

    // The work on pixels: dst (an ImageData at bx0, by0 on the photo) gets
    // the spot, copied from src (at sx0, sy0), shifted by (ox, oy)
    spotPixels(dst, bx0, by0, src, sx0, sy0, ox, oy, b, s) {
        const w = dst.width, h = dst.height, D = dst.data, S = src.data;
        const sw = src.width, sh = src.height;
        const R = b.R, Ri = R * (1 - s.f);
        const sAt = (x, y) => {
            // (x, y) on the photo, from the source (its edges repeated)
            let u = x + ox - sx0, v = y + oy - sy0;
            if (u < 0) u = 0; else if (u >= sw) u = sw - 1;
            if (v < 0) v = 0; else if (v >= sh) v = sh - 1;
            return (v * sw + u) * 4;
        };
        // How much of the spot each pixel gets
        const weight = (x, y) => {
            const d = Math.hypot(x + 0.5 - b.cx, y + 0.5 - b.cy);
            if (d >= R) return 0;
            if (d <= Ri) return 1;
            const t = (R - d) / Math.max(1e-6, R - Ri);
            return t * t * (3 - 2 * t);
        };
        // Heal: the difference (photo − source) round the edge, spread
        // smoothly over the inside
        // Red-eye: in the circle, a pixel as red as a flash makes it takes
        // the eye's own dark (its green and blue), the more the redder
        if (s.t === 'eye') {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const k = weight(bx0 + x, by0 + y) * s.o;
                    if (k <= 0) continue;
                    const i = (y * w + x) * 4;
                    const r = D[i], g = D[i + 1], bl = D[i + 2], gb = (g + bl) / 2;
                    // (a brown iris or skin is under 1.9 times as red)
                    if (r < 50 || r < gb * 1.9) continue;
                    const red = Math.min(1, (r / Math.max(1, gb) - 1.9) / 1.1);
                    const to = Math.min(g, bl) * 0.9;
                    D[i] = Math.round(r + (to - r) * k * red);
                    D[i + 1] = Math.round(g + (g * 0.9 - g) * k * red);
                    D[i + 2] = Math.round(bl + (bl * 0.9 - bl) * k * red);
                }
            }
            return;
        }
        let field = null;
        if (s.t === 'heal') field = this.membrane(dst, bx0, by0, S, sAt, b);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const X = bx0 + x, Y = by0 + y;
                const k = weight(X, Y) * s.o;
                if (k <= 0) continue;
                const i = (y * w + x) * 4, j = sAt(X, Y);
                for (let c = 0; c < 3; c++) {
                    let v = S[j + c];
                    if (field) v += field(X + 0.5, Y + 0.5, c);
                    D[i + c] = Math.round(D[i + c] + (Math.min(255, Math.max(0, v)) - D[i + c]) * k);
                }
            }
        }
    },

    // ---- Scratches and creases (lines) ----

    // A line's points in pixels of a W × H picture, and its box (with room
    // either side for what it's filled from)
    lineBox(W, H, s) {
        const R = Math.max(0.75, s.r * H), P = [];
        for (let i = 0; i + 1 < s.pts.length; i += 2) P.push([s.pts[i] * W, s.pts[i + 1] * H]);
        const m = 2 * R + 4;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        return { R, P, x0: Math.floor(x0 - m), y0: Math.floor(y0 - m), x1: Math.ceil(x1 + m), y1: Math.ceil(y1 + m) };
    },

    applyLine(ctx, W, H, s) {
        const b = this.lineBox(W, H, s);
        const bx0 = Math.max(0, b.x0), by0 = Math.max(0, b.y0), bx1 = Math.min(W, b.x1), by1 = Math.min(H, b.y1);
        if (bx1 <= bx0 || by1 <= by0) return;
        const img = ctx.getImageData(bx0, by0, bx1 - bx0, by1 - by0);
        this.linePixels(img, bx0, by0, b, s);
        ctx.putImageData(img, bx0, by0);
    },

    // The work on pixels: img (an ImageData at bx0, by0 on the photo) with
    // the line filled. Each pixel near the line takes its nearest place on
    // it; it's filled from the two sides, straight across the line there
    // (just past its edge, a little along it averaged in), mixed by how
    // far across it is.
    linePixels(img, bx0, by0, b, s) {
        const w = img.width, h = img.height, D = img.data, S = new Uint8ClampedArray(D);
        const R = b.R, Ri = R * (1 - s.f), out = R + 1.5;
        const n = w * h;
        const dist = new Float32Array(n).fill(Infinity), seg = new Int16Array(n).fill(-1), foot = new Float32Array(n * 2), off = new Float32Array(n);
        const segs = [];
        for (let k = 0; k + 1 < b.P.length; k++) {
            const [ax, ay] = b.P[k], [cx, cy] = b.P[k + 1];
            const dx = cx - ax, dy = cy - ay, len = Math.hypot(dx, dy);
            if (len < 1e-6) continue;
            const tx = dx / len, ty = dy / len;
            segs.push([ax, ay, tx, ty, len]);
            const si = segs.length - 1;
            const x0 = Math.max(0, Math.floor(Math.min(ax, cx) - R - 1) - bx0), x1 = Math.min(w, Math.ceil(Math.max(ax, cx) + R + 1) - bx0);
            const y0 = Math.max(0, Math.floor(Math.min(ay, cy) - R - 1) - by0), y1 = Math.min(h, Math.ceil(Math.max(ay, cy) + R + 1) - by0);
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                const px = bx0 + x + 0.5 - ax, py = by0 + y + 0.5 - ay;
                const along = Math.min(len, Math.max(0, px * tx + py * ty));
                const fx = ax + tx * along, fy = ay + ty * along;
                const d = Math.hypot(bx0 + x + 0.5 - fx, by0 + y + 0.5 - fy);
                const i = y * w + x;
                if (d < dist[i]) { dist[i] = d; seg[i] = si; foot[i * 2] = fx; foot[i * 2 + 1] = fy; off[i] = px * -ty + py * tx; }
            }
        }
        // Bilinear, from the picture as it was (edges repeated)
        const at = (X, Y, c) => {
            let u = X - bx0 - 0.5, v = Y - by0 - 0.5;
            u = u < 0 ? 0 : u > w - 1 ? w - 1 : u;
            v = v < 0 ? 0 : v > h - 1 ? h - 1 : v;
            const i0 = Math.floor(u), j0 = Math.floor(v), i1 = Math.min(w - 1, i0 + 1), j1 = Math.min(h - 1, j0 + 1);
            const fu = u - i0, fv = v - j0;
            const p = (i, j) => S[(j * w + i) * 4 + c];
            return (p(i0, j0) * (1 - fu) + p(i1, j0) * fu) * (1 - fv) + (p(i0, j1) * (1 - fu) + p(i1, j1) * fu) * fv;
        };
        const spread = Math.max(1, Math.min(3, R));
        for (let i = 0; i < n; i++) {
            const d = dist[i];
            if (d >= R) continue;
            const k = (d <= Ri ? 1 : (() => { const t = (R - d) / Math.max(1e-6, R - Ri); return t * t * (3 - 2 * t); })()) * s.o;
            if (k <= 0) continue;
            const [, , tx, ty] = segs[seg[i]];
            const nx = -ty, ny = tx, fx = foot[i * 2], fy = foot[i * 2 + 1];
            const t = Math.max(0, Math.min(1, (off[i] + out) / (2 * out)));
            for (let c = 0; c < 3; c++) {
                let a = 0, z = 0;
                for (const q of [-spread, 0, spread]) {
                    const qx = fx + tx * q, qy = fy + ty * q;
                    a += at(qx - nx * out, qy - ny * out, c);
                    z += at(qx + nx * out, qy + ny * out, c);
                }
                const v = (a * (1 - t) + z * t) / 3;
                D[i * 4 + c] = Math.round(D[i * 4 + c] + (v - D[i * 4 + c]) * k);
            }
        }
    },

    // Half the width (photo heights) of the scratch a drag went along
    // (pts, photo units): how far either side the pixels stay much lighter
    // or darker than further out, across the line at points along it;
    // null when there's no scratch there
    fitLine(Y, W, H, pts, most = 0.01) {
        const P = [];
        for (let i = 0; i + 1 < pts.length; i += 2) P.push([pts[i] * W, pts[i + 1] * H]);
        const lim = Math.max(3, most * H);
        const at = (x, y) => Y[Math.min(H - 1, Math.max(0, Math.round(y - 0.5))) * W + Math.min(W - 1, Math.max(0, Math.round(x - 0.5)))];
        const widths = [];
        for (let k = 0; k + 1 < P.length; k++) {
            const [ax, ay] = P[k], [bx, by] = P[k + 1], len = Math.hypot(bx - ax, by - ay);
            if (len < 1) continue;
            const tx = (bx - ax) / len, ty = (by - ay) / len, nx = -ty, ny = tx;
            for (let q = 0; q < len; q += 3) {
                const cx = ax + tx * q, cy = ay + ty * q;
                // the profile across, the line's middle its oddest pixel
                const prof = [];
                for (let o = -Math.ceil(lim * 1.6); o <= Math.ceil(lim * 1.6); o++) prof.push(at(cx + nx * o, cy + ny * o));
                const mid = prof.length >> 1, edge = [...prof.slice(0, 3), ...prof.slice(-3)].sort((a, b) => a - b);
                const bg = (edge[2] + edge[3]) / 2;
                let best = mid;
                for (let o = mid - 2; o <= mid + 2; o++) if (Math.abs(prof[o] - bg) > Math.abs(prof[best] - bg)) best = o;
                const peak = prof[best] - bg;
                if (Math.abs(peak) < 0.05) continue;
                let lo = best, hi = best;
                while (lo > 0 && (prof[lo - 1] - bg) * Math.sign(peak) > Math.abs(peak) * 0.35) lo--;
                while (hi < prof.length - 1 && (prof[hi + 1] - bg) * Math.sign(peak) > Math.abs(peak) * 0.35) hi++;
                if (lo === 0 || hi === prof.length - 1) continue;
                widths.push(Math.max(Math.abs(lo - mid), Math.abs(hi - mid)) + 0.5);
            }
        }
        if (widths.length < 2) return null;
        widths.sort((a, b) => a - b);
        const half = widths[Math.floor(widths.length * 0.75)] + 1;
        return half <= lim ? half / H : null;
    },

    // Scratches and creases on a picture (ImageData of the whole photo):
    // lines for them. sensitivity 0–100; widest: the widest looked for
    // and shortest, in heights of the photo.
    // Each is traced: from the strongest ridge pixel not yet on a line,
    // along the ridge's own direction (from the pixels round it), a few
    // pixels a step, centred again across it each step, over short gaps
    // (where it crosses something as light as itself); then kept if it's
    // long, thin and a ridge.
    findScratches(img, { sensitivity = 50, widest = 0.006, shortest = 0.04, max = 60, keep = [] } = {}) {
        const W = img.width, H = img.height, n = W * H;
        const Y = this.luma(img);
        const maxW = Math.max(5, widest * H), minLen = Math.max(24, shortest * H);
        const r = Math.max(3, Math.round(maxW * 1.5));
        const B = this.blur(Y, W, H, r);
        const D = new Float32Array(n);
        for (let i = 0; i < n; i++) D[i] = Y[i] - B[i];
        const sens = Math.min(100, Math.max(0, sensitivity)) / 100;
        const thr = 0.09 - 0.06 * sens;
        const at = (x, y) => {
            const ix = Math.round(x - 0.5), iy = Math.round(y - 0.5);
            return ix < 0 || iy < 0 || ix >= W || iy >= H ? 0 : D[iy * W + ix];
        };
        const used = new Uint8Array(n);
        const seeds = [];
        for (let i = 0; i < n; i++) if (Math.abs(D[i]) > thr * 1.5) seeds.push(i);
        seeds.sort((p, q) => Math.abs(D[q]) - Math.abs(D[p]));
        const step = 3, look = Math.max(2, Math.ceil(maxW / 2)), gaps = 4;
        // The ridge's direction at (x, y): the long way of the like pixels round it
        const direction = (x, y, sign) => {
            let sxx = 0, syy = 0, sxy = 0, m = 0;
            const R = Math.ceil(maxW * 1.5) + 3;
            for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
                if (at(x + dx, y + dy) * sign < thr * 0.7) continue;
                sxx += dx * dx; syy += dy * dy; sxy += dx * dy; m++;
            }
            if (m < 4) return null;
            const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
            const l1 = (sxx + syy) / 2 + Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy), l2 = (sxx + syy) / 2 - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
            if (l1 < 3 * Math.max(1e-6, l2)) return null;   // a blob, not a line
            return [Math.cos(ang), Math.sin(ang)];
        };
        const found = [];
        let tried = 0;
        for (const i0 of seeds) {
            if (used[i0] || found.length >= max * 3 || tried > 4000) continue;
            tried++;
            const sign = D[i0] > 0 ? 1 : -1;
            const x0 = i0 % W + 0.5, y0 = ((i0 / W) | 0) + 0.5;
            const dir0 = direction(x0, y0, sign);
            if (!dir0) { used[i0] = 1; continue; }
            // Both ways from the seed
            const half = (ux, uy) => {
                const path = [];
                let x = x0, y = y0, miss = 0;
                for (let k = 0; k < 4000; k++) {
                    const nx = x + ux * step, ny = y + uy * step;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
                    // across: the strongest like pixel near the line
                    let best = 0, bo = 0;
                    for (let o = -look; o <= look; o++) {
                        const v = at(nx - uy * o, ny + ux * o) * sign;
                        if (v > best || (v === best && Math.abs(o) < Math.abs(bo))) { best = v; bo = o; }
                    }
                    if (best > thr * 0.6) {
                        const cx = nx - uy * bo, cy = ny + ux * bo;
                        // the direction follows a gentle bend
                        const dx = cx - x, dy = cy - y, l = Math.hypot(dx, dy) || 1;
                        let vx = ux * 0.75 + dx / l * 0.25, vy = uy * 0.75 + dy / l * 0.25;
                        const vl = Math.hypot(vx, vy);
                        ux = vx / vl; uy = vy / vl;
                        x = cx; y = cy;
                        miss = 0;
                        path.push([x, y, 1]);
                    } else {
                        if (++miss > gaps) break;
                        x = nx; y = ny;
                        path.push([x, y, 0]);
                    }
                }
                while (path.length && !path[path.length - 1][2]) path.pop();
                return path;
            };
            const fwd = half(dir0[0], dir0[1]), back = half(-dir0[0], -dir0[1]);
            const path = back.reverse().concat([[x0, y0, 1]], fwd);
            let len = 0;
            for (let k = 1; k < path.length; k++) len += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
            // Marked as looked at, so it isn't traced again
            for (const [x, y] of path) {
                for (let dy = -look; dy <= look; dy++) for (let dx = -look; dx <= look; dx++) {
                    const ix = Math.round(x - 0.5) + dx, iy = Math.round(y - 0.5) + dy;
                    if (ix >= 0 && iy >= 0 && ix < W && iy < H) used[iy * W + ix] = 1;
                }
            }
            if (len < minLen) continue;
            // How wide (the like pixels either side of its middle), and a
            // ridge, not an edge: either side of it is as the ground is
            const widths = [];
            let mid = 0, sideA = 0, sideB = 0, m = 0;
            for (let k = 1; k < path.length; k++) {
                if (!path[k][2]) continue;
                const [x, y] = path[k], [px, py] = path[k - 1];
                const l = Math.hypot(x - px, y - py) || 1, ux = (x - px) / l, uy = (y - py) / l;
                // out to where it's under 40% of its middle (or the threshold)
                const cut = Math.max(thr * 0.5, at(x, y) * sign * 0.4);
                let lo = 0, hi = 0;
                while (lo > -maxW * 1.5 && at(x + uy * (lo - 1), y - ux * (lo - 1)) * sign > cut) lo--;
                while (hi < maxW * 1.5 && at(x + uy * (hi + 1), y - ux * (hi + 1)) * sign > cut) hi++;
                widths.push(hi - lo + 1);
                const o = (hi - lo + 1) / 2 + 2.5;
                mid += at(x, y); sideA += at(x + uy * o, y - ux * o); sideB += at(x - uy * o, y + ux * o); m++;
            }
            if (m < 3) continue;
            widths.sort((p, q) => p - q);
            const width = widths[Math.floor(widths.length * 0.75)];
            if (width > maxW) continue;
            mid /= m; sideA /= m; sideB /= m;
            if (mid * sign < thr) continue;
            if (sideA * sign < -0.35 * Math.abs(mid) || sideB * sign < -0.35 * Math.abs(mid)) continue;
            found.push({ pts: this.simplify(path.map(([x, y]) => [x, y]), 0.75, this.LINE_POINTS), half: width / 2 + 1, score: Math.abs(mid) * len });
        }
        found.sort((p, q) => q.score - p.score);
        const out = [];
        for (const f of found) {
            if (out.length >= max) break;
            const rr = Math.min(this.MAX_R, Math.max(this.MIN_R, f.half / H));
            const p = f.pts.flatMap(([x, y]) => [x / W, y / H]);
            // Mostly on a line already there (a stronger one, or one kept): left
            const onLine = (s2) => {
                if (s2.t !== 'line') return false;
                const q = s2.pts, R2 = s2.r * H + rr * H + 2;
                let on = 0, all = 0;
                for (const [x, y] of this.along(f.pts, 2)) {
                    all++;
                    for (let k = 0; k + 3 < q.length; k += 2) {
                        const ax = q[k] * W, ay = q[k + 1] * H, dx = q[k + 2] * W - ax, dy = q[k + 3] * H - ay, l2 = dx * dx + dy * dy || 1;
                        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
                        if (Math.hypot(x - ax - dx * t, y - ay - dy * t) <= R2) { on++; break; }
                    }
                }
                return on > all * 0.6;
            };
            if (keep.some(onLine) || out.some(onLine)) continue;
            out.push({ t: 'line', x: p[0], y: p[1], sx: p[0], sy: p[1], r: rr, f: 0.3, o: 1, d: 1, pts: p });
        }
        return out;
    },

    // Points every `gap` pixels along a path ([[x, y], …])
    along(path, gap) {
        const out = [path[0]];
        for (let k = 1; k < path.length; k++) {
            const [ax, ay] = path[k - 1], [bx, by] = path[k], l = Math.hypot(bx - ax, by - ay);
            for (let q = gap; q <= l; q += gap) out.push([ax + (bx - ax) * q / l, ay + (by - ay) * q / l]);
        }
        return out;
    },

    // A path ([[x, y], …]) with the points it doesn't need taken out
    // (Douglas–Peucker, to within tol), at most `most` points
    simplify(path, tol, most) {
        if (path.length <= 2) return path.slice();
        let t = tol, out;
        do {
            const keepIt = new Uint8Array(path.length);
            keepIt[0] = keepIt[path.length - 1] = 1;
            const st = [[0, path.length - 1]];
            while (st.length) {
                const [a, b] = st.pop();
                const [ax, ay] = path[a], [bx, by] = path[b], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
                let far = -1, fd = t;
                for (let k = a + 1; k < b; k++) {
                    const d = Math.abs((path[k][0] - ax) * dy - (path[k][1] - ay) * dx) / l;
                    if (d > fd) { fd = d; far = k; }
                }
                if (far >= 0) { keepIt[far] = 1; st.push([a, far], [far, b]); }
            }
            out = path.filter((p, k) => keepIt[k]);
            t *= 1.5;
        } while (out.length > most);
        return out;
    },

    // The healing field: (x, y, channel) → what to add to the source there.
    // Solved on a small grid over the spot's box: cells outside the circle
    // keep the difference measured there (averaged over the cell), cells
    // inside are relaxed until each is the mean of its neighbours (a soap
    // film stretched over the edge's values); read back bilinearly.
    membrane(dst, bx0, by0, S, sAt, b) {
        const w = dst.width, h = dst.height, D = dst.data;
        const R = b.R;
        // Cells: up to 40 across, at least a pixel each
        const span = 2 * R + 2;
        const G = Math.max(3, Math.min(40, Math.ceil(span)));
        const cell = span / G;
        const gx0 = b.cx - R - 1, gy0 = b.cy - R - 1;
        const N = G + 2; // a ring of fixed cells all round
        const val = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
        const fixed = new Uint8Array(N * N);
        const cnt = new Float32Array(N * N);
        // The difference, cell by cell, from pixels outside the circle
        // (and just inside its edge, where the feather starts mixing)
        const edge = Math.max(R - 1.5, R * 0.85);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const X = bx0 + x + 0.5, Y = by0 + y + 0.5;
                if (Math.hypot(X - b.cx, Y - b.cy) < edge) continue;
                const gi = Math.min(N - 1, Math.max(0, Math.floor((X - gx0) / cell) + 1));
                const gj = Math.min(N - 1, Math.max(0, Math.floor((Y - gy0) / cell) + 1));
                const k = gj * N + gi, i = (y * w + x) * 4, j = sAt(bx0 + x, by0 + y);
                for (let c = 0; c < 3; c++) val[c][k] += D[i + c] - S[j + c];
                cnt[k]++;
            }
        }
        let mean = [0, 0, 0], m = 0;
        for (let k = 0; k < N * N; k++) {
            if (!cnt[k]) continue;
            for (let c = 0; c < 3; c++) { val[c][k] /= cnt[k]; mean[c] += val[c][k]; }
            fixed[k] = 1;
            m++;
        }
        if (!m) return null;
        mean = mean.map(v => v / m);
        // Cells with no outside pixels, far from the edge: unknown
        for (let gj = 0; gj < N; gj++) {
            for (let gi = 0; gi < N; gi++) {
                const k = gj * N + gi;
                const cxp = gx0 + (gi - 0.5) * cell, cyp = gy0 + (gj - 0.5) * cell;
                const inside = Math.hypot(cxp - b.cx, cyp - b.cy) < edge;
                if (inside && fixed[k]) fixed[k] = 0;
                if (!fixed[k]) for (let c = 0; c < 3; c++) val[c][k] = mean[c];
            }
        }
        // The outermost ring of cells, if empty, takes its neighbour's
        for (let k = 0; k < N * N; k++) if (!fixed[k] && !cnt[k]) {
            const gi = k % N, gj = (k - gi) / N;
            if (gi === 0 || gj === 0 || gi === N - 1 || gj === N - 1) fixed[k] = 1;
        }
        // Relaxed (over-relaxed Gauss–Seidel)
        const iters = Math.min(400, 20 + G * 8);
        for (let it = 0; it < iters; it++) {
            for (let gj = 1; gj < N - 1; gj++) {
                for (let gi = 1; gi < N - 1; gi++) {
                    const k = gj * N + gi;
                    if (fixed[k]) continue;
                    for (let c = 0; c < 3; c++) {
                        const v = val[c];
                        const avg = (v[k - 1] + v[k + 1] + v[k - N] + v[k + N]) / 4;
                        v[k] += 1.85 * (avg - v[k]);
                    }
                }
            }
        }
        return (X, Y, c) => {
            const fx = (X - gx0) / cell + 0.5, fy = (Y - gy0) / cell + 0.5;
            const i0 = Math.min(N - 2, Math.max(0, Math.floor(fx))), j0 = Math.min(N - 2, Math.max(0, Math.floor(fy)));
            const tx = Math.min(1, Math.max(0, fx - i0)), ty = Math.min(1, Math.max(0, fy - j0));
            const v = val[c], k = j0 * N + i0;
            const top = v[k] + (v[k + 1] - v[k]) * tx, bot = v[k + N] + (v[k + N + 1] - v[k + N]) * tx;
            return top + (bot - top) * ty;
        };
    },

    // ---- Picking a source ----

    // Brightness of a whole picture (ImageData), 0–1
    luma(img) {
        const n = img.width * img.height, Y = new Float32Array(n), d = img.data;
        for (let i = 0; i < n; i++) Y[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
        return Y;
    },

    // Where to copy a spot at (x, y), radius r (photo units) from: the
    // place nearby whose surroundings look most like the spot's, never
    // overlapping it, inside the photo. Y: the photo's brightness at W × H.
    autoSource(Y, W, H, x, y, r, avoid = null) {
        const R = Math.max(1, r * H), cx = x * W, cy = y * H;
        const step = Math.max(1, R / 5);
        // The ring round the spot: what the source's ring should match
        const ring = [];
        for (let a = 0; a < 24; a++) {
            const t = a / 24 * Math.PI * 2;
            for (const k of [1.15, 1.45, 1.8]) ring.push([Math.cos(t) * R * k, Math.sin(t) * R * k]);
        }
        // And the inside, sparsely (a source that's itself a speck is no good)
        const inner = [];
        for (let yy = -R; yy <= R; yy += step) for (let xx = -R; xx <= R; xx += step) if (xx * xx + yy * yy <= R * R) inner.push([xx, yy]);
        const at = (px, py) => {
            const ix = Math.min(W - 1, Math.max(0, Math.round(px))), iy = Math.min(H - 1, Math.max(0, Math.round(py)));
            return Y[iy * W + ix];
        };
        const want = ring.map(([dx, dy]) => at(cx + dx, cy + dy));
        const wantMean = want.reduce((a, b) => a + b, 0) / want.length;
        let best = null;
        for (const dist of [2.3, 3, 4, 5.5]) {
            for (let a = 0; a < 16; a++) {
                const t = a / 16 * Math.PI * 2 + dist;
                const qx = cx + Math.cos(t) * R * dist, qy = cy + Math.sin(t) * R * dist;
                if (qx - R * 1.8 < 0 || qy - R * 1.8 < 0 || qx + R * 1.8 > W || qy + R * 1.8 > H) continue;
                if (avoid && avoid.some(s => Math.hypot(qx - s.x * W, qy - s.y * H) < (R + s.r * H) * 1.1)) continue;
                let e = 0;
                ring.forEach(([dx, dy], i) => { const d = at(qx + dx, qy + dy) - want[i]; e += d * d; });
                e /= ring.length;
                // Its inside should be as plain as its surroundings
                let v = 0;
                for (const [dx, dy] of inner) { const d = at(qx + dx, qy + dy) - wantMean; v += d * d; }
                v /= Math.max(1, inner.length);
                const score = e + 0.5 * v + 0.0004 * dist;
                if (!best || score < best.score) best = { score, sx: qx / W, sy: qy / H };
            }
        }
        if (best) return { sx: best.sx, sy: best.sy };
        // A spot at the very edge: straight in from it
        const ix = cx < W / 2 ? 1 : -1, iy = cy < H / 2 ? 1 : -1;
        return { sx: (cx + ix * R * 2.5) / W, sy: (cy + iy * R * 0.5) / H };
    },

    // The radius (photo heights) that covers the speck clicked at (x, y):
    // the pixels round there much darker or lighter than their
    // surroundings, joined to the one clicked (or near it); null if
    // there's no speck there, or it's bigger than `most`
    fitSpeck(Y, W, H, x, y, most) {
        const R = Math.max(2, Math.ceil(most * H * 1.5));
        const cx = Math.round(x * W - 0.5), cy = Math.round(y * H - 0.5);
        const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R), x1 = Math.min(W - 1, cx + R), y1 = Math.min(H - 1, cy + R);
        if (x1 <= x0 || y1 <= y0) return null;
        // The surroundings: the median of a ring round the box's edge
        const ring = [];
        for (let i = x0; i <= x1; i++) ring.push(Y[y0 * W + i], Y[y1 * W + i]);
        for (let j = y0; j <= y1; j++) ring.push(Y[j * W + x0], Y[j * W + x1]);
        ring.sort((a, b) => a - b);
        const bg = ring[ring.length >> 1];
        const spread = Math.max(0.02, ring[Math.floor(ring.length * 0.9)] - ring[Math.floor(ring.length * 0.1)]);
        const thr = Math.max(0.06, spread * 1.2);
        const odd = (i, j) => Math.abs(Y[j * W + i] - bg) > thr;
        // The odd pixel nearest the click, within a few pixels
        let seed = null;
        for (let d = 0; d <= 3 && !seed; d++) {
            for (let j = cy - d; j <= cy + d && !seed; j++) for (let i = cx - d; i <= cx + d && !seed; i++) {
                if (i >= x0 && i <= x1 && j >= y0 && j <= y1 && odd(i, j)) seed = [i, j];
            }
        }
        if (!seed) return null;
        const seen = new Set([seed[1] * W + seed[0]]);
        const stack = [seed];
        let far = 0;
        while (stack.length) {
            const [i, j] = stack.pop();
            // Touching the box's edge: not a speck (or a big one)
            if (i <= x0 || j <= y0 || i >= x1 || j >= y1) return null;
            far = Math.max(far, Math.hypot(i + 0.5 - x * W, j + 0.5 - y * H));
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
                const ii = i + di, jj = j + dj, k = jj * W + ii;
                if (!seen.has(k) && odd(ii, jj)) { seen.add(k); stack.push([ii, jj]); }
            }
        }
        const r = (far + 1.5) * 1.25 / H;
        return r <= most ? r : null;
    },

    // ---- The dust finder ----

    // Box blurs, three passes (about a Gaussian), of a W × H field
    blur(src, W, H, r) {
        const a = new Float32Array(src), b = new Float32Array(src.length);
        const pass = (from, to, horiz) => {
            const len = horiz ? W : H, lines = horiz ? H : W;
            const k = 2 * r + 1;
            for (let l = 0; l < lines; l++) {
                const at = horiz ? (i) => l * W + i : (i) => i * W + l;
                let sum = 0;
                for (let i = -r; i <= r; i++) sum += from[at(Math.min(len - 1, Math.max(0, i)))];
                for (let i = 0; i < len; i++) {
                    to[at(i)] = sum / k;
                    sum += from[at(Math.min(len - 1, i + r + 1))] - from[at(Math.max(0, i - r))];
                }
            }
        };
        for (let i = 0; i < 3; i++) { pass(a, b, true); pass(b, a, false); }
        return a;
    },

    // Specks on a picture (ImageData of the whole photo, any size):
    // heal spots for them. sensitivity 0–100; size: the biggest speck
    // looked for, in heights of the photo
    findDust(img, { sensitivity = 50, maxSize = 0.012, max = 300, keep = [] } = {}) {
        const W = img.width, H = img.height, n = W * H;
        const Y = this.luma(img);
        // What's round each pixel, a little bigger than the biggest speck
        const r = Math.max(2, Math.round(maxSize * H * 1.2));
        const B = this.blur(Y, W, H, r);
        // How busy it is round there (texture, edges): a wider look
        const Y2 = new Float32Array(n);
        for (let i = 0; i < n; i++) { const d = Y[i] - B[i]; Y2[i] = d * d; }
        const V = this.blur(Y2, W, H, r * 2);
        const sens = Math.min(100, Math.max(0, sensitivity)) / 100;
        const thr = 0.11 - 0.075 * sens;          // how much darker or lighter
        const busy = 4.2 - 1.6 * sens;            // and how far above the texture
        const mark = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            const d = Math.abs(Y[i] - B[i]);
            if (d > thr && d > busy * Math.sqrt(V[i])) mark[i] = Y[i] < B[i] ? 1 : 2;
        }
        // Joined into specks
        const seen = new Int32Array(n).fill(-1);
        const found = [];
        const maxPx = Math.max(2, maxSize * H);
        const stack = [];
        for (let i0 = 0; i0 < n; i0++) {
            if (!mark[i0] || seen[i0] >= 0) continue;
            const kind = mark[i0];
            let area = 0, sx = 0, sy = 0, minX = W, minY = H, maxX = 0, maxY = 0, contrast = 0;
            stack.push(i0);
            seen[i0] = i0;
            while (stack.length) {
                const i = stack.pop();
                const x = i % W, y = (i - x) / W;
                area++; sx += x; sy += y;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                contrast += Math.abs(Y[i] - B[i]);
                if (area > maxPx * maxPx * 4) continue; // too big: stop growing
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx, yy = y + dy;
                        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                        const j = yy * W + xx;
                        if (mark[j] === kind && seen[j] < 0) { seen[j] = i0; stack.push(j); }
                    }
                }
            }
            const bw = maxX - minX + 1, bh = maxY - minY + 1;
            const big = Math.max(bw, bh);
            if (big > maxPx * 2 || area > maxPx * maxPx * 3) continue;   // a thing, not a speck
            if (big > 3 && area < big * 0.6) continue;                   // a thin line: an edge
            const cx = sx / area + 0.5, cy = sy / area + 0.5;
            // On an edge of the photo's own (what's round it changes fast): left
            const gi = Math.min(n - 1, Math.round(cy - 0.5) * W + Math.round(cx - 0.5));
            const xl = Math.max(0, Math.round(cx - 0.5) - r), xr = Math.min(W - 1, Math.round(cx - 0.5) + r);
            const yt = Math.max(0, Math.round(cy - 0.5) - r), yb = Math.min(H - 1, Math.round(cy - 0.5) + r);
            const grad = Math.max(Math.abs(B[Math.round(cy - 0.5) * W + xr] - B[Math.round(cy - 0.5) * W + xl]), Math.abs(B[yb * W + Math.round(cx - 0.5)] - B[yt * W + Math.round(cx - 0.5)]));
            if (grad > thr * 1.5 || !isFinite(B[gi])) continue;
            const rad = Math.max(1.2, Math.hypot(bw, bh) / 2 * 1.35 + 1);
            found.push({ x: cx / W, y: cy / H, r: rad / H, score: contrast * Math.sqrt(area) });
        }
        found.sort((a, b) => b.score - a.score);
        const out = [];
        const avoid = keep.slice();
        for (const f of found) {
            if (out.length >= max) break;
            // Already covered by a spot there
            if (avoid.some(s => Math.hypot((s.x - f.x) * W, (s.y - f.y) * H) < Math.max(s.r, f.r) * H)) continue;
            const r0 = Math.min(this.MAX_R, Math.max(this.MIN_R, f.r, 1.5 / H));
            const src = this.autoSource(Y, W, H, f.x, f.y, r0, avoid.concat(out));
            const s = { t: 'heal', x: f.x, y: f.y, r: r0, sx: src.sx, sy: src.sy, f: 0.35, o: 1, d: 1 };
            out.push(s);
            avoid.push(s);
        }
        return out;
    }
};
