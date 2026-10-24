// TIFF, which the browser engine neither reads nor writes: a module the
// codec worker loads (codec-worker.js).
//
//   writeTiff(img, meta)   ImageData → a TIFF: RGB (RGBA when anything's see-
//                          through), 8 bits, Deflate with the horizontal
//                          predictor (lossless, about a PNG's size), in
//                          strips, 300 dpi; meta { make, model, date } (EXIF
//                          strings) go in as tags, the date taken in an
//                          EXIF folder. Its tags come after the pixels
//   readTiff(bytes)        the first picture in a TIFF → ImageData, upright
//                          (its Orientation applied). Uncompressed, LZW,
//                          Deflate or PackBits; 1, 8 or 16 bits; RGB(A),
//                          grey or a palette; strips or tiles. Not JPEG-
//                          compressed, planar or floating-point ones (said so)

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

async function inflate(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
}

async function deflate(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
}

// ---- Writing ----

export async function writeTiff(img, meta = {}) {
    const w = img.width, h = img.height, d = img.data;
    let alpha = false;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) { alpha = true; break; }
    const spp = alpha ? 4 : 3, rowBytes = w * spp;
    const rowsPerStrip = Math.max(1, Math.min(h, Math.floor(256 * 1024 / rowBytes)));
    const strips = [];
    for (let y0 = 0; y0 < h; y0 += rowsPerStrip) {
        const rows = Math.min(rowsPerStrip, h - y0);
        const raw = new Uint8Array(rows * rowBytes);
        for (let r = 0; r < rows; r++) {
            const src = (y0 + r) * w * 4, dst = r * rowBytes;
            for (let x = 0; x < w; x++) {
                for (let c = 0; c < spp; c++) raw[dst + x * spp + c] = d[src + x * 4 + c];
            }
            // The horizontal predictor: each sample less the one before it
            for (let i = rowBytes - 1; i >= spp; i--) raw[dst + i] = (raw[dst + i] - raw[dst + i - spp]) & 255;
        }
        strips.push(await deflate(raw));
    }
    const enc = new TextEncoder();
    const ascii = (s) => { const b = enc.encode(String(s)); const o = new Uint8Array(b.length + 1); o.set(b); return o; };
    // Tags: [tag, type, count, value (number, array or bytes)]
    const tags = [
        [256, 4, 1, w], [257, 4, 1, h],
        [258, 3, spp, new Array(spp).fill(8)],
        [259, 3, 1, 8], [262, 3, 1, 2],
        [273, 4, strips.length, null], // strip offsets, filled in below
        [274, 3, 1, 1], [277, 3, 1, spp], [278, 4, 1, rowsPerStrip],
        [279, 4, strips.length, strips.map(s => s.length)],
        [282, 5, 1, [300, 1]], [283, 5, 1, [300, 1]], [284, 3, 1, 1], [296, 3, 1, 2],
        [305, 2, 0, ascii('jEditor')], [317, 3, 1, 2]
    ];
    if (meta.make) tags.push([271, 2, 0, ascii(meta.make)]);
    if (meta.model) tags.push([272, 2, 0, ascii(meta.model)]);
    if (meta.date) tags.push([306, 2, 0, ascii(meta.date)]);
    if (alpha) tags.push([338, 3, 1, 2]); // unassociated alpha
    const exifIfd = meta.date ? [[36867, 2, 0, ascii(meta.date)], [36868, 2, 0, ascii(meta.date)]] : null;
    if (exifIfd) tags.push([34665, 4, 1, 0]); // the EXIF folder's place, filled in below
    tags.sort((a, b) => a[0] - b[0]);
    for (const t of [...tags, ...(exifIfd || [])]) if (t[1] === 2) t[2] = t[3].length;

    // Header, the strips, then each folder of tags (IFD) with its values after it
    const dataLen = strips.reduce((n, s) => n + s.length, 0);
    const ifdSize = (list) => 2 + list.length * 12 + 4;
    const extra = (list) => list.reduce((n, t) => { const len = TYPE_SIZE[t[1]] * t[2]; return n + (len > 4 ? len + (len & 1) : 0); }, 0);
    let at = 8 + dataLen;
    at += at & 1;
    const ifd0At = at, ifd0End = ifd0At + ifdSize(tags) + extra(tags);
    const exifAt = ifd0End + (ifd0End & 1);
    const total = exifIfd ? exifAt + ifdSize(exifIfd) + extra(exifIfd) : ifd0End;
    const out = new Uint8Array(total);
    const v = new DataView(out.buffer);
    out.set([0x49, 0x49, 42, 0]);
    v.setUint32(4, ifd0At, true);
    let p = 8;
    const offsets = [];
    for (const s of strips) { offsets.push(p); out.set(s, p); p += s.length; }
    tags.find(t => t[0] === 273)[3] = offsets;
    if (exifIfd) tags.find(t => t[0] === 34665)[3] = exifAt;
    const writeIfd = (list, start) => {
        v.setUint16(start, list.length, true);
        let vals = start + ifdSize(list);
        list.forEach((t, i) => {
            const [tag, type, count, value] = t, e = start + 2 + i * 12, len = TYPE_SIZE[type] * count;
            v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, count, true);
            const where = len > 4 ? vals : e + 8;
            if (len > 4) { v.setUint32(e + 8, vals, true); vals += len + (len & 1); }
            if (value instanceof Uint8Array) out.set(value, where);
            else if (type === 5) {
                const r = Array.isArray(value[0]) ? value : [value];
                r.forEach((q, k) => { v.setUint32(where + k * 8, q[0], true); v.setUint32(where + k * 8 + 4, q[1], true); });
            } else {
                const a = Array.isArray(value) ? value : [value];
                a.forEach((n, k) => type === 3 ? v.setUint16(where + k * 2, n, true) : v.setUint32(where + k * 4, n, true));
            }
        });
        v.setUint32(start + 2 + list.length * 12, 0, true);
    };
    writeIfd(tags, ifd0At);
    if (exifIfd) writeIfd(exifIfd, exifAt);
    return out;
}

