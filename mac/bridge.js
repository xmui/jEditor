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
        if (typeof handle.photosLibrary === 'string') return LIBRARY + handle.photosLibrary;
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

    // ---- The Photos library (photos.js) ----
    // An album (or the whole library: id '') as a folder handle the page can
    // read like any other, with its photos as file handles: getFile() is the
    // photo as it is now (from iCloud if need be), getThumbnail(w) the
    // library's own thumbnail, peek() its size and date without reading it.
    // A photo can be written (createWritable): what's written is saved back
    // as a Photos edit on top of the photo as it is now, every edit before
    // kept by Photos (photos.mm: save). Nothing can be added, renamed or
    // removed: that's for Photos. Its path is "photos-library:<id>".
    const LIBRARY = 'photos-library:';
    const SHOWN = /\.(jpe?g|png|gif|webp)$/i; // served as they are; the rest come as JPEG (photos.mm)
    const denied = (what) => new DOMException(`${what}: the Photos library can't be changed`, 'NotAllowedError');
    const notFound = (name) => new DOMException(`${name} isn't in this album`, 'NotFoundError');
    const photoUrl = (kind, id) => `/__photos/${kind}/${encodeURIComponent(id)}`;
    async function fetched(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error((await r.text().catch(() => '')) || 'That photo couldn\'t be read');
        return r.blob();
    }
    // What a writable is given, as bytes
    async function bytesOf(d) {
        if (d instanceof Blob) return new Uint8Array(await d.arrayBuffer());
        if (typeof d === 'string') return new TextEncoder().encode(d);
        if (d instanceof ArrayBuffer) return new Uint8Array(d);
        if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
        throw new TypeError('Can\'t write that');
    }
    // A FileSystemWritableFileStream's calls (write, seek, truncate, close,
    // abort), kept in memory; close() hands the whole photo to save(bytes)
    function memoryWritable(start, save) {
        let buf = start, pos = 0, done = false;
        const grow = (n) => { if (n > buf.length) { const b = new Uint8Array(n); b.set(buf); buf = b; } };
        const open = () => { if (done) throw new DOMException('The writable is closed', 'InvalidStateError'); };
        return {
            async write(d) {
                open();
                if (d && typeof d === 'object' && !(d instanceof Blob) && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d) && 'type' in d) {
                    if (d.type === 'seek') { pos = d.position; return; }
                    if (d.type === 'truncate') { this.truncate(d.size); return; }
                    if (d.position != null) pos = d.position;
                    d = d.data;
                }
                const b = await bytesOf(d);
                grow(pos + b.length);
                buf.set(b, pos);
                pos += b.length;
            },
            async seek(p) { open(); pos = p; },
            async truncate(n) { open(); if (n < buf.length) buf = buf.slice(0, n); else grow(n); if (pos > n) pos = n; },
            async close() { open(); done = true; await save(buf); },
            async abort() { done = true; }
        };
    }
    function libraryFile(a, name) {
        const created = a.created || 0;
        const when = () => a.modified || created;
        return {
            kind: 'file',
            name,
            photosAsset: a.id,
            async getFile() {
                const blob = await fetched(photoUrl('full', a.id));
                return new File([blob], name, { type: blob.type, lastModified: when() });
            },
            getThumbnail: (w) => fetched(photoUrl('thumb', a.id) + '?w=' + Math.round(w || 320) + '&v=' + when()),
            peek: () => ({ size: a.fileSize || 0, lastModified: when(), width: a.w || 0, height: a.h || 0 }),
            async isSameEntry(o) { return !!o && o.photosAsset === a.id; },
            async queryPermission() { return 'granted'; },
            async requestPermission() { return 'granted'; },
            // Saved back as a Photos edit when it's closed (the photo as it is
            // now, then what jEditor wrote over it)
            async createWritable(o) {
                const start = o && o.keepExistingData ? new Uint8Array(await (await this.getFile()).arrayBuffer()) : new Uint8Array(0);
                return memoryWritable(start, async (bytes) => {
                    const r = await answer('photosSave', { id: a.id, bytes });
                    Object.assign(a, { modified: r.modified || Date.now(), fileSize: r.fileSize || bytes.length, w: r.w || a.w, h: r.h || a.h });
                });
            },
            async move() { throw denied(name); },
            async remove() { throw denied(name); }
        };
    }
    async function photosAlbum(id = '', name = 'Photos library') {
        id = String(id || '');
        let files = null;
        const list = async () => {
            if (files) return files;
            const { assets } = await answer('photosAssets', { id });
            // Two photos of the same name (two cameras' IMG_0001): the second is "IMG_0001 (2)"
            const used = new Map();
            files = assets.map(a => {
                let n = String(a.originalFilename || 'Photo.jpg');
                if (!SHOWN.test(n)) n = n.replace(/\.[^.]*$/, '') + '.jpg';
                const k = n.toLowerCase();
                const count = (used.get(k) || 0) + 1;
                used.set(k, count);
                if (count > 1) n = n.replace(/(\.[^.]*)?$/, ` (${count})$1`);
                return libraryFile(a, n);
            });
            return files;
        };
        return {
            kind: 'directory',
            name,
            photosLibrary: id,
            async *entries() { for (const f of await list()) yield [f.name, f]; },
            async *values() { for (const f of await list()) yield f; },
            async *keys() { for (const f of await list()) yield f.name; },
            [Symbol.asyncIterator]() { return this.entries(); },
            async getFileHandle(n, o) {
                if (o && o.create) throw denied(n);
                const f = (await list()).find(x => x.name === n);
                if (!f) throw notFound(n);
                return f;
            },
            async getDirectoryHandle(n, o) { throw o && o.create ? denied(n) : notFound(n); },
            async removeEntry(n) { throw denied(n); },
            async resolve() { return null; },
            async isSameEntry(o) { return !!o && o.photosLibrary === id; },
            // Its photos may be edited (not added to or removed: denied above)
            async queryPermission() { return 'granted'; },
            async requestPermission() { return 'granted'; }
        };
    }

    // ---- What the app does for jEditor ----
    let onUpdateProgress = null;
    let onClosing = null; // holdClose
    // Settings → Projects: photo apps' libraries opened as folders (places.js)
    const libraries = () => { const a = jeditor(); return !!(a && a.uiPrefs && a.uiPrefs.openLibraries); };
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
        features: ['reveal', 'windows', 'places', 'folderMove'].concat(mac.updates ? ['updates'] : [], mac.platform === 'mac' ? ['permissions'] : [], ['themes'], mac.platform === 'mac' && mac.photos ? ['photosLibrary', 'photosAdd'] : []),
        // jEditor's storage on this Mac: one folder per project (see
        // app/folder-cache.js), in the app's own private storage
        async dataDir() {
            const root = await navigator.storage.getDirectory();
            return root.getDirectoryHandle('jeditor-data', { create: true });
        },
        // Where a folder handle is on disk (null: not known); a Photos
        // library album's is "photos-library:<id>"
        folderPath,
        // ---- The Photos library (photosLibrary) ----
        // Whether jEditor may see it: 'granted', 'limited', 'denied',
        // 'restricted' or 'ask'; ask: true has macOS ask first
        async photosAccess(ask = false) {
            return (await answer('photosAccess', { ask: !!ask })).status;
        },
        // What's in it → [{ id, kind: favourites | recent | album, name, count }]
        async photosCollections() {
            return (await answer('photosLibrary')).collections;
        },
        // An album ('' : the whole library) as a folder handle (its photos editable)
        photosAlbum,
        // Photos on this Mac (paths) put into the library, in the album
        // called `album` (made if there's none) → { added, album: { id, name } }
        async photosAdd(paths, album = '') {
            return answer('photosAdd', { paths, album });
        },
        // A folder handle for a path, with permission to edit it
        async folderHandle(path) {
            const ok = (await answer('exists', { paths: [path] })).exists[0];
            if (!ok) throw new Error('That folder isn\'t there');
            return handleFor(path);
        },
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
            return answer('listDir', { path, libraries: libraries() });
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
            return answer('countPhotos', { paths, libraries: libraries() });
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
            let last = -1;
            copying.set(id, (got, total) => { last = got; if (progress) progress(got, total); });
            const done = answer('copyFolder', { path, dest, copy: id })
                .then(msg => {
                    if (msg.cancelled) return { cancelled: true };
                    // The end reported here too: IPC may bring the last progress after the answer
                    if (progress && typeof msg.done === 'number' && msg.done > last) progress(msg.done, msg.total);
                    return { to: msg.to };
                })
                .finally(() => copying.delete(id));
            done.copyId = id;
            return done;
        },
        // ---- Moving the projects folder (folderMove; app/folder-move.js) ----
        // What's in a folder: { folders, files, bytes }, and with dest the
        // room there: { free (-1: unknown), drive, sameDrive, refused }
        async folderSize(path, dest) {
            return answer('folderSize', { path, dest });
        },
        // Everything in path into dest, each item copied, checked and only
        // then removed; progress(done, total, moved) → { moved, left:
        // [{ name, why }], error, stopped }. Has a copyId, for cancelCopy.
        moveFolder(path, dest, progress) {
            const id = nextCopy++;
            copying.set(id, progress || (() => { }));
            const done = answer('moveFolder', { path, dest, copy: id })
                .then(msg => ({ moved: msg.moved || 0, left: msg.left || [], error: msg.error || null, stopped: !!msg.stopped }))
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
        // A theme's own title bar (on): the traffic lights hide, as its own
        // buttons work the window, and macOS 26's toolbar comes off; on
        // Linux the window opens again without its frame (main.js: reframe).
        // A 'jeditor-window' event on window says when it's zoomed or not.
        titleBar(on) {
            themed = !!on;
            if (mac.nativeToolbar) {
                document.documentElement.classList.toggle('native-toolbar', !themed);
                lastToolbar = '';
            }
            // (with the project, for a Linux window opening again on it)
            const want = themed, a = jeditor();
            Promise.resolve(a && a.dirHandle ? folderPath(a.dirHandle) : null).catch(() => null)
                .then(path => mac.request('titleBar', { on: want, path }))
                .then(() => {
                    if (want) return;
                    if (mac.nativeToolbar) sendToolbar(); else { lastLights = ''; reportLights(); }
                });
        },
        // The window's buttons for that title bar: 'minimize', 'maximize'
        // (zoom, or back) and 'close'. Its top edge resizes as any Mac
        // window's does, so 'resizeTop' needs nothing.
        windowAction(action) {
            if (action !== 'resizeTop') mac.request('windowAction', { action });
        },
        // A theme's menus for the Mac's menu bar: [{ label, items: [{ id,
        // label, key, enabled } or '—'] }], or null for the app's own. A
        // command chosen comes back as a 'menu' message, 'theme:' + its id
        ...(mac.platform === 'mac' ? {
            setMenus(menus) {
                mac.request('menus', { menus: menus || null });
            }
        } : {}),
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
        // The Mac's privacy settings (app/permissions.js): each row's state,
        // and whether this is the first time (the window opens on its own)
        permissions: () => answer('permissions'),
        askPermission: (id) => answer('askPermission', { id }),
        openPermissionSettings: (id) => answer('openPermissionSettings', { id }),
        permissionsSeen: () => answer('permissionsSeen'),
        // Closing the window asks ask() first, and closes if it resolves
        // true ("Keep your changes?" in Adjust and Paint); null lets go
        holdClose(ask) {
            onClosing = ask || null;
            mac.request('holdClose', { on: !!ask });
        },
        async installUpdate(progress) {
            // The end reported here too: IPC may bring the last progress after the answer
            let last = -1;
            onUpdateProgress = (got, total) => { last = got; if (progress) progress(got, total); };
            try {
                const r = await answer('installUpdate');
                if (progress && r && r.received > last) progress(r.received, r.total);
                return r;
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
    // gutter's distance from the left edge; over Adjust and Paint, in line
    // with the mode chip in their head; on the home page, with jEditor in its
    // top bar, which leaves room for them. A light is 14px.
    let lastLights = '';
    let themed = false; // a theme draws the title bar (titleBar above)
    const reportLights = () => {
        const css = getComputedStyle(document.documentElement);
        const px = (name) => parseFloat(css.getPropertyValue(name)) || 0;
        const scale = parseFloat(css.getPropertyValue('--ui-scale')) || 1;
        const gutter = px('--gutter');
        const chip = document.querySelector('.mode-float.over-mode:not(.hidden)');
        const home = document.querySelector('.drop-zone:not(.hidden) .home-brand');
        const r = chip ? chip.getBoundingClientRect() : home ? home.getBoundingClientRect() : null;
        const middle = r && r.height ? r.top + r.height / 2 : px('--mac-drag') + gutter + (px('--ctl-lg') * scale) / 2;
        const at = { x: Math.max(12, gutter), y: middle - 7 };
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
        info: 'info.circle', refresh: 'arrow.clockwise', crop: 'crop', adjust: 'slider.horizontal.3', history: 'clock.arrow.circlepath',
        fit: 'rectangle.inset.filled', strip: 'film', fullscreen: 'arrow.up.left.and.arrow.down.right',
        dupes: 'square.on.square', keys: 'keyboard', whatsnew: 'sparkles', customize: 'gearshape',
        scan: 'scanner', camera: 'camera'
    };
    const MODE_SYMBOLS = { photos: 'square.grid.2x2', adjust: 'slider.horizontal.3', paint: 'paintbrush' };
    const PRESSED = { info: 'info.circle.fill', strip: 'film.fill', fit: 'rectangle.inset.filled', fullscreen: 'arrow.down.right.and.arrow.up.left' };
    const $ = (id) => document.getElementById(id);
    const shown = (el) => !!el && !el.classList.contains('hidden') && !el.classList.contains('host-missing') && !el.classList.contains('exp-off');
    const said = (t) => (typeof Host !== 'undefined' ? Host.say(t || '') : t || '');

    function toolbarModel() {
        const a = jeditor();
        const open = !!(a && a.dirHandle) && shown(a.elements.mainInterface);
        if (!open) return { visible: false, title: 'jEditor', subtitle: '', items: [] };
        const modeItem = () => {
            const mode = Modes.current();
            const label = (m) => (Modes.LIST.find(x => x[0] === m) || [])[1] || m;
            return {
                id: 'mode', kind: 'menu', symbol: MODE_SYMBOLS[mode], label: label(mode), tooltip: ($('mode-chip-float') || {}).title || label(mode), navigational: true,
                menu: Modes.shown().map(([m, l]) => ({ id: m, label: l, symbol: MODE_SYMBOLS[m], checked: m === mode }))
            };
        };
        // Over Adjust and Paint the toolbar keeps just the mode, the same
        // button as in Photos, and their head starts below it (style.css).
        // (Stepped aside, the toolbar's title bar still took the press on
        // the page's own chip there: hard to press, Needs fixing 2026-11-05)
        if (typeof Modes !== 'undefined' && Modes.current() !== 'photos') return { visible: true, title: $('file-name-text').textContent || a.dirHandle.name, subtitle: '', items: [modeItem(), { kind: 'flexible' }] };
        const items = [];
        const bar = $('folder-bar');
        const browsing = shown(bar);
        if (browsing) items.push({ id: 'rail', kind: 'button', symbol: 'sidebar.left', label: 'Folder list', tooltip: said($('fb-rail').title), navigational: true });
        // The mode chip, as in the folder pill (or on its own in the single
        // view): not while the sidebar shows its own switch
        const modeChip = [$('mode-chip-bar'), $('mode-float')].find(shown);
        if (modeChip && typeof Modes !== 'undefined') items.push(modeItem());
        if (browsing) items.push({ id: 'scope', kind: 'segment', segments: ['All photos', 'Folders'], selected: $('fb-all').classList.contains('active') ? 0 : 1, navigational: true });
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
    // At most every 30ms, never later: put off at each change, it waited
    // as long as the page kept changing (Adjust opening, on a slow Mac)
    const sendToolbar = () => {
        if (toolbarTimer) return;
        toolbarTimer = setTimeout(() => {
            toolbarTimer = null;
            if (!jeditor() || themed) return;
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
        else if (id === 'mode') Modes.go(String(value));
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
            for (const el of [document.querySelector('header'), $('folder-bar'), $('mode-float')].filter(Boolean)) {
                watch.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'disabled', 'title', 'aria-label'] });
            }
            watch.observe(jeditor().elements.mainInterface, { attributes: true, attributeFilter: ['class'] });
            // Adjust and Paint opened or closed: the toolbar steps aside or
            // comes back then, not when something else on the page changes
            for (const el of [$('adjust-editor'), $('paint-editor')].filter(Boolean)) watch.observe(el, { attributes: true, attributeFilter: ['class'] });
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
        // Into Adjust or Paint and out: the lights follow the mode chip
        if (!mac.nativeToolbar && $('mode-float')) new MutationObserver(reportLights).observe($('mode-float'), { attributes: true, attributeFilter: ['class'] });
        // The home page shown or left: the lights go to its top bar, and back
        if (!mac.nativeToolbar && $('drop-zone')) new MutationObserver(lightsSoon).observe($('drop-zone'), { attributes: true, attributeFilter: ['class'] });
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
        } else if (msg.type === 'windowState') {
            // Zoomed or not, for a theme's own title bar (themes.js)
            dispatchEvent(new CustomEvent('jeditor-window', { detail: { maximized: !!msg.maximized } }));
        } else if (msg.type === 'drivesChanged') {
            dispatchEvent(new Event('jeditor-drives')); // places.js
        } else if (msg.type === 'copyProgress') {
            if (copying.has(msg.copy)) copying.get(msg.copy)(msg.done, msg.total, msg.moved);
        } else if (msg.type === 'filesChanged') {
            dispatchEvent(new Event('jeditor-files')); // another window moved photos
        } else if (msg.type === 'closing') {
            // Heard at once (main.js), then closed if the page says so
            mac.request('closeHeard');
            let ok = true;
            try { if (onClosing) ok = await onClosing(); } catch (e) { log('error', 'Closing: ' + (e && e.message || e)); }
            mac.request('closeWindow', { ok: !!ok });
        } else if (msg.type === 'updateProgress') {
            if (onUpdateProgress) onUpdateProgress(msg.received, msg.total);
        } else if (msg.type === 'menu') {
            const a = await whenReady();
            if (msg.action === 'open') a.browseFolder();
            else if (msg.action === 'settings') a.toggleCustomizePanel(true);
            else if (msg.action === 'reload') Modes.reload();
            else if (msg.action === 'permissions') Permissions.open();
            else if (String(msg.action).startsWith('theme:')) Themes.runMenu(msg.action.slice(6));
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
