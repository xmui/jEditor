// jEditor for Windows: the bridge between the jEditor UI and this app.
//
// The app runs this before the page's own scripts, on every page load.
// jEditor itself doesn't know about it. The bridge:
//   - replaces the browser's folder picker with Windows' own, handing the
//     page a real folder handle with permission to edit already granted,
//     so jEditor's file code runs unchanged and never asks for permission
//   - opens a folder the app was started with (jEditor.exe "D:\Orders\Smith")
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
    const request = (type, data = {}) => new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        post({ type, id, ...data });
    });

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

    // Opened the folder; now save an edit, so the app can check the file
    // changed on disk: proof that the handle can write
    async function smokeTest(a) {
        const file = a.files[0];
        const rotated = file ? await a.rotateImage(file, 90) !== false : false;
        post({ type: 'smoke', ok: true, count: a.files.length, rotated, file: file ? file.name : null, errors });
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
