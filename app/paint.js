// Paint: layers painted over a photo (paint-editor.js is the screen).
// Like every edit it's kept with the photo, never in the file until it's
// saved or exported: the photo's edit gets `paint`, a list of layers, and
// each layer's pixels are a PNG in the project's own folder
// (.jeditor/paint/<id>-<layer>-<rev>.png; a new rev each time a layer
// changes, so Ctrl+Z on the edit finds the old one still there).
//
//   paint: { id, w, h, layers: [{ id, rev, name, opacity, blend, hidden, lock?, clip?, fixed?, group?, adj?, mask?, text?, shape? }], groups?: [{ id, name, hidden, open }],
//            ext?, pad?, fill? }
//
// Layers cover the whole photo as it is on disk (before any crop or turn,
// w × h: the photo's own size, or less for a very big one), so cropping
// later doesn't move what was painted. They go on last, over the photo as
// cropped and adjusted, so what's painted looks as it was painted (a film
// look or a slider doesn't change it); they're scaled to whatever size the
// photo is shown or saved at.
//
// The canvas can be bigger (or smaller) than the photo: Paint's Canvas
// size and its crop. pad { l, t, r, b } is how far the canvas's edges are
// out from the picture's as it's shown (cropped and turned), in layer px
// (less than 0: in from it); fill is the colour of what's added (none:
// clear). The layers then reach past the photo: ext { l, t, r, b } is how
// far, on the photo as on disk, so the layer pictures are
// (w + l + r) × (h + t + b), the photo at (l, t). Only what's drawn as
// shown is padded (onto with a crop editor): a photo-sized picture (the
// Crop tool, Adjust) shows just the photo's part of the layers.

