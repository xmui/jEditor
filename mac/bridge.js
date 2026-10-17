// jEditor for Mac: the bridge between the jEditor UI and this app.
//
// main.js serves it before the page's own scripts. jEditor itself doesn't
// know about it. The bridge:
//   - replaces the browser's folder picker with the Mac's own, handing the
//     page a real folder handle with permission to edit already granted
//   - makes a folder handle for any path: the app drops that folder onto
//     the page (main.js) and the drop is taken here, before jEditor sees it
//   - opens folders the app is given (Finder, the Dock, the command line)
//   - gives jEditor window.JEditorNative: storage for projects' data, paths
//     on disk, Show in Finder
//   - turns off the service worker, so a changed UI file is always used
//   - tells the app the theme, for the title bar
//   - runs the smoke test (--smoke-test <folder>)

(() => {
    const mac = window.jeditorMac;
    if (!mac || window.top !== window || location.origin !== 'app://jeditor') return;

    const log = (level, text) => mac.request('log', { level, text: String(text).slice(0, 2000) });
    const answer = async (type, data) => {
        const msg = await mac.request(type, data);
        if (msg && msg.error) throw new Error(msg.error);
        return msg;
    };

    // JS errors go to the app's output, and fail the smoke test
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

    // ---- A folder handle for a path ----
    // The app drops the folder onto the page; the drop (and the drag before
    // it) is taken here, so jEditor never sees it. One at a time.
    let waiting = null; // { resolve, reject } for the drop on its way
    let queue = Promise.resolve();
    const taking = (e) => {
        if (!waiting) return false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return true;
    };
    for (const type of ['dragenter', 'dragover', 'dragleave']) addEventListener(type, taking, true);
    addEventListener('drop', (e) => {
        if (!taking(e)) return;
        const w = waiting;
        waiting = null;
        // Asked for now: the drop's data is gone once the event is over
        const item = [...(e.dataTransfer ? e.dataTransfer.items : [])].find(i => i.kind === 'file');
        const got = item && typeof item.getAsFileSystemHandle === 'function' ? item.getAsFileSystemHandle() : null;
        if (!got) return w.reject(new Error('No folder came with the drop'));
        got.then(h => (h && h.kind === 'directory' ? w.resolve(h) : w.reject(new Error('Not a folder'))), w.reject);
    }, true);

    function handleFor(path) {
        const run = queue.then(() => new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                waiting = null;
                reject(new Error('The folder didn\'t arrive: ' + path));
            }, 10000);
            waiting = {
                resolve: (h) => { clearTimeout(timer); resolve(h); },
                reject: (e) => { clearTimeout(timer); reject(e); }
            };
            answer('mint', { path }).catch(e => { if (waiting) waiting.reject(e); waiting = null; });
        }));
        queue = run.catch(() => { });
        return run.then(h => { remember(h, path); return h; });
    }

    // ---- The folder picker: the Mac's own ----
    // Same contract as the browser's: a FileSystemDirectoryHandle, or an
    // AbortError when canceled
    window.showDirectoryPicker = async function showDirectoryPicker() {
        const msg = await answer('pickFolder');
        if (msg.cancelled || !msg.path) throw new DOMException('The user aborted a request.', 'AbortError');
        return handleFor(msg.path);
    };

    // ---- Where folders are on disk ----
    // Every handle made here comes with its path. They're remembered, here
    // and in IndexedDB (for recent folders opened again another day), so
    // jEditor can ask where a folder it has is: folderPath(handle).
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

    // Paths on a Mac's disk compare ignoring case, as its file system does
    function remember(handle, path) {
        if (!handle || typeof path !== 'string' || !path) return;
        const rec = { key: path.toLowerCase(), path, handle, at: Date.now() };
        const i = known.findIndex(k => k.key === rec.key);
        if (i >= 0) known.splice(i, 1);
        known.unshift(rec);
        loadStored().then(all => inStore('readwrite', s => {
            s.put(rec);
            all.filter(r => r.key !== rec.key).slice(KEEP - 1).forEach(r => s.delete(r.key));
        })).then(() => { stored = null; }).catch(() => { /* kept for this session at least */ });
    }

    // Folders dragged in from Finder: their paths come with the drop
    addEventListener('drop', (e) => {
        if (waiting) return;
        const dt = e.dataTransfer;
        if (!dt || !dt.items || !dt.files || !dt.files.length) return;
        try {
            const items = [...dt.items].filter(i => i.kind === 'file');
            const files = [...dt.files];
            if (items.length !== files.length || typeof items[0].getAsFileSystemHandle !== 'function') return;
            const paths = files.map(f => mac.pathForFile(f));
            items.forEach((item, i) => {
                if (!paths[i]) return;
                item.getAsFileSystemHandle().then(h => {
                    if (h && h.kind === 'directory') remember(h, paths[i]);
                }).catch(() => { });
            });
        } catch (err) {
            log('warn', 'Couldn\'t tell where the dropped folder is: ' + err.message);
        }
    }, true);

    // → the folder's path, or null if it never came through here
    async function folderPath(handle) {
        if (!handle || handle.kind !== 'directory') return null;
        const name = String(handle.name || '').toLowerCase();
        const nameOf = (p) => (p.split('/').filter(Boolean).pop() || '').toLowerCase();
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
        // A folder inside one that's known: its path from there
        const inside = async (list) => {
            for (const r of list) {
                try {
                    const parts = await r.handle.resolve(handle);
                    if (parts && parts.length) return { path: [r.path.replace(/\/$/, ''), ...parts].join('/') };
                } catch (e) { /* gone */ }
            }
            return null;
        };
        let r = await look(known);
        if (!r) {
            const all = await loadStored();
            r = await look(all);
            if (r) known.push(r);
            else r = await inside(known) || await inside(all);
        }
        return r ? r.path : null;
    }

    // ---- What the app does for jEditor ----
    let onUpdateProgress = null;
    window.JEditorNative = {
        // Which app this is, and what it can do besides storage and paths
        // (app/host.js says what each feature covers)
        platform: 'mac',
        features: ['reveal', 'updates'],
        // jEditor's storage on this Mac: one folder per project (see
        // app/folder-cache.js), in the app's own private storage
        async dataDir() {
            const root = await navigator.storage.getDirectory();
            return root.getDirectoryHandle('jeditor-data', { create: true });
        },
        // Where a folder handle is on disk (null: not known)
        folderPath,
        // Open a folder by its path (a project from the stored list)
        async openPath(path) {
            const a = await whenReady();
            const ok = (await answer('exists', { paths: [path] })).exists[0];
            if (!ok) return false;
            await a.openDirectory(await handleFor(path));
            return true;
        },
        // Which of these folders are still there
        async exists(paths) {
            return (await answer('exists', { paths })).exists;
        },
        // Show a folder in Finder
        async reveal(path) {
            await answer('reveal', { path });
        },
        // → { current, tag, version, notes, size, newer }
        async checkUpdate() {
            return answer('checkUpdate');
        },
        // Downloads the newest .dmg, opens it in Finder and quits, so
        // jEditor can be dragged into Applications over this one.
        // progress(received, total) as it downloads.
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

    // The theme and the page's background color, for the title bar
    let lastTheme = null;
    const reportTheme = () => {
        const theme = document.documentElement.dataset.theme;
        const dark = theme ? theme !== 'light' : !matchMedia('(prefers-color-scheme: light)').matches;
        const background = getComputedStyle(document.body).backgroundColor;
        const key = dark + background;
        if (key !== lastTheme) {
            lastTheme = key;
            mac.request('theme', { dark, background });
        }
    };

    whenReady().then(() => {
        reportTheme();
        new MutationObserver(reportTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        mac.request('ready', { version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null });
    });

    // ---- From the app: folders to open, the menu ----
    mac.onMessage(async (msg) => {
        if (msg.type === 'openFolder') {
            const a = await whenReady();
            while (a.isLoading) await new Promise(r => setTimeout(r, 100));
            try {
                await a.openDirectory(await handleFor(msg.path));
                if (msg.smoke) await smokeTest(a);
            } catch (e) {
                log('error', 'Opening the folder failed: ' + (e && e.message || e));
                if (msg.smoke) mac.request('smoke', { ok: false, error: String(e && e.message || e), errors });
            }
        } else if (msg.type === 'updateProgress') {
            if (onUpdateProgress) onUpdateProgress(msg.received, msg.total);
        } else if (msg.type === 'menu') {
            const a = await whenReady();
            if (msg.action === 'open') a.browseFolder();
            else if (msg.action === 'settings') a.toggleCustomizePanel(true);
        }
    });

    // Opened the folder; now, with the app checking on disk: turn a photo
    // (the handle can write), flag one (the project's data is kept by the
    // app, not in the folder), delete one (gone from the folder) and undo
    // that (back), and find the folder's path from its handle
    async function smokeTest(a) {
        const steps = {};
        try {
            const file = a.files[0];
            steps.listed = a.files.length > 1 || `${a.files.length} photos listed`;
            const bytes = async () => new Uint8Array(await (await file.handle.getFile()).arrayBuffer()).join();
            const before = file && await bytes();
            steps.rotated = file && await a.rotateImage(file, 90) !== false ? true : 'not turned';
            if (file && file._rotationQueue) await Promise.race([file._rotationQueue, new Promise(r => setTimeout(r, 10000))]);
            if (steps.rotated === true && await bytes() === before) steps.rotated = 'the file didn\'t change on disk';
            Flags.apply('star', [file]);
            await Flags.save();
            const here = await folderPath(a.dirHandle);
            steps.path = here ? true : 'no path for the folder';
            let kept = false;
            for await (const [n] of (await window.JEditorNative.dataDir()).entries()) if (n.startsWith(a.dirHandle.name + '-')) kept = true;
            steps.stored = kept || 'nothing kept for the project';
            const own = [];
            for await (const [n] of a.dirHandle.entries()) own.push(n);
            steps.clean = !own.includes('.jeditor') || 'a .jeditor folder was made in the project';
            const victim = a.files.find(f => f !== file);
            if (victim) {
                const name = victim.relPath || victim.name;
                await a.moveToTrash([victim]);
                await answer('smokeCheck', { step: 'deleted', name });
                await a.undo();
                await answer('smokeCheck', { step: 'restored', name });
            }
            mac.request('smoke', { ok: true, steps, errors });
        } catch (e) {
            mac.request('smoke', { ok: false, steps, error: String(e && e.stack || e), errors });
        }
    }
})();
