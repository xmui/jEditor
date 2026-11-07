// Find anything (Ctrl+K, ⌘K on a Mac; or Find anything… in the mode
// menu and the theme menu bars): one box that finds jEditor's commands,
// the project's photos and folders, and recent projects as you type, and
// runs the one picked. It looks like jEditor's other dialogs.
//
// Commands come from the keyboard shortcuts (script.js KEY_ACTIONS: the
// ones for where you are, Photos, Crop, Adjust, Paint or Duplicates) and
// the theme menu bars' own commands (themes.js MENUS: Open folder…,
// Export…), each with its key, so the box teaches the keys. They say what
// they'll act on ("3 selected"). Matching forgives: every word must match,
// in any order, by its start, anywhere in the name, by its letters in
// order (`rtl` finds Rotate left), with one letter wrong in a longer word,
// or by another word for the same thing (`delete` finds Move to trash).
// What's picked often and lately comes first, and is what an empty box
// shows (Recent), with what fits the selection or the mode below it.
// Everything is in memory, so results come as you type; projects are
// looked up once each time it opens.

const Palette = {
    STORE: 'jeditor.palette', // { id: [times picked, last picked (ms)] }
    KEEP: 200,                // picks remembered
    LIMIT: { cmd: 8, photo: 6, folder: 5, project: 5 },
    GROUPS: { cmd: 'Commands', photo: 'Photos', folder: 'Folders', project: 'Projects' },

    // Commands left out: moving about the grid, and keys only a key can use
    SKIP: new Set(['nav.up', 'nav.down', 'view.back', 'view.open', 'app.debug', 'app.palette', 'edit.pasteImage',
        'adjust.cancel', 'paint.cancel', 'adjust.pasteImage', 'paint.paste']),

    // Commands that act on the selection in the grid
    ON_SELECTION: new Set(['edit.rotateLeft', 'edit.rotateRight', 'edit.rotate180', 'edit.flipH', 'edit.flipV', 'edit.rename',
        'edit.trash', 'edit.pasteAdjust', 'edit.autoCrop', 'edit.cropLike', 'edit.upright', 'edit.moveTo', 'edit.copyTo',
        'flag.star', 'flag.rescan', 'flag.red', 'flag.yellow', 'flag.green', 'flag.blue', 'flag.purple', 'flag.clear', 'menu.export']),

    // Other words for the same thing
    ALSO: {
        'edit.rotateLeft': 'turn anticlockwise counterclockwise',
        'edit.rotateRight': 'turn clockwise',
        'edit.rotate180': 'turn upside down',
        'edit.flipH': 'mirror',
        'edit.flipV': 'mirror',
        'edit.upright': 'rotate auto orientation fix sideways',
        'edit.crop': 'trim straighten level',
        'edit.adjust': 'edit develop exposure brightness contrast colour color levels curves lightroom',
        'edit.paint': 'draw brush layers text photoshop',
        'edit.trash': 'delete remove bin recycle',
        'edit.undo': 'revert back',
        'edit.moveTo': 'file',
        'edit.rename': 'name',
        'flag.star': 'favourite favorite pick like keep',
        'flag.rescan': 'redo reject bad',
        'flag.clear': 'unflag',
        'app.search': 'find filter',
        'app.settings': 'preferences options',
        'app.dupes': 'duplicates same similar',
        'app.convert': 'format jpeg jpg webp heic tiff',
        'app.import': 'camera card sd',
        'app.refresh': 'reload',
        'view.fullscreen': 'full screen',
        'view.info': 'details metadata exif dpi',
        'menu.export': 'save as jpeg jpg png webp tiff share',
        'menu.open': 'browse project',
        'adjust.whiteBalance': 'temperature warm cool',
        'adjust.before': 'compare original',
        'paint.text': 'type words'
    },

    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        this.box = this.el('palette');
        this.input = this.el('palette-input');
        this.list = this.el('palette-list');
        if (!this.box) return;
        this.input.addEventListener('input', () => this.search());
        this.input.addEventListener('keydown', (e) => this.onKey(e));
        // A click outside closes it, as the other dialogs do
        this.box.addEventListener('mousedown', (e) => { if (e.target === this.box) this.close(); });
        this.list.addEventListener('mousemove', (e) => {
            const row = e.target.closest('[data-i]');
            if (row && Number(row.dataset.i) !== this.at) this.mark(Number(row.dataset.i));
        });
        this.list.addEventListener('mousedown', (e) => e.preventDefault()); // the box keeps the keys
        this.list.addEventListener('click', (e) => {
            const row = e.target.closest('[data-i]');
            if (row) this.run(this.shown[Number(row.dataset.i)]);
        });
    },

    isOpen() {
        return !!this.box && !this.box.classList.contains('hidden');
    },

    otherDialog() {
        return [...document.querySelectorAll('.dialog-overlay, [role="dialog"][aria-modal="true"], [role="alertdialog"]')]
            .some(d => d !== this.box && !this.box.contains(d) && !d.classList.contains('hidden') && d.offsetParent !== null);
    },

    toggle() {
        if (this.isOpen()) this.close();
        else this.open();
    },

    open() {
        if (!this.box || this.isOpen()) return;
        // Never over another dialog: that one has the keys until it's closed
        if (this.otherDialog()) return;
        this.app.closeContextMenu && this.app.closeContextMenu();
        if (typeof Modes !== 'undefined') Modes.closeMenu();
        this.before = document.activeElement;
        this.ctx = this.where();
        this.items = this.collect();
        this.input.value = '';
        this.input.placeholder = this.ctx === 'start' ? 'Find a project or command' : 'Find a photo, folder or command';
        const n = this.selected().length;
        this.el('palette-for').textContent = n > 1 ? `${n.toLocaleString()} selected` : '';
        this.box.classList.remove('hidden');
        this.search();
        this.input.focus();
        this.loadProjects();
    },

    close() {
        if (!this.isOpen()) return;
        this.box.classList.add('hidden');
        this.list.innerHTML = '';
        this.shown = [];
        const b = this.before;
        this.before = null;
        if (b && b.isConnected && b !== document.body && b.focus) b.focus({ preventScroll: true });
        else if (document.activeElement === this.input) this.input.blur();
    },

    // ---- Where you are, and what's in reach ----

    where() {
        const a = this.app;
        if (a.elements.mainInterface.classList.contains('hidden')) return 'start';
        if (a.cropState.active) {
            const t = a.cropState.tool;
            return t === 'adjust' || t === 'paint' ? t : 'crop';
        }
        if (typeof Dupes !== 'undefined' && Dupes.isOpen) return 'dupes';
        return 'photos';
    },

    // The photos a command acts on, in the grid
    selected() {
        const a = this.app;
        return this.ctx === 'photos' && a.viewMode === 'grid' && a.selection ? [...a.selection] : [];
    },

    // "Rotate left (whole selection in grid)" → "Rotate left"; "Sync: the
    // outlined photo's…" → "Sync", the rest kept for matching
    tidy(label) {
        let name = label.replace(/\s*\([^)]*\)\s*$/, '');
        const i = name.indexOf(': ');
        if (i > 0) name = name.slice(0, i);
        return name;
    },

    keyOf(id) {
        const keys = (this.app.keyBindings && this.app.keyBindings[id]) || [];
        return keys.length ? this.app.formatCombo(keys[0]).replace(/ \+ /g, '+') : '';
    },

    collect() {
        const a = this.app, ctx = this.ctx, out = [];
        const keyCtx = ctx === 'photos' || ctx === 'start' ? 'global' : ctx;
        const onStart = ['app.shortcuts', 'app.settings', 'app.import'];
        for (const [id, c, group, label] of a.KEY_ACTIONS) {
            if (c !== keyCtx || this.SKIP.has(id) || !a.actionOn(id)) continue;
            if (ctx === 'start' && !onStart.includes(id)) continue;
            out.push(this.cmd(id, this.tidy(label), `${label} ${group}`, this.keyOf(id), () => this.runKey(id)));
        }
        // The menu bars' commands that aren't keys
        if (ctx === 'photos' || ctx === 'start') {
            out.push(this.cmd('menu.open', 'Open folder…', 'open folder', '', () => a.browseFolder()));
            if (ctx === 'photos') {
                if (typeof Export !== 'undefined') out.push(this.cmd('menu.export', 'Export…', 'export', '', () => Export.open({ files: a.selection.size ? [...a.selection] : null })));
                if (a.pasteFromMenu) out.push(this.cmd('menu.paste', 'Paste image', 'paste image from another app clipboard', this.keyOf('edit.pasteImage'), () => a.pasteFromMenu()));
            }
            out.push(this.cmd('menu.whatsnew', 'What\'s new', 'whats new changelog version update', '', () => a.toggleWhatsNew()));
        }
        // The other modes, from Adjust and Paint
        if ((ctx === 'adjust' || ctx === 'paint') && typeof Modes !== 'undefined') {
            for (const [m, label, key] of Modes.shown()) {
                if (m === ctx || (Modes.on && !Modes.on(m))) continue;
                out.push(this.cmd('mode.' + m, m === 'photos' ? 'Back to Photos' : `Open in ${label}`, `mode ${label}`, m === 'photos' ? '' : key, () => Modes.go(m)));
            }
        }
        if (ctx === 'photos') {
            this.addFolders(out);
            this.addPhotos(out);
        }
        return out;
    },

    cmd(id, name, more, key, run) {
        const also = this.ALSO[id] || '';
        return { kind: 'cmd', id: 'cmd:' + id, action: id, name, low: name.toLowerCase(), more: `${more} ${also}`.toLowerCase(), key, run };
    },

    addFolders(out) {
        if (typeof Folders === 'undefined' || !Folders.hasSubfolders || !Folders.hasSubfolders()) return;
        for (const p of Folders.ordered()) {
            if (!p) continue;
            const name = Folders.baseName(p);
            const parent = Folders.parentOf(p);
            out.push({ kind: 'folder', id: 'folder:' + p, name, low: name.toLowerCase(), more: p.toLowerCase(),
                sub: parent ? Folders.label(parent) : Folders.rootName(),
                run: () => { this.app.setView('grid'); Folders.setScope(p); } });
        }
    },

    addPhotos(out) {
        for (const f of this.app.files) {
            const dir = Folders.dirOf(f);
            out.push({ kind: 'photo', id: 'photo:' + (f.relPath || f.name), name: f.name, low: f.name.toLowerCase(), more: dir.toLowerCase(),
                sub: dir ? Folders.baseName(dir) : '', file: f, run: () => this.openPhoto(f) });
        }
    },

    // Projects: the recent ones, and the projects folder in the apps
    async loadProjects() {
        const gen = this._gen = (this._gen || 0) + 1;
        const found = [];
        const here = this.app.dirHandle && this.app.dirHandle.name;
        try {
            if (typeof Recents !== 'undefined' && Recents.supported()) {
                for (const r of await Recents.list()) {
                    if (r.name === here) continue;
                    found.push({ kind: 'project', id: 'project:' + r.id, name: r.name, low: r.name.toLowerCase(), more: 'project recent',
                        sub: Recents.when(r.openedAt), run: () => Recents.open(r) });
                }
            }
            const dir = typeof Host !== 'undefined' && Host.has('places') && typeof Places !== 'undefined' ? Places.projectsDir() : null;
            if (dir) {
                const list = await FolderCache.native().listProjects(dir).catch(() => null);
                for (const p of list || []) {
                    if (p.name === here || found.some(x => x.name === p.name)) continue;
                    found.push({ kind: 'project', id: 'project:' + p.path, name: p.name, low: p.name.toLowerCase(), more: 'project',
                        sub: Recents.when(p.modified), run: () => Places.open(p.path) });
                }
            }
        } catch (e) { /* none to show */ }
        if (gen !== this._gen || !this.isOpen() || !found.length) return;
        this.items = this.items.concat(found);
        this.search(true);
    },

    // ---- Matching ----

    // How well one typed word matches a name, or 0
    wordScore(w, s, loose = true) {
        const at = s.indexOf(w);
        if (at === 0) return 100;
        if (at > 0) return /[\s\-_./(]/.test(s[at - 1]) ? 85 : 55;
        // Its letters in order, the first at a word's start: rtl → Rotate left
        if (loose && w.length >= 2) {
            let i = 0, j = 0, run = 0, best = 0, starts = 0;
            for (; i < s.length && j < w.length; i++) {
                if (s[i] === w[j]) {
                    if (j === 0 && i > 0 && !/[\s\-_./]/.test(s[i - 1])) continue;
                    if (i === 0 || /[\s\-_./]/.test(s[i - 1])) starts++;
                    run++; best = Math.max(best, run); j++;
                } else if (j > 0) run = 0;
            }
            if (j === w.length) return 25 + starts * 8 + best * 2;
        }
        // One letter wrong, missing or extra, in a longer word
        if (w.length >= 4) {
            for (const t of s.split(/[\s\-_./]+/)) if (t && this.near(w, t)) return 45;
        }
        return 0;
    },

    // At most one letter wrong, missing, extra or swapped: w against the start of t
    near(w, t) {
        const one = (a, b) => {
            if (Math.abs(a.length - b.length) > 1) return false;
            let i = 0, j = 0, edits = 0;
            while (i < a.length && j < b.length) {
                if (a[i] === b[j]) { i++; j++; continue; }
                if (++edits > 1) return false;
                // Two letters swapped is one slip too: adjsut
                if (a.length === b.length && a[i] === b[j + 1] && a[i + 1] === b[j]) { i += 2; j += 2; continue; }
                if (a.length > b.length) i++;
                else if (a.length < b.length) j++;
                else { i++; j++; }
            }
            return edits + (a.length - i) + (b.length - j) <= 1;
        };
        return [w.length - 1, w.length, w.length + 1].some(n => n > 0 && n <= t.length && one(w, t.slice(0, n)));
    },

    score(item, words) {
        let total = 0;
        for (const w of words) {
            // Photos match by name and folder, not by a letter here and
            // there: a scan order has thousands named alike
            const photo = item.kind === 'photo';
            const inName = photo ? (item.low.includes(w) ? this.wordScore(w, item.low) : 0) : this.wordScore(w, item.low);
            // The longer words (the full label, other words for it) by
            // their words, not by letters strewn across them
            const inMore = !item.more ? 0 : photo ? (item.more.includes(w) ? 50 : 0) : this.wordScore(w, item.more, false) * 0.6;
            const s = Math.max(inName, inMore);
            if (!s) return 0;
            total += s;
        }
        // Commands first when the match is as good: they're what the box is for
        if (item.kind === 'cmd') total += 6;
        return total + this.used(item.id);
    },

    // Picked often and lately: higher
    used(id) {
        const u = this.store()[id];
        if (!u) return 0;
        const days = (Date.now() - u[1]) / 864e5;
        return Math.min(30, 10 * Math.log2(1 + u[0])) + (days < 1 ? 12 : days < 7 ? 6 : 0);
    },

    store() {
        if (!this._store) {
            try { this._store = JSON.parse(localStorage.getItem(this.STORE) || '{}') || {}; } catch (e) { this._store = {}; }
        }
        return this._store;
    },

    remember(id) {
        const s = this.store();
        const u = s[id] || [0, 0];
        s[id] = [u[0] + 1, Date.now()];
        const ids = Object.keys(s);
        if (ids.length > this.KEEP) ids.sort((a, b) => s[a][1] - s[b][1]).slice(0, ids.length - this.KEEP).forEach(k => delete s[k]);
        try { localStorage.setItem(this.STORE, JSON.stringify(s)); } catch (e) { /* private mode */ }
    },

    // ---- The list ----

    search(keep = false) {
        if (!this.isOpen() || !this.items) return;
        const q = this.input.value.trim().toLowerCase();
        const was = keep && this.shown && this.shown[this.at] ? this.shown[this.at].id : null;
        const groups = q ? this.matches(q) : this.suggestions();
        this.render(groups);
        const i = was ? this.shown.findIndex(x => x.id === was) : -1;
        this.mark(i >= 0 ? i : 0);
    },

    matches(q) {
        const words = q.split(/\s+/).filter(Boolean);
        const by = { cmd: [], photo: [], folder: [], project: [] };
        for (const item of this.items) {
            const s = this.score(item, words);
            if (s) by[item.kind].push([s, item]);
        }
        const groups = [];
        for (const kind of Object.keys(by)) {
            const list = by[kind].sort((a, b) => b[0] - a[0]).slice(0, this.LIMIT[kind]);
            if (list.length) groups.push({ title: this.GROUPS[kind], best: list[0][0], items: list.map(x => x[1]) });
        }
        return groups.sort((a, b) => b.best - a.best);
    },

    // Nothing typed: what you picked lately, then what fits where you are
    suggestions() {
        const s = this.store();
        const byId = new Map(this.items.map(x => [x.id, x]));
        const recent = Object.keys(s).filter(id => byId.has(id)).sort((a, b) => s[b][1] - s[a][1]).slice(0, 4).map(id => byId.get(id));
        const n = this.selected().length;
        const ids = {
            photos: n ? ['edit.moveTo', 'flag.star', 'edit.rotateRight', 'edit.upright', 'edit.rename', 'menu.export']
                : ['app.search', 'menu.open', 'edit.adjust', 'app.dupes', 'app.settings'],
            start: ['menu.open', 'app.import', 'app.settings'],
            adjust: ['adjust.auto', 'adjust.autoColor', 'adjust.before', 'mode.paint', 'mode.photos'],
            paint: ['paint.brush', 'paint.text', 'paint.newLayer', 'mode.adjust', 'mode.photos'],
            crop: ['crop.save', 'crop.level', 'crop.aspect', 'crop.reset'],
            dupes: ['dupes.apply', 'dupes.keepBest', 'dupes.close']
        }[this.ctx] || [];
        const fits = ids.map(id => byId.get('cmd:' + id)).filter(x => x && !recent.includes(x));
        const groups = [];
        if (recent.length) groups.push({ title: 'Recent', items: recent });
        const title = n > 1 ? `For the ${n.toLocaleString()} selected` : n === 1 ? 'For the selected photo' : 'Suggested';
        if (fits.length) groups.push({ title, items: fits });
        if (this.ctx === 'start') {
            const projects = this.items.filter(x => x.kind === 'project' && !recent.includes(x)).slice(0, 5);
            if (projects.length) groups.push({ title: 'Projects', items: projects });
        }
        return groups;
    },

    esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
    },

    ICONS: {
        cmd: '<path d="m9 18 6-6-6-6"/>',
        rotL: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
        rotR: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
        flip: '<path d="M12 3v18"/><path d="m16 7 4 5-4 5"/><path d="m8 7-4 5 4 5"/>',
        crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
        star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
        flag: '<path d="M4 22V4a1 1 0 0 1 1-1h12l-2 5 2 5H5"/>',
        trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
        undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
        move: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
        rename: '<path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 2.9 2.9L7 18.8l-4 1 1-4z"/>',
        adjust: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
        paint: '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z"/><path d="M9.2 12c-2.5 0-4.2 1.6-4.2 4 0 1.5-.8 2.6-2.4 3.4C4.4 21 6.3 21.5 8 21.5c3 0 5-1.9 4.9-4.6z"/>',
        view: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
        app: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
        photo: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
        folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
        project: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>'
    },

    // A command's picture: by what it does, else by its group
    iconFor(item) {
        const id = item.action || '';
        const by = [[/rotateLeft|rotate180|crop\.rotateLeft/, 'rotL'], [/rotate/, 'rotR'], [/flip/, 'flip'], [/upright/, 'rotR'],
            [/crop|Crop/, 'crop'], [/star/, 'star'], [/^flag\./, 'flag'], [/trash|clear$|dupes\.apply/, 'trash'],
            [/undo|redo|history|reset|cancel/, 'undo'], [/moveTo|copyTo|folders\.|menu\.open/, 'folder'], [/rename/, 'rename'],
            [/^adjust|edit\.adjust|mode\.adjust|Adjust|whiteBalance|sync/i, 'adjust'], [/^paint|edit\.paint|mode\.paint/, 'paint'],
            [/search|palette/, 'search'], [/copy|paste|import|export|convert/i, 'copy'], [/^view\.|^nav\.|before|zoom|fit|actual|mode\.photos|done/, 'view'],
            [/^app\.|^menu\./, 'app']];
        for (const [re, k] of by) if (re.test(id)) return this.ICONS[k];
        return this.ICONS.move;
    },

    render(groups) {
        this.shown = [];
        const n = this.selected().length;
        let html = '';
        for (const g of groups) {
            html += `<div class="palette-head" role="presentation">${this.esc(g.title)}</div>`;
            for (const item of g.items) {
                const i = this.shown.push(item) - 1;
                const thumb = item.kind === 'photo' && item.file.thumbnailUrl
                    ? `<img class="palette-thumb" src="${this.esc(item.file.thumbnailUrl)}" alt="">`
                    : `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${item.kind === 'cmd' ? this.iconFor(item) : this.ICONS[item.kind]}</svg>`;
                const sub = item.kind === 'cmd' ? (n > 1 && this.ON_SELECTION.has(item.action) ? `${n.toLocaleString()} selected` : '') : item.sub;
                html += `<div class="palette-row" id="palette-opt-${i}" role="option" aria-selected="false" data-i="${i}" data-kind="${item.kind}">${thumb}`
                    + `<span class="palette-name">${this.esc(item.name)}</span>`
                    + (sub ? `<span class="palette-sub">${this.esc(sub)}</span>` : '')
                    + (item.key ? `<span class="palette-key">${this.esc(item.key)}</span>` : '')
                    + '</div>';
            }
        }
        if (!this.shown.length) {
            html = `<div class="palette-none">${this.input.value.trim() ? 'Nothing found' : 'Type to find a photo, folder or command'}</div>`;
        }
        this.list.innerHTML = html;
    },

    mark(i) {
        if (!this.shown.length) { this.at = -1; this.input.removeAttribute('aria-activedescendant'); return; }
        this.at = Math.max(0, Math.min(this.shown.length - 1, i));
        this.list.querySelectorAll('.palette-row.on').forEach(r => { r.classList.remove('on'); r.setAttribute('aria-selected', 'false'); });
        const row = this.el('palette-opt-' + this.at);
        if (!row) return;
        row.classList.add('on');
        row.setAttribute('aria-selected', 'true');
        this.input.setAttribute('aria-activedescendant', row.id);
        row.scrollIntoView({ block: 'nearest' });
    },

    onKey(e) {
        const combo = this.app.comboFromEvent(e);
        const n = this.shown ? this.shown.length : 0;
        if (combo === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
        else if (combo === 'ArrowDown') { e.preventDefault(); if (n) this.mark((this.at + 1) % n); }
        else if (combo === 'ArrowUp') { e.preventDefault(); if (n) this.mark((this.at - 1 + n) % n); }
        else if (combo === 'PageDown') { e.preventDefault(); this.mark(this.at + 6); }
        else if (combo === 'PageUp') { e.preventDefault(); this.mark(this.at - 6); }
        else if (combo === 'Enter') { e.preventDefault(); e.stopPropagation(); if (n) this.run(this.shown[this.at]); }
        else if (combo === 'Tab' || combo === 'Shift+Tab') e.preventDefault(); // stays in the box
        else if ((this.app.keyBindings['app.palette'] || []).includes(combo)) { e.preventDefault(); this.close(); }
    },

    // ---- Running ----

    run(item) {
        if (!item) return;
        this.remember(item.id);
        this.close();
        try { item.run(); } catch (e) { console.warn('Find anything:', e); }
    },

    // A shortcut's own action, as its key would run it
    runKey(id) {
        const a = this.app, ctx = this.ctx;
        if (ctx === 'crop' && (CropEditor.busy || !CropEditor.ready)) return;
        if (ctx === 'adjust' && (Adjust.busy || !Adjust.ready)) return;
        if (ctx === 'paint' && (PaintEditor.busy || !PaintEditor.ready)) return;
        const handler = a.actionOn(id) && a.keyHandlers()[id];
        if (!handler) return;
        a.stopSlideshow();
        handler({ preventDefault() { }, stopPropagation() { }, stopImmediatePropagation() { }, target: document.body, key: '' });
    },

    // A photo: shown in its folder, in single view
    openPhoto(f) {
        const a = this.app;
        if (typeof Folders !== 'undefined' && Folders.scope !== null && !Folders.inView(f)) Folders.setScope(Folders.dirOf(f));
        a.openSingle(f);
    }
};
