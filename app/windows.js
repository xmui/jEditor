// Windows (the Windows app): a project in each, side by side.
//
// New window (Ctrl+Shift+N, or Ctrl+click a project in the sidebar) opens
// another jEditor window; Split puts this one and another side by side.
// Photos dragged from one window onto a folder in the other (or the photos
// there) move into it, or are copied with Ctrl; M lists the other windows'
// folders too. The app moves the files; Ctrl+Z puts them back. Each window
// tells the app what it shows, for the others' Move to.

const Windows = {
    TYPE: 'application/x-jeditor-paths', // photos dragged out of a window: their paths
    others: [],

    native() { return FolderCache.native(); },

    init(app) {
        this.app = app;
        if (!Host.has('windows')) return;
        // Another window moved photos in or out: look again
        addEventListener('jeditor-files', () => { if (app.dirHandle) Watch.request({ full: true }); });
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
                e.preventDefault();
                this.newWindow();
            }
        });
        this.initDrop();
    },

    newWindow(path) {
        return this.native().newWindow(path || null).catch(e => this.app.showToast('Couldn\'t open a window: ' + e.message, 4000));
    },

    split() {
        return this.native().split().catch(e => this.app.showToast('Couldn\'t split: ' + e.message, 4000));
    },

    // ---- What this window shows, for the others ----

    publish() {
        if (!Host.has('windows')) return;
        clearTimeout(this._publish);
        this._publish = setTimeout(async () => {
            const app = this.app;
            const path = app.dirHandle ? await FolderCache.orderPath(app).catch(() => null) : null;
            this.native().setState({
                name: app.dirHandle ? app.dirHandle.name : null,
                path,
                folders: path ? Folders.ordered() : []
            });
        }, 300);
    },

    async refreshOthers() {
        try { this.others = await this.native().windows(); } catch (e) { this.others = []; }
        return this.others;
    },

    // ---- Paths ----

    root() {
        const app = this.app;
        return FolderCache._pathFor === app.dirHandle ? FolderCache._path : null;
    },

    join(root, rel) {
        // A drive's top folder keeps its backslash (E:\, not E:). Joined as
        // the app's paths are: "\" on Windows, "/" on a Mac
        if (!rel) return String(root);
        const sep = String(root).includes('\\') ? '\\' : '/';
        return String(root).replace(/[\\/]$/, '') + sep + rel.split('/').join(sep);
    },

    pathOf(file) {
        const root = this.root();
        return root ? this.join(root, file.relPath || file.name) : null;
    },

    // Folders.dragStart: the dragged photos' paths go with them, for a drop
    // in another window
    addDragData(e, files) {
        if (!Host.has('windows')) return;
        const paths = files.map(f => this.pathOf(f)).filter(Boolean);
        if (paths.length) e.dataTransfer.setData(this.TYPE, JSON.stringify(paths));
    },

    // ---- Photos from another window ----

    foreign(e) {
        return !Folders.dragging && this.app.dirHandle && !this.app.readOnlyMode &&
            e.dataTransfer && [...e.dataTransfer.types].includes(this.TYPE);
    },

    // A folder row or folder tile → its folder; elsewhere in the grid → the
    // folder being shown
    target(e) {
        const t = e.target.closest && e.target.closest('[data-folder-path]');
        if (t) return { el: t, folder: t.dataset.folderPath };
        if (e.target.closest && e.target.closest('#grid-view')) return { el: null, folder: Folders.scope === null ? '' : Folders.scope };
        return null;
    },

    initDrop() {
        document.addEventListener('dragover', (e) => {
            if (!this.foreign(e)) return;
            const t = this.target(e);
            const copy = e.ctrlKey || e.altKey;
            Folders.setDropTarget(t && t.el, copy);
            e.preventDefault();
            e.dataTransfer.dropEffect = t ? (copy ? 'copy' : 'move') : 'none';
        }, true);
        document.addEventListener('drop', (e) => {
            if (!this.foreign(e)) return;
            e.preventDefault();
            e.stopPropagation();
            Folders.setDropTarget(null);
            const t = this.target(e);
            let paths = [];
            try { paths = JSON.parse(e.dataTransfer.getData(this.TYPE) || '[]'); } catch (err) { /* not ours */ }
            if (t && paths.length) this.receive(paths, t.folder, e.ctrlKey || e.altKey);
        }, true);
        document.addEventListener('dragleave', (e) => {
            if (!e.relatedTarget && !Folders.dragging) Folders.setDropTarget(null);
        });
    },

    // Photos (paths, in another project) into a folder of this one
    async receive(paths, folder, copy) {
        const app = this.app;
        const root = await FolderCache.orderPath(app).catch(() => null);
        if (!root) {
            app.showToast('jEditor can\'t tell where this project is on disk', 4000);
            return;
        }
        return this.send(paths, root, folder, copy, app.dirHandle.name);
    },

    // Photos (paths) into a folder of a project (its path), from either side
    async send(paths, root, folder, copy, projectName) {
        const app = this.app;
        const dest = this.join(root, folder);
        let items;
        try {
            items = await this.native().transfer(paths, dest, copy);
        } catch (e) {
            app.showToast(`Couldn't ${copy ? 'copy' : 'move'} them: ${e.message}`, 5000);
            return;
        }
        const done = items.filter(i => i.to);
        const failed = items.filter(i => !i.to);
        const where = folder ? `${projectName} / ${folder.split('/').join(' / ')}` : projectName;
        if (done.length) app.pushUndo({ type: 'transfer', items: done.map(i => ({ from: i.from, to: i.to })), copy, where });
        if (done.length) {
            app.showToast(`${copy ? 'Copied' : 'Moved'} ${done.length} photo${done.length === 1 ? '' : 's'} into ${where} — Ctrl+Z undoes it`, 4000, null, null, { type: 'success', kind: 'move' });
        }
        if (failed.length) {
            app.showToast(`${failed.length} couldn't be ${copy ? 'copied' : 'moved'}: ${failed[0].error}`, 5000);
        }
        if (app.dirHandle) Watch.request({ full: true });
        return items;
    },

    async undo(entry) {
        const errors = await this.native().undoTransfer(entry.items, entry.copy);
        const failed = errors.filter(Boolean);
        if (this.app.dirHandle) Watch.request({ full: true });
        if (failed.length) this.app.showToast(`Couldn't undo ${failed.length}: ${failed[0]}`, 5000);
        else this.app.showToast(`Undid ${entry.copy ? 'copying' : 'moving'} ${entry.items.length} photo${entry.items.length === 1 ? '' : 's'}`, 3000, null, null, { kind: 'undo' });
    }
};
