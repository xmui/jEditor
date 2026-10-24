// TIFF, read and written here, as no browser engine reads it (codec-worker.js
// imports this). Read: what scanners and other apps write: strips or
// tiles; none, LZW, Deflate or PackBits compression (with the horizontal
// predictor); 1 to 16 bits; grey, RGB, palette or CMYK; an alpha channel;
// the pixels turned upright by its Orientation. Not read: JPEG-compressed
// TIFF, and floating-point samples. Written: RGB (or RGBA when it has any
// see-through pixels), 8 bits, LZW with the predictor, which every app
// that opens TIFF opens. Its EXIF is put in by meta.js (withExifTiff).
//
//   decodeTiff(ArrayBuffer) → ImageData, upright
//   encodeTiff(ImageData) → Uint8Array

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

// ---- Reading ----

function readIfd(v, le, off) {
    const n = v.getUint16(off, le);
    const tags = new Map();
    for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12;
        const tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), count = v.getUint32(e + 4, le);
        const size = (TYPE_SIZE[type] || 1) * count;
        const at = size <= 4 ? e + 8 : v.getUint32(e + 8, le);
        const vals = [];
        for (let k = 0; k < Math.min(count, 1 << 20); k++) {
            const p = at + k * (TYPE_SIZE[type] || 1);
            vals.push(type === 3 || type === 8 ? v.getUint16(p, le)
                : type === 4 || type === 9 || type === 16 ? v.getUint32(p, le)
                : type === 5 ? v.getUint32(p, le) / (v.getUint32(p + 4, le) || 1)
                : v.getUint8(p));
        }
        tags.set(tag, vals);
    }
    return tags;
}

function lzwDecode(src, size) {
    let out = new Uint8Array(size || src.length * 3);
    let o = 0;
    const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), len = new Uint32Array(4096);
    for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; len[i] = 1; }
    let width = 9, next = 258, old = -1, bit = 0;
    const total = src.length * 8;
    const put = (code) => {
        const n = len[code];
        if (o + n > out.length) { const bigger = new Uint8Array(Math.max(out.length * 2, o + n)); bigger.set(out); out = bigger; }
        for (let i = n - 1, c = code; i >= 0; i--, c = prefix[c]) out[o + i] = suffix[c];
        o += n;
    };
    const add = (p, c) => {
        if (next >= 4096) return;
        prefix[next] = p; suffix[next] = c; first[next] = first[p]; len[next] = len[p] + 1;
        next++;
    };
    while (bit + width <= total) {
        let code = 0;
        for (let i = 0; i < width; i++, bit++) code = (code << 1) | ((src[bit >> 3] >> (7 - (bit & 7))) & 1);
        if (code === 257) break;
        if (code === 256) { width = 9; next = 258; old = -1; continue; }
        if (old === -1) { if (code > 255) break; put(code); old = code; continue; }
        if (code < next) { put(code); add(old, first[code]); }
        else { add(old, first[old]); put(next - 1); }
        old = code;
        if (next >= (1 << width) - 1 && width < 12) width++;
    }
    return out.subarray(0, o);
}

function packBitsDecode(src, size) {
    const out = new Uint8Array(size);
    let i = 0, o = 0;
    while (i < src.length && o < size) {
        const n = (src[i++] << 24) >> 24;
        if (n >= 0) { out.set(src.subarray(i, i + n + 1), o); i += n + 1; o += n + 1; }
        else if (n !== -128) { out.fill(src[i++], o, o + 1 - n); o += 1 - n; }
    }
    return out;
}

