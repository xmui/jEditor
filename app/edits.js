// Save edits when done: a project setting that holds crops and turns back
// instead of writing each one into the photo straight away.
//
// Normally an edit is saved the moment it's made (that's the point). With
// this on, a crop, a straighten, a turn or a batch Auto crop is kept as an
// edit on the photo: what the crop editor would save (crop.js snapshot:
// the turn, the tilt and the box, relative to the photo's size). The photo
// on disk isn't touched, so the crop can be changed again and again, always
// from the whole photo. The grid, film strip and viewer show each photo
// as it will be saved, with a pencil on the edited ones, and a bar says
// how many are waiting, with Save and Discard.
//
// Save writes them all: over the photos (the originals are kept for Ctrl+Z,
// as batch Auto crop does), or as copies in "jEditor Export" with the
// photos left alone. Edits are kept with the project (edits.json, beside
// flags.json; see folder-cache.js), so they're still there after closing
// jEditor. Like flags they live on the photo objects while the project is
// open, so a rename or a move inside jEditor carries them along.
//
// Adjustments (adjust.js: light, color, curves; `adj` on an edit) are
// always kept this way, whether or not the setting is on: they're never
// written into the photo until it's saved or exported. A photo with
// adjustments keeps its crop and turns as an edit too, so everything is
// applied once, from the original.