const Paint = {
    DIR: 'paint',
    MAX_EDGE: 3000,
    MAX_LAYERS: 24,
    BLENDS: [
        ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
        ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'],
        ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
        ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']
    ],

    init(app) {
        this.app = app;
    },

    // ---- The record ----

    has(e) {
        return !!(e && e.paint && Array.isArray(e.paint.layers) && (e.paint.layers.length || this.padOf(e.paint)));
    },

    // ---- Adjustment layers ----
    // A layer that changes what's under it (l.adj: { kind, ... }), through
    // its mask; its own pixels are unused

    ADJ: {
        bc: ['Brightness/Contrast', { b: 0, c: 0 }],
        hsl: ['Hue/Saturation', { h: 0, s: 0, l: 0 }],
        levels: ['Levels', { lo: 0, hi: 255, g: 1 }],
        bw: ['Black & white', {}],
        invert: ['Invert', {}],
        // Filters (⋯ → Filter): sizes in the picture's own pixels
        gauss: ['Gaussian blur', { r: 4 }, true],
        motion: ['Motion blur', { a: 0, d: 20 }, true],
        unsharp: ['Unsharp mask', { amt: 100, r: 2, th: 0 }, true],
        noise: ['Add noise', { amt: 10 }, true],
        median: ['Median', { r: 2 }, true],
        highpass: ['High pass', { r: 10 }, true]
    },

    cleanAdj(a) {
        if (!a || typeof a !== 'object' || !this.ADJ[a.kind]) return null;
        const num = (x, lo, hi, d) => typeof x === 'number' && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
        if (a.kind === 'bc') return { kind: 'bc', b: num(a.b, -100, 100, 0), c: num(a.c, -100, 100, 0) };
        if (a.kind === 'hsl') return { kind: 'hsl', h: num(a.h, -180, 180, 0), s: num(a.s, -100, 100, 0), l: num(a.l, -100, 100, 0) };
        if (a.kind === 'levels') {
            const lo = num(a.lo, 0, 253, 0);
            return { kind: 'levels', lo, hi: num(a.hi, lo + 2, 255, 255), g: num(a.g, 0.1, 10, 1) };
        }
        if (a.kind === 'gauss' || a.kind === 'highpass') return { kind: a.kind, r: num(a.r, 0.5, 100, a.kind === 'gauss' ? 4 : 10) };
        if (a.kind === 'motion') return { kind: 'motion', a: num(a.a, -180, 180, 0), d: num(a.d, 1, 200, 20) };
        if (a.kind === 'unsharp') return { kind: 'unsharp', amt: num(a.amt, 1, 500, 100), r: num(a.r, 0.5, 50, 2), th: num(a.th, 0, 255, 0) };
        if (a.kind === 'noise') return { kind: 'noise', amt: num(a.amt, 0, 100, 10) };
        if (a.kind === 'median') return { kind: 'median', r: num(a.r, 1, 20, 2) };
        return { kind: a.kind };
    },

    // Box blur of RGBA (in place), r px each way, rows then columns
    boxBlur(d, w, h, r) {
        r = Math.max(0, Math.round(r));
        if (!r) return;
        const tmp = new Float32Array(Math.max(w, h) * 4), n = 2 * r + 1;
        const pass = (len, count, at) => {
            for (let k = 0; k < count; k++) {
                let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
                for (let i = -r; i <= r; i++) { const j = at(k, Math.min(len - 1, Math.max(0, i))); s0 += d[j]; s1 += d[j + 1]; s2 += d[j + 2]; s3 += d[j + 3]; }
                for (let i = 0; i < len; i++) {
                    tmp[i * 4] = s0 / n; tmp[i * 4 + 1] = s1 / n; tmp[i * 4 + 2] = s2 / n; tmp[i * 4 + 3] = s3 / n;
                    const o = at(k, Math.max(0, i - r)), q = at(k, Math.min(len - 1, i + r + 1));
                    s0 += d[q] - d[o]; s1 += d[q + 1] - d[o + 1]; s2 += d[q + 2] - d[o + 2]; s3 += d[q + 3] - d[o + 3];
                }
                for (let i = 0; i < len; i++) { const j = at(k, i); d[j] = tmp[i * 4]; d[j + 1] = tmp[i * 4 + 1]; d[j + 2] = tmp[i * 4 + 2]; d[j + 3] = tmp[i * 4 + 3]; }
            }
        };
        pass(w, h, (y, x) => (y * w + x) * 4);
        pass(h, w, (x, y) => (y * w + x) * 4);
    },

    // Near enough to a Gaussian of that radius: three box blurs
    gaussBlur(d, w, h, r) {
        const b = Math.max(0, r / 1.7);
        for (let i = 0; i < 3; i++) this.boxBlur(d, w, h, b);
    },

    // The filters, on w × h px; k: screen (or canvas) px to the picture's
    filterPixels(d, a, w, h, k) {
        if (a.kind === 'gauss') { this.gaussBlur(d, w, h, a.r * k); return; }
        if (a.kind === 'unsharp' || a.kind === 'highpass') {
            const b = new Uint8ClampedArray(d);
            this.gaussBlur(b, w, h, a.r * k);
            const amt = a.kind === 'unsharp' ? a.amt / 100 : 1, th = a.th || 0;
            for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
                const diff = d[i + c] - b[i + c];
                if (a.kind === 'highpass') d[i + c] = 128 + diff;
                else if (Math.abs(diff) >= th) d[i + c] = d[i + c] + diff * amt;
            }
            return;
        }
        if (a.kind === 'motion') {
            const src = new Uint8ClampedArray(d), dist = a.d * k, n = Math.max(2, Math.min(64, Math.round(dist)));
            const dx = Math.cos(a.a * Math.PI / 180) * dist, dy = -Math.sin(a.a * Math.PI / 180) * dist;
            const offs = [];
            for (let i = 0; i < n; i++) { const t = i / (n - 1) - 0.5; offs.push([Math.round(dx * t), Math.round(dy * t)]); }
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
                for (const [ox, oy] of offs) {
                    const j = (Math.min(h - 1, Math.max(0, y + oy)) * w + Math.min(w - 1, Math.max(0, x + ox))) * 4;
                    s0 += src[j]; s1 += src[j + 1]; s2 += src[j + 2]; s3 += src[j + 3];
                }
                const i = (y * w + x) * 4;
                d[i] = s0 / n; d[i + 1] = s1 / n; d[i + 2] = s2 / n; d[i + 3] = s3 / n;
            }
            return;
        }
        if (a.kind === 'noise') {
            // (the same grain each time it's drawn)
            const amt = a.amt * 2.55;
            let seed = 12345;
            for (let i = 0; i < d.length; i += 4) {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                const v = ((seed / 0x7fffffff) - 0.5) * 2 * amt;
                d[i] += v; d[i + 1] += v; d[i + 2] += v;
            }
            return;
        }
        if (a.kind === 'median') {
            const r = Math.max(1, Math.min(20, Math.round(a.r * k))), src = new Uint8ClampedArray(d);
            const hist = new Uint32Array(256);
            for (let c = 0; c < 3; c++) for (let y = 0; y < h; y++) {
                hist.fill(0);
                let cnt = 0;
                const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
                const col = (x, s) => { if (x < 0 || x >= w) return; for (let yy = y0; yy <= y1; yy++) { hist[src[(yy * w + x) * 4 + c]] += s; cnt += s; } };
                for (let x = -r; x <= r; x++) col(x, 1);
                for (let x = 0; x < w; x++) {
                    let half = cnt / 2, acc = 0, v = 0;
                    for (; v < 256; v++) { acc += hist[v]; if (acc > half) break; }
                    d[(y * w + x) * 4 + c] = v;
                    col(x - r, -1);
                    col(x + r + 1, 1);
                }
            }
        }
    },

    // The pixels (RGBA, in place) as the adjustment makes them
    adjPixels(d, a, w = 0, h = 0, k = 1) {
        if (this.ADJ[a.kind] && this.ADJ[a.kind][2]) { this.filterPixels(d, a, w, h, k); return; }
        const n = d.length;
        if (a.kind === 'bw') {
            for (let i = 0; i < n; i += 4) { const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); d[i] = d[i + 1] = d[i + 2] = y; }
            return;
        }
        if (a.kind === 'hsl') {
            const dh = a.h / 360, ks = 1 + a.s / 100, kl = a.l / 100;
            for (let i = 0; i < n; i += 4) {
                const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
                const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                let h = 0, s = 0, l = (mx + mn) / 2;
                if (mx !== mn) {
                    const c = mx - mn;
                    s = l > 0.5 ? c / (2 - mx - mn) : c / (mx + mn);
                    h = mx === r ? (g - b) / c + (g < b ? 6 : 0) : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
                    h /= 6;
                }
                h = ((h + dh) % 1 + 1) % 1;
                s = Math.min(1, s * ks);
                l = kl > 0 ? l + (1 - l) * kl : l * (1 + kl);
                if (!s) { d[i] = d[i + 1] = d[i + 2] = l * 255; continue; }
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
                const f = (t) => { t = t < 0 ? t + 1 : t > 1 ? t - 1 : t; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
                d[i] = f(h + 1 / 3) * 255; d[i + 1] = f(h) * 255; d[i + 2] = f(h - 1 / 3) * 255;
            }
            return;
        }
        const lut = new Uint8ClampedArray(256);
        for (let v = 0; v < 256; v++) {
            let x = v / 255;
            if (a.kind === 'bc') {
                const k = a.c >= 0 ? 1 / Math.max(0.01, 1 - a.c / 100) : 1 + a.c / 100;
                x = (x - 0.5) * k + 0.5 + a.b / 200;
            } else if (a.kind === 'levels') {
                x = Math.pow(Math.min(1, Math.max(0, (v - a.lo) / (a.hi - a.lo))), 1 / a.g);
            } else if (a.kind === 'invert') x = 1 - x;
            lut[v] = Math.round(x * 255);
        }
        for (let i = 0; i < n; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    },

    // What's on canvas so far, adjusted, put back over it (at opacity,
    // through the mask drawMask draws, if any; each pixel as see-through
    // as it was)
    // key: a filter's result kept under it (a slow one, in the editor),
    // used again while nothing under it has changed; r: the part of the
    // canvas that's the picture (filters reach no further)
    adjustCanvas(canvas, adj, drawMask, opacity = 1, k = 1, key = null, r = null) {
        const W = canvas.width, H = canvas.height;
        if (!W || !H || !opacity) return;
        r = r || { x: 0, y: 0, w: W, h: H };
        const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
        const w = Math.min(W, Math.ceil(r.x + r.w)) - x0, h = Math.min(H, Math.ceil(r.y + r.h)) - y0;
        if (w <= 0 || h <= 0) return;
        let t = this._adjC;
        if (!t || t.width !== W || t.height !== H) { t = this._adjC = document.createElement('canvas'); t.width = W; t.height = H; }
        const tg = t.getContext('2d', { willReadFrequently: true });
        tg.setTransform(1, 0, 0, 1, 0, 0);
        tg.globalAlpha = 1;
        tg.globalCompositeOperation = 'source-over';
        tg.clearRect(0, 0, W, H);
        this._fx = this._fx || new Map();
        const kept = key && this._fx.get(key);
        if (kept && kept.width === w && kept.height === h) {
            tg.drawImage(kept, x0, y0);
        } else {
            if (adj.kind === 'motion') {
                // Shifted copies averaged, on the GPU: copy i at 1/(i+1)
                const dist = adj.d * k, n = Math.max(2, Math.min(48, Math.round(dist)));
                const dx = Math.cos(adj.a * Math.PI / 180) * dist, dy = -Math.sin(adj.a * Math.PI / 180) * dist;
                // (its edges carried on outwards, so none of the outside comes in)
                const p = Math.ceil(dist / 2) + 2, src = document.createElement('canvas');
                src.width = w + 2 * p; src.height = h + 2 * p;
                const sg = src.getContext('2d');
                sg.drawImage(canvas, x0, y0, w, h, p, p, w, h);
                sg.drawImage(canvas, x0, y0, 1, h, 0, p, p, h);
                sg.drawImage(canvas, x0 + w - 1, y0, 1, h, p + w, p, p, h);
                sg.drawImage(src, 0, p, w + 2 * p, 1, 0, 0, w + 2 * p, p);
                sg.drawImage(src, 0, p + h - 1, w + 2 * p, 1, 0, p + h, w + 2 * p, p);
                tg.save();
                tg.beginPath(); tg.rect(x0, y0, w, h); tg.clip();
                for (let i = 0; i < n; i++) {
                    const f = i / (n - 1) - 0.5;
                    tg.globalAlpha = 1 / (i + 1);
                    tg.drawImage(src, x0 - p + dx * f, y0 - p + dy * f);
                }
                tg.restore();
                src.width = src.height = 0;
            } else {
                const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, h);
                this.adjPixels(img.data, adj, w, h, k);
                tg.putImageData(img, x0, y0);
            }
            if (key) {
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(t, x0, y0, w, h, 0, 0, w, h);
                this._fx.set(key, c);
                while (this._fx.size > 4) { const [k0, c0] = this._fx.entries().next().value; c0.width = c0.height = 0; this._fx.delete(k0); }
            }
        }
        if (drawMask) {
            tg.save();
            tg.globalCompositeOperation = 'destination-in';
            drawMask(tg);
            tg.restore();
        }
        const g = canvas.getContext('2d');
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = opacity;
        g.globalCompositeOperation = 'source-atop';
        g.drawImage(t, x0, y0, w, h, x0, y0, w, h);
        g.restore();
    },

    cleanText(t) {
        if (!t || typeof t !== 'object' || typeof t.v !== 'string' || !t.v.trim() || t.v.length > 5000) return null;
        const num = (x, lo, hi) => typeof x === 'number' && isFinite(x) && x >= lo && x <= hi;
        if (!num(t.size, 1, 2000) || !Array.isArray(t.m) || t.m.length !== 6 || !t.m.every(x => num(x, -1e6, 1e6))) return null;
        return {
            v: t.v,
            font: typeof t.font === 'string' && /^[\w\s,'"-]{1,80}$/.test(t.font) ? t.font : 'sans-serif',
            size: t.size, bold: !!t.bold, italic: !!t.italic,
            color: typeof t.color === 'string' && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#000000',
            alpha: num(t.alpha, 0, 1) ? t.alpha : 1,
            m: t.m.slice()
        };
    },

    cleanShape(t) {
        if (!t || typeof t !== 'object' || !['line', 'arrow', 'rect', 'roundrect', 'ellipse', 'polygon'].includes(t.kind)) return null;
        const num = (x, lo, hi) => typeof x === 'number' && isFinite(x) && x >= lo && x <= hi;
        const pt = (q) => Array.isArray(q) && q.length === 2 && q.every(x => num(x, -1e6, 1e6));
        const col = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
        if (!pt(t.a) || !pt(t.b) || !Array.isArray(t.m) || t.m.length !== 6 || !t.m.every(x => num(x, -1e6, 1e6))) return null;
        return {
            kind: t.kind, a: t.a.slice(), b: t.b.slice(),
            stroke: col(t.stroke) ? t.stroke : '#000000',
            lw: num(t.lw, 0, 2000) ? t.lw : 8,
            fill: col(t.fill) ? t.fill : null,
            from: ['none', 'fg', 'bg'].includes(t.from) ? t.from : 'none',
            arrow: !!t.arrow || t.kind === 'arrow',
            ...(t.kind === 'roundrect' ? { rad: num(t.rad, 0, 10000) ? t.rad : 0 } : {}),
            ...(t.kind === 'polygon' ? { pts: Array.isArray(t.pts) ? t.pts.filter(pt).slice(0, 1000).map(q => q.slice()) : [] } : {}),
            alpha: num(t.alpha, 0, 1) ? t.alpha : 1,
            m: t.m.slice()
        };
    },

    clean(v) {
        if (!v || typeof v !== 'object') return null;
        const id = (x) => typeof x === 'string' && /^[a-z0-9]{1,24}$/.test(x);
        const int = (x) => Number.isInteger(x) && x >= 1 && x <= 16384;
        if (!id(v.id) || !int(v.w) || !int(v.h) || !Array.isArray(v.layers)) return null;
        const blends = this.BLENDS.map(b => b[0]);
        const layers = [];
        for (const l of v.layers.slice(0, this.MAX_LAYERS)) {
            if (!l || !id(l.id) || !id(l.rev)) continue;
            layers.push({
                id: l.id, rev: l.rev,
                name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 60) : 'Layer',
                opacity: typeof l.opacity === 'number' && isFinite(l.opacity) ? +Math.min(1, Math.max(0, l.opacity)).toFixed(3) : 1,
                blend: blends.includes(l.blend) ? l.blend : 'source-over',
                hidden: !!l.hidden,
                // Transparency locked (kept only when on)
                ...(l.lock ? { lock: true } : {}),
                // Transformed: its original's rev (a file of its own), its
                // size, and the 3×3 from it to the layer
                ...(l.src && id(l.src.rev) && int(l.src.w) && int(l.src.h0) && Array.isArray(l.src.h) && l.src.h.length === 9 && l.src.h.every(x => typeof x === 'number' && isFinite(x))
                    ? { src: { rev: l.src.rev, w: l.src.w, h0: l.src.h0, h: l.src.h.slice() } } : {}),
                // An adjustment layer: what it does
                ...(this.cleanAdj(l.adj) ? { adj: this.cleanAdj(l.adj) } : {}),
                // Clipped to the layer below; the whole layer locked
                ...(l.clip ? { clip: true } : {}),
                // In a group (paint.groups)
                ...(id(l.group) && Array.isArray(v.groups) && v.groups.some(g => g && g.id === l.group) ? { group: l.group } : {}),
                ...(l.fixed ? { fixed: true } : {}),
                // Its mask's rev (a file of its own, maskFile): what shows
                ...(id(l.mask) ? { mask: l.mask } : {}),
                // A text layer: its words and how they're set, to change
                // later (its pixels are in its file as for any layer)
                ...(this.cleanText(l.text) ? { text: this.cleanText(l.text) } : {}),
                // A shape layer: the shape, its line and fill
                ...(this.cleanShape(l.shape) ? { shape: this.cleanShape(l.shape) } : {})
            });
        }
        const side = (o, min) => {
            if (!o || typeof o !== 'object') return null;
            const r = {};
            for (const k of ['l', 't', 'r', 'b']) r[k] = Number.isInteger(o[k]) ? Math.max(min, Math.min(16384, o[k])) : 0;
            return r.l || r.t || r.r || r.b ? r : null;
        };
        const ext = side(v.ext, 0), pad = side(v.pad, -16384);
        const fill = typeof v.fill === 'string' && /^#[0-9a-f]{6}$/i.test(v.fill) ? v.fill.toLowerCase() : null;
        // (a canvas that's smaller can't be smaller than nothing)
        const ok = !pad || (v.w + pad.l + pad.r >= 1 && v.h + pad.t + pad.b >= 1);
        if (!layers.length && !(pad && ok)) return null;
        const used = new Set(layers.map(l => l.group).filter(Boolean));
        const groups = (Array.isArray(v.groups) ? v.groups : []).filter(g => g && id(g.id) && used.has(g.id))
            .map(g => ({ id: g.id, name: typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 60) : 'Group', hidden: !!g.hidden, open: g.open !== false }));
        return { id: v.id, w: v.w, h: v.h, layers, ...(groups.length ? { groups } : {}), ...(ext ? { ext } : {}), ...(pad && ok ? { pad } : {}), ...(pad && ok && fill ? { fill } : {}) };
    },

    ZERO: { l: 0, t: 0, r: 0, b: 0 },

    // The canvas's edges out from the picture's, or null: the picture's own
    padOf(p) {
        const d = p && p.pad;
        return d && (d.l || d.t || d.r || d.b) ? d : null;
    },

    // The size layers are painted at for a photo W × H
    sizeFor(W, H) {
        const s = Math.min(1, this.MAX_EDGE / Math.max(W, H));
        return { w: Math.max(1, Math.round(W * s)), h: Math.max(1, Math.round(H * s)) };
    },

    newId() {
        return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 16);
    },

    fileName(paint, layer) {
        return `${paint.id}-${layer.id}-${layer.rev}.png`;
    },

    // A layer's mask, as a layer of its own: its alpha is what shows
    // A transformed layer's original (smart layers): a file of its own
    srcOf(layer) {
        return { id: layer.id + 's', rev: layer.src.rev };
    },

    maskOf(layer) {
        return { id: layer.id + 'm', rev: layer.mask };
    },

    // The layer's pixels with its mask on (a new canvas)
    masked(src, mask) {
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const g = c.getContext('2d');
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(mask, 0, 0, c.width, c.height);
        return c;
    },

    // ---- Kept in the project ----

    async dir(create) {
        const app = this.app;
        const root = await FolderCache.root(app, create).catch(() => null);
        if (!root) return null;
        try {
            return await root.getDirectoryHandle(this.DIR, { create });
        } catch (e) {
            return null;
        }
    },

    // A layer's pixels written (a canvas): its new rev
    async writeLayer(paint, layer, canvas) {
        const dir = await this.dir(true);
        if (!dir) throw new Error('this folder can\'t keep painting (open it with Open folder)');
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        if (!blob) throw new Error('the layer couldn\'t be encoded');
        const fh = await dir.getFileHandle(this.fileName(paint, layer), { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        this.remember(paint, layer, await createImageBitmap(blob));
    },

    // A project opened: layer files no edit uses (an older rev, an edit
    // discarded) are deleted. Only then: within a session Ctrl+Z can bring
    // an older rev back. Files written since this started are left.
    async tidy(edits) {
        const started = Date.now();
        const dir = await this.dir(false);
        if (!dir) return 0;
        const used = new Set();
        for (const e of edits) if (this.has(e)) for (const l of e.paint.layers) {
            used.add(this.fileName(e.paint, l));
            if (l.mask) used.add(this.fileName(e.paint, this.maskOf(l)));
            if (l.src) used.add(this.fileName(e.paint, this.srcOf(l)));
        }
        const gone = [];
        for await (const [name, h] of dir.entries()) {
            if (h.kind !== 'file' || used.has(name) || !/\.png$/.test(name)) continue;
            const f = await h.getFile().catch(() => null);
            if (f && f.lastModified < started - 1000) gone.push(name);
        }
        for (const name of gone) await dir.removeEntry(name).catch(() => { });
        return gone.length;
    },

    // Layers' pictures, remembered (the last few)
    remember(paint, layer, bmp) {
        this._bmps = this._bmps || new Map();
        const key = this.fileName(paint, layer);
        const old = this._bmps.get(key);
        if (old && old !== bmp && old.close) old.close();
        this._bmps.delete(key);
        this._bmps.set(key, bmp);
        while (this._bmps.size > 16) {
            const [k, b] = this._bmps.entries().next().value;
            this._bmps.delete(k);
            if (b && b.close) b.close();
        }
    },

    async layerBitmap(paint, layer) {
        const key = this.fileName(paint, layer);
        this._bmps = this._bmps || new Map();
        if (this._bmps.has(key)) {
            const b = this._bmps.get(key);
            this._bmps.delete(key);
            this._bmps.set(key, b);
            return b;
        }
        const dir = await this.dir(false);
        if (!dir) return null;
        try {
            const f = await (await dir.getFileHandle(key)).getFile();
            const bmp = await createImageBitmap(f);
            this.remember(paint, layer, bmp);
            return bmp;
        } catch (e) {
            console.warn('Paint: a layer is missing:', key, e.message);
            return null;
        }
    },

    // The visible layers' pictures, ready to draw: { w, h, ext, pad, fill,
    // layers: [{ src, opacity, blend }] } (src: an ImageBitmap or canvas),
    // or null
    async prepare(e) {
        if (!this.has(e)) return null;
        const p = e.paint;
        const layers = [];
        // A clipped layer shows only where the one it's clipped to (the
        // nearest below not clipped) has paint, and not when it's hidden
        let base = null;
        const hiddenGroups = new Set((p.groups || []).filter(g => g.hidden).map(g => g.id));
        for (const l0 of p.layers) {
            const l = l0.group && hiddenGroups.has(l0.group) ? { ...l0, hidden: true } : l0;
            if (!l.clip) base = l.hidden ? null : { src: null, l };
            if (l.adj) {
                if (l.hidden || !l.opacity) continue;
                const mask = l.mask ? await this.layerBitmap(p, this.maskOf(l)) : null;
                layers.push({ adj: l.adj, src: mask, opacity: l.opacity });
                continue;
            }
            if (l.hidden || !l.opacity || (l.clip && !base)) continue;
            if (l.clip && !base.src) continue;
            let src = await this.layerBitmap(p, l);
            const mask = src && l.mask ? await this.layerBitmap(p, this.maskOf(l)) : null;
            if (mask) src = this.masked(src, mask);
            if (!l.clip && base) base.src = src;
            if (src && l.clip) src = this.masked(src, base.src);
            if (src) layers.push({ src, opacity: l.opacity, blend: l.blend });
        }
        const pad = this.padOf(p);
        return layers.length || pad ? { w: p.w, h: p.h, ext: p.ext || this.ZERO, pad, fill: p.fill || null, layers } : null;
    },

    // ---- Drawn over a photo ----

    // The layers onto `canvas`: the photo as cropped by `ed` (a crop
    // editor on the W × H photo, CropEditor.fromSnapshot), or the whole
    // photo filling the canvas when there's no crop. at: where the picture
    // is on the canvas, and how wide (a padded canvas has it inside)
    composite(canvas, prepared, ed = null, at = null) {
        if (!prepared) return;
        at = at || { x: 0, y: 0, w: canvas.width, h: canvas.height };
        const ctx = canvas.getContext('2d');
        ctx.save();
        for (const l of prepared.layers) {
            if (l.adj) {
                this.adjustCanvas(canvas, l.adj, l.src ? (t) => this.drawThrough(t, ed, l.src, canvas.width, canvas.height, prepared, at) : null, l.opacity, at.w / (ed ? ed.outputRect().w : prepared.w), null, at);
                continue;
            }
            ctx.globalAlpha = l.opacity;
            ctx.globalCompositeOperation = l.blend;
            this.drawThrough(ctx, ed, l.src, canvas.width, canvas.height, prepared, at);
        }
        ctx.restore();
    },

    // A layer's picture drawn as `ed` crops the photo (as
    // CropEditor.drawOutput does), or stretched over w × h without one;
    // p: the layers' w, h and ext (none: the photo's size); at: where the
    // picture is (all of w × h)
    drawThrough(ctx, ed, src, w, h, p = null, at = null) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const e = (p && p.ext) || this.ZERO;
        at = at || { x: 0, y: 0, w, h };
        if (!ed) {
            const pw = p ? p.w : w, ph = p ? p.h : h;
            ctx.setTransform(at.w / pw, 0, 0, at.h / ph, at.x, at.y);
            ctx.drawImage(src, -e.l, -e.t, pw + e.l + e.r, ph + e.t + e.b);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            return;
        }
        const o = ed.outputRect();
        const [a, b, c, d] = ed.mat(); // the turn, and any flip
        // The output canvas may be a different size from ed's (a preview)
        const k = at.w / o.w;
        const sx = p ? ed.W / p.w : 1, sy = p ? ed.H / p.h : 1;
        ctx.setTransform(a * k, b * k, c * k, d * k, -o.x0 * k + at.x, -o.y0 * k + at.y);
        ctx.drawImage(src, -ed.W / 2 - e.l * sx, -ed.H / 2 - e.t * sy, ed.W + (e.l + e.r) * sx, ed.H + (e.t + e.b) * sy);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    },

    // The layers onto a picture, on a canvas padded as the paint says: a
    // new canvas when it's padded (the picture inside it, what's added
    // filled), else the same one. ed as for composite
    padded(canvas, prepared, ed = null) {
        const pad = prepared && prepared.pad;
        if (!pad) { this.composite(canvas, prepared, ed); return canvas; }
        // Canvas px per layer px, as shown
        const k = ed ? canvas.width / ed.outputRect().w * (ed.W / prepared.w) : canvas.width / prepared.w;
        const x = Math.round(pad.l * k), y = Math.round(pad.t * k);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(canvas.width + (pad.l + pad.r) * k));
        out.height = Math.max(1, Math.round(canvas.height + (pad.t + pad.b) * k));
        const g = out.getContext('2d');
        if (prepared.fill) {
            g.fillStyle = prepared.fill;
            g.fillRect(0, 0, out.width, out.height);
        }
        g.drawImage(canvas, x, y);
        this.composite(out, prepared, ed, { x, y, w: canvas.width, h: canvas.height });
        return out;
    },

    // The edit's paint onto a canvas of the photo as shown (see composite):
    // the canvas to use, a bigger (or smaller) one when the paint pads it.
    // Without `ed` it's the photo's own part only (Crop shows the whole
    // photo; the canvas is the crop's)
    async onto(canvas, e, ed = null) {
        if (!this.has(e)) return canvas;
        const prepared = await this.prepare(e);
        if (!ed) { this.composite(canvas, prepared, null); return canvas; }
        return this.padded(canvas, prepared, ed);
    }
};
