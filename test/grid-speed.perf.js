// Times the grid in the Mac app (mac/, Electron), the Windows app and the web page, on the
// same folder on disk: the first screen of thumbnails, every thumbnail
// made, scrolling, resizing the tiles, and opening a photo and going back
// (with its zoom). Not part of npm test: run it by hand before and after a
// speed change (under xvfb-run -a on Linux).
//
//   node test/grid-speed.perf.js                 the Mac app and the web, cold then warm
//   ONLY=mac node test/grid-speed.perf.js        (or web, or windows)
//
// The Windows app: ONLY=windows, JEDITOR_EXE=<its jEditor.exe> (default
// dist\publish\jEditor.exe). It's driven over WebView2's DevTools port.
// JEDITOR_NO_ENGINE=1 runs it without its engine (src/Engine.cs), for the
// before and after of docs/plans/fast-engine.md.
//   JPEG=2400 HEIC=300 DNG=300 LIB=600 node test/grid-speed.perf.js
//
// The folder (camera-sized JPEGs, iPhone-sized HEICs, DNGs with a full-size
// preview; test/grid-speed-photos.py) is made once in the system's temp
// folder, PHOTOS=… puts it elsewhere. "cold": a new profile, nothing
// cached; "warm": opened again in that profile, thumbnails cached. The Mac
// app also opens a Photos library album (the tests' stand-in library).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, _electron: electron } = require('playwright-core');
const { createServer } = require('../scripts/serve.js');
const { launchOptions, QUIET_FIRST_OPEN } = require('./page-helpers');

const ROOT = path.join(__dirname, '..');
const MAC = path.join(ROOT, 'mac');
const N = { jpeg: +(process.env.JPEG || 2400), heic: +(process.env.HEIC || 300), dng: +(process.env.DNG || 300), lib: +(process.env.LIB || 600) };
// On Windows in the user's folder, not the temp folder: WebView2 doesn't let
// the page read a folder under %LOCALAPPDATA% (it opens, and lists nothing)
const BASE = process.env.PHOTOS || path.join(process.platform === 'win32' ? os.homedir() : os.tmpdir(), 'jeditor-grid-speed');
const FOLDER = path.join(BASE, `folder-${N.jpeg}-${N.heic}-${N.dng}`);
const LIBRARY = path.join(BASE, `library-${N.lib}`);
const VIEW = { width: 1440, height: 900 };

function makePhotos() {
    execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [path.join(__dirname, 'grid-speed-photos.py'), FOLDER, N.jpeg, N.heic, N.dng, LIBRARY, N.lib].map(String), { stdio: 'inherit' });
}

// A real folder handle for a path: the folder dropped onto the page
// (Chromium's own drag and drop, over the DevTools protocol), as the Mac
// app makes them, so both read the disk the same way
async function dropFolder(page, cdp, dir) {
    await page.evaluate(() => {
        window.__dropped = new Promise((resolve) => {
            const take = (e) => {
                e.preventDefault(); e.stopImmediatePropagation();
                if (e.type !== 'drop') return;
                for (const t of ['dragenter', 'dragover', 'drop']) removeEventListener(t, take, true);
                const item = [...e.dataTransfer.items].find(i => i.kind === 'file');
                item.getAsFileSystemHandle().then(h => { window.__folder = h; resolve(); });
            };
            for (const t of ['dragenter', 'dragover', 'drop']) addEventListener(t, take, true);
        });
    });
    const data = { items: [], files: [dir], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: 4, y: 4, data });
    // A drop that never lands (seen in Chrome on CI's Windows) fails here, not hangs
    const landed = await page.evaluate(() => Promise.race([window.__dropped.then(() => true), new Promise(r => setTimeout(() => r(false), 60000))]));
    if (!landed) throw new Error(`The folder dropped onto the page never arrived (${dir})`);
}

async function launchMac(profile) {
    const app = await electron.launch({
        executablePath: require(path.join(MAC, 'node_modules', 'electron')),
        args: [MAC, '--no-sandbox', '--user-data', profile],
        env: { ...process.env, JEDITOR_PLATFORM: 'mac', JEDITOR_SKIP_PERMISSIONS: '1', JEDITOR_PHOTOS_LIBRARY: LIBRARY }
    });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, v) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.setContentSize(v.width, v.height);
    }, VIEW);
    await ready(page);
    return { page, cdp: await page.context().newCDPSession(page), close: () => app.close() };
}

