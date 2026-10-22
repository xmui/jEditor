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
    // A path's folder in OPFS (create: made if it isn't there)
    const pathDir = async (p, create = false) => {
        const root = window.__orderRoot + '\\\\';
        let dir, parts;
        if (p.startsWith(root)) { dir = await sub('disk'); parts = p.slice(root.length).split(BS); }
        else if (/^[A-Z]:/.test(p)) { dir = await sub('usb-' + p[0]); parts = p.slice(3).split(BS); }
        else return null;
        try {
            for (const x of parts.filter(Boolean)) dir = await dir.getDirectoryHandle(x, { create });
        } catch (e) { return null; }
        return dir;
    };
    const copyTree = async (from, to) => {
        for await (const [n, h] of from.entries()) {
            if (n === '.jeditor') continue;
            if (h.kind === 'directory') await copyTree(h, await to.getDirectoryHandle(n, { create: true }));
            else {
                const w = await (await to.getFileHandle(n, { create: true })).createWritable();
                await w.write(await h.getFile());
                await w.close();
            }
        }
    };
    const tokens = new Map();
    window.JEditorNative = {
        platform: 'windows',
        features: ['recycle', 'reveal', 'places', 'quickAccess', 'windows', 'scan', 'camera', 'backdrop', 'log', 'updates', 'burn'],
        async dataDir() { window.__calls.push('dataDir'); return sub('appdata'); },
        async folderPath(handle) {
            if (window.__unknownPath) return null;
            const parts = await (await sub('disk')).resolve(handle);
            if (parts) return [window.__orderRoot, ...parts].join('\\\\');
            // On a USB drive: OPFS usb-E is E:\\
            for await (const [n, h] of (await opfs()).entries()) {
                if (!n.startsWith('usb-') || h.kind !== 'directory') continue;
                const p = await h.resolve(handle);
                if (p) return n.slice(4) + ':' + BS + p.join(BS);
            }
            return null;
        },
        // A folder handle for a path: D:\\Orders\\… is disk/…, E:\\… is usb-E/…
        async folderHandle(p) {
            const dir = await pathDir(p);
            if (!dir) throw new Error('That folder is not there');
            return dir;
        },
        // Disc burners (__burners); a burn says what it was asked (__burnt)
        async burners() { return window.__burners || []; },
        async burn(burner, p, label, progress, eject) {
            progress(0, 100); await new Promise(r => setTimeout(r, 20)); progress(60, 100);
            if (window.__burnError) throw new Error(window.__burnError);
            window.__burnt = { burner, path: p, label, eject };
            return { bytes: 1234 };
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
            return { count: pages, autosized: !!window.__scanAutosized };
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
        // The scanner's own settings window: saved per scanner
        async scannerSettings(device, act) {
            (window.__ownCalls = window.__ownCalls || []).push(act + ' ' + device);
            window.__ownSaved = window.__ownSaved || {};
            if (act === 'show') window.__ownSaved[device] = true;
            if (act === 'forget') delete window.__ownSaved[device];
            return { saved: !!window.__ownSaved[device], helper: true };
        },
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
        // A folder copied into another: progress, then where it went (__copyError fails it)
        copyFolder(p, dest, progress) {
            (window.__copies = window.__copies || []).push({ path: p, dest });
            const done = (async () => {
                progress(0, 100); await new Promise(r => setTimeout(r, 30)); progress(50, 100);
                if (window.__copyError) throw new Error(window.__copyError);
                const to = dest.replace(/\\$/, '') + BS + p.split(BS).pop();
                // Really copied, where both ends are folders here
                const from = await pathDir(p), into = await pathDir(to, true);
                if (from && into) await copyTree(from, into);
                return { to };
            })();
            done.copyId = 1;
            return done;
        },
        cancelCopy() { window.__copyCancelled = true; },
        async pathsOf(files) { return window.__droppedPaths || []; },
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

// host: what the fake app says it is ({ platform, features }); the
// Windows app's by default
async function newPage(context, baseUrl, host = null) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message + (process.env.STACKS ? ' @ ' + e.stack : '')));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript(FAKE_NATIVE);
    if (host) await page.addInitScript(h => Object.assign(window.JEditorNative, h), host);
    await page.goto(`${baseUrl}/index.html`);
    await page.waitForFunction(() => typeof app !== 'undefined' && app.elements);
    await page.evaluate(HELPERS);
    // A clean private file system for each test
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        for await (const [n] of root.entries()) if (['disk', 'appdata', 'bin'].includes(n) || n.startsWith('usb-')) { try { await root.removeEntry(n, { recursive: true }); } catch (e) { } }
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
            // (copied, not moved: Chromium won't move a file into jEditor's
            // storage, under AppData, and asks about "system files")
            window.__noBin = true;
            const realMove = FileSystemFileHandle.prototype.move;
            out.noBinMoves = 0;
            FileSystemFileHandle.prototype.move = function (...a) { out.noBinMoves++; return realMove.apply(this, a); };
            await app.moveToTrash([app.files.find(f => f.name === 'photo1.jpg')]);
            FileSystemFileHandle.prototype.move = realMove;
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
        check('... copied there, never moved (no "contains system files" prompt)', r.noBinMoves === 0, String(r.noBinMoves));
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
            // Auto crop's test scans (crop-log.js) are kept beside the
            // projects' folders, and aren't one
            await (await opfs('appdata')).getDirectoryHandle(CropLog.DIR, { create: true });
            await Stored.open();
            await wait(() => [...document.querySelectorAll('#stored-list li[data-key]')].some(x => /^Alpha/.test(x.textContent)));
            const testSetListed = [...document.querySelectorAll('#stored-list li[data-key]')].some(x => x.dataset.key === CropLog.DIR);
            const li = [...document.querySelectorAll('#stored-list li[data-key]')].find(x => /^Alpha/.test(x.textContent));
            li.querySelector('[data-act="open"]').click();
            await wait(() => window.__opened);
            return { path: window.__opened, closed: document.getElementById('stored-panel').classList.contains('hidden'), testSetListed };
        });
        check('Open asks the app to open that folder', opened.path === 'D:\\Orders\\Alpha' && opened.closed, JSON.stringify(opened));
        check('Auto crop\'s test scans aren\'t listed as a project', !opened.testSetListed);
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
            out.uprightDefault = $('scan-upright').checked;
            // Auto crop each photo: the scans go to Auto crop once they're in
            const realCrop = app.batchAutoCrop;
            app.batchAutoCrop = async (files, opts) => { out.cropped = files.map(f => f.name).join() + (opts && opts.ask === false ? ' (no question)' : ''); };
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: 'Ceremony', autoCrop: true });
            // ... but not when the scanner cropped each photo itself
            window.__scanAutosized = true;
            out.croppedAgain = null;
            app.batchAutoCrop = async (files) => { out.croppedAgain = files.map(f => f.name).join(); };
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: 'Ceremony', autoCrop: true });
            window.__scanAutosized = false;
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
        check('Auto crop each photo is off to start with', r.autoCropDefault === false);
        check('Turn upright is on to start with (as in FastFoto)', r.uprightDefault === true);
        check('Compatibility mode: offered for TWAIN scanners only, off to start with', r.compatShown && r.compatHiddenWia, JSON.stringify([r.compatShown, r.compatHiddenWia]));
        check('... sent with the scan, and remembered for that scanner', r.req.compat === true && r.compatKept, JSON.stringify([r.req.compat, r.compatKept]));
        check('... and crops each scan once it\'s in, without asking', r.cropped === 'c2.jpg,c3.jpg (no question)', r.cropped);
        check('... unless the scanner cropped each photo itself (its own auto-size took)', r.croppedAgain === null, String(r.croppedAgain));
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
            // Its tone: neutral (the TWAIN helper asks the driver for FastFoto's)
            out.tone = [$('scan-bright').value, $('scan-contrast').value].join();
            // The scanner's own fixes, as switches: on, as FastFoto has them;
            // gone when it doesn't crop itself (they go with its own crop)
            const shownRow = (id) => !$(id).classList.contains('hidden');
            out.fixes = [shownRow('scan-even-row'), shownRow('scan-streaks-row'), $('scan-even').checked, $('scan-streaks').checked].join();
            $('scan-autosize').checked = false;
            $('scan-autosize').dispatchEvent(new Event('change'));
            out.fixesOff = [shownRow('scan-even-row'), shownRow('scan-streaks-row')].join();
            $('scan-autosize').checked = true;
            $('scan-autosize').dispatchEvent(new Event('change'));
            $('scan-streaks').checked = false;
            $('scan-streaks').dispatchEvent(new Event('change'));
            // On screen: a spot dragged to in a bigger window is pulled back in
            localStorage.setItem('jeditor.scanDock', JSON.stringify({ x: 20, y: innerHeight + 500 }));
            Scan.fitDock();
            const dock = $('scan-panel').getBoundingClientRect();
            out.onScreen = dock.bottom <= innerHeight && dock.top >= 0;
            // Scanner's own settings…: offered for a TWAIN feeder; saved, then forgotten
            await wait(() => !$('scan-own-row').classList.contains('hidden'));
            out.ownShown = !$('scan-own-row').classList.contains('hidden') && $('scan-own-forget').classList.contains('hidden');
            $('scan-own').click();
            await wait(() => /saved/.test($('scan-own').textContent));
            out.ownSaved = $('scan-own').textContent + '|' + !$('scan-own-forget').classList.contains('hidden');
            $('scan-own-forget').click();
            await wait(() => $('scan-own-forget').classList.contains('hidden'));
            out.ownCalls = (window.__ownCalls || []).join(',');
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
            // Back in setup, the names carry on after the photos just scanned
            out.namesAfter = [$('scan-prefix').value, $('scan-next').value];
            out.howHidden = $('scan-mode-row').classList.contains('hidden');
            $('scan-swap').checked = false;
            $('scan-swap').dispatchEvent(new Event('change'));
            out.swapKept = JSON.parse(localStorage.getItem('jeditor.scanSwap'))['EPSON FF-680W'] === false;
            // A tone chosen for it is kept for it
            $('scan-contrast').value = '-20';
            $('scan-contrast').dispatchEvent(new Event('change'));
            Scan.loadOptsFor(Scan.device());
            out.toneKept = $('scan-contrast').value;
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
        check('its own fixes are switches, on to start with, shown only with its own crop', r.fixes === 'true,true,true,true' && r.fixesOff === 'false,false', JSON.stringify([r.fixes, r.fixesOff]));
        check('the scan window is pulled back on screen when its spot is off it (a smaller window)', r.onScreen);
        check('... one turned off is sent off', r.req && r.req.even === true && r.req.streaks === false, JSON.stringify(r.req));
        check('the swap is remembered for that scanner', r.swapKept);
        check('Change settings after a scan: the names carry on from it (not the numbers taken now)', r.namesAfter[0] === 'photo' && r.namesAfter[1] === '5', JSON.stringify(r.namesAfter));
        check('a scanner with only a feeder: no How choice shown', r.howHidden);
        check('a FastFoto starts at brightness 0, contrast 0 (its driver gives FastFoto\'s tone); sent with the scan', r.tone === '0,0' && r.req.brightness === 0 && r.req.contrast === 0, JSON.stringify([r.tone, r.req.brightness, r.req.contrast]));
        check('... and a tone chosen for it is kept', r.toneKept === '-20', JSON.stringify(r.toneKept));
        check('Scanner\'s own settings… opens its window, says when settings are saved, and Forget goes back', r.ownShown && r.ownSaved === 'Scanner\'s own settings… (saved)|true'
            && /^state EPSON FF-680W.*show EPSON FF-680W.*forget EPSON FF-680W/.test(r.ownCalls), JSON.stringify([r.ownShown, r.ownSaved, r.ownCalls]));
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

    console.log('native: only the scanners plugged in, and only what each can do');
    {
        const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const names = () => [...$('scan-device').options].map(o => (o.parentElement.tagName === 'OPTGROUP' ? '~' : '') + o.textContent).join(', ');
            // The FastFoto is plugged in, the OpticBook's driver is there but
            // the scanner isn't, and the app can't tell for the third
            window.__scanners = { devices: [
                { id: 'EPSON FF-680W', name: 'EPSON FF-680W', driver: 'twain', found: true },
                { id: 'Plustek OpticBook A300', name: 'Plustek OpticBook A300', driver: 'twain', found: false },
                { id: 'Mystery', name: 'Mystery', driver: 'twain', found: null }], problems: [] };
            window.__capsFor = (o) => /EPSON/.test(o.device)
                ? { bedW: 8.5, bedH: 11.7, dpis: [100, 200, 300, 600], gray: false, guessed: false, flatbed: false, feeder: true, duplex: false, dpisSure: true, optical: 600, autoSize: false }
                : /OpticBook/.test(o.device)
                    ? { bedW: 8.5, bedH: 11.7, dpis: [150, 300, 600], gray: true, guessed: false, flatbed: true, feeder: false, duplex: false, dpisSure: true, optical: 600 }
                    : { bedW: 8.27, bedH: 11.69, dpis: [75, 150, 300, 600, 1200], gray: true, guessed: true, flatbed: true, feeder: true, dpisSure: false };
            const dir = await makeOrder('Plugged Order', 2);
            await openOrder(dir);
            $('btn-scan').click();
            await wait(() => !$('scan-device').disabled && Scan.caps['EPSON FF-680W']);
            out.listed = names();
            // Resolutions: the scanner's own, none above its optical one
            out.dpis = [...$('scan-dpi').options].map(o => o.value).join() + ' | ' + $('scan-dpi').title;
            out.sureNote = $('scan-dpi-note').classList.contains('hidden');
            // No grayscale, no backs, no crop of its own: not offered
            out.gray = $('scan-color').querySelector('option[value="gray"]').hidden;
            out.sides = $('scan-sides-row').classList.contains('hidden') && $('scan-sides').value === 'front';
            out.autosize = $('scan-autosize-row').classList.contains('hidden');
            // More…: the ones not found, under their own heading
            $('scan-device').value = Scan.MORE;
            $('scan-device').dispatchEvent(new Event('change'));
            out.more = names() + ' | ' + $('scan-device').value;
            await wait(() => Scan.caps['Plustek OpticBook A300']);
            // Glass sizes: none bigger than its glass
            await Scan.fillBeds(Scan.device());
            out.beds = [...$('scan-pv-glass').options].map(o => o.value).join();
            // Unsure: the usual ones, and it says so
            $('scan-device').value = 'Mystery';
            $('scan-device').dispatchEvent(new Event('change'));
            await wait(() => Scan.caps['Mystery']);
            out.unsure = !$('scan-dpi-note').classList.contains('hidden') && /didn't say/.test($('scan-dpi-note').textContent);
            // Plugged in while the dock is open: the list follows, the choice kept
            Scan.showAllScanners = false;
            $('scan-device').value = 'EPSON FF-680W';
            $('scan-device').dispatchEvent(new Event('change'));
            window.__scanners = JSON.parse(JSON.stringify(window.__scanners));
            window.__scanners.devices[1].found = true;
            dispatchEvent(new Event('jeditor-devices'));
            await wait(() => !/~/.test(names()));
            out.plugged = names() + ' | ' + $('scan-device').value;
            // Back to a scanner asked already: its own resolutions again
            out.backTo = [...$('scan-dpi').options].map(o => o.value).join() + ' ' + $('scan-dpi-note').classList.contains('hidden');
            // None plugged in: all listed, and it says so
            window.__scanners = { devices: [{ id: 'EPSON FF-680W', name: 'EPSON FF-680W', driver: 'twain', found: false }], problems: [] };
            await Scan.loadDevices(true);
            out.none = names() + ' | ' + $('scan-problems').textContent;
            // ... and one that scans all the same (on the network) stays listed
            window.__scanners = { devices: [{ id: 'EPSON FF-680W', name: 'EPSON FF-680W', driver: 'twain', found: false }, { id: 'Mystery', name: 'Mystery', driver: 'twain', found: null }], problems: [] };
            await Scan.loadDevices(true);
            out.beforeScan = names();
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '', source: 'feeder', dpi: 300 });
            await Scan.loadDevices(true);
            out.kept = names();

            // Show each one: a switch while it scans, the same as the setting
            $('scan-show').checked = true;
            window.__scanHang = true;
            const hung = Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '', source: 'feeder', dpi: 300 });
            await wait(() => $('scan-panel').dataset.state === 'scanning');
            const live = $('scan-show-live');
            out.liveShown = live.offsetParent !== null && live.checked;
            live.click();
            out.liveOff = !$('scan-show').checked && JSON.parse(localStorage.getItem('jeditor.scan')).show === false;
            $('scan-stop').click();
            await hung;
            window.__scanHang = false;
            out.liveHidden = live.offsetParent === null;
            Scan.setState('setup');
            return out;
        });
        // Resized by a corner: kept, and fitted to the window
        const before = await page.evaluate(() => document.getElementById('scan-panel').getBoundingClientRect().toJSON());
        const grip = await page.evaluate(() => document.querySelector('#scan-panel .scan-grip[data-edge="nw"]').getBoundingClientRect().toJSON());
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(grip.x - 200, grip.y - 150, { steps: 4 });
        await page.mouse.up();
        const sized = await page.evaluate(() => {
            const p = document.getElementById('scan-panel');
            return { rect: p.getBoundingClientRect().toJSON(), kept: JSON.parse(localStorage.getItem('jeditor.scanDockSize')), sized: p.classList.contains('sized') };
        });
        await page.setViewportSize({ width: 700, height: 500 });
        const small = await page.evaluate(async () => {
            await new Promise(r => setTimeout(r, 100));
            return document.getElementById('scan-panel').getBoundingClientRect().toJSON();
        });
        await page.setViewportSize({ width: 1280, height: 860 });
        const reset = await page.evaluate(async () => {
            document.querySelector('#scan-panel .scan-grip[data-edge="se"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            const p = document.getElementById('scan-panel');
            return { sized: p.classList.contains('sized'), kept: localStorage.getItem('jeditor.scanDockSize'), w: p.getBoundingClientRect().width };
        });
        check('only the scanners plugged in are listed (and one that can\'t be told); the rest under More…', r.listed === 'EPSON FF-680W, Mystery, More: 1 not plugged in…', r.listed);
        check('... More… lists them, under their own heading, and picks one', r.more === 'EPSON FF-680W, Mystery, ~Plustek OpticBook A300 | Plustek OpticBook A300', r.more);
        check('... one plugged in while the dock is open is listed, the choice kept', r.plugged === 'EPSON FF-680W, Plustek OpticBook A300, Mystery | EPSON FF-680W', r.plugged);
        check('... none plugged in: all listed, and it says so', r.none === '~EPSON FF-680W | None of these seem to be plugged in. Is the scanner plugged in and turned on? One on the network can still be chosen.', r.none);
        check('... one that scans all the same (on the network) stays listed', r.beforeScan === 'Mystery, More: 1 not plugged in…' && r.kept === 'EPSON FF-680W, Mystery', JSON.stringify([r.beforeScan, r.kept]));
        check('resolutions: the scanner\'s own, up to its optical one', r.dpis === '100,200,300,600 | Up to 600 dpi, the scanner\'s optical resolution' && r.sureNote, r.dpis);
        check('... a scanner that didn\'t say: the usual ones, and the dock says so', r.unsure);
        check('... back to a scanner asked already: its own resolutions, not the last one\'s', r.backTo === '100,200,300,600 true', r.backTo);
        check('grayscale, backs and its own crop aren\'t offered when the scanner can\'t', r.gray && r.sides && r.autosize, JSON.stringify([r.gray, r.sides, r.autosize]));
        check('glass sizes: none bigger than the scanner\'s glass', r.beds === 'auto,a4,letter,epson', r.beds);
        check('show each one: a switch while it scans, the same setting, remembered', r.liveShown && r.liveOff && r.liveHidden, JSON.stringify([r.liveShown, r.liveOff, r.liveHidden]));
        check('the dock resizes by its corners, and the size is kept', sized.sized && sized.rect.width > before.width + 150 && sized.rect.height >= before.height && sized.kept && Math.abs(sized.kept.w - sized.rect.width) < 2, JSON.stringify([before, sized]));
        check('... no bigger than a smaller window', small.width <= 692 && small.height <= 492 && small.x >= 0 && small.y >= 0, JSON.stringify(small));
        check('... double-click an edge: its usual size', !reset.sized && reset.kept === null && Math.round(reset.w) === 400, JSON.stringify(reset));
        check('plugged suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('native: move or copy to any folder, outside the project too');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const BS = String.fromCharCode(92);
            const rows = () => [...document.querySelectorAll('#fp-list .fp-row')].map(r => (r.classList.contains('head') ? '#' : '') + (r.querySelector('.fp-name') ? r.querySelector('.fp-name').textContent : r.textContent));
            const row = (re) => [...document.querySelectorAll('#fp-list .fp-row')].find(r => re.test(r.textContent));
            const key = (k) => $('folder-picker').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
            // D: has the projects folder, D:\Orders; the archive is a project there
            window.__drives = window.__drives.concat([{ path: 'D:' + BS, name: 'Data (D:)', kind: 'disk', total: 2e12, free: 1e12 }]);
            const archive = await makeOrder('Archive', 0);
            Object.assign(window.__tree, {
                ['D:' + BS]: { path: 'D:' + BS, name: 'D:' + BS, parent: null, folders: [{ name: 'Orders', path: 'D:' + BS + 'Orders' }] },
                ['D:' + BS + 'Orders']: { path: 'D:' + BS + 'Orders', name: 'Orders', parent: 'D:' + BS, folders: [{ name: 'Archive', path: 'D:' + BS + 'Orders' + BS + 'Archive' }, { name: 'Out Order', path: 'D:' + BS + 'Orders' + BS + 'Out Order' }] },
                ['D:' + BS + 'Orders' + BS + 'Archive']: { path: 'D:' + BS + 'Orders' + BS + 'Archive', name: 'Archive', parent: 'D:' + BS + 'Orders', folders: [{ name: 'Ceremony', path: 'D:' + BS + 'Orders' + BS + 'Archive' + BS + 'Ceremony' }] }
            });
            const dir = await makeOrder('Out Order', 4);
            await openOrder(dir);
            const file = (n) => app.files.find(f => f.name === n);
            Folders.openPicker([file('photo1.jpg')], 'move');
            out.list = rows().join(', ');
            // Other folders on this PC: drives, then folders
            row(/Other folders on this PC/).click();
            await wait(() => rows().some(t => /Data \(D:\)/.test(t)));
            out.start = rows().join(', ');
            row(/Data \(D:\)/).click();
            await wait(() => rows().includes('Orders'));
            row(/^Orders/).click();
            await wait(() => rows().includes('Archive'));
            row(/^Archive/).click();
            await wait(() => rows().includes('Ceremony'));
            out.where = [...$('fp-where').querySelectorAll('.fp-crumb')].map(b => b.textContent).join(' › ');
            out.inside = rows().join(', ');
            // Backspace: up a folder
            key('Backspace');
            await wait(() => rows().includes('Out Order'));
            out.up = [...$('fp-where').querySelectorAll('.fp-crumb')].map(b => b.textContent).join(' › ');
            // A new folder typed there: made, and the photo moved into it
            $('fp-filter').value = 'Picks';
            $('fp-filter').dispatchEvent(new Event('input'));
            out.newRow = rows().join(', ');
            out.hiNew = document.querySelector('#fp-list .fp-row.hi').textContent;
            key('Enter');
            await wait(() => window.__transfer);
            out.moved = window.__transfer;
            await wait(() => !file('photo1.jpg'));
            out.gone = !file('photo1.jpg');
            out.toast = toasts();
            out.history = History.describe(app._undoStack[app._undoStack.length - 1]);
            // Next time: the folder is offered straight away, under Elsewhere
            window.__transfer = null;
            Folders.openPicker([file('photo2.jpg')], 'copy');
            out.recent = rows().join(', ');
            row(/^Picks/).click();
            await wait(() => window.__transfer);
            out.copied = window.__transfer;
            // Choose a folder… (Explorer's window); one inside the project is a move within it
            window.__transfer = null;
            window.__pick = 'D:' + BS + 'Orders' + BS + 'Out Order' + BS + 'Ceremony';
            Folders.openPicker([file('photo3.jpg')], 'move');
            row(/Choose a folder/).click();
            await wait(() => file('photo3.jpg') && file('photo3.jpg').relPath === 'Ceremony/photo3.jpg');
            out.within = !window.__transfer;
            return out;
        });
        check('Move to… offers folders elsewhere: other folders on this PC, and Explorer\'s window', /#Elsewhere, Other folders on this PC…, Choose a folder…$/.test(r.list), r.list);
        check('... browsing starts at the drives and the usual folders', r.start === '#Drives, Local disk (C:), Data (D:), USB drive (E:), #Folders, Desktop', r.start);
        check('... into a folder: Move here first, then its folders; the path above, each part a link', r.inside === 'Move here: Archive, Ceremony' && r.where === 'This PC › D: › Orders › Archive', JSON.stringify([r.inside, r.where]));
        check('... Backspace goes up a folder', /› Orders$/.test(r.up), r.up);
        check('... a name typed there: a new folder, and they go into it', r.newRow === 'Move here: Orders, New folder “Picks”' && /New folder/.test(r.hiNew) && r.moved.dest === 'D:\\Orders\\Picks' && r.moved.copy === false && r.gone, JSON.stringify([r.newRow, r.hiNew, r.moved]));
        check('... said, with Ctrl+Z (and in History)', /Moved 1 photo into Picks — Ctrl\+Z undoes it/.test(r.toast) && r.history.what === 'Move' && r.history.detail === '1 photo to Picks', JSON.stringify([r.toast, r.history]));
        check('a folder used is offered next time, under Elsewhere (and copies there)', /#Elsewhere, Picks, Other folders/.test(r.recent) && r.copied.copy === true && r.copied.dest === 'D:\\Orders\\Picks', JSON.stringify([r.recent, r.copied]));
        check('Choose a folder… inside the project moves it within the project', r.within);
        check('any folder: no JS errors', errors.length === 0, errors.join('; '));
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
        check('F12 takes a photo: RAW + JPEG come in, both into the project', r.files === 'c1.jpg,photo1.jpg,photo2.jpg,photo3.arw,photo3.jpg', r.files);
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
            const box = $('grid-view').querySelector('.grid-empty-box');
            out.message = box ? box.textContent : '';
            // Its buttons: Scan opens the scan dock, Explorer shows the folder
            box.querySelector('.btn.primary').click();
            out.scanOpened = !$('scan-panel').classList.contains('hidden');
            Scan.close();
            [...box.querySelectorAll('.btn')].find(b => b.textContent === 'Show in Explorer').click();
            out.revealed = window.__revealed;
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
        check('... saying how to fill it, with Scan and Show in Explorer buttons', /Scan into this project/.test(r.message) && /ScanShow in Explorer$/.test(r.message) && r.scanOpened && /Empty Project$/.test(r.revealed || ''), JSON.stringify([r.message, r.scanOpened, r.revealed]));
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
            // Counting stops at 1,000 ("1,000+"), but the open project's photos are all known
            window.__counts = { 'D:\\Orders\\Alpha': 1000, 'D:\\Orders\\Beta': 1000 };
            Places.counts.clear();
            await Places.refresh();
            await wait(() => rowOf(side, 'Beta') && rowOf(side, 'Beta').querySelector('.fr-count').textContent);
            out.listCounts = ['Alpha', 'Beta'].map(n => rowOf(side, n).querySelector('.fr-count').textContent).join();
            window.__counts = null;
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
            // No rename button among the card's buttons: the name itself, with a pencil by it, renames on a click
            out.noRenameButton = !$('sb-card').querySelector('.btn[data-act="rename"]') && !!$('sb-card').querySelector('button.sb-card-name[data-act="rename"] .sb-card-edit');
            $('sb-card').querySelector('.sb-card-name span').click();
            await wait(() => window.__opened);
            out.reopened = window.__opened;
            out.pinRenamed = Places.pins().map(p => p.name).join();
            const back = await (await opfs('disk')).getDirectoryHandle('Alpha Smith').catch(() => null) || await (await opfs('disk')).getDirectoryHandle('Alpha');
            await openOrder(back);
            await wait(() => $('sb-card').querySelector('.sb-card-name[data-act="rename"]'));
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
            out.isNew = !!rowOf(side, 'Backup (F:)').querySelector('.sb-new-badge');
            // The New badge sits in the row (not a line of its own), with the room left
            const fRow = rowOf(side, 'Backup (F:)');
            out.badgeInRow = fRow.querySelector('.sb-new-badge').getBoundingClientRect().width < 60 && fRow.getBoundingClientRect().height < 50;
            out.free = [...side.querySelectorAll('.sb-usb .sb-free')].map(x => x.textContent + (x.classList.contains('low') ? '!' : '') + x.querySelector('.sb-free-bar > span').style.width).join();
            // The sidebar never scrolls sideways
            const sc = side.closest('.sb-scroll');
            out.noSideScroll = getComputedStyle(sc).overflowX === 'hidden' && sc.scrollWidth <= sc.clientWidth + 1;
            // A folder dragged onto a drive is copied there, saying how far it's got
            const drag = (src, dst) => {
                const dt = new DataTransfer();
                src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
                dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
                const label = dst.dataset.dropLabel || (dst.closest('.sb-pin-target') || {}).dataset?.dropLabel;
                dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
                return label;
            };
            const projRow = [...side.querySelectorAll('.sb-projects .sb-row')].find(r => r.querySelector('.fr-name').textContent === 'Beta');
            out.dragLabel = drag(projRow, fRow);
            await wait(() => /Copied Beta to Backup \(F:\)/.test(toasts()));
            out.copied = JSON.stringify(window.__copies) + ' | ' + toasts();
            // …onto the sidebar's empty part: pinned
            const area = side.querySelector('.sb-sec-body') || side;
            await new Promise(r => setTimeout(r, 300)); // the sidebar draws again after a copy
            out.pinLabel = drag([...side.querySelectorAll('.sb-projects .sb-row')].find(r => r.querySelector('.fr-name').textContent === 'Beta'), side);
            out.pinned2 = Places.pins().some(p => p.name === 'Beta');
            // A failed copy says why
            window.__copyError = 'Not enough room on F:';
            UI.alert = async (o) => { out.copyError = o.title + ': ' + o.message; };
            await wait(() => rowOf(side, 'Backup (F:)') && !side.querySelector('.sb-pin-target'));
            drag([...side.querySelectorAll('.sb-projects .sb-row')].find(r => r.querySelector('.fr-name').textContent === 'Beta'), rowOf(side, 'Backup (F:)'));
            await wait(() => out.copyError);
            window.__copyError = null;
            void area;
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
        check('... with its real photo count; others counted up to 1,000+', r.listCounts === '3,1,000+', r.listCounts);
        check('card: no rename button; the name renames on a click, as the file name in the top pill, with a pencil by it', r.noRenameButton);
        check('card: Rename closes the open project, renames it and opens it again', r.reopened === 'D:\\Orders\\Alpha Smith' && r.pinRenamed.split(',').includes('Alpha Smith') && !r.pinRenamed.split(',').includes('Alpha'), JSON.stringify([r.reopened, r.pinRenamed]));
        check('card buttons: Explorer, Scan, Pin', r.revealed === 'D:\\Orders\\Alpha' && r.scanOpen && r.pinned.split(',').includes('Alpha'), JSON.stringify([r.revealed, r.scanOpen, r.pinned]));
        check('card: Save edits when done turns on for the project, kept on the PC', r.deferOff && r.deferKept, JSON.stringify([r.deferOff, r.deferKept]));
        check('a drive opens out to its folders, in number order', r.inside === 'Order 9,Order 10', r.inside);
        check('browsing: clicking a folder only opens it out, it isn\'t loaded', r.browseOnly);
        check('... Open makes it the project, and so does a double-click', r.openedUsb === 'E:\\Order 9' && r.dblOpened === 'E:\\Order 10', JSON.stringify([r.openedUsb, r.dblOpened]));
        check('sections fold away and stay folded', r.folded);
        check('a USB drive plugged in is offered and marked New', /Backup \(F:\) plugged in/.test(r.toast) && r.isNew, JSON.stringify([r.toast, r.isNew]));
        check('the New badge sits in the drive\'s row; a USB drive shows the room it has left (low in red)', r.isNew && r.badgeInRow && r.free === '954 MB free!98%,1.9 GB free!94%', JSON.stringify([r.badgeInRow, r.free]));
        check('the sidebar never scrolls sideways', r.noSideScroll);
        check('a folder dragged onto a drive is copied there (saying so); onto the sidebar it\'s pinned; a failed copy says why',
            r.dragLabel === 'Copy to Backup (F:)' && /"path":"D:\\\\Orders\\\\Beta","dest":"F:\\\\"/.test(r.copied) && /Copied Beta to Backup \(F:\)/.test(r.copied)
            && r.pinLabel === 'Pin to the sidebar' && r.pinned2 && /Not enough room on F:/.test(r.copyError || ''), JSON.stringify([r.dragLabel, r.copied, r.pinLabel, r.pinned2, r.copyError]));
        check('Eject ejects it and says so', r.ejected === 'F:\\' && r.ejectToast, JSON.stringify([r.ejected, r.ejectToast]));
        check('sidebar suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('drives: a project copied to a USB drive, a card imported, a disc burnt');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const BS = String.fromCharCode(92);
                const dir = await makeOrder('Alpha', 3);
                await openOrder(dir);
                await Places.refresh();
                const f = (n) => app.files.find(x => x.name === n);
                // A flag and an edit, kept on the PC
                Flags.apply('star', [f('photo1.jpg')]);
                Edits.set([{ file: f('photo2.jpg'), edit: { q: 1, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } } }], 'rotation');
                await Edits.flush();
                step = 'card button';
                await Places.drawCard();
                out.cardButton = !!document.querySelector('.sb-card [data-act="export"]') && !document.querySelector('.sb-card [data-act="todrive"]');
                // Copy: room checked, photos and data copied, a message with Eject
                step = 'copy';
                const choose0 = UI.choose, alert0 = UI.alert;
                UI.choose = async (o) => { out.asked = o.title; return 'alt'; };
                await Places.copyToDrive(Places.current(), { drive: window.__drives.find(d => d.kind === 'usb') });
                const usb = await opfs('usb-E');
                const copy = await usb.getDirectoryHandle('Alpha');
                out.copied = (await names(copy)).filter(n => n.endsWith('.jpg')).length === 3 && await has(copy, 'Ceremony', 'c1.jpg');
                out.data = await has(copy, '.jeditor', 'flags.json') && await has(copy, '.jeditor', 'edits.json');
                await wait(() => /Copied Alpha to USB drive \(E:\), flags and edits too/.test(toasts()));
                out.toast = toasts();
                // Not enough room: says so, copies nothing
                step = 'room';
                window.__copies = [];
                UI.alert = async (o) => { out.roomAlert = o.title; };
                await Places.copyToDrive(Places.current(), { drive: { path: 'F:' + BS, name: 'Tiny (F:)', kind: 'usb', free: 1000, total: 2000 } });
                out.noCopy = !window.__copies.length;
                // Copy and eject
                step = 'eject';
                UI.choose = async () => 'ok';
                await usb.removeEntry('Alpha', { recursive: true });
                await Places.copyToDrive(Places.current(), { drive: window.__drives.find(d => d.kind === 'usb') });
                await wait(() => window.__ejected);
                out.ejected = window.__ejected === 'E:' + BS;
                UI.choose = choose0;
                UI.alert = alert0;

                // Opened from the drive (on another PC, say): its flags and
                // edits are taken in, the .jeditor folder taken out
                step = 'opened from the drive';
                const copied = await (await opfs('usb-E')).getDirectoryHandle('Alpha');
                await openOrder(copied);
                await wait(() => !(window.__hasJeditor) && f('photo2.jpg') && f('photo2.jpg')._edit);
                out.carried = !!(f('photo2.jpg')._edit && f('photo2.jpg')._edit.q === 1) && !!(f('photo1.jpg')._flags && f('photo1.jpg')._flags.star);
                await wait(async () => !(await has(copied, '.jeditor')));
                out.jeditorGone = !(await has(copied, '.jeditor'));
                await openOrder(dir);

                // A camera's card plugged in: offered to import
                step = 'card';
                const card = await opfs('usb-G');
                const dcim = await (await card.getDirectoryHandle('DCIM', { create: true })).getDirectoryHandle('100CANON', { create: true });
                for (let i = 1; i <= 3; i++) await write(dcim, `IMG_000${i}.JPG`, await jpeg('hsl(' + i * 90 + ',60%,50%)', 'card ' + i));
                await write(dcim, 'MVI_0004.MOV', new Blob([new Uint8Array(100)]));
                window.__drives = window.__drives.concat([{ path: 'G:' + BS, name: 'EOS_DIGITAL (G:)', kind: 'usb', total: 32e9, free: 30e9 }]);
                window.__tree['G:' + BS] = { path: 'G:' + BS, name: 'G:' + BS, parent: null, folders: [{ name: 'DCIM', path: 'G:' + BS + 'DCIM' }], photos: 0, more: false };
                dispatchEvent(new Event('jeditor-drives'));
                await wait(() => /a camera's card — import its photos\?/.test(toasts()));
                out.offered = /EOS_DIGITAL \(G:\): a camera's card/.test(toasts());
                // Imported into this project, by day
                step = 'import';
                const going = Import.open({ path: 'G:' + BS, name: 'EOS_DIGITAL (G:)' });
                await wait(() => !document.getElementById('import-panel').classList.contains('hidden'));
                out.summary = document.getElementById('import-summary').textContent;
                document.getElementById('import-to-here').checked = true;
                document.getElementById('import-to-here').dispatchEvent(new Event('change'));
                document.getElementById('import-by-date').checked = false;
                document.getElementById('import-eject').checked = false;
                out.goLabel = document.getElementById('import-go').textContent;
                document.getElementById('import-go').click();
                await going;
                const after = await names(dir);
                out.imported = ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG'].every(n => after.includes(n)) && !after.includes('MVI_0004.MOV');
                await wait(() => /Imported 3 photos from EOS_DIGITAL/.test(toasts()));
                out.importToast = /Imported 3 photos/.test(toasts());
                // Again: nothing new
                step = 'again';
                const again = Import.open({ path: 'G:' + BS, name: 'EOS_DIGITAL (G:)' });
                await wait(() => !document.getElementById('import-panel').classList.contains('hidden'));
                out.nothingNew = document.getElementById('import-go').disabled && /Nothing new/.test(document.getElementById('import-go').textContent) && /0 not imported before/.test(document.getElementById('import-summary').textContent);
                document.getElementById('import-cancel').click();
                await again;

                // A disc burnt: edits not saved offered first; the name asked
                step = 'burn';
                window.__burners = [{ id: 'b1', name: 'HL-DT-ST DVDRAM', drive: 'F:' + BS, media: 'DVD-R', blank: true, free: 4.7e9, canWrite: true }];
                UI.choose = choose0;
                const $ = (id) => document.getElementById(id);
                Disc.open(Places.current());
                await wait(() => $('ex-label'));
                out.burnAsked = $('ex-body').textContent;
                out.burnPrompt = $('ex-title').textContent + ' / ' + $('ex-label').value + ' / ' + $('ex-go').textContent;
                $('ex-label').value = 'Alpha 2026';
                $('ex-label').dispatchEvent(new Event('input', { bubbles: true }));
                $('ex-save-first').click(); // burnt as they are
                $('ex-go').click();
                await wait(() => window.__burnt);
                out.burnt = window.__burnt;
                await wait(() => /Burnt Alpha to the DVD-R/.test(toasts()));
                out.burnToast = /Burnt Alpha/.test(toasts());
                // No blank disc: says so
                step = 'no disc';
                window.__burners = [{ id: 'b1', name: 'HL-DT-ST DVDRAM', drive: 'F:' + BS, media: 'none', blank: false, free: 0, canWrite: false }];
                Disc.open(Places.current());
                await wait(() => /No disc/.test($('ex-body').textContent));
                out.noDisc = $('ex-go').disabled + ' ' + $('ex-note').textContent;
                $('ex-cancel').click();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('drives: the project card has one Export button (USB drive, disc, copies)', r.cardButton, JSON.stringify(r));
        check('drives: a project copied to a USB drive in one step, its flags and edits with it, Eject offered', r.copied && r.data && /Copy Alpha to USB drive/.test(r.asked || '') && /Eject/.test(r.toast || ''), JSON.stringify(r));
        check('drives: not enough room says so, and nothing\'s copied; Copy and eject ejects', /Not enough room on Tiny/.test(r.roomAlert || '') && r.noCopy && r.ejected, JSON.stringify(r));
        check('drives: opened from the drive, the project\'s flags and edits are taken in', r.carried && r.jeditorGone, JSON.stringify(r));
        check('import: a camera\'s card plugged in is offered to import', r.offered, JSON.stringify(r));
        check('import: its photos (not its videos) copied into the project; nothing new the second time', r.imported && r.importToast && /Import 3 photos/.test(r.goLabel || '') && /3 photos/.test(r.summary || '') && r.nothingNew, JSON.stringify(r));
        check('burn: in Export, the burner and its blank disc, edits offered to save first, the disc named, burnt, and said', /Save the edits into 1 photo first/.test(r.burnAsked || '') && /Blank DVD-R/.test(r.burnAsked || '') && r.burnPrompt === 'Export Alpha / Alpha / Burn to the DVD-R' && r.burnt && r.burnt.label === 'Alpha 2026' && r.burnt.path === 'D:\\Orders\\Alpha' && r.burnToast, JSON.stringify(r));
        check('burn: no blank disc in the drive says so, and Burn waits', /^true Put a blank disc in/.test(r.noDisc || ''), JSON.stringify(r));
        check('drives suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('export: one window for a USB drive, a disc and copies');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl);
        const r = await page.evaluate(async () => {
            const out = {};
            const $ = (id) => document.getElementById(id);
            const BS = String.fromCharCode(92);
            const opfs = async (n) => (await navigator.storage.getDirectory()).getDirectoryHandle(n, { create: true });
            for (const n of ['usb-E']) try { await (await navigator.storage.getDirectory()).removeEntry(n, { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await makeOrder('Beta', 3);
            await openOrder(dir);
            await Places.refresh();
            const f = (n) => app.files.find(x => x.name === n);
            Flags.apply('star', [f('photo2.jpg'), f('photo3.jpg')]);
            window.__burners = [{ id: 'b1', name: 'HL-DT-ST DVDRAM', drive: 'F:' + BS, media: 'DVD-R', blank: true, free: 4.7e9, canWrite: true }];
            // From the project card: the USB drive to start with, room shown
            await Places.drawCard();
            document.querySelector('.sb-card [data-act="export"]').click();
            await wait(() => !$('export-panel').classList.contains('hidden') && /Disc|DVD/.test($('ex-tabs').textContent));
            out.tabs = [...$('ex-tabs').querySelectorAll('button')].map(b => b.textContent + (b.classList.contains('active') ? '*' : '')).join(', ');
            out.usb = $('ex-body').textContent.replace(/\s+/g, ' ').trim();
            out.usbGo = $('ex-go').textContent;
            // Copy, not ejected after: no more questions
            $('ex-eject').click();
            const choose0 = UI.choose;
            UI.choose = async () => { out.askedAgain = true; return null; };
            $('ex-go').click();
            await wait(() => /Copied Beta to USB drive/.test(toasts()));
            UI.choose = choose0;
            out.copied = !!(await (await opfs('usb-E')).getDirectoryHandle('Beta').catch(() => null));
            out.ejected = window.__ejected || null;
            // Copies of the selected photos, smaller, into the project's export folder
            Export.open({ files: [f('photo1.jpg')] });
            out.copiesTab = [...$('ex-tabs').querySelectorAll('button.active')].map(b => b.textContent).join();
            out.which = [...$('ex-body').querySelectorAll('input[name="ex-which"]')].map(i => i.parentElement.textContent.trim() + (i.checked ? '*' : '')).join(' | ');
            // (Other…: a size typed)
            $('ex-size').value = 'custom';
            $('ex-size').dispatchEvent(new Event('change', { bubbles: true }));
            $('ex-size-px').value = '100';
            $('ex-size-px').dispatchEvent(new Event('input', { bubbles: true }));
            out.copiesGo = $('ex-go').textContent;
            $('ex-go').click();
            await wait(() => /Exported 1 to "jEditor Export"/.test(toasts()));
            const exported = await (await dir.getDirectoryHandle('jEditor Export')).getFileHandle('photo1.jpg').then(h => h.getFile());
            const bmp = await createImageBitmap(exported);
            out.size = Math.max(bmp.width, bmp.height);
            // The starred, onto the USB drive
            Export.open({ tab: 'copies' });
            [...$('ex-body').querySelectorAll('input[name="ex-which"]')].find(i => i.value === 'star').click();
            [...$('ex-body').querySelectorAll('input[name="ex-where"]')].find(i => i.value.startsWith('drive:')).click();
            out.starGo = $('ex-go').textContent;
            $('ex-go').click();
            await wait(() => /Exported 2 to USB drive/.test(toasts()));
            const onUsb = await (await (await opfs('usb-E')).getDirectoryHandle('jEditor Export')).getDirectoryHandle('Beta');
            const names = [];
            for await (const k of onUsb.keys()) names.push(k);
            out.onUsb = names.sort().join();
            // Remembered: the size, not the drive
            out.kept = JSON.parse(localStorage.getItem('jeditor.export'));
            // ⋯ on the selection bar: Export… opens it on Copies
            app.selection = new Set([f('photo1.jpg'), f('photo2.jpg')]);
            const item = app.selectionMoreItems().find(i => /^Export/.test(i[0]));
            out.menu = item[0];
            item[1]();
            out.fromMenu = $('ex-title').textContent + ' / ' + $('ex-go').textContent;
            $('ex-cancel').click();
            out.closed = $('export-panel').classList.contains('hidden');
            return out;
        });
        check('export: the project card opens one window: USB drive or card, CD or DVD, Copies', r.tabs === 'USB drive or card*, CD or DVD, Copies', r.tabs);
        check('... USB: the drive, its room and whether it fits; Eject after offered', /USB drive \(E:\)/.test(r.usb) && /free of/.test(r.usb) && /Fits/.test(r.usb) && /Eject it when it's done/.test(r.usb) && r.usbGo === 'Copy to USB drive (E:)', JSON.stringify([r.usb, r.usbGo]));
        check('... copied in one step (no more questions), not ejected when that\'s off', r.copied && !r.askedAgain && !r.ejected, JSON.stringify(r));
        check('... Copies: opened with the photos selected, smaller, into "jEditor Export"', r.copiesTab === 'Copies' && /photo selected\*/.test(r.which) && /2 starred/.test(r.which) && r.copiesGo === 'Export 1 copy' && r.size === 100, JSON.stringify(r));
        check('... the starred onto the USB drive, in its own folder', r.starGo === 'Export 2 copies' && r.onUsb === 'photo2.jpg,photo3.jpg', JSON.stringify([r.starGo, r.onUsb]));
        check('... the size is remembered, a drive isn\'t', r.kept.size === 100 && r.kept.where === 'project', JSON.stringify(r.kept));
        check('... ⋯ on the selection bar opens it, on the selection', r.menu === 'Export 2…' && r.fromMenu === 'Export 2 photos / Export 2 copies' && r.closed, JSON.stringify([r.menu, r.fromMenu]));
        check('export: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('an app with only the core (as the Mac app will start)');
    {
        const context = await browser.newContext();
        const { page, errors } = await newPage(context, baseUrl, { platform: 'mac', features: ['reveal'] });
        const r = await page.evaluate(async () => {
            const out = {};
            const shown = (el) => !!el && getComputedStyle(el).display !== 'none';
            const dir = await makeOrder('Mac Order', 3);
            await openOrder(dir);
            app.setView('grid');
            out.buttons = ['btn-scan', 'btn-camera', 'sb-places', 'sb-card', 'start-places', 'upd-log', 'set-backdrop-row', 'scan-panel', 'cam-panel']
                .filter(id => shown(document.getElementById(id)));
            out.pages = app.settingsPages();
            out.windows = Windows.others.length === 0 && !document.querySelector('.fr-row[draggable]');
            // Nothing says Explorer, Recycle Bin or this PC; no word left as {files}
            const texts = [];
            const walk = (el) => {
                if (el.classList && el.classList.contains('host-missing')) return;
                for (const a of ['title', 'aria-label', 'data-native-text', 'data-native-title']) if (el.getAttribute && el.getAttribute(a)) texts.push(el.getAttribute(a));
                for (const c of el.childNodes) c.nodeType === 3 ? texts.push(c.nodeValue) : c.nodeType === 1 && c.tagName !== 'SCRIPT' && walk(c);
            };
            walk(document.body);
            out.windowsWords = texts.filter(t => /Explorer|Recycle Bin|this PC|\{(files|computer|bin)\}|Ctrl\+(?!wheel)/.test(t)).map(t => t.trim().slice(0, 80));
            out.trashTitle = document.getElementById('btn-trash').title;
            out.cacheLabel = document.querySelector('[for="cust-folder-cache"] small').textContent;
            // Deleting: no Recycle Bin, so jEditor's trash; Ctrl+Z restores
            await app.moveToTrash([app.files.find(f => f.name === 'photo2.jpg')]);
            out.recycled = window.__calls.filter(c => c.startsWith('recycle'));
            out.trashed = await names(await (await store()).getDirectoryHandle('trash'));
            out.toast = toasts();
            await app.undo();
            out.back = await names(dir);
            app.clearSelection();
            app.toggleInfoPanel(true);
            await wait(() => /Kept on this Mac/.test(document.getElementById('info-list').textContent));
            out.info = /Kept on this Mac/.test(document.getElementById('info-list').textContent);
            out.say = Host.say('Show in {files}');
            return out;
        });
        check('what it can\'t do isn\'t shown: scanning, camera, sidebar places, updates, the log, the window backdrop', r.buttons.length === 0 && !r.pages.includes('updates'), JSON.stringify([r.buttons, r.pages]));
        check('no windows to drag photos or folders to', r.windows);
        check('its own words: no Explorer, Recycle Bin, this PC or Ctrl+, and no {placeholder} left', r.windowsWords.length === 0 && r.say === 'Show in Finder', JSON.stringify(r.windowsWords));
        check('the order\'s data is kept by the app ("this Mac")', /this Mac/.test(r.cacheLabel) && r.info, JSON.stringify([r.cacheLabel, r.info]));
        check('deleting uses jEditor\'s trash (no Recycle Bin asked for) and says so, with the Mac\'s keys (⌘Z)', r.recycled.length === 0 && r.trashed.join() === 'photo2.jpg' && /Moved 1 to jEditor's trash — ⌘Z to restore/.test(r.toast) && /jEditor's trash/.test(r.trashTitle), JSON.stringify([r.recycled, r.trashed, r.toast, r.trashTitle]));
        check('... and Ctrl+Z restores it', r.back.includes('photo2.jpg'), r.back.join());
        check('core app suite: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    await browser.close();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
