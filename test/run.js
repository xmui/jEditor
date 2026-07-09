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
            createWritable: async () => ({
                write: async (blob) => { h.bytes = new Uint8Array(await blob.arrayBuffer()); h.writtenType = blob.type; h.writes++; },
                close: async () => {}
            }),
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
    // Build the standalone file first so we can test it too
    execSync('node scripts/build-standalone.js', { cwd: ROOT, stdio: 'inherit' });

    const server = createServer();
    await new Promise(r => server.listen(0, r));
    const baseUrl = `http://localhost:${server.address().port}`;

    const browser = await chromium.launch(launchOptions());

    // ---- 1. Boot: served app loads clean ----
    console.log('boot (http)');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        check('no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        check('no failed requests', issues.failedRequests.length === 0, issues.failedRequests.join('; '));
        check('Cropper library loaded', await page.evaluate(() => typeof Cropper !== 'undefined'));
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
            return out;
        });
        check('worker available (off-main-thread generation)', r.workerAvailable);
        check('thumbnail downscaled to 320px', r.thumbWidth === 320, String(r.thumbWidth));
        check('thumbnail much smaller than original', r.thumbSize < r.originalSize / 3, `${r.thumbSize} vs ${r.originalSize}`);
        check('PNG stays PNG (transparency-safe)', r.thumbType === 'image/png', r.thumbType);
        check('second request is a cache hit', r.cached && r.urlSet);
        check('precache fills remaining files', r.precached);
        check('re-render paints cached thumbs immediately', r.instantPaint);
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
            await app.undo();
            out.undoneLen = a.handle.bytes.length === originalLen;
            out.undoneOrientation = readOrientation(a.handle.bytes); // null: EXIF gone again

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
            const trash = await root.getDirectoryHandle('.jeditor-trash');
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
            window.prompt = () => 'trip_{n}';
            await app.batchRename([f1, f2]);
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
        check('rotation applied then undone (bytes restored)', r.rotated && r.undoneLen && r.undoneOrientation === null,
            JSON.stringify({ len: r.undoneLen, o: r.undoneOrientation }));
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

    // ---- 7. file:// — direct open and standalone build ----
    console.log('file:// support');
    for (const [label, target] of [
        ['app/index.html', path.join(ROOT, 'app', 'index.html')],
        ['standalone.html', path.join(ROOT, 'standalone.html')]
    ]) {
        const { page, issues } = await newPage(browser, 'file://' + target);
        const r = await page.evaluate(() => ({
            cropper: typeof Cropper !== 'undefined',
            app: typeof app !== 'undefined',
            dropZoneVisible: !document.getElementById('drop-zone').classList.contains('hidden'),
            fsApi: typeof window.showDirectoryPicker
        }));
        check(`${label}: no JS errors`, issues.errors.length === 0, issues.errors.join('; '));
        check(`${label}: Cropper + app loaded`, r.cropper && r.app);
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