// The Windows app, its own WebView2 profile in `profile`, driven through
// WebView2's DevTools port. The folder's handle comes from the app with its
// path (JEditorNative.folderHandle), as a folder opened there does
async function launchWindows(profile) {
    const { spawn } = require('child_process');
    const exe = process.env.JEDITOR_EXE || path.join(ROOT, 'dist', 'publish', 'jEditor.exe');
    if (!fs.existsSync(exe)) throw new Error(`No ${exe}: build it (scripts/build.ps1) or set JEDITOR_EXE`);
    // WebView2 picks a free DevTools port and writes it to the profile's
    // DevToolsActivePort (port 0), so no guessing which one it took
    const n = (launchWindows.n = (launchWindows.n || 0) + 1);
    // Its own store too (the app keeps the thumbnail cache there, not in
    // the WebView2 profile): kept for the warm run, new for each profile.
    // In the user's folder: WebView2 stops the page writing under
    // %LOCALAPPDATA% (the temp folder), as the smoke test's store is
    const store = path.join(os.homedir(), 'jeditor-speed-' + path.basename(profile));
    // The app's log, shown if it doesn't come up
    const log = path.join(os.tmpdir(), `jeditor-speed-${path.basename(profile)}-${n}.log`);
    const active = path.join(profile, 'EBWebView', 'DevToolsActivePort');
    try { fs.rmSync(active, { force: true }); } catch (e) { /* none */ }
    const proc = spawn(exe, ['--user-data', profile, '--store', store, '--log', log], {
        env: { ...process.env, JEDITOR_DEVTOOLS: '1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' }, stdio: 'ignore'
    });
    let exited = null;
    proc.on('exit', code => { exited = code; });
    let browser = null, port = null;
    for (let i = 0; i < 300 && !browser && exited === null; i++) {
        // (WebView2 may still be writing it: busy, read again next time)
        if (!port && fs.existsSync(active)) { try { port = Number(fs.readFileSync(active, 'utf8').split(/\r?\n/)[0]) || null; } catch (e) { /* busy */ } }
        if (port) {
            for (const host of ['127.0.0.1', '[::1]', 'localhost']) {
                browser = await chromium.connectOverCDP(`http://${host}:${port}`).catch(() => null);
                if (browser) break;
            }
        }
        if (!browser) await new Promise(r => setTimeout(r, 200));
    }
    if (!browser) {
        try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* gone */ }
        const said = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).slice(-30).join('\n') : '(no log)';
        const why = port ? `port ${port} didn't answer` : `no ${active}: WebView2 didn't take --remote-debugging-port`;
        throw new Error(`The Windows app didn't open DevTools (${why}; ${exited === null ? 'still running after 60 s' : 'exited with ' + exited}). Its log:\n${said}`);
    }
    let page = null;
    for (let i = 0; i < 150 && !page; i++) {
        page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://jeditor.example/'));
        if (!page) await new Promise(r => setTimeout(r, 200));
    }
    await ready(page);
    const engine = await page.evaluate(() => Host.has('engine'));
    console.log(`  (the Windows app, ${engine ? 'with' : 'without'} its engine)`);
    return {
        page, cdp: null, windows: true,
        // The app and its WebView2 processes, all of them
        close: async () => {
            // What the engine said it did (Engine.cs, every 50 answers)
            if (fs.existsSync(log)) {
                const said = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(l => / Engine: \d+ answered/.test(l));
                if (said.length) console.log('  engine: ' + said[said.length - 1].replace(/^.*?Engine: /, ''));
            }
            await browser.close().catch(() => {});
            try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* gone */ }
            await new Promise(r => setTimeout(r, 3000));
        }
    };
}

let server = null;
async function launchWeb(profile) {
    if (!server) {
        server = createServer();
        await new Promise(r => server.listen(39531, r));
    }
    const opts = launchOptions();
    const context = await chromium.launchPersistentContext(profile, {
        executablePath: opts.executablePath, args: opts.args, channel: opts.channel, viewport: VIEW
    });
    const page = context.pages()[0] || await context.newPage();
    await page.addInitScript(QUIET_FIRST_OPEN);
    await page.goto('http://localhost:39531/', { waitUntil: 'networkidle' });
    await ready(page);
    return { page, cdp: await context.newCDPSession(page), close: () => context.close() };
}

