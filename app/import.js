// Import: a camera's card (or a camera that shows up as a drive) plugged
// in is noticed (places.js, drivesChanged: it has a DCIM folder), and its
// photos are offered to import:
//
//   into this project, a new project in the projects folder (named for
//   the day and the card), or a folder chosen; in folders by the day each
//   was taken (from the file's date, which the camera sets) if you like;
//   only the ones not imported before (remembered per photo: its name,
//   size and date), and the card ejected after if you like.
//
// Photos are copied through folder handles, so it works the same in every
// app (and in a browser, from a card's folder chosen with Import…). RAW
// files come too (raw.js shows them); videos stay on the card.

const Import = {
    KEY: 'jeditor.imported',
    MAX_KEPT: 50000,

    el(id) { return document.getElementById(id); },
    native() { return FolderCache.native(); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        const panel = this.el('import-panel');
        if (!panel) return;
        this.el('import-cancel').addEventListener('click', () => this.close(null));
        this.el('import-close').addEventListener('click', () => this.close(null));
        this.el('import-go').addEventListener('click', () => this.close(this.choices()));
        for (const r of panel.querySelectorAll('input[name="import-to"]')) r.addEventListener('change', () => this.sync());
        this.el('import-new-only').addEventListener('change', () => this.sync());
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(null); }
            else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); this.close(this.choices()); }
        });
    },

    // ---- What's been imported before ----

    imported() {
        if (!this._seen) {
            try { this._seen = new Set(JSON.parse(localStorage.getItem(this.KEY) || '[]')); } catch (e) { this._seen = new Set(); }
        }
        return this._seen;
    },

    remember(keys) {
        const seen = this.imported();
        for (const k of keys) { seen.delete(k); seen.add(k); }
        let list = [...seen];
        if (list.length > this.MAX_KEPT) list = list.slice(list.length - this.MAX_KEPT);
        this._seen = new Set(list);
        try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch (e) { /* full, or private mode */ }
    },

    keyOf(p) {
        return `${p.name}|${p.size}|${p.lastModified}`;
    },

    // ---- A card ----

    // A drive with a camera's DCIM folder (sidebar paths)
    async isCard(drive) {
        const native = this.native();
        if (!native || typeof native.listDir !== 'function') return false;
        try {
            const d = await native.listDir(drive.path);
            return d.folders.some(f => f.name.toUpperCase() === 'DCIM');
        } catch (e) {
            return false;
        }
    },

    // The photos in a folder and below: [{ handle, name, rel, size,
    // lastModified }] (hidden folders and jEditor's own are left out)
    async scan(dir, rel = '', out = [], depth = 0) {
        if (depth > 6 || out.length > 20000) return out;
        for await (const [name, h] of dir.entries()) {
            if (name.startsWith('.') || name.startsWith('$')) continue;
            if (h.kind === 'directory') await this.scan(h, rel ? `${rel}/${name}` : name, out, depth + 1);
            else if (this.app.isImage(name)) {
                const f = await h.getFile().catch(() => null);
                if (f) out.push({ handle: h, name, rel, size: f.size, lastModified: f.lastModified });
            }
        }
        return out;
    },

    // ---- The dialog ----

    // drive: { path, name } (a drive the app sees), or none: a folder is
    // chosen (a card in a browser)
    async open(drive = null) {
        const app = this.app;
        this.init(app);
        let src;
        try {
            if (drive && this.native() && typeof this.native().folderHandle === 'function') {
                const root = await this.native().folderHandle(drive.path);
                src = await root.getDirectoryHandle('DCIM').catch(() => root);
            } else {
                if (typeof showDirectoryPicker !== 'function') { app.showToast('Importing needs Chrome or Edge on a computer'); return; }
                src = await showDirectoryPicker({ id: 'jeditor-import', mode: 'read' });
                drive = { path: null, name: src.name };
            }
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            UI.alert({ title: 'Couldn\'t read the card', message: e.message });
            return;
        }
        app.beginTask('import-scan', `Looking at ${drive.name}…`);
        let photos;
        try {
            photos = await this.scan(src);
        } finally {
            app.endTask('import-scan');
        }
        if (!photos.length) {
            UI.alert({ title: `No photos on ${drive.name}`, message: 'There are no photos on it that jEditor can show.' });
            return;
        }
        photos.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name));
        const seen = this.imported();
        this.photos = photos;
        this.fresh = photos.filter(p => !seen.has(this.keyOf(p)));
        this.drive = drive;
        const choice = await this.ask();
        if (!choice) return;
        await this.run(choice);
    },

    ask() {
        const app = this.app, d = this.drive;
        const panel = this.el('import-panel');
        this.el('import-title').textContent = `Import from ${d.name}`;
        const first = new Date(this.photos[0].lastModified), last = new Date(this.photos[this.photos.length - 1].lastModified);
        const span = first.toDateString() === last.toDateString() ? first.toLocaleDateString() : `${first.toLocaleDateString()} – ${last.toLocaleDateString()}`;
        this.el('import-summary').textContent = `${this.photos.length.toLocaleString()} photo${this.photos.length === 1 ? '' : 's'}, ${span}` +
            (this.fresh.length < this.photos.length ? ` — ${this.fresh.length.toLocaleString()} not imported before` : '');
        const here = !!(app.dirHandle && !app.readOnlyMode);
        const projects = Host.has('places') && Places.get(Places.KEY_DIR, null);
        this.el('import-to-here').disabled = !here;
        this.el('import-to-here-label').textContent = here ? `Into ${app.dirHandle.name}` : 'Into the open project';
        this.el('import-to-new').disabled = !projects;
        this.el('import-to-new-row').classList.toggle('hidden', !projects);
        const day = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        this.el('import-name').value = `${day(first)} ${d.name}`.replace(/[<>:"/\\|?*]/g, '_');
        (projects ? this.el('import-to-new') : here ? this.el('import-to-here') : this.el('import-to-pick')).checked = true;
        this.el('import-eject-row').classList.toggle('hidden', !(d.path && this.native()));
        this.el('import-new-only').checked = true;
        this.sync();
        panel.classList.remove('hidden');
        setTimeout(() => this.el('import-go').focus(), 0);
        return new Promise(res => { this._answer = res; });
    },

    sync() {
        const to = this.choiceTo();
        this.el('import-name').disabled = to !== 'new';
        const n = this.el('import-new-only').checked ? this.fresh.length : this.photos.length;
        this.el('import-go').textContent = n ? `Import ${n.toLocaleString()} photo${n === 1 ? '' : 's'}` : 'Nothing new to import';
        this.el('import-go').disabled = !n;
    },

    choiceTo() {
        const r = document.querySelector('input[name="import-to"]:checked');
        return r ? r.value : 'pick';
    },

    choices() {
        return {
            to: this.choiceTo(),
            name: this.el('import-name').value.trim(),
            byDate: this.el('import-by-date').checked,
            newOnly: this.el('import-new-only').checked,
            eject: this.el('import-eject').checked && !this.el('import-eject-row').classList.contains('hidden')
        };
    },

    close(answer) {
        this.el('import-panel').classList.add('hidden');
        const res = this._answer;
        this._answer = null;
        if (res) res(answer);
    },

    // ---- Copying ----

    // Where they go: { dir (a handle), path (on disk, if known), open
    // (a new project, opened after) }
    async destination(c) {
        const app = this.app, native = this.native();
        if (c.to === 'here') return { dir: app.dirHandle, here: true };
        if (c.to === 'new') {
            const parent = Places.get(Places.KEY_DIR, null);
            const name = (c.name || 'Imported').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
            const path = await native.makeFolder(parent, name);
            return { dir: await native.folderHandle(path), path, open: true };
        }
        if (native && typeof native.pickPath === 'function') {
            const path = await native.pickPath('Import the photos into', Places.get(Places.KEY_DIR, null));
            if (!path) return null;
            return { dir: await native.folderHandle(path), path, open: false };
        }
        const dir = await showDirectoryPicker({ id: 'jeditor-import-to', mode: 'readwrite' });
        return { dir, path: null, open: false };
    },

    async run(c) {
        const app = this.app;
        let dest;
        try {
            dest = await this.destination(c);
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            UI.alert({ title: 'Couldn\'t import there', message: e.message });
            return;
        }
        if (!dest) return;
        const list = c.newOnly ? this.fresh : this.photos;
        const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        const key = 'import';
        let stopped = false, done = 0, skipped = 0, failed = 0;
        const stop = { label: 'Stop', run: () => { stopped = true; } };
        const say = () => app.showToast(`Importing from ${this.drive.name}… ${done + skipped}/${list.length}`, 0, key, stop, { type: 'progress' });
        say();
        const dirs = new Map();
        const keys = [];
        for (const p of list) {
            if (stopped) break;
            try {
                let dir = dest.dir;
                if (c.byDate) {
                    const k = day(p.lastModified);
                    if (!dirs.has(k)) dirs.set(k, await dest.dir.getDirectoryHandle(k, { create: true }));
                    dir = dirs.get(k);
                }
                // Already there (the same name and size): left; another by
                // that name: this one gets a number
                let name = p.name;
                for (let n = 2; ; n++) {
                    let there = null;
                    try { there = await (await dir.getFileHandle(name)).getFile(); } catch (e) { /* free */ }
                    if (!there) break;
                    if (there.size === p.size) { name = null; break; }
                    const dot = p.name.lastIndexOf('.');
                    name = dot > 0 ? `${p.name.slice(0, dot)} (${n})${p.name.slice(dot)}` : `${p.name} (${n})`;
                }
                if (!name) { skipped++; keys.push(this.keyOf(p)); continue; }
                const data = await p.handle.getFile();
                const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
                await w.write(data);
                await w.close();
                keys.push(this.keyOf(p));
                done++;
            } catch (e) {
                console.error('Import failed:', p.name, e);
                failed++;
            }
            if ((done + skipped) % 5 === 0) say();
        }
        this.remember(keys);
        const msg = `Imported ${done.toLocaleString()} photo${done === 1 ? '' : 's'} from ${this.drive.name}` +
            (skipped ? ` (${skipped} already there)` : '') + (failed ? `, ${failed} couldn't be copied` : '') + (stopped ? ' — stopped' : '');
        app.showToast(msg, 6000, key, null, { type: failed ? 'error' : 'success' });
        if (dest.here) await app.refreshFolder().catch(() => { });
        else if (dest.open && dest.path) await Places.open(dest.path);
        if (c.eject && this.drive.path) await Places.eject(this.drive.path, this.drive.name);
        return { done, skipped, failed };
    }
};
