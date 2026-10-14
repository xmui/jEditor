#!/usr/bin/env node
// Tests for what jEditor does differently in the Windows app: order data
// kept on the PC instead of in .jeditor, deleting to the Recycle Bin, the
// Stored orders list and updates. The real UI runs in headless Chromium
// with a fake window.JEditorNative (what src/bridge.js provides in the app),
// backed by the browser's private file system: one folder stands in for the
// order on disk, one for jEditor's storage and one for the Recycle Bin.
//
//   node test/native.test.js    (npm test runs it too)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { createServer } = require('../scripts/serve.js');

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

// The fake app. The order lives in OPFS "disk/<name>", standing for
// D:\Orders\<name>; jEditor's storage is OPFS "appdata"; the Recycle Bin is
// OPFS "bin". window.__noBin makes the drive have no Recycle Bin.
const FAKE_NATIVE = `
    const BS = String.fromCharCode(92);
    window.__drives = [
        { path: 'C:' + BS, name: 'Local disk (C:)', kind: 'disk', total: 1e12, free: 5e11 },
        { path: 'E:' + BS, name: 'USB drive (E:)', kind: 'usb', total: 64e9, free: 1e9 }
    ];
    window.__tree = {
        ['E:' + BS]: { path: 'E:' + BS, name: 'E:' + BS, parent: null, folders: [{ name: 'Order 10', path: 'E:' + BS + 'Order 10' }, { name: 'Order 9', path: 'E:' + BS + 'Order 9' }], photos: 0, more: false },
        ['E:' + BS + 'Order 9']: { path: 'E:' + BS + 'Order 9', name: 'Order 9', parent: 'E:' + BS, folders: [], photos: 12, more: false }
    };
    window.__orderRoot = 'D:\\\\Orders';
    window.__calls = [];
    const opfs = () => navigator.storage.getDirectory();
    const sub = async (name) => (await opfs()).getDirectoryHandle(name, { create: true });
    // Paths: disk/ is the folder __orderRoot, so disk/Smith/a.jpg is D:\\Orders\\Smith\\a.jpg
    const locate = async (path) => {
        const root = window.__orderRoot + '\\\\';
        if (!path.startsWith(root)) return null;
        const parts = path.slice(root.length).split('\\\\');
        let dir = await sub('disk');
        try {
            for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
            await dir.getFileHandle(parts[parts.length - 1]);
        } catch (e) {
            return null;
        }
        return { dir, name: parts[parts.length - 1] };
    };
    const tokens = new Map();
    window.JEditorNative = {
        async dataDir() { window.__calls.push('dataDir'); return sub('appdata'); },
        async folderPath(handle) {
            if (window.__unknownPath) return null;
            const parts = await (await sub('disk')).resolve(handle);
            return parts ? [window.__orderRoot, ...parts].join('\\\\') : null;
        },
        async recycle(paths) {
            window.__calls.push('recycle:' + paths.length);
            window.__recycled = (window.__recycled || []).concat(paths);
            const bin = await sub('bin');
            const out = [];
            for (const path of paths) {
                if (window.__noBin) { out.push({ noBin: true }); continue; }
                const hit = await locate(path);
                if (!hit) { out.push({ gone: true }); continue; }
                const token = 't' + tokens.size;
                const b = await bin.getFileHandle(token, { create: true });
                const w = await b.createWritable();
                await w.write(await (await hit.dir.getFileHandle(hit.name)).getFile());
                await w.close();
                await hit.dir.removeEntry(hit.name);
                tokens.set(token, hit);
                out.push({ token });
            }
            return out;
        },
        async restore(list) {
            const bin = await sub('bin');
            const out = [];
            for (const t of list) {
                const hit = tokens.get(t);
                if (!hit) { out.push({ error: 'unknown' }); continue; }
                const data = await (await bin.getFileHandle(t)).getFile();
                const h = await hit.dir.getFileHandle(hit.name, { create: true });
                const w = await h.createWritable();
                await w.write(data);
                await w.close();
                await bin.removeEntry(t);
                tokens.delete(t);
                out.push({ ok: true });
            }
            return out;
        },
        async scanners() {
            window.__calls.push('scanners');
            return window.__scanners || { devices: [{ id: 'EPSON FF-680W', name: 'EPSON FF-680W', driver: 'twain' }, { id: 'wia-1', name: 'OpticBook A300', driver: 'wia' }], problems: [] };
        },
        // The app's side: pages into the folder at that path, each reported as it lands
        async scan(o, scanned) {
            window.__scanReq = o;
            // A scanner whose window never shows: only Stop ends it
            if (window.__scanHang) {
                await new Promise(r => { window.__unhang = r; });
                return { count: 0, names: [], cancelled: true };
            }
            const root = window.__orderRoot + '\\\\';
            let dir = await sub('disk');
            for (const p of o.folder.slice(root.length).split('\\\\')) dir = await dir.getDirectoryHandle(p);
            const pages = o.crops ? o.crops.length : window.__scanPages || 2;
            const ext = o.format === 'tiff' ? '.tif' : o.format === 'png' ? '.png' : '.jpg';
            const sides = o.source === 'feeder' && o.sides === 'both' ? ['', '-b'] : [''];
            for (let i = 0; i < pages * sides.length; i++) {
                const name = o.prefix + String(o.next + Math.floor(i / sides.length)).padStart(o.digits, '0') + sides[i % sides.length] + ext;
                const c = document.createElement('canvas');
                c.width = 80; c.height = 60;
                c.getContext('2d').fillRect(0, 0, 5 + i, 5 + o.next);
                const blob = await new Promise(r => c.toBlob(r, 'image/jpeg'));
                const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
                await w.write(blob);
                await w.close();
                scanned(name);
            }
            if (window.__scanError) throw Object.assign(new Error(window.__scanError), { code: window.__scanCode || null, names: [] });
            return { count: pages };
        },
        cancelScan() { window.__cancelled = true; if (window.__unhang) window.__unhang(); },
        // Tethered shooting: the app's side, with a camera that shoots RAW + JPEG
        async cameras() {
            return window.__cameras || [{ id: 'cam-1', name: 'Sony A7 III', ready: true, note: null }, { id: 'cam-2', name: 'Sony A7 IV', ready: false, note: 'Connected for file transfer.' }];
        },
        async tether(o, event) {
            window.__tetherReq = o;
            window.__tetherCalls = [];
            const root = window.__orderRoot + BS;
            let dir = await sub('disk');
            const rel = o.folder.length > root.length ? o.folder.slice(root.length) : '';
            for (const p of rel.split(BS).filter(Boolean)) dir = await dir.getDirectoryHandle(p);
            const names = [];
            let n = o.next;
            window.__tetherFrames = 0;
            const frame = () => {
                const c = document.createElement('canvas');
                c.width = 60; c.height = 40;
                c.getContext('2d').fillRect(0, 0, 10 + window.__tetherFrames++, 10);
                event({ kind: 'frame', image: c.toDataURL('image/jpeg') });
            };
            window.__tetherAck = () => { if (window.__tetherLive && window.__tetherFrames < 5) setTimeout(frame, 10); };
            window.__tetherLiveSet = (on) => { window.__tetherLive = on; if (on) frame(); };
            window.__tetherShoot = async () => {
                const name = o.prefix + String(n++).padStart(o.digits, '0');
                for (const ext of ['.arw', '.jpg']) {
                    const c = document.createElement('canvas');
                    c.width = 90; c.height = 60;
                    c.getContext('2d').fillRect(0, 0, 20, n);
                    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg'));
                    const w = await (await dir.getFileHandle(name + ext, { create: true })).createWritable();
                    await w.write(blob);
                    await w.close();
                    names.push(name + ext);
                    event({ kind: 'saved', name: name + ext });
                }
            };
            setTimeout(() => {
                event({ kind: 'connected', name: o.name });
                window.__tetherLive = o.live;
                if (o.live) frame();
            }, 20);
            return new Promise((resolve, reject) => {
                window.__tetherEnd = (error) => {
                    if (error) { const e = new Error(error); e.names = names; reject(e); } else resolve({ count: names.length, names });
                };
            });
        },
        tetherShoot() { window.__tetherCalls.push('shoot'); window.__tetherShoot(); },
        tetherLive(on) { window.__tetherCalls.push('live ' + on); window.__tetherLiveSet(on); },
        tetherAck() { window.__tetherAck && window.__tetherAck(); },
        tetherStop() { window.__tetherEnd(null); },
        tetherSet(o) { window.__tetherCalls.push('set ' + JSON.stringify(o)); },
        // Preview and crop: an 8.5 × 11.7 in glass with three prints on a pale lid
        async scanCaps(o) {
            window.__capsReq = o;
            const special = window.__capsFor && window.__capsFor(o);
            if (special) return special;
            // The FastFoto: a feeder (both sides); the OpticBook: a glass
            if (/EPSON/.test(o.device)) return { bedW: 8.5, bedH: 11.7, dpis: [75, 150, 300, 600, 1200], gray: true, guessed: false, flatbed: false, feeder: true, duplex: true, feedW: 8.5, feedH: 14 };
            return { bedW: 8.5, bedH: 11.7, dpis: [75, 150, 300, 600, 1200], gray: true, guessed: false, flatbed: true, feeder: false, duplex: false };
        },
        async scanPreview(o) {
            window.__previewReq = o;
            if (window.__previewHang) {
                await new Promise(r => { window.__unhang = r; });
                return null;
            }
            const c = document.createElement('canvas');
            c.width = Math.round(o.bedW * o.dpi);
            c.height = Math.round(o.bedH * o.dpi);
            const g = c.getContext('2d');
            g.fillStyle = 'rgb(242,242,240)';
            g.fillRect(0, 0, c.width, c.height);
            const prints = window.__prints || [[0.5, 0.5, 4, 3, '#4a6eaa'], [5, 0.7, 3, 4, '#963c5a'], [1, 5, 6, 4, '#287850']];
            for (const [x, y, w, h, col] of prints) {
                g.fillStyle = col;
                g.fillRect(x * o.dpi, y * o.dpi, w * o.dpi, h * o.dpi);
            }
            return { image: c.toDataURL('image/jpeg', 0.85), width: c.width, height: c.height, bedW: o.bedW, bedH: o.bedH };
        },
        async showLog() { window.__logShown = true; return true; },
        async logTail() { return { lines: ['10:00:00.000 jEditor 1.0 ready', '10:00:01.000 naps2 Debug: Twain init'], file: 'log' }; },
        // The app's side: window.__logPush(lines) as it writes them
        watchLog(fn) { window.__logWatch = !!fn; window.__logPush = fn; },
        // Drives and folders: paths use BS (a backslash) to stay readable here
        async places() { return { drives: window.__drives, home: [{ name: 'Desktop', path: 'C:' + BS + 'Users' + BS + 'lab' + BS + 'Desktop' }] }; },
        async listDir(p) {
            const t = window.__tree[p];
            if (!t) throw new Error('not there');
            return t;
        },
        // The projects folder: D:\Orders is disk/ (its folders, newest first)
        async listProjects(p) {
            window.__calls.push('listProjects');
            if (p !== window.__orderRoot) return [];
            const out = [];
            let i = 0;
            // When each changed: set by the test (__modified), newest first as the app sorts them
            for await (const [name, h] of (await sub('disk')).entries()) if (h.kind === 'directory') out.push({ name, path: p + BS + name, modified: (window.__modified || {})[name] || Date.now() - 60000 * i++ });
            return out.sort((a, b) => b.modified - a.modified);
        },
        async countPhotos(paths) { return { counts: paths.map(p => (window.__counts || {})[p] ?? 3), limit: 1000 }; },
        async quickAccess() { return window.__quick || []; },
        async eject(p) { window.__ejected = p; window.__drives = window.__drives.filter(d => d.path !== p); return { ok: true }; },
        async reveal(p) { window.__revealed = p; return true; },
        async pickPath() { return window.__pick || null; },
        // Windows: the other windows are __others; transfers move files in disk/
        setState(st) { window.__state = st; },
        async windows() { return window.__others || []; },
        async newWindow(p) { window.__newWindow = p || '(start)'; return true; },
        async split() { window.__split = true; return true; },
        async transfer(paths, dest, copy) {
            window.__transfer = { paths, dest, copy };
            const root = window.__orderRoot + BS;
            let dir = await sub('disk');
            for (const p of dest.slice(root.length).split(BS).filter(Boolean)) dir = await dir.getDirectoryHandle(p);
            const out = [];
            for (const from of paths) {
                const hit = await locate(from);
                if (!hit) { out.push({ from, error: 'not there any more' }); continue; }
                const data = await (await hit.dir.getFileHandle(hit.name)).getFile();
                const w = await (await dir.getFileHandle(hit.name, { create: true })).createWritable();
                await w.write(data);
                await w.close();
                if (!copy) await hit.dir.removeEntry(hit.name);
                out.push({ from, to: dest + BS + hit.name });
            }
            return out;
        },
        async undoTransfer(items, copy) { window.__undoTransfer = { items, copy }; return items.map(() => null); },
        async openPath(p) { window.__opened = p; return true; },
        async renameFolder(p, name) {
            window.__renamed = [p, name];
            const parent = p.slice(0, p.lastIndexOf(BS));
            if (parent === window.__orderRoot) {
                const disk = await sub('disk');
                const h = await disk.getDirectoryHandle(p.slice(parent.length + 1));
                if (h.move) await h.move(name);
            }
            return parent + BS + name;
        },
        async makeFolder(parent, name) {
            if (parent !== window.__orderRoot) throw new Error("The projects folder is not there");
            const disk = await sub('disk');
            try { await disk.getDirectoryHandle(name); throw new Error('There is already a ' + name + ' there'); } catch (e) { if (!/NotFound/.test(e.name)) throw e; }
            await disk.getDirectoryHandle(name, { create: true });
            return parent + BS + name;
        },
        async exists(paths) { return paths.map(p => !(window.__missing || []).includes(p)); },
        async checkUpdate() { window.__calls.push('checkUpdate'); return window.__update || { newer: false, version: '1.0.0', tag: 'v1.0.0', notes: '' }; },
        async installUpdate(progress) {
            window.__calls.push('installUpdate');
            progress(5, 10);
            window.__progressText = app.elements.loadingText.textContent;
            progress(10, 10);
        }
    };
`;

