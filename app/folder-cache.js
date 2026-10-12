// The .jeditor folder inside the opened photo folder:
//
//   .jeditor/trash/                   deleted photos (Ctrl+Z restores)
//   .jeditor/cache/thumbs/<hash>.img  grid / film-strip thumbnails
//   .jeditor/cache/fingerprints.json  duplicate-finder data
//
// The browser's own cache (IndexedDB) is per computer and per browser; this
// travels with the folder, so another workstation opening the same order —
// say on a shared drive — gets thumbnails and duplicate data without
// recomputing them. Screen-sized previews aren't stored here: at ~0.4 MB
// each they'd add ~800 MB to a 2000-photo order.
//
// Everything is best-effort: a cache that can't be read or written is
// simply skipped. "Clean Up Folder" removes .jeditor (and the old
// .jeditor-trash) when an order is finished.

const FolderCache = {
    DIR: '.jeditor',
    LEGACY_TRASH: '.jeditor-trash',
    FP_VERSION: 2,

    reset() {
        this._root = null;
        this._rootFor = null;
        this._thumbs = null;
        this._writes = [];
        this._writing = this._writing || 0; // in-flight writes still finish
        this._fpMap = null;
    },

    enabled(app) {
        return !!app.dirHandle && !app.readOnlyMode && !(app.uiPrefs && app.uiPrefs.folderCache === false);
    },

    // Everything cached here belongs to one folder: start over when another
    // folder is opened. Called first by every entry point.
    sync(app) {
        if (this._rootFor !== app.dirHandle) {
            this.reset();
            this._rootFor = app.dirHandle;
        }
    },

    async root(app, create = true) {
        this.sync(app);
        if (this._root) return this._root;
        if (!app.dirHandle) return null;
        try {
            this._root = await app.dirHandle.getDirectoryHandle(this.DIR, { create });
        } catch (e) {
            return null;
        }
        return this._root;
    },

    async trashDir(app) {
        const root = await this.root(app, true);
        if (!root) throw new Error('No folder access');
        return root.getDirectoryHandle('trash', { create: true });
    },

    async thumbsDir(app, create) {
        if (this._thumbs) return this._thumbs;
        const root = await this.root(app, create);
        if (!root) return null;
        try {
            const cache = await root.getDirectoryHandle('cache', { create });
            this._thumbs = await cache.getDirectoryHandle('thumbs', { create });
        } catch (e) {
            return null;
        }
        return this._thumbs;
    },

    // Stable short file name for a cache key (two FNV-1a hashes → 16 hex)
    hash(key) {
        let a = 0x811c9dc5, b = 0x01000193 ^ key.length;
        for (let i = 0; i < key.length; i++) {
            const c = key.charCodeAt(i);
            a = Math.imul(a ^ c, 0x01000193) >>> 0;
            b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
        }
        return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
    },

    // ---- thumbnails ----

    async getThumb(app, key) {
        this.sync(app);
        if (!this.enabled(app)) return null;
        try {
            const dir = await this.thumbsDir(app, false);
            if (!dir) return null;
            const file = await (await dir.getFileHandle(this.hash(key) + '.img')).getFile();
            // A copy: the File would become unreadable if the cache file
            // were ever rewritten
            return new Blob([await file.arrayBuffer()], { type: file.type || 'image/jpeg' });
        } catch (e) {
            return null; // not cached
        }
    },

    // Queued, one at a time, so a folder's worth of thumbnails being saved
    // never competes with what's on screen
    putThumb(app, key, blob) {
        this.sync(app);
        if (!this.enabled(app) || !blob) return;
        this._writes.push({ key, blob });
        this.pump(app);
    },

    pump(app) {
        while (this._writing < 1 && this._writes.length) {
            const job = this._writes.shift();
            this._writing++;
            (async () => {
                try {
                    const dir = await this.thumbsDir(app, true);
                    if (!dir) return;
                    const name = this.hash(job.key) + '.img';
                    try {
                        await dir.getFileHandle(name);
                        return; // already saved
                    } catch (e) { /* not yet */ }
                    const fh = await dir.getFileHandle(name, { create: true });
                    const w = await fh.createWritable();
                    await w.write(job.blob);
                    await w.close();
                } catch (e) { /* best-effort */ }
            })().finally(() => {
                this._writing--;
                this.pump(app);
            });
        }
    },

    async flush() {
        while (this._writes.length || this._writing) await new Promise(r => setTimeout(r, 20));
    },

    // Remove cached thumbnails of photos that changed or are gone
    async prune(app, validKeys) {
        if (!this.enabled(app)) return 0;
        const keep = new Set([...validKeys].map(k => this.hash(k) + '.img'));
        const dir = await this.thumbsDir(app, false);
        if (!dir) return 0;
        const stale = [];
        try {
            for await (const e of dir.values()) if (e.kind === 'file' && !keep.has(e.name)) stale.push(e.name);
        } catch (e) { return 0; }
        for (const name of stale) {
            try { await dir.removeEntry(name); } catch (e) { /* in use elsewhere */ }
        }
        return stale.length;
    },

    // ---- duplicate-finder fingerprints ----

    async loadFingerprints(app) {
        this.sync(app);
        if (this._fpMap) return this._fpMap;
        this._fpMap = new Map();
        if (!this.enabled(app)) return this._fpMap;
        try {
            const root = await this.root(app, false);
            const cache = root && await root.getDirectoryHandle('cache');
            const file = cache && await (await cache.getFileHandle('fingerprints.json')).getFile();
            const data = JSON.parse(await file.text());
            if (data.version === this.FP_VERSION && data.grid === Dupes.GRID && data.q === Dupes.Q) {
                for (const [k, v] of Object.entries(data.entries || {})) this._fpMap.set(k, v);
            }
        } catch (e) { /* none yet */ }
        return this._fpMap;
    },

    async saveFingerprints(app, entries) {
        if (!this.enabled(app)) return;
        try {
            const root = await this.root(app, true);
            const cache = await root.getDirectoryHandle('cache', { create: true });
            const fh = await cache.getFileHandle('fingerprints.json', { create: true });
            const w = await fh.createWritable();
            await w.write(JSON.stringify({ version: this.FP_VERSION, grid: Dupes.GRID, q: Dupes.Q, entries: Object.fromEntries(entries) }));
            await w.close();
            this._fpMap = new Map(entries);
        } catch (e) { /* best-effort */ }
    },

    // ---- how much room .jeditor takes ----

    // → { bytes, trash: {n, bytes}, cache: {n, bytes}, originals: {n, bytes} }
    // or null when there's no .jeditor. Files are read for their size only.
    async usage(app) {
        const root = await this.root(app, false);
        if (!root) return null;
        await this.flush();
        const out = { bytes: 0, trash: { n: 0, bytes: 0 }, cache: { n: 0, bytes: 0 }, originals: { n: 0, bytes: 0 }, other: { n: 0, bytes: 0 } };
        const walk = async (dir, bucket) => {
            const subs = [], files = [];
            for await (const e of dir.values()) (e.kind === 'directory' ? subs : files).push(e);
            for (let i = 0; i < files.length; i += 32) {
                const sizes = await Promise.all(files.slice(i, i + 32).map(e => e.getFile().then(f => f.size, () => 0)));
                for (const n of sizes) {
                    bucket.n++;
                    bucket.bytes += n;
                }
            }
            for (const d of subs) await walk(d, bucket);
        };
        try {
            for await (const e of root.values()) {
                const bucket = out[e.name] && e.kind === 'directory' ? out[e.name] : out.other;
                if (e.kind === 'directory') await walk(e, bucket);
                else {
                    bucket.n++;
                    bucket.bytes += await e.getFile().then(f => f.size, () => 0);
                }
            }
        } catch (e) { /* partial is fine */ }
        out.bytes = out.trash.bytes + out.cache.bytes + out.originals.bytes + out.other.bytes;
        return out;
    },

    // ---- a subfolder's own .jeditor ----
    //
    // Opening Smith Order/Ceremony on its own gives Ceremony a .jeditor.
    // When the whole order is opened later, that one is merged into the
    // order's and removed, so the order has one: its trash and Auto crop
    // originals move across (named after the subfolder, so nothing clashes),
    // its flags join the order's under the subfolder's path, and its cache
    // goes (it's rebuilt when needed). If anything can't be moved, that
    // .jeditor stays where it is.

    async absorbNested(app, nested) {
        const dir = app.dirHandle;
        let flags = 0, trashed = 0, merged = 0, kept = 0;
        for (const { path, parent, handles } of nested) {
            for (const h of handles) {
                if (app.dirHandle !== dir) return; // another folder opened meanwhile
                try {
                    let ok = true;
                    if (h.name === this.LEGACY_TRASH) {
                        const r = await this.moveAll(app, h, 'trash', path);
                        trashed += r.moved;
                        ok = r.ok;
                    } else {
                        try {
                            const fh = await h.getFileHandle(Flags.FILE);
                            const data = JSON.parse(await (await fh.getFile()).text());
                            flags += Flags.mergeFrom(path, (data && data.flags) || {});
                        } catch (e) { /* no flags there */ }
                        for (const sub of ['trash', 'originals']) {
                            let from;
                            try { from = await h.getDirectoryHandle(sub); } catch (e) { continue; }
                            const r = await this.moveAll(app, from, sub, path);
                            if (sub === 'trash') trashed += r.moved;
                            ok = ok && r.ok;
                        }
                    }
                    if (!ok) { kept++; continue; }
                    await parent.removeEntry(h.name, { recursive: true });
                    merged++;
                } catch (e) {
                    console.warn(`Couldn't merge ${path}/${h.name}:`, e);
                    kept++;
                }
            }
        }
        if (!merged && !kept) return;
        const where = nested.length === 1 ? `“${nested[0].path.split('/').pop()}”` : `${nested.length} subfolders`;
        const what = [];
        if (flags) what.push(`${flags} flag${flags === 1 ? '' : 's'}`);
        if (trashed) what.push(`${trashed} deleted photo${trashed === 1 ? '' : 's'}`);
        if (merged) {
            app.showToast(`Merged the .jeditor folder in ${where} into this order's` + (what.length ? ` (${what.join(', ')})` : ''), 5000, null, null, { type: 'success' });
        }
        if (kept) app.showToast(`Couldn't merge ${kept} .jeditor folder${kept === 1 ? '' : 's'} inside this order — left where ${kept === 1 ? 'it is' : 'they are'}`, 5000);
    },

    // Move every file in `from` into .jeditor/<sub>, as "<subfolder> - name"
    async moveAll(app, from, sub, path) {
        const root = await this.root(app, true);
        if (!root) return { moved: 0, ok: false };
        const to = await root.getDirectoryHandle(sub, { create: true });
        const taken = new Set();
        for await (const e of to.values()) taken.add(e.name.toLowerCase());
        const prefix = path.split('/').join(' - ') + ' - ';
        let moved = 0, ok = true;
        const entries = [];
        for await (const e of from.values()) entries.push(e);
        for (const e of entries) {
            if (e.kind !== 'file') { ok = false; continue; } // unexpected: leave it be
            let name = prefix + e.name;
            const dot = name.lastIndexOf('.');
            for (let n = 2; taken.has(name.toLowerCase()); n++) {
                name = dot > 0 ? `${prefix}${e.name.slice(0, e.name.lastIndexOf('.'))} (${n})${e.name.slice(e.name.lastIndexOf('.'))}` : `${prefix}${e.name} (${n})`;
            }
            try {
                let done = false;
                if (typeof e.move === 'function') {
                    try { await e.move(to, name); done = true; } catch (err) { /* copy instead */ }
                }
                if (!done) {
                    const data = await e.getFile();
                    const nh = await to.getFileHandle(name, { create: true });
                    const w = await nh.createWritable();
                    await w.write(data);
                    await w.close();
                    await from.removeEntry(e.name);
                }
                taken.add(name.toLowerCase());
                moved++;
            } catch (err) {
                console.warn('Couldn\'t move', e.name, err);
                ok = false;
            }
        }
        return { moved, ok };
    },

    // ---- clean up ----

    // How many photos are in the trash (new and old location)
    async trashCount(app) {
        let n = 0;
        const count = async (dir) => {
            try { for await (const e of dir.values()) if (e.kind === 'file') n++; } catch (e) { /* none */ }
        };
        try { const root = await this.root(app, false); if (root) await count(await root.getDirectoryHandle('trash')); } catch (e) { /* none */ }
        try { await count(await app.dirHandle.getDirectoryHandle(this.LEGACY_TRASH)); } catch (e) { /* none */ }
        return n;
    },

    // Delete .jeditor (trash + cache) and the old .jeditor-trash
    async cleanUp(app) {
        await this.flush();
        let removed = false;
        for (const name of [this.DIR, this.LEGACY_TRASH]) {
            try {
                await app.dirHandle.removeEntry(name, { recursive: true });
                removed = true;
            } catch (e) { /* not there */ }
        }
        this.reset();
        this._rootFor = app.dirHandle;
        return removed;
    }
};