async function inflate(src) {
    const stream = new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(src, compression, size) {
    if (compression === 1) return src;
    if (compression === 5) return lzwDecode(src, size);
    if (compression === 8 || compression === 32946) return inflate(src);
    if (compression === 32773) return packBitsDecode(src, size);
    throw new Error(compression === 7 || compression === 6 ? 'JPEG-compressed TIFF isn\'t read here' : `TIFF compression ${compression} isn't read here`);
}

// Undoes the horizontal predictor: each sample was stored as the
// difference from the one before it in the row
function unpredict(buf, rowBytes, rows, spp, bits, le) {
    if (bits === 8) {
        for (let r = 0; r < rows; r++) {
            const s = r * rowBytes;
            for (let i = s + spp; i < s + rowBytes; i++) buf[i] = (buf[i] + buf[i - spp]) & 255;
        }
    } else if (bits === 16) {
        const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        for (let r = 0; r < rows; r++) {
            const s = r * rowBytes;
            for (let i = s + spp * 2; i + 1 < s + rowBytes; i += 2) v.setUint16(i, (v.getUint16(i, le) + v.getUint16(i - spp * 2, le)) & 0xFFFF, le);
        }
    }
}

export async function decodeTiff(buffer) {
    const v = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const le = v.getUint16(0) === 0x4949;
    if (v.getUint16(2, le) !== 42) throw new Error('not a TIFF');
    const t = readIfd(v, le, v.getUint32(4, le));
    const one = (tag, d) => (t.has(tag) ? t.get(tag)[0] : d);
    const width = one(256), height = one(257);
    if (!width || !height) throw new Error('a TIFF without a size');
    const bitsList = t.get(258) || [1];
    const bits = bitsList[0];
    const spp = one(277, 1), compression = one(259, 1), photometric = one(262, spp >= 3 ? 2 : 1);
    const planar = one(284, 1), predictor = one(317, 1), orientation = one(274, 1);
    if (one(339, 1) === 3) throw new Error('floating-point TIFF isn\'t read here');
    if (photometric === 6 && compression !== 1) throw new Error('YCbCr TIFF isn\'t read here');
    const tiled = t.has(322);
    const cw = tiled ? one(322) : width, ch = tiled ? one(323) : Math.min(one(278, height), height);
    const offsets = t.get(tiled ? 324 : 273) || [], counts = t.get(tiled ? 325 : 279) || [];
    const planes = planar === 2 ? spp : 1, perPixel = planar === 2 ? 1 : spp;
    const rowBytes = Math.ceil(cw * perPixel * bits / 8);
    const across = Math.ceil(width / cw), down = Math.ceil(height / ch);
    // Each plane whole, its rows rowBytes of a full-width chunk apart
    const planeRow = Math.ceil(width * perPixel * bits / 8);
    const data = Array.from({ length: planes }, () => new Uint8Array(planeRow * height));
    for (let p = 0; p < planes; p++) {
        for (let cy = 0; cy < down; cy++) {
            for (let cx = 0; cx < across; cx++) {
                const k = p * across * down + cy * across + cx;
                if (offsets[k] === undefined) continue;
                const rows = tiled ? ch : Math.min(ch, height - cy * ch);
                let chunk = await decompress(bytes.subarray(offsets[k], offsets[k] + (counts[k] || 0)), compression, rowBytes * rows);
                if (predictor === 2) { chunk = new Uint8Array(chunk); unpredict(chunk, rowBytes, rows, perPixel, bits, le); }
                // Into place (bit-packed samples: chunks are whole rows, never split)
                const xByte = Math.floor(cx * cw * perPixel * bits / 8);
                const take = Math.min(rowBytes, planeRow - xByte);
                for (let r = 0; r < rows && cy * ch + r < height; r++) {
                    data[p].set(chunk.subarray(r * rowBytes, r * rowBytes + take), (cy * ch + r) * planeRow + xByte);
                }
            }
        }
    }
    // Samples, scaled to 8 bits
    const max = (1 << Math.min(bits, 16)) - 1;
    const sample = (x, y, s) => {
        const plane = planar === 2 ? data[s] : data[0];
        const idx = planar === 2 ? x : x * spp + s;
        const row = y * planeRow;
        if (bits === 8) return plane[row + idx];
        if (bits === 16) {
            const a = plane[row + idx * 2], b = plane[row + idx * 2 + 1];
            return le ? b : a; // the high byte
        }
        if (bits < 8) {
            const at = idx * bits, byte = plane[row + (at >> 3)];
            const val = (byte >> (8 - bits - (at & 7))) & max;
            return photometric === 3 ? val : Math.round(val * 255 / max);
        }
        return plane[row + idx * (bits >> 3) + (le ? (bits >> 3) - 1 : 0)];
    };
    const map = photometric === 3 ? t.get(320) : null;
    const extra = t.get(338) || [];
    const colours = photometric === 2 || photometric === 6 ? 3 : photometric === 5 ? 4 : 1;
    const alphaAt = spp > colours ? colours : -1;
    const premultiplied = alphaAt >= 0 && extra[0] === 1;
    const out = new ImageData(width, height);
    const d = out.data;
    // The usual: 8-bit grey or RGB, with or without alpha, samples together
    if (bits === 8 && planar === 1 && (photometric === 1 || photometric === 2) && !premultiplied) {
        const src = data[0];
        for (let y = 0; y < height; y++) {
            let s = y * planeRow, i = y * width * 4;
            for (let x = 0; x < width; x++, s += spp, i += 4) {
                if (colours === 3) { d[i] = src[s]; d[i + 1] = src[s + 1]; d[i + 2] = src[s + 2]; }
                else d[i] = d[i + 1] = d[i + 2] = src[s];
                d[i + 3] = alphaAt >= 0 ? src[s + alphaAt] : 255;
            }
        }
        return upright(out, orientation);
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            let r, g, b;
            if (photometric === 2) { r = sample(x, y, 0); g = sample(x, y, 1); b = sample(x, y, 2); }
            else if (photometric === 3 && map) {
                const n = map.length / 3, k = sample(x, y, 0);
                r = map[k] >> 8; g = map[n + k] >> 8; b = map[2 * n + k] >> 8;
            } else if (photometric === 5) {
                const k = 255 - sample(x, y, 3);
                r = ((255 - sample(x, y, 0)) * k) / 255; g = ((255 - sample(x, y, 1)) * k) / 255; b = ((255 - sample(x, y, 2)) * k) / 255;
            } else if (photometric === 6) {
                const Y = sample(x, y, 0), cb = sample(x, y, 1) - 128, cr = sample(x, y, 2) - 128;
                r = Y + 1.402 * cr; g = Y - 0.344136 * cb - 0.714136 * cr; b = Y + 1.772 * cb;
            } else {
                const gv = sample(x, y, 0);
                r = g = b = photometric === 0 ? 255 - gv : gv;
            }
            let a = alphaAt >= 0 ? sample(x, y, alphaAt) : 255;
            if (premultiplied && a > 0 && a < 255) { r = r * 255 / a; g = g * 255 / a; b = b * 255 / a; }
            d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
        }
    }
    return upright(out, orientation);
}

