// jEditor for Windows: the bridge between the jEditor UI and this app.
//
// The app runs this before the page's own scripts, on every page load.
// jEditor itself doesn't know about it. The bridge:
//   - replaces the browser's folder picker with Windows' own, handing the
//     page a real folder handle with permission to edit already granted,
//     so jEditor's file code runs unchanged and never asks for permission
//   - opens a folder the app was started with (jEditor.exe "D:\Orders\Smith")
//   - gives jEditor window.JEditorNative: storage on this PC for orders'
//     data, the Recycle Bin, paths on disk, and updates
//   - turns off the service worker, so a changed UI file is always used
//   - tells the app when the theme changes, for the title bar's colour
//   - in dev mode: reload and DevTools keys, and changed stylesheets
//     swapped in without reloading
//   - runs the smoke test (jEditor.exe --smoke-test <folder>)
//
// Messages go both ways over chrome.webview: { type, ... } objects, with
// folder handles in the message's additionalObjects.

(() => {
    const webview = window.chrome && window.chrome.webview;
    if (!webview || window.top !== window || location.origin !== 'https://jeditor.example') return;

    const post = (msg) => webview.postMessage(msg);
    const log = (level, text) => post({ type: 'log', level, text: String(text).slice(0, 2000) });

    // JS errors go to the app's log (--log), and fail the smoke test
    const errors = [];
    addEventListener('error', (e) => {
        const text = e.message || String(e.error);
        errors.push(text);
        log('error', `${text} (${e.filename || '?'}:${e.lineno || 0})`);
    });
    addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        const text = 'Unhandled rejection: ' + (r && r.stack || r);
        errors.push(text);
        log('error', text);
    });

    // ---- Requests to the app, answered by { replyTo: id, ... } ----
    let nextId = 1;
    const pending = new Map();
    // `objects`: Files to send along (the app reads their paths on disk).
    // Only Files from outside the page (dropped or chosen) can go: a File
    // from a file handle can't, postMessageWithAdditionalObjects throws.
    const request = (type, data = {}, objects = null) => new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        if (objects && objects.length) webview.postMessageWithAdditionalObjects({ type, id, ...data }, objects);
        else post({ type, id, ...data });
    });
    const answer = async (type, data, objects) => {
        const { msg, objects: got } = await request(type, data, objects);
        if (msg.error) throw new Error(msg.error);
        return { msg, objects: got };
    };

    webview.addEventListener('message', (e) => {
        const msg = e.data || {};
        const objects = e.additionalObjects || [];
        if (msg.replyTo && pending.has(msg.replyTo)) {
            const resolve = pending.get(msg.replyTo);
            pending.delete(msg.replyTo);
            resolve({ msg, objects });
        } else if (msg.type === 'openFolder' && objects[0]) {
            remember(objects[0], msg.path);
            openFolder(objects[0], msg);
        } else if (msg.type === 'reloadCss') {
            reloadCss();
        } else if (msg.type === 'updateProgress' && onUpdateProgress) {
            onUpdateProgress(msg.received, msg.total);
        } else if (msg.type === 'scanned' && onScanned) {
            onScanned(msg.name);
        } else if (msg.type === 'drivesChanged') {
            dispatchEvent(new Event('jeditor-drives')); // places.js
        }
    });

    // ---- The folder picker: Windows' own ----
    // Same contract as the browser's: a FileSystemDirectoryHandle, or an
    // AbortError when cancelled
    window.showDirectoryPicker = async function showDirectoryPicker() {
        const { msg, objects } = await request('pickFolder');
        if (msg.cancelled || !objects[0]) throw new DOMException('The user aborted a request.', 'AbortError');
        remember(objects[0], msg.path);
        return objects[0];
    };

    // ---- Where folders are on disk ----
    // The app sends every folder handle with its path. They're remembered,
    // here and in IndexedDB (for recent orders opened again another day),
    // so jEditor can ask where a folder it has is: folderPath(handle).
    const known = []; // { key, path, handle, at }, newest first
    const KEEP = 500;
    let stored = null; // what IndexedDB has, read once
    const folders = () => new Promise((resolve, reject) => {
        const r = indexedDB.open('jeditor-native', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('folders', { keyPath: 'key' });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    const inStore = (mode, run) => folders().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('folders', mode);
        const out = run(tx.objectStore('folders'));
        tx.oncomplete = () => { db.close(); resolve(out && out.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    }));
    const loadStored = () => stored || (stored = inStore('readonly', s => s.getAll())
        .then(all => (all || []).sort((a, b) => b.at - a.at))
        .catch(() => []));

    function remember(handle, path) {
        if (!handle || typeof path !== 'string' || !path) return;
        const rec = { key: path.toLowerCase(), path, handle, at: Date.now() };
        const i = known.findIndex(k => k.key === rec.key);
        if (i >= 0) known.splice(i, 1);
        known.unshift(rec);
        loadStored().then(all => inStore('readwrite', s => {
            s.put(rec);
            // The oldest go once there are many
            all.filter(r => r.key !== rec.key).slice(KEEP - 1).forEach(r => s.delete(r.key));
        })).then(() => { stored = null; }).catch(() => { /* kept for this session at least */ });
    }

    // Folders dragged in from Explorer: their paths come with the drop
    let dropping = Promise.resolve();
    addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (!dt || !dt.files || !dt.files.length || !dt.items) return;
        try {
            const items = [...dt.items].filter(i => i.kind === 'file');
            const files = [...dt.files];
            if (items.length !== files.length || typeof items[0].getAsFileSystemHandle !== 'function') return;
            const handles = items.map(i => i.getAsFileSystemHandle());
            const paths = request('pathsOf', {}, files);
            dropping = Promise.all([Promise.all(handles), paths]).then(([hs, { msg }]) => {
                hs.forEach((h, i) => { if (h && h.kind === 'directory') remember(h, (msg.paths || [])[i]); });
            }).catch(e => log('warn', 'Couldn\'t tell where the dropped folder is: ' + e.message));
        } catch (err) {
            log('warn', 'Couldn\'t tell where the dropped folder is: ' + err.message);
        }
    }, true);

    // → the folder's path, or null if the app never sent it
    async function folderPath(handle) {
        if (!handle || handle.kind !== 'directory') return null;
        await dropping;
        const name = String(handle.name || '').toLowerCase();
        const nameOf = (p) => (p.split(/[\\/]/).filter(Boolean).pop() || '').toLowerCase();
        const look = async (list) => {
            // Same name first: a quick check before asking each one
            const ordered = [...list.filter(r => nameOf(r.path) === name), ...list.filter(r => nameOf(r.path) !== name)];
            for (const r of ordered) {
                try {
                    if (r.handle === handle || await r.handle.isSameEntry(handle)) return r;
                } catch (e) { /* gone */ }
            }
            return null;
        };
        let r = await look(known);
        if (!r) {
            r = await look(await loadStored());
            if (r) known.push(r);
        }
        return r ? r.path : null;
    }

    // ---- What the app does for jEditor ----
    let onUpdateProgress = null;
    let onScanned = null;
    window.JEditorNative = {
        // jEditor's storage on this PC: a folder handle, one subfolder per
        // order (see app/folder-cache.js)
        async dataDir() {
            const { objects } = await answer('dataDir');
            if (!objects[0]) throw new Error('No storage');
            return objects[0];
        },
        // Where a folder handle is on disk (null: not known)
        folderPath,
        // Files to the Recycle Bin, by path. Per file: { token } (Ctrl+Z:
        // restore), { noBin } (its drive has no Recycle Bin: keep it some
        // other way), { gone } (not there) or { error }
        async recycle(paths) {
            return (await answer('recycle', { paths })).msg.results;
        },
        // Back from the Recycle Bin. Per token: { ok } or { error }
        async restore(tokens) {
            return (await answer('restore', { tokens })).msg.results;
        },
        // Open a folder by its path (an order from the stored list)
        async openPath(path) {
            return (await answer('openPath', { path })).msg.ok;
        },
        // Which of these folders are still there
        async exists(paths) {
            return (await answer('exists', { paths })).msg.exists;
        },
        // → { current, tag, version, notes, size, newer }
        async checkUpdate() {
            return (await answer('checkUpdate')).msg;
        },
        // The drives on this PC (USB ones too) and the usual folders →
        // { drives: [{ path, name, kind: usb|disk|network|cd, label, total, free }], home: [{ name, path }] }.
        // A 'jeditor-drives' event on window says a drive came or went.
        async places() {
            return (await answer('places')).msg;
        },
        // A folder's folders → { path, name, parent, folders: [{ name, path }], photos, more }
        async listDir(path) {
            return (await answer('listDir', { path })).msg;
        },
        // Scanners on this PC → { devices: [{ id, name, driver }], problems: [text] }
        async scanners() {
            return (await answer('scanners')).msg;
        },
        // Scans into a folder of the order (its path), named prefix + next…
        // ({ device, driver, folder, prefix, next, digits }). The scanner's
        // own window opens; scanned(name) as each photo lands.
        // → { count, names, cancelled? }; throws if the scan failed (with
        // the names saved before it did)
        async scan(options, scanned) {
            onScanned = scanned || null;
            try {
                const { msg } = await request('scan', options);
                if (msg.error) {
                    const e = new Error(msg.error);
                    e.count = msg.count || 0;
                    e.names = msg.names || [];
                    throw e;
                }
                return { count: msg.count || 0, names: msg.names || [], cancelled: !!msg.cancelled };
            } finally {
                onScanned = null;
            }
        },
        cancelScan() {
            post({ type: 'cancelScan' });
        },
        // Downloads and runs the newest setup; jEditor then closes and the
        // setup opens it again. progress(received, total) as it downloads.
        async installUpdate(progress) {
            onUpdateProgress = progress || null;
            try { await answer('installUpdate'); } finally { onUpdateProgress = null; }
        }
    };

    // ---- No service worker ----
    // It would cache the UI files, and a changed file should show at once
    if (window.ServiceWorkerContainer) {
        ServiceWorkerContainer.prototype.register = function () { return Promise.resolve(undefined); };
        navigator.serviceWorker.getRegistrations()
            .then(regs => regs.forEach(r => r.unregister()))
            .catch(() => { });
    }

    // ---- jEditor started and ready ----
    // `app` is jEditor's main object (a global from script.js)
    const jeditor = () => (typeof app !== 'undefined' && app && app.elements ? app : null);
    const whenReady = () => new Promise((resolve) => {
        const check = () => {
            const a = document.readyState !== 'loading' && jeditor();
            if (a) resolve(a); else setTimeout(check, 50);
        };
        check();
    });

    // The theme and the page's background colour, for the title bar and
    // what shows while the window resizes
    let lastTheme = null;
    const reportTheme = () => {
        const theme = document.documentElement.dataset.theme;
        const dark = theme ? theme !== 'light' : !matchMedia('(prefers-color-scheme: light)').matches;
        const background = getComputedStyle(document.body).backgroundColor;
        const key = dark + background;
        if (key !== lastTheme) {
            lastTheme = key;
            post({ type: 'theme', dark, background });
        }
    };

    whenReady().then(() => {
        reportTheme();
        new MutationObserver(reportTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        post({ type: 'ready', version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null });
    });

    // ---- A folder from the app (command line, smoke test) ----
    async function openFolder(handle, msg) {
        const a = await whenReady();
        while (a.isLoading) await new Promise(r => setTimeout(r, 100));
        try {
            await a.openDirectory(handle);
            post({ type: 'opened', name: handle.name, count: a.files.length });
            if (msg.smoke) await smokeTest(a);
        } catch (e) {
            log('error', 'Opening the folder failed: ' + (e && e.message || e));
            if (msg.smoke) post({ type: 'smoke', ok: false, error: String(e && e.message || e), errors });
        }
    }

    // Opened the folder; now, with the app checking on disk after each step:
    // save an edit (the handle can write), flag a photo (the order's data
    // goes to jEditor's storage, not the folder), delete one (it's in the
    // Recycle Bin) and undo that (it's back, unchanged), and look for updates
    async function smokeTest(a) {
        const steps = {};
        const check = async (step, data = {}) => {
            const { msg } = await request('smokeCheck', { step, ...data });
            steps[step] = msg.ok ? true : (msg.detail || 'failed');
        };
        const listed = a.files.length;
        const file = a.files[0];
        const rotated = file ? await a.rotateImage(file, 90) !== false : false;
        try {
            Flags.apply('star', [file]);
            await Flags.save();
            await check('stored');
            const victim = a.files.find(f => f !== file);
            if (victim) {
                const name = victim.relPath || victim.name;
                await a.moveToTrash([victim]);
                const last = (a._undoStack || [])[a._undoStack.length - 1];
                steps.recycled = !!(last && last.type === 'trash' && last.items[0] && last.items[0].recycled) || 'not sent to the Recycle Bin';
                await check('deleted', { name });
                await a.undo();
                await check('restored', { name });
            }
            // Scanning, with the app's test scanner: three photos into the
            // order, named next in its sequence, shown as they land
            if (typeof Scan !== 'undefined') {
                const { devices, problems } = await window.JEditorNative.scanners();
                steps.scanners = devices.map(d => `${d.name} (${d.driver})`).concat(problems || []).join('; ');
                const test = devices.find(d => d.driver === 'test');
                if (!test) {
                    steps.scanned = 'no test scanner';
                } else {
                    const r = await Scan.run({ device: test.id, driver: test.driver, folder: '' });
                    const shown = () => r.names.filter(n => a.files.some(f => (f.relPath || f.name) === n)).length;
                    for (let i = 0; i < 75 && shown() < r.names.length; i++) await new Promise(res => setTimeout(res, 200));
                    await check('scanned', { names: r.names, shown: shown() });
                }
            }
            // Browse: the drives, and this folder's photos counted on disk
            {
                const places = await window.JEditorNative.places();
                steps.places = places.drives.length ? true : 'no drives listed';
                const here = await window.JEditorNative.folderPath(a.dirHandle);
                const l = here ? await window.JEditorNative.listDir(here) : null;
                const top = a.files.filter(f => !(f.relPath || '').includes('/')).length;
                steps.browsed = !l ? 'no path for the folder' : l.photos === top ? true : `Browse counts ${l.photos} photos, jEditor shows ${top}`;
            }
            try {
                const u = await window.JEditorNative.checkUpdate();
                steps.update = `latest ${u.tag}, this is ${u.current}${u.newer ? ' (newer available)' : ''}`;
            } catch (e) {
                steps.update = 'not checked: ' + e.message; // network; not a failure
            }
        } catch (e) {
            steps.error = String(e && e.message || e);
        }
        post({ type: 'smoke', ok: true, count: listed, rotated, file: file ? file.name : null, steps, errors });
    }

    // ---- Dev mode (jEditor.exe --ui <dir>) ----
    // F5 or Ctrl+R reloads, F12 or Ctrl+Shift+I opens DevTools. The
    // browser's own shortcuts are off, so they don't take Ctrl+F and others
    // from jEditor.
    if (window.__jeditorDev) {
        addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            const action = (k === 'f5' || (e.ctrlKey && !e.shiftKey && k === 'r')) ? 'reload'
                : (k === 'f12' || (e.ctrlKey && e.shiftKey && k === 'i')) ? 'devtools' : null;
            if (!action) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            post({ type: 'dev', action });
        }, true);
    }

    // A changed stylesheet swaps in without reloading, keeping the open
    // folder and everything else as it is
    // The new one loads before the old one goes, so nothing flashes
    function reloadCss() {
        for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
            const url = new URL(link.href);
            if (url.origin !== location.origin) continue;
            url.searchParams.set('v', Date.now());
            const fresh = link.cloneNode();
            fresh.href = url.href;
            fresh.onload = fresh.onerror = () => link.remove();
            link.after(fresh);
        }
    }
})();