// ---- Reading ----

function lzw(src, expected) {
    const out = new Uint8Array(expected);
    let o = 0, bit = 0, width = 9, prev = null;
    const dict = [];
    const reset = () => { dict.length = 258; width = 9; prev = null; };
    for (let i = 0; i < 256; i++) dict[i] = [i];
    reset();
    const read = () => {
        let code = 0;
        for (let k = 0; k < width; k++) {
            const byte = src[bit >> 3];
            if (byte === undefined) return 257;
            code = (code << 1) | ((byte >> (7 - (bit & 7))) & 1);
            bit++;
        }
        return code;
    };
    const put = (seq) => { for (let k = 0; k < seq.length && o < expected; k++) out[o++] = seq[k]; };
    for (;;) {
        const code = read();
        if (code === 257) break;
        if (code === 256) { reset(); continue; }
        let seq;
        if (code < dict.length) {
            seq = dict[code];
            if (prev) dict.push(prev.concat(seq[0]));
        } else if (prev) {
            seq = prev.concat(prev[0]);
            dict.push(seq);
        } else break;
        put(seq);
        prev = seq;
        // TIFF's LZW widens the codes one early
        if (dict.length + 1 >= (1 << width) && width < 12) width++;
        if (o >= expected) break;
    }
    return out;
}

function packbits(src, expected) {
    const out = new Uint8Array(expected);
    let i = 0, o = 0;
    while (i < src.length && o < expected) {
        const n = (src[i++] << 24) >> 24;
        if (n >= 0) { for (let k = 0; k <= n && o < expected; k++) out[o++] = src[i++]; }
        else if (n !== -128) { const b = src[i++]; for (let k = 0; k < 1 - n && o < expected; k++) out[o++] = b; }
    }
    return out;
}

