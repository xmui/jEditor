// Folders: collating an order into labelled folders. Navigating them,
// moving and copying photos between them, and making, renaming and
// deleting folders.
//
// The grid shows one scope at a time:
//   null     All photos, whatever folder they're in (the default)
//   ''       the photos directly in the opened folder
//   'A/B'    the photos directly in subfolder A/B
// Single view and the film strip page through the same photos.
//
// Every folder found while scanning is kept in `map` (empty ones too), so
// the rail can show the whole tree. Photos are moved with
// FileSystemHandle.move() — a rename on disk, instant even for big scans —
// or copied and the original removed where moving isn't supported. Name
// clashes are asked about before anything is touched, so a cancelled move
// changes nothing. A move, its replaced photos (to .jeditor/trash) and any
// folder made for it are undone together with one Ctrl+Z.

const Folders = {
    scope: null,
    lastScope: '',
    map: new Map(), // path → { handle } ('' is the opened folder)
    collapsed: new Set(),
    lastDest: null,
    dragging: null,
    CONCURRENCY: 4,
    DRAG_TYPE: 'application/x-jeditor-photos',

    el(id) { return document.getElementById(id); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        this.initRail();
        this.initBar();
        this.initPicker();
        this.initClash();
        this.initPrompt();
        this.initDrag();
        // The folder pill gives way to the centre pill as its name changes
        const centre = document.querySelector('.file-info');
        if (centre && typeof ResizeObserver === 'function') new ResizeObserver(() => this.fitBar()).observe(centre);
        window.addEventListener('resize', () => this.fitBar());
    },

    // A new folder was opened: forget the old one's folders
    reset() {
        this.map = new Map();
        this.scope = null;
        this.lastScope = '';
        this.collapsed = new Set();
        this.lastDest = null;
    },

    // ---- Paths ----

    dirOf(f) {
        const r = f.relPath || f.name;
        const i = r.lastIndexOf('/');
        return i === -1 ? '' : r.slice(0, i);
    },
    parentOf(p) {
        const i = p.lastIndexOf('/');
        return i === -1 ? '' : p.slice(0, i);
    },
    baseName(p) {
        return p.slice(p.lastIndexOf('/') + 1);
    },
    join(a, b) {
        return a ? `${a}/${b}` : b;
    },
    // Is folder p (or a photo's folder) inside folder `root`, or root itself?
    within(p, root) {
        return root === '' || p === root || p.startsWith(root + '/');
    },
    rootName() {
        return (this.app.dirHandle && this.app.dirHandle.name) || 'Folder';
    },
    // Display name: the folder's own name, or the order's for the root
    nameOf(p) {
        return p ? this.baseName(p) : this.rootName();
    },
    // Display path: "Wedding / Ceremony"
    label(p) {
        return p ? p.split('/').join(' / ') : this.rootName();
    },

    register(path, handle = null) {
        const rec = this.map.get(path);
        if (rec) {
            if (handle) rec.handle = handle;
        } else {
            this.map.set(path, { handle });
        }
        if (path) {
            const parent = this.parentOf(path);
            if (!this.map.has(parent)) this.register(parent);
        }
    },

    // The folder with this path, matched ignoring case (as on Windows and
    // macOS). Returns its path as known, or null.
    find(path) {
        const want = path.toLowerCase();
        for (const k of this.map.keys()) if (k.toLowerCase() === want) return k;
        return null;
    },

    children(path) {
        const out = [];
        for (const k of this.map.keys()) {
            if (k !== '' && k !== path && this.parentOf(k) === path) out.push(k);
        }
        return out.sort((a, b) => this.app.NAME_ORDER.compare(this.baseName(a), this.baseName(b)));
    },

    // Folders in tree order (depth-first, by name)
    ordered() {
        const out = [];
        const walk = (p) => {
            out.push(p);
            this.children(p).forEach(walk);
        };
        if (this.map.has('')) walk('');
        return out;
    },

    // Photos directly in each folder
    counts() {
        const c = new Map();
        for (const f of this.app.files) {
            const d = this.dirOf(f);
            c.set(d, (c.get(d) || 0) + 1);
        }
        return c;
    },

    // Folders only work on a folder opened with read/write access
    enabled() {
        return !!this.app.dirHandle;
    },

    hasSubfolders() {
        return this.map.size > 1;
    },

    canEdit() {
        if (!this.app.ensureWritable()) return false;
        if (!this.app.dirHandle) {
            this.app.showToast('Folders need a folder opened with Open Folder');
            return false;
        }
        return true;
    },

    // The photos the grid, film strip and arrow keys go through
    viewFiles() {
        const files = this.app.files;
        if (this.scope === null || !this.enabled()) return files;
        return files.filter(f => this.dirOf(f) === this.scope);
    },

    inView(file) {
        return !!file && (this.scope === null || !this.enabled() || this.dirOf(file) === this.scope);
    },

    // ---- Scope ----

    setScope(path) {
        const app = this.app;
        if (path !== null && !this.map.has(path)) path = '';
        if (path !== null) {
            this.lastScope = path;
            // Opening a folder unfolds the tree down to it
            for (let p = this.parentOf(path); p; p = this.parentOf(p)) this.collapsed.delete(p);
        }
        const changed = path !== this.scope;
        this.scope = path;
        app.selection.clear();
        const view = this.viewFiles();
        if (!this.inView(app.currentFile) && view.length) app.currentFile = view[0];
        app.renderThumbnails();
        app.renderGrid({ sync: true });
        if (changed) app.elements.gridView.scrollTop = 0;
        if (view.length) {
            app.setCurrent(app.currentFile);
        } else {
            this.showEmptyHeader();
        }
        if (app.viewMode === 'grid' && view.length && app.currentFile) app.selection.add(app.currentFile);
        app.updateSelectionUI();
        if (app.viewMode === 'single' && changed) {
            if (view.length) app.loadFile(app.currentFile);
            else app.setView('grid');
        }
    },

    showEmptyHeader() {
        const app = this.app;
        app.elements.fileName.textContent = this.nameOf(this.scope);
        app.elements.fileCount.textContent = 'No photos';
    },

    // ---- Layout: rail, top bar, folder tiles, folder chips ----

    railOpen() {
        const pref = this.app.uiPrefs && this.app.uiPrefs.folderRail;
        return typeof pref === 'boolean' ? pref : this.hasSubfolders();
    },

    toggleRail() {
        this.app.uiPrefs.folderRail = !this.railOpen();
        this.app.saveUiPrefs();
        this.render();
    },

    render() {
        if (!this.app) return;
        const ui = this.app.elements.mainInterface;
        const on = this.enabled() && this.app.viewMode === 'grid';
        const rail = on && this.railOpen();
        ui.classList.toggle('folders-on', on);
        ui.classList.toggle('rail-open', rail);
        this.el('folder-bar').classList.toggle('hidden', !on);
        this.el('folder-rail').classList.toggle('hidden', !rail);
        if (!on) return;
        const counts = this.counts();
        if (rail) this.renderRail(counts);
        this.renderBar(counts);
        this.fitBar();
    },

    // As wide as it needs, up to the centre pill
    fitBar() {
        const bar = this.el('folder-bar');
        const centre = document.querySelector('.file-info');
        if (!centre || bar.classList.contains('hidden')) return;
        const room = centre.getBoundingClientRect().left - bar.getBoundingClientRect().left - 12;
        if (room <= 0) return;
        // The pills follow the UI size setting (CSS zoom): room is in screen pixels
        const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
        bar.style.setProperty('--bar-room', `${Math.max(150, Math.floor(room / zoom))}px`);
        bar.classList.toggle('tight', room / zoom < 230);
    },

    folderIcon(cls = '') {
        return `<svg class="${cls}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
    },

    initRail() {
        const tree = this.el('folder-tree');
        tree.addEventListener('click', (e) => {
            const row = e.target.closest('.fr-row');
            if (!row) return;
            if (e.target.closest('.fr-caret')) {
                const p = row.dataset.folderPath;
                if (this.collapsed.has(p)) this.collapsed.delete(p);
                else this.collapsed.add(p);
                this.render();
                return;
            }
            this.setScope(row.dataset.scope === 'all' ? null : row.dataset.folderPath);
        });
        this.el('fr-new').addEventListener('click', () => this.newFolder());
    },

    renderRail(counts) {
        const tree = this.el('folder-tree');
        const total = this.app.files.length;
        const rows = [];
        const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        rows.push(`<div class="fr-row fr-all${this.scope === null ? ' active' : ''}" data-scope="all" title="Every photo in the order, whatever folder it's in">` +
            `<span class="fr-caret fr-spacer"></span>` +
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>` +
            `<span class="fr-name">All photos</span><span class="fr-count">${total.toLocaleString()}</span></div>`);
        const walk = (p, depth) => {
            const kids = this.children(p);
            const n = counts.get(p) || 0;
            const open = p === '' || !this.collapsed.has(p);
            let inside = 0;
            for (const [d, c] of counts) if (d !== p && this.within(d, p)) inside += c;
            const title = `${this.label(p)}: ${n} photo${n === 1 ? '' : 's'} here` +
                (inside ? ` · ${(n + inside).toLocaleString()} including subfolders` : '');
            const caret = kids.length && p !== ''
                ? `<button class="fr-caret${open ? ' open' : ''}" title="${open ? 'Fold' : 'Unfold'}" tabindex="-1"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
                : '<span class="fr-caret fr-spacer"></span>';
            rows.push(`<div class="fr-row${this.scope === p ? ' active' : ''}${n ? '' : ' empty'}${p === '' ? ' fr-root' : ''}" ` +
                `data-folder-path="${esc(p)}" style="--depth:${depth}" title="${esc(title)}">` +
                caret + this.folderIcon('fr-icon') +
                `<span class="fr-name">${esc(this.nameOf(p))}</span><span class="fr-count">${n ? n.toLocaleString() : ''}</span></div>`);
            if (open) kids.forEach(k => walk(k, depth + 1));
        };
        if (this.map.has('')) walk('', 0);
        tree.innerHTML = rows.join('');
        this.el('fr-hint').classList.toggle('hidden', this.hasSubfolders());
        const active = tree.querySelector('.fr-row.active');
        if (active && (active.offsetTop < tree.scrollTop || active.offsetTop > tree.scrollTop + tree.clientHeight - 30)) {
            tree.scrollTop = active.offsetTop - tree.clientHeight / 2;
        }
    },

    initBar() {
        this.el('fb-rail').addEventListener('click', () => this.toggleRail());
        this.el('fb-all').addEventListener('click', () => this.setScope(null));
        this.el('fb-folders').addEventListener('click', () => {
            if (this.scope === null) this.setScope(this.map.has(this.lastScope) ? this.lastScope : '');
        });
        this.el('fb-crumbs').addEventListener('click', (e) => {
            const b = e.target.closest('[data-folder-path]');
            if (b) this.setScope(b.dataset.folderPath);
        });
    },

    renderBar(counts) {
        const all = this.scope === null;
        this.el('fb-all').classList.toggle('active', all);
        this.el('fb-folders').classList.toggle('active', !all);
        const rail = this.el('fb-rail');
        rail.classList.toggle('active', this.railOpen());
        rail.title = this.railOpen() ? 'Hide the folder list' : 'Show the folder list';
        const crumbs = this.el('fb-crumbs');
        crumbs.innerHTML = '';
        if (all) return;
        const parts = this.scope ? this.scope.split('/') : [];
        const paths = [''];
        parts.forEach((_, i) => paths.push(parts.slice(0, i + 1).join('/')));
        paths.forEach((p, i) => {
            if (i) {
                const sep = document.createElement('span');
                sep.className = 'fb-sep';
                sep.textContent = '›';
                crumbs.appendChild(sep);
            }
            const b = document.createElement('button');
            b.className = 'fb-crumb' + (p === this.scope ? ' current' : '');
            b.dataset.folderPath = p;
            b.textContent = this.nameOf(p);
            crumbs.appendChild(b);
        });
    },

    // Folder tiles at the start of the grid: the current folder's subfolders
    folderTiles() {
        if (!this.enabled() || this.scope === null) return [];
        const counts = this.counts();
        return this.children(this.scope).map(p => {
            const tile = document.createElement('div');
            tile.className = 'folder-tile';
            tile.dataset.folderPath = p;
            const n = counts.get(p) || 0;
            tile.title = `${this.label(p)} — ${n} photo${n === 1 ? '' : 's'}`;
            const mosaic = document.createElement('div');
            mosaic.className = 'ft-mosaic';
            const sample = [];
            for (const f of this.app.files) {
                if (this.within(this.dirOf(f), p)) sample.push(f);
                if (sample.length === 4) break;
            }
            mosaic.dataset.n = sample.length;
            if (!sample.length) mosaic.innerHTML = this.folderIcon('ft-empty');
            sample.forEach(f => {
                const img = document.createElement('img');
                img.alt = '';
                img.decoding = 'async';
                img.src = f.thumbnailUrl || this.app.BLANK_THUMB;
                const angle = this.app.getDisplayRotation(f, 'thumb');
                if (angle) img.style.transform = `rotate(${angle}deg)`;
                if (!f.thumbnailUrl) this.app.loadImageThumbnail(f, img);
                mosaic.appendChild(img);
            });
            const label = document.createElement('div');
            label.className = 'ft-label';
            label.innerHTML = this.folderIcon();
            const name = document.createElement('span');
            name.className = 'ft-name';
            name.textContent = this.baseName(p);
            const count = document.createElement('span');
            count.className = 'ft-count';
            count.textContent = n ? n.toLocaleString() : '';
            label.append(name, count);
            tile.append(mosaic, label);
            tile.onclick = () => this.setScope(p);
            return tile;
        });
    },

    // In All photos, each tile names the folder its photo is in
    addChip(tile, file) {
        if (this.scope !== null || !this.enabled() || !this.hasSubfolders()) return;
        const d = this.dirOf(file);
        if (!d) return;
        const chip = document.createElement('span');
        chip.className = 'tile-folder';
        chip.textContent = this.baseName(d);
        chip.title = this.label(d);
        tile.appendChild(chip);
    },

    // ---- Folders on disk ----

    async handleFor(path) {
        if (path === '') return this.app.dirHandle;
        const rec = this.map.get(path);
        if (rec && rec.handle) return rec.handle;
        const parent = await this.handleFor(this.parentOf(path));
        const h = await parent.getDirectoryHandle(this.baseName(path));
        this.register(path, h);
        return h;
    },

    nameProblem(name) {
        if (!name) return 'Type a name';
        if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return 'A folder name can\'t contain \\ / : * ? " < > |';
        if (name.startsWith('.')) return 'A folder name can\'t start with a dot';
        if (/[. ]$/.test(name)) return 'A folder name can\'t end with a dot or a space';
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) return `“${name}” is a name Windows reserves`;
        if (name.toLowerCase() === 'jeditor export') return '“jEditor Export” is where Export puts copies';
        if (name.length > 200) return 'That name is too long';
        return null;
    },

    // Make the folder `typed` inside `base`. `typed` may hold several
    // levels ("Wedding/Speeches"); folders that exist already are used.
    async createPath(base, typed) {
        const segs = typed.split('/').map(s => s.trim()).filter(Boolean);
        if (!segs.length) throw new Error('Type a name');
        for (const s of segs) {
            const problem = this.nameProblem(s);
            if (problem) throw new Error(problem);
        }
        let path = base;
        const created = [];
        for (const s of segs) {
            const known = this.find(this.join(path, s));
            if (known !== null) {
                path = known;
                continue;
            }
            const parent = await this.handleFor(path);
            const next = this.join(path, s);
            let h = null;
            try { h = await parent.getDirectoryHandle(s); } catch (e) { /* new */ }
            if (!h) {
                h = await parent.getDirectoryHandle(s, { create: true });
                created.push(next);
            }
            this.register(next, h);
            path = next;
        }
        return { path, created };
    },

    // Remove a folder that has nothing in it, on disk or in the app
    async removeIfEmpty(path) {
        if (!path || this.app.files.some(f => this.within(this.dirOf(f), path))) return false;
        const h = await this.handleFor(path);
        if (typeof h.values === 'function') {
            for await (const entry of h.values()) if (entry) return false;
        }
        const parent = await this.handleFor(this.parentOf(path));
        await parent.removeEntry(this.baseName(path));
        this.forget(path);
        return true;
    },

    forget(path) {
        for (const k of [...this.map.keys()]) if (k && this.within(k, path)) this.map.delete(k);
        for (const k of [...this.collapsed]) if (this.within(k, path)) this.collapsed.delete(k);
        if (this.lastDest !== null && this.within(this.lastDest, path)) this.lastDest = null;
        if (this.within(this.lastScope, path)) this.lastScope = this.parentOf(path);
        if (this.scope !== null && this.within(this.scope, path)) this.scope = this.parentOf(path);
    },

    // Where a new folder goes: inside the folder being looked at
    newFolderParent() {
        return this.scope === null ? '' : this.scope;
    },

    async newFolder(parent = this.newFolderParent()) {
        if (!this.canEdit()) return;
        const where = parent === '' ? this.rootName() : this.label(parent);
        const name = await this.prompt({
            title: 'New folder',
            hint: `In ${where}`,
            ok: 'Create',
            check: (v) => {
                const problem = this.nameProblem(v);
                if (problem) return problem;
                return this.find(this.join(parent, v)) !== null ? `“${v}” is already there` : null;
            }
        });
        if (name === null) return;
        try {
            const { path, created } = await this.createPath(parent, name);
            if (created.length) this.app.pushUndo({ type: 'folder-create', paths: created });
            this.collapsed.delete(parent);
            this.afterChange();
            this.flash(path);
            this.app.showToast(`Made “${this.baseName(path)}”`, 2000);
        } catch (e) {
            console.error('New folder failed:', e);
            this.app.showToast('Couldn\'t make the folder: ' + e.message, 4000);
        }
    },

    async renameFolder(path) {
        if (!path || !this.canEdit()) return;
        const parent = this.parentOf(path);
        const old = this.baseName(path);
        const name = await this.prompt({
            title: 'Rename folder',
            value: old,
            ok: 'Rename',
            check: (v) => {
                const problem = this.nameProblem(v);
                if (problem) return problem;
                const taken = this.find(this.join(parent, v));
                return taken !== null && taken !== path ? `“${v}” is already there` : null;
            }
        });
        if (name === null || name === old) return;
        try {
            const newPath = await this.renameDir(path, name);
            this.app.pushUndo({ type: 'folder-rename', path: newPath, name: old });
            this.afterChange();
            this.flash(newPath);
        } catch (e) {
            console.error('Folder rename failed:', e);
            this.app.showToast('Couldn\'t rename the folder: ' + e.message, 4000);
            this.afterChange();
        }
    },

    async deleteFolder(path) {
        if (!path || !this.canEdit()) return;
        if (this.app.files.some(f => this.within(this.dirOf(f), path))) {
            this.app.showToast(`“${this.baseName(path)}” still has photos in it — move them out first`, 4000);
            return;
        }
        try {
            if (!(await this.removeIfEmpty(path))) {
                this.app.showToast(`“${this.baseName(path)}” still has other files or folders in it`, 4000);
                return;
            }
            this.app.pushUndo({ type: 'folder-delete', path });
            this.afterChange();
            this.app.showToast(`Deleted the empty folder “${this.baseName(path)}”`, 2500);
        } catch (e) {
            console.error('Folder delete failed:', e);
            this.app.showToast('Couldn\'t delete the folder: ' + e.message, 4000);
        }
    },

    // Rename a folder on disk and follow it everywhere: its photos, the
    // folders inside it, the caches. Returns the new path.
    async renameDir(path, name) {
        const app = this.app;
        const parentPath = this.parentOf(path);
        const oldName = this.baseName(path);
        const newPath = this.join(parentPath, name);
        const inside = app.files.filter(f => this.within(this.dirOf(f), path));
        await Promise.all(inside.map(f => f._rotationQueue).filter(Boolean));
        const parent = await this.handleFor(parentPath);
        let h = await this.handleFor(path);
        // A case-only change goes through a temporary name, or Windows
        // would see the same folder
        const caseOnly = oldName.toLowerCase() === name.toLowerCase();
        const steps = caseOnly ? [`.jeditor-renaming-${Date.now().toString(36)}`, name] : [name];
        let cur = oldName;
        let moved = typeof h.move === 'function';
        for (const step of steps) {
            if (!moved) break;
            try {
                await h.move(parent, step);
                cur = step;
            } catch (e) {
                moved = false; // folders can't be moved here: copy instead
            }
        }
        if (!moved || cur !== name) {
            const src = await parent.getDirectoryHandle(cur);
            await this.copyTree(src, parent, name);
            await parent.removeEntry(cur, { recursive: true });
        }

        // Everything under the old path now lives under the new one
        const remap = (p) => newPath + p.slice(path.length);
        const recs = [...this.map.keys()].filter(k => k && this.within(k, path));
        recs.forEach(k => this.map.delete(k));
        recs.forEach(k => this.map.set(remap(k), { handle: null }));
        this.collapsed = new Set([...this.collapsed].map(k => this.within(k, path) ? remap(k) : k));
        if (this.scope !== null && this.within(this.scope, path)) this.scope = remap(this.scope);
        if (this.within(this.lastScope, path) && this.lastScope) this.lastScope = remap(this.lastScope);
        if (this.lastDest !== null && this.within(this.lastDest, path)) this.lastDest = remap(this.lastDest);
        // Handles of the old path can be stale: look every photo up again
        for (const f of inside) {
            const from = { rel: f.relPath, size: f.size, mtime: f.lastModified };
            const dir = remap(this.dirOf(f));
            f.relPath = this.join(dir, f.name);
            try {
                f.parentDir = await this.handleFor(dir);
                f.handle = await f.parentDir.getFileHandle(f.name);
            } catch (e) {
                console.warn('Lost track of', f.relPath, e);
            }
            this.carryCaches(from, { rel: f.relPath, size: f.size, mtime: f.lastModified }, true);
        }
        if (inside.includes(app.currentFile)) app.updateStatusBar();
        return newPath;
    },

    async copyTree(src, destParent, name) {
        const dest = await destParent.getDirectoryHandle(name, { create: true });
        const entries = [];
        for await (const e of src.values()) entries.push(e);
        for (const e of entries) {
            if (e.kind === 'directory') await this.copyTree(e, dest, e.name);
            else await this.transferFile(e, src, dest, e.name);
        }
    },

    // Move a file into another folder: a rename on disk where possible,
    // otherwise copied and the original removed. Returns its handle.
    async transferFile(handle, fromDir, toDir, name) {
        if (typeof handle.move === 'function') {
            try {
                await handle.move(toDir, name);
                return handle;
            } catch (e) {
                if (e && e.name === 'NotFoundError') throw e; // the photo is gone
            }
        }
        const data = await handle.getFile();
        const nh = await toDir.getFileHandle(name, { create: true });
        const w = await nh.createWritable();
        await w.write(data);
        await w.close();
        await fromDir.removeEntry(handle.name);
        return nh;
    },

    // Cached thumbnails and previews are filed under the photo's path:
    // bring them along so a moved photo isn't made again from the scan
    async carryCaches(from, to, removeOld) {
        const app = this.app;
        if (!from.rel || from.rel === to.rel && from.size === to.size && from.mtime === to.mtime) return;
        try {
            if (from.size > app.THUMB_FAST_PATH_BYTES) {
                const oldKey = `${from.rel}|${from.size}|${from.mtime}`;
                const blob = await app.idbGetThumb(oldKey) || await FolderCache.getThumb(app, oldKey);
                if (blob) {
                    const newKey = `${to.rel}|${to.size}|${to.mtime}`;
                    app.idbPutThumb(newKey, blob);
                    FolderCache.putThumb(app, newKey, blob);
                    if (removeOld) app.idbDelete('thumbs', oldKey);
                }
            }
            const edge = app.previewEdge();
            const oldP = `p|${from.rel}|${from.size}|${from.mtime}|${edge}`;
            const rec = await app.idbGet('previews', oldP);
            if (rec) {
                app.idbPutPreview(`p|${to.rel}|${to.size}|${to.mtime}|${edge}`, rec);
                if (removeOld) app.idbDelete('previews', oldP);
            }
        } catch (e) { /* caches are best-effort */ }
    },

    async settle(f) {
        if (f._rotationQueue) await f._rotationQueue;
        while (f.isBusy) await new Promise(r => setTimeout(r, 30));
    },

    async moveOne(f, destDir, dest, name) {
        await this.settle(f);
        const from = { rel: f.relPath || f.name, size: f.size, mtime: f.lastModified };
        f.handle = await this.transferFile(f.handle, f.parentDir || this.app.dirHandle, destDir, name);
        f.name = name;
        f.parentDir = destDir;
        f.relPath = this.join(dest, name);
        try {
            const d = await f.handle.getFile();
            f.size = d.size;
            f.lastModified = d.lastModified;
        } catch (e) { /* keep the old numbers */ }
        this.carryCaches(from, { rel: f.relPath, size: f.size, mtime: f.lastModified }, true);
    },

    async copyOne(f, destDir, dest, name) {
        await this.settle(f);
        const data = await f.handle.getFile();
        const nh = await destDir.getFileHandle(name, { create: true });
        const w = await nh.createWritable();
        await w.write(data);
        await w.close();
        const nd = await nh.getFile();
        const copy = {
            name,
            relPath: this.join(dest, name),
            parentDir: destDir,
            handle: nh,
            size: nd.size,
            lastModified: nd.lastModified
        };
        if (f.dateTaken !== undefined) copy.dateTaken = f.dateTaken;
        // Same bytes, same thumbnail
        if (f.thumbnailUrl) {
            try {
                copy.thumbnailUrl = URL.createObjectURL(await (await fetch(f.thumbnailUrl)).blob());
                copy.thumbLag = f.thumbLag || 0;
            } catch (e) { /* made when needed */ }
        }
        this.carryCaches({ rel: f.relPath || f.name, size: f.size, mtime: f.lastModified },
            { rel: copy.relPath, size: copy.size, mtime: copy.lastModified }, false);
        return copy;
    },

    // "IMG_0042.jpg" → "IMG_0042 (2).jpg", the first one that's free
    freeName(name, taken) {
        const m = name.match(/^(.*?)(\.[^.]*)?$/);
        const base = m[1].replace(/ \(\d+\)$/, '');
        const ext = m[2] || '';
        for (let i = 2; ; i++) {
            const cand = `${base} (${i})${ext}`;
            if (!taken.has(cand.toLowerCase())) return cand;
        }
    },

    async pool(items, fn) {
        let next = 0;
        const worker = async () => {
            while (next < items.length) {
                const i = next++;
                await fn(items[i], i);
            }
        };
        await Promise.all(Array.from({ length: Math.min(this.CONCURRENCY, items.length) }, worker));
    },

    // Move (or copy) photos into the folder `dest`. Returns the undo entry,
    // or null when nothing changed.
    async relocate(files, dest, { copy = false, created = [] } = {}) {
        const app = this.app;
        if (!this.canEdit()) return null;
        let list = [...new Set(files.filter(Boolean))];
        const total = list.length;
        if (!copy) list = list.filter(f => this.dirOf(f) !== dest);
        if (!list.length) {
            if (total) app.showToast(total === 1 ? `It's already in ${this.nameOf(dest)}` : `They're already in ${this.nameOf(dest)}`);
            return null;
        }
        let destDir;
        try {
            if (typeof app.dirHandle.queryPermission === 'function' && !(await app.verifyPermission(app.dirHandle, true))) {
                app.showToast('jEditor needs permission to change this folder');
                return null;
            }
            destDir = await this.handleFor(dest);
        } catch (e) {
            console.error('Folder unavailable:', e);
            app.showToast('Couldn\'t open the folder: ' + e.message, 4000);
            return null;
        }

        // Plan first: every name clash is answered before anything moves
        const onDisk = new Set();
        try {
            if (typeof destDir.values === 'function') {
                for await (const e of destDir.values()) onDisk.add(e.name.toLowerCase());
            }
        } catch (e) { /* treat as empty */ }
        const there = new Map(app.files.filter(f => this.dirOf(f) === dest).map(f => [f.name.toLowerCase(), f]));
        for (const k of there.keys()) onDisk.add(k);
        const batch = new Set(list);
        const taken = new Set(onDisk);
        const claimed = new Set(); // names the batch itself takes
        let clashes = 0;
        {
            const seen = new Set(onDisk);
            for (const f of list) {
                const k = f.name.toLowerCase();
                if (seen.has(k)) clashes++;
                seen.add(k);
            }
        }
        const plan = [], replace = [];
        let always = null, asked = 0, skipped = 0;
        for (const f of list) {
            const k = f.name.toLowerCase();
            if (!taken.has(k)) {
                taken.add(k);
                claimed.add(k);
                plan.push({ f, name: f.name });
                continue;
            }
            asked++;
            const existing = there.get(k);
            const canReplace = !claimed.has(k) && !!existing && existing !== f && !batch.has(existing);
            let choice = always;
            if (!choice || (choice === 'replace' && !canReplace)) {
                const answer = await this.askClash({ file: f, existing: claimed.has(k) ? null : existing, dest, copy, canReplace, rest: clashes - asked, keepName: this.freeName(f.name, taken) });
                if (!answer) return null; // cancelled: nothing has changed
                choice = answer.choice;
                if (answer.all) always = choice;
            }
            if (choice === 'skip') {
                skipped++;
            } else if (choice === 'replace' && canReplace) {
                replace.push(existing);
                claimed.add(k);
                plan.push({ f, name: f.name, replaces: existing });
            } else {
                const name = this.freeName(f.name, taken);
                taken.add(name.toLowerCase());
                claimed.add(name.toLowerCase());
                plan.push({ f, name });
            }
        }
        if (!plan.length) {
            app.showToast(`Nothing ${copy ? 'copied' : 'moved'} — ${skipped} skipped`);
            return null;
        }

        const prevView = app.viewFiles();
        const prevCur = app.currentFile;
        const verb = copy ? 'Copying' : 'Moving';
        const many = plan.length > 1;
        if (many) app.beginTask('relocate', `${verb} 0/${plan.length}`);
        const items = [], copies = [];
        let trash = [], failed = 0, done = 0;
        try {
            // Replaced photos go to the trash first, freeing their names
            if (replace.length) {
                trash = await this.trashQuietly(replace);
                const out = new Set(replace.filter(f => !trash.some(t => t.file === f)));
                for (const p of plan) {
                    if (p.replaces && out.has(p.replaces)) { p.skip = true; failed++; }
                }
            }
            await this.pool(plan.filter(p => !p.skip), async (p) => {
                try {
                    if (copy) {
                        const c = await this.copyOne(p.f, destDir, dest, p.name);
                        copies.push(c);
                        items.push({ file: c });
                    } else {
                        const fromDir = this.dirOf(p.f), fromName = p.f.name;
                        await this.moveOne(p.f, destDir, dest, p.name);
                        items.push({ file: p.f, fromDir, fromName });
                    }
                } catch (e) {
                    console.error(`${verb} failed for`, p.f.name, e);
                    failed++;
                }
                done++;
                if (many && (done % 10 === 0 || done === plan.length)) app.updateTask('relocate', `${verb} ${done}/${plan.length}`);
            });
        } finally {
            if (many) app.endTask('relocate');
        }
        if (copies.length) app.files.push(...copies);

        let entry = null;
        if (items.length || trash.length || created.length) {
            entry = { type: 'relocate', copy, dest, items, trash, created };
            app.pushUndo(entry);
        }
        this.lastDest = dest;
        if (copies.length) app.sortFiles(false);
        this.afterChange(prevView, prevCur);

        const n = items.length;
        let msg = `${copy ? 'Copied' : 'Moved'} ${n} photo${n === 1 ? '' : 's'} to ${this.nameOf(dest)}`;
        const notes = [];
        if (trash.length) notes.push(`${trash.length} replaced (old ones in the trash)`);
        if (skipped) notes.push(`${skipped} skipped`);
        if (notes.length) msg += ` — ${notes.join(', ')}`;
        if (n) {
            entry.toast = `relocate-${Date.now()}`;
            app.showToast(msg, 5000, entry.toast, {
                label: 'Undo',
                run: () => {
                    const stack = app._undoStack || [];
                    if (stack[stack.length - 1] === entry) app.undo();
                    else app.showToast('Something else changed since — use Ctrl+Z');
                }
            });
        }
        if (failed) app.showToast(`Couldn't ${copy ? 'copy' : 'move'} ${failed} photo${failed === 1 ? '' : 's'}`, 4000);
        return entry;
    },

    // Photos into .jeditor/trash without an undo step of their own (the
    // move that replaced them undoes them)
    async trashQuietly(files) {
        const app = this.app;
        const trashDir = await FolderCache.trashDir(app);
        const taken = new Set();
        try { for await (const e of trashDir.values()) taken.add(e.name.toLowerCase()); } catch (e) { /* empty */ }
        const stamp = Date.now();
        const items = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            try {
                await this.settle(f);
                let trashName = f.name;
                if (taken.has(trashName.toLowerCase())) trashName = `${stamp}_r${i}_${f.name}`;
                taken.add(trashName.toLowerCase());
                await app.trashOne(f, trashDir, trashName);
                items.push({ file: f, trashDir, trashName });
            } catch (e) {
                console.error('Trash failed for', f.name, e);
            }
        }
        app.removeFilesFromApp(items.map(it => it.file));
        return items;
    },

    async undo(entry) {
        const app = this.app;
        if (entry.type === 'relocate') {
            // Its "Undo" toast is spent
            const toast = entry.toast && document.querySelector(`.toast[data-key="${entry.toast}"]`);
            if (toast) toast.remove();
            const prevView = app.viewFiles(), prevCur = app.currentFile;
            let failed = 0;
            if (entry.copy) {
                const gone = [];
                for (const it of entry.items) {
                    try {
                        await this.settle(it.file);
                        await (it.file.parentDir || app.dirHandle).removeEntry(it.file.name);
                        gone.push(it.file);
                    } catch (e) {
                        console.error('Undo copy failed for', it.file.name, e);
                        failed++;
                    }
                }
                app.removeFilesFromApp(gone);
            } else {
                await this.pool(entry.items, async (it) => {
                    try {
                        const dir = await this.handleFor(it.fromDir);
                        await this.moveOne(it.file, dir, it.fromDir, it.fromName);
                    } catch (e) {
                        console.error('Undo move failed for', it.file.name, e);
                        failed++;
                    }
                });
            }
            if (entry.trash && entry.trash.length) await app.restoreManyFromTrash(entry.trash);
            for (const p of [...(entry.created || [])].reverse()) {
                try { await this.removeIfEmpty(p); } catch (e) { /* keep it */ }
            }
            app.sortFiles(false);
            this.afterChange(prevView, prevCur);
            if (failed) throw new Error(`${failed} photo${failed === 1 ? '' : 's'} could not be put back`);
            const n = entry.items.length;
            app.showToast(entry.copy
                ? `Removed ${n} cop${n === 1 ? 'y' : 'ies'}`
                : `Put ${n} photo${n === 1 ? '' : 's'} back`);
        } else if (entry.type === 'folder-create') {
            let kept = 0;
            for (const p of [...entry.paths].reverse()) {
                try { if (!(await this.removeIfEmpty(p))) kept++; } catch (e) { kept++; }
            }
            this.afterChange();
            app.showToast(kept ? 'The new folder has things in it now, so it was kept' : 'Removed the new folder');
        } else if (entry.type === 'folder-rename') {
            await this.renameDir(entry.path, entry.name);
            this.afterChange();
            app.showToast('Folder name put back');
        } else if (entry.type === 'folder-delete') {
            await this.createPath('', entry.path);
            this.afterChange();
            app.showToast(`Folder “${this.baseName(entry.path)}” is back`);
        }
    },

    // After photos or folders changed: redraw, keeping the current photo
    // (or the nearest one) and the scroll position
    afterChange(prevView = null, prevCur = null) {
        const app = this.app;
        if (this.scope !== null && !this.map.has(this.scope)) this.scope = '';
        const view = app.viewFiles();
        const inView = new Set(view);
        // Nothing out of sight stays selected: Delete must never hit
        // photos you can't see
        for (const f of [...app.selection]) if (!inView.has(f)) app.selection.delete(f);
        let cur = app.currentFile;
        if (!cur || !inView.has(cur)) {
            cur = null;
            const list = prevView || [];
            const i = list.indexOf(prevCur || app.currentFile);
            for (let j = i + 1; j < list.length && !cur && i !== -1; j++) if (inView.has(list[j])) cur = list[j];
            for (let j = i - 1; j >= 0 && !cur; j--) if (inView.has(list[j])) cur = list[j];
            if (!cur) cur = view[0] || null;
        }
        const grid = app.elements.gridView;
        const top = grid.scrollTop;
        app.renderThumbnails();
        app.renderGrid({ sync: true });
        grid.scrollTop = top;
        if (cur) {
            if (app.viewMode === 'single' && cur !== app.currentFile) app.loadFile(cur);
            else app.setCurrent(cur);
        } else if (app.viewMode === 'single') {
            app.setView('grid');
        } else {
            this.showEmptyHeader();
        }
        app.updateSelectionUI();
    },

    flash(path) {
        requestAnimationFrame(() => {
            document.querySelectorAll(`[data-folder-path="${CSS.escape(path)}"]`).forEach(el => {
                el.classList.remove('flash');
                void el.offsetWidth;
                el.classList.add('flash');
            });
        });
    },

    // ---- Menus ----

    contextItems(path) {
        const app = this.app;
        const sel = [...app.selection].filter(f => this.inView(f));
        const items = [['Open', () => this.setScope(path)]];
        if (sel.length) {
            const here = sel.every(f => this.dirOf(f) === path);
            items.push(['—']);
            if (!here) items.push([`Move ${sel.length === 1 ? 'Photo' : sel.length + ' Photos'} Here`, () => this.relocate(sel, path)]);
            items.push([`Copy ${sel.length === 1 ? 'Photo' : sel.length + ' Photos'} Here`, () => this.relocate(sel, path, { copy: true })]);
        }
        items.push(['—'], ['New Folder Inside…', () => this.newFolder(path)]);
        if (path) {
            items.push(['Rename Folder…', () => this.renameFolder(path)]);
            const empty = !app.files.some(f => this.within(this.dirOf(f), path)) && !this.children(path).length;
            if (empty) items.push(['—'], ['Delete Folder', () => this.deleteFolder(path), true]);
        }
        return items;
    },

    // The photos a Move to… / Copy to… acts on
    targets() {
        const app = this.app;
        if (app.viewMode === 'grid' && app.selection.size) return [...app.selection];
        return app.currentFile && this.inView(app.currentFile) ? [app.currentFile] : [];
    },

    // ---- Move to… picker ----

    // Hide a dialog and let go of the keyboard: focus left on a hidden
    // input would swallow the next shortcut
    hideModal(id) {
        const panel = this.el(id);
        panel.classList.add('hidden');
        if (panel.contains(document.activeElement)) document.activeElement.blur();
    },

    isModalOpen() {
        return ['folder-picker', 'folder-clash', 'folder-prompt'].some(id => !this.el(id).classList.contains('hidden'));
    },

    initPicker() {
        const panel = this.el('folder-picker');
        const input = this.el('fp-filter');
        input.addEventListener('input', () => { this.pickerHi = 0; this.renderPicker(true); });
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.closePicker(); });
        this.el('fp-close').addEventListener('click', () => this.closePicker());
        panel.querySelectorAll('.fp-mode button').forEach(b => b.addEventListener('click', () => {
            this.pickerMode = b.dataset.mode;
            this.renderPicker();
            input.focus();
        }));
        this.el('fp-list').addEventListener('click', (e) => {
            const row = e.target.closest('.fp-row');
            if (!row || row.classList.contains('disabled')) return;
            this.choose(this.pickerItems[+row.dataset.i]);
        });
        panel.addEventListener('keydown', (e) => {
            const items = this.pickerItems || [];
            const move = (d) => {
                if (!items.some(it => !it.disabled)) return;
                let i = this.pickerHi;
                do { i = (i + d + items.length) % items.length; } while (items[i].disabled);
                this.pickerHi = i;
                this.renderPicker();
            };
            if (e.key === 'Escape') { e.preventDefault(); this.closePicker(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                const it = items[this.pickerHi];
                if (it && !it.disabled) this.choose(it);
            }
            e.stopPropagation();
        });
    },

    openPicker(files, mode = 'move') {
        if (!this.canEdit()) return;
        files = files.filter(Boolean);
        if (!files.length) {
            this.app.showToast('Select some photos first');
            return;
        }
        this.pickerFiles = files;
        this.pickerMode = mode;
        this.pickerHi = -1;
        const input = this.el('fp-filter');
        input.value = '';
        this.el('folder-picker').classList.remove('hidden');
        this.renderPicker(true);
        input.focus();
    },

    closePicker() {
        this.hideModal('folder-picker');
        this.pickerFiles = null;
    },

    pickerList() {
        const q = this.el('fp-filter').value.trim();
        const ql = q.toLowerCase().replace(/\s*\/\s*/g, '/');
        const copy = this.pickerMode === 'copy';
        const from = new Set(this.pickerFiles.map(f => this.dirOf(f)));
        const counts = this.counts();
        let folders = this.ordered().map(p => ({
            kind: 'folder', path: p,
            depth: p ? p.split('/').length : 0,
            count: counts.get(p) || 0,
            current: from.size === 1 && from.has(p),
            disabled: !copy && from.size === 1 && from.has(p)
        }));
        const items = [];
        if (ql) {
            const score = (p) => {
                const name = this.nameOf(p).toLowerCase(), path = p.toLowerCase();
                if (name === ql || path === ql) return 0;
                if (name.startsWith(ql)) return 1;
                if (path.startsWith(ql)) return 2;
                if (name.includes(ql) || path.includes(ql)) return 3;
                return -1;
            };
            folders = folders.map(f => ({ ...f, score: score(f.path) })).filter(f => f.score >= 0)
                .sort((a, b) => a.score - b.score);
            folders.forEach(f => { f.depth = 0; f.flat = true; });
            // Offer to make it, unless that folder exists already
            const bases = this.scope ? [this.scope, ''] : [''];
            for (const base of bases) {
                const typed = q.split('/').map(s => s.trim()).filter(Boolean).join('/');
                if (!typed || this.find(this.join(base, typed)) !== null) continue;
                const problem = typed.split('/').map(s => this.nameProblem(s)).find(Boolean) || null;
                items.push({ kind: 'create', parent: base, name: typed, problem, disabled: !!problem });
            }
        }
        return items.concat(folders);
    },

    renderPicker(resetHi = false) {
        const n = this.pickerFiles.length;
        const copy = this.pickerMode === 'copy';
        this.el('fp-title').textContent = `${copy ? 'Copy' : 'Move'} ${n === 1 ? `“${this.pickerFiles[0].name}”` : `${n} photos`} to…`;
        this.el('folder-picker').querySelectorAll('.fp-mode button').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === this.pickerMode));
        this.el('fp-foot').textContent = `↑↓ choose · Enter ${copy ? 'copies' : 'moves'} · type a new name to make a folder (“Wedding/Speeches” makes one inside another)`;
        const items = this.pickerList();
        this.pickerItems = items;
        if (resetHi || this.pickerHi < 0 || this.pickerHi >= items.length || (items[this.pickerHi] && items[this.pickerHi].disabled)) {
            let hi = -1;
            const q = this.el('fp-filter').value.trim();
            if (!q && this.lastDest !== null) hi = items.findIndex(it => it.kind === 'folder' && it.path === this.lastDest && !it.disabled);
            if (hi === -1 && q) {
                // A typed name that matches a folder exactly picks it;
                // otherwise making the new folder comes first
                hi = items.findIndex(it => it.kind === 'folder' && it.score === 0 && !it.disabled);
            }
            if (hi === -1) hi = items.findIndex(it => !it.disabled);
            this.pickerHi = hi;
        }
        const list = this.el('fp-list');
        list.innerHTML = '';
        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'fp-empty';
            empty.textContent = 'No folders match';
            list.appendChild(empty);
            return;
        }
        items.forEach((it, i) => {
            const row = document.createElement('div');
            row.className = 'fp-row' + (i === this.pickerHi ? ' hi' : '') + (it.disabled ? ' disabled' : '') + (it.kind === 'create' ? ' create' : '');
            row.dataset.i = i;
            row.setAttribute('role', 'option');
            row.style.setProperty('--depth', it.depth || 0);
            if (it.kind === 'create') {
                const where = it.parent === '' ? this.rootName() : this.nameOf(it.parent);
                row.innerHTML = `<span class="fp-plus">+</span><span class="fp-name"></span><span class="fp-meta"></span>`;
                row.querySelector('.fp-name').textContent = `New folder “${it.name.split('/').join(' / ')}”`;
                row.querySelector('.fp-meta').textContent = it.problem || `in ${where}`;
            } else {
                row.innerHTML = this.folderIcon('fp-icon') + '<span class="fp-name"></span><span class="fp-meta"></span>';
                row.querySelector('.fp-name').textContent = it.flat ? this.label(it.path) : this.nameOf(it.path);
                row.querySelector('.fp-meta').textContent = it.current ? 'here now' : (it.count ? it.count.toLocaleString() : '');
            }
            list.appendChild(row);
        });
        const hiEl = list.querySelector('.fp-row.hi');
        if (hiEl) hiEl.scrollIntoView({ block: 'nearest' });
    },

    async choose(item) {
        const files = this.pickerFiles;
        const copy = this.pickerMode === 'copy';
        if (!files) return;
        let dest = item.path, created = [];
        if (item.kind === 'create') {
            try {
                ({ path: dest, created } = await this.createPath(item.parent, item.name));
            } catch (e) {
                this.app.showToast('Couldn\'t make the folder: ' + e.message, 4000);
                return;
            }
        }
        this.closePicker();
        const entry = await this.relocate(files, dest, { copy, created });
        if (!entry && created.length) {
            // Nothing moved, but the folder was asked for: keep it
            this.app.pushUndo({ type: 'folder-create', paths: created });
            this.afterChange();
        }
        if (created.length) this.flash(dest);
    },

    // ---- Name clash ----

    initClash() {
        const panel = this.el('folder-clash');
        const answer = (choice) => {
            const resolve = this._clashResolve;
            this._clashResolve = null;
            this.hideModal('folder-clash');
            if (resolve) resolve(choice ? { choice, all: this.el('fc-all').checked } : null);
        };
        this.el('fc-keep').addEventListener('click', () => answer('keep'));
        this.el('fc-skip').addEventListener('click', () => answer('skip'));
        this.el('fc-replace').addEventListener('click', () => answer('replace'));
        this.el('fc-cancel').addEventListener('click', () => answer(null));
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); answer(null); }
            else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); answer('keep'); }
            e.stopPropagation();
        });
    },

    askClash({ file, existing, dest, copy, canReplace, rest, keepName }) {
        const fmt = (f) => {
            const parts = [this.app.formatBytes(f.size)];
            if (f.lastModified) parts.push(new Date(f.lastModified).toLocaleDateString());
            return parts.join(' · ');
        };
        this.el('fc-title').textContent = `“${file.name}” is already in ${this.nameOf(dest)}`;
        const setImg = (img, f) => {
            img.src = (f && f.thumbnailUrl) || this.app.BLANK_THUMB;
            const angle = f ? this.app.getDisplayRotation(f, 'thumb') : 0;
            img.style.transform = angle ? `rotate(${angle}deg)` : '';
        };
        setImg(this.el('fc-new-img'), file);
        this.el('fc-new-cap').textContent = `${copy ? 'Copying' : 'Moving'} · ${fmt(file)}`;
        const old = this.el('fc-old');
        old.classList.toggle('hidden', !existing);
        if (existing) {
            setImg(this.el('fc-old-img'), existing);
            this.el('fc-old-cap').textContent = `Already there · ${fmt(existing)}`;
        }
        this.el('fc-keep').title = `The ${copy ? 'copy' : 'moved photo'} is named “${keepName}”`;
        this.el('fc-keep-note').textContent = `as “${keepName}”`;
        const replace = this.el('fc-replace');
        replace.classList.toggle('hidden', !canReplace);
        replace.title = 'The photo that\'s there now goes to the trash (Ctrl+Z brings it back)';
        this.el('fc-all').checked = false;
        this.el('fc-all-row').classList.toggle('hidden', !(rest > 0));
        this.el('fc-rest').textContent = rest === 1 ? 'the 1 other name clash' : `the ${rest} other name clashes`;
        this.el('folder-clash').classList.remove('hidden');
        this.el('fc-keep').focus();
        return new Promise(resolve => { this._clashResolve = resolve; });
    },

    // ---- Name prompt (new folder, rename folder) ----

    initPrompt() {
        const panel = this.el('folder-prompt');
        const input = this.el('fpr-input');
        const done = (ok) => {
            const v = input.value.trim();
            if (ok && this._promptCheck) {
                const problem = this._promptCheck(v);
                if (problem) {
                    this.el('fpr-error').textContent = problem;
                    return;
                }
            }
            const resolve = this._promptResolve;
            this._promptResolve = null;
            this.hideModal('folder-prompt');
            if (resolve) resolve(ok ? v : null);
        };
        input.addEventListener('input', () => {
            const v = input.value.trim();
            const problem = v && this._promptCheck ? this._promptCheck(v) : null;
            this.el('fpr-error').textContent = problem || '';
            this.el('fpr-ok').disabled = !v || !!problem;
        });
        this.el('fpr-ok').addEventListener('click', () => done(true));
        this.el('fpr-cancel').addEventListener('click', () => done(false));
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) done(false); });
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); done(false); }
            else if (e.key === 'Enter') { e.preventDefault(); done(true); }
            e.stopPropagation();
        });
    },

    prompt({ title, value = '', hint = '', ok = 'OK', check = null }) {
        this.el('fpr-title').textContent = title;
        this.el('fpr-hint').textContent = hint;
        this.el('fpr-ok').textContent = ok;
        this.el('fpr-error').textContent = '';
        this._promptCheck = check;
        const input = this.el('fpr-input');
        input.value = value;
        this.el('fpr-ok').disabled = !value;
        this.el('folder-prompt').classList.remove('hidden');
        input.focus();
        input.select();
        return new Promise(resolve => { this._promptResolve = resolve; });
    },

    // ---- Drag & drop ----

    dragStart(e, file) {
        const app = this.app;
        if (!this.enabled() || app.readOnlyMode) {
            e.preventDefault();
            return;
        }
        if (!app.selection.has(file)) {
            app.selection = new Set([file]);
            app.setCurrent(file);
            app.updateSelectionUI();
        }
        this.dragging = [...app.selection];
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData(this.DRAG_TYPE, String(this.dragging.length));
        const ghost = this.makeGhost(this.dragging, file);
        e.dataTransfer.setDragImage(ghost, 40, 40);
        document.body.classList.add('dragging-photos');
    },

    dragEnd() {
        this.dragging = null;
        clearTimeout(this._unfoldTimer);
        this.setDropTarget(null);
        document.body.classList.remove('dragging-photos');
        const g = this.el('drag-ghost');
        if (g) g.remove();
    },

    makeGhost(files, lead) {
        let g = this.el('drag-ghost');
        if (g) g.remove();
        g = document.createElement('div');
        g.id = 'drag-ghost';
        g.className = 'drag-ghost';
        const shown = [lead, ...files.filter(f => f !== lead)].slice(0, 3).reverse();
        shown.forEach((f, i) => {
            const img = document.createElement('img');
            img.src = f.thumbnailUrl || this.app.BLANK_THUMB;
            const tilt = (shown.length - 1 - i) * 6;
            img.style.transform = `rotate(${this.app.getDisplayRotation(f, 'thumb') - tilt}deg)`;
            g.appendChild(img);
        });
        if (files.length > 1) {
            const badge = document.createElement('span');
            badge.className = 'drag-count';
            badge.textContent = files.length;
            g.appendChild(badge);
        }
        document.body.appendChild(g);
        return g;
    },

    canDropOn(path, copy) {
        if (path === undefined || !this.dragging) return false;
        if (!this.map.has(path)) return false;
        return copy || this.dragging.some(f => this.dirOf(f) !== path);
    },

    setDropTarget(el, copy = false) {
        if (this._dropEl && this._dropEl !== el) {
            this._dropEl.classList.remove('drop-target');
            delete this._dropEl.dataset.dropLabel;
        }
        this._dropEl = el;
        if (el) {
            el.classList.add('drop-target');
            const n = this.dragging.length;
            el.dataset.dropLabel = `${copy ? 'Copy' : 'Move'} ${n === 1 ? 'here' : n}`;
        }
    },

    initDrag() {
        const isCopy = (e) => e.ctrlKey || e.altKey || e.metaKey;
        // Capture phase: the page's own drag handlers stop propagation
        document.addEventListener('dragover', (e) => {
            if (!this.dragging) return;
            const copy = isCopy(e);
            const t = e.target.closest && e.target.closest('[data-folder-path]');
            const ok = !!t && this.canDropOn(t.dataset.folderPath, copy);
            this.setDropTarget(ok ? t : null, copy);
            e.preventDefault();
            e.dataTransfer.dropEffect = ok ? (copy ? 'copy' : 'move') : 'none';
            // Hovering a folded folder unfolds it
            if (ok && t.classList.contains('fr-row') && this.collapsed.has(t.dataset.folderPath)) {
                if (this._unfoldFor !== t.dataset.folderPath) {
                    clearTimeout(this._unfoldTimer);
                    this._unfoldFor = t.dataset.folderPath;
                    this._unfoldTimer = setTimeout(() => {
                        this.collapsed.delete(this._unfoldFor);
                        this.render();
                    }, 700);
                }
            } else {
                clearTimeout(this._unfoldTimer);
                this._unfoldFor = null;
            }
        }, true);
        // Capture phase too: before the page's open-a-dropped-folder handler
        document.addEventListener('drop', (e) => {
            if (!this.dragging) return;
            e.preventDefault();
            e.stopPropagation();
            const files = this.dragging;
            const copy = isCopy(e);
            const t = e.target.closest && e.target.closest('[data-folder-path]');
            const path = t && t.dataset.folderPath;
            const ok = !!t && this.canDropOn(path, copy);
            this.dragEnd();
            if (ok) this.relocate(files, path, { copy });
        }, true);
        document.addEventListener('dragend', () => { if (this.dragging) this.dragEnd(); });
    }
};
