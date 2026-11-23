// Settings → Projects → Troubleshooting: two ways to put jEditor right
// when it misbehaves, both ending in a restart (the app) or a reload (the
// web):
//
//   Clear cache and restart   what jEditor makes again by itself: every
//                             project's thumbnails, the home page's
//                             pictures, the saved previews, the offline
//                             copy of the app (the service worker and its
//                             cache), and the app's own browser caches.
//                             Projects, recents, pins and settings stay.
//   Reset jEditor…            all that, and everything jEditor remembers:
//                             settings, keys, saved looks and presets,
//                             recents (and their copy on disk, recent.json),
//                             pins, the projects folder, and the app's own
//                             files (its window place: appReset). As after
//                             a fresh install. Asks first, saying what goes.
//
// Neither touches the photos, or anything in the folders they're in. Each
// project's flags, edits, Auto crop originals and deleted photos aren't a
// cache: they stay, so a project opened again has them (folder-cache.js;
// on the Mac and Linux they're in the page's own storage, jeditor-data,
// which is why nothing here wipes all of it).
//
// The app does its part (JEditorNative.resetApp, the `appReset` feature):
// its browser caches, and for a reset its own files, then restarts. Without
// it (the web, or it fails) the page reloads itself.

const AppReset = {
    // Kept by the page, and what Clear cache takes of it
    THUMBS_DB: 'jeditor',            // thumbnails and previews (script.js idb)
    RECENTS_DB: 'jeditor-recents',   // the home page's recents (recents.js)
    // What a page left lying about that a fresh start shouldn't see
    STALE_KEYS: ['jeditor.settingsPage'],

    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        const on = (id, fn) => { const b = this.el(id); if (b) b.addEventListener('click', (e) => { e.currentTarget.blur(); fn(); }); };
        on('set-reset-cache', () => this.clearCache());
        on('set-reset-all', () => this.resetAll());
    },

    // ---- Clear cache and restart ----

    async clearCache() {
        if (this.busy) return;
        this.busy = true;
        try {
            await this.flushEdits();
            await this.dropCaches();
            await this.restart({ full: false });
        } finally {
            this.busy = false;
        }
    },

    // ---- Reset jEditor… ----

    async resetAll() {
        if (this.busy) return;
        const ok = await UI.confirm({
            title: 'Reset jEditor?',
            message: 'jEditor goes back to how it was when it was first installed, and restarts. This goes:',
            items: [
                'Your settings, keyboard shortcuts and toolbar',
                'Your saved looks, presets, brushes and colors',
                'Recent projects, pinned folders and the projects folder chosen',
                'Thumbnails and every other cache'
            ],
            note: 'Your photos and their folders aren\'t touched, and nor are your projects\' flags, edits and deleted photos: open a project again and they\'re there.',
            ok: 'Reset jEditor',
            danger: true
        });
        if (!ok) return;
        this.busy = true;
        try {
            await this.flushEdits();
            await this.dropCaches();
            await this.dropRemembered();
            await this.restart({ full: true });
        } finally {
            this.busy = false;
        }
    },

    // ---- The parts ----

    // What's waiting to be written (an edit, flags) goes first: they're kept
    async flushEdits() {
        try { if (typeof FolderCache !== 'undefined') await FolderCache.flush(); } catch (e) { /* best effort */ }
        try { if (typeof Edits !== 'undefined' && Edits.flush) await Edits.flush(); } catch (e) { /* best effort */ }
    },

    async dropCaches() {
        try { if (typeof FolderMove !== 'undefined') await FolderMove.clearCacheNow(); } catch (e) { console.warn('Reset: project caches:', e); }
        // The thumbnails and previews database (closed first, or it waits)
        try {
            const db = this.app && this.app._idbPromise ? await this.app._idbPromise : null;
            if (db) db.close();
            if (this.app) this.app._idbPromise = undefined;
        } catch (e) { /* not open */ }
        await this.deleteDb(this.THUMBS_DB);
        // The offline copy of the app: made again from the server
        try {
            if (typeof caches !== 'undefined') {
                for (const k of await caches.keys()) if (k.startsWith('jeditor')) await caches.delete(k);
            }
        } catch (e) { /* none */ }
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
            }
        } catch (e) { /* none */ }
        for (const k of this.STALE_KEYS) this.forget(k);
        try { sessionStorage.clear(); } catch (e) { /* none */ }
    },

    // Everything jEditor remembers in the page: its keys, the recents
    async dropRemembered() {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('jeditor')) keys.push(k);
            }
            keys.forEach(k => this.forget(k));
        } catch (e) { /* private */ }
        try {
            const db = typeof Recents !== 'undefined' && Recents._db ? await Recents._db : null;
            if (db) db.close();
            if (typeof Recents !== 'undefined') Recents._db = undefined;
        } catch (e) { /* not open */ }
        await this.deleteDb(this.RECENTS_DB);
        // ...and the copy the apps keep on disk (recents.js: recent.json in
        // jEditor's storage, which a reset keeps): Recents.clearDisk (#344)
        // where it's there; until then left empty, not removed, since without
        // it Recent is made again from the projects' order.json files
        try {
            const native = typeof FolderCache !== 'undefined' && FolderCache.native();
            if (typeof Recents !== 'undefined' && Recents.clearDisk) await Recents.clearDisk();
            else if (native && typeof native.dataDir === 'function' && typeof Recents !== 'undefined') {
                const dir = await native.dataDir();
                const w = await (await dir.getFileHandle(Recents.FILE, { create: true })).createWritable();
                await w.write(JSON.stringify({ version: 1, folders: [] }));
                await w.close();
            }
        } catch (e) { console.warn('Reset: Recent on disk:', e); }
    },

    forget(key) {
        try { localStorage.removeItem(key); } catch (e) { /* private */ }
    },

    // An IndexedDB database gone (true), or not there; never waits forever
    deleteDb(name) {
        return new Promise((resolve) => {
            if (typeof indexedDB === 'undefined') { resolve(false); return; }
            const done = (ok) => { clearTimeout(t); resolve(ok); };
            const t = setTimeout(() => resolve(false), 3000);
            try {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = () => done(true);
                req.onerror = () => done(false);
                req.onblocked = () => { /* waits for the others to close: the timeout covers it */ };
            } catch (e) {
                done(false);
            }
        });
    },

    // The app clears its own part and starts again; the web reloads
    async restart({ full }) {
        const native = Host.get();
        if (Host.has('appReset') && native && native.resetApp) {
            try {
                if (await native.resetApp({ full: !!full })) return;
            } catch (e) {
                console.warn('Reset: the app couldn\'t restart itself:', e);
            }
        }
        this.reload();
    },

    // (its own function, for the tests)
    reload() {
        location.reload();
    }
};
