// Recent orders on the start screen.
//
// A folder handle can be kept in IndexedDB and used again later, so a
// recent order reopens without the folder picker. Chrome may ask once
// more for permission to edit it ("Allow jEditor to edit files in…?")
// after a restart. Only the handle, the name and when it was opened are
// kept; nothing is stored about the photos.

const Recents = {
    MAX: 6,
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

    // Newest first
    async list() {
        const all = await this.tx('readonly', s => s.getAll());
        return (all || []).sort((a, b) => b.openedAt - a.openedAt);
    },

    // A folder was opened: it goes to the top (once, however it was opened).
    // One at a time, so folders opened in quick succession keep their order.
    remember(handle) {
        this.saving = (this.saving || Promise.resolve()).then(() => this.save(handle)).catch(() => { });
        return this.saving;
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
        const rec = { id: same ? same.id : `${openedAt}-${Math.random().toString(36).slice(2, 8)}`, name: handle.name, handle, openedAt };
        const stale = list.filter(r => r !== same).slice(this.MAX - 1);
        await this.tx('readwrite', s => {
            s.put(rec);
            stale.forEach(r => s.delete(r.id));
        });
        await this.render();
    },

    async forget(id) {
        await this.tx('readwrite', s => s.delete(id));
        this.render();
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
        const list = this.supported() ? await this.list() : [];
        const ul = this.el('recent-list');
        ul.innerHTML = '';
        list.forEach(rec => {
            const li = document.createElement('li');
            const open = document.createElement('button');
            open.className = 'recent-open';
            open.title = `Open ${rec.name}`;
            open.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
            const name = document.createElement('span');
            name.className = 'recent-name';
            name.textContent = rec.name;
            const when = document.createElement('span');
            when.className = 'recent-when';
            when.textContent = this.when(rec.openedAt);
            open.append(name, when);
            open.addEventListener('click', () => this.open(rec));
            const remove = document.createElement('button');
            remove.className = 'recent-remove';
            remove.title = 'Remove from Recent (the folder isn\'t touched)';
            remove.setAttribute('aria-label', `Remove ${rec.name} from Recent`);
            remove.textContent = '×';
            remove.addEventListener('click', () => this.forget(rec.id));
            li.append(open, remove);
            ul.appendChild(li);
        });
        box.classList.toggle('hidden', !list.length);
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
            for await (const entry of h.values()) if (entry) break;
        } catch (e) {
            console.warn('Recent folder unavailable:', e);
            app.showToast(`Couldn't find “${rec.name}” — it may have been moved, renamed or deleted`, 5000, null,
                { label: 'Remove', run: () => this.forget(rec.id) });
            return;
        }
        await app.openDirectory(h);
    },

    init(app) {
        this.app = app;
        this.render();
    }
};
