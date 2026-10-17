// Develop: Lightroom-style adjustments, non-destructive. An adjustment is
// a small set of settings kept with the photo's edit (edits.js, `adj`),
// never in the photo: it's applied whenever the photo is shown, and Export
// (or Save edits) writes the finished file.
//
// Every adjustment here works on each pixel's colour alone, so the whole
// look is two lookup tables, made in JavaScript from the settings:
//   1. per channel (256 entries each): white balance and exposure (in
//      linear light), then the Light sliders, levels and curves;
//   2. a 3D colour table (33³) for what mixes the channels: the colour
//      mixer (HSL), vibrance and saturation. Skipped when they're all 0.
// The GPU (WebGL2) applies them, so sliders stay live on a big photo;
// without WebGL2 the same tables are applied on the CPU, so there's one
// definition of every slider and the two always agree.
//
// Settings, as kept (anything left out is at its default):
//   exposure (EV, ±5), contrast, highlights, shadows, whites, blacks,
//   temp, tint, vibrance, saturation (±100);
//   levels: { rgb|r|g|b: [in black, gamma, in white, out black, out white] }
//   curve:  { rgb|r|g|b: [[x, y], …] } (0–1, from the left)
//   hsl:    { hue|sat|lum: [8 values, ±100] } (red … magenta, HUES)
//   grade:  { s|m|h: [hue 0–360, saturation 0–100, luminance ±100] }
//           (shadows, midtones, highlights), with gradeBlend, gradeBalance
//   vignette, vigMid, vigFeather, vigRound; grain, grainSize (Effects:
//           they depend on where the pixel is, so they're a GPU stage of
//           their own after the tables, not part of them)
//   look:   a film look (LOOKS), with lookAmount (0–200%): applied over
//           everything else, inside the colour table

