// Recent folders on the home page, as stacks of prints on a table (start.js).
//
// A folder handle can be kept in IndexedDB and used again later, so a
// recent folder reopens without the folder picker. Chrome may ask once
// more for permission to edit it ("Allow jEditor to edit files in…?")
// after a restart. Kept with each: the handle, the name, when it was
// opened, how many photos it had, and four small pictures (the grid's
// own thumbnails, made smaller) for its stack.
//
// A photo opened on its own in Adjust or Paint is kept too, as one print
// called Recent: only the last one, and shown only while it's the last
// thing opened.

const Recents = {
    MAX: 6,
    SHOWN: 4,       // on the table
    THUMBS: 4,      // pictures kept for a stack
    THUMB: 240,     // their size, at most, in pixels
    DB: 'jeditor-recents',

    el(id) { return document.getElementById(id); },

    // Folders can only be reopened where they can be picked
    supported() {
        return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
    },

    db() {
        if (this._db !== undefined) return this._db;
        this._db = new Promise((resolve) => {
            try {
                const req = indexedDB.open(this.DB, 1);
                req.onupgradeneeded = () => req.result.createObjectStore('folders', { keyPath: 'id' });
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
                req.onblocked = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
        return this._db;
    },

    async tx(mode, fn) {
        const db = await this.db();
        if (!db) return null;
        return new Promise((resolve) => {
            try {
                const t = db.transaction('folders', mode);
                const result = fn(t.objectStore('folders'));
                t.oncomplete = () => resolve(result && 'result' in result ? result.result : true);
                t.onerror = t.onabort = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    },

    // Folders and the photo, newest first
    async all() {
        const all = await this.tx('readonly', s => s.getAll());
        return (all || []).sort((a, b) => b.openedAt - a.openedAt);
    },

    // Folders, newest first
    async list() {
        return (await this.all()).filter(r => r.kind !== 'photo');
    },

    // What lies on the table: the last folders, with the photo first if
    // it was the last thing opened
    async table() {
        const all = await this.all();
        const folders = all.filter(r => r.kind !== 'photo');
        const first = all[0] && all[0].kind === 'photo' ? [all[0]] : [];
        return first.concat(folders).slice(0, this.SHOWN);
    },

    // A folder was opened: it goes to the top (once, however it was opened).
    // One at a time, so folders opened in quick succession keep their order.
    remember(handle) {
        this.saving = (this.saving || Promise.resolve()).then(() => this.save(handle)).catch(() => { });
        this.saving.then(() => this.keepThumbs(handle));
        return this.saving;
    },

    // A photo opened on its own (in Adjust or Paint): the one Recent print
    rememberPhoto(handle, mode) {
        this.saving = (this.saving || Promise.resolve()).then(() => this.savePhoto(handle, mode)).catch(() => { });
        this.saving.then(() => this.keepThumbs(null));
        return this.saving;
    },

    async savePhoto(handle, mode) {
        if (!this.supported() || !handle || handle.kind !== 'file') return;
        const all = await this.all();
        const openedAt = Math.max(Date.now(), all.length ? all[0].openedAt + 1 : 0);
        const rec = { id: `photo-${openedAt}`, kind: 'photo', name: handle.name, handle, mode: mode || null, openedAt };
        await this.tx('readwrite', s => {
            all.filter(r => r.kind === 'photo').forEach(r => s.delete(r.id));
            s.put(rec);
        });
        this._last = rec.id;
        await this.render();
    },

    // The stack's pictures: the grid's thumbnails of the first photos,
    // once they're made, made smaller. In the background, after the
    // folder has opened, so opening never waits for it.
    async keepThumbs(handle) {
        const app = this.app;
        if (!app || !this.supported()) return;
        const opened = app.dirHandle;
        const files = () => (app.viewFiles ? app.viewFiles() : app.files || []).slice(0, this.THUMBS);
        const still = () => app.dirHandle === opened && (!handle || opened === handle);
        if (handle && opened !== handle) return;
        // The grid makes them in the background (precacheThumbnails)
        for (let i = 0; i < 40 && still() && !files().every(f => f.thumbnailUrl); i++) await new Promise(r => setTimeout(r, 250));
        if (!still()) return;
        const thumbs = [];
        for (const f of files()) {
            if (!f.thumbnailUrl) continue;
            const small = await this.shrink(f.thumbnailUrl).catch(() => null);
            if (small) thumbs.push(small);
        }
        if (!thumbs.length) return;
        const count = (app.files || []).length;
        const rec = (await this.all()).find(r => handle ? r.kind !== 'photo' && r.handle === handle : r.kind === 'photo');
        let target = rec;
        if (!target && handle) {
            // (the same folder, opened by another handle)
            for (const r of await this.list()) {
                try { if (await r.handle.isSameEntry(handle)) { target = r; break; } } catch (e) { /* different */ }
            }
        }
        if (!target) return;
        await this.tx('readwrite', s => s.put({ ...target, thumbs, count }));
        await this.render();
    },

    // A thumbnail's URL → a small JPEG
    async shrink(url) {
        const blob = await (await fetch(url)).blob();
        const bmp = await createImageBitmap(blob);
        try {
            const k = Math.min(1, this.THUMB / Math.max(bmp.width, bmp.height));
            const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.getContext('2d').drawImage(bmp, 0, 0, w, h);
            return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
        } finally {
            bmp.close();
        }
    },

    async save(handle) {
        if (!this.supported() || !handle || handle.kind !== 'directory') return;
        const list = await this.list();
        let same = null;
        for (const rec of list) {
            try {
                if (rec.handle && await rec.handle.isSameEntry(handle)) { same = rec; break; }
            } catch (e) { /* not comparable: different folder */ }
        }
        const openedAt = Math.max(Date.now(), list.length ? list[0].openedAt + 1 : 0);
        const rec = { ...(same || {}), id: same ? same.id : `${openedAt}-${Math.random().toString(36).slice(2, 8)}`, name: handle.name, handle, openedAt };
        const stale = list.filter(r => r !== same).slice(this.MAX - 1);
        await this.tx('readwrite', s => {
            s.put(rec);
            stale.forEach(r => s.delete(r.id));
        });
        await this.render();
    },

    // The same folder under a new name (renamed in the sidebar: places.js),
    // where it was in the list
    async replace(id, handle) {
        const rec = (await this.all()).find(r => r.id === id);
        if (!rec || !handle) return;
        await this.tx('readwrite', s => s.put({ ...rec, handle, name: handle.name }));
        await this.render();
    },

    async forget(id) {
        await this.tx('readwrite', s => s.delete(id));
        this.render();
    },

    // Clear cache (folder-move.js): the stacks' pictures go, so they lie
    // on the table as ghost stacks until they're made again
    async clearThumbs() {
        const all = await this.all();
        await this.tx('readwrite', s => all.forEach(r => { if (r.thumbs && r.thumbs.length) s.put({ ...r, thumbs: [] }); }));
        await this.render();
    },

    // "Today", "Yesterday", "Monday", "Oct 3", "Oct 3, 2025"
    when(ts) {
        const d = new Date(ts), now = new Date();
        const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const days = Math.round((day(now) - day(d)) / 86400000);
        if (days <= 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
        const opts = { month: 'short', day: 'numeric' };
        if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
        return d.toLocaleDateString(undefined, opts);
    },

    async render() {
        const box = this.el('recents');
        if (!box) return;
        const list = this.supported() ? await this.table() : [];
        const ul = this.el('recent-list');
        for (const url of this._urls || []) URL.revokeObjectURL(url);
        this._urls = [];
        ul.innerHTML = '';
        list.forEach(rec => {
            const photo = rec.kind === 'photo';
            const li = document.createElement('li');
            li.className = photo ? 'single' : 'stack';
            const open = document.createElement('button');
            open.className = 'recent-open';
            open.title = `Open ${rec.name}`;
            // The prints: the top one last (drawn over the others)
            const pile = document.createElement('span');
            pile.className = 'recent-pile';
            pile.setAttribute('aria-hidden', 'true');
            const thumbs = (rec.thumbs || []).slice(0, photo ? 1 : this.THUMBS);
            if (thumbs.length) {
                for (let i = thumbs.length - 1; i >= 0; i--) {
                    const print = document.createElement('span');
                    print.className = 'recent-print';
                    const img = document.createElement('img');
                    const url = URL.createObjectURL(thumbs[i]);
                    this._urls.push(url);
                    img.src = url;
                    img.alt = '';
                    img.decoding = 'async';
                    print.appendChild(img);
                    pile.appendChild(print);
                }
            } else {
                // No pictures kept (not made yet, or the cache was cleared):
                // ghost prints, a stack like any other; the name is under it
                li.classList.add('ghosted');
                for (let i = 0; i < (photo ? 1 : 3); i++) {
                    const print = document.createElement('span');
                    print.className = 'recent-print ghost';
                    pile.appendChild(print);
                }
            }
            const label = document.createElement('span');
            label.className = 'recent-label';
            const name = document.createElement('span');
            name.className = 'recent-name';
            name.textContent = photo ? 'Recent' : rec.name;
            const when = document.createElement('span');
            when.className = 'recent-when';
            when.textContent = this.when(rec.openedAt);
            const meta = photo ? rec.name : rec.count ? `${rec.count.toLocaleString()} photo${rec.count === 1 ? '' : 's'}` : '';
            // "Yesterday · 214 photos", "Lighthouse.jpg · Today"
            const sub = document.createElement('span');
            sub.className = 'recent-sub';
            if (meta) {
                const m = document.createElement('span');
                m.className = 'recent-meta';
                m.textContent = meta;
                if (photo) sub.append(m, ' · ', when);
                else sub.append(when, ' · ', m);
            } else sub.append(when);
            label.append(name, sub);
            open.append(pile, label);
            open.addEventListener('click', () => this.open(rec));
            const remove = document.createElement('button');
            remove.className = 'recent-remove';
            remove.title = photo ? 'Take it off the table (the photo isn\'t touched)' : 'Take it off the table (the folder isn\'t touched)';
            remove.setAttribute('aria-label', `Remove ${rec.name} from Recent`);
            remove.textContent = '×';
            remove.addEventListener('click', () => this.forget(rec.id));
            li.append(open, remove);
            ul.appendChild(li);
        });
        box.classList.toggle('hidden', !list.length);
        const empty = this.el('home-empty');
        if (empty) empty.classList.toggle('hidden', !!list.length);
    },

    async open(rec) {
        const app = this.app;
        if (!app || app.isLoading) return;
        const h = rec.handle;
        try {
            // Asked within the click, while Chrome still allows a prompt
            if (typeof h.queryPermission === 'function' && await h.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
                await h.requestPermission({ mode: 'readwrite' }) !== 'granted') {
                app.showToast(`jEditor needs permission to open ${rec.name}`, 4000);
                return;
            }
            // Still there? (moved, renamed or deleted since)
            if (rec.kind === 'photo') await h.getFile();
            else for await (const entry of h.values()) if (entry) break;
        } catch (e) {
            console.warn('Recent folder unavailable:', e);
            app.showToast(`Couldn't find “${rec.name}” — it may have been moved, renamed or deleted`, 5000, null,
                { label: 'Remove', run: () => this.forget(rec.id) });
            return;
        }
        // Straight to the grid, whatever mode it was left in
        if (typeof Modes !== 'undefined') Modes.next = 'photos';
        if (rec.kind === 'photo') await app.openFileHandles([h]);
        else await app.openDirectory(h);
    },

    // ---- A folder inside an order opened before ----
    //
    // A browser can't look up from a folder to the one it's in, so a
    // subfolder of an order can't tell it's part of one. But the orders
    // here can tell whether a folder is inside them (resolve), so opening
    // Smith Order/Ceremony after Smith Order offers to open the order at
    // Ceremony instead: one .jeditor (trash, cache, flags) for the whole
    // order, rather than a second one inside Ceremony.

    // → { rec, path } or null. The closest order that already has a
    // .jeditor, else the outermost one.
    async containing(handle) {
        if (!this.supported() || !handle || handle.kind !== 'directory') return null;
        const hits = [];
        for (const rec of await this.list()) {
            try {
                if (!rec.handle || typeof rec.handle.resolve !== 'function') continue;
                const parts = await rec.handle.resolve(handle);
                if (parts && parts.length) hits.push({ rec, path: parts.join('/') });
            } catch (e) { /* not comparable */ }
        }
        if (!hits.length) return null;
        hits.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
        // The Windows app keeps no .jeditor in the folders: the closest project
        if (FolderCache.native()) return hits[0];
        for (const hit of hits) {
            try {
                await hit.rec.handle.getDirectoryHandle(FolderCache.DIR);
                return hit;
            } catch (e) { /* none there, or no access yet */ }
        }
        return hits[hits.length - 1];
    },

    // Ask; → { handle, path } to open the order at the folder, or null to
    // open just the folder
    async offerOrder(handle) {
        const hit = await this.containing(handle);
        if (!hit) return null;
        const label = hit.path.split('/').join(' / ');
        this.el('op-text').textContent = `“${handle.name}” is inside “${hit.rec.name}”, which you've opened before. ` +
            `Open the whole project at ${label}? ` + (FolderCache.native()
                ? 'Its flags and cache are then kept together for the whole project, not separately for this folder.'
                : 'Its trash, cache and flags are kept in the project\'s .jeditor, so this folder doesn\'t get one of its own.');
        const panel = this.el('order-prompt');
        panel.classList.remove('hidden');
        this.el('op-order').focus();
        const yes = await new Promise((resolve) => { this._orderResolve = resolve; });
        if (!yes) return null;
        const h = hit.rec.handle;
        try {
            // Still inside the click on "Open the order", so Chrome may ask
            if (typeof h.queryPermission === 'function' && await h.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
                await h.requestPermission({ mode: 'readwrite' }) !== 'granted') {
                this.app.showToast(`No permission to open ${hit.rec.name} — opening just ${handle.name}`, 4000);
                return null;
            }
        } catch (e) {
            this.app.showToast(`Couldn't open ${hit.rec.name} — opening just ${handle.name}`, 4000);
            return null;
        }
        return { handle: h, path: hit.path };
    },

    initPrompt() {
        const panel = this.el('order-prompt');
        if (!panel) return;
        const done = (yes) => {
            panel.classList.add('hidden');
            const r = this._orderResolve;
            this._orderResolve = null;
            if (r) r(yes);
        };
        this.el('op-order').addEventListener('click', () => done(true));
        this.el('op-folder').addEventListener('click', () => done(false));
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) done(false); });
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); done(false); }
            e.stopPropagation();
        });
    },

    isPromptOpen() {
        const panel = this.el('order-prompt');
        return !!panel && !panel.classList.contains('hidden');
    },

    init(app) {
        this.app = app;
        this.initPrompt();
        this.render();
    }
};
