// Times jEditor on a huge folder (10,000 photos by default): opening it,
// the first grid paint, scrolling, thumbnails, Select all, search, and
// switching to the viewer and back. Not part of npm test (it takes minutes
// and writes ~1.5 GB): run it by hand before and after a speed change.
//
//   node test/huge-folder.perf.js            10,000 photos, cold then warm
//   COUNT=2000 node test/huge-folder.perf.js
//
// The photos are real JPEGs (1600 × 1200, ~150 KB, past the size that
// serves as its own thumbnail) written once into the browser's own on-disk
// file system (OPFS), so the folder is read through real FileSystem
// handles, as in Chrome and the apps. They're kept in a profile in the
// system's temp folder between runs; PROFILE=… puts it elsewhere.
// "cold": no thumbnails cached yet (the first time a folder is opened);
// "warm": opened again, thumbnails cached.

const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');
const { createServer } = require('../scripts/serve.js');
const { launchOptions } = require('./page-helpers');

const COUNT = +process.env.COUNT || 10000;
const PROFILE = process.env.PROFILE || path.join(os.tmpdir(), 'jeditor-huge-folder-profile');
const PORT = 39517; // fixed: OPFS belongs to the origin, so the photos survive between runs

async function main() {
    const server = createServer();
    await new Promise(r => server.listen(PORT, r));
    const opts = launchOptions();
    const context = await chromium.launchPersistentContext(PROFILE, {
        executablePath: opts.executablePath, args: opts.args, channel: opts.channel,
        viewport: { width: 1440, height: 900 }
    });
    const page = context.pages()[0] || await context.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    const url = `http://localhost:${PORT}/`;
    await page.goto(url, { waitUntil: 'networkidle' });

    // The folder, made once
    const made = await page.evaluate(async (count) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(`huge-${count}`, { create: true });
        let have = 0;
        for await (const [n] of dir.entries()) if (n.endsWith('.jpg')) have++;
        if (have >= count) return have;
        const W = 1600, H = 1200, VARIANTS = 12, blobs = [];
        for (let v = 0; v < VARIANTS; v++) {
            const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
            const grad = g.createLinearGradient(0, 0, W, H);
            grad.addColorStop(0, `hsl(${v * 30},50%,40%)`); grad.addColorStop(1, `hsl(${v * 30 + 90},60%,70%)`);
            g.fillStyle = grad; g.fillRect(0, 0, W, H);
            // Grain, so it compresses like a photo
            const img = g.getImageData(0, 0, W, H), d = img.data;
            for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
            g.putImageData(img, 0, 0);
            blobs.push(await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }));
        }
        for (let i = have; i < count; i++) {
            const name = `Order_${String(i + 1).padStart(5, '0')}.jpg`;
            const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
            await w.write(blobs[i % VARIANTS]);
            await w.close();
        }
        return count;
    }, COUNT);
    console.log(`Folder: ${made} photos in OPFS (${PROFILE})`);

    const results = {};
    for (const run of ['cold', 'warm']) {
        if (run === 'cold') {
            // Nothing cached: the browser's thumbnails and the folder's .jeditor
            await page.evaluate(async (count) => {
                const root = await navigator.storage.getDirectory();
                const dir = await root.getDirectoryHandle(`huge-${count}`);
                await dir.removeEntry('.jeditor', { recursive: true }).catch(() => { });
                await new Promise(r => { const q = indexedDB.deleteDatabase('jeditor'); q.onsuccess = q.onerror = q.onblocked = r; });
            }, COUNT);
        }
        await page.goto(url, { waitUntil: 'networkidle' });
        results[run] = await measure(page, COUNT);
        console.log(`\n== ${run} ==`);
        for (const [k, v] of Object.entries(results[run])) console.log(`  ${k.padEnd(34)} ${v}`);
    }
    await context.close();
    server.close();
}