async function ready(page) {
    page.on('pageerror', e => console.log('  PAGEERROR', e.message));
    page.on('console', m => { if (m.text().startsWith('PERF ') || m.type() === 'error' || m.type() === 'warning') console.log('  ' + (m.type() === 'log' ? '' : m.type().toUpperCase() + ' ') + m.text()); });
    await page.waitForFunction(() => typeof app !== 'undefined' && app.elements && app.elements.gridView);
    await page.evaluate(QUIET_FIRST_OPEN);
    await page.evaluate(() => performance.setResourceTimingBufferSize(10000));
    await page.evaluate(() => { if (app.uiPrefs) app.uiPrefs.hugeFolder = 0; });
}

// In the page: the folder in window.__folder (or the library album, lib)
async function measure(page, lib) {
    return page.evaluate(async (lib) => {
        const out = {};
        const ms = (t) => Math.round(t);
        const sleep = (t) => new Promise(r => setTimeout(r, t));
        const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        const until = async (fn, limit = 900000) => {
            const t0 = performance.now();
            while (!fn()) {
                if (performance.now() - t0 > limit) return false;
                await sleep(10);
            }
            return true;
        };
        let longs = [];
        new PerformanceObserver(l => longs.push(...l.getEntries().map(e => e.duration))).observe({ type: 'longtask' });
        const jank = () => {
            const r = { long: longs.length, longest: ms(Math.max(0, ...longs)), busy: ms(longs.reduce((a, b) => a + b, 0)) };
            longs = [];
            return r;
        };
        // Frame times while fn runs: how many took over 1.5 frames (dropped)
        const frames = async (fn) => {
            const f = [];
            let last = performance.now(), going = true;
            const tick = (t) => { f.push(t - last); last = t; if (going) requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
            jank();
            await fn();
            going = false;
            f.sort((a, b) => a - b);
            return { frames: f.length, median: ms(f[f.length >> 1] || 0), p95: ms(f[Math.floor(f.length * 0.95)] || 0), worst: ms(f[f.length - 1] || 0), dropped: f.filter(x => x > 25).length, ...jank() };
        };
        const grid = app.elements.gridView;
        const real = (img) => img && img.src && img.src !== app.BLANK_THUMB && img.complete && img.naturalWidth > 0;
        const visible = () => {
            const box = grid.getBoundingClientRect();
            return [...grid.querySelectorAll('.grid-item')].filter(t => {
                const r = t.getBoundingClientRect();
                return r.bottom > box.top && r.top < box.bottom;
            });
        };
        const shown = () => { const v = visible(); return v.length > 0 && v.every(t => real(t.querySelector(':scope > img'))); };
        const type = (f) => /\.heic$/i.test(f.name) ? 'heic' : /\.dng$/i.test(f.name) ? 'dng' : 'jpeg';
        const done = (f) => f.thumbnailUrl || f._thumbRetries > 3;

        console.log('PERF Open', Math.round(performance.now()));
        // Open (into the grid)
        app.viewMode = 'grid';
        jank();
        const t0 = performance.now();
        let firstThumbs = 0;
        const watch = (async () => { await until(shown); firstThumbs = performance.now() - t0; })();
        if (lib) {
            await app.openDirectory(await JEditorNative.photosAlbum('album:Holiday'));
        } else {
            await app.openDirectory(window.__folder);
        }
        // Opened and empty: say so (and what the page logged) rather than wait
        if (!(await until(() => app.files.length > 0, 120000))) {
            const log = [...document.querySelectorAll('#debug-log > div')].slice(-10).map(d => d.textContent).join('\n');
            throw new Error(`The folder opened with no photos (folder ${app.dirHandle ? app.dirHandle.name : 'none'}, loading ${!!app.isLoading}). The page's log:\n${log}`);
        }
        out.photos = app.files.length;
        out['open: usable'] = ms(performance.now() - t0);
        await watch;
        out['open: first screen of thumbnails'] = ms(firstThumbs);
        out['open: jank'] = jank();

        console.log('PERF Every thumbnail, by type', Math.round(performance.now()));
        // Every thumbnail, by type (the background pre-cache)
        const by = {};
        const pending = new Set(app.files);
        while (pending.size) {
            for (const f of pending) if (done(f)) { pending.delete(f); by[type(f)] = performance.now() - t0; }
            if (performance.now() - t0 > 900000) break;
            await sleep(25);
        }
        for (const [k, v] of Object.entries(by)) out[`all ${k} thumbnails`] = ms(v);
        out['all thumbnails'] = ms(performance.now() - t0);
        out['pre-cache: jank'] = jank();
        if (pending.size) out['thumbnails missing'] = pending.size;

        console.log('PERF Scrolling', Math.round(performance.now()));
        // Scrolling: a third of a screen a frame, top to bottom and back up
        grid.scrollTop = 0;
        await frame(); await frame();
        out['scroll'] = await frames(async () => {
            for (let i = 0; i < 90; i++) { grid.scrollTop += grid.clientHeight / 3; await new Promise(r => requestAnimationFrame(r)); }
            for (let i = 0; i < 90; i++) { grid.scrollTop -= grid.clientHeight / 3; await new Promise(r => requestAnimationFrame(r)); }
        });
        // A jump into the HEICs (by name: CAMERA…, IMG…, IPHONE…)
        const heic = app.viewFiles().find(f => type(f) === 'heic');
        if (heic) {
            const t = performance.now();
            app.revealInGrid(heic).scrollIntoView({ block: 'center' });
            await frame();
            await until(shown, 60000);
            out['jump to the HEICs: shown'] = ms(performance.now() - t);
        }
        grid.scrollTop = Math.round(grid.scrollHeight / 2);
        await frame();
        await until(shown, 60000);

        console.log('PERF Resizing the tiles', Math.round(performance.now()));
        // Resizing the tiles: the slider dragged across and back, then
        // Ctrl+wheel notches
        const slider = app.elements.gridSizeSlider;
        const was = slider.value;
        out['resize (slider)'] = await frames(async () => {
            for (const px of [...Array(16).keys()].map(i => 120 + i * 16).concat([...Array(16).keys()].map(i => 360 - i * 16))) {
                slider.value = px;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(r => requestAnimationFrame(r));
            }
        });
        out['resize (ctrl+wheel)'] = await frames(async () => {
            const r = grid.getBoundingClientRect();
            for (let i = 0; i < 16; i++) {
                grid.dispatchEvent(new WheelEvent('wheel', { deltaY: i < 8 ? -100 : 100, ctrlKey: true, bubbles: true, cancelable: true, clientX: r.left + 100, clientY: r.top + 100 }));
                await new Promise(r => requestAnimationFrame(r));
            }
        });
        slider.value = was;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await frame();
        await until(shown, 60000);

        console.log('PERF Opening a photo from the grid', Math.round(performance.now()));
        // Opening a photo from the grid and going back (the zoom), 6 times:
        // JPEG, HEIC and DNG
        const pick = ['jpeg', 'heic', 'dng', 'jpeg', 'heic', 'dng'].map((k, i) => app.viewFiles().filter(f => type(f) === k)[20 + i]).filter(Boolean);
        const opens = [], backs = [], openF = [], backF = [];
        for (const f of pick) {
            const tile = app.revealInGrid(f);
            tile.scrollIntoView({ block: 'center' });
            await frame();
            await until(shown, 60000);
            await sleep(100);
            let t = performance.now();
            openF.push(await frames(async () => {
                tile.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                await until(() => app.viewMode === 'single' && app._displayFile === f && app.elements.currentImage.complete && app.elements.currentImage.naturalWidth > 0, 30000);
                opens.push(performance.now() - t);
                await sleep(250); // the zoom
            }));
            await sleep(300);
            t = performance.now();
            backF.push(await frames(async () => {
                app.setView('grid');
                await frame();
                backs.push(performance.now() - t);
                await sleep(250);
            }));
            await sleep(150);
        }
        const avg = (a) => ms(a.reduce((x, y) => x + y, 0) / (a.length || 1));
        const sum = (a, k) => a.reduce((x, y) => x + y[k], 0);
        out['open a photo: shown (avg)'] = avg(opens);
        out['open a photo: worst'] = ms(Math.max(...opens));
        out['open a photo: dropped frames'] = sum(openF, 'dropped') + ' of ' + sum(openF, 'frames') + `, long tasks ${sum(openF, 'long')} (longest ${Math.max(...openF.map(x => x.longest))} ms)`;
        out['back to grid: frame (avg)'] = avg(backs);
        out['back to grid: dropped frames'] = sum(backF, 'dropped') + ' of ' + sum(backF, 'frames') + `, long tasks ${sum(backF, 'long')} (longest ${Math.max(...backF.map(x => x.longest))} ms)`;
        if (performance.memory) out['JS heap'] = Math.round(performance.memory.usedJSHeapSize / 1e6) + ' MB';
        return out;
    }, lib);
}

const fmt = (v) => (v && typeof v === 'object'
    ? ('median' in v ? `median ${v.median} / p95 ${v.p95} / worst ${v.worst} ms, ${v.dropped} of ${v.frames} frames dropped, ${v.long} long tasks (longest ${v.longest} ms, ${v.busy} ms busy)`
        : `${v.long} long tasks, longest ${v.longest} ms, ${v.busy} ms busy`)
    : v);

async function main() {
    makePhotos();
    const targets = process.env.ONLY ? [process.env.ONLY] : ['mac', 'web'];
    const results = {};
    for (const target of targets) {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), `jeditor-grid-speed-${target}-`));
        for (const run of ['cold', 'warm']) {
            const s = target === 'mac' ? await launchMac(profile) : target === 'windows' ? await launchWindows(profile) : await launchWeb(profile);
            if (s.windows) await s.page.evaluate(async (dir) => { window.__folder = await window.JEditorNative.folderHandle(dir); }, FOLDER);
            else await dropFolder(s.page, s.cdp, FOLDER);
            // Every 20 s, where it's got to (and any dialog in the way), so
            // a run that stalls on CI says where
            const beat = setInterval(() => s.page.evaluate(() => {
                const grid = app.elements.gridView;
                const tiles = grid ? grid.querySelectorAll('.grid-item').length : 0;
                const thumbs = (app.files || []).filter(f => f.thumbnailUrl).length;
                const open = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog], .modal, .overlay')]
                    .filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed' && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden')
                    .map(e => (e.id || e.className || e.tagName) + ': ' + (e.innerText || '').replace(/\s+/g, ' ').slice(0, 120));
                const log = [...document.querySelectorAll('#debug-log > div')].slice(-4).map(d => d.textContent).join(' / ');
                return `files ${(app.files || []).length}, loading ${!!app.isLoading}, view ${app.viewMode}, tiles ${tiles}, thumbnails ${thumbs}, folder ${app.dirHandle ? app.dirHandle.name : 'none'} (asked ${window.__folder ? window.__folder.name : 'none'})` + (open.length ? `; on screen: ${open.join(' | ')}` : '') + (log ? `; log: ${log}` : '');
            }).then(t => console.log('  ... ' + t), () => {}), 20000);
            const r = await measure(s.page, false).finally(() => clearInterval(beat));
            // The engine's answers as the page saw them: how many, how long
            if (s.windows) console.log('  page saw: ' + await s.page.evaluate(() => {
                const by = {};
                for (const e of performance.getEntriesByType('resource')) {
                    if (!e.name.startsWith('https://engine.jeditor.example/')) continue;
                    const k = (decodeURIComponent(e.name).match(/\.(\w+)$/) || [, '?'])[1].toLowerCase();
                    const b = by[k] = by[k] || { n: 0, ms: 0, most: 0, status: {} };
                    b.n++; b.ms += e.duration; b.most = Math.max(b.most, e.duration);
                    b.status[e.responseStatus] = (b.status[e.responseStatus] || 0) + 1;
                }
                return Object.entries(by).map(([k, b]) => `${k} ${b.n} asked, ${Math.round(b.ms / b.n)} ms each (longest ${Math.round(b.most)}), status ${JSON.stringify(b.status)}`).join('; ') || 'nothing asked of the engine';
            }));
            results[`${target} ${run}`] = r;
            print(`${target}, folder, ${run}`, r);
            if (target === 'mac' && run === 'warm' && N.lib) {
                await s.close();
                const s2 = await launchMac(profile);
                const r2 = await measure(s2.page, true);
                results['mac library'] = r2;
                print('mac, Photos library album (stand-in)', r2);
                await s2.close();
            } else await s.close();
        }
        fs.rmSync(profile, { recursive: true, force: true });
    }
    if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(results, null, 1));
    if (server) server.close();
}

function print(title, r) {
    console.log(`\n== ${title} ==`);
    for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(36)} ${typeof v === 'number' && !/photos|missing/.test(k) ? v + ' ms' : fmt(v)}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { launchMac, launchWeb, launchWindows, dropFolder, measure, FOLDER, LIBRARY };
