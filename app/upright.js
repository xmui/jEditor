// Turn upright: which way up a photo goes. jEditor's own small network
// (tools/upright: trained from scratch on Open Images photos, CC BY 2.0,
// shown turned all four ways and aged like scanned prints), its numbers in
// upright-model.js. It looks at the photo squeezed to 96 × 96 in each of
// the four turns and puts what it sees together; a photo is only turned
// when it's sure.
const Upright = {
    // How sure it must be to turn a photo (tools/upright/README.md: chosen
    // on photos it never saw, so that almost every turn it makes is right)
    SURE: 0.8,
    net: null,

    // The network, from upright-model.js: layers of half floats
    load() {
        if (this.net) return this.net;
        const m = typeof UPRIGHT_MODEL !== 'undefined' ? UPRIGHT_MODEL : null;
        if (!m) return null;
        const bytes = Uint8Array.from(atob(m.data), c => c.charCodeAt(0));
        const half = new Uint16Array(bytes.buffer);
        const all = new Float32Array(half.length);
        for (let i = 0; i < half.length; i++) all[i] = this.fromHalf(half[i]);
        const take = ([at, n]) => all.subarray(at, at + n);
        this.net = {
            size: m.size, mean: m.mean, std: m.std,
            layers: m.layers.map(l => ({ ...l, w: take(l.w), b: take(l.b) }))
        };
        return this.net;
    },

    fromHalf(h) {
        const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
        if (e === 0) return s * f * 2 ** -24;
        if (e === 31) return f ? NaN : s * Infinity;
        return s * (1 + f / 1024) * 2 ** (e - 15);
    },

    // How many quarter turns clockwise put the photo upright (0 to 3), and
    // how sure that is (0 to 1). `source`: an image, bitmap or blob, as shown.
    async guess(source) {
        const net = this.load();
        if (!net) return null;
        const n = net.size;
        const bmp = source instanceof Blob
            ? await createImageBitmap(source, { resizeWidth: n, resizeHeight: n, resizeQuality: 'high' })
            : source;
        const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0, n, n);
        if (source instanceof Blob && bmp.close) bmp.close();
        const px = g.getImageData(0, 0, n, n).data;
        const x = new Float32Array(3 * n * n);
        for (let i = 0; i < n * n; i++) {
            for (let ch = 0; ch < 3; ch++) x[ch * n * n + i] = (px[i * 4 + ch] / 255 - net.mean[ch]) / net.std[ch];
        }
        // Each turn of it, each answer brought back to the photo as it is
        const p = [0, 0, 0, 0];
        let img = x;
        for (let r = 0; r < 4; r++) {
            const q = this.softmax(this.forward(img));
            for (let k = 0; k < 4; k++) p[k] += q[(k + r) % 4] / 4;
            img = this.turnLeft(img, n);
            // A tenth of a second each: the window keeps up in between
            await new Promise(res => setTimeout(res, 0));
        }
        let k = 0;
        for (let j = 1; j < 4; j++) if (p[j] > p[k]) k = j;
        return { turns: k, sure: p[k] };
    },

    // A quarter turn counter-clockwise, as the network was taught them
    turnLeft(x, n) {
        const out = new Float32Array(x.length);
        for (let ch = 0; ch < 3; ch++) {
            const o = ch * n * n;
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) out[o + i * n + j] = x[o + j * n + (n - 1 - i)];
            }
        }
        return out;
    },

    forward(x) {
        let n = this.net.size, a = x;
        for (const l of this.net.layers) {
            if (l.kind === 'conv') {
                const m = l.stride === 2 ? n / 2 : n;
                a = this.conv(a, n, m, l);
                n = m;
            } else {
                a = this.dense(a, l);
            }
        }
        return a;
    },

    // 3 × 3 (padded, stride 1 or 2) or 1 × 1, with ReLU. The input is
    // copied once with its padding, so the inner loop has no edge checks.
    conv(x, n, m, l) {
        const { cin, cout, k, stride, w, b } = l;
        const pad = k === 3 ? 1 : 0, np = n + 2 * pad;
        let xp = x;
        if (pad) {
            xp = new Float32Array(cin * np * np);
            for (let c = 0; c < cin; c++) {
                for (let y = 0; y < n; y++) xp.set(x.subarray((c * n + y) * n, (c * n + y + 1) * n), (c * np + y + 1) * np + 1);
            }
        }
        const out = new Float32Array(cout * m * m);
        for (let o = 0; o < cout; o++) {
            const oo = o * m * m;
            out.fill(b[o], oo, oo + m * m);
            for (let c = 0; c < cin; c++) {
                const xc = c * np * np;
                for (let ky = 0; ky < k; ky++) {
                    for (let kx = 0; kx < k; kx++) {
                        const wv = w[((o * cin + c) * k + ky) * k + kx];
                        for (let y = 0; y < m; y++) {
                            const row = xc + (y * stride + ky) * np + kx, orow = oo + y * m;
                            if (stride === 1) {
                                for (let xx = 0; xx < m; xx++) out[orow + xx] += wv * xp[row + xx];
                            } else {
                                for (let xx = 0; xx < m; xx++) out[orow + xx] += wv * xp[row + 2 * xx];
                            }
                        }
                    }
                }
            }
        }
        for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;
        return out;
    },

    dense(x, l) {
        const { cin, cout, w, b, relu } = l;
        const out = new Float32Array(cout);
        for (let o = 0; o < cout; o++) {
            let s = b[o];
            const row = o * cin;
            for (let i = 0; i < cin; i++) s += w[row + i] * x[i];
            out[o] = relu && s < 0 ? 0 : s;
        }
        return out;
    },

    softmax(z) {
        const m = Math.max(...z);
        const e = Array.from(z, v => Math.exp(v - m));
        const s = e.reduce((a, b) => a + b, 0);
        return e.map(v => v / s);
    }
};
