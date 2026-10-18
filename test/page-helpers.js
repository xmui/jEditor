// Shared by the browser test suites (ui.test.js, edit.test.js): where
// Chromium is, the in-page helpers every test page gets, and opening a page.

const fs = require('fs');

function launchOptions() {
    const candidates = [
        process.env.CHROME_PATH,
        '/opt/pw-browsers/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return { executablePath: p, args: ['--no-sandbox'] };
    }
    return { channel: 'chrome', args: ['--no-sandbox'] };
}

// Shared in-page helpers, injected into every test page.
const PAGE_HELPERS = `
    // A fake FileSystemFileHandle backed by in-memory bytes.
    window.makeHandle = (name, bytes, type) => {
        const h = {
            kind: 'file', name, writes: 0,
            bytes: new Uint8Array(bytes),
            getFile: async () => new File([h.bytes], name, { type, lastModified: Date.now() }),
            // Like FileSystemFileHandle: whole-file writes, or positional
            // writes on top of the existing data with keepExistingData
            createWritable: async (opts) => {
                let buf = opts && opts.keepExistingData ? new Uint8Array(h.bytes) : new Uint8Array(0);
                return {
                    write: async (d) => {
                        if (d && d.type === 'write') {
                            const data = new Uint8Array(d.data.buffer ? d.data : await d.data.arrayBuffer());
                            if (d.position + data.length > buf.length) {
                                const grown = new Uint8Array(d.position + data.length);
                                grown.set(buf);
                                buf = grown;
                            }
                            buf.set(data, d.position);
                            h.inPlaceWrites = (h.inPlaceWrites || 0) + 1;
                        } else {
                            buf = new Uint8Array(await d.arrayBuffer());
                            h.writtenType = d.type;
                        }
                    },
                    close: async () => { h.bytes = buf; h.writes++; },
                    abort: async () => { }
                };
            },
            queryPermission: async () => 'granted',
            requestPermission: async () => 'granted'
        };
        return h;
    };
    window.makeFakeFile = (name, bytes, type, size, mtime) => {
        const handle = makeHandle(name, bytes, type);
        return { name, handle, size: size ?? bytes.length, lastModified: mtime ?? Date.now() };
    };
    // Minimal JPEG byte stream: SOI + (optional segments) + SOS + EOI.
    window.makeJpegBytes = (segments = []) => {
        const parts = [[0xFF, 0xD8], ...segments.map(s => [...s]), [0xFF, 0xDA, 0x00, 0x02], [0xFF, 0xD9]];
        return parts.flat();
    };
    window.readOrientation = (bytes) => {
        const view = new DataView(new Uint8Array(bytes).buffer);
        const loc = app.findJpegOrientation(view);
        if (!loc || loc.insert) return null;
        return view.getUint16(loc.valueOffset, loc.littleEndian);
    };
    // Real, decodable JPEG with optional metadata: EXIF (Make "TestCam" +
    // DateTimeOriginal, no Orientation — like a scanner), JFIF DPI, an
    // ICC_PROFILE segment, and XMP carrying tiff:Orientation.
    window.makeRealJpeg = async (w, h, { exif = false, dpi = 0, icc = false, color = '#3a7', xmpOrientation = 0 } = {}) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = color; g.fillRect(0, 0, w, h);
        const bytes = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer());
        const segs = ImageMeta.jpegSegments(bytes);
        const body = bytes.subarray(segs.find(s => s.marker !== 0xE0).start);
        const seg = (marker, payload) => {
            const len = payload.length + 2;
            return [0xFF, marker, len >> 8, len & 0xFF, ...payload];
        };
        const ascii = (t) => [...t].map(ch => ch.charCodeAt(0));
        const parts = [[0xFF, 0xD8]];
        if (dpi) parts.push(seg(0xE0, [...ascii('JFIF'), 0, 1, 2, 1, dpi >> 8, dpi & 0xFF, dpi >> 8, dpi & 0xFF, 0, 0]));
        if (exif) {
            const make = [...ascii('TestCam'), 0];
            const date = [...ascii('2024:06:15 13:45:00'), 0];
            const makeOff = 38, exifOff = makeOff + make.length, dateOff = exifOff + 18;
            const t = new DataView(new ArrayBuffer(dateOff + date.length));
            t.setUint16(0, 0x4D4D); t.setUint16(2, 42); t.setUint32(4, 8); t.setUint16(8, 2);
            t.setUint16(10, 0x010F); t.setUint16(12, 2); t.setUint32(14, make.length); t.setUint32(18, makeOff);
            t.setUint16(22, 0x8769); t.setUint16(24, 4); t.setUint32(26, 1); t.setUint32(30, exifOff);
            t.setUint32(34, 0);
            make.forEach((b, i) => t.setUint8(makeOff + i, b));
            t.setUint16(exifOff, 1);
            t.setUint16(exifOff + 2, 0x9003); t.setUint16(exifOff + 4, 2);
            t.setUint32(exifOff + 6, date.length); t.setUint32(exifOff + 10, dateOff);
            t.setUint32(exifOff + 14, 0);
            date.forEach((b, i) => t.setUint8(dateOff + i, b));
            parts.push(seg(0xE1, [...ascii('Exif'), 0, 0, ...new Uint8Array(t.buffer)]));
        }
        if (xmpOrientation) {
            parts.push(seg(0xE1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0,
                ...ascii('<x:xmpmeta><rdf:Description tiff:Orientation="' + xmpOrientation + '"/></x:xmpmeta>')]));
        }
        if (icc) parts.push(seg(0xE2, [...ascii('ICC_PROFILE'), 0, 1, 1, ...new Array(128).fill(0)]));
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0) + body.length);
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        out.set(body, o);
        return out;
    };
    // Real PNG with a pHYs chunk (DPI) right after IHDR
    window.makeRealPng = async (w, h, dpi) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').fillRect(0, 0, w, h);
        const png = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
        const table = Array.from({ length: 256 }, (_, n) => {
            let x = n;
            for (let k = 0; k < 8; k++) x = x & 1 ? 0xEDB88320 ^ (x >>> 1) : x >>> 1;
            return x >>> 0;
        });
        const crc = (bytes) => {
            let x = 0xFFFFFFFF;
            for (const b of bytes) x = table[(x ^ b) & 0xFF] ^ (x >>> 8);
            return (x ^ 0xFFFFFFFF) >>> 0;
        };
        const ppm = Math.round(dpi / 0.0254);
        const typeAndData = new Uint8Array(13);
        typeAndData.set([0x70, 0x48, 0x59, 0x73]); // 'pHYs'
        const tv = new DataView(typeAndData.buffer);
        tv.setUint32(4, ppm); tv.setUint32(8, ppm); typeAndData[12] = 1;
        const chunk = new Uint8Array(21);
        const cv = new DataView(chunk.buffer);
        cv.setUint32(0, 9);
        chunk.set(typeAndData, 4);
        cv.setUint32(17, crc(typeAndData));
        const ihdrEnd = 8 + 25;
        const out = new Uint8Array(png.length + chunk.length);
        out.set(png.subarray(0, ihdrEnd));
        out.set(chunk, ihdrEnd);
        out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
        return out;
    };
    // Fake FileSystemDirectoryHandle backed by Maps
    window.makeDir = (name) => {
        const dirs = new Map(), files = new Map();
        const dir = {
            kind: 'directory', name, _files: files, _dirs: dirs,
            getDirectoryHandle: async (n, o) => {
                if (!dirs.has(n)) {
                    if (!o || !o.create) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; }
                    dirs.set(n, makeDir(n));
                }
                return dirs.get(n);
            },
            getFileHandle: async (n, o) => {
                if (!files.has(n)) {
                    if (!o || !o.create) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; }
                    files.set(n, makeHandle(n, [], 'image/jpeg'));
                }
                return files.get(n);
            },
            removeEntry: async (n) => { files.delete(n); },
            queryPermission: async () => 'granted',
            requestPermission: async () => 'granted'
        };
        return dir;
    };
`;

async function newPage(browser, url) {
    const page = await browser.newPage();
    const issues = { errors: [], failedRequests: [] };
    page.on('pageerror', e => issues.errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') issues.errors.push('CONSOLE: ' + m.text()); });
    page.on('requestfailed', r => issues.failedRequests.push(r.url()));
    page.on('response', r => { if (r.status() >= 400) issues.failedRequests.push(r.status() + ' ' + r.url()); });
    // THROTTLE=6 npm test: run pages on a slowed CPU, to catch tests that rely on timing
    if (process.env.THROTTLE) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +process.env.THROTTLE }); }
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(PAGE_HELPERS);
    return { page, issues };
}

module.exports = { launchOptions, PAGE_HELPERS, newPage };
