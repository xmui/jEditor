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
        saturation: { min: -100, max: 100, step: 1 }
    },
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
        for (const k of Object.keys(this.SLIDERS)) out[k] = typeof a[k] === 'number' ? a[k] : 0;
        out.levels = {};
        out.curve = {};
        for (const c of this.CHANNELS) {
            out.levels[c] = (a.levels && a.levels[c]) ? a.levels[c].slice() : this.LEVELS.slice();
            out.curve[c] = (a.curve && a.curve[c]) ? a.curve[c].map(p => p.slice()) : [[0, 0], [1, 1]];
        }
        out.hsl = {};
        for (const k of ['hue', 'sat', 'lum']) out.hsl[k] = (a.hsl && a.hsl[k]) ? a.hsl[k].slice() : new Array(8).fill(0);
        return out;
    },

    // Checked and made compact (only what's changed), or null for none.
    // Anything out of range is brought into it.
    clean(v) {
        if (!v || typeof v !== 'object') return null;
        const num = (x) => typeof x === 'number' && isFinite(x);
        const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
        const out = {};
        for (const [k, r] of Object.entries(this.SLIDERS)) {
            if (num(v[k]) && v[k] !== 0) {
                const x = Math.round(clamp(v[k], r.min, r.max) / r.step) * r.step;
                if (x) out[k] = +x.toFixed(2);
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
        const hsl = a.hsl;
        const anyHsl = ['hue', 'sat', 'lum'].some(k => hsl[k].some(x => x));
        const sat = 1 + a.saturation / 100, vib = a.vibrance / 100;
        if (!anyHsl && !a.saturation && !vib) return null;
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
            t = { key, channels: this.channelTables(a), lut: this.colourLut(a), N: this.LUT_SIZE };
            this._tables.set(key, t);
            if (this._tables.size > 8) this._tables.delete(this._tables.keys().next().value);
        }
        return t;
    },

    // ---- On the CPU (no WebGL2, histograms, Auto) ----

    // RGBA bytes (in place, or into `out`)
    applyCPU(px, T, out = px) {
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
uniform float lutN;
float at(float x) { return x * (255.0 / 256.0) + 0.5 / 256.0; }
void main() {
    vec4 c = texture(img, uv);
    if (before) { o = c; return; }
    vec3 t = vec3(texture(tone, vec2(at(c.r), 0.5)).r, texture(tone, vec2(at(c.g), 0.5)).g, texture(tone, vec2(at(c.b), 0.5)).b);
    if (useLut) t = texture(lut, t * ((lutN - 1.0) / lutN) + 0.5 / lutN).rgb;
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
            },
            // The image, at w × h on the canvas. flip: rows top first, as
            // readPixels gives them back
            draw(w, h, { before = false, flip = false } = {}) {
                if (canvas.width !== w) canvas.width = w;
                if (canvas.height !== h) canvas.height = h;
                gl.viewport(0, 0, w, h);
                gl.uniform1i(u('before'), before ? 1 : 0);
                gl.uniform1i(u('flip'), flip ? 1 : 0);
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
                let done = false;
                if (R && !R.lost) {
                    try {
                        R.setImage(img);
                        R.setTables(T);
                        R.draw(w, h, { flip: true });
                        img.data.set(R.read(w, h));
                        done = !R.lost;
                    } catch (e) {
                        console.warn('Develop: GPU failed, using the CPU:', e);
                    }
                }
                if (!done) this.applyCPU(img.data, T);
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