export async function readTiff(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = bytes[0] === 0x49;
    if (!(le || bytes[0] === 0x4D) || v.getUint16(2, le) !== 42) throw new Error('not a TIFF');
    const ifd = v.getUint32(4, le), n = v.getUint16(ifd, le);
    const tags = {};
    for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12, tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), count = v.getUint32(e + 4, le);
        const size = (TYPE_SIZE[type] || 1) * count, at = size > 4 ? v.getUint32(e + 8, le) : e + 8;
        const vals = [];
        for (let k = 0; k < Math.min(count, 1 << 20); k++) {
            if (type === 3) vals.push(v.getUint16(at + k * 2, le));
            else if (type === 4) vals.push(v.getUint32(at + k * 4, le));
            else if (type === 1 || type === 7) vals.push(bytes[at + k]);
            else if (type === 5) vals.push(v.getUint32(at + k * 8, le) / (v.getUint32(at + k * 8 + 4, le) || 1));
            else break;
        }
        tags[tag] = vals;
    }
    const one = (t, d) => (tags[t] ? tags[t][0] : d);
    const w = one(256), h = one(257), spp = one(277, 1), bps = one(258, 1), comp = one(259, 1);
    const photo = one(262, 1), planar = one(284, 1), predictor = one(317, 1), fmt = one(339, 1);
    if (!w || !h) throw new Error('this TIFF has no picture size');
    if (comp === 6 || comp === 7) throw new Error('JPEG-compressed TIFFs can\'t be read yet');
    if (![1, 5, 8, 32946, 32773].includes(comp)) throw new Error(`this TIFF's compression (${comp}) can't be read`);
    if (planar !== 1 && spp > 1) throw new Error('planar TIFFs can\'t be read yet');
    if (fmt !== 1 || ![1, 8, 16].includes(bps)) throw new Error(`${bps}-bit TIFFs can't be read`);
    const tiled = !!tags[322];
    const tw = tiled ? one(322) : w, th = tiled ? one(323) : one(278, h);
    const offs = tiled ? tags[324] : tags[273], counts = tiled ? tags[325] : tags[279];
    const across = Math.ceil(w / tw);
    const rowBytes = Math.ceil(tw * spp * bps / 8);
    const sample = new Uint8Array(w * h * spp); // 8 bits a sample, whatever it was
    for (let k = 0; k < offs.length; k++) {
        const src = bytes.subarray(offs[k], offs[k] + counts[k]);
        const rows = tiled ? th : Math.min(th, h - k * th);
        if (rows <= 0) break;
        const expected = rowBytes * rows;
        let raw = comp === 1 ? src : comp === 5 ? lzw(src, expected) : comp === 32773 ? packbits(src, expected) : await inflate(src);
        if (predictor === 2) {
            raw = raw === src ? raw.slice() : raw;
            if (bps === 8) {
                for (let r = 0; r < rows; r++) for (let i = spp; i < rowBytes; i++) raw[r * rowBytes + i] = (raw[r * rowBytes + i] + raw[r * rowBytes + i - spp]) & 255;
            } else if (bps === 16) {
                const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
                for (let r = 0; r < rows; r++) for (let i = spp; i < tw * spp; i++) {
                    const at = r * rowBytes + i * 2;
                    rv.setUint16(at, (rv.getUint16(at, le) + rv.getUint16(at - spp * 2, le)) & 0xFFFF, le);
                }
            }
        }
        const x0 = tiled ? (k % across) * tw : 0, y0 = tiled ? Math.floor(k / across) * th : k * th;
        for (let r = 0; r < rows && y0 + r < h; r++) {
            for (let x = 0; x < tw && x0 + x < w; x++) {
                for (let c = 0; c < spp; c++) {
                    const s = x * spp + c;
                    let val;
                    if (bps === 8) val = raw[r * rowBytes + s];
                    else if (bps === 16) val = raw[r * rowBytes + s * 2 + (le ? 1 : 0)]; // the high byte
                    else val = (raw[r * rowBytes + (s >> 3)] >> (7 - (s & 7))) & 1 ? 255 : 0;
                    sample[((y0 + r) * w + x0 + x) * spp + c] = val;
                }
            }
        }
    }
    const img = new ImageData(w, h), d = img.data;
    const map = tags[320]; // a palette: 16-bit red, then green, then blue
    for (let i = 0; i < w * h; i++) {
        const s = i * spp, o = i * 4;
        if (photo === 2 && spp >= 3) { d[o] = sample[s]; d[o + 1] = sample[s + 1]; d[o + 2] = sample[s + 2]; d[o + 3] = spp > 3 ? sample[s + 3] : 255; }
        else if (photo === 3 && map) {
            const idx = bps === 8 ? sample[s] : sample[s] ? 1 : 0, third = map.length / 3;
            d[o] = map[idx] >> 8; d[o + 1] = map[third + idx] >> 8; d[o + 2] = map[2 * third + idx] >> 8; d[o + 3] = 255;
        } else {
            const g = photo === 0 ? 255 - sample[s] : sample[s];
            d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = spp > 1 ? sample[s + 1] : 255;
        }
    }
    return upright(img, one(274, 1));
}

// The picture turned as its Orientation says (as EXIF's is for a JPEG)
function upright(img, o) {
    if (o === 1 || !(o >= 2 && o <= 8)) return img;
    const swap = o >= 5;
    const src = new OffscreenCanvas(img.width, img.height);
    src.getContext('2d').putImageData(img, 0, 0);
    const c = new OffscreenCanvas(swap ? img.height : img.width, swap ? img.width : img.height);
    const g = c.getContext('2d');
    const W = img.width, H = img.height;
    const m = { 2: [-1, 0, 0, 1, W, 0], 3: [-1, 0, 0, -1, W, H], 4: [1, 0, 0, -1, 0, H], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, H, 0], 7: [0, -1, -1, 0, H, W], 8: [0, -1, 1, 0, 0, W] }[o];
    g.setTransform(...m);
    g.drawImage(src, 0, 0);
    return g.getImageData(0, 0, c.width, c.height);
}