const Edits = {
    FILE: 'edits.json',

    defer: false,       // this project keeps edits until saved
    orphans: new Map(), // path → edit of photos not in the folder now

    ICON: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/></svg>',

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        const bind = (id, fn) => {
            const b = document.getElementById(id);
            if (b) b.addEventListener('click', (e) => { e.currentTarget.blur(); fn(); });
        };
        bind('edits-save', () => this.saveAll());
        bind('edits-discard', () => this.discardAll());
        bind('edits-off', () => this.setDefer(false));
    },

    // Another folder is being opened (or none): a reminder of what's
    // waiting in the one being left, which keeps its edits for next time
    reset() {
        const app = this.app;
        const n = app && app.files && this.defer ? app.files.filter(f => f._edit).length : 0;
        const left = this._loadedFor;
        // (once the next one is set: not when the same one is opened again)
        if (n && left) setTimeout(() => {
            if (app.dirHandle === left) return;
            app.showToast(`${left.name}: ${n.toLocaleString()} edit${n === 1 ? '' : 's'} not saved yet — still there when you open it again`, 6000, null, null, { type: 'info' });
        }, 0);
        // What hasn't been written yet goes to the project being left,
        // after any write still under way (its folder is taken now)
        if (left && (this._dirty || this._saving) && !app.readOnlyMode) {
            const data = this.collect();
            const root = FolderCache.root(app, !this.isEmpty(data)).catch(() => null);
            const before = (this._saving || Promise.resolve()).catch(() => { });
            this._final = before.then(async () => this.writeOut(await root, data));
        }
        this._dirty = false;
        this.defer = false;
        this.orphans = new Map();
        this._loadedFor = null;
        this.updateBar();
    },

    // Edits wait for Save in the open project
    on() {
        return !!(this.defer && this.canKeep());
    },

    // There's a project to keep edits in
    canKeep() {
        const app = this.app;
        return !!(app && app.dirHandle && !app.readOnlyMode);
    },

    // This photo's crops and turns are kept as an edit, not written: the
    // setting is on, or it has adjustments or paint (which always are), or
    // it's a RAW or a HEIC (raw.js, codec.js: never written), an AVIF or a
    // JPEG XL (written only by Save edits, through the codecs: codec.js)
    keeps(f) {
        return this.on() || !!(this.canKeep() && f && ((f._edit && (f._edit.adj || f._edit.paint)) || Raw.is(f.name) || Codec.isHeif(f.name) || Codec.of(f.name)));
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

    // No turn, no tilt, the whole photo (adjustments or not)
    wholePhoto(e) {
        const n = e.n, eq = (a, b) => Math.abs(a - b) < 1e-6;
        return !((e.q || 0) % 4) && !e.angle && eq(n.x0, -0.5) && eq(n.y0, -0.5) && eq(n.x1, 0.5) && eq(n.y1, 0.5);
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
        const p = this.load().then(files => {
            if (late && files.length && this.app.dirHandle === dir) this.changed(files, { save: false });
        }).catch(() => { });
        await Promise.race([p, new Promise(r => setTimeout(() => { late = true; r(); }, ms))]);
    },

    // The edited photos
    async load() {
        const app = this.app;
        this._loadedFor = app.dirHandle;
        this.orphans = new Map();
        this.defer = false;
        if (!app.dirHandle || app.readOnlyMode) {
            this.updateBar();
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
        this.defer = !!(data && data.defer);
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
        this.updateBar();
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
        this.updateBar();
        if (!this._dirty || !app.dirHandle || app.readOnlyMode) return;
        this._dirty = false;
        const data = this.collect();
        await this.writeOut(await FolderCache.root(app, !this.isEmpty(data)).catch(() => null), data);
    },

    // Nothing to keep: no setting, no edits
    isEmpty(data) {
        return !data.defer && !Object.keys(data.edits).length;
    },

    // The setting and every edit, as edits.json holds them
    collect() {
        const out = {};
        for (const [k, v] of this.orphans) out[k] = v;
        for (const f of this.app.files) if (f._edit) out[f.relPath || f.name] = f._edit;
        return { version: 1, defer: this.defer, edits: out };
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

    // Clean Up removed edits.json: the edits go, the setting stays
    clearAll() {
        this.orphans = new Map();
        const had = this.edited();
        for (const f of had) delete f._edit;
        if (had.length) this.changed(had);
        this._dirty = true;
        this.saveSoon();
        this.updateBar();
    },

    // Photos that left the folder keep their edits in case they come back
    forgetFiles(files) {
        for (const f of files) if (f._edit) this.orphans.set(f.relPath || f.name, f._edit);
        if (files.some(f => f._edit)) this.updateBar();
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

    // No turn, no tilt, the whole photo, no adjustments and no paint
    isNothing(e) {
        return this.wholePhoto(e) && !(e.adj && Develop.active(e.adj)) && !Paint.has(e);
    },

    undo(entry) {
        this.restore(entry.items);
        const n = entry.items.length;
        this.app.showToast(`Undid ${entry.label || 'edit'} on ${n === 1 ? entry.items[0].file.name : n + ' photos'}`, 3000, null, null, { kind: 'undo' });
    },

    // Edits put back (Ctrl+Z). Kept crops need the setting (or
    // adjustments): it comes back on if it was turned off since
    restore(items) {
        for (const it of items) this.put(it.file, it.edit);
        if (!this.defer && items.some(it => it.file._edit && !it.file._edit.adj)) {
            this.defer = true;
            if (typeof Places !== 'undefined' && Places.boxes) Places.drawCard();
        }
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

    // Back to the photos as they are on disk
    discard(files) {
        files = files.filter(f => f && f._edit);
        if (!files.length) return;
        this.set(files.map(f => ({ file: f, edit: null })), 'edits');
        this.app.showToast(`Discarded the edit${files.length === 1 ? ` on ${files[0].name}` : `s on ${files.length} photos`} — Ctrl+Z brings ${files.length === 1 ? 'it' : 'them'} back`, 3000);
    },

    async discardAll() {
        const list = this.edited();
        if (!list.length) return;
        const ok = await UI.confirm({
            title: `Discard ${list.length === 1 ? 'the edit' : `all ${list.length.toLocaleString()} edits`}?`,
            message: 'The photos go back to how they are on disk. Ctrl+Z brings the edits back.',
            ok: 'Discard',
            danger: true
        });
        if (ok) this.discard(list);
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
        this.updateBar();
        if (save) this.saveSoon();
    },

    // ---- The setting ----

    async setDefer(on) {
        const app = this.app;
        on = !!on;
        if (on === this.defer) return true;
        if (!app.dirHandle || app.readOnlyMode) {
            app.showToast('This needs a folder opened with Open folder');
            return false;
        }
        if (!on) {
            // (adjusted photos keep theirs either way)
            const waiting = this.edited().filter(f => !f._edit.adj);
            const n = waiting.length;
            if (n) {
                const how = await UI.choose({
                    title: `${n.toLocaleString()} edit${n === 1 ? '' : 's'} not saved yet`,
                    message: 'From now on, edits are saved straight away. What about the ones waiting?',
                    ok: 'Save them',
                    alt: 'Discard them',
                    altDanger: true
                });
                if (!how) return false;
                if (how === 'ok' && !await this.saveAll({ overwrite: true, list: waiting })) return false;
                if (how === 'alt') this.discard(waiting);
            }
        }
        this.defer = on;
        this.saveSoon();
        await this.flush();
        this.updateBar();
        if (typeof Places !== 'undefined' && Places.boxes) Places.drawCard();
        app.showToast(on ? 'Edits are kept until you save them' : 'Edits are saved straight away', 2500);
        return true;
    },

    // ---- Saving ----

    // Over the photos, or as copies in "jEditor Export". overwrite: skip
    // the question. True when it was done.
    async saveAll({ overwrite = false, list = null } = {}) {
        const app = this.app;
        list = list || this.edited();
        if (!list.length) {
            app.showToast('No edits to save');
            return true;
        }
        if (!app.ensureWritable()) return false;
        let how = overwrite ? 'ok' : null;
        if (!how) {
            const n = list.length, all = app.files.length;
            how = await UI.choose({
                title: `Save ${n === 1 ? 'the edit' : `${n.toLocaleString()} edits`}`,
                message: 'Write the edits into the photos, or keep the photos as they are and export edited copies.',
                items: [
                    `Save into the photos: ${n.toLocaleString()} photo${n === 1 ? ' is' : 's are'} changed. The originals are kept by jEditor, so Ctrl+Z puts them back.`,
                    `Export copies: all ${all.toLocaleString()} photo${all === 1 ? '' : 's'} go to "jEditor Export" in this folder, the edited ones with their edits. The edits stay, to change or save later.`
                ],
                ok: 'Save into photos',
                alt: 'Export copies'
            });
        }
        if (how === 'ok') return app.saveEdits(list);
        if (how === 'alt') {
            await app.exportCopies(app.files);
            return true;
        }
        return false;
    },

    // ---- On screen ----

    // A pencil, top left of a grid tile or film-strip item
    decorate(el, f) {
        let b = el.querySelector(':scope > .tile-edit');
        if (!f._edit) {
            if (b) b.remove();
            return;
        }
        if (!b) {
            b = document.createElement('span');
            b.className = 'tile-edit';
            b.innerHTML = this.ICON;
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

    // The pencil's tooltip
    describe(e) {
        if (e.paint && !this.on()) return 'Painted — the photo on disk is unchanged; Export (or Save edits) writes the result';
        if (e.adj && !this.on()) return 'Adjusted — the photo on disk is unchanged; Export (or Save edits) writes the result';
        return 'Edited — not saved into the photo yet';
    },

    // How many are waiting, with Save and Discard
    updateBar() {
        const bar = document.getElementById('edits-bar');
        if (!bar) return;
        const on = this.on();
        bar.classList.toggle('hidden', !on);
        const iface = this.app && this.app.elements && this.app.elements.mainInterface;
        if (iface) iface.classList.toggle('edits-on', on);
        if (!on) return;
        const n = this.count();
        const text = document.getElementById('edits-text');
        const full = n ? `${n.toLocaleString()} edit${n === 1 ? '' : 's'} not saved yet` : 'Edits are kept until you save';
        // Short of room, only the count shows (style.css): the rest is its tooltip
        text.textContent = '';
        if (n) {
            text.append(`${n.toLocaleString()} edit${n === 1 ? '' : 's'}`);
            const more = document.createElement('span');
            more.className = 'edits-more';
            more.textContent = ' not saved yet';
            text.append(more);
        } else {
            text.append(full);
        }
        text.title = full;
        document.getElementById('edits-save').disabled = !n;
        document.getElementById('edits-discard').classList.toggle('hidden', !n);
        document.getElementById('edits-off').classList.toggle('hidden', !!n);
        // The bottom row makes room for it (fit.js)
        if (typeof Fit !== 'undefined') Fit.run();
    }
};
