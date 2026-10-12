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
    // `objects`: Files to send along (the app reads their paths on disk)
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
            openFolder(objects[0], msg);
        } else if (msg.type === 'reloadCss') {
            reloadCss();
        } else if (msg.type === 'updateProgress' && onUpdateProgress) {
            onUpdateProgress(msg.received, msg.total);
        }
    });

    // ---- The folder picker: Windows' own ----
    // Same contract as the browser's: a FileSystemDirectoryHandle, or an
    // AbortError when cancelled
    window.showDirectoryPicker = async function showDirectoryPicker() {
        const { msg, objects } = await request('pickFolder');
        if (msg.cancelled || !objects[0]) throw new DOMException('The user aborted a request.', 'AbortError');
        return objects[0];
    };

    // ---- What the app does for jEditor ----
    let onUpdateProgress = null;
    window.JEditorNative = {
        // jEditor's storage on this PC: a folder handle, one subfolder per
        // order (see app/folder-cache.js)
        async dataDir() {
            const { objects } = await answer('dataDir');
            if (!objects[0]) throw new Error('No storage');
            return objects[0];
        },
        // Where a File (from a file handle) is on disk
        async pathOf(file) {
            return (await answer('pathOf', {}, [file])).msg.path || null;
        },
        // Files to the Recycle Bin. Per file: { token } (Ctrl+Z: restore),
        // { noBin } (its drive has no Recycle Bin: keep it some other way),
        // or { error }
        async recycle(files) {
            return (await answer('recycle', {}, files)).msg.results;
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
            try {
                const u = await window.JEditorNative.checkUpdate();
                steps.update = `latest ${u.tag}, this is ${u.current}${u.newer ? ' (newer available)' : ''}`;
            } catch (e) {
                steps.update = 'not checked: ' + e.message; // network; not a failure
            }
        } catch (e) {
            steps.error = String(e && e.message || e);
        }
        post({ type: 'smoke', ok: true, count: a.files.length, rotated, file: file ? file.name : null, steps, errors });
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
