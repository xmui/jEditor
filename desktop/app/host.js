// jEditor on Tauri: the page's side of the app (desktop/app/src/main.rs).
//
// It gives bridge.js (mac/bridge.js) the same window.jeditorMac that
// Electron's preload.js does, so the bridge, the handles (mac/handles.js)
// and the page are the same files in both apps. Only the way they talk to
// the app differs:
//   - requests are POSTs to /__host/request on the app's own scheme, with
//     a file's bytes sent as they are (/__host/write), not in JSON;
//   - the app's messages come in through window.__jeHost.message(msg).
// window.__jeFlags (written in front of this file by the app) says which
// app this is and what it can do.

(() => {
    if (window.top !== window || window.jeditorMac) return;
    const flags = window.__jeFlags || {};
    const listeners = [];
    const early = []; // messages that came before the bridge listened

    async function post(url, body) {
        const r = await fetch(url, { method: 'POST', body, cache: 'no-store' });
        const text = await r.text();
        try { return JSON.parse(text); } catch (e) { return { error: text || `The app said ${r.status}` }; }
    }

    function request(type, data) {
        data = data || {};
        // A file's bytes (a handle's write): straight to the file
        if (type === 'fs' && data.op === 'write' && data.data && data.data.data instanceof Uint8Array) {
            const d = data.data;
            const q = 'id=' + encodeURIComponent(d.id) + (d.at === null || d.at === undefined ? '' : '&at=' + d.at);
            return post('/__host/write?' + q, d.data);
        }
        return post('/__host/request?type=' + encodeURIComponent(type), JSON.stringify(data));
    }

    // Where Files dropped from Finder are: WebKit doesn't say, so the app
    // reads them off the drag (the Mac's drag pasteboard) as it comes in,
    // and they're matched by name at the drop
    let dropped = new Map(); // name → path
    addEventListener('dragenter', (e) => {
        const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
        if (!types.includes('Files')) return;
        request('dragPaths').then((r) => {
            const m = new Map();
            for (const p of (r && r.paths) || []) m.set(p.replace(/\/+$/, '').split('/').pop(), p);
            dropped = m;
        }).catch(() => { });
    }, true);

    window.__jeHost = {
        message(msg) {
            if (!listeners.length) early.push(msg);
            else for (const l of listeners) l(msg);
        }
    };

    window.jeditorMac = {
        request,
        onMessage(listener) {
            listeners.push(listener);
            while (early.length) listener(early.shift());
        },
        pathForFile: (file) => (file && dropped.get(file.name)) || null,
        nativeToolbar: !!flags.nativeToolbar,
        platform: flags.platform === 'linux' ? 'linux' : 'mac',
        updates: !!flags.updates,
        photos: !!flags.photos,
        // Always the app's own handles: WebKit has none for folders on disk
        hostHandles: true,
        // jEditor's storage: a real folder, through the same handles (not OPFS)
        dataPath: flags.dataPath || null,
        tauri: true
    };
})();