const Develop = {
    SLIDERS: {
        exposure: { min: -5, max: 5, step: 0.01 },
        contrast: { min: -100, max: 100, step: 1 },
        highlights: { min: -100, max: 100, step: 1 },
        shadows: { min: -100, max: 100, step: 1 },
        whites: { min: -100, max: 100, step: 1 },
        blacks: { min: -100, max: 100, step: 1 },
        temp: { min: -100, max: 100, step: 1 },
        tint: { min: -100, max: 100, step: 1 },
        vibrance: { min: -100, max: 100, step: 1 },
        saturation: { min: -100, max: 100, step: 1 },
        gradeBlend: { min: 0, max: 100, step: 1, def: 50 },
        gradeBalance: { min: -100, max: 100, step: 1 },
        vignette: { min: -100, max: 100, step: 1 },
        vigMid: { min: 0, max: 100, step: 1, def: 50 },
        vigFeather: { min: 0, max: 100, step: 1, def: 50 },
        vigRound: { min: -100, max: 100, step: 1 },
        grain: { min: 0, max: 100, step: 1 },
        grainSize: { min: 0, max: 100, step: 1, def: 25 },
        lookAmount: { min: 0, max: 200, step: 1, def: 100 }
    },
    ZONES: [['s', 'Shadows'], ['m', 'Midtones'], ['h', 'Highlights']],

    // Film looks: settings of their own, put over a photo's (Amount 100%
    // is the look as made; 0 is none, 200 twice as strong)
    LOOKS: [
        { id: 'portra', name: 'Portrait film', adj: { contrast: -12, vibrance: -8, curve: { rgb: [[0, 0.04], [0.25, 0.25], [0.75, 0.77], [1, 0.97]] }, hsl: { hue: [4, 6, -8, -18, 0, 0, 0, 0], sat: [-4, -6, -14, -24, -12, -10, 0, 0], lum: [0, 6, 4, 0, 0, 0, 0, 0] }, grade: { h: [45, 14, 0], s: [200, 8, 0] }, grain: 12 } },
        { id: 'vivid', name: 'Vivid slide', adj: { contrast: 28, blacks: -10, vibrance: 34, saturation: 8, hsl: { sat: [8, 0, 6, 14, 10, 16, 0, 0], lum: [0, 0, 0, 0, 0, -10, 0, 0] }, curve: { rgb: [[0, 0], [0.25, 0.21], [0.75, 0.8], [1, 1]] } } },
        { id: 'kodachrome', name: 'Kodachrome', adj: { contrast: 22, temp: 8, saturation: 6, hsl: { hue: [-4, -6, -10, 12, 0, -8, 0, 0], sat: [16, 6, 0, -10, 0, 14, 0, 0], lum: [-8, 0, 0, -6, 0, -14, 0, 0] }, grade: { s: [190, 10, -4], h: [40, 10, 0] }, grain: 8 } },
        { id: 'faded', name: 'Faded', adj: { contrast: -18, saturation: -22, curve: { rgb: [[0, 0.12], [0.3, 0.32], [0.75, 0.74], [1, 0.92]] }, grade: { s: [215, 14, 0], h: [50, 8, 0] } } },
        { id: 'teal', name: 'Teal and orange', adj: { contrast: 14, vibrance: 10, grade: { s: [190, 28, 0], m: [30, 6, 0], h: [35, 22, 0] }, hsl: { hue: [0, -4, -10, 30, 6, -8, 0, 0], sat: [0, 8, -10, -30, 0, 10, 0, 0] } } },
        { id: 'cross', name: 'Cross process', adj: { contrast: 16, saturation: 12, curve: { r: [[0, 0], [0.25, 0.2], [0.75, 0.83], [1, 1]], g: [[0, 0.03], [0.5, 0.55], [1, 1]], b: [[0, 0.12], [0.5, 0.45], [1, 0.84]] } } },
        { id: 'instant', name: 'Instant', adj: { contrast: -8, temp: 12, tint: -6, saturation: -10, curve: { rgb: [[0, 0.08], [0.5, 0.52], [1, 0.94]] }, grade: { s: [160, 16, 0], h: [50, 16, 4] }, vignette: -22, vigMid: 40, grain: 10 } },
        { id: 'bw', name: 'Black and white', adj: { saturation: -100, contrast: 24, hsl: { lum: [-6, 4, 10, -8, 0, -18, 0, 0] }, grain: 18, grainSize: 30 } },
        { id: 'sepia', name: 'Sepia', adj: { saturation: -100, contrast: 10, grade: { s: [30, 26, 0], m: [38, 24, 0], h: [45, 14, 0] }, curve: { rgb: [[0, 0.05], [1, 0.96]] }, grain: 10 } }
    ],
    CHANNELS: ['rgb', 'r', 'g', 'b'],
    HUES: [
        { id: 'red', name: 'Red', at: 0, color: '#e5484d' },
        { id: 'orange', name: 'Orange', at: 30, color: '#f76b15' },
        { id: 'yellow', name: 'Yellow', at: 60, color: '#ffc53d' },
        { id: 'green', name: 'Green', at: 120, color: '#46a758' },
        { id: 'aqua', name: 'Aqua', at: 180, color: '#12a594' },
        { id: 'blue', name: 'Blue', at: 225, color: '#0090ff' },
        { id: 'purple', name: 'Purple', at: 270, color: '#8e4ec6' },
        { id: 'magenta', name: 'Magenta', at: 315, color: '#d6409f' }
    ],
    LEVELS: [0, 1, 1, 0, 1],
    LUT_SIZE: 33,

    // ---- Settings ----

    // Every setting, defaults filled in
    full(adj) {
        const a = adj || {};
        const out = {};
        for (const [k, r] of Object.entries(this.SLIDERS)) out[k] = typeof a[k] === 'number' ? a[k] : (r.def || 0);
        out.levels = {};
        out.curve = {};
        for (const c of this.CHANNELS) {
            out.levels[c] = (a.levels && a.levels[c]) ? a.levels[c].slice() : this.LEVELS.slice();
            out.curve[c] = (a.curve && a.curve[c]) ? a.curve[c].map(p => p.slice()) : [[0, 0], [1, 1]];
        }
        out.hsl = {};
        for (const k of ['hue', 'sat', 'lum']) out.hsl[k] = (a.hsl && a.hsl[k]) ? a.hsl[k].slice() : new Array(8).fill(0);
        out.grade = {};
        for (const [z] of this.ZONES) out.grade[z] = (a.grade && a.grade[z]) ? a.grade[z].slice() : [0, 0, 0];
        out.look = this.look(a.look) ? a.look : null;
        return out;
    },

    look(id) {
        return (typeof id === 'string' && this.LOOKS.find(l => l.id === id)) || null;
    },

    // Checked and made compact (only what's changed), or null for none.
    // Anything out of range is brought into it.
    clean(v) {
        if (!v || typeof v !== 'object') return null;
        const num = (x) => typeof x === 'number' && isFinite(x);
        const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
        const out = {};
        for (const [k, r] of Object.entries(this.SLIDERS)) {
            if (num(v[k]) && v[k] !== (r.def || 0)) {
                const x = Math.round(clamp(v[k], r.min, r.max) / r.step) * r.step;
                if (x !== (r.def || 0)) out[k] = +x.toFixed(2);
            }
        }
        for (const c of this.CHANNELS) {
            const l = v.levels && v.levels[c];
            if (Array.isArray(l) && l.length === 5 && l.every(num)) {
                let [i0, g, i1, o0, o1] = l;
                i0 = clamp(i0, 0, 0.99);
                i1 = clamp(i1, i0 + 0.01, 1);
                g = clamp(g, 0.1, 9.99);
                o0 = clamp(o0, 0, 1);
                o1 = clamp(o1, 0, 1);
                const q = [i0, g, i1, o0, o1].map(x => +x.toFixed(4));
                if (q.some((x, i) => Math.abs(x - this.LEVELS[i]) > 1e-4)) (out.levels || (out.levels = {}))[c] = q;
            }
            const p = v.curve && v.curve[c];
            if (Array.isArray(p) && p.length >= 2 && p.length <= 16 && p.every(pt => Array.isArray(pt) && pt.length === 2 && pt.every(num))) {
                const pts = p.map(([x, y]) => [+clamp(x, 0, 1).toFixed(4), +clamp(y, 0, 1).toFixed(4)]).sort((a, b) => a[0] - b[0]);
                const ok = pts.every((pt, i) => !i || pt[0] - pts[i - 1][0] >= 0.01);
                const straight = pts.every(([x, y]) => Math.abs(x - y) < 1e-4);
                if (ok && !straight) (out.curve || (out.curve = {}))[c] = pts;
            }
        }
        for (const k of ['hue', 'sat', 'lum']) {
            const h = v.hsl && v.hsl[k];
            if (Array.isArray(h) && h.length === 8 && h.every(num) && h.some(x => Math.round(x))) {
                (out.hsl || (out.hsl = {}))[k] = h.map(x => Math.round(clamp(x, -100, 100)));
            }
        }
        for (const [z] of this.ZONES) {
            const g = v.grade && v.grade[z];
            if (Array.isArray(g) && g.length === 3 && g.every(num)) {
                const q = [Math.round(((g[0] % 360) + 360) % 360), Math.round(clamp(g[1], 0, 100)), Math.round(clamp(g[2], -100, 100))];
                if (q[1] || q[2]) (out.grade || (out.grade = {}))[z] = q;
            }
        }
        if (this.look(v.look)) out.look = v.look;
        else delete out.lookAmount;
        return Object.keys(out).length ? out : null;
    },

    active(adj) {
        return !!this.clean(adj);
    },

    same(a, b) {
        return JSON.stringify(this.clean(a)) === JSON.stringify(this.clean(b));
    },

    // ---- The maths ----

    toLinear(x) { return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); },
    toGamma(x) { return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; },

    // A smooth curve through the points that never turns back on itself
    // (monotone cubic, Fritsch–Carlson): x → y, flat beyond the ends
    spline(points) {
        const p = points.slice().sort((a, b) => a[0] - b[0]);
        const n = p.length;
        if (n < 2) return () => (n ? p[0][1] : 0);
        const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
        const d = [], m = new Array(n);
        for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
        m[0] = d[0];
        m[n - 1] = d[n - 2];
        for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
        for (let i = 0; i < n - 1; i++) {
            if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
            const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
            if (s > 9) {
                const t = 3 / Math.sqrt(s);
                m[i] = t * a * d[i];
                m[i + 1] = t * b * d[i];
            }
        }
        return (x) => {
            if (x <= xs[0]) return ys[0];
            if (x >= xs[n - 1]) return ys[n - 1];
            let i = 0;
            while (i < n - 2 && x > xs[i + 1]) i++;
            const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
            return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] +
                (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
        };
    },

    // White balance as gains on linear light, a grey kept as bright
    whiteBalance(temp, tint) {
        const t = temp / 100, g = tint / 100;
        const k = [Math.exp(0.35 * t), Math.exp(-0.3 * g), Math.exp(-0.35 * t)];
        const y = 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
        return k.map(x => x / y);
    },

    // The Light sliders as one curve (gamma-encoded values): whites and
    // blacks move the ends, contrast bends it round the middle, highlights
    // and shadows lift or lower the bright and dark quarters
    toneCurve(a) {
        const c = a.contrast / 100, h = a.highlights / 100, s = a.shadows / 100;
        const lo = -0.25 * a.blacks / 100, hi = 1 - 0.25 * a.whites / 100;
        if (!c && !h && !s && !lo && hi === 1) return null;
        const f = this.spline([[0, 0], [0.25, 0.25 - 0.07 * c + 0.13 * s], [0.5, 0.5], [0.75, 0.75 + 0.07 * c + 0.13 * h], [1, 1]]);
        return (x) => f(Math.min(1, Math.max(0, (x - lo) / (hi - lo))));
    },

    levels(l, x) {
        const [i0, g, i1, o0, o1] = l;
        const t = Math.min(1, Math.max(0, (x - i0) / (i1 - i0)));
        return o0 + Math.pow(t, 1 / g) * (o1 - o0);
    },

    // The per-channel part: input value (0–255) → output (0–1) for each
    // channel. upto: 'levels' stops before levels and curves (Auto looks
    // at the photo there)
    channelTables(a, upto = null) {
        const wb = this.whiteBalance(a.temp, a.tint);
        const ex = Math.pow(2, a.exposure);
        const tone = this.toneCurve(a);
        const curveAll = this.spline(a.curve.rgb);
        const out = new Float32Array(256 * 4);
        const lin = new Float32Array(256);
        for (let i = 0; i < 256; i++) lin[i] = this.toLinear(i / 255);
        ['r', 'g', 'b'].forEach((ch, c) => {
            const curve = this.spline(a.curve[ch]);
            for (let i = 0; i < 256; i++) {
                let x = this.toGamma(Math.min(1, lin[i] * wb[c] * ex));
                if (tone) x = tone(x);
                if (upto !== 'levels') {
                    x = this.levels(a.levels.rgb, this.levels(a.levels[ch], x));
                    x = curve(curveAll(x));
                }
                out[i * 4 + c] = Math.min(1, Math.max(0, x));
            }
        });
        for (let i = 0; i < 256; i++) out[i * 4 + 3] = 1;
        return out;
    },

    // The colour mixer, vibrance and saturation, on one colour (0–1)
    colourFn(a) {
        const own = this.ownColourFn(a);
        const look = this.look(a.look);
        if (!look) return own;
        // The look, over the photo's own settings, by its amount
        // (a look's own tables never change: made once)
        this._looks = this._looks || {};
        const made = this._looks[look.id] || (this._looks[look.id] = (() => {
            const la = this.full(look.adj);
            return { lt: this.channelTables(la), lc: this.ownColourFn(la) };
        })());
        const { lt, lc } = made;
        const k = a.lookAmount / 100;
        const at = (c, x) => {
            const f = Math.min(255, Math.max(0, x * 255)), i = Math.min(254, f | 0), t = f - i;
            return lt[i * 4 + c] * (1 - t) + lt[(i + 1) * 4 + c] * t;
        };
        return (r, g, b) => {
            if (own) [r, g, b] = own(r, g, b);
            let l = [at(0, r), at(1, g), at(2, b)];
            if (lc) l = lc(l[0], l[1], l[2]);
            const mix = (x, y) => Math.min(1, Math.max(0, x + (y - x) * k));
            return [mix(r, l[0]), mix(g, l[1]), mix(b, l[2])];
        };
    },

    smooth(e0, e1, x) {
        const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
    },

    // Colour grading: a tint (hue, strength) and a brightness for the
    // shadows, midtones and highlights. Blending widens the zones into each
    // other; Balance moves where they meet. The tint keeps the brightness.
    gradeFn(a) {
        const zones = this.ZONES.map(([z]) => a.grade[z]);
        if (!zones.some(g => g[1] || g[2])) return null;
        const B = a.gradeBlend / 100, c = 0.5 - 0.3 * a.gradeBalance / 100;
        const sEnd = c * (0.6 + 0.8 * B), hStart = 1 - (1 - c) * (0.6 + 0.8 * B);
        const tints = zones.map(([h, s, l]) => {
            const x = h / 60, C = 1, X = 1 - Math.abs((x % 2) - 1);
            const rgb = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]][Math.floor(x) % 6];
            const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
            return { d: rgb.map(v => (v - y) * (s / 100) * 0.3), l: l / 100 * 0.2 };
        });
        return (r, g, b) => {
            const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const ws = 1 - this.smooth(0, sEnd, L), wh = this.smooth(hStart, 1, L), wm = Math.max(0, 1 - ws - wh);
            const w = [ws, wm, wh];
            for (let z = 0; z < 3; z++) {
                const t = tints[z], k = w[z];
                if (!k) continue;
                r += (t.d[0] + t.l) * k; g += (t.d[1] + t.l) * k; b += (t.d[2] + t.l) * k;
            }
            return [r, g, b];
        };
    },

    // The colour mixer, vibrance, saturation and grading of these settings
    ownColourFn(a) {
        const hsl = a.hsl;
        const anyHsl = ['hue', 'sat', 'lum'].some(k => hsl[k].some(x => x));
        const sat = 1 + a.saturation / 100, vib = a.vibrance / 100;
        const grade = this.gradeFn(a);
        if (!anyHsl && !a.saturation && !vib && !grade) return null;
        const at = this.HUES.map(h => h.at);
        const band = (h, list) => {
            // Between the two nearest colours, eased
            let i = at.length - 1;
            for (let k = 0; k < at.length; k++) if (h >= at[k]) i = k;
            const j = (i + 1) % at.length;
            const span = ((at[j] - at[i]) + 360) % 360 || 360;
            let t = (((h - at[i]) + 360) % 360) / span;
            t = t * t * (3 - 2 * t);
            return list[i] * (1 - t) + list[j] * t;
        };
        return (r, g, b) => {
            if (anyHsl) {
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                const l = (max + min) / 2, d = max - min;
                if (d > 1e-6) {
                    let s = d / (1 - Math.abs(2 * l - 1) || 1);
                    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
                    h = (h * 60 + 360) % 360;
                    const dh = band(h, hsl.hue) * 0.3, ds = band(h, hsl.sat) / 100, dl = band(h, hsl.lum) / 100;
                    const h2 = (h + dh + 360) % 360;
                    const s2 = Math.min(1, Math.max(0, s * (1 + ds)));
                    const k = 0.6 * Math.min(1, s);
                    const l2 = dl > 0 ? l + dl * k * (1 - l) : l + dl * k * l;
                    // Back to RGB
                    const C = (1 - Math.abs(2 * l2 - 1)) * s2, X = C * (1 - Math.abs((h2 / 60) % 2 - 1)), m = l2 - C / 2;
                    const seg = Math.floor(h2 / 60) % 6;
                    const rgb = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]][seg];
                    r = rgb[0] + m; g = rgb[1] + m; b = rgb[2] + m;
                }
            }
            if (sat !== 1 || vib) {
                const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                const s = Math.max(r, g, b) - Math.min(r, g, b);
                const f = Math.max(0, sat * (1 + vib * (vib > 0 ? (1 - s) * (1 - s) : 1)));
                r = y + (r - y) * f; g = y + (g - y) * f; b = y + (b - y) * f;
            }
            if (grade) [r, g, b] = grade(r, g, b);
            return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
        };
    },

    colourLut(a, N = this.LUT_SIZE) {
        const f = this.colourFn(a);
        if (!f) return null;
        const out = new Float32Array(N * N * N * 4);
        let o = 0;
        for (let b = 0; b < N; b++) {
            for (let g = 0; g < N; g++) {
                for (let r = 0; r < N; r++) {
                    const c = f(r / (N - 1), g / (N - 1), b / (N - 1));
                    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 1;
                    o += 4;
                }
            }
        }
        return out;
    },

    // Both tables for a set of settings (remembered for the last few)
    tables(adj) {
        const key = JSON.stringify(this.clean(adj));
        this._tables = this._tables || new Map();
        let t = this._tables.get(key);
        if (!t) {
            const a = this.full(adj);
            t = { key, channels: this.channelTables(a), lut: this.colourLut(a), N: this.LUT_SIZE, fx: this.effects(a) };
            this._tables.set(key, t);
            if (this._tables.size > 8) this._tables.delete(this._tables.keys().next().value);
        }
        return t;
    },

    // ---- Effects: vignette and grain ----

    // The vignette and grain to apply (a look's added, by its amount), or
    // null for none: { vig: [amount, middle, width, roundness], grain:
    // [amount, cells across the long side] }
    effects(a) {
        const look = this.look(a.look);
        const la = look ? this.full(look.adj) : null, k = look ? a.lookAmount / 100 : 0;
        const vig = Math.max(-100, Math.min(100, a.vignette + (la ? la.vignette * k : 0)));
        const grain = Math.min(100, a.grain + (la ? la.grain * k : 0));
        if (!vig && !grain) return null;
        const useOwnVig = a.vignette || !la, useOwnGrain = a.grain || !la;
        const mid = useOwnVig ? a.vigMid : la.vigMid, feather = useOwnVig ? a.vigFeather : la.vigFeather;
        const round = useOwnVig ? a.vigRound : la.vigRound, size = useOwnGrain ? a.grainSize : la.grainSize;
        return {
            vig: [vig / 100, 0.15 + 0.7 * mid / 100, 0.05 + 0.9 * feather / 100, round / 100],
            grain: [grain / 100 * 0.16, 300 + 1700 * (1 - size / 100)]
        };
    },

    // The same 32-bit hash as the shader's
    hash(x, y) {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
        x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
        x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
        x = (x + Math.imul(y, 1664525)) >>> 0;
        return (x ^ (x >>> 16)) >>> 0;
    },

    // One pixel's effects: (px, py) its middle, in a W × H frame
    effect(fx, rgb, px, py, W, H) {
        let [r, g, b] = rgb;
        const v = fx.vig;
        if (v[0]) {
            const ex = (px / W - 0.5) * 2, ey = (py / H - 0.5) * 2;
            let t;
            if (v[3] >= 0) {
                const m = Math.min(W, H) / 2, cx = (px - W / 2) / m, cy = (py - H / 2) / m;
                const te = Math.hypot(ex, ey) / Math.SQRT2, tc = Math.hypot(cx, cy) / Math.hypot(W / 2 / m, H / 2 / m);
                t = te + (tc - te) * v[3];
            } else {
                const q = 2 - v[3] * 6;
                t = Math.pow(Math.pow(Math.abs(ex), q) + Math.pow(Math.abs(ey), q), 1 / q) / Math.pow(2, 1 / q);
            }
            const f = this.smooth(v[1] - v[2] / 2, v[1] + v[2] / 2, t);
            if (v[0] < 0) { const k = 1 + v[0] * f; r *= k; g *= k; b *= k; }
            else { const k = v[0] * f; r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k; }
        }
        const gr = fx.grain;
        if (gr[0]) {
            const cell = Math.max(W, H) / gr[1];
            const gx = px / cell, gy = py / cell;
            const ix = Math.floor(gx), iy = Math.floor(gy);
            let sx = gx - ix, sy = gy - iy;
            sx = sx * sx * (3 - 2 * sx); sy = sy * sy * (3 - 2 * sy);
            const h = (x, y) => this.hash(x, y) / 4294967295;
            const top = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * sx;
            const bot = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * sx;
            const n = top + (bot - top) * sy - 0.5;
            const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const d = n * gr[0] * (0.4 + 2.4 * L * (1 - L));
            r += d; g += d; b += d;
        }
        return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
    },

    // ---- On the CPU (no WebGL2, histograms, Auto) ----

    // RGBA bytes (in place, or into `out`). frame: where these pixels are
    // in the whole picture { x, y, w, W, H } (the effects need it; w is
    // this block's width), the block itself when left out
    applyCPU(px, T, out = px, frame = null) {
        const fx = T.fx;
        const fw = frame ? frame.w : 0;
        const ch = T.channels, lut = T.lut, N = T.N, M = N - 1;
        for (let i = 0; i < px.length; i += 4) {
            let r = ch[px[i] * 4], g = ch[px[i + 1] * 4 + 1], b = ch[px[i + 2] * 4 + 2];
            if (lut) {
                const fr = r * M, fg = g * M, fb = b * M;
                const r0 = Math.min(M - 1, fr | 0), g0 = Math.min(M - 1, fg | 0), b0 = Math.min(M - 1, fb | 0);
                const tr = fr - r0, tg = fg - g0, tb = fb - b0;
                const at = (x, y, z, k) => lut[((z * N + y) * N + x) * 4 + k];
                const c = [0, 0, 0];
                for (let k = 0; k < 3; k++) {
                    const c00 = at(r0, g0, b0, k) * (1 - tr) + at(r0 + 1, g0, b0, k) * tr;
                    const c10 = at(r0, g0 + 1, b0, k) * (1 - tr) + at(r0 + 1, g0 + 1, b0, k) * tr;
                    const c01 = at(r0, g0, b0 + 1, k) * (1 - tr) + at(r0 + 1, g0, b0 + 1, k) * tr;
                    const c11 = at(r0, g0 + 1, b0 + 1, k) * (1 - tr) + at(r0 + 1, g0 + 1, b0 + 1, k) * tr;
                    c[k] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
                }
                r = c[0]; g = c[1]; b = c[2];
            }
            if (fx && frame) {
                const k = i / 4, x = k % fw, y = (k - x) / fw;
                [r, g, b] = this.effect(fx, [r, g, b], frame.x + x + 0.5, frame.y + y + 0.5, frame.W, frame.H);
            }
            out[i] = Math.round(r * 255);
            out[i + 1] = Math.round(g * 255);
            out[i + 2] = Math.round(b * 255);
            out[i + 3] = px[i + 3];
        }
        return out;
    },

    // 256 bins each of red, green, blue and brightness
    histogram(px) {
        const h = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256), n: 0 };
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 8) continue;
            const r = px[i], g = px[i + 1], b = px[i + 2];
            h.r[r]++; h.g[g]++; h.b[b]++;
            h.l[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
            h.n++;
        }
        return h;
    },

    // The value below which `p` of the pixels are
    percentile(bins, n, p) {
        const want = n * p;
        let sum = 0;
        for (let i = 0; i < 256; i++) {
            sum += bins[i];
            if (sum > want) return i / 255;
        }
        return 1;
    },

    // Auto: levels from the photo as the other settings leave it. colour:
    // each channel on its own too (a faded print's cast goes)
    auto(px, adj, { colour = false } = {}) {
        const a = this.full(adj);
        const T = { channels: this.channelTables(a, 'levels'), lut: null, N: this.LUT_SIZE };
        const h = this.histogram(this.applyCPU(px, T, new Uint8ClampedArray(px.length)));
        if (!h.n) return adj;
        const levels = {};
        let lum = h.l;
        if (colour) {
            const lo = [], hi = [];
            for (const c of ['r', 'g', 'b']) {
                const i0 = this.percentile(h[c], h.n, 0.005), i1 = Math.max(i0 + 0.05, this.percentile(h[c], h.n, 0.995));
                levels[c] = [i0, 1, Math.min(1, i1), 0, 1];
                lo.push(i0); hi.push(i1);
            }
            // The brightness after those, for the midtones
            const per = { ...a, levels: { ...a.levels, ...levels, rgb: this.LEVELS.slice() } };
            const T2 = { channels: this.channelTables(per), lut: null, N: this.LUT_SIZE };
            lum = this.histogram(this.applyCPU(px, T2, new Uint8ClampedArray(px.length))).l;
        }
        const i0 = colour ? 0 : this.percentile(lum, h.n, 0.001);
        const i1 = colour ? 1 : Math.max(i0 + 0.05, this.percentile(lum, h.n, 0.999));
        const mid = this.percentile(lum, h.n, 0.5);
        const t = Math.min(0.95, Math.max(0.05, (mid - i0) / (i1 - i0)));
        const gamma = Math.min(2, Math.max(0.5, Math.log(t) / Math.log(0.46)));
        levels.rgb = [i0, gamma, Math.min(1, i1), 0, 1];
        if (!colour) for (const c of ['r', 'g', 'b']) levels[c] = this.LEVELS.slice();
        const base = this.clean(adj) || {};
        return this.clean({ ...base, levels: { ...(base.levels || {}), ...levels } });
    },

    // ---- On the GPU ----

    VERT: `#version 300 es
in vec2 pos;
out vec2 uv;
uniform bool flip;
void main() {
    uv = vec2(pos.x * 0.5 + 0.5, (flip ? -pos.y : pos.y) * -0.5 + 0.5);
    gl_Position = vec4(pos, 0.0, 1.0);
}`,
    FRAG: `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 o;
uniform sampler2D img;
uniform sampler2D tone;
uniform sampler3D lut;
uniform bool useLut;
uniform bool before;
uniform bool flip;
uniform float lutN;
uniform vec4 vig;    // amount, middle, width, roundness
uniform vec2 grain;  // amount, cells across the long side
uniform vec4 frame;  // this block's place in the picture (x, y), and the picture's size
uniform float tileH;
float at(float x) { return x * (255.0 / 256.0) + 0.5 / 256.0; }
float ss(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
uint hash(uvec2 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v ^= v >> 16u;
    v.x += v.y * 1664525u;
    v ^= v >> 16u;
    return v.x;
}
float h01(float x, float y) { return float(hash(uvec2(uint(x), uint(y)))) / 4294967295.0; }
void main() {
    vec4 c = texture(img, uv);
    if (before) { o = c; return; }
    vec3 t = vec3(texture(tone, vec2(at(c.r), 0.5)).r, texture(tone, vec2(at(c.g), 0.5)).g, texture(tone, vec2(at(c.b), 0.5)).b);
    if (useLut) t = texture(lut, t * ((lutN - 1.0) / lutN) + 0.5 / lutN).rgb;
    // Where this pixel is in the whole picture (its middle)
    vec2 p = frame.xy + vec2(gl_FragCoord.x, flip ? gl_FragCoord.y : tileH - gl_FragCoord.y);
    float W = frame.z, H = frame.w;
    if (vig.x != 0.0) {
        vec2 e = (p / vec2(W, H) - 0.5) * 2.0;
        float d;
        if (vig.w >= 0.0) {
            float m = min(W, H) / 2.0;
            vec2 q = (p - vec2(W, H) / 2.0) / m;
            float te = length(e) / sqrt(2.0), tc = length(q) / length(vec2(W, H) / 2.0 / m);
            d = te + (tc - te) * vig.w;
        } else {
            float k = 2.0 - vig.w * 6.0;
            d = pow(pow(abs(e.x), k) + pow(abs(e.y), k), 1.0 / k) / pow(2.0, 1.0 / k);
        }
        float f = ss(vig.y - vig.z / 2.0, vig.y + vig.z / 2.0, d);
        if (vig.x < 0.0) t *= 1.0 + vig.x * f;
        else t += (1.0 - t) * vig.x * f;
    }
    if (grain.x != 0.0) {
        float cell = max(W, H) / grain.y;
        vec2 g = p / cell, i = floor(g), s = g - i;
        s = s * s * (3.0 - 2.0 * s);
        float top = mix(h01(i.x, i.y), h01(i.x + 1.0, i.y), s.x);
        float bot = mix(h01(i.x, i.y + 1.0), h01(i.x + 1.0, i.y + 1.0), s.x);
        float n = mix(top, bot, s.y) - 0.5;
        float L = dot(t, vec3(0.2126, 0.7152, 0.0722));
        t += n * grain.x * (0.4 + 2.4 * L * (1.0 - L));
    }
    o = vec4(clamp(t, 0.0, 1.0), c.a);
}`,

    // A WebGL2 renderer on `canvas`, or null where there's none
    renderer(canvas) {
        let gl = null;
        try {
            gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
        } catch (e) { /* none */ }
        if (!gl) return null;
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        let prog;
        try {
            prog = gl.createProgram();
            gl.attachShader(prog, sh(gl.VERTEX_SHADER, this.VERT));
            gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, this.FRAG));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        } catch (e) {
            console.warn('Develop: no WebGL2 shader:', e.message);
            return null;
        }
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'pos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const u = (n) => gl.getUniformLocation(prog, n);
        const tex = (unit, target) => {
            const t = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(target, t);
            gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
            return t;
        };
        const imgTex = tex(0, gl.TEXTURE_2D), toneTex = tex(1, gl.TEXTURE_2D), lutTex = tex(2, gl.TEXTURE_3D);
        gl.uniform1i(u('img'), 0);
        gl.uniform1i(u('tone'), 1);
        gl.uniform1i(u('lut'), 2);
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        let tablesKey = null, lost = false;
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
        const R = {
            gl, canvas, max,
            w: 0, h: 0,
            get lost() { return lost || gl.isContextLost(); },
            // An ImageBitmap, canvas or ImageData
            setImage(src) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, imgTex);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
                R.w = src.width;
                R.h = src.height;
            },
            setTables(T) {
                if (T.key === tablesKey) return;
                tablesKey = T.key;
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, toneTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, T.channels);
                if (T.lut) {
                    gl.activeTexture(gl.TEXTURE2);
                    gl.bindTexture(gl.TEXTURE_3D, lutTex);
                    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, T.N, T.N, T.N, 0, gl.RGBA, gl.FLOAT, T.lut);
                }
                gl.uniform1i(u('useLut'), T.lut ? 1 : 0);
                gl.uniform1f(u('lutN'), T.N);
                const fx = T.fx || { vig: [0, 0, 1, 0], grain: [0, 1] };
                gl.uniform4f(u('vig'), ...fx.vig);
                gl.uniform2f(u('grain'), ...fx.grain);
            },
            // The image, at w × h on the canvas. flip: rows top first, as
            // readPixels gives them back
            // frame: where it is in the whole picture (the effects need it)
            draw(w, h, { before = false, flip = false, frame = null } = {}) {
                if (canvas.width !== w) canvas.width = w;
                if (canvas.height !== h) canvas.height = h;
                gl.viewport(0, 0, w, h);
                gl.uniform1i(u('before'), before ? 1 : 0);
                gl.uniform1i(u('flip'), flip ? 1 : 0);
                const f = frame || { x: 0, y: 0, W: w, H: h };
                gl.uniform4f(u('frame'), f.x, f.y, f.W, f.H);
                gl.uniform1f(u('tileH'), h);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            },
            read(w, h) {
                const px = new Uint8ClampedArray(w * h * 4);
                gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
                return px;
            }
        };
        return R;
    },

    // The shared off-screen renderer (thumbnails, previews, saving)
    gpu() {
        if (this._gpu === undefined || (this._gpu && this._gpu.lost)) {
            this._gpu = (typeof document !== 'undefined' && !this.noGpu) ? this.renderer(document.createElement('canvas')) : null;
        }
        return this._gpu;
    },

    TILE: 2048,

    // The adjustments drawn onto a 2D canvas, in place (in tiles, so any
    // size works). True when something changed.
    applyCanvas(canvas, adj) {
        if (!this.active(adj)) return false;
        const T = this.tables(adj);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const R = this.gpu();
        const tile = R ? Math.min(this.TILE, R.max) : this.TILE;
        for (let y = 0; y < canvas.height; y += tile) {
            for (let x = 0; x < canvas.width; x += tile) {
                const w = Math.min(tile, canvas.width - x), h = Math.min(tile, canvas.height - y);
                const img = ctx.getImageData(x, y, w, h);
                const frame = { x, y, w, W: canvas.width, H: canvas.height };
                let done = false;
                if (R && !R.lost) {
                    try {
                        R.setImage(img);
                        R.setTables(T);
                        R.draw(w, h, { flip: true, frame });
                        img.data.set(R.read(w, h));
                        done = !R.lost;
                    } catch (e) {
                        console.warn('Develop: GPU failed, using the CPU:', e);
                    }
                }
                if (!done) this.applyCPU(img.data, T, img.data, frame);
                ctx.putImageData(img, x, y);
            }
        }
        return true;
    },

    // An ImageBitmap with the adjustments (the crop editor's picture)
    async applyBitmap(bmp, adj) {
        if (!this.active(adj)) return bmp;
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        this.applyCanvas(c, adj);
        const out = await createImageBitmap(c);
        c.width = c.height = 0;
        return out;
    }
};
