// The projects folder and the cache folder, and moving what's in them
// (Settings → Projects → Folders; the sidebar's "Choose your projects
// folder…" comes here too).
//
// When either folder changes, jEditor asks whether to move what's there
// or leave it, saying how many folders and how much. Free space is
// checked first; if there isn't enough it says so with the numbers and
// moves nothing. The app moves each item on its own (src/FolderMove.cs,
// mac/move.js): renamed on the same drive, else copied, read back and
// compared, and only then is the original removed. A move that fails
// partway stops there with the rest where it was, so no project is lost.
//
//   folderMove   moving the projects folder (the Windows, Mac and Linux apps)
//   cacheFolder  choosing where the cache is kept (the Windows app; the Mac
//                and Linux apps keep it in their own private storage)
//
// The cache (thumbnails, kept for each project) has its size and Clear
// cache in every app. Clearing it leaves the recents on the home page as
// ghost stacks until their pictures are made again (recents.js).

const FolderMove = {
    ADVICE: 'Choose the folder that holds your photo folders. Each folder inside it shows here as a project.',
    CACHE_IN: 'jEditor cache', // the folder a chosen cache folder keeps it in (src/Shell.cs)

    el(id) { return document.getElementById(id); },
    native() { return FolderCache.native(); },
    sep(p) { return String(p || '').includes('\\') ? '\\' : '/'; },
    // "48.2 GB", "640 MB"
    bytes(n) { return n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : this.app ? this.app.formatBytes(n) : `${n} bytes`; },

    init(app) {
        this.app = app;
        const on = (id, fn) => { const b = this.el(id); if (b) b.addEventListener('click', fn); };
        on('set-projects-change', () => this.changeProjects());
        on('set-cache-change', () => this.changeCache());
        on('set-cache-clear', () => this.clearCache());
    },

    // Settings → Projects is drawn (script.js): where each folder is, and
    // how big the cache is
    async draw() {
        const box = this.el('set-folders');
        if (!box || !this.native()) return;
        const dir = typeof Places !== 'undefined' ? Places.projectsDir() : null;
        const where = this.el('set-projects-where');
        if (where) where.textContent = dir || 'Not chosen yet';
        const cache = this.el('set-cache-where');
        if (cache && Host.has('cacheFolder')) {
            const c = await this.native().cacheDir().catch(() => null);
            cache.textContent = c ? c.path : '';
        }
        const size = this.el('set-cache-size');
        if (size) {
            size.textContent = 'Cache: measuring…';
            const n = await this.cacheBytes();
            size.textContent = `Cache: ${this.bytes(n)}`;
            const clear = this.el('set-cache-clear');
            if (clear) clear.disabled = !n && !(await this.recentPictures());
        }
    },

    // ---- The projects folder ----

    async changeProjects() {
        const native = this.native();
        if (!native) return;
        const from = Places.projectsDir();
        const to = await native.pickPath('Choose your projects folder', from);
        if (!to || (from && Places.key(to) === Places.key(from))) return;
        if (!from || !Host.has('folderMove')) return this.useProjects(to);
        const r = await this.move({ from, to, what: 'projects', title: 'projects folder' });
        if (r === 'cancel') return;
        if (r === 'kept') return; // nothing moved: it stays where it was
        await this.useProjects(to);
    },

    async useProjects(path) {
        await Places.setProjectsDir(path);
        this.draw();
        if (typeof OpenCard !== 'undefined') OpenCard.refresh();
    },

    // ---- The cache folder ----

    async changeCache() {
        const native = this.native();
        if (!native || !Host.has('cacheFolder')) return;
        const cur = await native.cacheDir().catch(() => null);
        if (!cur) return;
        const chosen = await native.pickPath('Choose where jEditor keeps its cache', null);
        if (!chosen) return;
        const to = chosen.replace(/[\\/]+$/, '') + this.sep(chosen) + this.CACHE_IN;
        if (to.toLowerCase() === String(cur.path).toLowerCase()) return;
        await FolderCache.flush();
        const r = await this.move({ from: cur.path, to, what: 'cache', title: 'cache' });
        if (r === 'cancel' || r === 'kept') return;
        try {
            await native.setCacheDir(chosen);
        } catch (e) {
            UI.alert({ title: 'Couldn\'t use that folder for the cache', message: e.message });
            return;
        }
        // The open project's cache is found again in its new place
        FolderCache.reset();
        this.draw();
    },

    // ---- Moving, safely ----

    // { from, to, what: 'projects' | 'cache', title } → 'moved', 'left'
    // (the folder changes, what's there stays), 'kept' (nothing moved: the
    // folder stays as it was) or 'cancel'
    async move({ from, to, what, title }) {
        const native = this.native();
        let size;
        try {
            size = await native.folderSize(from, to);
        } catch (e) {
            return 'left'; // the old folder isn't there: nothing to bring
        }
        const n = what === 'projects' ? size.folders : size.folders + size.files;
        if (!n) return 'left';
        const some = what === 'projects' ? `${n.toLocaleString()} project${n === 1 ? '' : 's'}` : `the cache of ${n.toLocaleString()} project${n === 1 ? '' : 's'}`;
        const amount = this.bytes(size.bytes);
        // A whole drive or the home folder: not moved, only left
        if (size.refused) {
            const use = await UI.confirm({
                title: `Change your ${title}?`,
                message: `${size.refused}, so what's in ${from} stays there.\n\nUse ${to} from now on?`,
                ok: 'Use it'
            });
            return use ? 'left' : 'cancel';
        }
        const answer = await UI.choose({
            title: `Move what's in your ${title}?`,
            message: what === 'projects'
                ? `${some} (${amount}) are in ${from}.\n\nMove them to ${to}, or leave them where they are? Left there, they're no longer listed as projects.`
                : `${some[0].toUpperCase() + some.slice(1)} (${amount}) is in ${from}.\n\nMove it to ${to}, or leave it? Left there, thumbnails are made again as projects are opened.`,
            ok: 'Move',
            alt: 'Leave',
            cancel: 'Cancel'
        });
        if (answer === null) return 'cancel';
        if (answer === 'alt') return 'left';
        // Room, before anything starts (none needed on the same drive)
        if (!size.sameDrive && size.free >= 0 && size.free < size.bytes) {
            await UI.alert({
                title: `Not enough room on ${size.drive}`,
                message: `${what === 'projects' ? `The ${some}` : 'The cache'} need${what === 'projects' && n > 1 ? '' : 's'} ${amount}, and ${size.drive} has ${this.bytes(size.free)} free. Nothing was moved.\n\nFree up at least ${this.bytes(size.bytes - size.free)} on ${size.drive}, or choose another place.`
            });
            return 'cancel';
        }
        const ok = await UI.confirm({
            title: what === 'projects' ? `Move ${some}, ${amount}?` : `Move the cache, ${amount}?`,
            message: `From ${from} to ${to}.${size.sameDrive ? ' They\'re on the same drive, so it\'s quick and needs no room.' : size.free >= 0 ? ` ${size.drive} has ${this.bytes(size.free)} free.` : ''}`,
            items: size.sameDrive ? ['Each one is moved whole or not at all', 'If anything fails, the rest stay where they are, and nothing is lost']
                : ['Each one is copied, then checked file by file against the original', 'Only then is the original removed', 'If anything fails, the originals stay where they are, and nothing is lost'],
            ok: what === 'projects' ? `Move ${some}` : 'Move the cache'
        });
        if (!ok) return 'cancel';
        return this.run({ from, to, what, some });
    },

    async run({ from, to, what, some }) {
        const app = this.app, native = this.native();
        const key = 'folder-move';
        let job = null;
        const stop = { label: 'Stop', run: () => { if (job) native.cancelCopy(job.copyId); } };
        const label = what === 'projects' ? 'projects' : 'the cache';
        let last = -1;
        const say = (pct) => app.showToast(`Moving ${label}…${pct === null ? '' : ` ${pct}%`}`, 0, key, stop, { type: 'progress' });
        say(null);
        this.busy = true;
        let r;
        try {
            job = native.moveFolder(from, to, (done, total) => {
                const pct = total ? Math.min(100, Math.floor(done * 100 / total)) : 100;
                if (pct !== last) { last = pct; say(pct); }
            });
            r = await job;
        } catch (e) {
            r = { moved: 0, left: [], error: e.message };
        } finally {
            this.busy = false;
        }
        const taken = (r.left || []).filter(l => l.why === 'taken').map(l => l.name);
        const stuck = (r.left || []).filter(l => l.why === 'copied').map(l => l.name);
        const notes = [];
        if (taken.length) notes.push(`Left in ${from}, because the new folder has one of the same name: ${taken.join(', ')}.`);
        if (stuck.length) notes.push(`Copied and checked, but the original couldn't be removed (it's in use?), so it's in both places: ${stuck.join(', ')}.`);
        if (r.stopped || r.error) {
            app.showToast(r.stopped ? 'Stopped moving' : 'Couldn\'t finish moving', 3000, key, null, { type: r.stopped ? 'info' : 'error' });
            const head = r.moved ? `${r.moved.toLocaleString()} moved to ${to}. The rest are still in ${from}, as they were.` : `Nothing was moved: everything is still in ${from}.`;
            await UI.alert({
                title: r.stopped ? 'Stopped' : 'The move stopped partway',
                message: [r.error ? `${r.error}.` : '', head, 'Nothing was lost.'].concat(notes).filter(Boolean).join('\n\n')
            });
            // Some moved: the new folder, as asked; else as it was
            return r.moved ? 'moved' : 'kept';
        }
        app.showToast(what === 'projects' ? `Moved ${r.moved.toLocaleString()} project${r.moved === 1 ? '' : 's'} to ${to}` : 'Moved the cache', 6000, key,
            Host.has('reveal') ? { label: 'Show', run: () => native.reveal(to) } : null, { type: 'success' });
        if (notes.length) await UI.alert({ title: `Moved ${some}, but not all`, message: notes.join('\n\n') });
        return 'moved';
    },

    // ---- The cache: its size, and Clear cache ----

    // Every project's thumbnails (cache/ in each one's stored folder)
    async caches() {
        const out = [];
        try {
            const all = await this.native().dataDir();
            for await (const [name, h] of all.entries()) {
                if (h.kind !== 'directory') continue;
                const c = await h.getDirectoryHandle('cache').catch(() => null);
                if (c) out.push({ name, store: h, cache: c });
            }
        } catch (e) { /* no storage */ }
        return out;
    },

    async cacheBytes() {
        let n = 0;
        for (const c of await this.caches()) {
            const m = await FolderCache.measure(c.cache).catch(() => null);
            if (m) n += m.bytes;
        }
        return n;
    },

    async recentPictures() {
        if (typeof Recents === 'undefined' || !Recents.supported()) return 0;
        return (await Recents.list().catch(() => [])).filter(r => r.thumbs && r.thumbs.length).length;
    },

    async clearCache() {
        const bytes = await this.cacheBytes();
        const ok = await UI.confirm({
            title: 'Clear the cache?',
            message: `Frees ${this.bytes(bytes)}. Thumbnails are made again as projects are opened, so each opens a bit slower the first time. Until then the projects on the home page are ghost prints with their names.`,
            note: 'Your photos, flags and edits aren\'t touched.',
            ok: 'Clear cache'
        });
        if (!ok) return;
        await FolderCache.flush();
        let failed = 0;
        for (const c of await this.caches()) {
            try { await c.store.removeEntry('cache', { recursive: true }); } catch (e) { if (e.name !== 'NotFoundError') failed++; }
        }
        FolderCache.reset();
        if (typeof Recents !== 'undefined') await Recents.clearThumbs();
        this.app.showToast(failed ? `Cleared the cache, but ${failed} project${failed === 1 ? '\'s was' : 's\' were'} in use` : `Cleared the cache: ${this.bytes(bytes)} freed`, 4000, null, null, failed ? {} : { type: 'success' });
        this.draw();
    }
};
