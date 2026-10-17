#!/usr/bin/env node
// Tests for the Mac app (mac/): the real Electron app, its bridge and the
// UI together, on folders on disk. Electron runs the same on Linux, so
// these run there too (under xvfb-run); what only macOS has (Finder, the
// built .app) is covered by the smoke test on the Mac runner.
//
//   (cd mac && npm ci) && node test/mac.test.js

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MAC = path.join(ROOT, 'mac');
const ELECTRON = require(path.join(MAC, 'node_modules', 'electron'));

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// A small JPEG, any color (baseline, no EXIF)
const JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAQABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCjRRRXz59kFFFFAH//2Q==',
    'base64');

function makeOrder(dir, name, n = 3) {
    const order = path.join(dir, name);
    fs.mkdirSync(path.join(order, 'Ceremony'), { recursive: true });
    for (let i = 1; i <= n; i++) fs.writeFileSync(path.join(order, `photo${i}.jpg`), JPEG);
    fs.writeFileSync(path.join(order, 'Ceremony', 'c1.jpg'), JPEG);
    return order;
}

// Releases, as GitHub's API gives them, from a server here (JEDITOR_RELEASES)
const releases = { latest: null, files: {} };
const releaseServer = http.createServer((req, res) => {
    if (req.url === '/latest') {
        if (!releases.latest) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(releases.latest));
    }
    const f = releases.files[req.url];
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-length': f.length });
    res.end(f);
});

async function launch(profile, args = [], env = {}) {
    const app = await electron.launch({
        executablePath: ELECTRON,
        args: [MAC, '--no-sandbox', '--user-data', profile, ...args],
        // The Mac app unless a test asks for Linux's (they all run on Linux too)
        env: { ...process.env, JEDITOR_PLATFORM: 'mac', JEDITOR_RELEASES: `http://127.0.0.1:${releaseServer.address().port}/latest`, ...env }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.waitForFunction(() => typeof app !== 'undefined' && app.elements && window.JEditorNative);
    return { app, page, errors };
}

// A PNG (a screenshot) → { width, height, px(x, y) → [r, g, b] }
function readPng(buf) {
    const zlib = require('zlib');
    let pos = 8, width = 0, height = 0, type = 0;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos), kind = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
        if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9]; }
        if (kind === 'IDAT') idat.push(data);
        pos += 12 + len;
    }
    const bpp = type === 6 ? 4 : 3, stride = width * bpp;
    const raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
            out[y * stride + x] = (row[x] + pred) & 255;
        }
    }
    return { width, height, px: (x, y) => [0, 1, 2].map(i => out[y * stride + x * bpp + i]) };
}

// WCAG contrast of two sRGB colors
const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const loaded = (page, n) => page.waitForFunction((n) => !app.isLoading && app.files.length === n, n, { timeout: 20000 });

// A prompt nobody answers would wait for ever: fail instead
setTimeout(() => { console.log('  FAIL  timed out (a permission prompt, or a folder that never opened?)'); process.exit(1); }, 180000).unref();