// A real JPEG: a color with a label, so every photo's bytes differ
const JPEG = async (color, label = '') => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 160, 120);
    g.fillStyle = '#fff';
    g.font = '16px sans-serif';
    g.fillText(label, 8, 60);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
};

// In-page helpers
const HELPERS = `
    window.write = async (dir, name, data) => {
        const h = await dir.getFileHandle(name, { create: true });
        const w = await h.createWritable();
        await w.write(data);
        await w.close();
    };
    window.jpeg = ${JPEG.toString()};
    window.opfs = async (...parts) => {
        let d = await navigator.storage.getDirectory();
        for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
        return d;
    };
    window.names = async (dir) => { const out = []; for await (const [n] of dir.entries()) out.push(n); return out.sort(); };
    window.has = async (dir, ...parts) => {
        try {
            let d = dir;
            for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
            const last = parts[parts.length - 1];
            try { await d.getFileHandle(last); } catch (e) { await d.getDirectoryHandle(last); }
            return true;
        } catch (e) { return false; }
    };
    window.wait = async (fn, ms = 8000) => {
        const until = Date.now() + ms;
        while (Date.now() < until) { if (await fn()) return true; await new Promise(r => setTimeout(r, 50)); }
        return false;
    };
    // The order D:\\Orders\\<name>: photos at the top and in Ceremony
    window.makeOrder = async (name, n = 3) => {
        const disk = await opfs('disk');
        try { await disk.removeEntry(name, { recursive: true }); } catch (e) { }
        const dir = await disk.getDirectoryHandle(name, { create: true });
        for (let i = 1; i <= n; i++) await write(dir, 'photo' + i + '.jpg', await jpeg('hsl(' + i * 60 + ',60%,50%)', name + ' ' + i));
        const cer = await dir.getDirectoryHandle('Ceremony', { create: true });
        await write(cer, 'c1.jpg', await jpeg('#357', name + ' c1'));
        return dir;
    };
    window.openOrder = async (dir) => {
        window.showDirectoryPicker = async () => dir;
        await app.browseFolder();
        await wait(() => !app.isLoading && app.files.length);
    };
    window.store = async () => {
        const data = await opfs('appdata');
        for await (const [n, h] of data.entries()) if (h.kind === 'directory' && n.startsWith(app.dirHandle.name + '-')) return h;
        return null;
    };
    window.toasts = () => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');
`;

async function newPage(context, baseUrl) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message + (process.env.STACKS ? ' @ ' + e.stack : '')));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript(FAKE_NATIVE);
    await page.goto(`${baseUrl}/index.html`);
    await page.waitForFunction(() => typeof app !== 'undefined' && app.elements);
    await page.evaluate(HELPERS);
    // A clean private file system for each test
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        for (const n of ['disk', 'appdata', 'bin']) { try { await root.removeEntry(n, { recursive: true }); } catch (e) { } }
    });
    return { page, errors };
}

