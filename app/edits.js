// Edits are kept in jEditor (Lightroom's way): in a project, a crop, a
// straighten, a turn, adjustments (adjust.js) and painting (paint.js) are
// kept as an edit on the photo: what the crop editor would save (crop.js
// snapshot: the turn, the tilt and the box, relative to the photo's size),
// plus `adj` and `paint`. The photo on disk isn't touched, so an edit can
// be changed again and again, always from the whole photo. The grid, film
// strip and viewer show each photo as it will be saved, with a pencil on
// the edited ones. Nothing nags about them: they're kept, not at risk.
//
// The one choice is Write edits to file (Ctrl+S,
// the right-click menus, ⋯ in Adjust and Paint: app.saveOverOriginal),
// which writes the edit into the photo; the original goes to originals/
// so Ctrl+Z puts it back, edit and all. Export makes edited copies and
// leaves the photos and their edits as they are. Edits are kept with the
// project (edits.json, beside flags.json; see folder-cache.js), so they're
// still there after closing jEditor. Like flags they live on the photo
// objects while the project is open, so a rename or a move inside jEditor
// carries them along.
//
// Without a project (a photo opened on its own, read-only folders) there's
// nowhere to keep them, so a turn or a crop is written straight away.
// Each project chooses, the first time it's opened (first-open.js asks:
// keep, in edits.json beside the edits), and its ⋯ changes it later.
// Settings → Projects → Saving holds the default for a project that hasn't
// chosen (uiPrefs.keepEdits). Not keeping: a turn or a crop is written
// straight away in a project too,
// except on a photo that already has an edit kept (it stays kept until
// it's saved over or discarded; adjustments and paint are always kept).
// It also clears the open project's edits (clearStored).