(async () => {
    await new Promise(r => releaseServer.listen(0, '127.0.0.1', r));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jeditor-mac-'));
    const profile = path.join(tmp, 'profile');
    const smith = makeOrder(tmp, 'Smith Order');
    const jones = makeOrder(tmp, 'Jones', 2);

    console.log('mac: a folder given on the command line');
    {
        const { app, page, errors } = await launch(profile, [smith]);
        await loaded(page, 4);
        const r = await page.evaluate(async () => ({
            platform: Host.platform(),
            scan: getComputedStyle(document.getElementById('btn-scan')).display,
            path: await JEditorNative.folderPath(app.dirHandle),
            perm: await app.dirHandle.queryPermission({ mode: 'readwrite' }),
            files: app.files.map(f => f.relPath || f.name).sort().join()
        }));
        check('opens it, every photo listed', r.files === 'Ceremony/c1.jpg,photo1.jpg,photo2.jpg,photo3.jpg', r.files);
        check('the Mac app, with Mac features only', r.platform === 'mac' && r.scan === 'none', JSON.stringify(r));
        check('it knows the folder\'s path, and may edit it without asking', r.path === smith && r.perm === 'granted', JSON.stringify([r.path, r.perm]));

        // Edits go to disk; the project's data stays out of the folder
        const e = await page.evaluate(async () => {
            const f = app.files.find(x => x.name === 'photo1.jpg');
            await app.rotateImage(f, 90);
            if (f._rotationQueue) await f._rotationQueue;
            Flags.apply('star', [f]);
            await Flags.save();
            const victim = app.files.find(x => x.name === 'photo2.jpg');
            await app.moveToTrash([victim]);
            const toast = [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');
            return { toast };
        });
        const rotated = !fs.readFileSync(path.join(smith, 'photo1.jpg')).equals(JPEG);
        check('a turn is saved into the photo on disk', rotated);
        check('deleting takes it out of the folder, into jEditor\'s trash', !fs.existsSync(path.join(smith, 'photo2.jpg')) && /jEditor's trash/.test(e.toast), e.toast);
        await page.evaluate(() => app.undo());
        check('... and Ctrl+Z puts it back', fs.existsSync(path.join(smith, 'photo2.jpg')));
        check('no .jeditor folder in the project', !fs.existsSync(path.join(smith, '.jeditor')), fs.readdirSync(smith).join());
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.close();
    }

    console.log('mac: opening again another day');
    {
        const { app, page, errors } = await launch(profile);
        const r = await page.evaluate(async () => {
            await Recents.render();
            const names = [...document.querySelectorAll('#recent-list .recent-name')].map(n => n.textContent);
            const rec = (await Recents.list()).find(x => x.name === 'Smith Order');
            const perm = rec && await rec.handle.queryPermission({ mode: 'readwrite' });
            if (rec) await Recents.open(rec);
            const until = Date.now() + 15000;
            while ((app.isLoading || !app.files.length) && Date.now() < until) await new Promise(res => setTimeout(res, 50));
            const f = app.files.find(x => x.name === 'photo1.jpg');
            return { names, perm, files: app.files.length, star: !!(f && Flags.get(f) && Flags.get(f).star), path: await JEditorNative.folderPath(app.dirHandle) };
        });
        check('the folder is under Recent', r.names.includes('Smith Order'), r.names.join());
        check('it opens from there without asking for permission', r.perm === 'granted' && r.files === 4, JSON.stringify(r));
        check('its flags are still there (kept by the app)', r.star);
        check('its path is still known', r.path === smith, r.path);

        // Open folder…: the Mac's own picker (answered here)
        await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, jones);
        await page.evaluate(() => app.browseFolder());
        await loaded(page, 3);
        const picked = await page.evaluate(async () => ({ name: app.dirHandle.name, path: await JEditorNative.folderPath(app.dirHandle) }));
        check('Open folder uses the Mac\'s picker and opens what was picked', picked.name === 'Jones' && picked.path === jones, JSON.stringify(picked));
        await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
        const cancelled = await page.evaluate(() => showDirectoryPicker().then(() => 'opened', e => e.name));
        check('... and canceling it is an AbortError, as in a browser', cancelled === 'AbortError', cancelled);

        // A project from the stored list, by its path
        const byPath = await page.evaluate(async (p) => {
            const ok = await JEditorNative.openPath(p);
            return { ok, name: app.dirHandle.name, exists: await JEditorNative.exists([p, p + '-gone']) };
        }, smith);
        check('a folder opens by its path', byPath.ok && byPath.name === 'Smith Order' && byPath.exists.join() === 'true,false', JSON.stringify(byPath));

        // A subfolder of a known folder: its path from there
        const sub = await page.evaluate(async () => JEditorNative.folderPath(await app.dirHandle.getDirectoryHandle('Ceremony')));
        check('a folder inside a known one has its path too', sub === path.join(smith, 'Ceremony'), sub);
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.close();
    }

    console.log('mac: several windows');
    {
        const { app, page, errors } = await launch(profile, [smith]);
        await loaded(page, 4);
        const opened = app.waitForEvent('window');
        await page.evaluate((p) => Windows.newWindow(p), jones);
        const second = await opened;
        const errors2 = [];
        second.on('pageerror', e => errors2.push(e.message));
        await second.waitForFunction(() => typeof app !== 'undefined' && app.elements && !app.isLoading && app.files.length === 3, null, { timeout: 20000 });
        check('a new window opens the other project', await second.evaluate(() => app.dirHandle.name) === 'Jones');

        // Each sees the other's project, for Move to
        await second.waitForTimeout(800); // setState is sent a moment after loading
        const others = await page.evaluate(() => Windows.refreshOthers().then(o => o.map(w => [w.name, w.path, w.folders.join('|')])));
        check('the other window\'s project is listed, with its folders', others.length === 1 && others[0][0] === 'Jones' && others[0][1] === jones && others[0][2].includes('Ceremony'), JSON.stringify(others));

        // Moved into Jones from Smith's window; the name taken there gets (2)
        const moved = await page.evaluate(async (dest) => {
            const p = Windows.pathOf(app.files.find(f => f.name === 'photo2.jpg'));
            return Windows.send([p], dest, '', false, 'Jones');
        }, jones);
        check('a photo moves into the other project, under a free name', moved.length === 1 && moved[0].to === path.join(jones, 'photo2 (2).jpg') && !fs.existsSync(path.join(smith, 'photo2.jpg')) && fs.existsSync(path.join(jones, 'photo2 (2).jpg')), JSON.stringify(moved));
        await second.waitForFunction(() => app.files.some(f => f.name === 'photo2 (2).jpg'), null, { timeout: 10000 }).catch(() => { });
        check('... and the other window shows it', await second.evaluate(() => app.files.some(f => f.name === 'photo2 (2).jpg')));
        await page.evaluate(() => app.undo());
        check('Ctrl+Z moves it back', fs.existsSync(path.join(smith, 'photo2.jpg')) && !fs.existsSync(path.join(jones, 'photo2 (2).jpg')));

        // Copied into Jones's Ceremony folder; undo removes the copy
        const copied = await page.evaluate(async (dest) => {
            const p = Windows.pathOf(app.files.find(f => f.name === 'photo1.jpg'));
            return Windows.send([p], dest, 'Ceremony', true, 'Jones');
        }, jones);
        const copyTo = path.join(jones, 'Ceremony', 'photo1.jpg');
        check('a photo is copied into a folder of the other project', copied[0] && copied[0].to === copyTo && fs.existsSync(copyTo) && fs.existsSync(path.join(smith, 'photo1.jpg')), JSON.stringify(copied));
        await page.evaluate(() => app.undo());
        check('Ctrl+Z removes the copy, the original stays', !fs.existsSync(copyTo) && fs.existsSync(path.join(smith, 'photo1.jpg')));

        // Split: side by side
        await page.evaluate(() => Windows.split());
        const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.getBounds()).sort((a, b) => a.x - b.x));
        check('Split puts the two side by side, half each', bounds.length === 2 && bounds[0].width === bounds[1].width && bounds[1].x === bounds[0].x + bounds[0].width && bounds[0].y === bounds[1].y, JSON.stringify(bounds));

        // A folder already open: its window comes forward, no new one
        await page.evaluate((p) => Windows.newWindow(p), jones);
        await page.waitForTimeout(500);
        check('opening a folder that\'s open in a window doesn\'t open another', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 2);
        check('no JS errors', errors.length === 0 && errors2.length === 0, errors.concat(errors2).join('; '));
        await app.close();
    }

    console.log('mac: the sidebar');
    {
        // Drives: a folder standing in for /Volumes (JEDITOR_VOLUMES)
        const volumes = path.join(tmp, 'Volumes');
        const backup = path.join(volumes, 'Backup');
        fs.mkdirSync(backup, { recursive: true });
        const projectsDir = path.join(tmp, 'Projects');
        fs.mkdirSync(projectsDir);
        const alpha = makeOrder(projectsDir, 'Alpha', 2);
        // Many photos, for stopping a copy part way
        const many = path.join(tmp, 'Many');
        fs.mkdirSync(many);
        for (let i = 0; i < 3000; i++) fs.writeFileSync(path.join(many, `p${i}.jpg`), JPEG);
        const { app, page, errors } = await launch(profile, [], { JEDITOR_VOLUMES: volumes });
        await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, projectsDir);
        const r = await page.evaluate(async (p) => {
            const box = document.getElementById('start-places');
            const shown = getComputedStyle(box).display !== 'none';
            await Places.chooseFolder();
            const places = await JEditorNative.places();
            return {
                shown,
                drives: places.drives.map(d => [d.name, d.kind, d.total > 0 && d.free > 0]),
                heading: [...box.querySelectorAll('.sb-sec-btn')].map(t => t.textContent.trim()),
                projects: [...box.querySelectorAll('.sb-projects .fr-name')].map(n => n.textContent),
                counts: (await JEditorNative.countPhotos([p.alpha, p.smith, p.alpha + '-gone'])).counts,
                listing: await JEditorNative.listDir(p.alpha)
            };
        }, { alpha, smith });
        check('the sidebar is there on the start screen', r.shown);
        check('drives are listed, under Locations, with their room', JSON.stringify(r.drives) === '[["Backup","usb",true]]' && r.heading.includes('Locations') && !r.heading.includes('This PC'), JSON.stringify([r.drives, r.heading]));
        check('the projects folder (chosen with the Mac\'s picker) lists its projects', r.projects.includes('Alpha'), r.projects.join());
        check('photos are counted, in subfolders too; a folder gone is -1', r.counts.join() === '3,4,-1', r.counts.join());
        check('a folder\'s folders and photos', r.listing.photos === 2 && r.listing.folders.map(f => f.name).join() === 'Ceremony' && r.listing.parent === projectsDir, JSON.stringify(r.listing));

        // New project: a folder in the projects folder, opened
        await page.evaluate(async () => {
            UI.prompt = async () => 'Gamma';
            await Places.newProject();
            const until = Date.now() + 10000;
            while ((!app.dirHandle || app.dirHandle.name !== 'Gamma') && Date.now() < until) await new Promise(res => setTimeout(res, 50));
        });
        check('New project makes the folder and opens it', fs.existsSync(path.join(projectsDir, 'Gamma')) && await page.evaluate(() => app.dirHandle && app.dirHandle.name) === 'Gamma');

        // Rename: the folder on disk, and the data kept for it follows
        const renamed = await page.evaluate(async (p) => {
            await JEditorNative.openPath(p.alpha);
            Flags.apply('star', [app.files.find(f => f.name === 'photo1.jpg')]);
            await Flags.save();
            await app.closeFolder();
            const to = await JEditorNative.renameFolder(p.alpha, 'Alpha Smith');
            const all = await JEditorNative.dataDir();
            const names = [];
            for await (const [n] of all.entries()) names.push(n);
            const store = await all.getDirectoryHandle(FolderCache.storeName(to)).catch(() => null);
            const order = store && JSON.parse(await (await (await store.getFileHandle('order.json')).getFile()).text());
            const flags = store && JSON.parse(await (await (await store.getFileHandle('flags.json')).getFile()).text());
            return { to, oldStore: names.includes(FolderCache.storeName(p.alpha)), orderPath: order && order.path, star: !!(flags && flags.flags['photo1.jpg'] && flags.flags['photo1.jpg'].star) };
        }, { alpha });
        const alphaTo = path.join(projectsDir, 'Alpha Smith');
        check('Rename renames the folder on disk', renamed.to === alphaTo && fs.existsSync(alphaTo) && !fs.existsSync(alpha), renamed.to);
        check('... and its flags go with it', renamed.star && renamed.orderPath === alphaTo && !renamed.oldStore, JSON.stringify(renamed));

        // A whole folder onto the drive; again: a free name
        const copied = await page.evaluate(async (p) => {
            const seen = [];
            const a = await JEditorNative.copyFolder(p.jones, p.backup, (d, t) => seen.push([d, t]));
            const b = await JEditorNative.copyFolder(p.jones, p.backup, () => { });
            return { a, b, seen };
        }, { jones, backup });
        check('a folder is copied onto a drive, saying how far it\'s got', copied.a.to === path.join(backup, 'Jones') && fs.existsSync(path.join(backup, 'Jones', 'Ceremony', 'c1.jpg')) && copied.seen.length >= 2, JSON.stringify(copied));
        check('... copied again, it gets a free name', copied.b.to === path.join(backup, 'Jones (2)'));
        const stopped = await page.evaluate(async (p) => {
            let job = null, asked = false;
            job = JEditorNative.copyFolder(p.many, p.backup, () => { if (!asked && job) { asked = true; JEditorNative.cancelCopy(job.copyId); } });
            return job;
        }, { many, backup });
        check('Stop ends a copy and leaves nothing half done', stopped.cancelled === true && !fs.existsSync(path.join(backup, 'Many')), JSON.stringify(stopped) + ' ' + fs.readdirSync(backup).join());

        // Eject: gone from the list
        const ejected = await page.evaluate(async (p) => {
            const r = await JEditorNative.eject(p.backup);
            const until = Date.now() + 5000;
            while (Places.drives && Places.drives.some(d => d.name === 'Backup') && Date.now() < until) await new Promise(res => setTimeout(res, 100));
            return { r, listed: (Places.drives || []).map(d => d.name) };
        }, { backup });
        check('Eject ejects the drive, and it leaves the list', ejected.r.ok && !ejected.listed.includes('Backup'), JSON.stringify(ejected));
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.close();
    }

    console.log('mac: Liquid Glass');
    {
        // Photos to put the glass over: pure white, pure black
        const glass = path.join(tmp, 'Glass');
        fs.mkdirSync(glass);
        // The page's own top row (macOS 26 has the native toolbar instead: below)
        const { app, page, errors } = await launch(profile, [], { JEDITOR_NATIVE_TOOLBAR: '0' });
        const made = await page.evaluate(async () => {
            const out = {};
            for (const [name, color] of [['1-white.jpg', '#fff'], ['2-black.jpg', '#000']]) {
                const c = new OffscreenCanvas(1600, 1067);
                const g = c.getContext('2d');
                g.fillStyle = color;
                g.fillRect(0, 0, 1600, 1067);
                const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
                out[name] = btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())));
            }
            return out;
        });
        for (const [name, b64] of Object.entries(made)) fs.writeFileSync(path.join(glass, name), Buffer.from(b64, 'base64'));
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
        // The glass as most Macs have it; CI's Macs ask for reduced
        // transparency (that's checked on its own, below)
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
        await page.evaluate((p) => JEditorNative.openPath(p), glass);
        await loaded(page, 2);

        // The pill's glass alone (its text hidden), over each photo, against
        // the theme's text colors
        const measure = async (theme, i) => {
            await page.evaluate(async ([t, i]) => {
                app.uiPrefs.theme = t;
                app.uiPrefs.glass = 'rich';
                app.applyUiPrefs();
                app.setView('single');
                app.loadIndex(i);
                await new Promise(r => setTimeout(r, 900));
                const s = document.createElement('style');
                s.id = 'hide-text';
                s.textContent = '.file-info, .file-info * { color: transparent !important; } .file-info svg { visibility: hidden; }';
                document.head.appendChild(s);
            }, [theme, i]);
            await page.waitForTimeout(300);
            const box = await page.evaluate(() => {
                const r = document.querySelector('.file-info').getBoundingClientRect();
                const probe = document.createElement('span');
                document.body.appendChild(probe);
                const color = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color.match(/\d+/g).slice(0, 3).map(Number); };
                const out = { x: r.x, y: r.y, w: r.width, h: r.height, dpr: devicePixelRatio, text1: color('--text-1'), text2: color('--text-2') };
                probe.remove();
                return out;
            });
            const png = readPng(await page.screenshot());
            // The middle of the pill, clear of its rim
            const samples = [];
            // (in screen pixels: twice the page's on a Retina screen)
            for (let dx = 0.3; dx <= 0.7; dx += 0.1) samples.push(png.px(Math.round((box.x + box.w * dx) * box.dpr), Math.round((box.y + box.h / 2) * box.dpr)));
            const bg = [0, 1, 2].map(k => Math.round(samples.reduce((s, c) => s + c[k], 0) / samples.length));
            await page.evaluate(() => document.getElementById('hide-text').remove());
            return { bg, c1: +contrast(box.text1, bg).toFixed(2), c2: +contrast(box.text2, bg).toFixed(2) };
        };
        const m = {};
        for (const theme of ['dark', 'light']) for (const [i, photo] of [[0, 'white'], [1, 'black']]) m[`${theme} over ${photo}`] = await measure(theme, i);
        const worst = Object.entries(m).sort((a, b) => a[1].c2 - b[1].c2)[0];
        check('the glass keeps text readable over any photo: 7:1 for text, 4.5:1 for secondary text (measured on screen)',
            Object.values(m).every(v => v.c1 >= 7 && v.c2 >= 4.5), JSON.stringify(m));
        console.log(`        (lowest: secondary text ${worst[1].c2}:1, ${worst[0]})`);

        const r = await page.evaluate(async () => {
            const out = {};
            const css = (sel, prop) => getComputedStyle(document.querySelector(sel)).getPropertyValue(prop);
            out.platform = document.documentElement.dataset.platform;
            out.filter = css('.file-info', 'backdrop-filter');
            out.rim = css('.file-info', 'box-shadow');
            // The photo itself is never under glass
            app.loadIndex(0);
            await new Promise(r => setTimeout(r, 600));
            const img = document.getElementById('current-image');
            const ir = img && img.getBoundingClientRect();
            const top = ir && document.elementFromPoint(ir.x + ir.width / 2, ir.y + ir.height / 2);
            out.photoClear = !!top && (top === img || img.contains(top) || top.contains(img));
            out.photoFilter = img && getComputedStyle(img).backdropFilter;
            // Room for the traffic lights, given back in full screen
            app.setView('grid');
            await new Promise(r => setTimeout(r, 400));
            const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter'));
            out.lightsRoom = document.querySelector('.folder-bar').getBoundingClientRect().left - gutter;
            document.documentElement.classList.add('fullscreen');
            out.fullscreenRoom = document.querySelector('.folder-bar').getBoundingClientRect().left - gutter;
            document.documentElement.classList.remove('fullscreen');
            // The top row moves the window; buttons in it don't
            out.drag = getComputedStyle(document.body, '::before').getPropertyValue('-webkit-app-region') || getComputedStyle(document.body, '::before').getPropertyValue('app-region');
            out.noDrag = getComputedStyle(document.querySelector('#header-controls button')).getPropertyValue('-webkit-app-region') || getComputedStyle(document.querySelector('#header-controls button')).getPropertyValue('app-region');
            // Glass: Off is solid
            app.uiPrefs.glass = 'off';
            app.applyUiPrefs();
            out.offFilter = css('.file-info', 'backdrop-filter');
            out.offBg = css('.file-info', 'background-color');
            app.uiPrefs.glass = 'rich';
            app.applyUiPrefs();
            return out;
        });
        check('the Mac\'s glass: blurred, with light along its edge', r.platform === 'mac' && /blur\(20px\)/.test(r.filter) && /inset/.test(r.rim), JSON.stringify([r.filter, r.rim]));
        check('the photo is never under glass', r.photoClear && (!r.photoFilter || r.photoFilter === 'none'), JSON.stringify([r.photoClear, r.photoFilter]));
        check('the traffic lights get their room, and give it back in full screen', r.lightsRoom === 72 && r.fullscreenRoom === 0, JSON.stringify([r.lightsRoom, r.fullscreenRoom]));
        check('the top row moves the window, its buttons don\'t', r.drag === 'drag' && r.noDrag === 'no-drag', JSON.stringify([r.drag, r.noDrag]));
        check('Glass: Off is solid', r.offFilter === 'none' && /^rgb\(/.test(r.offBg), JSON.stringify([r.offFilter, r.offBg]));
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
        const offReduced = await page.evaluate(() => {
            app.uiPrefs.glass = 'off';
            app.applyUiPrefs();
            const bg = getComputedStyle(document.querySelector('.file-info')).backgroundColor;
            app.uiPrefs.glass = 'rich';
            app.applyUiPrefs();
            return bg;
        });
        check('... even with reduced transparency', /^rgb\(/.test(offReduced), offReduced);

        // Reduce transparency (System Settings → Accessibility): solid
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
        const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches && getComputedStyle(document.querySelector('.file-info')).backdropFilter);
        await cdp.send('Emulation.setEmulatedMedia', { features: [] });
        check('Reduce transparency makes the glass solid', reduced === 'none', reduced);
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.close();
    }

    console.log('mac: the native toolbar (macOS 26)');
    {
        const { app, page, errors } = await launch(profile, [path.join(tmp, 'Glass')]);
        const native = await page.evaluate(() => !!window.jeditorMac.nativeToolbar);
        if (!native) {
            console.log('        (skipped: needs macOS 26 and the native module, native/build.js)');
        } else {
            await loaded(page, 2);
            const describe = () => app.evaluate(({ BrowserWindow }) => global.jeditorToolbar.describe(BrowserWindow.getAllWindows()[0].getNativeWindowHandle()));
            const click = (id, value) => app.evaluate(({ BrowserWindow }, [id, value]) => global.jeditorToolbar.click(BrowserWindow.getAllWindows()[0].getNativeWindowHandle(), id, value), [id, value]);
            const settle = () => page.waitForTimeout(400);
            await page.evaluate(() => { app.setView('single'); app.loadIndex(0); });
            await settle();
            let d = await describe();
            const ids = d.items.map(i => i.id);
            check('the toolbar is the top row: in Liquid Glass, the page\'s own pills gone', d.visible && d.glass && await page.evaluate(() => getComputedStyle(document.querySelector('header')).display === 'none'), JSON.stringify(d).slice(0, 300));
            const edge = await page.evaluate(() => {
                const band = getComputedStyle(document.getElementById('main-interface'), '::before');
                const photo = document.getElementById('current-image').getBoundingClientRect();
                return { band: band.content !== 'none' ? parseFloat(band.height) : 0, photoTop: photo.top };
            });
            check('the title always has a backing (the toolbar\'s edge), and the photo starts below it, untouched', edge.band >= 52 && edge.photoTop >= edge.band, JSON.stringify(edge));
            check('... its title is the photo, its subtitle the project and where it is in it', d.title === '1-white.jpg' && /Glass/.test(d.subtitle) && /1 \/ 2/.test(d.subtitle), JSON.stringify([d.title, d.subtitle]));
            check('... with the page\'s controls: sort, info, view, crop, More (Rename… first)', ['sort', 'hc:info', 'hc:view', 'hc:crop', 'more'].every(i => ids.includes(i)) && d.items.find(i => i.id === 'more').menu[0] === 'Rename…' && d.items.find(i => i.id === 'sort').menu.includes('✓Name (A–Z)'), JSON.stringify(d.items));
            await click('hc:view');
            await settle();
            d = await describe();
            const view = await page.evaluate(() => app.viewMode);
            check('a click is the page\'s own: the grid, with the folders and search there now', view === 'grid' && ['rail', 'scope', 'search'].every(i => d.items.some(x => x.id === i)), JSON.stringify([view, d.items.map(i => i.id)]));
            await click('sort', 'name_desc');
            await settle();
            d = await describe();
            check('sorting from the toolbar sorts, and its menu says so', await page.evaluate(() => app.sortMode) === 'name_desc' && d.items.find(i => i.id === 'sort').menu.includes('✓Name (Z–A)'), JSON.stringify(d.items.find(i => i.id === 'sort')));
            await click('search', 'black');
            await page.waitForTimeout(600);
            check('searching from the toolbar finds photos', await page.evaluate(() => app.viewFiles().map(f => f.name).join()) === '2-black.jpg');
            await click('search', '');
            await page.waitForTimeout(600);

            // What it looks like: the window, toolbar and all (CI keeps these)
            const shots = process.env.JEDITOR_SCREENSHOTS;
            if (shots) {
                fs.mkdirSync(shots, { recursive: true });
                const { execFileSync } = require('child_process');
                for (const [theme, i, view] of [['dark', 0, 'single'], ['light', 0, 'single'], ['dark', 1, 'single'], ['light', 1, 'grid']]) {
                    await page.evaluate(([t, i, v]) => { app.uiPrefs.theme = t; app.applyUiPrefs(); app.setView(v); app.loadIndex(i); }, [theme, i, view]);
                    await page.waitForTimeout(1200);
                    const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId().split(':')[1]);
                    try { execFileSync('screencapture', ['-x', '-o', `-l${id}`, path.join(shots, `native-${theme}-${view}-${i}.png`)]); } catch (e) { console.log('        (no screenshot: ' + e.message + ')'); }
                }
            }

            await page.evaluate(() => app.closeFolder());
            await settle();
            d = await describe();
            check('on the start screen, no toolbar', d.visible === false, JSON.stringify(d).slice(0, 200));
        }
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.close();
    }

    console.log('mac: updates');
    {
        const port = releaseServer.address().port;
        const dmg = crypto.randomBytes(3 * 1024 * 1024 + 17);
        const release = (digest) => ({
            tag_name: 'v9.1.0', body: '## What\'s new\n- Faster\n- Better',
            assets: [
                { name: 'jEditor-Setup-9.1.0.exe', browser_download_url: `http://127.0.0.1:${port}/setup`, size: 1 },
                { name: 'jEditor-9.1.0-mac.dmg', browser_download_url: `http://127.0.0.1:${port}/dmg`, size: dmg.length, digest: 'sha256:' + digest }
            ]
        });
        releases.files['/dmg'] = dmg;
        releases.latest = release(crypto.createHash('sha256').update(dmg).digest('hex'));
        const downloads = path.join(tmp, 'Downloads');
        fs.mkdirSync(downloads);
        const { app, page, errors } = await launch(profile);
        await app.evaluate(({ app, shell }, d) => {
            app.setPath('downloads', d);
            global.opened = [];
            shell.openPath = async (p) => { global.opened.push(p); return ''; };
            global.realQuit = app.quit;
            app.quit = () => { global.quitAsked = true; };
        }, downloads);
        const r = await page.evaluate(async () => {
            const shown = getComputedStyle(document.querySelector('[data-page="updates"]')).display !== 'none';
            const check = await JEditorNative.checkUpdate();
            const seen = [];
            await JEditorNative.installUpdate((got, total) => seen.push([got, total]));
            return { shown, check, seen };
        });
        await new Promise(res => setTimeout(res, 1800));
        const main = await app.evaluate(() => ({ opened: global.opened, quit: !!global.quitAsked }));
        const file = path.join(downloads, 'jEditor-9.1.0-mac.dmg');
        check('Settings has Updates', r.shown);
        check('a newer release is found, with its notes', r.check.newer && r.check.version === '9.1.0' && /Faster/.test(r.check.notes), JSON.stringify(r.check));
        check('its .dmg downloads (progress as it goes), checked against its SHA-256', fs.existsSync(file) && fs.readFileSync(file).equals(dmg) && r.seen.length >= 2 && r.seen.every(([got, total], i) => total === dmg.length && (!i || got > r.seen[i - 1][0])) && r.seen[r.seen.length - 1][0] === dmg.length, JSON.stringify(r.seen));
        check('... opens in Finder, and jEditor quits so it can be replaced', main.opened.join() === file && main.quit, JSON.stringify(main));

        // A damaged download is thrown away; an older release isn't offered
        fs.rmSync(file);
        releases.latest = release('0'.repeat(64));
        const bad = await page.evaluate(async () => {
            await JEditorNative.checkUpdate();
            return JEditorNative.installUpdate(() => { }).then(() => 'installed', e => e.message);
        });
        check('a damaged download says so, and leaves nothing behind', /damaged/.test(bad) && fs.readdirSync(downloads).length === 0, bad + ' ' + fs.readdirSync(downloads).join());
        releases.latest = { ...release('0'.repeat(64)), tag_name: 'v1.0.0' };
        const old = await page.evaluate(() => JEditorNative.checkUpdate().then(r => r.newer));
        check('an older release isn\'t offered', old === false);
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.evaluate(({ app }) => { app.quit = global.realQuit; });
        await app.close();
    }

    console.log('linux: the same app, with Linux\'s words, and an AppImage that updates itself');
    {
        const port = releaseServer.address().port;
        const image = crypto.randomBytes(2 * 1024 * 1024 + 5);
        releases.files['/appimage'] = image;
        releases.latest = {
            tag_name: 'v9.2.0', body: '- Linux',
            assets: [
                { name: 'jEditor-9.1.0-mac.dmg', browser_download_url: `http://127.0.0.1:${port}/dmg`, size: 1 },
                { name: 'jEditor-9.2.0-linux.AppImage', browser_download_url: `http://127.0.0.1:${port}/appimage`, size: image.length, digest: 'sha256:' + crypto.createHash('sha256').update(image).digest('hex') }
            ]
        };
        const appImage = path.join(tmp, 'jEditor.AppImage');
        fs.writeFileSync(appImage, 'the old one');
        const { app, page, errors } = await launch(path.join(tmp, 'profile-linux'), [smith], { JEDITOR_PLATFORM: 'linux', APPIMAGE: appImage });
        await loaded(page, 4);
        await app.evaluate(({ app }) => {
            global.realQuit = app.quit;
            app.quit = () => { global.quitAsked = true; };
            app.relaunch = (o) => { global.relaunched = o.execPath; };
        });
        const r = await page.evaluate(async () => {
            await JEditorNative.checkUpdate();
            await JEditorNative.installUpdate(() => { });
            return {
                platform: Host.platform(), data: document.documentElement.dataset.platform,
                files: Host.say('Show in {files}'), keys: Host.say('Ctrl+Z to undo'), computer: Host.say('{computer}'),
                updates: Host.has('updates'), scan: Host.has('scan'), recycle: Host.has('recycle')
            };
        });
        await new Promise(res => setTimeout(res, 1800));
        const main = await app.evaluate(() => ({ relaunched: global.relaunched, quit: !!global.quitAsked }));
        check('the Linux app, with Linux\'s words: Files, Ctrl', r.platform === 'linux' && r.data === 'linux' && r.files === 'Show in Files' && r.keys === 'Ctrl+Z to undo' && r.computer === 'this computer', JSON.stringify(r));
        check('no Windows-only features', r.updates && !r.scan && !r.recycle, JSON.stringify(r));
        check('the new AppImage replaces this one, runnable, and jEditor restarts in it', fs.readFileSync(appImage).equals(image) && (fs.statSync(appImage).mode & 0o111) !== 0 && main.relaunched === appImage && main.quit, JSON.stringify(main));
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.evaluate(({ app }) => { app.quit = global.realQuit; });
        await app.close();
    }

    releaseServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
