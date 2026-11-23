// Each photo's sort keys, kept with its project (sortkeys.json, beside
// flags.json: folder-cache.js), so switching the sort is instant, on a
// network share too, every time the project opens (the owner, 23 November:
// "when switching to other sorts it should be instant").
//
// Name, modified and size come with the listing. Date taken is the one that
// has to be read (from each photo's EXIF: getExifInfo), which on a big
// project or a slow share took a long "Reading capture dates…" the first
// time Newest taken was picked, and again at every open. Now:
//   - what's kept is put on the photos as the project opens, before the
//     first sort (loadFor), so it opens sorted by date taken too
//   - what isn't is read in the background a few seconds after it opens,
//     two at a time, and kept (fill); photos added later (watch.js) are
//     read the same way
//   - Newest taken picked before that's done reads the rest at once, as
//     before (ensureDatesTaken), and keeps them too
// An entry counts while the photo's size and modified time are the same:
// a photo changed outside jEditor is read again. Clear cache keeps the file
// (it's not under cache/); Clean up removes it with the project's data.

const SortKeys = {
    FILE: 'sortkeys.json',
    VERSION: 1,
    WORKERS: 2,
    WAIT: 2500,        // ms after a project opens (or photos come) before reading
    SAVE_EVERY: 200,   // photos read between saves, on a big project

    init(app) {
        this.app = app;
    },

    key(f) {
        return f.relPath || f.name;
    },

    // The kept keys on the open project's photos (those not read already)
    async load() {
        const app = this.app;
        const dir = app.dirHandle;
        if (!dir || !FolderCache.enabled(app)) return 0;
        let data = null;
        try {
            const root = await FolderCache.root(app, false);
            const fh = root && await root.getFileHandle(this.FILE);
            data = fh && JSON.parse(await (await fh.getFile()).text());
        } catch (e) { /* none kept yet */ }
        if (app.dirHandle !== dir || !data || data.version !== this.VERSION || !data.photos) return 0;
        let n = 0;
        for (const f of app.files) {
            if (f.dateTaken !== undefined) continue;
            const e = data.photos[this.key(f)];
            if (e && e.s === f.size && e.m === f.lastModified && typeof e.t === 'number') {
                f.dateTaken = e.t;
                n++;
            }
        }
        return n;
    },

    // As load, but never holding the project up for longer than ms
    async loadFor(ms) {
        await Promise.race([this.load().catch(() => 0), new Promise(r => setTimeout(r, ms))]);
    },

    // Read what's missing, a little after now (again if already waiting)
    soon() {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.fill(), this.WAIT);
    },

    // The dates not kept yet, read quietly and kept
    async fill() {
        const app = this.app;
        const dir = app && app.dirHandle;
        if (!dir || app.readOnlyMode || this._filling === dir) return;
        // (Newest taken picked meanwhile reads them itself: ensureDatesTaken)
        if (app._readingDates) await app._readingDates.catch(() => { });
        const missing = app.files.filter(f => f.dateTaken === undefined);
        if (!missing.length) return;
        this._filling = dir;
        let next = 0, since = 0;
        const live = () => app.dirHandle === dir;
        try {
            await Promise.all(Array.from({ length: Math.min(this.WORKERS, missing.length) }, async () => {
                while (next < missing.length && live()) {
                    const f = missing[next++];
                    if (f.dateTaken !== undefined) continue;
                    const exif = await app.getExifInfo(f).catch(() => null);
                    if (f.dateTaken === undefined) f.dateTaken = (exif && exif.dateTaken) ? exif.dateTaken.getTime() : (f.lastModified || 0);
                    if (++since >= this.SAVE_EVERY) { since = 0; await this.save(); }
                }
            }));
        } finally {
            if (this._filling === dir) this._filling = null;
        }
        if (!live()) return;
        await this.save();
        // Sorted by date taken already: in the order the dates give now,
        // only if they change it (a redraw of the grid otherwise for nothing)
        if (app.sortMode && app.sortMode.startsWith('taken')) {
            const was = app.files.slice();
            app.sortFiles(false);
            if (app.files.some((f, i) => f !== was[i])) app.sortFiles();
        }
    },

    // Every date known, kept (one write; nothing when the cache is off)
    async save() {
        const app = this.app;
        const dir = app && app.dirHandle;
        if (!dir || app.readOnlyMode || !FolderCache.enabled(app)) return;
        const photos = {};
        for (const f of app.files) {
            if (typeof f.dateTaken === 'number') photos[this.key(f)] = { s: f.size, m: f.lastModified, t: f.dateTaken };
        }
        if (!Object.keys(photos).length) return;
        try {
            const root = await FolderCache.root(app, true);
            if (root && app.dirHandle === dir) await FolderCache.writeJson(root, this.FILE, { version: this.VERSION, photos });
        } catch (e) {
            console.warn('Sort keys not kept:', e);
        }
    }
};
