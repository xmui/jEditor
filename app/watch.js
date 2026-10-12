// Watching the open folder: photos added, removed or edited outside
// jEditor (a scanner saving into the order, Explorer, Photoshop) show up
// on their own, and a rescan (R) is quick.
//
// Where Chrome supports FileSystemObserver, the folder reports its own
// changes and only the folders that changed are listed again. Elsewhere
// (and on drives that can't be observed) the folder is checked when the
// window gets focus and every so often while it's on screen.
//
// A scan lists folders, several at a time, and compares each listing with
// what's loaded: names not loaded yet are new photos, loaded photos no
// longer listed are gone. Only new photos are opened (for size and date),
// so a scan of an unchanged order reads no files at all. Edits are found
// separately, in the background, by comparing size and date: after a
// rescan, when the window gets focus (after editing elsewhere), or when the
// observer names a file.
//
// jEditor's own edits change the folder too. Scans wait until no edit is
// in progress (see guard), and a scan that overlapped one is thrown away
// and run again, so a half-finished rename never looks like a photo that
// vanished and a new one that appeared.

const Watch = {
    WALK_CONCURRENCY: 8, // folders listed at once (helps most on network drives)
    STAT_BATCH: 24,      // files opened at once for size and date
    POLL_MIN_MS: 15000,  // checking without an observer: at most this often…
    POLL_MAX_MS: 120000, // …and at least this often, scaled to how long a scan takes
    EDIT_CHECK_MS: 60000, // edits are looked for on focus at most once a minute
    DEBOUNCE_MS: 350,

    opDepth: 0,
    opGen: 0,
    observer: null,
    running: null,
    queued: null,

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        // Everything that writes to the order folder
        this.guard(app, ['drainRotationQueue', 'moveToTrash', 'undo', 'renameFile', 'renameMany', 'moveFile',
            'saveCrop', 'cleanUpFolder', 'exportCopies', 'batchAutoCrop']);
        this.guard(Folders, ['relocate', 'newFolder', 'renameFolder', 'deleteFolder', 'createPath', 'trashQuietly', 'undo', 'removeIfEmpty']);
        window.addEventListener('focus', () => this.onFocus());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.onFocus();
        });
    },

    enabled() {
        const app = this.app;
        return !!(app && app.dirHandle && !app.readOnlyMode && app.uiPrefs && app.uiPrefs.autoCheck !== false);
    },

    // While one of these runs, the folder on disk and what's loaded can
    // disagree for a moment. A scan waits for it to finish.
    guard(obj, names) {
        const w = this;
        for (const name of names) {
            const orig = obj[name];
            if (typeof orig !== 'function') continue;
            obj[name] = function (...args) {
                w.opDepth++;
                w.opGen++;
                let res;
                try {
                    res = orig.apply(this, args);
                } catch (e) {
                    w.endOp();
                    throw e;
                }
                if (res && typeof res.then === 'function') return res.finally(() => w.endOp());
                w.endOp();
                return res;
            };
        }
    },

    endOp() {
        this.opDepth--;
        this.opGen++;
        Flags.saveSoon(); // renamed or moved photos: flags under their new paths
        this.app._usage = null; // .jeditor's size may have changed (trash, originals)
        this.app.refreshInfoSoon();
        // A check that came in meanwhile runs now
        if (!this.opDepth && this.queued) this.kick(400);
    },

    busy() {
        const app = this.app;
        return this.opDepth > 0 || app.isLoading || (app._tasks && app._tasks.has('scan'));
    },

    // ---- Starting and stopping with the folder ----

    async start() {
        this.stop();
        if (!this.enabled()) return;
        const gen = this.gen;
        if (typeof FileSystemObserver === 'function') {
            try {
                const obs = new FileSystemObserver((records) => this.onRecords(records));
                await obs.observe(this.app.dirHandle, { recursive: true });
                if (gen !== this.gen) return obs.disconnect();
                this.observer = obs;
                this.app.log('Watching the folder for changes');
                return;
            } catch (e) {
                this.app.log('Folder can\'t be observed (' + e.message + ') — checking it now and then');
            }
        }
        this.schedulePoll();
    },

    stop() {
        this.gen = (this.gen || 0) + 1;
        if (this.observer) {
            try { this.observer.disconnect(); } catch (e) { /* already gone */ }
            this.observer = null;
        }
        clearTimeout(this._pollTimer);
        clearTimeout(this._kickTimer);
        this.queued = null;
        this._lastEditCheck = Date.now();
    },

    schedulePoll() {
        clearTimeout(this._pollTimer);
        if (!this.enabled() || this.observer) return;
        // A slow drive is checked less often: about 1/40th of the time
        // goes on checking
        const wait = Math.min(this.POLL_MAX_MS, Math.max(this.POLL_MIN_MS, (this._lastWalkMs || 0) * 40));
        const gen = this.gen;
        this._pollTimer = setTimeout(() => {
            if (gen !== this.gen) return;
            if (document.visibilityState === 'visible') this.request({ full: true });
            this.schedulePoll();
        }, wait);
    },

    onFocus() {
        if (!this.enabled()) return;
        // Back from another program: maybe new scans, maybe edited photos
        const edits = Date.now() - (this._lastEditCheck || 0) > this.EDIT_CHECK_MS;
        if (!this.observer) this.request({ full: true, edits });
        else if (edits) this.request({ edits });
    },

    // ---- Observer records → which folders to look at ----

    onRecords(records) {
        if (!this.enabled()) return;
        const dirs = new Set(), files = new Set();
        let full = false;
        // Inside jEditor's own folders, at any depth (a subfolder's .jeditor
        // being merged, say), nothing is a photo
        const skip = (parts) => parts.some(p => this.skipDir(p));
        for (const r of records) {
            if (r.type === 'errored') {
                // The observer gave up: fall back to checking now and then
                if (this.observer) { try { this.observer.disconnect(); } catch (e) { } }
                this.observer = null;
                this.schedulePoll();
                full = true;
                continue;
            }
            if (r.type === 'unknown') { full = true; continue; }
            const parts = r.relativePathComponents || [];
            if (skip(parts)) continue;
            const path = parts.join('/');
            const parent = parts.slice(0, -1).join('/');
            const kind = r.changedHandle && r.changedHandle.kind;
            if (r.type === 'modified' && kind === 'file') {
                if (this.app.isImage(path)) files.add(path);
            } else if (r.type === 'modified' && kind === 'directory') {
                dirs.add(path);
            } else {
                dirs.add(parent);
                const from = r.relativePathMovedFrom;
                if (r.type === 'moved' && from && !skip(from)) dirs.add(from.slice(0, -1).join('/'));
            }
        }
        if (full) this.request({ full: true });
        else if (dirs.size || files.size) this.request({ dirs, files });
    },

    // Checks asked for close together are merged into one scan
    request(want) {
        const q = this.queued || (this.queued = { full: false, edits: false, dirs: new Set(), files: new Set() });
        if (want.full) q.full = true;
        if (want.edits) q.edits = true;
        if (want.manual) q.manual = true;
        if (want.dirs) want.dirs.forEach(d => q.dirs.add(d));
        if (want.files) want.files.forEach(f => q.files.add(f));
        this.kick(this.DEBOUNCE_MS);
    },

    kick(delay) {
        clearTimeout(this._kickTimer);
        this._kickTimer = setTimeout(() => this.drain(), delay);
    },

    async drain() {
        if (this.running || !this.queued) return;
        if (this.busy()) return this.kick(600); // after the edit in progress
        const job = this.queued;
        this.queued = null;
        this.running = this.scan(job).catch(e => {
            console.warn('Folder check failed:', e);
            this.app.log('Folder check failed: ' + e.message);
        }).finally(() => {
            this.running = null;
            if (this.queued) this.kick(50);
        });
        return this.running;
    },

    // ---- Rescan (R) ----

    async rescan() {
        const app = this.app;
        if (!app.dirHandle) return;
        if (this.running) await this.running;
        this.queued = null;
        clearTimeout(this._kickTimer);
        app.beginTask('scan', 'Scanning for new photos…');
        try {
            this.running = this.scan({ full: true, manual: true, edits: false, dirs: new Set(), files: new Set() });
            await this.running;
        } catch (e) {
            console.error('Refresh failed:', e);
            app.showToast('Refresh failed');
        } finally {
            this.running = null;
            app.endTask('scan');
        }
        // Then, in the background, photos edited in another program (that
        // opens every file, so it isn't kept waiting for)
        this.request({ edits: true });
    },

    // ---- Listing ----

    skipDir(name) {
        return name === FolderCache.DIR || name === FolderCache.LEGACY_TRASH || name === 'jEditor Export';
    },

    // own: jEditor's folders found here (.jeditor, the old .jeditor-trash)
    async listDir(handle) {
        const files = new Map(), dirs = new Map(), own = [];
        for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
                if (this.app.isImage(entry.name) && !entry.name.startsWith('.jeditor-')) files.set(entry.name, entry);
            } else if (entry.kind === 'directory') {
                if (entry.name === FolderCache.DIR || entry.name === FolderCache.LEGACY_TRASH) own.push(entry);
                else if (!this.skipDir(entry.name)) dirs.set(entry.name, entry);
            }
        }
        return { files, dirs, own };
    },

    // Lists the given folders, and with deep every folder inside them;
    // folders not seen before are always listed all the way down. Several
    // folders are listed at once. A folder that can't be listed is marked
    // failed: nothing in it counts as gone.
    async walk(roots, deep) {
        const out = new Map();
        const queue = [...roots];
        let active = 0;
        await new Promise((resolve) => {
            const pump = () => {
                if (!queue.length && !active) return resolve();
                while (queue.length && active < this.WALK_CONCURRENCY) {
                    const { path, handle } = queue.shift();
                    if (out.has(path)) continue;
                    out.set(path, null);
                    active++;
                    this.listDir(handle).then((l) => {
                        out.set(path, { handle, ...l });
                        for (const [name, h] of l.dirs) {
                            const p = Folders.join(path, name);
                            if (deep || !Folders.map.has(p)) queue.push({ path: p, handle: h });
                        }
                    }, () => {
                        out.set(path, { handle, failed: true });
                    }).finally(() => {
                        active--;
                        pump();
                    });
                }
            };
            pump();
        });
        return out;
    },

    // Size and date, several files at a time
    async stat(handles) {
        const out = new Array(handles.length);
        for (let i = 0; i < handles.length; i += this.STAT_BATCH) {
            const part = handles.slice(i, i + this.STAT_BATCH);
            const datas = await Promise.all(part.map(h => h.getFile().catch(() => null)));
            datas.forEach((d, j) => { out[i + j] = d; });
        }
        return out;
    },

    // ---- One scan ----

    async scan(job) {
        const app = this.app;
        if (!app.dirHandle) return;
        const gen = this.gen, opGen = this.opGen;
        const t0 = performance.now();

        // Which folders to list
        let roots = [];
        let deep = job.full;
        if (job.full) {
            roots = [{ path: '', handle: app.dirHandle }];
        } else {
            for (const d of job.dirs) {
                try {
                    roots.push({ path: d, handle: await Folders.handleFor(d) });
                } catch (e) {
                    deep = true; // a folder we knew has gone: list everything
                    roots = [{ path: '', handle: app.dirHandle }];
                    break;
                }
            }
        }
        const listings = roots.length ? await this.walk(roots, deep) : new Map();
        if (job.full) this._lastWalkMs = performance.now() - t0;

        // Compare with what's loaded
        const byDir = new Map();
        for (const f of app.files) {
            if (f.relPath === undefined) continue; // not read from the folder: never "gone"
            const d = Folders.dirOf(f);
            if (!byDir.has(d)) byDir.set(d, []);
            byDir.get(d).push(f);
        }
        const loaded = new Set(app.files.map(f => f.relPath || f.name));
        const fresh = [];
        const gone = new Set();
        const goneDirs = [];
        const newDirs = [];
        for (const [dir, l] of listings) {
            if (!l || l.failed) continue;
            if (!Folders.map.has(dir)) newDirs.push(dir);
            for (const [name, handle] of l.files) {
                const relPath = Folders.join(dir, name);
                if (!loaded.has(relPath)) fresh.push({ name, relPath, parentDir: l.handle, handle });
            }
            for (const f of byDir.get(dir) || []) if (!l.files.has(f.name)) gone.add(f);
            for (const sub of Folders.children(dir)) {
                if (l.dirs.has(Folders.baseName(sub))) continue;
                goneDirs.push(sub);
                for (const f of app.files) if (f.relPath !== undefined && Folders.within(Folders.dirOf(f), sub)) gone.add(f);
            }
        }

        // Size and date of the new photos
        const datas = await this.stat(fresh.map(p => p.handle));
        const added = [];
        fresh.forEach((p, i) => {
            const d = datas[i];
            if (d) added.push({ ...p, size: d.size, lastModified: d.lastModified });
        });

        // Edited elsewhere: size or date differ from what's loaded
        let edited = [];
        if (job.files.size || job.edits) {
            const check = job.edits ? app.files.filter(f => !gone.has(f))
                : app.files.filter(f => job.files.has(f.relPath || f.name));
            edited = await this.findEdited(check);
            if (job.edits) this._lastEditCheck = Date.now();
        }

        // Something of ours touched the folder meanwhile, or a new folder
        // was opened: this picture may be half old, half new. Look again.
        if (gen !== this.gen) return;
        if (opGen !== this.opGen || this.opDepth) {
            this.request(job);
            return;
        }

        const dirsChanged = newDirs.length > 0 || goneDirs.length > 0;
        for (const [dir, l] of listings) if (l && !l.failed) Folders.register(dir, l.handle);
        goneDirs.forEach(d => Folders.forget(d));
        this.apply({ added, gone: [...gone], dirsChanged });
        for (const f of edited) app.afterFileChanged(f);
        app.log(`Folder check: ${listings.size} folder(s) in ${Math.round(performance.now() - t0)} ms — ` +
            `${added.length} new, ${gone.size} gone, ${edited.length} edited`);
        this.report({ added, gone: gone.size, edited: edited.length, manual: job.manual });
    },

    async findEdited(files) {
        const app = this.app;
        // Photos being rotated or saved right now are ours to change
        const list = files.filter(f => !f.pendingRotation && !f.savingRotation && f.handle && f.handle.getFile);
        const datas = await this.stat(list.map(f => f.handle));
        return list.filter((f, i) => {
            const d = datas[i];
            return d && (d.size !== f.size || d.lastModified !== f.lastModified);
        });
    },

    // ---- Updating the screen ----

    apply({ added, gone, dirsChanged }) {
        const app = this.app;
        if (!added.length && !gone.length) {
            if (dirsChanged) Folders.afterChange();
            else Folders.render();
            return;
        }
        if (gone.length) {
            Flags.forgetFiles(gone);
            app.removeFilesFromApp(gone);
        }
        if (!added.length) {
            if (dirsChanged) Folders.afterChange();
            return;
        }
        const now = Date.now();
        added.forEach(f => { f._arrived = now; });
        const wasEmpty = app.files.length === 0;
        app.files.push(...added);
        Flags.adopt(added);
        if (wasEmpty) {
            // Everything had gone, and now there's something again
            app.elements.dropZone.classList.add('hidden');
            app.elements.mainInterface.classList.remove('hidden');
            app.sortFiles(false);
            app.currentFile = app.viewFiles()[0] || app.files[0];
            app.renderThumbnails();
            app.renderGrid();
            app.setView(app.viewMode);
        } else if (dirsChanged || app.gridRendering) {
            app.sortFiles(false);
            app.keepGridPlace(() => Folders.afterChange());
        } else {
            app.sortFiles(false);
            this.insertTiles(added);
        }
        app.precacheThumbnails();
    },

    // Slot new photos into the grid and film strip where the sort puts
    // them, without building every tile again: a scanner adding a photo
    // every few seconds mustn't make the grid flicker or lose your place.
    insertTiles(added) {
        const app = this.app;
        const isNew = new Set(added);
        const view = app.viewFiles();
        const grid = app.elements.gridView;
        const strip = app.elements.thumbnailStrip;
        app.keepGridPlace(() => {
            let nextTile = null, nextStrip = null;
            for (let i = view.length - 1; i >= 0; i--) {
                const f = view[i];
                if (!isNew.has(f)) {
                    if (f._gridEl && f._gridEl.isConnected) nextTile = f._gridEl;
                    if (f._stripEl && f._stripEl.isConnected) nextStrip = f._stripEl;
                    continue;
                }
                const tile = app.makeGridTile(f, grid._observer);
                grid.insertBefore(tile, nextTile);
                nextTile = tile;
                const item = app.makeStripItem(f);
                strip.insertBefore(item, nextStrip);
                nextStrip = item;
            }
        });
        grid.classList.remove('grid-empty');
        Folders.render();
        if (!Folders.inView(app.currentFile) && view.length) app.setCurrent(view[0]);
        else if (app.currentFile) app.updateFileCount();
        app.updateSelectionUI();
    },

    report({ added, gone, edited, manual }) {
        const app = this.app;
        const parts = [];
        const n = added.length;
        if (n) parts.push(`${n.toLocaleString()} new photo${n === 1 ? '' : 's'}`);
        if (gone) parts.push(`${gone.toLocaleString()} photo${gone === 1 ? '' : 's'} removed from the folder`);
        if (edited) parts.push(`${edited.toLocaleString()} changed on disk`);
        if (!parts.length) {
            if (manual) app.showToast('Folder is up to date', 2000, null, null, { type: 'success' });
            return;
        }
        const msg = parts.join(' · ');
        const action = n ? { label: 'Show', run: () => this.showNew(added) } : null;
        app.showToast(msg.charAt(0).toUpperCase() + msg.slice(1), n ? 6000 : 4000, 'watch', action, { type: n ? 'photos' : 'info' });
    },

    // Jump to the first of the new photos (in the order they're shown),
    // making sure it's in view: All photos, no filter
    showNew(added) {
        const app = this.app;
        const still = added.filter(f => app.files.includes(f));
        if (!still.length) return;
        if (still.some(f => !Folders.inView(f))) {
            Flags.clearFilter(false);
            Folders.setScope(null);
        }
        const view = app.viewFiles();
        const first = view.find(f => still.includes(f));
        if (!first) return;
        if (app.viewMode === 'single') {
            app.loadFile(first);
        } else {
            app.goTo(first);
            app.selection = new Set(still.filter(f => view.includes(f)));
            app.updateSelectionUI();
        }
    }
};