const Edits = {
    FILE: 'edits.json',

    orphans: new Map(), // path → edit of photos not in the folder now
    choice: null,       // this project's own: true keeps, false writes as you go; null: the default

    ICON: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/></svg>',

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
    },

    // Another folder is being opened (or none). The one being left keeps
    // its edits for next time, so there's nothing to warn about
    reset() {
        const app = this.app;
        const left = this._loadedFor;
        // What hasn't been written yet goes to the project being left,
        // after any write still under way (its folder is taken now)
        if (left && (this._dirty || this._saving) && !app.readOnlyMode) {
            const data = this.collect();
            const root = FolderCache.root(app, !this.isEmpty(data)).catch(() => null);
            const before = (this._saving || Promise.resolve()).catch(() => { });
            this._final = before.then(async () => this.writeOut(await root, data));
        }
        this._dirty = false;
        this.orphans = new Map();
        this.choice = null;
        this._loadedFor = null;
        this.loaded = null;
    },

    // Edits are kept in the open project (not written into the photos)
    on() {
        return this.keeping() && this.canKeep();
    },

    // This project keeps its edits in jEditor: as it chose, or the default
    keeping() {
        if (this.choice !== null && this.canKeep()) return this.choice;
        return this.defaultKeeping();
    },

    // Settings → Saving: Keep edits in jEditor, for a project that hasn't
    // chosen (on unless turned off)
    defaultKeeping() {
        const p = this.app && this.app.uiPrefs;
        return !(p && p.keepEdits === false);
    },

    // This project has chosen (first-open.js asks the ones that haven't)
    chosen() {
        return this.choice !== null;
    },

    // ---- Each project's choice, also kept by its path ----
    //
    // edits.json holds it, but where that is comes from the project's path
    // (folder-cache.js: orderStore), and on a network share the path the app
    // gives can differ from one open to the next (Z:\ or \\server\share, its
    // case, a trailing \), or not come at all (WebView2 158): then the answer
    // was lost and the question asked every time (the owner, 22 November).
    // So it's kept here too, by the path made plain (or, without one, the
    // folder's name), in jEditor's own settings: an update and Clear cache
    // keep it; Reset jEditor forgets it.
    CHOICES_KEY: 'jeditor.saveChoices',
    CHOICES_MAX: 500,

    // The path as a key: one per folder however it's written
    pathKey(path) {
        return String(path || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    },

    async choiceKey() {
        const app = this.app;
        const dir = app && app.dirHandle;
        if (!dir) return null;
        let path = null;
        try { if (typeof FolderCache !== 'undefined' && FolderCache.native()) path = await FolderCache.orderPath(app); } catch (e) { /* unknown */ }
        return path ? 'path:' + this.pathKey(path) : 'name:' + dir.name.toLowerCase();
    },

    savedChoices() {
        try { return JSON.parse(localStorage.getItem(this.CHOICES_KEY) || 'null') || {}; } catch (e) { return {}; }
    },

    async rememberedChoice() {
        const key = await this.choiceKey();
        const v = key && this.savedChoices()[key];
        return v && typeof v.keep === 'boolean' ? v.keep : null;
    },

    async rememberChoice(on) {
        const key = await this.choiceKey();
        if (!key) return;
        const all = this.savedChoices();
        all[key] = { keep: !!on, at: Date.now() };
        // The newest kept, so it can't grow without end
        const keys = Object.keys(all);
        if (keys.length > this.CHOICES_MAX) keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - this.CHOICES_MAX).forEach(k => delete all[k]);
        try { localStorage.setItem(this.CHOICES_KEY, JSON.stringify(all)); } catch (e) { /* private */ }
    },

    // The open project's own choice, kept with its edits and by its path;
    // quiet: no message
    setProjectKeeping(on, { quiet = false } = {}) {
        if (!this.canKeep()) return;
        on = !!on;
        const was = this.keeping();
        this.choice = on;
        this.rememberChoice(on);
        this._dirty = true;
        this.saveSoon();
        if (!quiet && was !== on) this.app.showToast(on ? 'This project keeps its edits in jEditor; the photos stay as they are' : 'This project saves edits into the photos as you go', 3000);
    },

    // The default (Settings → Saving)
    setKeeping(on) {
        const app = this.app;
        on = !!on;
        if (on === this.keeping()) return;
        app.uiPrefs.keepEdits = on;
        app.saveUiPrefs();
        app.showToast(on ? 'Edits are kept in jEditor; the photos stay as they are' : 'Edits are saved straight into the photos from now on', 3000);
    },

    // There's a project to keep edits in
    canKeep() {
        const app = this.app;
        return !!(app && app.dirHandle && !app.readOnlyMode);
    },

    // This photo's crops and turns are kept as an edit, not written: in a
    // project, or it has an edit kept already (adjustments and paint
    // always are), or it's a RAW or a HEIC (raw.js, codec.js: never written), an AVIF or a
    // JPEG XL (written only by Write edits to file, through the codecs: codec.js)
    keeps(f) {
        return this.on() || !!(this.canKeep() && f && (f._edit || Raw.is(f.name) || Codec.isHeif(f.name) || Codec.of(f.name)));
    },

    // An edit with these adjustments (null: none), its crop kept; from: the
    // edit it replaces, whose paint stays (a crop of a painted photo)
    withAdj(e, adj, from = null) {
        adj = Develop.clean(adj);
        const out = e ? { ...e, n: { ...e.n } } : { q: 0, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } };
        if (adj) out.adj = adj;
        else delete out.adj;
        if (from && from.paint) out.paint = from.paint;
        return this.isNothing(out) ? null : out;
    },

    // No turn, no flip, no tilt, the whole photo (adjustments or not)
    wholePhoto(e) {
        const n = e.n, eq = (a, b) => Math.abs(a - b) < 1e-6;
        return !((e.q || 0) % 4) && !e.m && !e.angle && eq(n.x0, -0.5) && eq(n.y0, -0.5) && eq(n.x1, 0.5) && eq(n.y1, 0.5);
    },

    get(f) {
        return (f && f._edit) || null;
    },

    edited() {
        return this.app.files.filter(f => f._edit);
    },

    count() {
        let n = 0;
        for (const f of this.app.files) if (f._edit) n++;
        return n;
    },

    // ---- Kept with the project ----

    // Before the grid is drawn, so the thumbnails are made as edited; if
    // reading them takes long (jEditor's storage not answering), the
    // project opens anyway and they're shown when they come
    async loadFor(ms) {
        let late = false;
        const dir = this.app.dirHandle;
        const p = this.loaded = this.load().then(files => {
            if (late && files.length && this.app.dirHandle === dir) this.changed(files, { save: false });
        }).catch(() => { });
        await Promise.race([p, new Promise(r => setTimeout(() => { late = true; r(); }, ms))]);
    },

    // The edited photos
    async load() {
        const app = this.app;
        this._loadedFor = app.dirHandle;
        this.orphans = new Map();
        if (!app.dirHandle || app.readOnlyMode) {
                return [];
        }
        // (the last project's last write first: it may be this one)
        if (this._final) await this._final.catch(() => { });
        if (this._loadedFor !== app.dirHandle) return [];
        let data = null;
        try {
            const root = await FolderCache.root(app, false);
            const fh = root && await root.getFileHandle(this.FILE);
            data = fh && JSON.parse(await (await fh.getFile()).text());
        } catch (e) { /* nothing kept */ }
        if (this._loadedFor !== app.dirHandle) return [];
        // Its own choice (only `keep`: the old `defer` was written for every
        // project, asked or not, so it says nothing about a choice)
        this.choice = data && typeof data.keep === 'boolean' ? data.keep : null;
        // ...or as kept by its path, when edits.json wasn't where it was left
        if (this.choice === null) {
            const kept = await this.rememberedChoice();
            if (this._loadedFor !== app.dirHandle) return [];
            if (kept !== null) {
                this.choice = kept;
                this._dirty = true; // into edits.json again, where it's looked for now
            }
        } else this.rememberChoice(this.choice);
        const saved = new Map(Object.entries((data && data.edits) || {}));
        for (const f of app.files) {
            const rel = f.relPath || f.name;
            const e = this.clean(saved.get(rel));
            // A photo changed since (outside jEditor): its edit no longer fits
            if (e && (!e.size || e.size === f.size)) f._edit = e;
            else delete f._edit;
            saved.delete(rel);
        }
        for (const [k, v] of saved) {
            const e = this.clean(v);
            if (e) this.orphans.set(k, e);
        }
        // Paint layers nothing in edits.json uses any more (paint.js)
        Paint.tidy(Object.values((data && data.edits) || {}).map(v => this.clean(v)).filter(Boolean)).catch(() => { });
        if (typeof Places !== 'undefined' && Places.boxes) Places.drawCard();
        return app.files.filter(f => f._edit);
    },

    // Edits from a .jeditor found in the project (prefix: the subfolder it
    // was in; folder-cache.js absorbNested), where the photo has none of
    // its own already: how many were taken
    mergeFrom(prefix, saved) {
        const app = this.app;
        const byPath = new Map(app.files.map(f => [f.relPath || f.name, f]));
        const changed = [];
        let n = 0;
        for (const [rel, v] of Object.entries(saved || {})) {
            const e = this.clean(v);
            if (!e) continue;
            const path = Folders.join(prefix, rel);
            const f = byPath.get(path);
            if (f) {
                if (f._edit || (e.size && e.size !== f.size)) continue;
                f._edit = e;
                changed.push(f);
            } else if (!this.orphans.has(path)) {
                this.orphans.set(path, e);
            } else continue;
            n++;
        }
        if (n) this.changed(changed);
        return n;
    },

    clean(v) {
        if (!v || typeof v !== 'object' || !v.n) return null;
        const num = (x) => typeof x === 'number' && isFinite(x);
        const n = v.n;
        if (![n.x0, n.y0, n.x1, n.y1].every(num) || n.x1 <= n.x0 || n.y1 <= n.y0) return null;
        const e = {
            q: ((Math.round(num(v.q) ? v.q : 0) % 4) + 4) % 4,
            angle: num(v.angle) ? Math.max(-45, Math.min(45, v.angle)) : 0,
            n: { x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1 }
        };
        // Flipped left to right, before the turn (CropGeom.flipped)
        if (v.m === true) e.m = true;
        if (typeof v.aspectKey === 'string') e.aspectKey = v.aspectKey;
        if (typeof v.landscape === 'boolean') e.landscape = v.landscape;
        if (num(v.size)) e.size = v.size;
        // Batch Auto crop's crop, for its test set (crop-log.js)
        if (v.auto && v.auto.found && Array.isArray(v.auto.crop) && Array.isArray(v.auto.corners)) e.auto = v.auto;
        const adj = typeof Develop !== 'undefined' ? Develop.clean(v.adj) : null;
        if (adj) e.adj = adj;
        const paint = typeof Paint !== 'undefined' ? Paint.clean(v.paint) : null;
        if (paint) e.paint = paint;
        return e;
    },

    // Written straight away (what's written is taken now, before another
    // project can be opened); changes meanwhile are written after
    saveSoon() {
        if (!this.app.dirHandle || this.app.readOnlyMode) return;
        this._dirty = true;
        if (this._saving) return;
        this._saving = this.save().finally(() => {
            this._saving = null;
            if (this._dirty) this.saveSoon();
        });
    },

    // Everything written (closing the project, updating jEditor)
    async flush() {
        while (this._saving) await this._saving.catch(() => { });
        if (this._dirty) await this.save();
        if (this._final) await this._final.catch(() => { });
    },

    async save() {
        const app = this.app;
        if (!this._dirty || !app.dirHandle || app.readOnlyMode) return;
        this._dirty = false;
        const data = this.collect();
        await this.writeOut(await FolderCache.root(app, !this.isEmpty(data)).catch(() => null), data);
    },

    // Nothing to keep
    isEmpty(data) {
        return !Object.keys(data.edits).length && typeof data.keep !== 'boolean';
    },

    // Every edit, as edits.json holds them
    collect() {
        const out = {};
        for (const [k, v] of this.orphans) out[k] = v;
        for (const f of this.app.files) if (f._edit) out[f.relPath || f.name] = f._edit;
        return this.choice === null ? { version: 1, edits: out } : { version: 1, keep: this.choice, edits: out };
    },

    // Written to the project's data folder (removed when there's nothing)
    async writeOut(root, data) {
        if (!root) return;
        try {
            if (this.isEmpty(data)) await root.removeEntry(this.FILE).catch(() => { });
            else await FolderCache.writeJson(root, this.FILE, data);
        } catch (e) {
            console.warn('Saving edits failed:', e);
        }
    },

    // Clean Up removed edits.json: the edits go
    clearAll() {
        this.orphans = new Map();
        const had = this.edited();
        for (const f of had) delete f._edit;
        if (had.length) this.changed(had);
        this._dirty = true;
        this.saveSoon();
    },

    // Photos that left the folder keep their edits in case they come back
    forgetFiles(files) {
        for (const f of files) if (f._edit) this.orphans.set(f.relPath || f.name, f._edit);
    },

    adopt(files) {
        if (!this.orphans.size) return;
        const back = [];
        for (const f of files) {
            const rel = f.relPath || f.name;
            const e = this.orphans.get(rel);
            if (e) {
                this.orphans.delete(rel);
                if (!e.size || e.size === f.size) {
                    f._edit = e;
                    back.push(f);
                }
            }
        }
        if (back.length) this.changed(back);
    },

    // ---- Changing edits ----

    // items: [{ file, edit }] (edit null: back to the photo as it is). One
    // undo step.
    set(items, label) {
        items = items.filter(it => it && it.file);
        if (!items.length) return;
        const before = items.map(it => ({ file: it.file, edit: it.file._edit || null }));
        for (const it of items) this.put(it.file, it.edit);
        this.app.pushUndo({ type: 'edits', label, items: before });
        this.changed(items.map(it => it.file));
    },

    put(f, e) {
        if (e && !this.isNothing(e)) {
            f._edit = this.clean({ ...e, size: (f._edit && f._edit.size) || f.size });
        } else {
            delete f._edit;
        }
    },

    // No turn, no flip, no tilt, the whole photo, no adjustments and no paint
    isNothing(e) {
        return this.wholePhoto(e) && !(e.adj && Develop.active(e.adj)) && !Paint.has(e);
    },

    undo(entry) {
        this.restore(entry.items);
        const n = entry.items.length;
        this.app.showToast(`Undid ${entry.label || 'edit'} on ${n === 1 ? entry.items[0].file.name : n + ' photos'}`, 3000, null, null, { kind: 'undo' });
    },

    // Edits put back (Ctrl+Z)
    restore(items) {
        for (const it of items) this.put(it.file, it.edit);
        this.changed(items.map(it => it.file));
    },

    // Turned a quarter at a time (deg: ±90, 180): the same box on the
    // photo, turned with it
    rotate(files, deg) {
        const turns = ((Math.round(deg / 90) % 4) + 4) % 4;
        if (!turns || !files.length) return true;
        this.set(files.map(f => ({ file: f, edit: this.turned(f._edit, turns) })), 'rotation');
        return true;
    },

    turned(e, turns) {
        let t = e ? { ...e, n: { ...e.n } } : { q: 0, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } };
        for (let i = 0; i < turns; i++) {
            // Clockwise: (x, y) → (−y, x), and the sides swap
            const n = t.n;
            t = {
                ...t,
                q: ((t.q || 0) + 1) % 4,
                n: { x0: -n.y1, y0: n.x0, x1: -n.y0, y1: n.x1 }
            };
            if (typeof t.landscape === 'boolean') t.landscape = !t.landscape;
        }
        return t;
    },

    // Flipped as they're seen ('h' left to right, 'v' upside down): the
    // same box on the photo, mirrored with it. Twice is back as it was
    flip(files, axis) {
        if (!files.length) return true;
        this.set(files.map(f => ({ file: f, edit: this.flipped(f._edit, axis) })), axis === 'v' ? 'flip upside down' : 'flip');
        return true;
    },

    flipped(e, axis) {
        const t = e ? { ...e, n: { ...e.n } } : { q: 0, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } };
        const f = CropGeom.flipped(t, axis);
        const out = { ...t, q: f.q, angle: f.angle, n: f.n };
        if (f.m) out.m = true;
        else delete out.m;
        // Batch Auto crop's record (crop-log.js) no longer describes it
        delete out.auto;
        return out;
    },

    // Back to the photos as they are on disk
    discard(files) {
        files = files.filter(f => f && f._edit);
        if (!files.length) return;
        this.set(files.map(f => ({ file: f, edit: null })), 'edits');
        this.app.showToast(`Discarded the edit${files.length === 1 ? ` on ${files[0].name}` : `s on ${files.length} photos`} — Ctrl+Z brings ${files.length === 1 ? 'it' : 'them'} back`, 3000);
    },

    // Thumbnails, viewer, badges, the bar and the file
    changed(files, { save = true } = {}) {
        const app = this.app;
        for (const f of files) {
            app.editChanged(f);
            if (f._gridEl) this.decorate(f._gridEl, f);
            if (f._stripEl) this.decorate(f._stripEl, f);
        }
        this.updateHeader();
        if (save) this.saveSoon();
    },

    // ---- Saving ----

    // Write edits to file: the edits written into their photos (the
    // originals kept for Ctrl+Z). True when it was done.
    async saveAll({ list = null } = {}) {
        const app = this.app;
        list = (list || this.edited()).filter(f => f && f._edit);
        if (!list.length) {
            app.showToast('No edits to save');
            return true;
        }
        if (!app.ensureWritable()) return false;
        return app.saveEdits(list);
    },

    // Settings → Saving → Clear…: every edit kept for the open project
    // taken off, after asking (Ctrl+Z puts them back while it's open)
    async clearStored() {
        const app = this.app;
        if (!this.canKeep()) {
            app.showToast('Open a project first: edits are kept for each project', 3000);
            return false;
        }
        const files = this.edited(), n = files.length + this.orphans.size;
        if (!n) {
            app.showToast(`No edits are stored for ${app.dirHandle.name}`, 2500);
            return false;
        }
        const ok = await UI.confirm({
            title: `Clear ${n.toLocaleString()} edit${n === 1 ? '' : 's'} stored for ${app.dirHandle.name}?`,
            message: 'The crops, turns, adjustments and painting kept in jEditor for this project are removed. The photos on disk stay exactly as they are, and so does anything already written to the files or exported.',
            ok: 'Clear edits',
            danger: true
        });
        if (!ok) return false;
        this.orphans = new Map();
        if (files.length) this.discard(files);
        else { this._dirty = true; this.saveSoon(); }
        return true;
    },

    // ---- On screen ----

    // A pencil, top left of a grid tile or film-strip item
    decorate(el, f) {
        let b = el.querySelector(':scope > .tile-edit');
        if (!f._edit) {
            if (b) b.remove();
            return;
        }
        // A small neutral dot: edited in jEditor, the file as it was
        if (!b) {
            b = document.createElement('span');
            b.className = 'tile-edit';
            el.appendChild(b);
        }
        b.title = this.describe(f._edit);
    },

    // Beside the file name: this photo's edit isn't saved yet
    updateHeader() {
        const app = this.app;
        if (!app || !app.elements || !app.elements.fileName) return;
        let el = document.getElementById('file-edit');
        if (!el) {
            el = document.createElement('span');
            el.id = 'file-edit';
            el.className = 'file-edit';
            el.innerHTML = this.ICON;
            app.elements.fileName.after(el);
        }
        const e = app.currentFile && app.currentFile._edit;
        el.classList.toggle('hidden', !e);
        if (e) el.title = this.describe(e);
    },

    // The dot's tooltip (and the pencil's by the name), in two lines
    describe() {
        return Host.say('Edited — the original file is untouched\nCtrl+S writes your edits into the file');
    }
};
