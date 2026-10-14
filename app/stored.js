// Stored orders (Settings → Stored orders, in the Windows app).
//
// What jEditor keeps on this PC for each order it has opened: flags, the
// thumbnail cache, Auto crop originals, and deleted photos from drives
// without a Recycle Bin (folder-cache.js). Listed newest first with how much
// room each takes, to open an order again, or remove its cache or all of
// it. Orders whose folder is gone (moved, renamed or deleted) are marked,
// and can be removed in one go.

const Stored = {
    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        const panel = this.el('stored-panel');
        if (!panel) return;
        this.el('stored-close').addEventListener('click', () => this.close());
        this.el('stored-done').addEventListener('click', () => this.close());
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.close(); });
        panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || UI.isOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            this.close();
        });
        this.el('stored-clear-caches').addEventListener('click', () => this.removeAllCaches());
        this.el('stored-clear-missing').addEventListener('click', () => this.removeMissing());
        this.el('stored-list').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-act]');
            if (b) this.act(b.dataset.act, b.closest('li').dataset.key);
        });
    },

    isOpen() {
        const panel = this.el('stored-panel');
        return !!panel && !panel.classList.contains('hidden');
    },

    async open() {
        if (!FolderCache.native()) return;
        this.el('stored-panel').classList.remove('hidden');
        await this.refresh();
    },

    close() {
        this.el('stored-panel').classList.add('hidden');
    },

    // → [{ key, handle, path, name, openedAt, usage, flags, exists }], newest first
    async load() {
        const native = FolderCache.native();
        const all = await native.dataDir();
        const out = [];
        for await (const [key, h] of all.entries()) {
            if (h.kind !== 'directory') continue;
            const info = await this.readJson(h, 'order.json') || {};
            const flags = await this.readJson(h, Flags.FILE);
            const edits = await this.readJson(h, Edits.FILE);
            out.push({
                key, handle: h,
                path: typeof info.path === 'string' ? info.path : null,
                name: typeof info.name === 'string' ? info.name : key,
                openedAt: +info.openedAt || 0,
                usage: await FolderCache.measure(h),
                flags: flags && flags.flags ? Object.keys(flags.flags).length : 0,
                edits: edits && edits.edits ? Object.keys(edits.edits).length : 0
            });
        }
        let exists = [];
        try { exists = await native.exists(out.map(o => o.path || '')); } catch (e) { /* unknown: shown as there */ }
        out.forEach((o, i) => { o.exists = exists.length ? !!exists[i] : true; });
        return out.sort((a, b) => b.openedAt - a.openedAt);
    },

    async readJson(dir, name) {
        try {
            return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
        } catch (e) {
            return null;
        }
    },

    // The open order's key, if it has stored data
    async currentKey() {
        const path = this.app.dirHandle && await FolderCache.orderPath(this.app);
        return path ? FolderCache.storeName(path) : null;
    },

    async refresh() {
        const list = this.el('stored-list');
        const summary = this.el('stored-summary');
        list.innerHTML = '';
        summary.textContent = 'Adding up…';
        let orders;
        try {
            orders = await this.load();
        } catch (e) {
            summary.textContent = 'Couldn\'t read jEditor\'s storage: ' + e.message;
            return;
        }
        this.orders = orders;
        const current = await this.currentKey();
        const fmt = (n) => this.app.formatBytes(n);
        const total = orders.reduce((n, o) => n + o.usage.bytes, 0);
        const gone = orders.filter(o => !o.exists).length;
        summary.textContent = orders.length
            ? `${orders.length} project${orders.length === 1 ? '' : 's'} · ${fmt(total)}` + (gone ? ` · ${gone} no longer found` : '')
            : '';
        this.el('stored-clear-caches').disabled = !orders.some(o => o.usage.cache.bytes);
        this.el('stored-clear-missing').disabled = !gone;
        if (!orders.length) {
            const li = document.createElement('li');
            li.className = 'stored-empty';
            li.textContent = 'Nothing stored yet. Open a project and its flags and cache are kept here.';
            list.appendChild(li);
            return;
        }
        for (const o of orders) {
            const li = document.createElement('li');
            li.dataset.key = o.key;
            if (!o.exists) li.classList.add('stored-gone');
            const info = document.createElement('div');
            info.className = 'stored-info';
            const name = document.createElement('div');
            name.className = 'stored-name';
            name.textContent = o.name;
            if (o.key === current) {
                const tag = document.createElement('span');
                tag.className = 'stored-current';
                tag.textContent = 'Open now';
                name.appendChild(tag);
            }
            const path = document.createElement('div');
            path.className = 'stored-path';
            path.textContent = (o.path || 'Folder unknown') + (o.exists ? '' : ' — not found (moved, renamed or deleted)');
            path.title = path.textContent;
            const detail = document.createElement('div');
            detail.className = 'stored-detail';
            const u = o.usage;
            const parts = [o.openedAt ? `Opened ${Recents.when(o.openedAt).replace(/^[A-Z]/, c => c.toLowerCase())}` : null, fmt(u.bytes)];
            if (u.cache.bytes) parts.push(`cache ${fmt(u.cache.bytes)}`);
            if (o.flags) parts.push(`${o.flags} flag${o.flags === 1 ? '' : 's'}`);
            if (u.originals.n) parts.push(`${u.originals.n} Auto crop original${u.originals.n === 1 ? '' : 's'}`);
            if (u.trash.n) parts.push(`${u.trash.n} deleted photo${u.trash.n === 1 ? '' : 's'}`);
            detail.textContent = parts.filter(Boolean).join(' · ');
            info.append(name, path, detail);

            const actions = document.createElement('div');
            actions.className = 'stored-actions';
            const button = (act, label, cls, disabled, title) => {
                const b = document.createElement('button');
                b.className = 'btn ' + cls;
                b.dataset.act = act;
                b.textContent = label;
                b.disabled = disabled;
                if (title) b.title = title;
                actions.appendChild(b);
            };
            button('open', 'Open', 'ghost', !o.exists || !o.path || o.key === current, o.exists ? 'Open this project' : 'The folder isn\'t there any more');
            button('cache', 'Remove cache', 'secondary', !u.cache.bytes, 'Thumbnails and duplicate data; made again when needed');
            button('all', 'Remove all', 'secondary danger-text', false, 'Everything jEditor keeps for this project');
            li.append(info, actions);
            list.appendChild(li);
        }
    },

    async act(act, key) {
        const o = (this.orders || []).find(x => x.key === key);
        if (!o) return;
        const current = key === await this.currentKey();
        try {
            if (act === 'open') {
                this.close();
                await FolderCache.native().openPath(o.path);
                return;
            }
            if (act === 'cache') {
                await this.removeCache(o, current);
                this.app.showToast(`Removed the cache for “${o.name}”`, 2500, null, null, { type: 'success' });
            } else if (act === 'all') {
                if (!await this.confirmRemove([o])) return;
                await this.removeAll(o, current);
                this.app.showToast(`Removed everything stored for “${o.name}”`, 2500, null, null, { type: 'success' });
            }
        } catch (e) {
            this.app.showToast('Couldn\'t remove it: ' + e.message, 4000);
        }
        await this.refresh();
    },

    async removeCache(o, current) {
        if (current) await FolderCache.flush();
        try { await o.handle.removeEntry('cache', { recursive: true }); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
        if (current) FolderCache.reset();
    },

    async removeAll(o, current) {
        if (current) await FolderCache.flush();
        await (await FolderCache.native().dataDir()).removeEntry(o.key, { recursive: true });
        if (current) {
            // As Clean up does: the open order's flags and trash are gone
            FolderCache.reset();
            Flags.clearAll();
            Edits.clearAll();
            this.app._undoStack = (this.app._undoStack || []).filter(e =>
                !(e.type === 'trash' && e.items.some(it => !it.recycled)) && !['flags', 'auto-crop', 'edits', 'saved-edits'].includes(e.type));
            this.app._usage = null;
        }
    },

    // Says what will be lost for good: flags, deleted photos, originals
    confirmRemove(orders) {
        const sum = (f) => orders.reduce((n, o) => n + f(o), 0);
        const flags = sum(o => o.flags), trash = sum(o => o.usage.trash.n), originals = sum(o => o.usage.originals.n);
        const edits = sum(o => o.edits || 0);
        const items = [];
        if (edits) items.push(`${edits} edit${edits === 1 ? '' : 's'} not saved into the photos yet (kept with Save edits when done) are lost.`);
        if (flags) items.push(`${flags} flag${flags === 1 ? '' : 's'} (stars, rescan flags, color labels) are lost.`);
        if (trash) items.push(`${trash} deleted photo${trash === 1 ? '' : 's'} kept by jEditor will be gone for good.`);
        if (originals) items.push(`${originals} Auto crop original${originals === 1 ? '' : 's'} will be gone, so those crops can't be undone.`);
        items.push('The cache goes too (made again if the project is opened).');
        return UI.confirm({
            title: orders.length === 1 ? `Remove everything stored for “${orders[0].name}”?` : `Remove everything stored for ${orders.length} projects?`,
            items,
            note: 'The photos in the project folders aren\'t touched.',
            ok: 'Remove',
            danger: true
        });
    },

    async removeAllCaches() {
        const withCache = (this.orders || []).filter(o => o.usage.cache.bytes);
        if (!withCache.length) return;
        const bytes = withCache.reduce((n, o) => n + o.usage.cache.bytes, 0);
        const ok = await UI.confirm({
            title: 'Remove every project\'s cache?',
            message: `Frees ${this.app.formatBytes(bytes)}. Thumbnails are made again when a project is opened, so it opens a bit slower the first time.`,
            note: 'Flags and the photos aren\'t touched.',
            ok: 'Remove caches'
        });
        if (!ok) return;
        const current = await this.currentKey();
        let failed = 0;
        for (const o of withCache) {
            try { await this.removeCache(o, o.key === current); } catch (e) { failed++; }
        }
        this.app.showToast(failed ? `Couldn't remove ${failed} cache${failed === 1 ? '' : 's'}` : 'Removed every cache', 3000, null, null, failed ? {} : { type: 'success' });
        await this.refresh();
    },

    async removeMissing() {
        const gone = (this.orders || []).filter(o => !o.exists);
        if (!gone.length || !await this.confirmRemove(gone)) return;
        let failed = 0;
        for (const o of gone) {
            try { await this.removeAll(o, false); } catch (e) { failed++; }
        }
        this.app.showToast(failed ? `Couldn't remove ${failed}` : `Removed ${gone.length} project${gone.length === 1 ? '' : 's'} that ${gone.length === 1 ? 'is' : 'are'} gone`, 3000, null, null, failed ? {} : { type: 'success' });
        await this.refresh();
    }
};
