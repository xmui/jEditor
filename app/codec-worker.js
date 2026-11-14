// The codecs the browser engine hasn't got, off the page (codec.js runs a
// few of these): AVIF and JPEG XL written, JPEG XL and HEIC read, from the
// WebAssembly builds in codecs/ (jSquash: libavif and libjxl; libheif); TIFF read
// and written by tiff-codec.js. WebP, JPEG and PNG are written here too, by the
// engine, so every format goes the same way.
// A module worker: codec.js starts it with { type: 'module' }.
//
//   { op: 'encode', file, format, quality, crop, preview }
//       → { bytes, w, h, rgb, preview }
//       file: a Blob of any picture the engine reads (or a JPEG XL, HEIC or TIFF);
//       crop: { x, y, w, h } of the upright picture, or { size } for a
//       square that size from its middle: a sample;
//       rgb: the picture's average colour; preview: the result, decoded
//       again, as a PNG (for the close-up)
//   { op: 'decode', file } → { png, w, h }   (a JPEG XL, HEIC or TIFF, for showing it)

import { decodeTiff, encodeTiff } from './tiff-codec.js';

const modules = {};

// A codec, loaded the first time it's wanted. The wasm is fetched here and
// handed over, so how a host labels .wasm files doesn't matter
// (libheif's is inside its .js)
function codec(name) {
    if (!modules[name]) {
        modules[name] = (async () => {
            const { default: factory } = await import(`./codecs/${name}.js`);
            if (name === 'heif_dec') {
                let up;
                const ready = new Promise(r => { up = r; });
                const m = await factory({ onRuntimeInitialized: () => up() });
                if (!m.calledRun) await ready;
                return m;
            }
            const res = await fetch(new URL(`./codecs/${name}.wasm`, import.meta.url));
            if (!res.ok) throw new Error(`${name}.wasm: ${res.status}`);
            return factory({ noInitialRun: true, wasmBinary: await res.arrayBuffer() });
        })();
        modules[name].catch(() => { delete modules[name]; });
    }
    return modules[name];
}

const isJxl = (blob) => blob.type === 'image/jxl' || (blob.name && /\.jxl$/i.test(blob.name));
const isTiff = (blob) => blob.type === 'image/tiff' || (blob.name && /\.tiff?$/i.test(blob.name));
const isHeif = (blob) => /^image\/hei[cf]/.test(blob.type) || (blob.name && /\.(heic|heif|hif)$/i.test(blob.name));

// A HEIC or HEIF: its main picture (an iPhone's, or a burst's first),
// upright (libheif turns and mirrors it as the file says)
async function heif(blob) {
    const m = await codec('heif_dec');
    const dec = new m.HeifDecoder();
    try {
        const all = dec.decode(new Uint8Array(await blob.arrayBuffer()));
        const im = all.find(i => i.is_primary()) || all[0];
        if (!im) throw new Error('not a HEIC picture');
        const img = new ImageData(im.get_width(), im.get_height());
        const ok = await new Promise(r => im.display(img, r));
        all.forEach(i => i.free());
        if (!ok) throw new Error('the HEIC picture couldn\'t be decoded');
        return img;
    } finally {
        if (dec.decoder) m.heif_context_free(dec.decoder);
    }
}

// The thumbnail a HEIC carries (an iPhone's is 320 × 240 or bigger), upright,
// as RGBA, when it's at least `need` wide and the photo's shape; else null.
// ~40 ms where the photo itself takes ~1 s. libheif's own calls, as the
// bundle has no wrapper for these: a struct heif_error comes back through
// a hidden first pointer, and the handle's pointer is its $$.ptr.
async function heifThumb(blob, need) {
    const m = await codec('heif_dec');
    const ctx = m.heif_context_alloc();
    const mem = m._malloc(64);
    let h = null, th = 0, img = 0;
    try {
        const read = m.heif_context_read_from_memory(ctx, new Uint8Array(await blob.arrayBuffer()));
        if (read && read.code !== m.heif_error_code.heif_error_Ok) return null;
        h = m.heif_js_context_get_primary_image_handle(ctx);
        const hp = h && h.$$ && h.$$.ptr;
        if (!hp || !m._heif_image_handle_get_number_of_thumbnails(hp)) return null;
        m._heif_image_handle_get_list_of_thumbnail_IDs(hp, mem, 1);
        m._heif_image_handle_get_thumbnail(mem + 16, hp, m.HEAPU32[mem >> 2], mem + 32);
        if (m.HEAP32[(mem + 16) >> 2]) return null;
        th = m.HEAPU32[(mem + 32) >> 2];
        m._heif_decode_image(mem + 16, th, mem + 36, m.heif_colorspace.heif_colorspace_RGB.value, m.heif_chroma.heif_chroma_interleaved_RGBA.value, 0);
        if (m.HEAP32[(mem + 16) >> 2]) return null;
        img = m.HEAPU32[(mem + 36) >> 2];
        const INTERLEAVED = 10;
        const w = m._heif_image_get_width(img, INTERLEAVED), h2 = m._heif_image_get_height(img, INTERLEAVED);
        const W = m.heif_image_handle_get_width(h), H = m.heif_image_handle_get_height(h);
        // Too small, or not turned as the photo is: the photo itself
        if (!(w >= need) || !W || !H || Math.abs(w / h2 - W / H) > 0.03 * (W / H)) return null;
        const p = m._heif_image_get_plane_readonly(img, INTERLEAVED, mem + 40);
        const stride = m.HEAP32[(mem + 40) >> 2];
        if (!p || stride < w * 4) return null;
        const out = new ImageData(w, h2);
        for (let y = 0; y < h2; y++) out.data.set(m.HEAPU8.subarray(p + y * stride, p + y * stride + w * 4), y * w * 4);
        return out;
    } catch (e) {
        return null;
    } finally {
        if (img) m._heif_image_release(img);
        if (th) m._heif_image_handle_release(th);
        if (h && h.$$) m.heif_image_handle_release(h);
        m._free(mem);
        m.heif_context_free(ctx);
    }
}

