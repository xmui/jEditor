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
//   - tells the app when the theme changes, for the title bar's color,
//     and sets the window background (Mica or Acrylic)
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
        if (msg.error) throw Object.assign(new Error(msg.error), { code: msg.code || null });
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
        } else if (msg.type === 'tether' && onTether) {
            onTether(msg);
        } else if (msg.type === 'logLines' && onLogLines) {
            onLogLines(msg.lines || []);
        } else if (msg.type === 'copyProgress' && copying.has(msg.copy)) {
            copying.get(msg.copy)(msg.done, msg.total);
        } else if (msg.type === 'scanned' && onScanned) {
            onScanned(msg.name);
        } else if (msg.type === 'notice') {
            // Something the app has to say, once jEditor is up
            whenReady().then(() => UI.alert({ title: msg.title, message: msg.text }));
        } else if (msg.type === 'filesChanged') {
            dispatchEvent(new Event('jeditor-files')); // another window moved photos
        } else if (msg.type === 'drivesChanged') {
            dispatchEvent(new Event('jeditor-drives')); // places.js
        } else if (msg.type === 'backdropState') {
            // Transparency effects turned on or off in Windows
            dispatchEvent(new CustomEvent('jeditor-backdrop', { detail: msg.state }));
        }
    });

    // ---- The folder picker: Windows' own ----
    // Same contract as the browser's: a FileSystemDirectoryHandle, or an
    // AbortError when canceled
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
    let onLogLines = null;
    let onTether = null;
    const copying = new Map(); // folder copy request id → progress(done, total)
    window.JEditorNative = {
        // Which app this is, and what it can do besides storage and paths
        // (app/host.js says what each feature covers)
        platform: 'windows',
        features: ['recycle', 'reveal', 'places', 'quickAccess', 'windows', 'scan', 'camera', 'backdrop', 'log', 'updates'],
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
        // The projects (folders) in a folder, newest first →
        // [{ name, path, modified (ms) }]
        async listProjects(path) {
            return (await answer('listProjects', { path })).msg.projects;
        },
        // A new folder named `name` in `parent` (a new project) → its path
        async makeFolder(parent, name) {
            return (await answer('makeFolder', { parent, name })).msg.path;
        },
        // A folder renamed (a project: its stored data follows) → its new path
        async renameFolder(path, name) {
            return (await answer('renameFolder', { path, name })).msg.path;
        },
        // Photos in each folder and its subfolders → { counts: [n, -1 if gone], limit }
        // (counting stops at `limit`)
        async countPhotos(paths) {
            return (await answer('countPhotos', { paths })).msg;
        },
        // Explorer's pinned Quick Access folders → [{ name, path }]
        async quickAccess() {
            return (await answer('quickAccess')).msg.folders;
        },
        // Ejects a USB drive → { ok, error? }
        async eject(path) {
            return (await answer('eject', { path })).msg;
        },
        // Shows a folder in Explorer
        async reveal(path) {
            return (await answer('reveal', { path })).msg.ok;
        },
        // Windows' folder picker, just for a path → path, or null if canceled
        async pickPath(title, start) {
            const { msg } = await answer('pickPath', { title, start });
            return msg.cancelled ? null : msg.path;
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
                    e.code = msg.code || null;
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
        // Preview and crop. What a flatbed can do ({ device, driver, compat })
        // → { bedW, bedH (inches), dpis, gray, guessed }, or null if stopped
        // A TWAIN scanner's own settings window (act 'show'), forgetting what
        // was chosen there ('forget'), or whether anything is ('state')
        // → { saved, helper }
        async scannerSettings(device, act = 'state') {
            return (await answer('scannerSettings', { device, act })).msg;
        },
        async scanCaps(options) {
            const { msg } = await answer('scanCaps', options);
            return msg.cancelled ? null : msg;
        },
        // The whole bed, small ({ device, driver, compat, bedW, bedH, dpi })
        // → { image (data URL), width, height, bedW, bedH }, or null if
        // stopped. Then scan() with { crops: [{ x, y, w, h }] (fractions of
        // the bed), dpi, gray, bedW, bedH } saves a photo per box.
        async scanPreview(options) {
            const { msg } = await answer('scanPreview', options);
            return msg.cancelled ? null : msg;
        },
        // ---- Tethered shooting ----
        // Cameras plugged in (Sony, over USB) → [{ id, name, ready, note }]
        async cameras() {
            return (await answer('cameras')).msg.cameras;
        },
        // A camera's photos into a folder of the project (its path), named
        // prefix + next…: { camera, name, folder, prefix, next, digits,
        // keepOnCard, live }. event({ kind, … }) as things happen:
        // connected { name }, frame { image } (call tetherAck() once it's
        // shown, for the next), saved { name }, status { text, error }.
        // → { count, names } when it ends (tetherStop); throws if the camera
        // went away or failed (with the names saved before)
        async tether(options, event) {
            onTether = event || null;
            try {
                const { msg } = await request('tether', options);
                if (msg.error) {
                    const e = new Error(msg.error);
                    e.names = msg.names || [];
                    throw e;
                }
                return { count: msg.count || 0, names: msg.names || [] };
            } finally {
                onTether = null;
            }
        },
        tetherShoot() { post({ type: 'tetherShoot' }); },
        tetherLive(on) { post({ type: 'tetherLive', on: !!on }); },
        tetherAck() { post({ type: 'tetherAck' }); },
        tetherStop() { post({ type: 'tetherStop' }); },
        // { keepOnCard } and/or a new { folder, prefix, next, digits }
        tetherSet(o) { post({ type: 'tetherSet', ...o }); },
        // ---- Windows: one project each ----
        // Another jEditor window, opening `path` (or the start screen)
        async newWindow(path) {
            return (await answer('newWindow', path ? { path } : {})).msg.ok;
        },
        // This window on the left half of the screen, another on the right
        async split() {
            return (await answer('split')).msg.ok;
        },
        // What this window shows, for the others' Move to:
        // { name, path, folders: ['', 'Ceremony', …] }
        setState(state) {
            post({ type: 'state', ...state });
        },
        // The other windows' projects → [{ id, name, path, folders }]
        async windows() {
            return (await answer('windows')).msg.windows;
        },
        // Photos (paths) moved or copied into a folder (a path), each under a
        // free name → [{ from, to } or { from, error }]. Every window hears
        // of it ('jeditor-files').
        async transfer(paths, dest, copy) {
            return (await answer('transfer', { paths, dest, copy: !!copy })).msg.items;
        },
        // A whole folder (a path) copied into another, under a free name
        // there; progress(done, total) in bytes as it goes → { to } or
        // { cancelled }; throws if it couldn't (no room, say). The promise
        // has a copyId, for cancelCopy.
        copyFolder(path, dest, progress) {
            const id = nextId++;
            copying.set(id, progress || (() => { }));
            const done = new Promise((resolve) => {
                pending.set(id, resolve);
                post({ type: 'copyFolder', id, path, dest });
            }).then(({ msg }) => {
                copying.delete(id);
                if (msg.error) throw new Error(msg.error);
                return msg.cancelled ? { cancelled: true } : { to: msg.to };
            });
            done.copyId = id;
            return done;
        },
        cancelCopy(id) {
            post({ type: 'cancelCopy', copy: id });
        },
        // Where Files dropped from outside (Explorer) are on disk → [path]
        async pathsOf(files) {
            return (await request('pathsOf', {}, files)).msg.paths || [];
        },
        // Undoes one: moved photos go back, copies go → [error or null]
        async undoTransfer(items, copy) {
            return (await answer('undoTransfer', { items, copy: !!copy })).msg.errors;
        },
        // Windows 11's Mica or Acrylic behind the page, or none (kind:
        // 'mica' | 'acrylic' | 'none') → { supported (Windows 11 22H2 or
        // later), transparency (Windows' Transparency effects), applied }.
        // Applied, the page's background is clear: the page tints it. A
        // 'jeditor-backdrop' event on window brings a new state when
        // Transparency effects is turned on or off.
        async backdrop(kind) {
            return (await answer('backdrop', { kind })).msg;
        },
        // Shows jEditor's log in Explorer
        async showLog() {
            return (await answer('showLog')).msg.ok;
        },
        // The log's last lines → { lines, file }
        async logTail() {
            return (await answer('logTail')).msg;
        },
        // lines(array) with each new batch of log lines; null stops
        watchLog(lines) {
            onLogLines = lines || null;
            post({ type: 'logWatch', on: !!lines });
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

    // The theme and the page's background color, for the title bar and
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
        let lastScanned = null; // the scan step's last photo, moved by the windows step
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
                    lastScanned = r.names[r.names.length - 1];
                    const shown = () => r.names.filter(n => a.files.some(f => (f.relPath || f.name) === n)).length;
                    for (let i = 0; i < 75 && shown() < r.names.length; i++) await new Promise(res => setTimeout(res, 200));
                    await check('scanned', { names: r.names, shown: shown() });
                    // The feeder, jEditor's settings: both sides of three
                    // photos, the test scanner's sides swapped (as the
                    // FastFoto's are): each photo, then its back as -b
                    const fed = await Scan.run({ device: test.id, driver: test.driver, folder: '', source: 'feeder', sides: 'both', swap: true, dpi: 300, bedW: 8.5, bedH: 14, format: 'jpeg', quality: 90, brightness: 10, contrast: 0 });
                    await check('fed', { names: fed.names });
                    // Preview and crop: the test scanner's glass, a box round
                    // each print found, a photo per box
                    const caps = await window.JEditorNative.scanCaps({ device: test.id, driver: test.driver });
                    const p = await window.JEditorNative.scanPreview({ device: test.id, driver: test.driver, bedW: caps.bedW, bedH: caps.bedH, dpi: 75 });
                    const img = new Image();
                    img.src = p.image;
                    await img.decode();
                    const boxes = ScanPreview.find(img);
                    if (boxes.length !== 3) {
                        steps.cropped = `found ${boxes.length} prints on the test glass, not 3`;
                    } else {
                        const dpi = 150;
                        // The first box turned a quarter (its photo comes out tall)
                        boxes[0].turn = 90;
                        const c = await Scan.run({ device: test.id, driver: test.driver, folder: '', source: 'glass', crops: boxes, dpi, gray: false, bedW: p.bedW, bedH: p.bedH });
                        const sizes = boxes.map(b => (b.turn ? (s) => s.reverse() : (s) => s)([Math.round(b.w * p.bedW * dpi), Math.round(b.h * p.bedH * dpi)]));
                        await check('cropped', { names: c.names, sizes, preview: [p.width, p.height] });
                        const inApp = () => c.names.filter(n => a.files.some(f => (f.relPath || f.name) === n)).length;
                        for (let i = 0; i < 75 && inApp() < c.names.length; i++) await new Promise(res => setTimeout(res, 200));
                    }
                }
            }
            // Tethered shooting with the test camera: live view, a shot (RAW +
            // JPEG under one number), into the folder, then disconnect
            {
                const cams = await window.JEditorNative.cameras();
                const cam = cams.find(c => c.id === 'jeditor-test-camera');
                const here = await window.JEditorNative.folderPath(a.dirHandle);
                if (!cam || !here) {
                    steps.tethered = !cam ? 'no test camera' : 'no path for the folder';
                } else {
                    let frames = 0, connected = false;
                    const saved = [];
                    const session = window.JEditorNative.tether({ camera: cam.id, name: cam.name, folder: here, prefix: 'shot_', next: 1, digits: 3, keepOnCard: true, live: true }, (e) => {
                        if (e.kind === 'connected') connected = true;
                        if (e.kind === 'frame') { frames++; window.JEditorNative.tetherAck(); }
                        if (e.kind === 'saved') saved.push(e.name);
                    });
                    const until = async (ok) => { for (let i = 0; i < 75 && !ok(); i++) await new Promise(res => setTimeout(res, 200)); };
                    await until(() => connected && frames >= 3);
                    window.JEditorNative.tetherShoot();
                    await until(() => saved.length >= 2);
                    window.JEditorNative.tetherStop();
                    const r = await session;
                    await check('tethered', { names: r.names, saved, frames, connected });
                    Watch.request({ full: true });
                    await until(() => a.files.some(f => f.name === 'shot_001.jpg'));
                }
            }
            // Details: the log's last lines, then new ones as they're written
            {
                const tail = await window.JEditorNative.logTail();
                const heard = [];
                window.JEditorNative.watchLog(lines => heard.push(...lines));
                log('info', 'smoke: a line for Details');
                for (let i = 0; i < 25 && !heard.some(l => /a line for Details/.test(l)); i++) await new Promise(res => setTimeout(res, 200));
                window.JEditorNative.watchLog(null);
                steps.logged = !(tail.lines || []).length ? 'the log\'s last lines aren\'t there'
                    : !heard.some(l => /a line for Details/.test(l)) ? 'new log lines weren\'t sent' : true;
            }
            // Browse: the drives, and this folder's photos counted on disk
            {
                const places = await window.JEditorNative.places();
                steps.places = places.drives.length ? true : 'no drives listed';
                const here = await window.JEditorNative.folderPath(a.dirHandle);
                const l = here ? await window.JEditorNative.listDir(here) : null;
                const top = a.files.filter(f => !(f.relPath || '').includes('/')).length;
                steps.browsed = !l ? 'no path for the folder' : l.photos === top ? true : `Browse counts ${l.photos} photos, jEditor shows ${top}`;
                // The sidebar: this folder among its parent's projects, its
                // photos counted, Explorer's pins read
                if (here) {
                    const parent = here.replace(/\\[^\\]+$/, '');
                    const projects = await window.JEditorNative.listProjects(parent);
                    steps.projects = projects.some(p => p.path.toLowerCase() === here.toLowerCase()) ? true : 'not among its folder\'s projects';
                    const { counts } = await window.JEditorNative.countPhotos([here]);
                    steps.counted = counts[0] === a.files.length ? true : `counted ${counts[0]} photos, jEditor shows ${a.files.length}`;
                }
                steps.pins = Array.isArray(await window.JEditorNative.quickAccess()) || 'no answer';
                // New project and Rename: a folder made beside this one, with
                // stored data, renamed; the data must follow it
                if (here) {
                    try {
                        const parent = here.replace(/\\[^\\]+$/, '');
                        const made = await window.JEditorNative.makeFolder(parent, 'jEditor smoke ' + Date.now().toString(36));
                        const all = await window.JEditorNative.dataDir();
                        const store = await all.getDirectoryHandle(FolderCache.storeName(made), { create: true });
                        await FolderCache.writeJson(store, 'order.json', { path: made, name: made.split('\\').pop(), openedAt: Date.now() });
                        const renamed = await window.JEditorNative.renameFolder(made, made.split('\\').pop() + ' renamed');
                        const moved = await all.getDirectoryHandle(FolderCache.storeName(renamed)).then(() => true, () => false);
                        const left = await all.getDirectoryHandle(FolderCache.storeName(made)).then(() => true, () => false);
                        const there = (await window.JEditorNative.exists([renamed, made])).join();
                        steps.renamed = there !== 'true,false' ? `folders after renaming: ${there}` : !moved || left ? 'its stored data didn\'t follow it' : true;
                        await all.removeEntry(FolderCache.storeName(renamed), { recursive: true }).catch(() => { });
                        await window.JEditorNative.recycle([renamed]).catch(() => { });
                    } catch (e) {
                        steps.renamed = 'failed: ' + e.message;
                    }
                }
            }
            // Windows: a second one opens, the two split, and a photo moves
            // into a folder through the app and back (Ctrl+Z)
            {
                await window.JEditorNative.newWindow(null);
                await new Promise(r => setTimeout(r, 1500));
                await check('windows');
                await window.JEditorNative.split();
                const here = await window.JEditorNative.folderPath(a.dirHandle);
                const scan = lastScanned && a.files.find(f => (f.relPath || f.name) === lastScanned);
                if (here && scan) {
                    await a.dirHandle.getDirectoryHandle('Moved', { create: true });
                    const from = here + '\\' + scan.name;
                    const items = await window.JEditorNative.transfer([from], here + '\\Moved', false);
                    await check('moved', { name: 'Moved/' + scan.name });
                    const errors = await window.JEditorNative.undoTransfer(items.filter(i => i.to), false);
                    steps.unmoved = errors.every(e => !e) || String(errors);
                    await check('back', { name: scan.name });
                } else {
                    steps.moved = 'nothing to move';
                }
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