(async () => {
    const server = createServer();
    await new Promise(r => server.listen(0, r));
    const baseUrl = `http://localhost:${server.address().port}`;
    const browser = await chromium.launch(launchOptions());

    console.log('native: order data on the PC, not in the order');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            out.nativeClass = document.documentElement.classList.contains('native');
            out.cacheLabel = document.querySelector('[for="cust-folder-cache"] span').textContent;
            out.trashTitle = document.getElementById('btn-trash').title;
            app.THUMB_FAST_PATH_BYTES = 0; // small test photos get cached thumbnails too
            const dir = await makeOrder('Smith Order');
            await openOrder(dir);
            Flags.apply('star', [app.files.find(f => f.name === 'photo1.jpg')]);
            Flags.apply('rescan', [app.files.find(f => f.name === 'c1.jpg')]);
            await Flags.save();
            await FolderCache.flush();
            const st = await store();
            out.storeName = st && st.name;
            out.orderJson = st && JSON.parse(await (await (await st.getFileHandle('order.json')).getFile()).text());
            out.flags = st && JSON.parse(await (await (await st.getFileHandle('flags.json')).getFile()).text()).flags;
            await wait(async () => await has(st, 'cache', 'thumbs'));
            out.thumbs = await has(st, 'cache', 'thumbs');
            out.orderFolder = await names(dir);
            app.setView('grid');
            app.clearSelection();
            app.toggleInfoPanel(true);
            await wait(() => /Kept on this PC\S*\d/.test(document.getElementById('info-list').textContent));
            out.info = document.getElementById('info-list').textContent;
            return out;
        });
        check('the app\'s wording is used', r.nativeClass && r.cacheLabel === 'Keep a thumbnail cache' && /Recycle Bin/.test(r.trashTitle), JSON.stringify([r.cacheLabel, r.trashTitle]));
        check('the order gets a folder in jEditor\'s storage, named after it', /^Smith Order-[0-9a-f]{16}$/.test(r.storeName || ''), r.storeName);
        check('order.json says which folder it is', r.orderJson && r.orderJson.path === 'D:\\Orders\\Smith Order' && r.orderJson.name === 'Smith Order' && r.orderJson.openedAt > 0, JSON.stringify(r.orderJson));
        check('flags are saved there, by path in the order', r.flags && r.flags['photo1.jpg'] && r.flags['photo1.jpg'].star && r.flags['Ceremony/c1.jpg'] && r.flags['Ceremony/c1.jpg'].rescan, JSON.stringify(r.flags));
        check('thumbnails are cached there', r.thumbs);
        check('nothing is added to the order folder', r.orderFolder.join() === 'Ceremony,photo1.jpg,photo2.jpg,photo3.jpg', r.orderFolder.join());
        check('order info says what\'s kept on this PC', /Kept on this PC/.test(r.info) && !/\.jeditor/.test(r.info), r.info.slice(0, 200));

        check('storage suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: reopening keeps flags; Clean up removes the stored data');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const dir = await makeOrder('Jones');
            await openOrder(dir);
            Flags.apply('star', [app.files[0]]);
            await Flags.save();
            const starred = app.files[0].name;
            // Open another order (flag one there too), then this one again
            await openOrder(await makeOrder('Other', 1));
            Flags.apply('star', [app.files[0]]);
            await Flags.save();
            await openOrder(dir);
            await wait(() => app.files.some(f => f._flags));
            out.kept = !!(app.files.find(f => f.name === starred)._flags || {}).star;
            const data = await opfs('appdata');
            out.stores = (await names(data)).length;
            // Clean up (confirmed)
            const done = app.cleanUpFolder();
            await wait(() => !document.getElementById('ui-dialog').classList.contains('hidden'));
            out.dialog = document.getElementById('ui-dialog').textContent;
            document.getElementById('uid-ok').click();
            await done;
            out.afterNames = await names(data);
            out.flagsGone = !app.files.some(f => f._flags);
            return out;
        });
        check('flags are there when the order is opened again', r.kept);
        check('one stored folder per order', r.stores === 2, String(r.stores));
        check('Clean up talks about the project, not .jeditor', /Clean up this project/.test(r.dialog) && !/\.jeditor/.test(r.dialog), r.dialog.slice(0, 160));
        check('Clean up removes the order\'s stored folder', r.afterNames.length === 1 && r.afterNames[0].startsWith('Other-') && r.flagsGone, r.afterNames.join());
        check('clean up suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: an old .jeditor in the order is moved out');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const dir = await makeOrder('Old Order');
            const old = await dir.getDirectoryHandle('.jeditor', { create: true });
            await write(old, 'flags.json', JSON.stringify({ version: 1, flags: { 'photo2.jpg': { color: 'red' }, 'Ceremony/c1.jpg': { star: true } } }));
            await write(await old.getDirectoryHandle('trash', { create: true }), 'deleted.jpg', await jpeg('#111'));
            await write(await old.getDirectoryHandle('originals', { create: true }), 'photo3.jpg', await jpeg('#222'));
            await write(await (await old.getDirectoryHandle('cache', { create: true })).getDirectoryHandle('thumbs', { create: true }), 'x.img', 'x');
            await openOrder(dir);
            await wait(async () => !(await has(dir, '.jeditor')));
            out.orderFolder = await names(dir);
            await wait(() => app.files.find(f => f.name === 'photo2.jpg')._flags);
            out.red = (app.files.find(f => f.name === 'photo2.jpg')._flags || {}).color === 'red';
            out.star = !!(app.files.find(f => f.name === 'c1.jpg')._flags || {}).star;
            await Flags.save();
            const st = await store();
            out.trash = await names(await st.getDirectoryHandle('trash'));
            out.originals = await names(await st.getDirectoryHandle('originals'));
            out.toast = toasts();
            return out;
        });
        check('the .jeditor folder is gone from the order', r.orderFolder.join() === 'Ceremony,photo1.jpg,photo2.jpg,photo3.jpg', r.orderFolder.join());
        check('its flags join the order\'s', r.red && r.star);
        check('its deleted photos and Auto crop originals move to the storage', r.trash.join() === 'deleted.jpg' && r.originals.join() === 'photo3.jpg', JSON.stringify([r.trash, r.originals]));
        check('a message says so', /Moved this order's \.jeditor folder out of the order/.test(r.toast), r.toast);
        check('old .jeditor suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: delete to the Recycle Bin, Ctrl+Z restores');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const dir = await makeOrder('Bin Order', 4);
            await openOrder(dir);
            const bytes = async (d, n) => new Uint8Array(await (await (await d.getFileHandle(n)).getFile()).arrayBuffer()).join();
            const before = await bytes(dir, 'photo2.jpg');
            const victims = app.files.filter(f => ['photo2.jpg', 'photo3.jpg'].includes(f.name));
            await app.moveToTrash(victims);
            out.calls = window.__calls.filter(c => c.startsWith('recycle'));
            out.paths = window.__recycled.slice();
            out.left = await names(dir);
            out.bin = await names(await opfs('bin'));
            out.files = app.files.length;
            out.toast = toasts();
            out.noTrashInStore = !(await has(await opfs('appdata'), 'trash'));
            await app.undo();
            out.back = await names(dir);
            out.same = (await bytes(dir, 'photo2.jpg')) === before;
            out.binAfter = await names(await opfs('bin'));
            out.filesAfter = app.files.length;
            out.toast2 = toasts();

            // A drive without a Recycle Bin: kept in jEditor's trash instead
            window.__noBin = true;
            await app.moveToTrash([app.files.find(f => f.name === 'photo1.jpg')]);
            const st = await store();
            out.noBinTrash = await names(await st.getDirectoryHandle('trash'));
            out.noBinLeft = await names(dir);
            out.noBinToast = toasts();
            await app.undo();
            out.noBinBack = await names(dir);

            // A folder the app can't place: says so, and keeps nothing for it
            window.__noBin = false;
            window.__unknownPath = true;
            const before2 = (await names(await opfs('appdata'))).length;
            const lost = await makeOrder('Lost Order', 2);
            await openOrder(lost);
            Flags.apply('star', [app.files[0]]);
            await Flags.save().catch(() => { });
            out.unknownToast = toasts();
            out.unknownStores = (await names(await opfs('appdata'))).length - before2;
            out.unknownFolder = await names(lost);
            window.__unknownPath = false;
            return out;
        });
        check('photos go to the Recycle Bin in one go', r.calls.join() === 'recycle:2' && r.bin.length === 2, JSON.stringify(r.calls));
        check('... by their full paths', r.paths.join('|') === 'D:\\Orders\\Bin Order\\photo2.jpg|D:\\Orders\\Bin Order\\photo3.jpg', r.paths.join('|'));
        check('they leave the folder and the screen', r.left.join() === 'Ceremony,photo1.jpg,photo4.jpg' && r.files === 3, r.left.join());
        check('the message says Recycle Bin', /Moved 2 to the Recycle Bin/.test(r.toast), r.toast);
        check('Ctrl+Z puts them back, unchanged, out of the bin', r.back.join() === 'Ceremony,photo1.jpg,photo2.jpg,photo3.jpg,photo4.jpg' && r.same && r.binAfter.length === 0 && r.filesAfter === 5, JSON.stringify([r.back, r.binAfter]));
        check('no Recycle Bin on the drive: kept in jEditor\'s storage, not the order', r.noBinTrash.join() === 'photo1.jpg' && !r.noBinLeft.includes('photo1.jpg') && !r.noBinLeft.includes('.jeditor') && /no Recycle Bin/.test(r.noBinToast), JSON.stringify([r.noBinTrash, r.noBinLeft]));
        check('... and Ctrl+Z restores it', r.noBinBack.includes('photo1.jpg') && !r.noBinBack.includes('.jeditor'), r.noBinBack.join());
        check('a folder whose path isn\'t known: a message, nothing stored, nothing in the folder', /can't tell where this folder is/.test(r.unknownToast) && r.unknownStores === 0 && !r.unknownFolder.includes('.jeditor'), JSON.stringify([r.unknownToast, r.unknownStores, r.unknownFolder]));
        check('recycle suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: Stored orders');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const a = await makeOrder('Alpha');
            await openOrder(a);
            Flags.apply('star', [app.files[0]]);
            await Flags.save();
            await FolderCache.flush();
            const b = await makeOrder('Beta', 2);
            app.THUMB_FAST_PATH_BYTES = 0;
            await openOrder(b);
            await FolderCache.flush();
            await wait(async () => await has(await store(), 'cache'));
            window.__missing = ['D:\\Orders\\Alpha'];
            document.getElementById('cust-stored').click();
            await wait(() => document.querySelectorAll('#stored-list li[data-key]').length === 2);
            const rows = () => [...document.querySelectorAll('#stored-list li[data-key]')];
            out.open = !document.getElementById('stored-panel').classList.contains('hidden');
            out.rows = rows().map(li => li.textContent);
            out.summary = document.getElementById('stored-summary').textContent;
            out.betaOpenDisabled = rows()[0].querySelector('[data-act="open"]').disabled;
            // Remove Beta's cache (the open order)
            rows()[0].querySelector('[data-act="cache"]').click();
            await wait(async () => !(await has(await store(), 'cache')));
            out.betaCacheGone = !(await has(await store(), 'cache'));
            // Remove orders that are gone: Alpha
            document.getElementById('stored-clear-missing').click();
            await wait(() => !document.getElementById('ui-dialog').classList.contains('hidden'));
            out.confirm = document.getElementById('ui-dialog').textContent;
            document.getElementById('uid-ok').click();
            await wait(() => rows().length === 1);
            out.after = (await names(await opfs('appdata'))).map(n => n.split('-')[0]);
            // Open from the list
            window.__missing = [];
            await Stored.refresh();
            return out;
        });
        check('Settings → Stored orders opens the list', r.open);
        check('newest first, with path, size, flags and "Open now"', /^Beta/.test(r.rows[0]) && /Open now/.test(r.rows[0]) && /D:\\Orders\\Beta/.test(r.rows[0]) && /1 flag/.test(r.rows[1]), r.rows.join(' || '));
        check('a folder that\'s gone is marked', /not found/.test(r.rows[1]) && /1 no longer found/.test(r.summary), r.rows[1] + ' / ' + r.summary);
        check('the open order can\'t be opened again from the list', r.betaOpenDisabled);
        check('Remove cache removes just the cache', r.betaCacheGone);
        check('Remove orders that are gone says what\'s lost, then removes them', /1 flag/.test(r.confirm) && r.after.join() === 'Beta', JSON.stringify([r.confirm.slice(0, 120), r.after]));
        // Open an order from the list
        const opened = await page.evaluate(async () => {
            await openOrder(await opfs('disk', 'Alpha'));
            Flags.apply('star', [app.files[0]]);
            await Flags.save();
            await openOrder(await opfs('disk', 'Beta'));
            await Stored.open();
            await wait(() => [...document.querySelectorAll('#stored-list li[data-key]')].some(x => /^Alpha/.test(x.textContent)));
            const li = [...document.querySelectorAll('#stored-list li[data-key]')].find(x => /^Alpha/.test(x.textContent));
            li.querySelector('[data-act="open"]').click();
            await wait(() => window.__opened);
            return { path: window.__opened, closed: document.getElementById('stored-panel').classList.contains('hidden') };
        });
        check('Open asks the app to open that folder', opened.path === 'D:\\Orders\\Alpha' && opened.closed, JSON.stringify(opened));
        check('stored orders suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: updates');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            out.version = document.getElementById('upd-version').textContent === APP_VERSION;
            // Up to date
            await Updates.check({ manual: true });
            out.upToDate = document.getElementById('upd-status').textContent;
            // A newer one, found on start-up: offered with a message
            localStorage.removeItem('jeditor.updateCheck');
            window.__update = { newer: true, version: '9.9.9', tag: 'v9.9.9', notes: 'Intro\n\n## What\'s new\n\n- First change\n- Second change\n', current: 'v' + APP_VERSION };
            Updates.start();
            await wait(() => /9\.9\.9/.test(toasts()));
            out.toast = toasts();
            out.button = document.getElementById('upd-check').textContent;
            // Update: what's new, then download and install
            const offer = Updates.offer(window.__update);
            await wait(() => !document.getElementById('ui-dialog').classList.contains('hidden'));
            out.confirm = document.getElementById('ui-dialog').textContent;
            document.getElementById('uid-ok').click();
            await offer;
            await wait(() => window.__calls.includes('installUpdate'));
            await new Promise(r => setTimeout(r, 100));
            out.installed = window.__calls.includes('installUpdate');
            out.progress = window.__progressText;
            out.task = app.elements.loadingText.textContent;
            // Turned off: no check on start
            window.__calls.length = 0;
            localStorage.removeItem('jeditor.updateCheck');
            document.getElementById('upd-auto').checked = false;
            document.getElementById('upd-auto').dispatchEvent(new Event('change'));
            Updates.start();
            await new Promise(r => setTimeout(r, 200));
            out.noAuto = !window.__calls.includes('checkUpdate') && JSON.parse(localStorage.getItem('jeditor.ui')).autoUpdate === false;
            return out;
        });
        check('Settings shows the version', r.version);
        check('up to date: says so', /Up to date/.test(r.upToDate), r.upToDate);
        check('a newer version is offered on start-up', /jEditor 9\.9\.9 is available/.test(r.toast) && r.button === 'Update to 9.9.9', JSON.stringify([r.toast, r.button]));
        check('the offer lists what\'s new', /Update to jEditor 9\.9\.9\?/.test(r.confirm) && /First change/.test(r.confirm) && /Second change/.test(r.confirm) && !/Intro/.test(r.confirm), r.confirm.slice(0, 200));
        check('Update downloads, showing progress, then installs', r.installed && /50%/.test(r.progress) && /Installing the update/.test(r.task), JSON.stringify([r.installed, r.progress, r.task]));
        check('no automatic check when it\'s turned off', r.noAuto);
        check('updates suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: scanning into the order');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const dir = await makeOrder('Scan Order', 3);
            await openOrder(dir);
            out.button = getComputedStyle($('btn-scan')).display !== 'none';
            $('btn-scan').click();
            await wait(() => !$('scan-device').disabled);
            await wait(() => Scan.caps['EPSON FF-680W']);
            out.defaultMode = Scan.mode();
            // These checks use the scanner's own window (Advanced)
            $('scan-driver').checked = true;
            $('scan-driver').dispatchEvent(new Event('change'));
            out.driverMode = Scan.mode() + ' ' + $('scan-go').textContent + ' ' + !$('scan-help-driver').classList.contains('hidden');
            out.devices = [...$('scan-device').options].map(o => o.textContent).join(', ');
            // Compatibility mode: for TWAIN scanners, remembered for each
            out.compatShown = !$('scan-compat-row').classList.contains('hidden') && !$('scan-compat').checked;
            $('scan-device').value = 'wia-1';
            $('scan-device').dispatchEvent(new Event('change'));
            out.compatHiddenWia = $('scan-compat-row').classList.contains('hidden');
            $('scan-device').value = 'EPSON FF-680W';
            $('scan-device').dispatchEvent(new Event('change'));
            out.folder = $('scan-folder').value;
            out.folders = [...$('scan-folder').options].map(o => o.textContent).join(', ');
            out.names = [$('scan-prefix').value, $('scan-next').value, $('scan-preview').textContent];
            const folder = $('scan-folder');
            folder.value = 'Ceremony';
            folder.dispatchEvent(new Event('change'));
            out.cerNames = [$('scan-prefix').value, $('scan-next').value];
            folder.value = '';
            folder.dispatchEvent(new Event('change'));
            $('scan-compat').checked = true;
            $('scan-go').click();
            // The dock stays, showing the photos as they come in
            await wait(() => $('scan-panel').dataset.state !== 'setup');
            out.closed = !$('scan-panel').classList.contains('hidden');
            await wait(() => app.files.some(f => f.name === 'photo5.jpg'));
            await wait(() => $('scan-panel').dataset.state === 'done');
            out.dock = { title: $('scan-title').textContent, status: $('scan-status').textContent, strip: $('scan-strip').querySelectorAll('figure').length, more: $('scan-go').textContent };
            out.req = window.__scanReq;
            out.compatKept = JSON.parse(localStorage.getItem('jeditor.scanCompat') || '{}')['EPSON FF-680W'] === true;
            out.files = app.files.map(f => f.relPath || f.name).sort().join(',');
            await wait(() => /Scanned 2 photos/.test(toasts()));
            out.toast = toasts();

            out.autoCropDefault = $('scan-autocrop').checked;
            // Auto crop each photo: the scans go to Auto crop once they're in
            const realCrop = app.batchAutoCrop;
            app.batchAutoCrop = async (files, opts) => { out.cropped = files.map(f => f.name).join() + (opts && opts.ask === false ? ' (no question)' : ''); };
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: 'Ceremony', autoCrop: true });
            app.batchAutoCrop = realCrop;

            // Scan more (in the dock): the names carry on
            window.__scanPages = 1;
            await wait(() => app.files.some(f => f.relPath === 'Ceremony/c3.jpg'));
            $('scan-go').click();
            await wait(() => app.files.some(f => f.name === 'photo6.jpg'));
            await wait(() => !Scan.running);
            out.more = window.__scanReq.prefix + window.__scanReq.next + '.jpg';
            // A prefix typed for a scan carries on into Scan more / Try again,
            // not the folder's most used one
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '', prefix: 'Smith-B-', next: 1, digits: 3 });
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '' });
            out.typedMore = window.__scanReq.prefix + window.__scanReq.next;
            Scan.lastNaming = null; // the scans below follow the folder's names again

            // Details: the log so far, then new lines as the app writes them
            out.detailsOff = $('scan-log').classList.contains('hidden');
            $('scan-details').click();
            await wait(() => $('scan-log').querySelectorAll('.log-lines div').length >= 2);
            // (a line it already had isn't shown twice)
            window.__logPush(['10:00:01.000 naps2 Debug: Twain init', '10:00:02.000 naps2 Debug: Twain open', '10:00:03.000 Scan failed: device error']);
            await wait(() => $('scan-log').querySelectorAll('.log-lines div').length >= 4);
            const lines = [...$('scan-log').querySelectorAll('.log-lines div')];
            out.details = { lines: lines.map(d => d.textContent), err: lines[lines.length - 1].className, dim: lines[1].className, watching: window.__logWatch, pressed: $('scan-details').getAttribute('aria-pressed') };
            $('scan-details').click();
            out.detailsHidden = $('scan-log').classList.contains('hidden') && window.__logWatch === false;

            // The scanner stops with an error: says so, and what was saved
            window.__scanError = 'The scanner is busy (is another program using it?)';
            await wait(() => app.files.some(f => f.name === 'photo6.jpg'));
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '' }).catch(e => { out.err = e.message; });
            await wait(() => UI.isOpen());
            out.alert = $('uid-title').textContent + ' — ' + $('uid-text').textContent;
            $('uid-ok').click();
            out.running = Scan.running;
            out.detailsOnError = !$('scan-log').classList.contains('hidden') && window.__logWatch;

            // Unplugged partway: a dialog saying what to check; Try again
            // carries on with the names
            window.__scanError = 'The scanner isn\'t connected or is turned off';
            window.__scanCode = 'offline';
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '' }).catch(() => { });
            await wait(() => UI.isOpen());
            out.offline = [$('uid-title').textContent, $('uid-text').textContent, $('uid-ok').textContent, $('uid-cancel').textContent];
            window.__scanError = null;
            window.__scanCode = null;
            window.__scanReq = null;
            $('uid-ok').click();
            await wait(() => window.__scanReq && !Scan.running);
            out.again = window.__scanReq && window.__scanReq.device === 'EPSON FF-680W' && window.__scanReq.next > 6;

            // A scanner that never shows its window: Stop ends it
            window.__scanHang = true;
            const hung = Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '' });
            await wait(() => $('scan-panel').dataset.state === 'scanning');
            out.stopOffered = getComputedStyle($('scan-stop')).display !== 'none' && /Scanning · EPSON FF-680W/.test($('scan-title').textContent);
            // Closing it while it scans only makes it small
            $('scan-x').click();
            out.small = $('scan-panel').classList.contains('small') && !$('scan-panel').classList.contains('hidden');
            Scan.setSmall(false);
            $('scan-stop').click();
            const stopped = await hung;
            out.stopped = stopped.cancelled && window.__cancelled && !Scan.running;
            out.stopToast = $('scan-status').textContent;
            window.__scanHang = false;

            // Settings: Show log
            $('upd-log').click();
            await wait(() => window.__logShown);
            out.log = window.__logShown;

            // No scanners: says what to check
            window.__scanners = { devices: [], problems: ['TWAIN isn\'t set up on this PC (no TWAINDSM.dll), so only WIA scanners are listed'] };
            Scan.devices = null;
            await Scan.open();
            out.none = $('scan-device').textContent + ' | ' + $('scan-problems').textContent;
            out.noneDisabled = $('scan-go').disabled;
            Scan.close();
            return out;
        });
        check('Scan is in the toolbar', r.button);
        check('jEditor\'s own settings to start with: the FastFoto (a feeder) gets the feeder', r.defaultMode === 'feeder', r.defaultMode);
        check('Advanced: the scanner\'s own window instead', r.driverMode === 'driver Scan true', r.driverMode);
        check('it lists the scanners, WIA ones marked', r.devices === 'EPSON FF-680W, OpticBook A300 (WIA)', r.devices);
        check('it offers the order\'s folders, starting with the one with the most photos', r.folder === '' && r.folders === 'Scan Order, Ceremony', JSON.stringify([r.folder, r.folders]));
        check('names follow on from the folder\'s photos', r.names[0] === 'photo' && r.names[1] === '4' && r.names[2] === 'photo4.jpg, photo5.jpg, …', JSON.stringify(r.names));
        check('... each folder its own sequence', r.cerNames.join() === 'c,2', r.cerNames.join());
        check('the dock stays while it scans, then says how many, with the photos and Scan more', r.closed && /^Scanned 2 photos into Scan Order/.test(r.dock.status) && r.dock.strip === 2 && r.dock.more === 'Scan more' && /Scanned · EPSON FF-680W/.test(r.dock.title), JSON.stringify(r.dock));
        check('Scan asks the app to scan into the order\'s folder, by path', r.req && r.req.folder === 'D:\\Orders\\Scan Order' && r.req.device === 'EPSON FF-680W' && r.req.driver === 'twain' && r.req.prefix === 'photo' && r.req.next === 4, JSON.stringify(r.req));
        check('scanned photos show up in the order', r.files === 'Ceremony/c1.jpg,photo1.jpg,photo2.jpg,photo3.jpg,photo4.jpg,photo5.jpg', r.files);
        check('a message says how many', /Scanned 2 photos into Scan Order/.test(r.toast), r.toast);
        check('Auto crop each photo is on to start with', r.autoCropDefault);
        check('Compatibility mode: offered for TWAIN scanners only, off to start with', r.compatShown && r.compatHiddenWia, JSON.stringify([r.compatShown, r.compatHiddenWia]));
        check('... sent with the scan, and remembered for that scanner', r.req.compat === true && r.compatKept, JSON.stringify([r.req.compat, r.compatKept]));
        check('... and crops each scan once it\'s in, without asking', r.cropped === 'c2.jpg,c3.jpg (no question)', r.cropped);
        check('Scan more in the dock carries on the names', r.more === 'photo6.jpg', r.more);
        check('a typed prefix carries on into the next scan', r.typedMore === 'Smith-B-2', r.typedMore);
        check('a scan that fails says why, and what was saved', /busy/.test(r.err || '') && /didn't finish/.test(r.alert) && /1 photo was saved/.test(r.alert) && !r.running, JSON.stringify([r.err, r.alert]));
        check('while scanning, the dock offers Stop; closing it only makes it small', r.stopOffered && r.small, JSON.stringify([r.stopOffered, r.small]));
        check('Stop ends a scan whose window never shows', r.stopped && r.stopToast === 'Scan stopped', JSON.stringify([r.stopped, r.stopToast]));
        check('Settings: Show log', r.log);
        check('Details: off to start with; shows the log so far, then new lines as they come', r.detailsOff && r.details.lines.length === 4 && /device error/.test(r.details.lines[3]) && r.details.watching && r.details.pressed === 'true', JSON.stringify(r.details));
        check('... errors stand out, the scanner driver\'s chatter is dimmed', r.details.err === 'err' && r.details.dim === 'dim', JSON.stringify(r.details));
        check('... and it stops following the log when closed', r.detailsHidden);
        check('... and opens by itself when a scan fails', r.detailsOnError);
        check('the scanner unplugged partway: a dialog says what to check, and Try again carries on', /isn't answering/.test(r.offline[0]) && /USB cable/.test(r.offline[1]) && r.offline[2] === 'Try again' && r.offline[3] === 'Close' && r.again, JSON.stringify([r.offline, r.again]));
        check('no scanners: says so and what to check', /No scanners found/.test(r.none) && /plugged in/.test(r.none) && /TWAINDSM/.test(r.none) && r.noneDisabled, r.none);
        check('scan suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: preview and crop');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const dir = await makeOrder('Glass Order', 2);
            await openOrder(dir);
            localStorage.removeItem('jeditor.scanMode');
            $('btn-scan').click();
            await wait(() => !$('scan-device').disabled);
            $('scan-device').value = 'wia-1';
            $('scan-device').dispatchEvent(new Event('change'));
            await wait(() => Scan.caps['wia-1']);
            // The OpticBook (a glass): the glass to start with, no feeder offered
            out.modeDefault = Scan.mode();
            out.feederHidden = $('scan-mode-feeder').classList.contains('hidden') && $('scan-sides-row').classList.contains('hidden');
            out.goLabel = $('scan-go').textContent;
            out.help = !$('scan-help-glass').classList.contains('hidden') && $('scan-help-driver').classList.contains('hidden');
            // The settings are in setup, then beside the glass
            out.optsInSetup = $('scan-opts-home').contains($('scan-opts'));
            $('scan-go').click();
            await wait(() => $('scan-panel').dataset.state === 'preview' && !Scan.waiting && ScanPreview.boxes.length > 0);
            out.capsReq = window.__capsReq;
            out.previewReq = window.__previewReq;
            out.optsBeside = $('scan-opts-pv').contains($('scan-opts'));
            out.boxes = ScanPreview.boxes.map(b => [b.x, b.y, b.w, b.h].map(v => Math.round(v * 1000) / 1000));
            out.shown = $('scan-pv-boxes').querySelectorAll('.pv-box').length;
            out.count = $('scan-pv-count').textContent;
            out.go = $('scan-go').textContent;
            out.dpi = $('scan-dpi').value;
            out.dpis = [...$('scan-dpi').options].map(o => o.value).join();
            out.names = $('scan-pv-names').textContent;
            out.wide = $('scan-panel').getBoundingClientRect().width > innerWidth * 0.8;
            // × removes a box
            $('scan-pv-boxes').querySelectorAll('.pv-x')[2].click();
            out.afterRemove = [ScanPreview.boxes.length, $('scan-go').textContent];
            return out;
        });
        // Draw a box with the mouse, then move the first one
        const rect = await page.evaluate(() => { const b = document.getElementById('scan-pv-boxes').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
        await page.mouse.move(rect.x + rect.w * 0.1, rect.y + rect.h * 0.85);
        await page.mouse.down();
        await page.mouse.move(rect.x + rect.w * 0.3, rect.y + rect.h * 0.9, { steps: 4 });
        await page.mouse.move(rect.x + rect.w * 0.5, rect.y + rect.h * 0.95, { steps: 4 });
        await page.mouse.up();
        const first = await page.evaluate(() => { const b = document.querySelector('#scan-pv-boxes .pv-box').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        await page.mouse.move(first.x, first.y);
        await page.mouse.down();
        await page.mouse.move(first.x + rect.w * 0.05, first.y + rect.h * 0.02, { steps: 4 });
        await page.mouse.up();
        // A click on a print boxes it (the third one, taken off above)
        await page.mouse.click(rect.x + rect.w * 0.47, rect.y + rect.h * 0.6);
        const r2 = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            out.drawn = ScanPreview.boxes.map(b => [b.x, b.y, b.w, b.h].map(v => Math.round(v * 100) / 100));
            out.go = $('scan-go').textContent;
            // Delete removes the selected one (the moved box)
            ScanPreview.sel = 0;
            $('scan-pv-boxes').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
            out.afterDelete = ScanPreview.boxes.length;
            // Find prints puts them back
            $('scan-pv-find').click();
            out.found = ScanPreview.boxes.length;
            // A click where no print is: a box the size of the last one,
            // there; turned a quarter; the first one tilted
            ScanPreview.clickBox({ x: 0.6, y: 0.95 });
            const added = ScanPreview.boxes[3];
            out.sized = [Math.round(added.w * 8.5 * 10) / 10, Math.round(added.h * 11.7 * 10) / 10, Math.round((added.x + added.w / 2) * 100) / 100];
            $('scan-pv-boxes').querySelectorAll('.pv-turn')[3].click();
            out.turned = ScanPreview.boxes[3].turn + ' ' + $('scan-pv-boxes').querySelectorAll('.pv-up')[3].style.transform;
            ScanPreview.boxes[0].angle = 4.5;
            ScanPreview.render();
            out.tiltShown = $('scan-pv-boxes').querySelector('.pv-box').style.transform;
            $('scan-dpi').value = '1200';
            $('scan-dpi').dispatchEvent(new Event('change'));
            $('scan-color').value = 'gray';
            $('scan-color').dispatchEvent(new Event('change'));
            // Brightness and contrast show on the preview
            $('scan-bright').value = '20';
            $('scan-bright').dispatchEvent(new Event('input'));
            $('scan-contrast').value = '-10';
            $('scan-contrast').dispatchEvent(new Event('input'));
            out.filter = [$('scan-adj-r').getAttribute('slope'), $('scan-adj-r').getAttribute('intercept'), $('scan-bright-out').textContent];
            // PNG (lossless): no quality, names end .png
            $('scan-format').value = 'png';
            $('scan-format').dispatchEvent(new Event('change'));
            out.tiff = [$('scan-quality-row').classList.contains('hidden'), $('scan-pv-names').textContent];
            // Saved setups
            const realPrompt = UI.prompt;
            UI.prompt = async () => 'Reprints';
            await Scan.saveSetup();
            UI.prompt = realPrompt;
            out.setups = [JSON.parse(localStorage.getItem('jeditor.scanSetups')).map(x => `${x.name} ${x.dpi} ${x.format} ${x.brightness}`).join(), $('scan-setup-pick').value];
            $('scan-bright').value = '0';
            $('scan-bright').dispatchEvent(new Event('input'));
            out.custom = $('scan-setup-pick').value;
            $('scan-setup-pick').value = 'Reprints';
            $('scan-setup-pick').dispatchEvent(new Event('change'));
            out.applied = $('scan-bright').value;
            $('scan-go').click();
            await wait(() => $('scan-panel').dataset.state === 'done');
            out.req = window.__scanReq;
            await wait(() => app.files.some(f => f.name === 'photo6.png'));
            out.files = app.files.map(f => f.name).sort().join();
            out.status = $('scan-status').textContent;
            out.modeKept = JSON.parse(localStorage.getItem('jeditor.scanMode'))['wia-1'] === 'glass';
            out.prefs = JSON.parse(localStorage.getItem('jeditor.scanOpts'));
            // Scan more previews the glass again; the names carry on
            window.__previewReq = null;
            $('scan-go').click();
            await wait(() => $('scan-panel').dataset.state === 'preview' && !Scan.waiting && window.__previewReq);
            out.moreNames = $('scan-pv-names').textContent;
            out.moreDpi = $('scan-dpi').value;
            // Stop while previewing
            window.__previewHang = true;
            $('scan-pv-again').click();
            await wait(() => Scan.waiting);
            out.stopShown = getComputedStyle($('scan-stop')).display !== 'none';
            $('scan-stop').click();
            await wait(() => !Scan.waiting);
            out.stopped = $('scan-pv-count').textContent;
            window.__previewHang = false;
            // Back to setup: How is remembered for that scanner
            $('scan-settings').click();
            out.setupMode = Scan.mode() + ' ' + $('scan-go').textContent;
            Scan.close();
            return out;
        });
        const near = (b, x, y, w, h) => b && b[0] <= x && b[1] <= y && b[0] + b[2] >= x + w && b[1] + b[3] >= y + h && b[2] < w + 0.12 && b[3] < h + 0.1;
        check('How: the OpticBook (a glass) gets the glass, no feeder offered; it says what it does, and the button says Preview', r.modeDefault === 'glass' && r.feederHidden && r.help && r.goLabel === 'Preview', JSON.stringify([r.modeDefault, r.feederHidden, r.help, r.goLabel]));
        check('the settings are in setup, then beside the glass', r.optsInSetup && r.optsBeside);
        check('it asks the scanner about its glass, then previews it small', r.capsReq && r.capsReq.device === 'wia-1' && r.previewReq && r.previewReq.dpi === 150 && r.previewReq.bedW === 8.5, JSON.stringify([r.capsReq, r.previewReq]));
        check('the dock grows to show the glass', r.wide);
        check('a box round each print, in reading order', r.boxes.length === 3 && r.shown === 3 && near(r.boxes[0], 0.059, 0.043, 0.47, 0.256) && near(r.boxes[1], 0.588, 0.06, 0.353, 0.342) && near(r.boxes[2], 0.118, 0.427, 0.706, 0.342), JSON.stringify(r.boxes));
        check('... saying how many, and the names they\'ll get', r.count === '3 photos' && r.go === 'Scan 3 photos' && r.names === 'Into Glass Order: photo3.jpg … photo5.jpg', JSON.stringify([r.count, r.go, r.names]));
        check('resolutions from the scanner (100 dpi and up), 600 to start with', r.dpi === '600' && r.dpis === '150,300,600,1200', JSON.stringify([r.dpi, r.dpis]));
        check('× removes a box', r.afterRemove[0] === 2 && r.afterRemove[1] === 'Scan 2 photos', JSON.stringify(r.afterRemove));
        check('dragging on the glass draws a box; dragging a box moves it', r2.drawn.length === 4 && r2.drawn[2][0] === 0.1 && r2.drawn[2][1] === 0.85 && r2.drawn[2][2] === 0.4 && r2.drawn[0][0] > 0.06, JSON.stringify(r2.drawn));
        check('a click on a print boxes it', near(r2.drawn[3], 0.118, 0.427, 0.706, 0.342) && r2.go === 'Scan 4 photos', JSON.stringify([r2.drawn[3], r2.go]));
        check('Delete removes the selected box; Find prints puts them back', r2.afterDelete === 3 && r2.found === 3, JSON.stringify([r2.afterDelete, r2.found]));
        check('a click where there\'s no print: a box the size of the last one, there', Math.abs(r2.sized[0] - 6.2) < 0.4 && Math.abs(r2.sized[1] - 4.2) < 0.4 && r2.sized[2] === 0.6, JSON.stringify(r2.sized));
        check('↻ turns a box a quarter (the arrow shows which way is up); a tilted box shows tilted', r2.turned === '90 rotate(-90deg)' && r2.tiltShown === 'rotate(4.5deg)', JSON.stringify([r2.turned, r2.tiltShown]));
        check('brightness and contrast show on the preview', r2.filter[0] === '0.9' && Math.abs(parseFloat(r2.filter[1]) - 0.15) < 1e-9 && r2.filter[2] === '20', JSON.stringify(r2.filter));
        check('PNG: no quality, and the names end .png', r2.tiff[0] && /photo3\.png … photo6\.png/.test(r2.tiff[1]), JSON.stringify(r2.tiff));
        check('saved setups: saved under a name, Custom once changed, picked again', r2.setups[0] === 'Reprints 1200 png 20' && r2.setups[1] === 'Reprints' && r2.custom === '' && r2.applied === '20', JSON.stringify([r2.setups, r2.custom, r2.applied]));
        check('Scan sends the boxes (tilt and turn too), settings and glass to the app, with no scanner window', r2.req && r2.req.source === 'glass' && r2.req.crops && r2.req.crops.length === 4 && r2.req.crops[0].angle === 4.5 && r2.req.crops[3].turn === 90 && r2.req.dpi === 1200 && r2.req.gray === true && r2.req.format === 'png' && r2.req.brightness === 20 && r2.req.contrast === -10 && r2.req.bedW === 8.5 && r2.req.bedH === 11.7 && r2.req.prefix === 'photo' && r2.req.next === 3, JSON.stringify(r2.req));
        check('... a photo per box comes in', /photo3\.png,photo4\.png,photo5\.png,photo6\.png/.test(r2.files) && /Scanned 4 photos/.test(r2.status), JSON.stringify([r2.files, r2.status]));
        check('the glass is remembered for that scanner, and the settings', r2.modeKept && r2.prefs.dpi === 1200 && r2.prefs.color === 'gray' && r2.prefs.format === 'png' && /^glass Preview$/.test(r2.setupMode), JSON.stringify([r2.modeKept, r2.prefs, r2.setupMode]));
        check('Scan more previews again; the names carry on', /photo7\.png/.test(r2.moreNames) && r2.moreDpi === '1200', JSON.stringify([r2.moreNames, r2.moreDpi]));
        check('Stop ends a preview', r2.stopShown && r2.stopped === 'Preview stopped', JSON.stringify([r2.stopShown, r2.stopped]));
        // Scan whole glass: beside Preview, one photo of the whole glass, no preview
        const rw = await page.evaluate(async () => {
            const $ = (id) => document.getElementById(id);
            const wait = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise(r => setTimeout(r, 50)); };
            await wait(() => !Scan.running && !Scan.waiting);
            Scan.setState('setup');
            const out = { shown: getComputedStyle($('scan-whole')).display !== 'none', go: $('scan-go').textContent };
            // The buttons stay in sight however far the settings scroll
            const body = $('scan-form');
            body.scrollTop = body.scrollHeight;
            const foot = $('scan-whole').closest('.scan-dock-foot').getBoundingClientRect(), box = body.getBoundingClientRect();
            out.footInSight = foot.bottom <= box.bottom + 1 && foot.top >= box.top;
            window.__scanReq = null;
            window.__previewReq = null;
            $('scan-whole').click();
            await wait(() => window.__scanReq && !Scan.running);
            const q = window.__scanReq || {};
            out.req = { source: q.source, crops: q.crops, bed: [q.bedW, q.bedH], dpi: q.dpi, previewed: !!window.__previewReq };
            out.state = $('scan-panel').dataset.state;
            return out;
        });
        check('Scan whole glass sits beside Preview, and the dock\'s buttons stay in sight', rw.shown && rw.go === 'Preview' && rw.footInSight, JSON.stringify(rw));
        check('Scan whole glass scans the whole glass as one photo, with no preview', rw.req.source === 'glass' && JSON.stringify(rw.req.crops) === '[{"x":0,"y":0,"w":1,"h":1,"angle":0,"turn":0}]'
            && rw.req.bed[0] > 8 && rw.req.dpi === 1200 && !rw.req.previewed && rw.state === 'done', JSON.stringify(rw));
        check('preview suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: the feeder, with jEditor\'s settings');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const dir = await makeOrder('Feed Order', 2);
            await openOrder(dir);
            $('btn-scan').click();
            await wait(() => !$('scan-device').disabled && Scan.caps['EPSON FF-680W']);
            out.mode = Scan.mode();
            out.glassHidden = $('scan-mode-glass').classList.contains('hidden');
            out.sidesShown = !$('scan-sides-row').classList.contains('hidden');
            // The FastFoto has its sides the other way round: on to start with
            out.swap = $('scan-swap').checked;
            $('scan-sides').value = 'both';
            $('scan-sides').dispatchEvent(new Event('change'));
            out.names = $('scan-preview').textContent;
            $('scan-dpi').value = '600';
            $('scan-dpi').dispatchEvent(new Event('change'));
            $('scan-go').click();
            await wait(() => $('scan-panel').dataset.state === 'done');
            out.req = window.__scanReq;
            await wait(() => app.files.some(f => f.name === 'photo4-b.jpg'));
            out.files = app.files.map(f => f.name).sort().join();
            // The newest photo (not its back) is open, large
            await wait(() => app.viewMode === 'single' && app.currentFile && app.currentFile.name === 'photo4.jpg');
            out.shown = app.viewMode + ' ' + (app.currentFile && app.currentFile.name);
            // Swap off: remembered for that scanner
            $('scan-settings').click();
            $('scan-swap').checked = false;
            $('scan-swap').dispatchEvent(new Event('change'));
            out.swapKept = JSON.parse(localStorage.getItem('jeditor.scanSwap'))['EPSON FF-680W'] === false;
            Scan.close();
            return out;
        });
        check('the FastFoto (a feeder) gets the feeder and its sides; no glass offered', r.mode === 'feeder' && r.glassHidden && r.sidesShown, JSON.stringify([r.mode, r.glassHidden, r.sidesShown]));
        check('... its front and back are swapped to start with (Advanced)', r.swap);
        check('both sides: each back is named after its front, with -b', /photo3\.jpg and its back photo3-b\.jpg/.test(r.names), r.names);
        check('Scan sends the feeder settings, with no scanner window', r.req && r.req.source === 'feeder' && r.req.sides === 'both' && r.req.swap === true && r.req.dpi === 600 && r.req.bedW === 8.5 && r.req.bedH === 14 && r.req.format === 'jpeg', JSON.stringify(r.req));
        check('... fronts and backs come in', /photo3-b\.jpg,photo3\.jpg,photo4-b\.jpg,photo4\.jpg/.test(r.files), r.files);
        check('... each photo opens large as it comes in (not the backs)', r.shown === 'single photo4.jpg', r.shown);
        check('... and the scanner is asked to crop each photo itself (its own auto-size)', r.req && r.req.autosize === true, JSON.stringify(r.req));
        check('the swap is remembered for that scanner', r.swapKept);
        check('feeder suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: a scanner that only opens in Older TWAIN mode');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            window.__scanners = { devices: [
                { id: 'Plustek OpticBook A300 Plus-TWAIN', name: 'Plustek OpticBook A300 Plus-TWAIN', driver: 'twain' },
                { id: 'Mystery Scanner', name: 'Mystery Scanner', driver: 'twain' }], problems: [] };
            // The app found the OpticBook only opens in compatibility mode;
            // the other one wouldn't say what it has at all
            window.__capsFor = (o) => /OpticBook/.test(o.device)
                ? { bedW: 8.27, bedH: 11.69, dpis: [75, 150, 300, 600], gray: true, guessed: true, flatbed: true, feeder: false, compat: true }
                : { bedW: 8.27, bedH: 11.69, dpis: [75, 150, 300, 600], gray: true, guessed: false, flatbed: false, feeder: false };
            const dir = await makeOrder('Book Order', 1);
            await openOrder(dir);
            $('btn-scan').click();
            await wait(() => !$('scan-device').disabled && Scan.caps['Plustek OpticBook A300 Plus-TWAIN']);
            await wait(() => $('scan-compat').checked);
            out.kept = !!JSON.parse(localStorage.getItem('jeditor.scanCompat') || '{}')['Plustek OpticBook A300 Plus-TWAIN'];
            out.checked = $('scan-compat').checked;
            out.toast = [...document.querySelectorAll('.toast')].map(t => t.textContent).find(t => /Older TWAIN mode/.test(t)) || '';
            out.glass = Scan.mode() === 'glass';
            // Asked again (next caps, preview, scan) in that mode
            $('scan-device').value = 'Mystery Scanner';
            $('scan-device').dispatchEvent(new Event('change'));
            await wait(() => Scan.caps['Mystery Scanner']);
            out.bothOffered = !$('scan-mode-glass').classList.contains('hidden') && !$('scan-mode-feeder').classList.contains('hidden') && Scan.mode() === 'glass';
            $('scan-device').value = 'Plustek OpticBook A300 Plus-TWAIN';
            $('scan-device').dispatchEvent(new Event('change'));
            $('scan-go').click();
            await wait(() => window.__previewReq);
            out.previewCompat = window.__previewReq.compat === true;
            // Its glass isn't said, but jEditor knows the A300's: A3
            out.a3 = [window.__previewReq.bedW, window.__previewReq.bedH, window.__previewReq.dpi];
            await wait(() => !Scan.waiting);
            // Another size: remembered, previewed again
            window.__previewReq = null;
            $('scan-pv-glass').value = 'letter';
            $('scan-pv-glass').dispatchEvent(new Event('change'));
            await wait(() => window.__previewReq);
            out.letter = [window.__previewReq.bedW, window.__previewReq.bedH];
            out.kept = JSON.parse(localStorage.getItem('jeditor.scanBed'))['Plustek OpticBook A300 Plus-TWAIN'];
            await wait(() => !Scan.waiting);
            Scan.close();
            return out;
        });
        check('Older TWAIN mode found by the app is turned on for that scanner, and said', r.kept && r.checked && /OpticBook.*Older TWAIN mode/.test(r.toast), JSON.stringify(r));
        check('... and used from then on', r.previewCompat && r.glass);
        check('a scanner that won\'t say what it has gets both the glass and the feeder offered', r.bothOffered);
        check('glass size: the A300\'s is known (A3), previewed at about 150 dpi; another size is remembered and previewed again', r.a3.join() === '11.69,16.54,150' && r.letter.join() === '8.5,11' && r.kept === 'letter', JSON.stringify([r.a3, r.letter, r.kept]));
        check('compat suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: tethered shooting');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const dir = await makeOrder('Shoot Order', 2);
            await openOrder(dir);
            out.button = getComputedStyle($('btn-camera')).display !== 'none';
            $('btn-camera').click();
            await wait(() => !$('cam-device').disabled);
            out.cameras = [...$('cam-device').options].map(o => o.textContent).join(', ');
            out.ready = $('cam-device').value;
            $('cam-device').value = 'cam-2';
            $('cam-device').dispatchEvent(new Event('change'));
            out.notReady = [$('cam-go').disabled, $('cam-note').textContent];
            $('cam-device').value = 'cam-1';
            $('cam-device').dispatchEvent(new Event('change'));
            out.names = [$('cam-prefix').value, $('cam-next').value, $('cam-names').textContent];
            out.defaults = [$('cam-card').checked, $('cam-show').checked, $('cam-liveview').checked];
            $('cam-go').click();
            await wait(() => $('cam-panel').dataset.state === 'live');
            out.req = window.__tetherReq;
            out.title = $('cam-title').textContent;
            await wait(() => window.__tetherFrames >= 5);
            await wait(() => $('cam-frame').complete && $('cam-frame').naturalWidth > 0);
            out.frames = window.__tetherFrames;
            // F12 takes a photo; RAW + JPEG come in under one number
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
            await wait(() => app.files.some(f => f.name === 'photo3.jpg'));
            out.files = app.files.map(f => f.name).sort().join();
            out.status = $('cam-status').textContent;
            out.strip = [...$('cam-strip').querySelectorAll('figcaption')].map(c => c.textContent).join();
            await wait(() => app.viewMode === 'single' && app.currentFile && app.currentFile.name === 'photo3.jpg');
            out.shown = app.currentFile && app.currentFile.name;
            // The button in the live view too
            $('cam-shoot').click();
            await wait(() => app.files.some(f => f.name === 'photo4.jpg'));
            out.calls = window.__tetherCalls.slice();
            // Keep a copy on the card: changed while connected, sent at once
            $('cam-card').checked = false;
            $('cam-card').dispatchEvent(new Event('change'));
            out.cardSet = window.__tetherCalls.includes('set {"keepOnCard":false}');
            // Small: live view stops; back: it starts again
            $('cam-min').click();
            out.liveOff = window.__tetherCalls.includes('live false');
            $('cam-min').click();
            out.liveOn = window.__tetherCalls.lastIndexOf('live true') > window.__tetherCalls.indexOf('live false');
            // Closing while connected only makes it small
            $('cam-x').click();
            out.small = $('cam-panel').classList.contains('small') && !$('cam-panel').classList.contains('hidden');
            Camera.setSmall(false);
            // Disconnect
            $('cam-stop').click();
            await wait(() => $('cam-panel').dataset.state === 'setup');
            out.ended = $('cam-note').textContent;
            out.nextNames = $('cam-next').value;
            // The camera goes away: says so, with what came in
            $('cam-go').click();
            await wait(() => $('cam-panel').dataset.state === 'live');
            await window.__tetherShoot();
            window.__tetherEnd('The camera was unplugged or turned off');
            await wait(() => UI.isOpen());
            out.alert = $('uid-title').textContent + ' — ' + $('uid-text').textContent;
            $('uid-ok').click();
            out.detailsOnError = !$('cam-log').classList.contains('hidden');
            out.prefs = JSON.parse(localStorage.getItem('jeditor.camera'));
            Camera.close();
            return out;
        });
        check('Camera is in the toolbar, after Scan', r.button);
        check('it lists Sony cameras, saying which aren\'t in PC Remote mode, and picks a ready one', r.cameras === 'Sony A7 III, Sony A7 IV (not in PC Remote mode)' && r.ready === 'cam-1', JSON.stringify([r.cameras, r.ready]));
        check('... a camera not in PC Remote mode can\'t connect, and it says why', r.notReady[0] === true && /file transfer/.test(r.notReady[1]), JSON.stringify(r.notReady));
        check('names follow on from the folder\'s photos, RAW keeping the number', r.names[0] === 'photo' && r.names[1] === '3' && /photo3\.jpg, photo4\.jpg/.test(r.names[2]) && /RAW/.test(r.names[2]), JSON.stringify(r.names));
        check('keep a copy on the card, show each photo and live view: on to start with', r.defaults.join() === 'true,true,true', r.defaults.join());
        check('Connect asks the app to tether into the project\'s folder, by path', r.req && r.req.camera === 'cam-1' && r.req.folder === 'D:\\Orders\\Shoot Order' && r.req.prefix === 'photo' && r.req.next === 3 && r.req.keepOnCard === true && r.req.live === true, JSON.stringify(r.req));
        check('connected: the live view shows, one frame after another as each is shown', /Sony A7 III/.test(r.title) && r.frames >= 5, JSON.stringify([r.title, r.frames]));
        check('F12 takes a photo: RAW + JPEG come in, the JPEG into the project', r.files === 'c1.jpg,photo1.jpg,photo2.jpg,photo3.jpg', r.files);
        check('... counted as one photo', /^1 photo · last: photo3\.jpg/.test(r.status) && r.strip === 'photo3.arw,photo3.jpg', JSON.stringify([r.status, r.strip]));
        check('... and the new photo opens large', r.shown === 'photo3.jpg', r.shown);
        check('the round button in the live view takes one too', r.calls.filter(c => c === 'shoot').length === 2, JSON.stringify(r.calls));
        check('keep a copy on the card goes to the camera when changed', r.cardSet);
        check('live view stops while the dock is small, and starts again', r.liveOff && r.liveOn);
        check('closing it while connected only makes it small', r.small);
        check('Disconnect: says how many, and the names carry on for next time', /Disconnected · 2 photos into Shoot Order/.test(r.ended) && r.nextNames === '5', JSON.stringify([r.ended, r.nextNames]));
        check('the camera going away says so, with what came in, and shows Details', /disconnected/.test(r.alert) && /unplugged/.test(r.alert) && /1 photo came in/.test(r.alert) && r.detailsOnError, r.alert);
        check('choices are remembered', r.prefs && r.prefs.camera === 'cam-1' && r.prefs.keepOnCard === false, JSON.stringify(r.prefs));
        check('camera suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: an empty folder opens, to scan into');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const dir = await (await opfs('disk')).getDirectoryHandle('Empty Project', { create: true });
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            await wait(() => !app.isLoading);
            out.open = !$('main-interface').classList.contains('hidden') && $('drop-zone').classList.contains('hidden');
            out.noAlert = !UI.isOpen();
            out.message = getComputedStyle($('grid-view'), '::after').content;
            out.view = app.viewMode;
            // Scan into it: the photos show up
            window.__scanPages = 2;
            const scanned = await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '' });
            await wait(() => app.files.length === 2);
            out.names = scanned.names.join();
            out.files = app.files.length;
            out.noMessage = !$('grid-view').classList.contains('grid-empty-project');
            // Every photo deleted: it stays open, empty
            window.__noBin = false;
            await app.moveToTrash([...app.files]);
            await wait(() => app.files.length === 0);
            out.stillOpen = !$('main-interface').classList.contains('hidden') && $('drop-zone').classList.contains('hidden');
            out.emptyAgain = $('grid-view').classList.contains('grid-empty-project');
            return out;
        });
        check('an empty folder opens as an empty project, no "No photos found"', r.open && r.noAlert && r.view === 'grid', JSON.stringify(r));
        check('... saying how to fill it (Scan)', /Scan into this project/.test(r.message), r.message);
        check('scanning into it shows the photos', r.names === 'Empty-001.jpg,Empty-002.jpg' && r.files === 2 && r.noMessage, JSON.stringify([r.names, r.files, r.noMessage]));
        check('deleting every photo keeps it open, empty', r.stillOpen && r.emptyAgain, JSON.stringify([r.stillOpen, r.emptyAgain]));
        check('empty project suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: windows (Split, New window, photos between windows)');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const BS = String.fromCharCode(92);
            await makeOrder('Other', 2);
            const dir = await makeOrder('Here', 2);
            await openOrder(dir);
            app.setView('grid');
            if (!Folders.railOpen()) Folders.toggleRail();
            // It tells the app what it shows
            await wait(() => window.__state && window.__state.name === 'Here');
            out.state = window.__state;
            // Split and New window
            await wait(() => $('sb-card').querySelector('[data-act="split"]'));
            $('sb-card').querySelector('[data-act="split"]').click();
            await wait(() => window.__split);
            out.split = window.__split;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'N', ctrlKey: true, shiftKey: true, bubbles: true }));
            await wait(() => window.__newWindow);
            out.newWindow = window.__newWindow;

            // M lists the other window's folders; choosing one moves the photos there
            window.__others = [{ id: 2, name: 'Other', path: window.__orderRoot + BS + 'Other', folders: ['', 'Ceremony'] }];
            const p1 = app.files.find(f => f.name === 'photo1.jpg');
            Folders.openPicker([p1], 'move');
            await wait(() => [...document.querySelectorAll('#fp-list .fp-row')].some(r => /other window/.test(r.textContent)));
            const rows = [...document.querySelectorAll('#fp-list .fp-row')].filter(r => /other window/.test(r.textContent)).map(r => r.querySelector('.fp-name').textContent);
            out.pickerRows = rows.join(' | ');
            const item = Folders.pickerItems.find(it => it.kind === 'window' && it.path === 'Ceremony');
            await Folders.choose(item);
            await wait(() => window.__transfer);
            out.moved = window.__transfer;
            await wait(() => !app.files.some(f => f.name === 'photo1.jpg'));
            out.gone = !app.files.some(f => f.name === 'photo1.jpg');
            out.toast = toasts();
            // Ctrl+Z puts it back
            await app.undo();
            out.undo = window.__undoTransfer;

            // Dropped from another window onto a folder here
            window.__transfer = null;
            const dt = new DataTransfer();
            dt.setData(Windows.TYPE, JSON.stringify([window.__orderRoot + BS + 'Other' + BS + 'photo2.jpg']));
            const row = document.querySelector('#folder-tree [data-folder-path="Ceremony"]');
            row.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
            row.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, ctrlKey: true }));
            await wait(() => window.__transfer);
            out.dropped = window.__transfer;
            await wait(() => app.files.some(f => f.relPath === 'Ceremony/photo2.jpg'));
            out.arrived = app.files.some(f => f.relPath === 'Ceremony/photo2.jpg');
            // Ctrl+click a project in the sidebar: a window of its own
            window.__newWindow = null;
            localStorage.setItem('jeditor.projectsFolder', JSON.stringify(window.__orderRoot));
            await Places.refresh();
            const otherRow = [...$('sb-places').querySelectorAll('.sb-row')].find(r => r.querySelector('.fr-name').textContent === 'Other');
            otherRow.querySelector('.sb-main').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
            await wait(() => window.__newWindow);
            out.ctrlClick = window.__newWindow;
            return out;
        });
        const D = 'D:\\Orders\\';
        check('a window tells the app its project and folders', r.state.path === D + 'Here' && r.state.folders.join() === ',Ceremony', JSON.stringify(r.state));
        check('Split and New window (Ctrl+Shift+N)', r.split && r.newWindow === '(start)', JSON.stringify([r.split, r.newWindow]));
        check('M lists the other window\'s folders', r.pickerRows === 'Other | Other / Ceremony', r.pickerRows);
        check('... and moves the photos there, by path', r.moved && r.moved.paths.join() === D + 'Here\\photo1.jpg' && r.moved.dest === D + 'Other\\Ceremony' && !r.moved.copy && r.gone, JSON.stringify(r.moved));
        check('... saying so, and Ctrl+Z undoes it', /Moved 1 photo into Other \/ Ceremony/.test(r.toast) && r.undo && r.undo.items[0].from === D + 'Here\\photo1.jpg', JSON.stringify([r.toast, r.undo]));
        check('photos dropped from another window onto a folder come in (Ctrl copies)', r.dropped && r.dropped.dest === D + 'Here\\Ceremony' && r.dropped.copy && r.arrived, JSON.stringify(r.dropped));
        check('Ctrl+click a project opens it in a new window', r.ctrlClick === D + 'Other', String(r.ctrlClick));
        check('windows suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: the sidebar (projects, pinned, This PC)');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const names = (el) => [...el.querySelectorAll('.sb-row .fr-name')].map(n => n.textContent);
            const rowOf = (el, name) => [...el.querySelectorAll('.sb-row')].find(r => r.querySelector('.fr-name').textContent === name);
            window.__quick = [{ name: 'Archive Scan Jobs', path: 'D:' + String.fromCharCode(92) + 'Archive Scan Jobs' }];
            await makeOrder('Alpha', 2);
            await makeOrder('Beta', 3);
            window.__modified = { Alpha: Date.now() - 86400000, Beta: Date.now() };
            await Places.refresh();
            const start = $('start-places');
            // The start screen: no projects folder yet, so it asks for one
            out.choose = !!start.querySelector('.sb-choose');
            out.drives = names(start).filter(n => /\(/.test(n)).join();
            out.quick = names(start).includes('Archive Scan Jobs');
            window.__pick = window.__orderRoot;
            start.querySelector('.sb-choose').click();
            await wait(() => names(start).includes('Beta'));
            out.projects = names(start).filter(n => ['Alpha', 'Beta'].includes(n)).join();
            await wait(() => [...start.querySelectorAll('[data-count]')].some(s => s.textContent === '3'));
            out.counts = [...start.querySelectorAll('[data-count]')].map(s => s.textContent).filter(Boolean).length > 0;
            out.folderName = start.querySelector('.sb-sec-link').textContent;
            // Search
            const search = start.querySelector('.sb-search');
            search.value = 'bet';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(() => !names(start).includes('Alpha'));
            out.search = names(start).filter(n => ['Alpha', 'Beta'].includes(n)).join();
            search.value = '';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(() => names(start).includes('Alpha'));
            // Clicking a project opens it
            rowOf(start, 'Beta').querySelector('.sb-main').click();
            await wait(() => window.__opened);
            out.opened = window.__opened;
            // New project: named, made in the projects folder, opened, listed
            window.__opened = null;
            UI.prompt = async () => 'Gamma';
            start.querySelector('[data-act="newproject"]').click();
            await wait(() => window.__opened);
            out.made = window.__opened;
            await wait(() => names(start).includes('Gamma'));
            out.listed = names(start).includes('Gamma');
            // The same name again: says so
            let said = null;
            UI.alert = async (o) => { said = o.message; };
            start.querySelector('[data-act="newproject"]').click();
            await wait(() => said);
            out.twice = said;
            // Rename (right-click): a pinned one's pin follows it
            Places.pin(window.__orderRoot + String.fromCharCode(92) + 'Gamma', 'Gamma');
            await wait(() => rowOf(start, 'Gamma'));
            rowOf(start, 'Gamma').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
            const item = [...document.querySelectorAll('#context-menu [role="menuitem"]')].find(b => b.textContent === 'Rename…');
            out.menu = [...document.querySelectorAll('#context-menu [role="menuitem"]')].map(b => b.textContent).join(', ');
            UI.prompt = async () => 'Gamma Smith';
            item.click();
            await wait(() => window.__renamed && Places.pins().some(p => p.name === 'Gamma Smith'));
            out.renamed = window.__renamed;
            out.pinMoved = Places.pins().find(p => p.name === 'Gamma Smith').path;

            // A project open: its card, and it's marked in the list
            const dir = await (await opfs('disk')).getDirectoryHandle('Alpha');
            await openOrder(dir);
            app.setView('grid');
            if (!Folders.railOpen()) Folders.toggleRail();
            const side = $('sb-places');
            await wait(() => $('sb-card').textContent.includes('Alpha') && rowOf(side, 'Alpha'));
            await wait(() => rowOf(side, 'Alpha').classList.contains('active'));
            out.card = $('sb-card').textContent.replace(/\s+/g, ' ').trim();
            out.active = rowOf(side, 'Alpha').classList.contains('active');
            $('sb-card').querySelector('[data-act="reveal"]').click();
            await wait(() => window.__revealed);
            out.revealed = window.__revealed;
            $('sb-card').querySelector('[data-act="scan"]').click();
            out.scanOpen = Scan.visible();
            Scan.close();
            $('sb-card').querySelector('[data-act="pin"]').click();
            await wait(() => [...side.querySelectorAll('.sb-pinned .fr-name')].some(n => n.textContent === 'Alpha'));
            out.pinned = Places.pins().map(p => p.name).join();
            // Renaming the open project: closed, renamed, opened again at its new name
            window.__opened = null;
            UI.prompt = async () => 'Alpha Smith';
            $('sb-card').querySelector('[data-act="rename"]').click();
            await wait(() => window.__opened);
            out.reopened = window.__opened;
            out.pinRenamed = Places.pins().map(p => p.name).join();
            const back = await (await opfs('disk')).getDirectoryHandle('Alpha Smith').catch(() => null) || await (await opfs('disk')).getDirectoryHandle('Alpha');
            await openOrder(back);
            await wait(() => $('sb-card').querySelector('[data-act="rename"]'));
            // Save edits when done, for this project: kept with its data on the PC
            const deferBox = $('sb-card').querySelector('input[data-act="defer"]');
            out.deferOff = !!deferBox && !deferBox.checked;
            deferBox.click();
            await wait(() => Edits.on());
            await Edits.flush();
            const kept = await store();
            out.deferKept = JSON.parse(await (await (await kept.getFileHandle('edits.json')).getFile()).text()).defer === true &&
                !$('edits-bar').classList.contains('hidden');

            // A drive opens out; a folder in it opens as the project
            rowOf(side, 'USB drive (E:)').querySelector('.sb-main').click();
            await wait(() => rowOf(side, 'Order 9'));
            out.inside = names(side).filter(n => /^Order/.test(n)).join();
            // Browsing: a click only opens a folder out, never loads it
            window.__opened = null;
            rowOf(side, 'Order 9').querySelector('.sb-main').click();
            await new Promise(r => setTimeout(r, 200));
            out.browseOnly = window.__opened === null;
            // Open makes it the project; so does a double-click
            rowOf(side, 'Order 9').querySelector('.sb-open').click();
            await wait(() => window.__opened);
            out.openedUsb = window.__opened;
            window.__opened = null;
            rowOf(side, 'Order 10').querySelector('.sb-main').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            await wait(() => window.__opened);
            out.dblOpened = window.__opened;

            // Sections fold away, and stay folded
            side.querySelector('[data-act="section"][data-sec="pinned"]').click();
            await wait(() => side.querySelector('.sb-sec.closed[data-sec="pinned"]'));
            out.folded = !names(side).includes('Archive Scan Jobs') && JSON.parse(localStorage.getItem('jeditor.sidebarClosed')).includes('pinned');

            // A USB drive plugged in: offered, marked New; Eject
            window.__drives = window.__drives.concat([{ path: 'F:' + String.fromCharCode(92), name: 'Backup (F:)', kind: 'usb', total: 32e9, free: 2e9 }]);
            window.__tree['F:' + String.fromCharCode(92)] = { path: 'F:' + String.fromCharCode(92), name: 'F:' + String.fromCharCode(92), parent: null, folders: [], photos: 0, more: false };
            dispatchEvent(new Event('jeditor-drives'));
            await wait(() => /Backup \(F:\) plugged in/.test(toasts()) && rowOf(side, 'Backup (F:)'));
            out.toast = toasts();
            out.isNew = !!rowOf(side, 'Backup (F:)').querySelector('.sb-new');
            rowOf(side, 'Backup (F:)').querySelector('[data-act="eject"]').click();
            await wait(() => window.__ejected && !rowOf(side, 'Backup (F:)'));
            out.ejected = window.__ejected;
            await wait(() => /can be taken out/.test(toasts()));
            out.ejectToast = /Backup \(F:\) can be taken out/.test(toasts());
            return out;
        });
        check('start screen: asks for the projects folder, lists drives and Explorer\'s pins', r.choose && /USB drive \(E:\)/.test(r.drives) && /Local disk \(C:\)/.test(r.drives) && r.quick, JSON.stringify(r));
        check('the projects folder\'s projects are listed, newest first, with photo counts', r.projects === 'Beta,Alpha' && r.counts && r.folderName === 'Orders', JSON.stringify([r.projects, r.counts, r.folderName]));
        check('search finds a project', r.search === 'Beta', r.search);
        check('clicking a project opens it', r.opened === 'D:\\Orders\\Beta', r.opened);
        check('Rename on a project\'s right-click menu; its pin follows it', /Rename…/.test(r.menu) && /Show in Explorer/.test(r.menu) && r.renamed && r.renamed[1] === 'Gamma Smith' && r.pinMoved === 'D:\\Orders\\Gamma Smith', JSON.stringify([r.menu, r.renamed, r.pinMoved]));
        check('New project: makes the folder in the projects folder, opens it and lists it; a name taken says so', r.made === 'D:\\Orders\\Gamma' && r.listed && /already a Gamma/.test(r.twice || ''), JSON.stringify([r.made, r.listed, r.twice]));
        check('the project card: name, path, photos', /Alpha/.test(r.card) && /D:\\Orders\\Alpha/.test(r.card) && /\d photos/.test(r.card), r.card);
        check('the open project is marked in the list', r.active);
        check('card: Rename closes the open project, renames it and opens it again', r.reopened === 'D:\\Orders\\Alpha Smith' && r.pinRenamed.split(',').includes('Alpha Smith') && !r.pinRenamed.split(',').includes('Alpha'), JSON.stringify([r.reopened, r.pinRenamed]));
        check('card buttons: Explorer, Scan, Pin', r.revealed === 'D:\\Orders\\Alpha' && r.scanOpen && r.pinned.split(',').includes('Alpha'), JSON.stringify([r.revealed, r.scanOpen, r.pinned]));
        check('card: Save edits when done turns on for the project, kept on the PC', r.deferOff && r.deferKept, JSON.stringify([r.deferOff, r.deferKept]));
        check('a drive opens out to its folders, in number order', r.inside === 'Order 9,Order 10', r.inside);
        check('browsing: clicking a folder only opens it out, it isn\'t loaded', r.browseOnly);
        check('... Open makes it the project, and so does a double-click', r.openedUsb === 'E:\\Order 9' && r.dblOpened === 'E:\\Order 10', JSON.stringify([r.openedUsb, r.dblOpened]));
        check('sections fold away and stay folded', r.folded);
        check('a USB drive plugged in is offered and marked New', /Backup \(F:\) plugged in/.test(r.toast) && r.isNew, JSON.stringify([r.toast, r.isNew]));
        check('Eject ejects it and says so', r.ejected === 'F:\\' && r.ejectToast, JSON.stringify([r.ejected, r.ejectToast]));
        check('sidebar suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    await browser.close();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
