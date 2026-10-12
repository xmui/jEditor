// Flags and search: marking photos, and narrowing the grid down to some.
//
// A photo can have a star (a pick), a "needs rescan" flag (a bad scan to
// redo) and one colour label. P stars, X marks for rescan, 1–5 set a
// colour (the same colour again takes it off), U clears all three. In the
// grid they apply to the selection, in single view to the photo shown.
//
// Flags are saved with the order, in .jeditor/flags.json, keyed by each
// photo's path. They live on the photo objects while the folder is open,
// so a rename or a move inside jEditor carries them along; the file is
// written again after any change. Flags of photos that aren't in the
// folder any more are kept, in case they come back.
//
// The view filter is a flag (★, needs rescan, a colour or "no flag")
// and/or a search: words matched against each photo's name and folder,
// all of them, in any order. `is:star`, `is:rescan`, `is:red` (and the
// other colours), `is:flagged` and `is:unflagged` match flags in a search.
// Folders.viewFiles applies it, so the grid, film strip, arrow keys and
// Ctrl+A all follow it.

const Flags = {
    FILE: 'flags.json',
    COLORS: ['red', 'yellow', 'green', 'blue', 'purple'],
    COLOR_HEX: { red: '#f87171', yellow: '#facc15', green: '#4ade80', blue: '#60a5fa', purple: '#c084fc' },

    filter: null, // null | 'star' | 'rescan' | 'none' | a colour
    query: '',
    orphans: new Map(), // path → flags of photos not in the folder now

    ICONS: {
        star: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
        rescan: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
        none: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7.5" stroke-dasharray="3 3"/></svg>',
        clear: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>'
    },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        this.initSearch();
        const list = document.getElementById('flag-list');
        list.addEventListener('click', (e) => {
            const row = e.target.closest('[data-flag-filter]');
            if (row) this.setFilter(row.dataset.flagFilter === this.filter ? null : row.dataset.flagFilter);
        });
        list.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('[data-flag-filter]');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            app.openContextMenu(this.listItems(row.dataset.flagFilter), e.clientX, e.clientY);
        });
    },

    // Another folder is being opened
    reset() {
        this.filter = null;
        this.query = '';
        this.orphans = new Map();
        this._loadedFor = null;
        const input = document.getElementById('fb-search');
        if (input) input.value = '';
        this.syncSearchUI();
    },

    // ---- Reading flags ----

    get(f) {
        return f && f._flags;
    },
    has(f, kind) {
        const fl = f && f._flags;
        if (!fl) return false;
        if (kind === 'star') return !!fl.star;
        if (kind === 'rescan') return !!fl.rescan;
        if (kind === 'none') return !fl.star && !fl.rescan && !fl.color;
        if (kind === 'flagged') return !!(fl.star || fl.rescan || fl.color);
        return fl.color === kind;
    },
    any(f) {
        return this.has(f, 'flagged');
    },
    label(kind) {
        if (kind === 'star') return 'Starred';
        if (kind === 'rescan') return 'Needs rescan';
        if (kind === 'none') return 'No flag';
        return kind.charAt(0).toUpperCase() + kind.slice(1);
    },

    // ---- Saving with the order ----

    async load() {
        const app = this.app;
        this._loadedFor = app.dirHandle;
        this.orphans = new Map();
        if (!app.dirHandle || app.readOnlyMode) return;
        let data = null;
        try {
            const root = await FolderCache.root(app, false);
            const fh = root && await root.getFileHandle(this.FILE);
            data = fh && JSON.parse(await (await fh.getFile()).text());
        } catch (e) { /* no flags yet */ }
        if (this._loadedFor !== app.dirHandle) return; // another folder opened meanwhile
        const saved = new Map(Object.entries((data && data.flags) || {}));
        for (const f of app.files) {
            const rel = f.relPath || f.name;
            const fl = this.clean(saved.get(rel));
            if (fl) f._flags = fl;
            saved.delete(rel);
        }
        for (const [k, v] of saved) {
            const fl = this.clean(v);
            if (fl) this.orphans.set(k, fl);
        }
        this.refreshAll();
    },

    clean(v) {
        if (!v || typeof v !== 'object') return null;
        const fl = {};
        if (v.star) fl.star = true;
        if (v.rescan) fl.rescan = true;
        if (this.COLORS.includes(v.color)) fl.color = v.color;
        return Object.keys(fl).length ? fl : null;
    },

    // Written a moment after the last change, so a burst of flagging is
    // one write. Photos renamed or moved by jEditor are saved under their
    // new paths, since the paths are read at save time.
    saveSoon() {
        if (!this.app.dirHandle || this.app.readOnlyMode) return;
        if (!this._dirty && !this.app.files.some(f => f._flags) && !this.orphans.size) return;
        this._dirty = true;
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.save(), 400);
    },

    async save() {
        const app = this.app;
        if (!this._dirty || !app.dirHandle || app.readOnlyMode) return;
        this._dirty = false;
        const out = {};
        for (const [k, v] of this.orphans) out[k] = v;
        for (const f of app.files) if (this.any(f)) out[f.relPath || f.name] = f._flags;
        const empty = !Object.keys(out).length;
        try {
            const root = await FolderCache.root(app, !empty);
            if (!root) return;
            if (empty) {
                await root.removeEntry(this.FILE).catch(() => { });
                return;
            }
            const fh = await root.getFileHandle(this.FILE, { create: true });
            const w = await fh.createWritable();
            await w.write(JSON.stringify({ version: 1, flags: out }));
            await w.close();
            app._usage = null;
            app.refreshInfoSoon();
        } catch (e) {
            console.warn('Saving flags failed:', e);
        }
    },

    // Clean Up Folder removed flags.json: the flags go too
    clearAll() {
        clearTimeout(this._saveTimer);
        this._dirty = false;
        this.orphans = new Map();
        for (const f of this.app.files) delete f._flags;
        if (this.filter) this.setFilter(null);
        this.refreshAll();
    },

    count() {
        let n = this.orphans.size;
        for (const f of this.app.files) if (this.any(f)) n++;
        return n;
    },

    // Flags from a subfolder's own .jeditor (see FolderCache.absorbNested),
    // saved relative to that subfolder. Joined with any already set here.
    mergeFrom(prefix, saved) {
        const byPath = new Map(this.app.files.map(f => [f.relPath || f.name, f]));
        let n = 0;
        for (const [rel, v] of Object.entries(saved)) {
            const fl = this.clean(v);
            if (!fl) continue;
            const path = Folders.join(prefix, rel);
            const f = byPath.get(path);
            const old = f ? f._flags : this.orphans.get(path);
            const joined = { ...fl, ...(old || {}) };
            if (fl.star) joined.star = true;
            if (fl.rescan) joined.rescan = true;
            if (f) f._flags = joined;
            else this.orphans.set(path, joined);
            n++;
        }
        if (n) {
            this._dirty = true;
            this.saveSoon();
            this.refreshAll();
        }
        return n;
    },

    // Photos that left the folder keep their flags in case they come back
    forgetFiles(files) {
        for (const f of files) if (this.any(f)) this.orphans.set(f.relPath || f.name, f._flags);
    },

    // New photos that had flags before (put back, say)
    adopt(files) {
        if (!this.orphans.size) return;
        for (const f of files) {
            const rel = f.relPath || f.name;
            const fl = this.orphans.get(rel);
            if (fl) {
                f._flags = fl;
                this.orphans.delete(rel);
            }
        }
    },

    // ---- Changing flags ----

    targets() {
        return Folders.targets();
    },

    // kind: 'star' | 'rescan' | a colour | 'clear'. Stars and rescan
    // flags toggle (all on, unless every photo already has it); a colour
    // replaces the old one, or comes off if every photo already has it.
    apply(kind, files = this.targets()) {
        const app = this.app;
        files = files.filter(Boolean);
        if (!files.length) return false;
        if (!app.dirHandle || app.readOnlyMode) {
            app.showToast('Flags need a folder opened with Open Folder');
            return false;
        }
        const before = files.map(f => ({ file: f, flags: f._flags ? { ...f._flags } : null }));
        let on = true;
        if (kind === 'clear') {
            on = false;
            files.forEach(f => { delete f._flags; });
        } else if (kind === 'star' || kind === 'rescan') {
            on = !files.every(f => this.has(f, kind));
            files.forEach(f => this.setOne(f, kind, on));
        } else {
            on = !files.every(f => this.has(f, kind));
            files.forEach(f => this.setOne(f, 'color', on ? kind : null));
        }
        app.pushUndo({ type: 'flags', items: before });
        this.changed(files);
        const n = files.length;
        const what = n === 1 ? (files[0].name) : `${n.toLocaleString()} photos`;
        const msg = kind === 'clear' ? `Cleared flags on ${what}`
            : kind === 'star' ? (on ? `Starred ${what}` : `Unstarred ${what}`)
                : kind === 'rescan' ? (on ? `${what}: needs rescan` : `${what}: rescan flag off`)
                    : (on ? `${this.label(kind)} label on ${what}` : `${this.label(kind)} label off ${what}`);
        app.showToast(msg, 1600, 'flags', null, { type: 'info', icon: kind === 'star' ? 'star' : 'flag' });
        return true;
    },

    setOne(f, key, value) {
        const fl = { ...(f._flags || {}) };
        if (value) fl[key] = value;
        else delete fl[key];
        if (Object.keys(fl).length) f._flags = fl;
        else delete f._flags;
    },

    undo(entry) {
        for (const it of entry.items) {
            if (it.flags) it.file._flags = { ...it.flags };
            else delete it.file._flags;
        }
        this.changed(entry.items.map(it => it.file));
        const n = entry.items.length;
        this.app.showToast(`Undid flags on ${n === 1 ? entry.items[0].file.name : n + ' photos'}`);
    },

    // Badges, counts, the filter (a photo may have left it) and the file
    changed(files) {
        const app = this.app;
        files.forEach(f => {
            if (f._gridEl) this.decorate(f._gridEl, f);
            if (f._stripEl) this.decorate(f._stripEl, f);
        });
        this.updateHeader();
        this.saveSoon();
        if (this.filter || /\bis:/.test(this.query)) this.refilter();
        else Folders.render();
        app.updateSelectionUI();
    },

    refreshAll() {
        for (const f of this.app.files) {
            if (f._gridEl) this.decorate(f._gridEl, f);
            if (f._stripEl) this.decorate(f._stripEl, f);
        }
        this.updateHeader();
        Folders.render();
    },

    // ---- Badges ----

    // Top right of a grid tile or film-strip item: ★, rescan, colour dot
    decorate(el, f) {
        if (!this.any(f) && !el.classList.contains('has-flags')) return; // most tiles: nothing to do
        let b = el.querySelector(':scope > .tile-flags');
        if (!this.any(f)) {
            if (b) b.remove();
            el.classList.remove('has-flags');
            return;
        }
        if (!b) {
            b = document.createElement('span');
            b.className = 'tile-flags';
            el.appendChild(b);
        }
        b.innerHTML = this.badgeHTML(f);
        el.classList.add('has-flags');
    },

    badgeHTML(f) {
        const fl = f._flags || {};
        let h = '';
        if (fl.color) h += `<i class="tf-dot" style="--c:${this.COLOR_HEX[fl.color]}" title="${this.label(fl.color)} label"></i>`;
        if (fl.star) h += `<i class="tf-star" title="Starred">${this.ICONS.star}</i>`;
        if (fl.rescan) h += `<i class="tf-rescan" title="Needs rescan">${this.ICONS.rescan}</i>`;
        return h;
    },

    // Beside the file name in the centre pill
    updateHeader() {
        const app = this.app;
        let el = document.getElementById('file-flags');
        if (!el) {
            el = document.createElement('span');
            el.id = 'file-flags';
            app.elements.fileName.after(el);
        }
        const f = app.currentFile;
        const show = f && this.any(f) && Folders.inView(f);
        el.innerHTML = show ? this.badgeHTML(f) : '';
        el.classList.toggle('hidden', !show);
    },

    // ---- The view filter ----

    active() {
        return !!(this.filter || this.terms().length);
    },

    terms() {
        if (this._termsFor !== this.query) {
            this._termsFor = this.query;
            this._terms = this.query.toLowerCase().split(/\s+/).filter(Boolean);
        }
        return this._terms;
    },

    passes(f) {
        if (this.filter && !this.has(f, this.filter)) return false;
        const terms = this.terms();
        if (!terms.length) return true;
        const path = (f.relPath || f.name).toLowerCase();
        for (const t of terms) {
            if (t.startsWith('is:') && t.length > 3) {
                const k = t.slice(3);
                const kind = k === 'starred' ? 'star' : k === 'unflagged' ? 'none' : k;
                if (!this.has(f, kind)) return false;
            } else if (!path.includes(t)) {
                return false;
            }
        }
        return true;
    },

    narrow(files) {
        return this.active() ? files.filter(f => this.passes(f)) : files;
    },

    setFilter(kind) {
        this.filter = kind || null;
        this.syncSearchUI();
        this.refilter(true);
    },

    clearFilter(render = true) {
        this.filter = null;
        this.query = '';
        const input = document.getElementById('fb-search');
        if (input) input.value = '';
        this.syncSearchUI();
        if (render) this.refilter(true);
    },

    setQuery(q) {
        if (q === this.query) return;
        this.query = q;
        this.syncSearchUI();
        this.refilter(true);
    },

    // The grid shows what passes now; the current photo stays if it can
    refilter(toTop = false) {
        const app = this.app;
        if (!app.files.length) return;
        app.selection.clear();
        const view = app.viewFiles();
        if (!Folders.inView(app.currentFile) && view.length) app.currentFile = view[0];
        app.renderThumbnails();
        app.renderGrid({ sync: true });
        if (toTop) app.elements.gridView.scrollTop = 0;
        if (view.length) {
            app.setCurrent(app.currentFile);
            if (app.viewMode === 'grid') app.selection.add(app.currentFile);
            const el = app.currentFile._gridEl;
            if (el && !toTop) el.scrollIntoView({ block: 'nearest' });
        } else {
            Folders.showEmptyHeader();
        }
        app.updateSelectionUI();
        if (app.viewMode === 'single') {
            if (view.length) app.loadFile(app.currentFile);
            else app.setView('grid');
        }
        this.updateHeader();
    },

    // ---- The Flags list in the folder rail ----

    renderList() {
        const list = document.getElementById('flag-list');
        if (!list) return;
        const files = this.app.files;
        const counts = { star: 0, rescan: 0, none: 0 };
        this.COLORS.forEach(c => { counts[c] = 0; });
        for (const f of files) {
            const fl = f._flags;
            if (!fl) { counts.none++; continue; }
            if (fl.star) counts.star++;
            if (fl.rescan) counts.rescan++;
            if (fl.color) counts[fl.color]++;
        }
        const flagged = files.length - counts.none;
        if (!flagged && !this.filter) {
            list.innerHTML = '';
            list.classList.add('hidden');
            return;
        }
        list.classList.remove('hidden');
        const row = (kind, icon) => {
            const n = counts[kind];
            if (!n && this.filter !== kind) return '';
            return `<div class="fr-row fl-row fl-${kind}${this.filter === kind ? ' active' : ''}" data-flag-filter="${kind}" ` +
                `title="${this.label(kind)}: ${n} photo${n === 1 ? '' : 's'} — click to show only these, right-click for more">` +
                `<span class="fl-icon">${icon}</span><span class="fr-name">${this.label(kind)}</span>` +
                `<span class="fr-count">${n.toLocaleString()}</span></div>`;
        };
        list.innerHTML = '<div class="fl-head">Flags</div>' +
            row('star', this.ICONS.star) +
            row('rescan', this.ICONS.rescan) +
            this.COLORS.map(c => row(c, `<i class="tf-dot" style="--c:${this.COLOR_HEX[c]}"></i>`)).join('') +
            row('none', this.ICONS.none);
    },

    // Right-click a flag in the list
    listItems(kind) {
        const app = this.app;
        const files = app.files.filter(f => this.has(f, kind));
        const n = files.length;
        const items = [
            [`Show only ${this.label(kind)}`, () => this.setFilter(kind)],
            [`Select ${n.toLocaleString()} photo${n === 1 ? '' : 's'}`, () => this.selectKind(kind)],
            ['—'],
            ['Copy list of names', () => this.copyList(files, kind)],
            ['Save list as text…', () => this.saveList(files, kind)]
        ];
        // Every photo here has it, so applying it again takes it off
        if (kind !== 'none') items.push(['—'], [`Take ${this.label(kind)} off all`, () => this.apply(kind, files)]);
        return items;
    },

    // Show and select every photo with this flag, ready for M, Export or Delete
    selectKind(kind) {
        const app = this.app;
        if (app.viewMode !== 'grid') app.setView('grid');
        if (this.filter !== kind) this.setFilter(kind);
        app.selection = new Set(app.viewFiles());
        app.updateSelectionUI();
    },

    // The list for whoever's on the scanner: one path per line
    listText(files, kind) {
        const order = this.app.NAME_ORDER;
        const lines = files.map(f => f.relPath || f.name).sort((a, b) => order.compare(a, b));
        const root = (this.app.dirHandle && this.app.dirHandle.name) || 'Photos';
        return `${root} — ${this.label(kind)} (${lines.length})\r\n\r\n${lines.join('\r\n')}\r\n`;
    },

    async copyList(files, kind) {
        try {
            await navigator.clipboard.writeText(this.listText(files, kind));
            this.app.showToast(`Copied ${files.length} name${files.length === 1 ? '' : 's'}`, 2000, null, null, { type: 'success' });
        } catch (e) {
            this.app.showToast('Couldn\'t copy to the clipboard — try Save list instead', 4000);
        }
    },

    async saveList(files, kind) {
        const root = (this.app.dirHandle && this.app.dirHandle.name) || 'Photos';
        const name = `${root} - ${this.label(kind)}.txt`;
        const blob = new Blob([this.listText(files, kind)], { type: 'text/plain' });
        if (typeof window.showSaveFilePicker === 'function') {
            try {
                const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Text', accept: { 'text/plain': ['.txt'] } }] });
                const w = await h.createWritable();
                await w.write(blob);
                await w.close();
                this.app.showToast(`Saved ${h.name}`, 2000);
            } catch (e) {
                if (e.name !== 'AbortError') this.app.showToast('Couldn\'t save the list: ' + e.message, 4000);
            }
            return;
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    // ---- Search (in the folder pill) ----

    initSearch() {
        const box = document.getElementById('fb-search-box');
        const input = document.getElementById('fb-search');
        let timer = null;
        box.addEventListener('click', (e) => {
            if (e.target.closest('#fb-search-clear')) {
                input.value = '';
                clearTimeout(timer);
                this.setQuery('');
                input.blur();
                return;
            }
            input.focus();
        });
        document.getElementById('fb-filter-chip').addEventListener('click', () => this.setFilter(null));
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => this.setQuery(input.value.trim()), 120);
            this.syncSearchUI(input.value);
        });
        input.addEventListener('focus', () => box.classList.add('open'));
        input.addEventListener('blur', () => this.syncSearchUI());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (input.value) {
                    input.value = '';
                    clearTimeout(timer);
                    this.setQuery('');
                }
                input.blur();
            } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                // Into the results: arrows and shortcuts work on the grid again
                e.preventDefault();
                clearTimeout(timer);
                this.setQuery(input.value.trim());
                input.blur();
                this.app.elements.mainInterface.focus();
            }
        });
    },

    // Ctrl+F or /: the grid, with the search box ready to type in
    focusSearch() {
        const app = this.app;
        if (!app.files.length || !app.dirHandle) return false;
        if (app.viewMode !== 'grid') app.setView('grid');
        const input = document.getElementById('fb-search');
        input.focus();
        input.select();
    },

    syncSearchUI(typed = null) {
        const box = document.getElementById('fb-search-box');
        const input = document.getElementById('fb-search');
        if (!box || !input) return;
        const value = typed !== null ? typed : input.value;
        box.classList.toggle('open', document.activeElement === input || !!value);
        box.classList.toggle('has-value', !!value);
        const chip = document.getElementById('fb-filter-chip');
        if (chip) {
            chip.classList.toggle('hidden', !this.filter);
            if (this.filter) {
                const icon = this.filter === 'star' ? this.ICONS.star : this.filter === 'rescan' ? this.ICONS.rescan
                    : this.filter === 'none' ? this.ICONS.none : `<i class="tf-dot" style="--c:${this.COLOR_HEX[this.filter]}"></i>`;
                chip.innerHTML = `<span class="fl-icon fl-${this.filter}">${icon}</span>${this.label(this.filter)}<span class="fc-x">${this.ICONS.clear}</span>`;
                chip.title = `Showing only ${this.label(this.filter)} — click to show everything`;
            }
        }
    },

    // ---- Context menu row ----

    // A row of flag buttons for the right-click menu
    menuRow(files) {
        const row = document.createElement('div');
        row.className = 'ctx-flags';
        const btn = (kind, html, title) => {
            const b = document.createElement('button');
            b.className = `ctx-flag fl-${kind}` + (kind !== 'clear' && files.length && files.every(f => this.has(f, kind)) ? ' on' : '');
            b.innerHTML = html;
            b.title = title;
            b.onclick = (ev) => {
                ev.stopPropagation();
                this.app.closeContextMenu();
                this.apply(kind, files);
            };
            row.appendChild(b);
        };
        const key = (id) => {
            const k = (this.app.keyBindings && this.app.keyBindings[id]) || [];
            return k.length ? ` (${this.app.formatCombo(k[0])})` : '';
        };
        btn('star', this.ICONS.star, 'Star' + key('flag.star'));
        btn('rescan', this.ICONS.rescan, 'Needs rescan' + key('flag.rescan'));
        this.COLORS.forEach((c, i) => btn(c, `<i class="tf-dot" style="--c:${this.COLOR_HEX[c]}"></i>`, `${this.label(c)} label` + key('flag.' + c)));
        btn('clear', this.ICONS.clear, 'Clear flags' + key('flag.clear'));
        return row;
    }
};