// The pixels as they're meant to be seen (EXIF/TIFF Orientation 2–8)
function upright(img, o) {
    if (!(o >= 2 && o <= 8)) return img;
    const w = img.width, h = img.height, swap = o >= 5;
    const out = new ImageData(swap ? h : w, swap ? w : h);
    const s = new Uint32Array(img.data.buffer), t = new Uint32Array(out.data.buffer);
    const ow = out.width;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let nx, ny;
            switch (o) {
                case 2: nx = w - 1 - x; ny = y; break;
                case 3: nx = w - 1 - x; ny = h - 1 - y; break;
                case 4: nx = x; ny = h - 1 - y; break;
                case 5: nx = y; ny = x; break;
                case 6: nx = h - 1 - y; ny = x; break;
                case 7: nx = h - 1 - y; ny = w - 1 - x; break;
                default: nx = y; ny = w - 1 - x; break; // 8
            }
            t[ny * ow + nx] = s[y * w + x];
        }
    }
    return out;
}

// ---- Writing ----

// TIFF's LZW: codes from 9 to 12 bits, most significant bit first, a
// wider code as soon as the table needs one, Clear when it's full
function lzwEncode(data) {
    let out = new Uint8Array(Math.max(1024, data.length >> 1));
    let o = 0, acc = 0, nacc = 0;
    const write = (code, width) => {
        acc = (acc << width) | code;
        nacc += width;
        while (nacc >= 8) {
            if (o >= out.length) { const bigger = new Uint8Array(out.length * 2); bigger.set(out); out = bigger; }
            out[o++] = (acc >>> (nacc - 8)) & 255;
            nacc -= 8;
        }
        acc &= (1 << nacc) - 1;
    };
    // The table: prefix code × 256 + byte → code, valid while its epoch is now
    const codeOf = new Uint16Array(4096 * 256), epochOf = new Uint16Array(4096 * 256);
    let epoch = 1, width = 9, next = 258;
    write(256, width);
    if (!data.length) { write(257, width); return out.subarray(0, o + (nacc ? 1 : 0)); }
    let prefix = data[0];
    for (let i = 1; i < data.length; i++) {
        const c = data[i], key = prefix * 256 + c;
        if (epochOf[key] === epoch) { prefix = codeOf[key]; continue; }
        write(prefix, width);
        if (next < 4093) {
            codeOf[key] = next; epochOf[key] = epoch;
            next++;
            if (next >= (1 << width) && width < 12) width++;
        } else {
            write(256, width);
            width = 9; next = 258;
            if (++epoch > 65535) { epochOf.fill(0); epoch = 1; }
        }
        prefix = c;
    }
    write(prefix, width);
    next++;
    if (next >= (1 << width) && width < 12) width++;
    write(257, width);
    if (nacc) {
        if (o >= out.length) { const bigger = new Uint8Array(out.length + 1); bigger.set(out); out = bigger; }
        out[o++] = (acc << (8 - nacc)) & 255;
    }
    return out.subarray(0, o);
}