// The picture, upright, as RGBA
async function pixels(blob) {
    if (isTiff(blob)) return decodeTiff(await blob.arrayBuffer());
    if (isHeif(blob)) return heif(blob);
    if (isJxl(blob)) {
        const m = await codec('jxl_dec');
        const img = m.decode(await blob.arrayBuffer());
        if (!img) throw new Error('not a JPEG XL picture');
        return img;
    }
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    bmp.close();
    return g.getImageData(0, 0, c.width, c.height);
}

function cropOf(img, r) {
    const x = Math.max(0, Math.min(img.width - 1, Math.round(r.x))), y = Math.max(0, Math.min(img.height - 1, Math.round(r.y)));
    const w = Math.max(1, Math.min(img.width - x, Math.round(r.w))), h = Math.max(1, Math.min(img.height - y, Math.round(r.h)));
    const out = new ImageData(w, h);
    for (let row = 0; row < h; row++) {
        const from = ((y + row) * img.width + x) * 4;
        out.data.set(img.data.subarray(from, from + w * 4), row * w * 4);
    }
    return out;
}

function centred(img, size) {
    const s = Math.min(size, img.width, img.height);
    return { x: (img.width - s) / 2, y: (img.height - s) / 2, w: s, h: s };
}

function average(img) {
    const d = img.data, step = Math.max(1, Math.floor(d.length / 4 / 4096)) * 4;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += step) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

// Speeds chosen for a whole library: a little bigger than the slowest
// setting gives, many times quicker
async function encode(img, format, quality) {
    if (format === 'tiff') return encodeTiff(img); // its EXIF goes in after (meta.js)
    if (format === 'webp' || format === 'png' || format === 'jpeg') {
        const type = 'image/' + format;
        let c = new OffscreenCanvas(img.width, img.height);
        c.getContext('2d').putImageData(img, 0, 0);
        if (format === 'jpeg') {
            // A JPEG has no see-through: what is goes onto white
            const flat = new OffscreenCanvas(img.width, img.height), g = flat.getContext('2d');
            g.fillStyle = '#fff';
            g.fillRect(0, 0, flat.width, flat.height);
            g.drawImage(c, 0, 0);
            c = flat;
        }
        const blob = await c.convertToBlob(format === 'png' ? { type } : { type, quality: quality / 100 });
        if (blob.type !== type) throw new Error(`${format.toUpperCase()} can't be written here`);
        return new Uint8Array(await blob.arrayBuffer());
    }
    if (format === 'avif') {
        const m = await codec('avif_enc');
        const out = m.encode(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height, {
            quality, qualityAlpha: -1, denoiseLevel: 0, tileColsLog2: 0, tileRowsLog2: 0, speed: 7, subsample: 1,
            chromaDeltaQ: false, sharpness: 0, tune: 0, enableSharpYUV: false, bitDepth: 8, lossless: false
        });
        if (!out) throw new Error('AVIF encoding failed');
        return new Uint8Array(out);
    }
    if (format === 'jxl') {
        const m = await codec('jxl_enc');
        const out = m.encode(img.data, img.width, img.height, {
            effort: 6, quality, progressive: false, epf: -1, lossyPalette: false, decodingSpeedTier: 0,
            photonNoiseIso: 0, lossyModular: false, lossless: false
        });
        if (!out) throw new Error('JPEG XL encoding failed');
        return new Uint8Array(out);
    }
    throw new Error('unknown format ' + format);
}

async function png(img) {
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d').putImageData(img, 0, 0);
    return c.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (e) => {
    const { id, op } = e.data;
    try {
        if (op === 'encode') {
            const { file, format, quality, crop, preview } = e.data;
            let img = await pixels(file);
            const full = { w: img.width, h: img.height };
            const rgb = average(img);
            if (crop) img = cropOf(img, crop.size ? centred(img, crop.size) : crop);
            const bytes = await encode(img, format, quality);
            let back = null;
            if (preview) {
                const type = { webp: 'image/webp', avif: 'image/avif', jxl: 'image/jxl', jpeg: 'image/jpeg', png: 'image/png', tiff: 'image/tiff' }[format];
                back = await png(await pixels(new Blob([bytes], { type })));
            }
            self.postMessage({ id, bytes, w: full.w, h: full.h, rgb, preview: back }, [bytes.buffer]);
        } else if (op === 'decode') {
            const img = await pixels(e.data.file);
            self.postMessage({ id, png: await png(img), w: img.width, h: img.height });
        } else if (op === 'thumb') {
            // A grid thumbnail, `width` wide: no full-size PNG made and read
            // again; a HEIC's own thumbnail when it has a big enough one
            const want = e.data.width;
            const img = (isHeif(e.data.file) && await heifThumb(e.data.file, Math.round(want * 0.7))) || await pixels(e.data.file);
            const bmp = await createImageBitmap(img, { resizeWidth: Math.min(want, img.width), resizeQuality: 'medium' });
            const c = new OffscreenCanvas(bmp.width, bmp.height);
            c.getContext('2d').drawImage(bmp, 0, 0);
            bmp.close();
            const blob = await c.convertToBlob(e.data.alpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.8 });
            self.postMessage({ id, blob, w: img.width, h: img.height });
        } else if (op === 'ping') {
            await codec(e.data.name);
            self.postMessage({ id, ok: true });
        } else {
            throw new Error('unknown op ' + op);
        }
    } catch (err) {
        self.postMessage({ id, error: (err && err.message) || String(err) });
    }
};
