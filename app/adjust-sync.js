// Sync, as in Lightroom: one photo's adjustments onto the rest of the
// selection, with a dialog of which groups go (Develop.SYNC). The source
// is the photo with the outline (the one clicked last), as Lightroom's
// "most selected". Masks and spot removal start unticked: they're placed
// on the source's own sky and specks. What's ticked is remembered. All
// the photos change in one step, so one Ctrl+Z undoes it.
//
// Crop: when Photos' bulk crop is in, Sync offers it too (off to start
// with) and hands it the crop, rather than having a second crop of its own.

const AdjustSync = {
    KEY: 'jeditor.syncGroups',

    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        const panel = this.el('sync-panel');
        if (!panel) return;
        this.el('sync-ok').addEventListener('click', () => this.done(true));
        this.el('sync-cancel').addEventListener('click', () => this.done(false));
        this.el('sync-all').addEventListener('click', () => this.tickAll(true));
        this.el('sync-none').addEventListener('click', () => this.tickAll(false));
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.done(false); });
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); this.done(false); }
            else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); this.done(true); }
            e.stopPropagation();
        });
        this.el('sync-groups').addEventListener('change', () => this.update());
    },

    isOpen() {
        const panel = this.el('sync-panel');
        return !!panel && !panel.classList.contains('hidden');
    },

    // Photos' bulk crop, if it's there: crop(source, files) gives
    // [{ file, edit }] with the source's crop, to set with the rest
    cropper() {
        return typeof CropBulk !== 'undefined' && typeof CropBulk.items === 'function' ? CropBulk : null;
    },

    groups() {
        const list = Develop.SYNC.map(g => ({ ...g }));
        if (this.cropper()) list.push({ id: 'crop', name: 'Crop', off: true });
        return list;
    },

    // What was ticked last time (or what's on to start with)
    ticked() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { /* none */ }
        const ids = this.groups().map(g => g.id);
        if (Array.isArray(saved)) return new Set(saved.filter(id => ids.includes(id)));
        return new Set(this.groups().filter(g => !g.off).map(g => g.id));
    },

    // Sync source's settings onto files, after the dialog
    async open(source, files) {
        const app = this.app;
        files = files.filter(f => f && f !== source && !/\.gif$/i.test(f.name));
        if (!source || !files.length) {
            app.showToast('Select the photos to sync, then the one to sync from last (Ctrl+click)', 3000);
            return;
        }
        if (!Edits.canKeep()) {
            app.showToast('Sync needs a folder opened with Open folder');
            return;
        }
        if (app.editsSaving()) return;
        const adj = (source._edit && source._edit.adj) || null;
        const has = new Set(Develop.syncGroups(adj));
        if (source._edit && !Edits.wholePhoto(source._edit)) has.add('crop');
        const n = files.length;
        this.el('sync-text').textContent = `From ${source.name} onto ${n === 1 ? files[0].name : n.toLocaleString() + ' other photos'}. ` +
            'Each photo keeps what isn\'t ticked.';
        const box = this.el('sync-groups');
        box.textContent = '';
        const on = this.ticked();
        for (const g of this.groups()) {
            const label = document.createElement('label');
            label.className = 'adj-check sync-check';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = g.id;
            input.checked = on.has(g.id);
            label.append(input, ' ' + g.name);
            // Not changed on the source: syncing it puts the others back
            if (!has.has(g.id)) {
                label.classList.add('sync-unset');
                label.title = `${source.name} has no ${g.name.toLowerCase()} of its own: ticked, the others' are taken off`;
            } else if (g.note) label.title = g.note;
            box.appendChild(label);
        }
        this.update();
        this.el('sync-panel').classList.remove('hidden');
        this.el('sync-ok').focus();
        const yes = await new Promise((resolve) => { this._resolve = resolve; });
        if (!yes) return;
        const groups = [...box.querySelectorAll('input:checked')].map(i => i.value);
        try { localStorage.setItem(this.KEY, JSON.stringify(groups)); } catch (e) { /* private mode */ }
        this.apply(source, files, groups);
    },

    update() {
        const groups = [...this.el('sync-groups').querySelectorAll('input:checked')].map(i => i.value);
        this.el('sync-ok').disabled = !groups.length;
        const notes = this.groups().filter(g => g.note && groups.includes(g.id)).map(g => g.note);
        this.el('sync-note').textContent = notes.join('. ');
    },

    tickAll(on) {
        for (const i of this.el('sync-groups').querySelectorAll('input')) i.checked = on;
        this.update();
    },

    done(yes) {
        this.el('sync-panel').classList.add('hidden');
        const r = this._resolve;
        this._resolve = null;
        if (r) r(yes);
    },

    // The settings themselves: one undo step for all of them
    apply(source, files, groups) {
        const app = this.app;
        const adj = (source._edit && source._edit.adj) || null;
        const crop = groups.includes('crop') && this.cropper();
        const cropped = new Map(crop ? crop.items(source, files).map(it => [it.file, it.edit]) : []);
        const items = files.map(f => {
            const base = cropped.has(f) ? cropped.get(f) : (f._edit || null);
            const now = (f._edit && f._edit.adj) || null;
            return { file: f, edit: Edits.withAdj(base, Develop.synced(now, adj, groups), f._edit || null) };
        });
        Edits.set(items, 'sync');
        const n = files.length;
        app.showToast(`Synced ${n === 1 ? files[0].name : n.toLocaleString() + ' photos'} with ${source.name}`, 2200, null, null, { kind: 'adjust' });
    }
};
