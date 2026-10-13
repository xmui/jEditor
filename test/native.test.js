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
            const root = window.__orderRoot + '\\\\';
            let dir = await sub('disk');
            for (const p of o.folder.slice(root.length).split('\\\\')) dir = await dir.getDirectoryHandle(p);
            const pages = window.__scanPages || 2;
            for (let i = 0; i < pages; i++) {
                const name = o.prefix + String(o.next + i).padStart(o.digits, '0') + '.jpg';
                const c = document.createElement('canvas');
                c.width = 80; c.height = 60;
                c.getContext('2d').fillRect(0, 0, 5 + i, 5 + o.next);
                const blob = await new Promise(r => c.toBlob(r, 'image/jpeg'));
                const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
                await w.write(blob);
                await w.close();
                scanned(name);
            }
            if (window.__scanError) throw new Error(window.__scanError);
            return { count: pages };
        },
        cancelScan() { },
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
        async openPath(p) { window.__opened = p; return true; },
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

// A real JPEG: a colour with a label, so every photo's bytes differ
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
    page.on('pageerror', e => errors.push(e.message));
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
            out.devices = [...$('scan-device').options].map(o => o.textContent).join(', ');
            out.folder = $('scan-folder').value;
            out.folders = [...$('scan-folder').options].map(o => o.textContent).join(', ');
            out.names = [$('scan-prefix').value, $('scan-next').value, $('scan-preview').textContent];
            const folder = $('scan-folder');
            folder.value = 'Ceremony';
            folder.dispatchEvent(new Event('change'));
            out.cerNames = [$('scan-prefix').value, $('scan-next').value];
            folder.value = '';
            folder.dispatchEvent(new Event('change'));
            $('scan-go').click();
            out.closed = !Scan.isOpen();
            await wait(() => app.files.some(f => f.name === 'photo5.jpg'));
            out.req = window.__scanReq;
            out.files = app.files.map(f => f.relPath || f.name).sort().join(',');
            await wait(() => /Scanned 2 photos/.test(toasts()));
            out.toast = toasts();

            out.autoCropDefault = $('scan-autocrop').checked;
            // Auto crop each photo: the scans go to Auto crop once they're in
            const realCrop = app.batchAutoCrop;
            app.batchAutoCrop = async (files, opts) => { out.cropped = files.map(f => f.name).join() + (opts && opts.ask === false ? ' (no question)' : ''); };
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: 'Ceremony', autoCrop: true });
            app.batchAutoCrop = realCrop;

            // Scan more: the names carry on
            window.__scanPages = 1;
            out.more = (await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '' })).names.join(',');

            // The scanner stops with an error: says so, and what was saved
            window.__scanError = 'The scanner is busy (is another program using it?)';
            await wait(() => app.files.some(f => f.name === 'photo6.jpg'));
            await Scan.run({ device: 'EPSON FF-680W', driver: 'twain', folder: '' }).catch(e => { out.err = e.message; });
            await wait(() => UI.isOpen());
            out.alert = $('uid-title').textContent + ' — ' + $('uid-text').textContent;
            $('uid-ok').click();
            out.running = Scan.running;
            window.__scanError = null;

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
        check('it lists the scanners, WIA ones marked', r.devices === 'EPSON FF-680W, OpticBook A300 (WIA)', r.devices);
        check('it offers the order\'s folders, starting with the one with the most photos', r.folder === '' && r.folders === 'Scan Order, Ceremony', JSON.stringify([r.folder, r.folders]));
        check('names follow on from the folder\'s photos', r.names[0] === 'photo' && r.names[1] === '4' && r.names[2] === 'photo4.jpg, photo5.jpg, …', JSON.stringify(r.names));
        check('... each folder its own sequence', r.cerNames.join() === 'c,2', r.cerNames.join());
        check('Scan asks the app to scan into the order\'s folder, by path', r.closed && r.req && r.req.folder === 'D:\\Orders\\Scan Order' && r.req.device === 'EPSON FF-680W' && r.req.driver === 'twain' && r.req.prefix === 'photo' && r.req.next === 4, JSON.stringify(r.req));
        check('scanned photos show up in the order', r.files === 'Ceremony/c1.jpg,photo1.jpg,photo2.jpg,photo3.jpg,photo4.jpg,photo5.jpg', r.files);
        check('a message says how many, with Scan more', /Scanned 2 photos into Scan Order/.test(r.toast) && /Scan more/.test(r.toast), r.toast);
        check('Auto crop each photo is on to start with', r.autoCropDefault);
        check('... and crops each scan once it\'s in, without asking', r.cropped === 'c2.jpg,c3.jpg (no question)', r.cropped);
        check('scanning again carries on the names', r.more === 'photo6.jpg', r.more);
        check('a scan that fails says why, and what was saved', /busy/.test(r.err || '') && /didn't finish/.test(r.alert) && /1 photo was saved/.test(r.alert) && !r.running, JSON.stringify([r.err, r.alert]));
        check('no scanners: says so and what to check', /No scanners found/.test(r.none) && /plugged in/.test(r.none) && /TWAINDSM/.test(r.none) && r.noneDisabled, r.none);
        check('scan suite: no JS errors', errors.length === 0, errors.join('; '));
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
            out.scanOpen = Scan.isOpen();
            Scan.close();
            $('sb-card').querySelector('[data-act="pin"]').click();
            await wait(() => [...side.querySelectorAll('.sb-pinned .fr-name')].some(n => n.textContent === 'Alpha'));
            out.pinned = Places.pins().map(p => p.name).join();

            // A drive opens out; a folder in it opens as the project
            rowOf(side, 'USB drive (E:)').querySelector('.sb-main').click();
            await wait(() => rowOf(side, 'Order 9'));
            out.inside = names(side).filter(n => /^Order/.test(n)).join();
            window.__opened = null;
            rowOf(side, 'Order 9').querySelector('.sb-main').click();
            await wait(() => window.__opened);
            out.openedUsb = window.__opened;

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
        check('the project card: name, path, photos', /Alpha/.test(r.card) && /D:\\Orders\\Alpha/.test(r.card) && /\d photos/.test(r.card), r.card);
        check('the open project is marked in the list', r.active);
        check('card buttons: Explorer, Scan, Pin', r.revealed === 'D:\\Orders\\Alpha' && r.scanOpen && r.pinned === 'Alpha', JSON.stringify([r.revealed, r.scanOpen, r.pinned]));
        check('a drive opens out to its folders, in number order', r.inside === 'Order 9,Order 10', r.inside);
        check('a folder on it opens as the project', r.openedUsb === 'E:\\Order 9', r.openedUsb);
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
