// Sync, as in Lightroom: one photo's adjustments onto the rest of the
// selection, with a dialog of which groups go (Develop.SYNC). The source
// is the photo with the outline (the one clicked last), as Lightroom's
// "most selected". Masks and spot removal start unticked: they're placed
// on the source's own sky and specks. What's ticked is remembered. All
// the photos change in one step, so one Ctrl+Z undoes it.
//
// In Adjust, the photo being adjusted is the source and the others
// selected in the strip (Ctrl+click, Shift+click) get its settings: Sync
// (Ctrl+Shift+S, or the strip's right-click menu) with the dialog, or Auto
// Sync (Ctrl+Alt+Shift+S), as in Lightroom: each setting changed goes onto
// them too, a moment after it's changed, and only that setting, so each
// keeps the rest of its own. Masks and spots stay where they're drawn. A
// chip in Adjust's head says it's on; it goes off on leaving Adjust or
// with no other photo selected. Ctrl+Z in Adjust takes the step off the
// photo, and so off the others too.
//
// Crop: when Photos' bulk crop is in (app.cropEditsLike), Sync offers it
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
        const off = this.el('adj-sync-off');
        if (off) off.addEventListener('click', () => this.toggleAuto(false));
        const panel = this.el('sync-panel');
        if (!panel) return;
        this.el('sync-ok').addEventListener('click', () => this.done(true));
        this.el('sync-cancel').addEventListener('click', () => this.done(false));
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.done(false); });
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); this.done(false); }
            else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); this.done(true); }
            e.stopPropagation();
        });
        // A section's box (or All) ticks or clears everything under it
        this.el('sync-groups').addEventListener('change', (e) => {
            const t = e.target;
            if (t.id === 'sync-every') return this.tickAll(t.checked);
            if (t.classList.contains('sync-sec-box')) {
                for (const i of t.closest('.sync-sec').querySelectorAll('.sync-item')) i.checked = t.checked;
            }
            this.update();
        });
    },

    // The dialog's sections (by Develop.SYNC's ids; one not here goes under Other)
    SECTIONS: [
        ['Light', ['light', 'presence', 'levels', 'curve']],
        ['Color', ['look', 'wb', 'mixer', 'grading', 'restore']],
        ['Detail and effects', ['detail', 'effects', 'descreen']],
        ['Geometry and retouch', ['crop', 'lens', 'spots', 'masks']]
    ],

    isOpen() {
        const panel = this.el('sync-panel');
        return !!panel && !panel.classList.contains('hidden');
    },

    // Photos' bulk crop, if it's there: cropEditsLike(source, files) gives
    // [{ file, edit }], the source's crop fitted to each (null: no crop)
    cropper() {
        return !!this.app && typeof this.app.cropEditsLike === 'function';
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
    // adj: the source's settings, if not as kept (Adjust's, being made)
    // edit: the source's crop and turn, if not as kept (Adjust's Geometry,
    // being made: before, Sync from Adjust put on the crop last saved, so
    // a crop changed there and synced again didn't go on: the owner, 23 November)
    async open(source, files, { adj, edit } = {}) {
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
        if (adj === undefined) adj = (source._edit && source._edit.adj) || null;
        if (edit === undefined) edit = source._edit || null;
        const has = new Set(Develop.syncGroups(adj));
        // A crop box or a tilt: a quarter turn alone is each photo's own
        const cropped = !!(edit && !Edits.wholePhoto({ ...edit, q: 0 }));
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
        // All, then the groups in sections, each with a box of its own, as
        // Lightroom's Synchronize Settings
        const check = (cls, text, id) => {
            const label = document.createElement('label');
            label.className = 'adj-check ' + cls;
            const input = document.createElement('input');
            input.type = 'checkbox';
            if (id) input.id = id;
            label.append(input, ' ' + text);
            return [label, input];
        };
        box.appendChild(check('sync-every-row', 'All', 'sync-every')[0]);
        const secs = new Map();
        const secFor = (id) => {
            const name = (this.SECTIONS.find(([, ids]) => ids.includes(id)) || ['Other'])[0];
            if (!secs.has(name)) {
                const sec = document.createElement('div');
                sec.className = 'sync-sec';
                const [head, input] = check('sync-head', name);
                input.className = 'sync-sec-box';
                sec.appendChild(head);
                secs.set(name, sec);
            }
            return secs.get(name);
        };
        for (const g of this.groups()) {
            const [label, input] = check('sync-check', g.name);
            input.className = 'sync-item';
            input.value = g.id;
            input.checked = on.has(g.id);
            // Not changed on the source: syncing it puts the others back
            if (!has.has(g.id)) {
                label.classList.add('sync-unset');
                label.title = `${source.name} has no ${g.name.toLowerCase()} of its own: ticked, the others' are taken off`;
            } else if (g.note) label.title = g.note;
            secFor(g.id).appendChild(label);
        }
        for (const [name] of this.SECTIONS.concat([['Other']])) if (secs.has(name)) box.appendChild(secs.get(name));
        this.update();
        this.el('sync-panel').classList.remove('hidden');
        this.el('sync-ok').focus();
        const yes = await new Promise((resolve) => { this._resolve = resolve; });
        if (!yes) return;
        // (in the groups' own order, not the sections')
        const ticked = new Set([...box.querySelectorAll('.sync-item:checked')].map(i => i.value));
        const groups = this.groups().map(g => g.id).filter(id => ticked.has(id));
        this.remember(!cropped && keepCrop && !groups.includes('crop') ? [...groups, 'crop'] : groups);
        await this.apply(source, files, groups, adj, edit);
    },

    update() {
        const box = this.el('sync-groups');
        const mark = (input, items) => {
            const n = items.filter(i => i.checked).length;
            input.checked = n > 0 && n === items.length;
            input.indeterminate = n > 0 && n < items.length;
        };
        for (const sec of box.querySelectorAll('.sync-sec')) mark(sec.querySelector('.sync-sec-box'), [...sec.querySelectorAll('.sync-item')]);
        if (this.el('sync-every')) mark(this.el('sync-every'), [...box.querySelectorAll('.sync-item')]);
        const groups = [...box.querySelectorAll('.sync-item:checked')].map(i => i.value);
        this.el('sync-ok').disabled = !groups.length;
        const notes = this.groups().filter(g => g.note && groups.includes(g.id)).map(g => g.note);
        this.el('sync-note').textContent = notes.join('. ');
    },

    tickAll(on) {
        for (const i of this.el('sync-groups').querySelectorAll('.sync-item')) i.checked = on;
        this.update();
    },

    done(yes) {
        this.el('sync-panel').classList.add('hidden');
        const r = this._resolve;
        this._resolve = null;
        if (r) r(yes);
    },

    // The settings themselves: one undo step for all of them
    async apply(source, files, groups, adj = (source._edit && source._edit.adj) || null, edit = source._edit || null) {
        const app = this.app;
        const crops = groups.includes('crop') && this.cropper() ? await app.cropEditsLike(source, files, edit) : null;
        const cropped = new Map((crops || []).map(it => [it.file, it.edit]));
        const items = files.map(f => {
            const base = cropped.has(f) ? cropped.get(f) : (f._edit || null);
            const now = (f._edit && f._edit.adj) || null;
            return { file: f, edit: Edits.withAdj(base, Develop.synced(now, adj, groups), f._edit || null) };
        });
        Edits.set(items, 'sync');
        const n = files.length;
        app.showToast(`Synced ${n === 1 ? files[0].name : n.toLocaleString() + ' photos'} with ${source.name}`, 2200, null, null, { kind: 'adjust' });
    },

    // ---- In Adjust ----

    // The others selected: what Sync and Auto Sync change there
    targets() {
        const app = this.app;
        return [...app.selection].filter(f => f !== Adjust.file && app.files.includes(f) && !/\.gif$/i.test(f.name));
    },

    none() {
        this.app.showToast('Ctrl+click photos in the strip to put this one\'s settings onto them too', 3000);
    },

    fromAdjust() {
        if (!Adjust.ready) return;
        const files = this.targets();
        if (!files.length) return this.none();
        // (its geometry as it is now, not as last saved)
        return this.open(Adjust.file, files, { adj: Adjust.result(), edit: Adjust.withGeo(Adjust.file._edit || null) });
    },

    toggleAuto(on = !this.auto) {
        const app = this.app;
        if (on && !Adjust.ready) {
            app.showToast('Auto Sync is in Adjust: select photos in the strip, then change the one open');
            return;
        }
        if (on && !this.targets().length) return this.none();
        if (on && !Edits.canKeep()) {
            app.showToast('Auto Sync needs a folder opened with Open folder');
            return;
        }
        if (!on) this.flush();
        this.auto = on;
        this._last = on ? Adjust.result() : null;
        this.chip();
        const n = this.targets().length;
        app.showToast(on ? `Auto Sync: what you change here goes onto the ${n === 1 ? 'other photo' : n.toLocaleString() + ' others'} too` : 'Auto Sync off', 2400, null, null, { kind: 'adjust' });
    },

    // Adjust's settings changed: onto the others, once they settle
    changed() {
        if (!this.auto) return;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.push(), 350);
    },

    flush() {
        if (!this._timer) return;
        clearTimeout(this._timer);
        this.push();
    },

    push() {
        this._timer = 0;
        if (!this.auto || !Adjust.ready) return;
        const now = Adjust.result();
        const keys = Develop.changedKeys(this._last, now).filter(k => k !== 'masks' && k !== 'spots');
        this._last = now;
        if (!keys.length) return;
        const files = this.targets();
        if (!files.length) return this.stop();
        Edits.set(files.map(f => ({ file: f, edit: Edits.withAdj(f._edit || null, Develop.syncedKeys(f._edit && f._edit.adj, now, keys), f._edit || null) })), 'auto sync');
    },

    stop() {
        if (!this.auto) return;
        this.auto = false;
        this._last = null;
        this.chip();
        this.app.showToast('Auto Sync off: no other photo selected', 2000, null, null, { kind: 'adjust' });
    },

    // Leaving Adjust: the last change goes too, then it's off. The strip's
    // selection goes with it: one photo shown has none
    leave() {
        this.flush();
        this.auto = false;
        this._last = null;
        if (this.app) this.app.selection.clear();
        this.chip();
    },

    // The selection in the strip changed
    selected() {
        if (this.auto && !this.targets().length) this.stop();
        this.chip();
    },

    chip() {
        const chip = this.el('adj-sync-chip');
        if (!chip) return;
        const n = this.auto ? this.targets().length : 0;
        chip.classList.toggle('hidden', !n);
        this.el('adj-sync-n').textContent = `${n.toLocaleString()} photo${n === 1 ? '' : 's'}`;
    },

    // The strip's right-click menu in Adjust
    stripItems() {
        const n = this.targets().length;
        return [
            [n ? `Sync settings onto ${n.toLocaleString()}…` : 'Sync settings…', () => this.fromAdjust()],
            [this.auto ? '✓ Auto Sync' : 'Auto Sync', () => this.toggleAuto()],
            ...(Adjust.clipboard() && n ? [['—'], [`Paste adjustments onto ${n.toLocaleString()}`, () => this.app.pasteAdjust(this.targets())]] : [])
        ];
    }
};
