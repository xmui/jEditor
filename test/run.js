#!/usr/bin/env node
// jEditor test suite: boots the real app in headless Chromium and exercises
// sorting, selection identity, EXIF-based lossless rotation, the bulk-rotate
// race regression, and the standalone (file://) build.
//
// Requires a Chromium-based browser. Resolution order:
//   1. CHROME_PATH env var
//   2. Known local Chromium paths
//   3. Installed Google Chrome (playwright channel)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { createServer } = require('../scripts/serve.js');

const ROOT = path.join(__dirname, '..');

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

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
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
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(PAGE_HELPERS);
    return { page, issues };
}

(async () => {
    // ---- 0. PWA static checks: manifest, icons, service worker assets ----
    console.log('PWA manifest & assets');
    {
        const APP = path.join(ROOT, 'app');
        const pngSize = (p) => {
            const b = fs.readFileSync(p);
            return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
        };
        const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
        check('manifest is installable (standalone + start_url + id)',
            manifest.display === 'standalone' && manifest.start_url === './' && manifest.id === './');

        let iconsOk = true, iconDetail = [];
        for (const icon of manifest.icons) {
            const p = path.join(APP, icon.src);
            const ok = fs.existsSync(p) && pngSize(p) === icon.sizes;
            if (!ok) iconsOk = false;
            iconDetail.push(`${icon.src}=${fs.existsSync(p) ? pngSize(p) : 'MISSING'} (declared ${icon.sizes})`);
        }
        check('manifest icons exist with truthful sizes', iconsOk, iconDetail.join('; '));
        check('has a maskable icon', manifest.icons.some(i => (i.purpose || '').includes('maskable')));

        // Every asset the service worker precaches must actually exist,
        // otherwise cache.addAll rejects and the PWA never works offline
        const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
        const assets = [...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
        const missing = assets.filter(a => a !== '' && !fs.existsSync(path.join(APP, a)));
        check('all service-worker precache assets exist', missing.length === 0, missing.join(', '));
        check('service worker cache version follows app version',
            sw.includes("importScripts('./version.js')") && sw.includes('APP_VERSION'));
    }

    // Build the standalone file first so we can test it too
    execSync('node scripts/build-standalone.js', { cwd: ROOT, stdio: 'inherit' });

    const server = createServer();
    await new Promise(r => server.listen(0, r));
    const baseUrl = `http://localhost:${server.address().port}`;

    const browser = await chromium.launch(launchOptions());

    // ---- 0b. Web app build (GitHub Pages): one self-contained page ----
    console.log('web app build');
    {
        const os = require('os');
        const http = require('http');
        const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'jeditor-site-'));
        execSync(`node scripts/build-standalone.js --site "${SITE}"`, { cwd: ROOT, stdio: 'pipe' });
        const index = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
        check('site page has every script and style inlined', !/<script src=|<link rel="stylesheet"/.test(index) && index.includes('const Renamer'));
        const swSrc = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
        const precache = JSON.parse(swSrc.match(/const ASSETS = (\[[^]*?\]);/)[1]);
        const missing = precache.filter(a => a !== './' && !fs.existsSync(path.join(SITE, a)));
        check('site service worker precaches only files it has', missing.length === 0 && precache.includes('./index.html'), missing.join(', '));

        const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
        const siteServer = http.createServer((req, res) => {
            const p = decodeURIComponent(req.url.split('?')[0]);
            const f = path.join(SITE, p.endsWith('/') ? 'index.html' : p);
            fs.readFile(f, (e, d) => {
                if (e) { res.writeHead(404); return res.end(); }
                res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
                res.end(d);
            });
        });
        await new Promise(r => siteServer.listen(0, r));
        const { page, issues } = await newPage(browser, `http://localhost:${siteServer.address().port}/`);
        const r = await page.evaluate(async () => {
            const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(res => setTimeout(() => res(null), 8000))]);
            let cached = [];
            if (reg) {
                for (let i = 0; i < 40 && !cached.length; i++) {
                    const keys = await caches.keys();
                    if (keys.length) cached = (await (await caches.open(keys[0])).keys()).map(q => new URL(q.url).pathname);
                    if (!cached.length) await new Promise(res => setTimeout(res, 100));
                }
            }
            return {
                loaded: typeof app !== 'undefined' && typeof CropEditor !== 'undefined' && typeof Renamer !== 'undefined' && typeof FolderCache !== 'undefined',
                title: document.getElementById('app-title').textContent,
                sw: !!reg, cachedIndex: cached.some(p => p.endsWith('/index.html'))
            };
        });
        check('site boots with no errors', issues.errors.length === 0 && issues.failedRequests.length === 0 && r.loaded,
            issues.errors.concat(issues.failedRequests).join('; '));
        check('site installs its service worker and caches the page', r.sw && r.cachedIndex, JSON.stringify(r));
        await page.close();
        siteServer.close();
        fs.rmSync(SITE, { recursive: true, force: true });
    }

    // ---- 1. Boot: served app loads clean ----
    console.log('boot (http)');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        check('no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        check('no failed requests', issues.failedRequests.length === 0, issues.failedRequests.join('; '));
        check('crop editor + metadata modules loaded', await page.evaluate(() =>
            typeof CropEditor !== 'undefined' && typeof CropGeom !== 'undefined' && typeof ImageMeta !== 'undefined'));
        check('app initialized', await page.evaluate(() => typeof app !== 'undefined'));

        const pkgVersion = require(path.join(ROOT, 'package.json')).version;
        const v = await page.evaluate(() => ({
            appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null,
            title: document.getElementById('app-title')?.textContent || ''
        }));
        check('APP_VERSION matches package.json', v.appVersion === pkgVersion, `${v.appVersion} vs ${pkgVersion}`);
        check('version shown on start screen', v.title === `jEditor ${pkgVersion}`, v.title);
        await page.close();
    }

    // ---- 2. Sort + selection identity ----
    console.log('sort & selection identity');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            // Tiny real PNG so thumbnail loading works without errors
            const canvas = document.createElement('canvas');
            canvas.width = 2; canvas.height = 1;
            const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
            const png = new Uint8Array(await blob.arrayBuffer());

            app.files = [
                makeFakeFile('b.png', png, 'image/png', 200, 2000),
                makeFakeFile('a.png', png, 'image/png', 300, 1000),
                makeFakeFile('c.png', png, 'image/png', 100, 3000)
            ];
            const [b, a, c] = app.files;
            app.currentFile = b;
            app.selection = new Set([b, c]);
            app.renderGrid();
            app.renderThumbnails();

            const sel = document.getElementById('sort-mode');
            sel.value = 'size_asc';
            sel.dispatchEvent(new Event('change'));

            const gridClasses = [...document.getElementById('grid-view').children].map(el =>
                `${el._file.name}:${el.classList.contains('selected') ? 'S' : '-'}${el.classList.contains('active') ? 'A' : '-'}`);

            return {
                order: app.files.map(f => f.name).join(','),
                current: app.currentFile.name,
                selection: [...app.selection].map(f => f.name).sort().join(','),
                gridClasses: gridClasses.join(' ')
            };
        });
        check('size sort order', r.order === 'c.png,b.png,a.png', r.order);
        check('current photo follows sort', r.current === 'b.png', r.current);
        check('selection follows sort', r.selection === 'b.png,c.png', r.selection);
        check('grid classes track files', r.gridClasses === 'c.png:S- b.png:SA a.png:--', r.gridClasses);
        await page.close();
    }

    // ---- 3. EXIF orientation unit tests ----
    console.log('EXIF orientation');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            // Four CW quarter turns must return to the start for all 8 values
            out.groupCycles = [1, 2, 3, 4, 5, 6, 7, 8].every(o => {
                let x = o;
                for (let i = 0; i < 4; i++) x = app.composeOrientation(x, 90);
                return x === o;
            });
            out.cw = [app.composeOrientation(1, 90), app.composeOrientation(6, 90), app.composeOrientation(3, 90)].join(',');
            out.ccw = app.composeOrientation(1, -90);
            out.r180 = app.composeOrientation(1, 180);

            // Patch path: JPEG with EXIF orientation 3 rotated CW -> 8
            const withExif = makeJpegBytes([app.buildOrientationExif(3)]);
            const patched = app.rotateJpegLossless(new Uint8Array(withExif).buffer, 90);
            out.patched = readOrientation(new Uint8Array(await patched.arrayBuffer()));

            // Insert path: JPEG without EXIF gets a new APP1 with orientation 6
            const bare = makeJpegBytes();
            const inserted = app.rotateJpegLossless(new Uint8Array(bare).buffer, 90);
            const insertedBytes = new Uint8Array(await inserted.arrayBuffer());
            out.inserted = readOrientation(insertedBytes);
            out.insertedStillJpeg = insertedBytes[0] === 0xFF && insertedBytes[1] === 0xD8;
            return out;
        });
        check('orientation group cycles (4×90° = identity)', r.groupCycles);
        check('CW composition 1→6→3→8', r.cw === '6,3,8', r.cw);
        check('CCW composition 1→8', r.ccw === 8, String(r.ccw));
        check('180° composition 1→3', r.r180 === 3, String(r.r180));
        check('patches existing EXIF orientation (3 + 90° = 8)', r.patched === 8, String(r.patched));
        check('inserts EXIF into bare JPEG (orientation 6)', r.inserted === 6, String(r.inserted));
        check('inserted file still starts with SOI', r.insertedStillJpeg);
        await page.close();
    }

    // ---- 4. Lossless rotation end-to-end + bulk race regression ----
    console.log('rotation pipeline');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const jpegA = makeFakeFile('a.jpg', makeJpegBytes(), 'image/jpeg');
            const jpegB = makeFakeFile('b.jpg', makeJpegBytes(), 'image/jpeg');
            app.files = [jpegA, jpegB];
            app.viewMode = 'grid';
            app.dirHandle = null;

            // Single lossless rotation
            await app.rotateImage(jpegA, 90, true);
            out.aOrientation = readOrientation(jpegA.handle.bytes);
            out.aWrites = jpegA.handle.writes;
            out.aType = jpegA.handle.writtenType;
            out.aSizeUpdated = jpegA.size === jpegA.handle.bytes.length;

            // Race regression: selecting another photo mid-bulk-rotate must NOT rotate it
            app.selection = new Set([jpegA]);
            const pending = app.rotateBulk(90);
            app.selection.clear();
            app.selection.add(jpegB); // simulates clicking another photo while rotating
            await pending;
            out.bWrites = jpegB.handle.writes;
            out.aWritesAfterBulk = jpegA.handle.writes;
            out.loadingHidden = document.getElementById('loading-indicator').classList.contains('hidden');
            return out;
        });
        check('JPEG rotated losslessly via EXIF (orientation 6)', r.aOrientation === 6, String(r.aOrientation));
        check('written as image/jpeg', r.aType === 'image/jpeg', String(r.aType));
        check('sort metadata refreshed after save', r.aSizeUpdated);
        check('bulk rotate: photo clicked mid-rotation is untouched', r.bWrites === 0, `writes=${r.bWrites}`);
        check('bulk rotate: selected photo was rotated', r.aWritesAfterBulk === 2, `writes=${r.aWritesAfterBulk}`);
        check('loading indicator cleared', r.loadingHidden);
        await page.close();
    }

    // ---- 4b. Snappy previews: instant stacking, background saves, no re-decode ----
    console.log('instant previews & stacking');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const f = makeFakeFile('stack.jpg', makeJpegBytes(), 'image/jpeg');
            app.files = [f];
            app.viewMode = 'grid';
            app.dirHandle = null;

            // Two rapid clicks: preview must show 180° immediately, before any save lands
            const p1 = app.rotateImage(f, 90);
            const p2 = app.rotateImage(f, 90);
            out.instantPreview = app.getDisplayRotation(f, 'thumb');
            await Promise.all([p1, p2]);
            out.diskOrientation = readOrientation(f.handle.bytes);     // 1 +90 +90 → 3
            out.previewAfterSave = app.getDisplayRotation(f, 'thumb'); // still 180 via lag
            out.lag = f.thumbLag;
            out.settled = (f.pendingRotation || 0) === 0 && (f.savingRotation || 0) === 0;

            // Right then left cancels out on screen instantly and nets zero on disk
            const g = makeFakeFile('netzero.jpg', makeJpegBytes(), 'image/jpeg');
            app.files = [f, g];
            const q = app.rotateImage(g, 90);
            app.rotateImage(g, -90);
            out.netZeroInstant = app.getDisplayRotation(g, 'thumb');
            await q;
            out.netZeroDisk = readOrientation(g.handle.bytes); // 6 then back to 1
            out.netZeroPreview = app.getDisplayRotation(g, 'thumb');
            return out;
        });
        check('two quick rotates preview 180° instantly', r.instantPreview === 180, String(r.instantPreview));
        check('disk lands at orientation 3 (180°)', r.diskOrientation === 3, String(r.diskOrientation));
        check('preview unchanged after save (no reload)', r.previewAfterSave === 180 && r.lag === 180, `${r.previewAfterSave}/${r.lag}`);
        check('queue fully drained', r.settled);
        check('right+left cancels instantly on screen', r.netZeroInstant === 0, String(r.netZeroInstant));
        check('right+left nets zero on disk', r.netZeroDisk === 1 && r.netZeroPreview === 0, `${r.netZeroDisk}/${r.netZeroPreview}`);
        await page.close();
    }

    // ---- 4c. Stacked toasts ----
    console.log('stacked toasts');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            app.showToast('Rotating 3 photos…', 0, 'op1');
            app.showToast('Rotating 5 photos…', 0, 'op2');
            const stacked = document.querySelectorAll('#toast-stack .toast').length;
            const texts = [...document.querySelectorAll('#toast-stack .toast')].map(t => t.textContent);
            app.showToast('Rotated 3 photos', 60, 'op1'); // update in place, then auto-dismiss
            const stillStacked = document.querySelectorAll('#toast-stack .toast').length;
            const updatedText = document.querySelector('#toast-stack [data-key="op1"]').textContent;
            await new Promise(r => setTimeout(r, 600));
            const afterDismiss = document.querySelectorAll('#toast-stack .toast').length;
            return { stacked, texts, stillStacked, updatedText, afterDismiss };
        });
        check('two concurrent operations stack', r.stacked === 2, JSON.stringify(r.texts));
        check('progress toast updates in place', r.stillStacked === 2 && r.updatedText === 'Rotated 3 photos', r.updatedText);
        check('finished toast dismisses, sticky one stays', r.afterDismiss === 1, String(r.afterDismiss));
        await page.close();
    }

    // ---- 5. Non-JPEG fallback: PNG re-encode preserves type, swaps dimensions ----
    console.log('PNG rotation fallback');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 2; canvas.height = 1;
            const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
            const png = new Uint8Array(await blob.arrayBuffer());
            const file = makeFakeFile('p.png', png, 'image/png');
            app.files = [file];
            app.viewMode = 'grid';
            app.dirHandle = null;

            await app.rotateImage(file, 90, true);
            const bitmap = await createImageBitmap(new Blob([file.handle.bytes]));
            const gif = makeFakeFile('g.gif', png, 'image/gif');
            await app.rotateImage(gif, 90, true);
            return {
                type: file.handle.writtenType,
                dims: `${bitmap.width}x${bitmap.height}`,
                gifWrites: gif.handle.writes
            };
        });
        check('PNG stays PNG', r.type === 'image/png', String(r.type));
        check('dimensions swapped (2x1 → 1x2)', r.dims === '1x2', r.dims);
        check('GIF rotation refused (would lose animation)', r.gifWrites === 0, `writes=${r.gifWrites}`);
        await page.close();
    }

    // ---- 5a. File info: status chip, info panel, EXIF metadata ----
    console.log('file info');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};

            // Build a JPEG with a full EXIF block: Make, ExifIFD → DateTimeOriginal
            const buildExifJpeg = (make, dateStr) => {
                const makeBytes = [...make].map(c => c.charCodeAt(0)).concat([0]);
                const dateBytes = [...dateStr].map(c => c.charCodeAt(0)).concat([0]); // 20 bytes
                const makeOff = 38;                       // after header+IFD0
                const exifIfdOff = makeOff + makeBytes.length;
                const dateOff = exifIfdOff + 2 + 12 + 4;
                const tiffLen = dateOff + dateBytes.length;
                const buf = new ArrayBuffer(tiffLen);
                const v = new DataView(buf);
                v.setUint16(0, 0x4D4D);                   // big-endian
                v.setUint16(2, 0x002A);
                v.setUint32(4, 8);                        // IFD0 at 8
                v.setUint16(8, 2);                        // 2 entries
                let e = 10;
                v.setUint16(e, 0x010F); v.setUint16(e + 2, 2); // Make, ASCII
                v.setUint32(e + 4, makeBytes.length); v.setUint32(e + 8, makeOff);
                e += 12;
                v.setUint16(e, 0x8769); v.setUint16(e + 2, 4); // ExifIFD pointer, LONG
                v.setUint32(e + 4, 1); v.setUint32(e + 8, exifIfdOff);
                v.setUint32(e + 12, 0);                   // next IFD
                makeBytes.forEach((b, i) => v.setUint8(makeOff + i, b));
                v.setUint16(exifIfdOff, 1);               // ExifIFD: 1 entry
                const d = exifIfdOff + 2;
                v.setUint16(d, 0x9003); v.setUint16(d + 2, 2); // DateTimeOriginal, ASCII
                v.setUint32(d + 4, dateBytes.length); v.setUint32(d + 8, dateOff);
                v.setUint32(d + 12, 0);
                dateBytes.forEach((b, i) => v.setUint8(dateOff + i, b));

                const tiff = new Uint8Array(buf);
                const payloadLen = 6 + tiff.length;
                const seg = [0xFF, 0xE1, (payloadLen + 2) >> 8, (payloadLen + 2) & 0xFF,
                    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
                return [0xFF, 0xD8, ...seg, 0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9];
            };

            const jpegBytes = buildExifJpeg('TestCam Inc.', '2024:06:15 13:45:00');
            const info = app.readJpegExifInfo(new Uint8Array(jpegBytes).buffer);
            out.make = info && info.make;
            out.taken = info && info.dateTaken &&
                `${info.dateTaken.getFullYear()}-${info.dateTaken.getMonth() + 1}-${info.dateTaken.getDate()}`;

            // Status chip shows location + name for the current file
            const canvas = document.createElement('canvas');
            canvas.width = 4; canvas.height = 4;
            const png = new Uint8Array(await (await new Promise(res => canvas.toBlob(res, 'image/png'))).arrayBuffer());
            const file = makeFakeFile('photo.png', png, 'image/png');
            file.relPath = 'vacation/photo.png';
            app.dirHandle = { name: 'Photos' };
            app.files = [file];
            document.getElementById('main-interface').classList.remove('hidden');
            await app.loadFile(file);
            const chip = document.getElementById('status-bar');
            out.chipVisible = !chip.classList.contains('hidden');
            out.chipText = chip.textContent;

            // Info panel opens and lists name + formatted size
            app.toggleInfoPanel(true);
            await new Promise(r => setTimeout(r, 200));
            out.panelOpen = !document.getElementById('info-panel').classList.contains('hidden');
            out.panelText = document.getElementById('info-list').textContent;
            return out;
        });
        check('EXIF Make parsed', r.make === 'TestCam Inc.', String(r.make));
        check('EXIF DateTimeOriginal parsed', r.taken === '2024-6-15', String(r.taken));
        check('status chip visible with full path', r.chipVisible && r.chipText === 'Photos/vacation/photo.png', r.chipText);
        check('info panel opens', r.panelOpen);
        check('info panel lists name, location and size', r.panelText.includes('photo.png') &&
            r.panelText.includes('Photos/vacation') && /\d+ B|KB|MB/.test(r.panelText), r.panelText);
        await page.close();
    }

    // ---- 5b. Thumbnail pipeline: worker generation, caching, precache ----
    console.log('thumbnail pipeline');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};

            // Noisy PNG well above the fast-path threshold forces real generation
            const canvas = document.createElement('canvas');
            canvas.width = 900; canvas.height = 600;
            const ctx = canvas.getContext('2d');
            const noise = ctx.createImageData(900, 600);
            for (let i = 0; i < noise.data.length; i++) noise.data[i] = (Math.random() * 256) | 0;
            ctx.putImageData(noise, 0, 0);
            const big = await new Promise(res => canvas.toBlob(res, 'image/png'));
            out.originalSize = big.size;
            const bytes = new Uint8Array(await big.arrayBuffer());

            const file = makeFakeFile('big.png', bytes, 'image/png');
            app.files = [file];

            out.workerAvailable = !!app.getThumbWorker();

            const url = await app.ensureThumbnail(file, { urgent: true });
            out.urlSet = file.thumbnailUrl === url && url.startsWith('blob:');
            const thumb = await (await fetch(url)).blob();
            out.thumbSize = thumb.size;
            out.thumbType = thumb.type;
            const bmp = await createImageBitmap(thumb);
            out.thumbWidth = bmp.width;

            // Cache hit: same URL, resolved instantly
            out.cached = (await app.ensureThumbnail(file, { urgent: true })) === url;

            // Precache generates the rest in the background
            const file2 = makeFakeFile('big2.png', bytes, 'image/png');
            app.files = [file, file2];
            app.precacheThumbnails();
            await app.ensureThumbnail(file2, {});
            out.precached = !!file2.thumbnailUrl;

            // Grid re-render paints cached thumbs synchronously (no observer round-trip)
            app.renderGrid();
            const tileImgs = [...document.querySelectorAll('#grid-view .grid-item img')];
            out.instantPaint = tileImgs.every(img => img.src.startsWith('blob:'));
            out.cachedNoSpinner = !document.querySelector('#grid-view .grid-item.thumb-loading');

            // A tile still waiting shows a spinner until its picture loads
            // (on screen: lazy tiles in a hidden grid don't load)
            document.getElementById('main-interface').classList.remove('hidden');
            document.getElementById('grid-view').classList.remove('hidden');
            const file3 = makeFakeFile('big3.png', bytes, 'image/png');
            app.files = [file, file2, file3];
            app.renderGrid();
            const tile3 = file3._gridEl;
            out.spinnerWhileLoading = tile3.classList.contains('thumb-loading');
            await app.loadImageThumbnail(file3, tile3.querySelector('img'));
            for (let i = 0; i < 50 && tile3.classList.contains('thumb-loading'); i++) await new Promise(r => setTimeout(r, 20));
            out.spinnerCleared = !tile3.classList.contains('thumb-loading');
            return out;
        });
        check('worker available (off-main-thread generation)', r.workerAvailable);
        check('thumbnail downscaled to 320px', r.thumbWidth === 320, String(r.thumbWidth));
        check('thumbnail much smaller than original', r.thumbSize < r.originalSize / 3, `${r.thumbSize} vs ${r.originalSize}`);
        check('PNG stays PNG (transparency-safe)', r.thumbType === 'image/png', r.thumbType);
        check('second request is a cache hit', r.cached && r.urlSet);
        check('precache fills remaining files', r.precached);
        check('re-render paints cached thumbs immediately', r.instantPaint);
        check('cached tiles show no loading spinner', r.cachedNoSpinner);
        check('loading tile shows a spinner, cleared once its thumbnail loads', r.spinnerWhileLoading && r.spinnerCleared,
            `${r.spinnerWhileLoading}/${r.spinnerCleared}`);
        await page.close();
    }

    // ---- 5c. Triage suite: undo, trash, rename, sort persistence, menus ----
    console.log('triage suite');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            document.getElementById('main-interface').classList.remove('hidden');

            // --- Undo a rotation ---
            const a = makeFakeFile('a.jpg', makeJpegBytes(), 'image/jpeg');
            const originalLen = a.handle.bytes.length;
            app.files = [a];
            app.viewMode = 'grid';
            app.dirHandle = null;
            await app.rotateImage(a, 90);
            out.rotated = readOrientation(a.handle.bytes) === 6;
            const top = app._undoStack[app._undoStack.length - 1];
            out.noCopyKept = top.type === 'rotate' && !top.blob && top.deg === 90;
            await app.undo();
            out.undoneOrientation = readOrientation(a.handle.bytes); // rotated back: upright (1)
            out.undoNotStacked = app._undoStack.length === 0;        // the reverse isn't itself undoable

            // Re-encoded rotations (PNG) keep the original bytes and restore them exactly
            const pc = document.createElement('canvas');
            pc.width = 3; pc.height = 2;
            const pngBytes = new Uint8Array(await (await new Promise(res => pc.toBlob(res, 'image/png'))).arrayBuffer());
            const pf = makeFakeFile('p.png', pngBytes, 'image/png');
            app.files = [a, pf];
            await app.rotateImage(pf, 90);
            await app.undo();
            out.pngRestored = pf.handle.bytes.length === pngBytes.length && pf.handle.bytes.every((v, i) => v === pngBytes[i]);

            // Undo memory is capped: big file copies push old ones out
            const savedCap = app.UNDO_MAX_BYTES;
            app.UNDO_MAX_BYTES = 1000;
            app._undoStack = [];
            for (let i = 0; i < 5; i++) app.pushUndo({ type: 'bytes', file: pf, blob: new Blob([new Uint8Array(400)]) });
            app.pushUndo({ type: 'rotate', file: a, deg: 90 });
            out.undoCapped = app.undoBytes() <= 1000 && app._undoStack.length < 6 &&
                app._undoStack[app._undoStack.length - 1].type === 'rotate';
            app.UNDO_MAX_BYTES = savedCap;
            app._undoStack = [];
            app.files = [a];

            // --- Trash + restore ---
            const root = makeDir('Photos');
            const f1 = makeFakeFile('one.jpg', makeJpegBytes(), 'image/jpeg');
            const f2 = makeFakeFile('two.jpg', makeJpegBytes(), 'image/jpeg');
            f1.parentDir = root; f2.parentDir = root;
            root._files.set('one.jpg', f1.handle);
            root._files.set('two.jpg', f2.handle);
            app.dirHandle = root;
            app.files = [f1, f2];
            app.currentFile = f1;
            await app.moveToTrash([f1]);
            const trash = await (await root.getDirectoryHandle('.jeditor')).getDirectoryHandle('trash');
            out.trashedCount = app.files.length;                    // 1
            out.inTrash = trash._files.size;                        // 1
            out.removedFromRoot = !root._files.has('one.jpg');
            await app.undo();
            out.restoredCount = app.files.length;                   // 2
            out.trashEmpty = trash._files.size === 0;
            out.backInRoot = root._files.has('one.jpg');

            // --- Batch rename + undo ---
            // move() renames the directory entry too, like the real FS API
            const mkMove = (h) => async function (n) {
                root._files.delete(this.name);
                this.name = n;
                root._files.set(n, this);
            };
            f1.handle.move = mkMove(f1.handle);
            f2.handle.move = mkMove(f2.handle);
            Renamer.open(app, [f1, f2]);
            Renamer.mode = 'new';
            document.getElementById('rename-pattern').value = 'trip_{#}';
            document.getElementById('rename-order').value = 'name';
            await Renamer.refresh();
            await Renamer.apply();
            out.renamed = app.files.map(f => f.name).sort().join(',');
            await app.undo();
            out.renameUndone = app.files.map(f => f.name).sort().join(',');

            // --- Sort persistence ---
            localStorage.removeItem('jeditor.sortMode');
            const sel = document.getElementById('sort-mode');
            sel.value = 'size_desc';
            sel.dispatchEvent(new Event('change'));
            await new Promise(r2 => setTimeout(r2, 50));
            out.persisted = localStorage.getItem('jeditor.sortMode');

            // --- Capture-date sort ---
            f1.dateTaken = new Date(2020, 0, 1).getTime();
            f2.dateTaken = new Date(2024, 0, 1).getTime();
            app.sortMode = 'taken_desc';
            app.sortFiles(false);
            out.takenOrder = app.files.map(f => f.name).join(',');

            // --- Export copies (original size) ---
            window.prompt = () => '';
            await app.exportCopies([f2]);
            const exp = await root.getDirectoryHandle('jEditor Export');
            out.exported = exp._files.size === 1;

            // --- Context menu ---
            let clicked = false;
            app.openContextMenu([['Do Thing', () => { clicked = true; }], ['—'], ['Other', () => { }]], 20, 20);
            const menu = document.getElementById('context-menu');
            out.menuButtons = menu.querySelectorAll('button').length;   // 2
            out.menuDividers = menu.querySelectorAll('.ctx-divider').length; // 1
            menu.querySelector('button').click();
            out.menuActionRan = clicked;
            out.menuClosed = !document.getElementById('context-menu');

            // --- Ctrl+wheel grid zoom ---
            const before = document.getElementById('grid-size-slider').value;
            document.getElementById('grid-view').dispatchEvent(
                new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true }));
            out.zoomChanged = document.getElementById('grid-size-slider').value !== before;

            return out;
        });
        check('JPEG rotation undone by rotating back (no file copy held)', r.rotated && r.noCopyKept && r.undoneOrientation === 1 && r.undoNotStacked,
            JSON.stringify({ copy: r.noCopyKept, o: r.undoneOrientation, stacked: !r.undoNotStacked }));
        check('re-encoded rotation undo restores the exact bytes', r.pngRestored);
        check('undo memory is capped', r.undoCapped);
        check('trash removes from folder and app', r.trashedCount === 1 && r.inTrash === 1 && r.removedFromRoot);
        check('undo restores from trash', r.restoredCount === 2 && r.trashEmpty && r.backInRoot);
        check('batch rename applies pattern', r.renamed === 'trip_1.jpg,trip_2.jpg', r.renamed);
        check('batch rename undo restores names', r.renameUndone === 'one.jpg,two.jpg', r.renameUndone);
        check('sort mode persisted to localStorage', r.persisted === 'size_desc', String(r.persisted));
        check('capture-date sort orders by dateTaken', r.takenOrder === 'two.jpg,one.jpg', r.takenOrder);
        check('export writes a copy to jEditor Export', r.exported);
        check('context menu renders and runs actions', r.menuButtons === 2 && r.menuDividers === 1 && r.menuActionRan && r.menuClosed);
        check('ctrl+wheel zooms the grid', r.zoomChanged);
        await page.close();
    }

    // ---- 5d. UI customization, task pill, strip/status layout ----
    console.log('UI customization & task pill');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            localStorage.removeItem('jeditor.ui');

            // Default pill: info, view, refresh, crop visible; rest in "More"
            const hc = document.getElementById('header-controls');
            const visible = [...hc.querySelectorAll('[data-hc]')]
                .filter(b => !b.classList.contains('hc-extra') && !b.classList.contains('hidden'))
                .map(b => b.dataset.hc);
            out.defaultMain = visible.join(',');
            const extras = [...hc.querySelectorAll('.hc-extra')].map(b => b.dataset.hc);
            out.defaultExtras = extras.join(',');
            out.extrasHiddenCollapsed = getComputedStyle(document.getElementById('btn-toggle-fit')).display === 'none';
            document.getElementById('btn-more').click();
            out.extrasShownExpanded = getComputedStyle(document.getElementById('btn-toggle-fit')).display !== 'none';

            // Placement + order + vertical + scale via prefs
            app.uiPrefs.placement.fullscreen = 'main';
            app.uiPrefs.placement.refresh = 'hidden';
            app.uiPrefs.order = ['crop', 'info', 'view', 'refresh', 'fit', 'strip', 'fullscreen', 'customize'];
            app.uiPrefs.vertical = true;
            app.uiPrefs.scale = 1.2;
            app.saveUiPrefs();
            app.applyUiPrefs();
            out.reordered = [...hc.querySelectorAll('[data-hc]')].map(b => b.dataset.hc).slice(0, 2).join(',');
            out.refreshHidden = document.getElementById('btn-refresh').classList.contains('hidden');
            out.fullscreenMain = !document.getElementById('btn-fullscreen').classList.contains('hc-extra');
            out.vertical = hc.classList.contains('vertical');
            out.persisted = JSON.parse(localStorage.getItem('jeditor.ui')).scale === 1.2;
            out.scaleApplied = getComputedStyle(hc).zoom;

            // Thumbnail fit contain by default
            localStorage.removeItem('jeditor.ui');
            app.loadUiPrefs();
            app.applyUiPrefs();
            out.containDefault = document.getElementById('grid-view').classList.contains('thumb-contain');

            // Strip height + in-flow status bar (no overlap possible)
            app.setStripHeight(120);
            out.stripVar = getComputedStyle(document.documentElement).getPropertyValue('--strip-height').trim();
            out.statusInFlow = ['static', 'relative'].includes(getComputedStyle(document.getElementById('status-bar')).position);

            // Info icon actually has its dot
            out.infoDot = document.getElementById('btn-info').innerHTML.includes('cy="8"');

            // Task pill: current task + hover list, stacking
            app.beginTask('t1', 'Rotating 3 photos…');
            app.beginTask('t2', 'Exporting 2/5');
            const pill = document.getElementById('loading-indicator');
            out.pillVisible = !pill.classList.contains('hidden');
            out.pillLabel = document.getElementById('loading-text').textContent;
            out.taskRows = document.querySelectorAll('#task-list .task-row').length;
            app.endTask('t1');
            out.afterOneEnd = document.getElementById('loading-text').textContent;
            // Readable whatever the photo looks like (it sits beside the photo)
            const contrast = () => {
                const cs = getComputedStyle(pill);
                const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]; };
                return Math.abs(lum(cs.backgroundColor) - lum(cs.color));
            };
            document.body.classList.add('light-theme', 'glass-light-top');
            out.pillContrastLight = contrast();
            document.body.classList.remove('light-theme', 'glass-light-top');
            out.pillContrastDark = contrast();
            app.endTask('t2');
            out.pillHidden = pill.classList.contains('hidden');
            return out;
        });
        check('default main controls: info, view, refresh, crop', r.defaultMain === 'info,view,refresh,crop', r.defaultMain);
        check('extras live in More (fit, strip, fullscreen, dupes, keys, customize)', r.defaultExtras === 'fit,strip,fullscreen,dupes,keys,customize', r.defaultExtras);
        check('More expander shows/hides extras', r.extrasHiddenCollapsed && r.extrasShownExpanded);
        check('reorder + hide + promote via prefs', r.reordered === 'crop,info' && r.refreshHidden && r.fullscreenMain,
            JSON.stringify({ o: r.reordered, h: r.refreshHidden, f: r.fullscreenMain }));
        check('vertical pill + scale + persistence', r.vertical && r.persisted && parseFloat(r.scaleApplied) === 1.2,
            JSON.stringify({ v: r.vertical, p: r.persisted, z: r.scaleApplied }));
        check('thumbnail fit (contain) on by default', r.containDefault);
        check('strip height adjustable, status bar in flow below strip', r.stripVar === '120px' && r.statusInFlow,
            JSON.stringify({ s: r.stripVar, flow: r.statusInFlow }));
        check('info icon has its dot', r.infoDot);
        check('task pill shows current task with count', r.pillVisible && r.pillLabel === 'Exporting 2/5 (+1)' && r.taskRows === 2,
            JSON.stringify({ l: r.pillLabel, rows: r.taskRows }));
        check('task pill readable over light and dark photos', r.pillContrastLight > 150 && r.pillContrastDark > 150,
            JSON.stringify({ light: r.pillContrastLight, dark: r.pillContrastDark }));
        check('task pill updates and clears', r.afterOneEnd === 'Exporting 2/5' && r.pillHidden,
            JSON.stringify({ a: r.afterOneEnd, hid: r.pillHidden }));
        await page.close();
    }

    // ---- 6. Adaptive glass: regions follow their own background band ----
    console.log('adaptive glass');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const makeImg = (topColor, bottomColor) => new Promise(res => {
                const canvas = document.createElement('canvas');
                canvas.width = 50; canvas.height = 50;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = topColor; ctx.fillRect(0, 0, 50, 25);
                ctx.fillStyle = bottomColor; ctx.fillRect(0, 25, 50, 25);
                const img = new Image();
                img.onload = () => res(img);
                img.src = canvas.toDataURL();
            });

            const cls = () => ['glass-light-top', 'glass-light-bottom']
                .map(c => document.body.classList.contains(c) ? '1' : '0').join('');

            app.analyzeImageBrightness(await makeImg('#111', '#fff'));
            const darkTopBrightBottom = cls();
            app.analyzeImageBrightness(await makeImg('#fff', '#111'));
            const brightTopDarkBottom = cls();
            app.analyzeImageBrightness(await makeImg('#111', '#111'));
            const allDark = cls();
            return { darkTopBrightBottom, brightTopDarkBottom, allDark };
        });
        check('bright bottom → light glass only at bottom', r.darkTopBrightBottom === '01', r.darkTopBrightBottom);
        check('bright top → light glass only at top', r.brightTopDarkBottom === '10', r.brightTopDarkBottom);
        check('dark photo → dark glass everywhere', r.allDark === '00', r.allDark);
        await page.close();
    }

    // ---- 7a. Lossless rotation for scanner JPEGs (EXIF without Orientation) ----
    console.log('lossless rotation: EXIF without orientation');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const jpeg = await makeRealJpeg(40, 20, { exif: true });
            const blob = app.rotateJpegLossless(jpeg.buffer.slice(0), 90);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            out.orientation = readOrientation(bytes);
            const info = app.readJpegExifInfo(bytes.buffer);
            out.make = info && info.make;
            out.taken = !!(info && info.dateTaken);
            // Compressed image data is untouched (lossless)
            const tail = (b) => { const s = ImageMeta.jpegSegments(b); return b.subarray(s[s.length - 1].start); };
            const a = tail(jpeg), b = tail(bytes);
            out.sameData = a.length === b.length && a.every((v, i) => v === b[i]);
            const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
            out.dims = `${bmp.width}x${bmp.height}`;
            // XMP tiff:Orientation follows the EXIF value
            const xmp = await makeRealJpeg(40, 20, { xmpOrientation: 1 });
            const xb = new Uint8Array(await app.rotateJpegLossless(xmp.buffer.slice(0), 90).arrayBuffer());
            out.xmp = /tiff:Orientation="6"/.test(new TextDecoder('latin1').decode(xb));

            // A file that already has an orientation tag is rotated by
            // writing just those bytes in place (plus the XMP digit)
            const tagged = await makeRealJpeg(40, 20, { exif: true, xmpOrientation: 1 });
            const tf = makeFakeFile('t.jpg', tagged, 'image/jpeg');
            app.files = [tf];
            app.dirHandle = null;
            await app.rotateImage(tf, 90);                 // adds the tag: full rewrite
            const afterFirst = new Uint8Array(tf.handle.bytes);
            await app.rotateImage(tf, 90);                 // tag exists: in place
            const afterSecond = tf.handle.bytes;
            const diff = [];
            for (let i = 0; i < afterSecond.length; i++) if (afterFirst[i] !== afterSecond[i]) diff.push(i);
            out.inPlace = tf.handle.inPlaceWrites >= 1 && afterSecond.length === afterFirst.length &&
                diff.length <= 3 && readOrientation(afterSecond) === 3 &&
                /tiff:Orientation="3"/.test(new TextDecoder('latin1').decode(afterSecond));

            // A CMYK original's ICC profile must not be carried onto RGB output
            const cmyk = await makeRealJpeg(40, 20, { icc: true });
            const sof = ImageMeta.jpegSegments(cmyk).find(sg => sg.marker === 0xC0);
            cmyk[sof.start + 9] = 4; // header now says 4 components (parse-level test)
            const fresh = new Blob([await makeRealJpeg(40, 20, {})], { type: 'image/jpeg' });
            const moved = new Uint8Array(await (await ImageMeta.transplant(cmyk, fresh, 'image/jpeg', 40, 20)).arrayBuffer());
            out.cmykSafe = !ImageMeta.canCarryProfile('image/jpeg', cmyk) && !ImageMeta.hasJpegIcc(moved) &&
                ImageMeta.canCarryProfile('image/jpeg', await makeRealJpeg(40, 20, { icc: true }));
            return out;
        });
        check('orientation tag added to existing EXIF (6)', r.orientation === 6, String(r.orientation));
        check('other EXIF survives (Make, DateTimeOriginal)', r.make === 'TestCam' && r.taken, String(r.make));
        check('compressed image data byte-identical', r.sameData);
        check('browser shows it rotated (40x20 → 20x40)', r.dims === '20x40', r.dims);
        check('XMP orientation kept in agreement', r.xmp);
        check('CMYK colour profile not copied onto RGB output', r.cmykSafe);
        check('second rotation writes only the orientation bytes in place', r.inPlace);
        await page.close();
    }

    // ---- 7b. Crop & Straighten editor ----
    console.log('crop & straighten');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const ed = CropEditor;
            const open = async (file) => {
                app.files = [file];
                app.currentFile = file;
                app.viewMode = 'single';
                document.getElementById('main-interface').classList.remove('hidden');
                await app.enterCrop();
            };

            // Regression: rotate, then crop — the crop must keep the rotation
            const src = await makeRealJpeg(400, 200, { exif: true, dpi: 300, icc: true });
            const f = makeFakeFile('scan.jpg', src, 'image/jpeg');
            app.dirHandle = null;
            await app.rotateImage(f, 90);
            await open(f);
            out.editorDims = `${ed.W}x${ed.H}`;
            ed.setRect({ x0: -100, y0: -200, x1: 50, y1: 200 });
            await app.saveCrop();
            const saved = new Uint8Array(f.handle.bytes);
            const bmp = await createImageBitmap(new Blob([saved], { type: 'image/jpeg' }));
            out.savedDims = `${bmp.width}x${bmp.height}`;
            out.closed = !ed.isOpen && !app.cropState.active;

            // Metadata survives the re-encode
            const info = app.readJpegExifInfo(saved.buffer);
            out.make = info && info.make;
            out.taken = !!(info && info.dateTaken);
            const dpi = ImageMeta.readDpi(saved);
            out.dpi = dpi && Math.round(dpi.x);
            out.icc = ImageMeta.hasJpegIcc(saved);
            out.orientationReset = readOrientation(saved);

            // Undo brings the original (rotated) bytes back
            await app.undo();
            out.undone = readOrientation(f.handle.bytes) === 6;

            // Straighten: corners of the result are image, never empty
            const g = makeFakeFile('red.jpg', await makeRealJpeg(400, 300, { color: '#ff0000' }), 'image/jpeg');
            await open(g);
            ed.setAngle(7);
            out.fitsAt7 = CropGeom.fits(ed.rect, ed.W, ed.H, ed.cs(), 0);
            await app.saveCrop();
            const rb = await createImageBitmap(new Blob([g.handle.bytes], { type: 'image/jpeg' }));
            const c = document.createElement('canvas');
            c.width = rb.width; c.height = rb.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(rb, 0, 0);
            const px = (x, y) => ctx.getImageData(x, y, 1, 1).data;
            out.cornersRed = [[0, 0], [rb.width - 1, 0], [0, rb.height - 1], [rb.width - 1, rb.height - 1]]
                .every(([x, y]) => { const d = px(x, y); return d[0] > 200 && d[1] < 70 && d[2] < 70; });
            out.straightenedSmaller = rb.width < 400 && rb.height < 300;

            // Rotating the angle back restores what was drawn
            const h = makeFakeFile('back.jpg', await makeRealJpeg(400, 300, {}), 'image/jpeg');
            await open(h);
            const full = { ...ed.rect };
            ed.setAngle(12);
            const shrunk = ed.rect.x1 - ed.rect.x0 < full.x1 - full.x0;
            ed.setAngle(0);
            out.angleRoundTrip = shrunk && Math.abs(ed.rect.x0 - full.x0) < 1e-6 && Math.abs(ed.rect.y1 - full.y1) < 1e-6;

            // Aspect preset: 8×10 on a landscape photo → 5:4
            ed.setAspect('4:5');
            const o = ed.outputRect();
            out.aspect = o.w / o.h;
            ed.swapOrientation();
            const o2 = ed.outputRect();
            out.swapped = o2.w / o2.h;
            ed.setAspect('free');
            ed.selectAll();

            // Level tool: a line 10% off horizontal levels to −5.71°
            out.level = ed.levelAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
            out.plumb = ed.levelAngle({ x: 0, y: 0 }, { x: 5, y: 100 });

            // Quarter turn only → lossless EXIF rotation, not a re-encode
            ed.rotateQuarter(1);
            await app.saveCrop();
            await new Promise(res => setTimeout(res, 100));
            out.quarterLossless = readOrientation(h.handle.bytes) === 6;

            // "Previous" reapplies the last crop
            const k = makeFakeFile('k.jpg', await makeRealJpeg(400, 300, {}), 'image/jpeg');
            await open(k);
            ed.setRect({ x0: -150, y0: -100, x1: 50, y1: 100 });
            app.rememberCrop(ed.snapshot());
            ed.reset();
            ed.usePrevious();
            out.previous = Math.abs(ed.rect.x0 + 150) < 1e-6 && Math.abs(ed.rect.x1 - 50) < 1e-6;
            app.cancelCrop();

            // Save & Next opens the editor on the following photo
            const n1 = makeFakeFile('n1.jpg', await makeRealJpeg(300, 200, {}), 'image/jpeg');
            const n2 = makeFakeFile('n2.jpg', await makeRealJpeg(300, 200, {}), 'image/jpeg');
            app.files = [n1, n2];
            app.currentFile = n1;
            await app.enterCrop();
            ed.setRect({ x0: -100, y0: -50, x1: 100, y1: 50 });
            await app.saveCrop({ next: true });
            for (let i = 0; i < 100 && !(ed.ready && ed.file === n2); i++) await new Promise(res => setTimeout(res, 20));
            out.next = app.currentFile === n2 && ed.isOpen && ed.file === n2 && n1.handle.writes === 1;
            app.cancelCrop();

            // PNG keeps pHYs (DPI) through a crop
            const p = makeFakeFile('p.png', await makeRealPng(60, 40, 300), 'image/png');
            await open(p);
            ed.setRect({ x0: -20, y0: -10, x1: 20, y1: 10 });
            await app.saveCrop();
            const pd = ImageMeta.readDpi(p.handle.bytes);
            out.pngDpi = pd && Math.round(pd.x);
            out.pngType = p.handle.writtenType;
            return out;
        });
        check('rotate-then-crop: editor sees the rotated photo (200x400)', r.editorDims === '200x400', r.editorDims);
        check('rotate-then-crop: saved crop keeps the rotation (150x400)', r.savedDims === '150x400', r.savedDims);
        check('editor closes after save', r.closed);
        check('crop keeps EXIF (Make, DateTimeOriginal)', r.make === 'TestCam' && r.taken, String(r.make));
        check('crop keeps DPI (300)', r.dpi === 300, String(r.dpi));
        check('crop keeps the ICC colour profile', r.icc);
        check('crop resets EXIF orientation to 1 (pixels baked upright)', r.orientationReset === 1, String(r.orientationReset));
        check('undo restores the pre-crop file', r.undone);
        check('straightened crop fits inside the rotated image', r.fitsAt7);
        check('straightened output has no empty corners', r.cornersRed && r.straightenedSmaller);
        check('straighten then back to 0° restores the crop', r.angleRoundTrip);
        check('8×10 preset gives 5:4 on landscape', Math.abs(r.aspect - 1.25) < 0.01, String(r.aspect));
        check('swap orientation gives 4:5', Math.abs(r.swapped - 0.8) < 0.01, String(r.swapped));
        check('level tool: near-horizontal line → −5.71°', Math.abs(r.level + 5.71) < 0.01, String(r.level));
        check('level tool: near-vertical line → plumb (+2.86°)', Math.abs(r.plumb - 2.86) < 0.01, String(r.plumb));
        check('quarter turn without crop saves losslessly', r.quarterLossless);
        check('"Previous" reapplies the last crop', r.previous);
        check('Save & Next moves on and reopens the editor', r.next);
        check('PNG crop stays PNG and keeps DPI', r.pngType === 'image/png' && r.pngDpi === 300, `${r.pngType} ${r.pngDpi}`);
        check('crop suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7c. Keyboard shortcuts: exact matching, rebinding, panel ----
    console.log('keyboard shortcuts');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            localStorage.removeItem('jeditor.keys');
            app.loadKeyBindings();
            const f = makeFakeFile('a.jpg', await makeRealJpeg(40, 30, {}), 'image/jpeg');
            app.files = [f];
            app.currentFile = f;
            app.dirHandle = null;
            document.getElementById('main-interface').classList.remove('hidden');
            app.setView('single');
            const press = (key, mods = {}, target = window) =>
                target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));

            // Ctrl+C is not C
            press('c', { ctrlKey: true });
            out.ctrlCIgnored = !app.cropState.active;

            // Rebind: Shift+G → grid view, and it persists
            app.assignKey('view.grid', 'Shift+G');
            press('G', { shiftKey: true });
            out.rebound = app.viewMode === 'grid';
            out.persisted = JSON.parse(localStorage.getItem('jeditor.keys'))['view.grid'].includes('Shift+G');

            // Conflict: giving I to "Single view" takes it from File Info
            app.assignKey('view.single', 'I');
            out.conflictMoved = !app.keyBindings['view.info'].includes('I');
            press('i');
            out.newBindingWorks = app.viewMode === 'single';

            // Panel: record a new key with the + button
            press('?');
            out.panelOpen = app.isShortcutsOpen();
            const row = [...document.querySelectorAll('.sc-row')].find(x => x.textContent.startsWith('Fullscreen'));
            row.querySelector('.sc-add').click();
            press('k');
            out.recorded = app.keyBindings['view.fullscreen'].includes('K');
            // Typing in the filter never triggers shortcuts
            const filter = document.getElementById('shortcuts-filter');
            filter.focus();
            press('g', {}, filter);
            out.typingSafe = app.viewMode === 'single';
            press('Escape');
            out.panelClosed = !app.isShortcutsOpen();

            app.resetKeys();
            out.reset = app.keyBindings['view.info'].join() === 'I' && app.keyBindings['view.grid'].join() === 'G';
            out.format = app.formatCombo('Ctrl+Shift+ArrowLeft').replace('⌘', 'Ctrl') + '|' + app.formatCombo('+');
            return out;
        });
        check('Ctrl+C does not start crop', r.ctrlCIgnored);
        check('rebound key works and persists', r.rebound && r.persisted);
        check('assigning a used key moves it', r.conflictMoved && r.newBindingWorks);
        check('? opens the shortcuts panel', r.panelOpen);
        check('+ records a new key', r.recorded);
        check('typing in the filter is not a shortcut', r.typingSafe);
        check('Esc closes the panel', r.panelClosed);
        check('reset all restores defaults', r.reset);
        check('key combos format for display', r.format === 'Ctrl + Shift + ←|+', r.format);
        await page.close();
    }

    // ---- 7d. Opening a folder, instant navigation, grid & read-only fixes ----
    console.log('viewer: open, instant navigation, grid, read-only');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const dir = makeDir('Order');
            for (let i = 1; i <= 4; i++) {
                const h = makeHandle(`s${i}.jpg`, await makeRealJpeg(300, 200, { color: `hsl(${i * 80},60%,50%)` }), 'image/jpeg');
                dir._files.set(h.name, h);
            }
            dir.values = async function* () { yield* dir._files.values(); };
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            for (let i = 0; i < 50 && app._displayKind !== 'full'; i++) await new Promise(res => setTimeout(res, 20));
            const img = document.getElementById('current-image');
            out.visible = !document.getElementById('image-container').classList.contains('hidden') &&
                img.naturalWidth === 300 && app.viewMode === 'single';

            // Neighbour is pre-decoded: next photo is on screen synchronously
            const next = app.files[1];
            for (let i = 0; i < 50 && !(next._decodedEl && next._decodedEl._decoded); i++) await new Promise(res => setTimeout(res, 20));
            app.navigate(1);
            out.instant = document.getElementById('current-image') === next._decodedEl && app._displayKind === 'full';

            // Refresh doesn't duplicate
            await app.refreshFolder();
            out.noDupes = app.files.length === 4;

            // Grid Up/Down follows the real column count
            app.setView('grid');
            document.documentElement.style.setProperty('--grid-item-size', '300px');
            const cols = getComputedStyle(document.getElementById('grid-view')).gridTemplateColumns.split(' ').length;
            out.cols = app.getGridColumnCount() === cols;

            // Read-only: edits refused up front
            app.readOnlyMode = true;
            const before = app.files[0].handle.writes;
            const res = await app.rotateImage(app.files[0], 90);
            out.readOnly = res === false && app.files[0].handle.writes === before &&
                [...document.querySelectorAll('.toast')].some(t => /read-only/.test(t.textContent));
            app.readOnlyMode = false;
            const snap = app.perfSnapshot().join('\n');
            out.perf = /Undo: \d+ steps/.test(snap) && /Images decoded/.test(snap) && /Photo load/.test(snap);
            app.toggleDebugConsole();
            out.perfShown = /Thumbnails:/.test(document.getElementById('debug-perf').textContent);
            app.toggleDebugConsole();
            app.selection = new Set([app.files[0]]);
            app.updateSelectionUI();
            out.selectionText = document.getElementById('selection-count').textContent;
            return out;
        });
        check('opening a folder shows the photo (no blank screen)', r.visible);
        check('next photo swaps in instantly (pre-decoded)', r.instant);
        check('refresh adds no duplicates', r.noDupes);
        check('grid Up/Down uses the real column count', r.cols);
        check('read-only photos refuse edits with a message', r.readOnly);
        check('selection count reads "1 selected"', r.selectionText === '1 selected', r.selectionText);
        check('debug console shows a performance readout', r.perf && r.perfShown);
        check('viewer suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7e. Screen-sized previews for big scans ----
    console.log('screen-sized previews');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const edge = app.previewEdge();
            const big = makeFakeFile('big.jpg', await makeRealJpeg(edge * 2, Math.round(edge * 1.5), { exif: true }), 'image/jpeg');
            app.files = [big];
            app.currentFile = big;
            app.dirHandle = null;
            document.getElementById('main-interface').classList.remove('hidden');
            app.setView('single');
            for (let i = 0; i < 200 && app._displayKind !== 'full'; i++) await new Promise(res => setTimeout(res, 25));
            const img = document.getElementById('current-image');
            out.isPreview = img._isPreview === true && Math.max(img.naturalWidth, img.naturalHeight) <= edge;
            // A screen-sized photo is shown from the original, without a worker decode first
            let workerCalls = 0;
            const gen = app.generatePreview.bind(app);
            app.generatePreview = (...a) => { workerCalls++; return gen(...a); };
            const small = makeFakeFile('small.jpg', await makeRealJpeg(Math.round(edge * 0.7), Math.round(edge * 0.5), {}), 'image/jpeg');
            const src = await app.getDisplaySource(small);
            out.smallDirect = workerCalls === 0 && src.isPreview === false && src.w === Math.round(edge * 0.7);
            app.generatePreview = gen;
            out.origDims = big._dims && big._dims.w === edge * 2;
            out.cached = !!(await app.idbGet('previews', big._preview.key));

            // Rotation on a preview still shows instantly
            await app.rotateImage(big, 90);
            out.rotatedShown = /rotate\(90deg\)/.test(document.getElementById('current-image').style.transform);

            // Zooming past fit swaps in the original
            app.zoomBy(2);
            for (let i = 0; i < 200 && document.getElementById('current-image')._isPreview; i++) await new Promise(res => setTimeout(res, 25));
            const full = document.getElementById('current-image');
            out.upgraded = !full._isPreview && Math.max(full.naturalWidth, full.naturalHeight) === edge * 2;
            out.zoomKept = app.zoom === 2 && /scale\(/.test(full.style.transform);

            // Crop still renders at full resolution from the original
            app.zoomBy(0);
            await app.enterCrop();
            out.cropDims = `${CropEditor.W}x${CropEditor.H}`;
            app.cancelCrop();

            // Double-click: in to 100% on the clicked spot, again back to fit
            const view = document.getElementById('current-image');
            const dbl = (x, y) => view.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));
            const b0 = view.getBoundingClientRect();
            // Mouse events carry whole pixels
            const px = Math.round(b0.left + b0.width * 0.3), py = Math.round(b0.top + b0.height * 0.6);
            dbl(px, py);
            const oneToOne = big._dims.w / (view.offsetWidth * app.currentFitScale());
            out.dblZoom = Math.abs(app.zoom - Math.max(2, Math.min(8, oneToOne))) < 0.01;
            await new Promise(res => setTimeout(res, 400)); // let the zoom transition finish
            const b1 = view.getBoundingClientRect();
            const ux = (px - b0.left) / b0.width, uy = (py - b0.top) / b0.height;
            out.dblDrift = Math.hypot(b1.left + b1.width * ux - px, b1.top + b1.height * uy - py);
            dbl(px + 30, py + 30);
            out.dblFit = app.zoom === 1 && app.panX === 0 && app.panY === 0;
            return { ...out, expectCrop: `${Math.round(edge * 1.5)}x${edge * 2}` };
        });
        check('big scan shows a screen-sized preview', r.isPreview);
        check('original dimensions reported for the preview', r.origDims);
        check('screen-sized photo skips the preview worker', r.smallDirect);
        check('preview cached in IndexedDB', r.cached);
        check('rotating a previewed photo shows instantly', r.rotatedShown);
        check('zooming in swaps to the full-resolution original', r.upgraded && r.zoomKept);
        check('crop works at original resolution after rotation', r.cropDims === r.expectCrop, `${r.cropDims} vs ${r.expectCrop}`);
        check('double-click zooms to 100% on the clicked spot', r.dblZoom && r.dblDrift < 2, `drift ${r.dblDrift}px`);
        check('double-click again zooms back to fit', r.dblFit);
        check('preview suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7f. Duplicate finder & culling ----
    console.log('duplicates');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            // Deterministic "photo": random blocks from a seed
            const scene = async (seed, w, h, { brighten = 0, rotate = false } = {}) => {
                const c = document.createElement('canvas');
                c.width = rotate ? h : w; c.height = rotate ? w : h;
                const g = c.getContext('2d');
                if (rotate) { g.translate(h, 0); g.rotate(Math.PI / 2); }
                let x = seed;
                const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
                g.fillStyle = `hsl(${seed * 50 % 360},40%,${30 + brighten}%)`;
                g.fillRect(0, 0, w, h);
                for (let i = 0; i < 14; i++) {
                    g.fillStyle = `hsl(${rnd() * 360},60%,${20 + rnd() * 50 + brighten}%)`;
                    g.fillRect(rnd() * w, rnd() * h, w * (0.1 + rnd() * 0.4), h * (0.1 + rnd() * 0.4));
                }
                return new Uint8Array(await (await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9))).arrayBuffer());
            };
            const dir = makeDir('Order 88');
            const add = (name, bytes) => { const h = makeHandle(name, bytes, 'image/jpeg'); dir._files.set(name, h); };
            const a = await scene(7, 600, 400);
            add('a.jpg', a);
            add('a_copy.jpg', a.slice());
            add('a_rescan.jpg', await scene(7, 900, 600, { brighten: 6, rotate: true }));
            add('b.jpg', await scene(21, 600, 400));
            add('c.jpg', await scene(42, 600, 400));
            dir.values = async function* () { yield* dir._files.values(); };
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();

            const press = (key, mods = {}) =>
                window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
            press('d');
            for (let i = 0; i < 200 && !(Dupes.groups && Dupes.groups.length && document.querySelector('.dupe-card')); i++) {
                await new Promise(res => setTimeout(res, 25));
            }
            out.open = Dupes.isOpen;
            out.groups = Dupes.groups.map(g => g.files.map(f => f.name).sort().join('+'));
            const g = Dupes.groups[0];
            out.best = g && g.best.name;
            out.exact = g && [...g.exact].map(f => f.name).sort().join('+');
            out.cards = document.querySelectorAll('.dupe-card').length;

            // Similarity is rotation-invariant; unrelated photos don't match
            const fa = app.files.find(f => f.name === 'a.jpg')._fp;
            const fr = app.files.find(f => f.name === 'a_rescan.jpg')._fp;
            const fb = app.files.find(f => f.name === 'b.jpg')._fp;
            out.simRescan = Dupes.similarity(fa, fr).map(v => v.toFixed(2)).join('/');
            out.simOther = Dupes.similarity(fa, fb).map(v => v.toFixed(2)).join('/');
            out.rescanMatches = Dupes.isMatch(fa, fr, Dupes.SENSITIVITY.normal);
            out.otherRejected = !Dupes.isMatch(fa, fb, Dupes.SENSITIVITY.loose);

            // Cull: keep suggested (K), trash the rest (Enter)
            press('k');
            out.marked = g.marked.size;
            press('Enter');
            for (let i = 0; i < 100 && app.files.length !== 3; i++) await new Promise(res => setTimeout(res, 20));
            out.left = app.files.map(f => f.name).sort().join(',');
            out.doneMessage = document.getElementById('dupes-stage').textContent;
            press('Escape');
            out.closed = !Dupes.isOpen;
            await app.undo();
            out.restored = app.files.length === 5;
            return out;
        });
        check('D opens the duplicate finder', r.open);
        check('finds one group: copy + rotated re-scan', JSON.stringify(r.groups) === '["a.jpg+a_copy.jpg+a_rescan.jpg"]', JSON.stringify(r.groups));
        console.log(`  info  similarity (layout/detail): re-scan ${r.simRescan}, unrelated ${r.simOther}`);
        check('rotation-invariant match (re-scan matches, other photo does not)', r.rescanMatches && r.otherRejected, `${r.simRescan} / ${r.simOther}`);
        check('suggests the highest-resolution copy', r.best === 'a_rescan.jpg', String(r.best));
        check('exact copies flagged', r.exact === 'a.jpg+a_copy.jpg', String(r.exact));
        check('side-by-side cards rendered', r.cards === 3, String(r.cards));
        check('K marks all but the suggested keeper', r.marked === 2, String(r.marked));
        check('Enter trashes marked photos', r.left === 'a_rescan.jpg,b.jpg,c.jpg', r.left);
        check('finished state reported', /All done/.test(r.doneMessage), r.doneMessage);
        check('Esc closes; Ctrl+Z restores the trashed duplicates', r.closed && r.restored);
        check('duplicates suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7g. Duplicates: scanner beds, tilt, no chaining ----
    console.log('duplicates: scan-order cases');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            Dupes.init(app);
            // A "photo": deterministic blocks from a seed
            const photo = (seed) => {
                const c = document.createElement('canvas');
                c.width = 600; c.height = 400;
                const g = c.getContext('2d');
                let x = seed;
                const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
                g.fillStyle = `hsl(${seed * 50 % 360},40%,35%)`;
                g.fillRect(0, 0, 600, 400);
                for (let i = 0; i < 18; i++) {
                    g.fillStyle = `hsl(${rnd() * 360},60%,${20 + rnd() * 50}%)`;
                    g.fillRect(rnd() * 600, rnd() * 400, 60 + rnd() * 200, 40 + rnd() * 150);
                }
                return c;
            };
            // Scan it: a small print on a big white bed, tilted, optionally turned
            const scan = (src, { tilt = 0, quarter = 0, margin = 0.25 } = {}) => {
                const W = 1200, H = 900;
                const c = document.createElement('canvas');
                c.width = quarter % 2 ? H : W; c.height = quarter % 2 ? W : H;
                const g = c.getContext('2d');
                g.fillStyle = '#f4f2ee';
                g.fillRect(0, 0, c.width, c.height);
                g.translate(c.width / 2, c.height / 2);
                g.rotate(quarter * Math.PI / 2 + tilt * Math.PI / 180);
                const pw = W * (1 - 2 * margin), ph = H * (1 - 2 * margin);
                g.drawImage(src, -pw / 2, -ph / 2, pw, ph);
                return Dupes.fingerprintFromCanvas(c);
            };
            const A = photo(3), B = photo(11), C = photo(29);
            const a1 = scan(A, { tilt: -1.5 });
            const a2 = scan(A, { tilt: 3, quarter: 1, margin: 0.2 }); // re-scan: turned, placed differently
            const b1 = scan(B, { tilt: 1 });
            const c1 = scan(C, { tilt: -2 });
            const sens = Dupes.SENSITIVITY.normal;
            out.rescan = Dupes.isMatch(a1, a2, sens);
            out.bedsIgnored = !Dupes.isMatch(a1, b1, sens) && !Dupes.isMatch(b1, c1, sens) && !Dupes.isMatch(a1, c1, Dupes.SENSITIVITY.loose);
            out.sims = [Dupes.similarity(a1, a2), Dupes.similarity(a1, b1)].map(p => p.map(v => v.toFixed(2)).join('/')).join(' vs ');

            // A featureless frame never near-matches
            const blank = document.createElement('canvas');
            blank.width = 600; blank.height = 400;
            const bg = blank.getContext('2d');
            bg.fillStyle = '#777'; bg.fillRect(0, 0, 600, 400);
            out.weak = Dupes.fingerprintFromCanvas(blank).weak;

            // No chaining: x~y and y~z but not x~z must not become one group
            const files = ['x.jpg', 'y.jpg', 'z.jpg'].map(n => makeFakeFile(n, [1], 'image/jpeg', 1 + n.charCodeAt(0)));
            const saved = { fp: Dupes.fingerprint, match: Dupes.isMatch };
            Dupes.fingerprint = async (f) => ({ name: f.name });
            const rel = new Set(['x.jpg|y.jpg', 'y.jpg|z.jpg']);
            Dupes.isMatch = (p, q) => rel.has(p.name + '|' + q.name) || rel.has(q.name + '|' + p.name);
            const groups = await Dupes.findGroups(files, sens);
            Dupes.fingerprint = saved.fp;
            Dupes.isMatch = saved.match;
            out.noChain = groups.length === 1 && groups[0].files.length === 2;
            return out;
        });
        console.log(`  info  bed scans (layout/detail): re-scan ${r.sims}`);
        check('re-scan turned and re-placed on the bed still matches', r.rescan);
        check('unrelated prints on a white bed do not match', r.bedsIgnored);
        check('featureless frames are flagged weak', r.weak);
        check('look-alikes cannot chain unrelated photos into one group', r.noChain);
        check('scan-order duplicates: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7h. Rotating a photo shown from its original file (real disk files) ----
    console.log('rotate while showing the original file');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            // Real files in the browser's private file system: a File from
            // getFile() stops being readable once the file is written, like on disk
            const root = await navigator.storage.getDirectory();
            try { await root.removeEntry('snap', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await root.getDirectoryHandle('snap', { create: true });
            for (const [name, color] of [['a.jpg', '#c33'], ['b.jpg', '#36c'], ['c.jpg', '#3a3']]) {
                const fh = await dir.getFileHandle(name, { create: true });
                const w = await fh.createWritable();
                await w.write(new Blob([await makeRealJpeg(1800, 1200, { color })], { type: 'image/jpeg' }));
                await w.close();
            }
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            // Rotate straight away, while the photo may still be loading
            app.rotateCurrent(90);
            app.rotateCurrent(90);
            const a = app.files[0];
            while (a._rotationQueue) await a._rotationQueue;
            await new Promise(res => setTimeout(res, 300));
            const ok = () => {
                const img = document.getElementById('current-image');
                return img.complete && img.naturalWidth > 0;
            };
            out.afterRotate = ok();
            // Away and back: the photo is loaded again from the changed file
            app.navigate(1);
            await new Promise(res => setTimeout(res, 300));
            app.navigate(1);
            await new Promise(res => setTimeout(res, 300));
            app.openSingle(a);
            for (let i = 0; i < 100 && !(app._displayFile === a && app._displayKind === 'full'); i++) await new Promise(res => setTimeout(res, 20));
            out.afterReturn = ok() && app._displayFile === a;
            out.noBroken = ![...document.querySelectorAll('img')].some(i => i.src.startsWith('blob:') && i.complete && i.naturalWidth === 0);
            return out;
        });
        check('photo stays visible when rotated while loading', r.afterRotate);
        check('rotated photo loads again after navigating away and back', r.afterReturn);
        check('no broken images anywhere', r.noBroken);
        check('snapshot suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7i. Batch rename ----
    console.log('batch rename');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            document.getElementById('main-interface').classList.remove('hidden');
            const root = makeDir('Order');
            const move = (h) => async function (n) {
                if (h._failOn === n) throw new Error('locked');
                root._files.delete(this.name);
                this.name = n;
                root._files.set(n, this);
            };
            const add = (name, taken) => {
                const f = makeFakeFile(name, makeJpegBytes(), 'image/jpeg');
                f.parentDir = root;
                f.handle.name = name;
                f.handle.move = move(f.handle);
                f.dateTaken = taken;
                root._files.set(name, f.handle);
                return f;
            };
            const files = [add('IMG_0003.jpg', 300), add('IMG_0001.jpg', 100), add('IMG_0002.jpg', 200)];
            app.dirHandle = root;
            app.files = [...files];
            app.sortMode = 'name_asc';
            app.sortFiles(false);
            const names = () => app.files.map(f => f.name).sort().join(',');
            const set = (id, v) => { document.getElementById(id).value = v; };
            const run = async (opts) => {
                Renamer.open(app, opts.files || []);
                Renamer.mode = opts.mode || 'new';
                Renamer.syncMode();
                for (const [k, v] of Object.entries(opts.fields || {})) set(k, v);
                document.getElementById('rename-case').checked = !!opts.matchCase;
                await Renamer.refresh();
                return Renamer.rows;
            };

            // New names numbered by date taken, zero-padded
            let rows = await run({ fields: { 'rename-pattern': 'Smith_{###}', 'rename-order': 'taken', 'rename-dir': 'asc', 'rename-start': 1, 'rename-step': 1 } });
            out.preview = rows.map(x => x.oldName + '>' + x.newName).join(' ');
            out.previewShown = document.querySelectorAll('.rename-row').length === 3;
            await Renamer.apply();
            out.renamed = names();
            out.closed = !Renamer.isOpen;

            // Shift the whole sequence by one (new names overlap old ones)
            await run({ fields: { 'rename-pattern': 'Smith_{###}', 'rename-order': 'name', 'rename-start': 2 } });
            await Renamer.apply();
            out.shifted = names();
            out.noTempLeft = ![...root._files.keys()].some(n => n.startsWith('.jeditor'));

            // Undo puts the whole batch back
            await app.undo();
            out.undone = names();

            // Find & replace on the existing names, with a number token
            await run({ mode: 'replace', fields: { 'rename-find': 'smith_', 'rename-replace': 'Order88-', 'rename-order': 'name', 'rename-start': 1 } });
            out.replaceNoCase = Renamer.rows.map(x => x.newName).join(',');
            await run({ mode: 'replace', matchCase: true, fields: { 'rename-find': 'smith_', 'rename-replace': 'X' } });
            out.replaceCaseNoMatch = Renamer.rows.every(x => x.newName === x.oldName);

            // {date} token
            files[0].dateTaken = new Date(2024, 4, 9, 14, 5, 6).getTime();
            rows = await run({ files: [files[0]], fields: { 'rename-pattern': '{date}_{time}' } });
            out.dateToken = rows[0].newName;

            // Problems block the rename: duplicates, invalid, clash with another photo
            rows = await run({ fields: { 'rename-pattern': 'same' } });
            out.dupBlocked = rows.every(x => /Same name/.test(x.error)) && document.getElementById('rename-apply').disabled &&
                /add \{###\}/.test(document.getElementById('rename-summary').textContent);
            rows = await run({ fields: { 'rename-pattern': 'bad:name_{#}' } });
            out.invalidBlocked = rows.every(x => x.error) && document.getElementById('rename-apply').disabled;
            const other = app.files.find(f => f.name === 'Smith_002.jpg');
            rows = await run({ files: [app.files.find(f => f.name === 'Smith_001.jpg')], fields: { 'rename-pattern': 'smith_002' } });
            out.clashBlocked = /already has this name/.test(rows[0].error || '') && !!other;
            Renamer.close();

            // Case-only rename works (two passes)
            const one = app.files.find(f => f.name === 'Smith_001.jpg');
            out.caseOnly = await app.renameMany([{ file: one, newName: 'SMITH_001.jpg' }]) && one.name === 'SMITH_001.jpg';

            // A failure part-way puts every name back
            const before = names();
            const victim = app.files.find(f => f.name === 'Smith_003.jpg');
            victim.handle._failOn = 'Z_3.jpg';
            const ok = await app.renameMany(app.files.map((f, i) => ({ file: f, newName: `Z_${i + 1}.jpg` })).sort((a, b) => a.newName.localeCompare(b.newName)));
            out.rollback = ok === false && names() === before && ![...root._files.keys()].some(n => n.startsWith('.jeditor'));
            return out;
        });
        check('preview numbers by date taken, zero-padded', r.preview === 'IMG_0001.jpg>Smith_001.jpg IMG_0002.jpg>Smith_002.jpg IMG_0003.jpg>Smith_003.jpg' && r.previewShown, r.preview);
        check('rename applies and closes', r.renamed === 'Smith_001.jpg,Smith_002.jpg,Smith_003.jpg' && r.closed, r.renamed);
        check('shifting a sequence onto its own names works', r.shifted === 'Smith_002.jpg,Smith_003.jpg,Smith_004.jpg' && r.noTempLeft, r.shifted);
        check('undo restores the whole batch', r.undone === 'Smith_001.jpg,Smith_002.jpg,Smith_003.jpg', r.undone);
        check('find & replace (case-insensitive by default)', r.replaceNoCase === 'Order88-001.jpg,Order88-002.jpg,Order88-003.jpg', r.replaceNoCase);
        check('match case respected', r.replaceCaseNoMatch);
        check('{date}_{time} from capture date', r.dateToken === '2024-05-09_14-05-06.jpg', r.dateToken);
        check('duplicate names blocked with a hint', r.dupBlocked);
        check('invalid characters blocked', r.invalidBlocked);
        check('clash with another photo blocked', r.clashBlocked);
        check('case-only rename', r.caseOnly);
        check('failure part-way puts names back', r.rollback);
        check('rename suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7j. The .jeditor folder: trash, shared thumbnail + duplicate cache, clean up ----
    console.log('.jeditor folder cache');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const openFolder = () => page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle('cacheorder', { create: true });
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            while (app.files.some(f => !f.thumbnailUrl)) await new Promise(res => setTimeout(res, 50));
            await FolderCache.flush();
        });
        // First computer: make a folder of photos big enough to get cached thumbnails
        await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            try { await root.removeEntry('cacheorder', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await root.getDirectoryHandle('cacheorder', { create: true });
            for (let i = 0; i < 4; i++) {
                const c = document.createElement('canvas');
                c.width = 900; c.height = 600;
                const g = c.getContext('2d');
                const noise = g.createImageData(900, 600);
                for (let k = 0; k < noise.data.length; k++) noise.data[k] = (Math.random() * 255) | 0;
                g.putImageData(noise, 0, 0);
                g.fillStyle = `hsl(${i * 90},70%,50%)`;
                g.fillRect(100 + i * 50, 100, 400, 300);
                const fh = await dir.getFileHandle(`p${i}.jpg`, { create: true });
                const w = await fh.createWritable();
                await w.write(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)));
                await w.close();
            }
        });
        await openFolder();
        const first = await page.evaluate(async () => {
            const out = {};
            const dir = await window.showDirectoryPicker();
            const thumbs = await (await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('cache')).getDirectoryHandle('thumbs');
            let n = 0;
            for await (const e of thumbs.values()) n++;
            out.thumbsSaved = n;
            out.photosScanned = app.files.length; // .jeditor itself isn't scanned
            // Duplicate scan saves fingerprints with the folder
            app.openDupes();
            while (!(Dupes.groups && document.querySelector('.dupe-card, .dupes-message')) || app._tasks.has('dupes')) await new Promise(r => setTimeout(r, 50));
            Dupes.close();
            await new Promise(r => setTimeout(r, 200));
            const fpFile = await (await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('cache')).getFileHandle('fingerprints.json');
            out.fingerprintsSaved = Object.keys(JSON.parse(await (await fpFile.getFile()).text()).entries).length;
            return out;
        });

        // "Another computer": no browser cache, same folder
        await page.evaluate(() => new Promise(res => { const r = indexedDB.deleteDatabase('jeditor'); r.onsuccess = r.onerror = r.onblocked = res; }));
        await page.reload({ waitUntil: 'networkidle' });
        await page.evaluate(PAGE_HELPERS);
        await page.evaluate(() => {
            window._generated = 0;
            const gen = app.generateThumbnailBlob.bind(app);
            app.generateThumbnailBlob = (d) => { window._generated++; return gen(d); };
            window._fpComputed = 0;
            const fp = Dupes.fingerprintFromCanvas.bind(Dupes);
            Dupes.fingerprintFromCanvas = (c) => { window._fpComputed++; return fp(c); };
        });
        await openFolder();
        const second = await page.evaluate(async () => {
            const out = { thumbsGenerated: window._generated };
            app.openDupes();
            while (!(Dupes.groups && document.querySelector('.dupe-card, .dupes-message')) || app._tasks.has('dupes')) await new Promise(r => setTimeout(r, 50));
            Dupes.close();
            out.fingerprintsComputed = window._fpComputed;

            // Delete goes to .jeditor/trash; undo brings it back
            const dir = await window.showDirectoryPicker();
            await app.moveToTrash([app.files[0]]);
            const trash = await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('trash');
            let inTrash = 0;
            for await (const e of trash.values()) inTrash++;
            out.trashed = inTrash === 1 && app.files.length === 3;
            await app.undo();
            out.restored = app.files.length === 4;

            // A changed photo's old cached thumbnail is pruned
            await app.rotateImage(app.files[0], 90);
            app.pruneFolderCache();
            await new Promise(r => setTimeout(r, 400));
            const thumbs = await (await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('cache')).getDirectoryHandle('thumbs');
            let n = 0;
            for await (const e of thumbs.values()) n++;
            out.prunedTo = n;

            // Clean up removes .jeditor entirely (after confirming)
            await app.moveToTrash([app.files[1]]);
            window.confirm = () => true;
            await app.cleanUpFolder();
            let gone = false;
            try { await dir.getDirectoryHandle('.jeditor'); } catch (e) { gone = true; }
            out.cleanedUp = gone && !(app._undoStack || []).some(e => e.type === 'trash') && app.files.length === 3;

            // Setting off: nothing is written to the folder
            app.uiPrefs.folderCache = false;
            app.files.forEach(f => { delete f.thumbnailUrl; });
            FolderCache.putThumb(app, 'x|1|1', new Blob(['x']));
            await FolderCache.flush();
            let created = true;
            try { await dir.getDirectoryHandle('.jeditor'); } catch (e) { created = false; }
            out.offWritesNothing = !created;
            app.uiPrefs.folderCache = true;
            return out;
        });
        check('.jeditor caches a thumbnail per photo', first.thumbsSaved === 4 && first.photosScanned === 4, JSON.stringify(first));
        check('duplicate fingerprints saved with the folder', first.fingerprintsSaved === 4, String(first.fingerprintsSaved));
        check('another computer: thumbnails come from the folder', second.thumbsGenerated === 0, String(second.thumbsGenerated));
        check('another computer: duplicate scan reuses fingerprints', second.fingerprintsComputed === 0, String(second.fingerprintsComputed));
        check('delete goes to .jeditor/trash; undo restores', second.trashed && second.restored);
        check('stale cached thumbnail pruned', second.prunedTo === 3, String(second.prunedTo));
        check('clean up removes .jeditor and its undo steps', second.cleanedUp);
        check('cache setting off writes nothing', second.offWritesNothing);
        check('folder cache suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7. file:// — direct open and standalone build ----
    console.log('file:// support');
    for (const [label, target] of [
        ['app/index.html', path.join(ROOT, 'app', 'index.html')],
        ['standalone.html', path.join(ROOT, 'standalone.html')]
    ]) {
        const { page, issues } = await newPage(browser, 'file://' + target);
        const r = await page.evaluate(() => ({
            cropper: typeof CropEditor !== 'undefined' && typeof ImageMeta !== 'undefined',
            app: typeof app !== 'undefined',
            dropZoneVisible: !document.getElementById('drop-zone').classList.contains('hidden'),
            fsApi: typeof window.showDirectoryPicker
        }));
        check(`${label}: no JS errors`, issues.errors.length === 0, issues.errors.join('; '));
        check(`${label}: crop editor + app loaded`, r.cropper && r.app);
        check(`${label}: drop zone shown`, r.dropZoneVisible);

        // Thumbnail generation must also work from file:// (blob worker or fallback)
        const thumbOk = await page.evaluate(async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 500; canvas.height = 400;
            const ctx = canvas.getContext('2d');
            const noise = ctx.createImageData(500, 400);
            for (let i = 0; i < noise.data.length; i++) noise.data[i] = (Math.random() * 256) | 0;
            ctx.putImageData(noise, 0, 0);
            const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const file = makeFakeFile('t.png', bytes, 'image/png');
            app.files = [file];
            const url = await app.ensureThumbnail(file, { urgent: true }).catch(() => null);
            return !!url && !!file.thumbnailUrl;
        });
        check(`${label}: thumbnails generate`, thumbOk);
        if (label === 'standalone.html') {
            check('standalone: no network requests fail', issues.failedRequests.length === 0, issues.failedRequests.join('; '));
        }
        console.log(`  info  ${label}: showDirectoryPicker is ${r.fsApi}`);
        await page.close();
    }

    await browser.close();
    server.close();

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
