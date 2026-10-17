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
    let nextCopy = 1;
    const copying = new Map(); // folder copy id → progress(done, total)

    // A folder of the page's storage under another name: its files moved
    // one by one (Chromium moves files there, not folders; copied where it
    // can't), then the old one removed → the new folder
    async function moveDir(src, parent, name) {
        const dest = await parent.getDirectoryHandle(name, { create: true });
        for await (const [n, h] of src.entries()) {
            if (h.kind === 'directory') {
                await moveDir(h, dest, n);
            } else if (typeof h.move === 'function') {
                await h.move(dest, n);
            } else {
                const w = await (await dest.getFileHandle(n, { create: true })).createWritable();
                await w.write(await h.getFile());
                await w.close();
            }
        }
        await parent.removeEntry(src.name, { recursive: true });
        return dest;
    }

    // A folder renamed from `from` to `to`: the data kept for each project
    // at or under it (folder-cache.js: a folder per project, named after
    // its path) is renamed for its new path, and says the new path
    async function moveStores(from, to) {
        const all = await window.JEditorNative.dataDir();
        const trim = (p) => String(p).replace(/\/+$/, '');
        from = trim(from);
        to = trim(to);
        const stores = [];
        for await (const [name, h] of all.entries()) if (h.kind === 'directory') stores.push([name, h]);
        for (const [name, h] of stores) {
            let order;
            try { order = JSON.parse(await (await (await h.getFileHandle('order.json')).getFile()).text()); } catch (e) { continue; }
            const p = trim(order.path || '');
            if (p.toLowerCase() !== from.toLowerCase() && !p.toLowerCase().startsWith(from.toLowerCase() + '/')) continue;
            const np = to + p.slice(from.length);
            const target = FolderCache.storeName(np);
            let dir = h;
            if (target !== name) {
                // Data left by an earlier project of that name is set aside
                const old = await all.getDirectoryHandle(target).catch(() => null);
                if (old) await moveDir(old, all, `${target}-old-${Date.now()}`);
                dir = await moveDir(h, all, target);
            }
            // Its path written once the data is where that path finds it
            await FolderCache.writeJson(dir, 'order.json', { ...order, path: np, name: np.split('/').pop() });
        }
    }
    window.JEditorNative = {
        // Which app this is, and what it can do besides storage and paths
        // (app/host.js says what each feature covers)
        platform: mac.platform,
        features: ['reveal', 'windows', 'places'].concat(mac.updates ? ['updates'] : []),
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
        // ---- The sidebar: drives, folders, projects ----
        // → { drives: [{ path, name, kind: usb|disk|network|cd, label, total, free }], home: [{ name, path }] }.
        // A 'jeditor-drives' event on window says a drive came or went.
        async places() {
            return answer('places');
        },
        // A folder's folders → { path, name, parent, folders: [{ name, path }], photos, more }
        async listDir(path) {
            return answer('listDir', { path });
        },
        // The projects (folders) in a folder, newest first → [{ name, path, modified (ms) }]
        async listProjects(path) {
            return (await answer('listProjects', { path })).projects;
        },
        // A new folder named `name` in `parent` (a new project) → its path
        async makeFolder(parent, name) {
            return (await answer('makeFolder', { parent, name })).path;
        },
        // A folder renamed → its new path. The data kept for it, and for the
        // projects inside it, follows (it's kept here, in the page's storage)
        async renameFolder(path, name) {
            const to = (await answer('renameFolder', { path, name })).path;
            await moveStores(path, to).catch(e => log('warn', 'Rename: the kept data didn\'t follow: ' + e.message));
            return to;
        },
        // Photos in each folder and its subfolders → { counts: [n, -1 if gone], limit }
        async countPhotos(paths) {
            return answer('countPhotos', { paths });
        },
        // Ejects a drive → { ok, error? }
        async eject(path) {
            return answer('eject', { path });
        },
        // The Mac's folder picker, just for a path → path, or null if canceled
        async pickPath(title, start) {
            const msg = await answer('pickPath', { title, start });
            return msg.cancelled ? null : msg.path;
        },
        // A whole folder (a path) copied into another, under a free name
        // there; progress(done, total) in bytes as it goes → { to } or
        // { cancelled }; throws if it couldn't (no room, say). The promise
        // has a copyId, for cancelCopy.
        copyFolder(path, dest, progress) {
            const id = nextCopy++;
            copying.set(id, progress || (() => { }));
            const done = answer('copyFolder', { path, dest, copy: id })
                .then(msg => (msg.cancelled ? { cancelled: true } : { to: msg.to }))
                .finally(() => copying.delete(id));
            done.copyId = id;
            return done;
        },
        cancelCopy(id) {
            mac.request('cancelCopy', { copy: id });
        },
        // ---- Windows: one project each ----
        // Another jEditor window, opening `path` (or the start screen)
        async newWindow(path) {
            return (await answer('newWindow', path ? { path } : {})).ok;
        },
        // This window on the left half of the screen, another on the right
        async split() {
            return (await answer('split')).ok;
        },
        // What this window shows, for the others' Move to:
        // { name, path, folders: ['', 'Ceremony', …] }
        setState(state) {
            return mac.request('state', state || {});
        },
        // The other windows' projects → [{ id, name, path, folders }]
        async windows() {
            return (await answer('windows')).windows;
        },
        // Photos (paths) moved or copied into a folder (a path), each under a
        // free name → [{ from, to } or { from, error }]. Every window hears
        // of it ('jeditor-files').
        async transfer(paths, dest, copy) {
            return (await answer('transfer', { paths, dest, copy: !!copy })).items;
        },
        // Undoes one: moved photos go back, copies go → [error or null]
        async undoTransfer(items, copy) {
            return (await answer('undoTransfer', { items, copy: !!copy })).errors;
        },
        // Where Files dropped from outside (Finder) are on disk → [path]
        async pathsOf(files) {
            return [...files].map(f => mac.pathForFile(f));
        },
        // → { current, tag, version, notes, size, newer }
        // beta: betas count too (Settings → Updates → Beta builds)
        async checkUpdate({ beta = false } = {}) {
            return answer('checkUpdate', { beta: !!beta });
        },
        // Downloads the newest .dmg, opens it in Finder and quits, so
        // jEditor can be dragged into Applications over this one.
        // progress(received, total) as it downloads.
        async installUpdate(progress) {
            // The end reported here too: IPC may bring the last progress after the answer
            let last = -1;
            onUpdateProgress = (got, total) => { last = got; if (progress) progress(got, total); };
            try {
                const r = await answer('installUpdate');
                if (progress && r && r.received > last) progress(r.received, r.total);
            } finally { onUpdateProgress = null; }
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

    // The traffic lights: in line with the top row of pills (their centre:
    // the gutter plus half a pill, which the UI scale zooms), and at the
    // gutter's distance from the left edge. A light is 14px.
    let lastLights = '';
    const reportLights = () => {
        const css = getComputedStyle(document.documentElement);
        const px = (name) => parseFloat(css.getPropertyValue(name)) || 0;
        const scale = parseFloat(css.getPropertyValue('--ui-scale')) || 1;
        const gutter = px('--gutter');
        const at = { x: Math.max(12, gutter), y: gutter + (px('--ctl-lg') * scale) / 2 - 7 };
        const key = at.x + ',' + at.y;
        if (key === lastLights) return;
        lastLights = key;
        mac.request('lights', at).then(r => { if (r) document.documentElement.classList.toggle('fullscreen', !!r.fullscreen); });
    };
    let lightsTimer = null;
    const lightsSoon = () => { clearTimeout(lightsTimer); lightsTimer = setTimeout(reportLights, 100); };

    // ---- macOS 26's toolbar: the page's top row, mirrored ----
    // Each item stands for one of the page's own controls: a click clicks
    // it, and the item shows what it does (hidden, off, on). So everything
    // they do, their keys and Settings → Toolbar stay the page's.
    const SYMBOLS = {
        info: 'info.circle', refresh: 'arrow.clockwise', crop: 'crop', history: 'clock.arrow.circlepath',
        fit: 'rectangle.inset.filled', strip: 'film', fullscreen: 'arrow.up.left.and.arrow.down.right',
        dupes: 'square.on.square', keys: 'keyboard', whatsnew: 'sparkles', customize: 'gearshape',
        scan: 'scanner', camera: 'camera'
    };
    const PRESSED = { info: 'info.circle.fill', strip: 'film.fill', fit: 'rectangle.inset.filled', fullscreen: 'arrow.down.right.and.arrow.up.left' };
    const $ = (id) => document.getElementById(id);
    const shown = (el) => !!el && !el.classList.contains('hidden') && !el.classList.contains('host-missing');
    const said = (t) => (typeof Host !== 'undefined' ? Host.say(t || '') : t || '');

    function toolbarModel() {
        const a = jeditor();
        const open = !!(a && a.dirHandle) && shown(a.elements.mainInterface);
        if (!open) return { visible: false, title: 'jEditor', subtitle: '', items: [] };
        const items = [];
        const bar = $('folder-bar');
        const browsing = shown(bar);
        if (browsing) {
            items.push({ id: 'rail', kind: 'button', symbol: 'sidebar.left', label: 'Folder list', tooltip: said($('fb-rail').title), navigational: true });
            items.push({ id: 'scope', kind: 'segment', segments: ['All photos', 'Folders'], selected: $('fb-all').classList.contains('active') ? 0 : 1, navigational: true });
        }
        items.push({ kind: 'flexible' });
        const chip = $('fb-filter-chip');
        if (browsing && shown(chip)) items.push({ id: 'filter', kind: 'button', symbol: 'line.3.horizontal.decrease.circle.fill', label: chip.textContent.trim(), tooltip: chip.title });
        const sort = $('sort-mode');
        items.push({
            id: 'sort', kind: 'menu', symbol: 'arrow.up.arrow.down', label: sort.selectedOptions[0] ? sort.selectedOptions[0].textContent : 'Sort', tooltip: 'Sort by',
            menu: [...sort.options].map(o => ({ id: o.value, label: o.textContent, checked: o.selected }))
        });
        const more = [{ id: 'rename', label: 'Rename…', symbol: 'pencil' }, { separator: true }];
        for (const b of $('header-controls').querySelectorAll('button[data-hc]')) {
            if (!shown(b)) continue;
            const key = b.dataset.hc;
            const on = b.getAttribute('aria-pressed') === 'true' || b.classList.contains('active');
            const symbol = key === 'view' ? (shown(b.querySelector('.icon-grid')) ? 'square.grid.2x2' : 'photo') : (on && PRESSED[key]) || SYMBOLS[key] || 'circle';
            const entry = { id: 'hc:' + key, label: b.getAttribute('aria-label') || b.title, symbol, enabled: !b.disabled };
            if (b.classList.contains('hc-extra')) more.push(entry);
            else items.push({ ...entry, kind: 'button', tooltip: said(b.title) });
        }
        items.push({ id: 'more', kind: 'menu', symbol: 'ellipsis.circle', label: 'More', menu: more });
        if (browsing) items.push({ id: 'search', kind: 'search', value: $('fb-search').value, placeholder: 'Search' });
        const crumbs = $('fb-crumbs');
        const where = browsing && crumbs ? crumbs.textContent.replace(/\s+/g, ' ').trim() : '';
        return {
            visible: true,
            title: $('file-name-text').textContent || a.dirHandle.name,
            subtitle: [a.dirHandle.name, where, $('file-count').textContent].filter(Boolean).join(' · '),
            items
        };
    }

    let lastToolbar = '';
    let toolbarTimer = null;
    const sendToolbar = () => {
        clearTimeout(toolbarTimer);
        toolbarTimer = setTimeout(() => {
            if (!jeditor()) return;
            const model = toolbarModel();
            const json = JSON.stringify(model);
            if (json === lastToolbar) return;
            lastToolbar = json;
            mac.request('toolbar', model);
        }, 30);
    };

    function onToolbar(id, value) {
        const click = (el) => el && el.click();
        if (id === 'rail') click($('fb-rail'));
        else if (id === 'scope') click(Number(value) === 0 ? $('fb-all') : $('fb-folders'));
        else if (id === 'filter') click($('fb-filter-chip'));
        else if (id === 'sort') {
            const s = $('sort-mode');
            s.value = value;
            s.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (id === 'search') {
            const input = $('fb-search');
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (id === 'more' && value === 'rename') click($('file-name'));
        else {
            const key = String(id === 'more' ? value : id).replace(/^hc:/, '');
            click($('header-controls').querySelector(`button[data-hc="${key}"]`));
        }
        sendToolbar();
    }

    if (mac.nativeToolbar) {
        document.documentElement.classList.add('native-toolbar');
        whenReady().then(() => {
            const watch = new MutationObserver(sendToolbar);
            for (const el of [document.querySelector('header'), $('folder-bar')]) {
                watch.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'disabled', 'title', 'aria-label'] });
            }
            watch.observe(jeditor().elements.mainInterface, { attributes: true, attributeFilter: ['class'] });
            $('sort-mode').addEventListener('change', sendToolbar);
            // ⌘F and /: the toolbar's search field, not the hidden one
            $('fb-search').addEventListener('focus', (e) => {
                e.target.blur();
                mac.request('toolbarSearch');
            });
            sendToolbar();
        });
    }

    whenReady().then(() => {
        reportTheme();
        if (!mac.nativeToolbar) reportLights();
        new MutationObserver(() => { reportTheme(); if (!mac.nativeToolbar) lightsSoon(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-density', 'style'] });
        if (!mac.nativeToolbar) addEventListener('resize', lightsSoon);
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
        } else if (msg.type === 'toolbar') {
            onToolbar(msg.id, msg.value);
        } else if (msg.type === 'fullscreen') {
            document.documentElement.classList.toggle('fullscreen', !!msg.on);
        } else if (msg.type === 'drivesChanged') {
            dispatchEvent(new Event('jeditor-drives')); // places.js
        } else if (msg.type === 'copyProgress') {
            if (copying.has(msg.copy)) copying.get(msg.copy)(msg.done, msg.total);
        } else if (msg.type === 'filesChanged') {
            dispatchEvent(new Event('jeditor-files')); // another window moved photos
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
