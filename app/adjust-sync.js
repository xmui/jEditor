// Sync, as in Lightroom: one photo's adjustments onto the rest of the
// selection, with a dialog of which groups go (Develop.SYNC). The source
// is the photo with the outline (the one clicked last), as Lightroom's
// "most selected". Masks and spot removal start unticked: they're placed
// on the source's own sky and specks. What's ticked is remembered. All
// the photos change in one step, so one Ctrl+Z undoes it.
//
// Crop: when Photos' bulk crop is in (app.cropSnapFor), Sync offers it
// too, ticked to start with, and has it fit the source's crop to each
// photo as "Crop like the last crop" does (a portrait frame turned to fit
// a landscape photo, each photo's own quarter turn kept), rather than
// having a second crop of its own. A source with no crop of its own starts
// it unticked, so syncing its colours doesn't take the others' crops off.

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

    // Photos' bulk crop, if it's there: cropSnapFor(file, snap) gives the
    // crop part of that photo's edit, the snapshot fitted to it
    cropper() {
        return this.app && typeof this.app.cropSnapFor === 'function';
    },

    groups() {
        const list = Develop.SYNC.map(g => ({ ...g }));
        if (this.cropper()) list.unshift({ id: 'crop', name: 'Crop' });
        return list;
    },

    // What was ticked last time; a group not offered then (Crop, before
    // bulk crop was in) starts as it would the first time
    ticked() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { /* none */ }
        if (Array.isArray(saved)) saved = { on: saved, seen: Develop.SYNC.map(g => g.id) };
        const on = new Set();
        for (const g of this.groups()) {
            const seen = saved && Array.isArray(saved.seen) && saved.seen.includes(g.id);
            if (seen ? saved.on.includes(g.id) : !g.off) on.add(g.id);
        }
        return on;
    },

    remember(groups) {
        try { localStorage.setItem(this.KEY, JSON.stringify({ on: groups, seen: this.groups().map(g => g.id) })); } catch (e) { /* private mode */ }
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
        // A crop box or a tilt: a quarter turn alone is each photo's own
        const cropped = !!(source._edit && !Edits.wholePhoto({ ...source._edit, q: 0 }));
        if (cropped) has.add('crop');
        const n = files.length;
        this.el('sync-text').textContent = `From ${source.name} onto ${n === 1 ? files[0].name : n.toLocaleString() + ' other photos'}. ` +
            'Each photo keeps what isn\'t ticked.';
        const box = this.el('sync-groups');
        box.textContent = '';
        const on = this.ticked();
        // Nothing to crop like: this time only, not remembered
        const keepCrop = on.has('crop');
        if (!cropped) on.delete('crop');
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
        this.remember(!cropped && keepCrop && !groups.includes('crop') ? [...groups, 'crop'] : groups);
        await this.apply(source, files, groups);
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

    // The source's crop as Crop saves it for "Crop like the last crop"
    // (with which way round it is, to turn it to fit), from Crop's own code
    async cropOf(source) {
        const { W, H } = await this.app.cropDims(source);
        const whole = { q: 0, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } };
        return CropEditor.fromSnapshot(W, H, source._edit || whole).snapshot();
    },

    // The settings themselves: one undo step for all of them
    async apply(source, files, groups) {
        const app = this.app;
        const adj = (source._edit && source._edit.adj) || null;
        const snap = groups.includes('crop') && this.cropper() ? await this.cropOf(source) : null;
        const items = [];
        for (const f of files) {
            const base = snap ? await app.cropSnapFor(f, snap) : (f._edit || null);
            const now = (f._edit && f._edit.adj) || null;
            items.push({ file: f, edit: Edits.withAdj(base, Develop.synced(now, adj, groups), f._edit || null) });
        }
        Edits.set(items, 'sync');
        const n = files.length;
        app.showToast(`Synced ${n === 1 ? files[0].name : n.toLocaleString() + ' photos'} with ${source.name}`, 2200, null, null, { kind: 'adjust' });
    }
};