export function encodeTiff(img) {
    const { width: w, height: h, data: px } = img;
    let alpha = false;
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) { alpha = true; break; }
    const spp = alpha ? 4 : 3, rowBytes = w * spp;
    const rps = Math.max(1, Math.min(h, Math.floor(65536 / rowBytes)));
    const strips = [];
    for (let y0 = 0; y0 < h; y0 += rps) {
        const rows = Math.min(rps, h - y0);
        const raw = new Uint8Array(rows * rowBytes);
        for (let r = 0; r < rows; r++) {
            const s = (y0 + r) * w * 4, t = r * rowBytes;
            for (let x = 0; x < w; x++) for (let k = 0; k < spp; k++) raw[t + x * spp + k] = px[s + x * 4 + k];
            // The predictor: each sample as the difference from the one before
            for (let i = t + rowBytes - 1; i >= t + spp; i--) raw[i] = (raw[i] - raw[i - spp]) & 255;
        }
        strips.push(lzwEncode(raw));
    }
    // Header, the strips, then the values too big for an entry, then the IFD
    const tags = [
        [256, 4, [w]], [257, 4, [h]], [258, 3, new Array(spp).fill(8)], [259, 3, [5]], [262, 3, [2]],
        [273, 4, null], [277, 3, [spp]], [278, 4, [rps]], [279, 4, strips.map(s => s.length)],
        [282, 5, [72]], [283, 5, [72]], [284, 3, [1]], [296, 3, [2]], [317, 3, [2]],
        ...(alpha ? [[338, 3, [2]]] : [])
    ];
    let o = 8;
    const stripAt = strips.map(s => { const at = o; o += s.length + (s.length & 1); return at; });
    tags.find(x => x[0] === 273)[2] = stripAt;
    const size = (type, vals) => TYPE_SIZE[type] * vals.length;
    const extraAt = new Map();
    for (const [tag, type, vals] of tags) if (size(type, vals) > 4) { extraAt.set(tag, o); o += size(type, vals) + (size(type, vals) & 1); }
    const ifdAt = o;
    o += 2 + tags.length * 12 + 4;
    const buf = new Uint8Array(o), v = new DataView(buf.buffer);
    v.setUint16(0, 0x4949); v.setUint16(2, 42, true); v.setUint32(4, ifdAt, true);
    strips.forEach((s, i) => buf.set(s, stripAt[i]));
    const putVals = (at, type, vals) => vals.forEach((x, i) => {
        if (type === 3) v.setUint16(at + i * 2, x, true);
        else if (type === 4) v.setUint32(at + i * 4, x, true);
        else if (type === 5) { v.setUint32(at + i * 8, x, true); v.setUint32(at + i * 8 + 4, 1, true); }
    });
    v.setUint16(ifdAt, tags.length, true);
    tags.forEach(([tag, type, vals], i) => {
        const e = ifdAt + 2 + i * 12;
        v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, vals.length, true);
        if (extraAt.has(tag)) { v.setUint32(e + 8, extraAt.get(tag), true); putVals(extraAt.get(tag), type, vals); }
        else putVals(e + 8, type, vals);
    });
    return buf;
}

// For the tests (and meta.js's EXIF): the LZW on its own
export const _lzw = { encode: lzwEncode, decode: lzwDecode };