async function measure(page, count) {
    return page.evaluate(async (count) => {
        const out = {};
        const ms = (t) => Math.round(t) + ' ms';
        const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        const until = async (fn, limit = 600000) => {
            const t0 = performance.now();
            while (!fn()) {
                if (performance.now() - t0 > limit) return false;
                await new Promise(r => setTimeout(r, 5));
            }
            return true;
        };
        // Long tasks (main thread busy ≥ 50 ms: what makes it feel stuck)
        let longs = [];
        new PerformanceObserver(l => longs.push(...l.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: false });
        const jank = () => {
            const r = longs.length ? `longest ${Math.round(Math.max(...longs))} ms, ${longs.length} over 50 ms (${Math.round(longs.reduce((a, b) => a + b, 0))} ms)` : 'none over 50 ms';
            longs = [];
            return r;
        };
        const grid = app.elements.gridView;
        const realThumb = (img) => img && img.src !== app.BLANK_THUMB && img.complete && img.naturalWidth > 0;
        const visibleTiles = () => {
            const box = grid.getBoundingClientRect();
            return [...grid.querySelectorAll('.grid-item')].filter(t => {
                const r = t.getBoundingClientRect();
                return r.bottom > box.top && r.top < box.bottom;
            });
        };
        const allVisibleShown = () => {
            const v = visibleTiles();
            return v.length > 0 && v.every(t => realThumb(t.querySelector(':scope > img')));
        };

        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(`huge-${count}`);
        app.viewMode = 'grid';

        // Open
        jank();
        const t0 = performance.now();
        let firstTile = 0, firstThumbs = 0;
        const watchPaint = (async () => {
            await until(() => grid.querySelector('.grid-item'));
            firstTile = performance.now() - t0;
            await until(allVisibleShown);
            firstThumbs = performance.now() - t0;
        })();
        await app.openDirectory(dir);
        const opened = performance.now() - t0;
        out['open (until usable)'] = ms(opened) + `, ${app.files.length} photos`;
        await watchPaint;
        out['first grid tiles on screen'] = ms(firstTile);
        out['first screen of thumbnails'] = ms(firstThumbs);
        await until(() => !app.gridRendering);
        out['all tiles built'] = ms(performance.now() - t0);
        out['  jank while opening'] = jank();
        out['DOM elements in the grid'] = grid.getElementsByTagName('*').length;

        // Scrolling: a page at a time to the middle, then a jump to the end
        await frame();
        jank();
        const frames = [];
        let last = performance.now(), going = true;
        const tick = (t) => { frames.push(t - last); last = t; if (going) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        for (let i = 0; i < 30; i++) { grid.scrollTop += grid.clientHeight; await frame(); }
        going = false;
        frames.sort((a, b) => a - b);
        out['scroll: frame time (median / worst)'] = `${Math.round(frames[frames.length >> 1])} / ${Math.round(frames[frames.length - 1])} ms`;
        out['  jank while scrolling'] = jank();
        let t = performance.now();
        grid.scrollTop = grid.scrollHeight;
        await frame();
        out['jump to end: frame'] = ms(performance.now() - t);
        await until(allVisibleShown, 60000);
        out['jump to end: thumbnails shown'] = ms(performance.now() - t);
        grid.scrollTop = Math.round(grid.scrollHeight / 3);
        t = performance.now();
        await frame();
        await until(allVisibleShown, 60000);
        out['jump to a third: thumbnails shown'] = ms(performance.now() - t);
        out['  jank'] = jank();

        // Select all, and back to one
        t = performance.now();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }));
        await frame();
        out['select all'] = ms(performance.now() - t) + `, ${app.selection.size} selected`;
        t = performance.now();
        app.handleGridClick({}, app.files[5]);
        await frame();
        out['click one (from all selected)'] = ms(performance.now() - t);

        // Search: a word that matches 1 in 10, then cleared
        t = performance.now();
        Flags.setQuery('order_0001');
        await frame();
        out['search (typed, results drawn)'] = ms(performance.now() - t) + `, ${app.viewFiles().length} found`;
        t = performance.now();
        Flags.setQuery('');
        await frame();
        out['search cleared'] = ms(performance.now() - t);
        out['  jank'] = jank();

        // Viewer: open a photo, next photo, back to the grid
        await until(() => !app.gridRendering);
        const shown = () => app.elements.currentImage.complete && app.elements.currentImage.naturalWidth > 0 && !app.elements.imageContainer.classList.contains('hidden');
        t = performance.now();
        app.openSingle(app.files[4000 % app.files.length]);
        await frame();
        out['to viewer: switched'] = ms(performance.now() - t);
        await until(shown, 30000);
        out['to viewer: photo shown'] = ms(performance.now() - t);
        t = performance.now();
        app.loadIndex(app.getCurrentIndex() + 1);
        await frame();
        out['next photo (frame)'] = ms(performance.now() - t);
        t = performance.now();
        app.setView('grid');
        await frame();
        out['back to grid'] = ms(performance.now() - t);
        out['  jank'] = jank();

        // Every thumbnail made (the background pre-cache)
        await until(() => app.files.every(f => f.thumbnailUrl || f._thumbRetries > 3));
        out['all thumbnails ready'] = ms(performance.now() - t0);
        out['  jank while pre-caching'] = jank();

        // The folder watch's rescan (it runs in the background now and then)
        t = performance.now();
        await Watch.rescan();
        out['folder rescan (watch)'] = ms(performance.now() - t);
        out['  jank'] = jank();
        if (performance.memory) out['JS heap'] = Math.round(performance.memory.usedJSHeapSize / 1e6) + ' MB';
        return out;
    }, count);
}

main().catch(e => { console.error(e); process.exit(1); });
