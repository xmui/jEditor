// The sidebar's places (the Windows app): projects, pinned folders and the
// drives on this PC. In the sidebar under the open project's folders, and
// on the start screen.
//
//   Projects   every project in your projects folder (chosen the first
//              time, changed from the section's header), newest first,
//              with how many photos and when it last changed, and a
//              search box. Then recent projects opened from elsewhere.
//   Pinned     folders pinned here, and those pinned in Explorer's Quick
//              Access. They open out like Explorer's.
//   This PC    the drives. A USB drive plugged in while jEditor is open is
//              marked New, and can be ejected from here.
//
// Clicking a folder opens it as the project, straight away; the caret opens
// it out to show what's inside. A drive opens out when clicked.
// Above it all in the sidebar, the open project's card: its name, where it
// is, how many photos, Scan, and Show in Explorer.

const Places = {
    KEY_DIR: 'jeditor.projectsFolder',
    KEY_PINS: 'jeditor.pins',
    KEY_CLOSED: 'jeditor.sidebarClosed',
    SHOWN: 30, // projects listed before "Show all"

    expanded: new Set(), // folders opened out (paths, lowercase)
    listings: new Map(), // path → its folders (listDir)
    counts: new Map(),   // path → photos in it and below
    fresh: new Set(),    // drives plugged in since jEditor started, not yet looked at
    query: '',
    showAll: false,
    drives: null,
    quick: [],
    projects: null,      // the projects folder's folders

    icons: {
        folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
        project: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
        pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>',
        usb: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="9" width="10" height="13" rx="2"/><path d="M9 9V3h6v6"/><path d="M11 5.5h.01M13 5.5h.01"/></svg>',
        disk: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M5.5 13 8 4h8l2.5 9"/><path d="M17 17h.01"/></svg>',
        network: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="7" rx="2"/><path d="M7 6.5h.01"/><path d="M12 10v5"/><path d="M4 19h16"/><circle cx="12" cy="17" r="2"/></svg>',
        cd: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/></svg>',
        caret: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        eject: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15h14L12 7z"/><path d="M5 19h14"/></svg>',
        scan: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h16"/><path d="M6 13V5a1 1 0 0 1 1-1h7l4 4v5"/><path d="M5 17h14a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1z"/></svg>',
        reveal: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v7H3V3h7"/></svg>',
        split: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>',
        plus: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        rename: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/></svg>'
    },

    el(id) { return document.getElementById(id); },
    native() { return FolderCache.native(); },
    key(p) { return String(p || '').toLowerCase(); },
    esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },

    init(app) {
        this.app = app;
        if (!this.native()) return;
        this.boxes = [this.el('sb-places'), this.el('start-places')].filter(Boolean);
        for (const box of this.boxes) {
            box.addEventListener('click', (e) => this.onClick(e));
            // A double-click on a folder you're browsing opens it as the project
            box.addEventListener('dblclick', (e) => {
                const main = e.target.closest('.sb-main[data-act="toggle"]');
                const row = main && main.closest('.sb-row');
                if (row && row.dataset.path) this.open(row.dataset.path);
            });
            box.addEventListener('auxclick', (e) => { if (e.button === 1) this.onClick(e); });
            // Right-click a folder: open, rename, show in Explorer, pin
            box.addEventListener('contextmenu', (e) => {
                const row = e.target.closest('.sb-row');
                if (!row || !row.dataset.path) return;
                e.preventDefault();
                e.stopPropagation();
                this.app.openContextMenu(this.rowItems(row), e.clientX, e.clientY);
            });
            box.addEventListener('input', (e) => {
                if (!e.target.classList.contains('sb-search')) return;
                this.query = e.target.value;
                this.boxes.forEach(b => { const s = b.querySelector('.sb-search'); if (s && s !== e.target) s.value = this.query; });
                this.drawProjects();
            });
        }
        this.el('sb-card').addEventListener('dblclick', (e) => {
            // (not the pencil, which renames on its first click)
            if (e.target.closest('.sb-card-edit') || UI.isOpen()) return;
            if (e.target.closest('.sb-card-name[data-rename]')) this.cardAction('rename');
        });
        this.el('sb-card').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-act]');
            if (b) this.cardAction(b.dataset.act);
        });
        // Save edits when done (edits.js), for this project
        this.el('sb-card').addEventListener('change', async (e) => {
            const box = e.target.closest('input[data-act="defer"]');
            if (!box) return;
            await Edits.setDefer(box.checked);
            box.checked = Edits.defer;
        });
        addEventListener('jeditor-drives', () => this.drivesChanged());
        this.refresh();
    },

    // ---- Stored choices ----

    get(key, fallback) {
        try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private */ }
    },
    projectsDir() { return this.get(this.KEY_DIR, null); },
    pins() { return this.get(this.KEY_PINS, []); },
    closed() { return new Set(this.get(this.KEY_CLOSED, [])); },

    // ---- Loading ----

    // Everything again: drives, pins, the projects list
    async refresh() {
        const native = this.native();
        const dir = this.projectsDir();
        const [places, quick, projects] = await Promise.all([
            native.places().catch(() => ({ drives: [], home: [] })),
            native.quickAccess().catch(() => []),
            dir ? native.listProjects(dir).catch(() => null) : Promise.resolve(null)
        ]);
        if (this.drives === null) this.known = new Set(places.drives.map(d => this.key(d.path)));
        this.drives = places.drives;
        this.quick = quick;
        this.projects = projects;
        await this.draw();
    },

    async listing(path) {
        const k = this.key(path);
        if (!this.listings.has(k)) {
            try {
                this.listings.set(k, await this.native().listDir(path));
            } catch (e) {
                this.listings.set(k, { folders: [], gone: true });
            }
        }
        return this.listings.get(k);
    },

    // ---- Drawing ----

    async draw() {
        if (!this.boxes || !this.boxes.length) return;
        // A slower draw started earlier doesn't overwrite a newer one
        const gen = this._drawGen = (this._drawGen || 0) + 1;
        const html = await this.html();
        if (gen !== this._drawGen) return;
        for (const box of this.boxes) {
            const search = box.querySelector('.sb-search');
            const focused = search && document.activeElement === search;
            const pos = focused ? search.selectionStart : 0;
            box.innerHTML = html;
            if (focused) {
                const s = box.querySelector('.sb-search');
                s.focus();
                s.setSelectionRange(pos, pos);
            }
        }
        this.drawCard();
        this.loadCounts();
    },

    // Only the projects list (typing in search)
    async drawProjects() {
        const html = await this.projectRows();
        for (const box of this.boxes) {
            const list = box.querySelector('.sb-projects');
            if (list) list.innerHTML = html;
        }
        this.loadCounts();
    },

    async html() {
        const closed = this.closed();
        const section = (id, title, extra, body) =>
            `<div class="sb-sec${closed.has(id) ? ' closed' : ''}" data-sec="${id}">` +
            `<button class="sb-sec-btn" data-act="section" data-sec="${id}" aria-expanded="${!closed.has(id)}"><span class="sb-sec-caret">${this.icons.caret}</span>${title}</button>${extra}</div>` +
            (closed.has(id) ? '' : `<div class="sb-sec-body">${body}</div>`);

        const dir = this.projectsDir();
        const dirName = dir ? (dir.split(/[\\/]/).filter(Boolean).pop() || dir) : '';
        const projects = dir
            ? `<button class="btn secondary sm sb-new" data-act="newproject" title="Make a new folder in ${this.esc(dirName)} and open it">${this.icons.plus}New project</button>` +
              `<input class="field sm sb-search" type="search" placeholder="Search projects" value="${this.esc(this.query)}" aria-label="Search projects" spellcheck="false" autocomplete="off">` +
              `<div class="sb-projects">${await this.projectRows()}</div>`
            : `<button class="btn secondary sb-choose" data-act="choose">Choose your projects folder…</button>` +
              `<p class="sb-help">The folder your projects are in. Each folder in it is listed here, newest first.</p>`;
        const elsewhere = await this.elsewhereRows();

        const pins = await this.pinRows();
        const drives = await this.driveRows();
        return section('projects', 'Projects',
            dir ? `<button class="sb-sec-link" data-act="choose" title="${this.esc(dir)} — click to choose another folder">${this.esc(dirName)}</button>` : '',
            projects + (elsewhere ? `<div class="sb-sub">Opened from elsewhere</div>${elsewhere}` : '')) +
            section('pinned', 'Pinned', '', pins || '<p class="sb-help">Pin folders you use often with the pin by their name. Explorer\'s pinned folders show here too.</p>') +
            section('pc', 'This PC', '', drives || '<p class="sb-help">No drives found</p>');
    },

    // When: "Today", "Yesterday", "Mon", "Oct 3"
    when(ms) {
        return Recents.when(ms);
    },

    current() {
        return this.app.dirHandle ? this._currentPath : null;
    },

    row({ path, name, icon, depth = 0, caret = false, open = false, meta = '', count = false, cls = '', title = '', act = 'open', pin = null, extra = '' }) {
        const k = this.key(path);
        const cur = this.key(this.current()) === k;
        const c = count ? this.counts.get(k) : undefined;
        const countText = c === undefined ? '' : c < 0 ? '' : c >= (this.limit || 1000) ? `${c.toLocaleString()}+` : c.toLocaleString();
        return `<div class="fr-row sb-row${cur ? ' active' : ''} ${cls}" style="--depth:${depth}" data-path="${this.esc(path)}">` +
            (caret ? `<button class="fr-caret${open ? ' open' : ''}" data-act="toggle" tabindex="-1" title="${open ? 'Fold' : 'Show what\'s inside'}">${this.icons.caret}</button>` : '<span class="fr-caret fr-spacer"></span>') +
            `<button class="sb-main" data-act="${act}" title="${this.esc((title || path) + (act === 'open' ? ' — Ctrl+click opens it in a new window' : ''))}"><span class="sb-icon">${icon}</span><span class="fr-name">${this.esc(name)}</span></button>` +
            extra +
            (pin !== null ? `<button class="sb-pin${pin ? ' on' : ''}" data-act="${pin ? 'unpin' : 'pin'}" title="${pin ? 'Unpin' : 'Pin to the sidebar'}">${this.icons.pin}</button>` : '') +
            (meta ? `<span class="sb-meta">${this.esc(meta)}</span>` : '') +
            (count ? `<span class="fr-count" data-count="${this.esc(path)}">${countText}</span>` : '') +
            `</div>`;
    },

    // A folder and, if opened out, what's inside it. Clicking a project
    // (opts.project) opens it; any other folder only opens out, so browsing
    // (a drive, the folder all the projects are in) never loads one by
    // mistake: Open (or a double-click) makes it the project
    async tree(path, name, depth, opts = {}) {
        const open = this.expanded.has(this.key(path));
        const row = { ...(opts.row || {}) };
        if (!opts.project) {
            row.act = 'toggle';
            row.extra = `<button class="sb-open" data-act="open" title="Open ${this.esc(name)} as the project (or double-click it; Ctrl+click: in a new window)">Open</button>` + (row.extra || '');
        }
        let html = this.row({ path, name, icon: opts.icon || this.icons.folder, depth, caret: true, open, count: opts.count !== false, ...row });
        if (open) {
            const l = await this.listing(path);
            const kids = (l.folders || []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
            for (const k of kids) html += await this.tree(k.path, k.name, depth + 1, { row: { pin: this.isPinned(k.path) } });
            if (!kids.length) html += `<div class="sb-empty" style="--depth:${depth + 1}">${l.gone ? 'Not there any more' : 'No folders inside'}</div>`;
        }
        return html;
    },

    async projectRows() {
        if (!this.projects) {
            return this.projectsDir() ? '<p class="sb-help">The projects folder isn\'t there. Is the drive connected?</p>' : '';
        }
        const q = this.query.trim().toLowerCase();
        const list = q ? this.projects.filter(p => p.name.toLowerCase().includes(q)) : this.projects;
        const shown = q || this.showAll ? list : list.slice(0, this.SHOWN);
        let html = '';
        for (const p of shown) {
            html += await this.tree(p.path, p.name, 0, { project: true, icon: this.icons.project, row: { meta: this.when(p.modified), pin: this.isPinned(p.path) } });
        }
        if (!list.length) html += `<p class="sb-help">${q ? 'No project matches' : 'No projects in this folder yet'}</p>`;
        if (!q && !this.showAll && list.length > shown.length) html += `<button class="link-btn sb-more" data-act="all">Show all ${list.length.toLocaleString()}</button>`;
        return html;
    },

    // Recent projects that aren't in the projects folder
    async elsewhereRows() {
        const dir = this.key(this.projectsDir());
        const recents = await Recents.list().catch(() => []);
        const out = [];
        for (const r of recents) {
            const path = await this.native().folderPath(r.handle).catch(() => null);
            if (!path || (dir && this.key(path).startsWith(dir.replace(/\\?$/, '\\')))) continue;
            out.push(this.row({ path, name: r.name, icon: this.icons.project, meta: this.when(r.openedAt), count: true }));
            if (out.length >= 5) break;
        }
        return out.join('');
    },

    isPinned(path) {
        return this.pins().some(p => this.key(p.path) === this.key(path));
    },

    async pinRows() {
        const seen = new Set();
        let html = '';
        for (const p of this.pins()) {
            seen.add(this.key(p.path));
            html += await this.tree(p.path, p.name, 0, { icon: this.icons.pin, row: { pin: true, cls: 'sb-pinned' } });
        }
        for (const q of this.quick) {
            if (seen.has(this.key(q.path))) continue;
            seen.add(this.key(q.path));
            html += await this.tree(q.path, q.name, 0, { icon: this.icons.pin, row: { title: `${q.path} (pinned in Explorer)` } });
        }
        return html;
    },

    async driveRows() {
        const drives = (this.drives || []).slice().sort((a, b) => a.path.localeCompare(b.path));
        let html = '';
        for (const d of drives) {
            const k = this.key(d.path);
            const usb = d.kind === 'usb';
            const extra = (this.fresh.has(k) ? '<span class="sb-new">New</span>' : '') +
                (usb ? `<button class="sb-eject" data-act="eject" title="Eject ${this.esc(d.name)}">${this.icons.eject}</button>` : '');
            const fmt = (n) => this.app.formatBytes(n);
            html += await this.tree(d.path, d.name, 0, {
                icon: this.icons[d.kind] || this.icons.disk, count: false,
                row: { act: 'toggle', cls: usb ? 'sb-usb' : '', extra, title: `${d.name}${d.total ? ` — ${fmt(d.free)} free of ${fmt(d.total)}` : ''}` }
            });
        }
        return html;
    },

    // ---- Photo counts, filled in as they come ----

    loadCounts() {
        clearTimeout(this._countTimer);
        this._countTimer = setTimeout(async () => {
            const want = new Set();
            for (const box of this.boxes) {
                box.querySelectorAll('[data-count]').forEach(s => { if (!this.counts.has(this.key(s.dataset.count))) want.add(s.dataset.count); });
            }
            const paths = [...want];
            for (let i = 0; i < paths.length; i += 12) {
                const chunk = paths.slice(i, i + 12);
                let r;
                try { r = await this.native().countPhotos(chunk); } catch (e) { return; }
                this.limit = r.limit;
                chunk.forEach((p, j) => this.counts.set(this.key(p), r.counts[j]));
                this.fillCounts();
            }
        }, 50);
    },

    fillCounts() {
        for (const box of this.boxes) {
            box.querySelectorAll('[data-count]').forEach(s => {
                const c = this.counts.get(this.key(s.dataset.count));
                if (c === undefined || c < 0) return;
                s.textContent = c >= (this.limit || 1000) ? `${c.toLocaleString()}+` : c.toLocaleString();
            });
        }
    },

    // ---- The open project's card ----

    async drawCard() {
        const card = this.el('sb-card');
        const app = this.app;
        if (!card) return;
        if (!app.dirHandle) {
            card.innerHTML = '';
            return;
        }
        const path = await FolderCache.orderPath(app).catch(() => null);
        this._currentPath = path;
        let bytes = 0;
        for (const f of app.files) bytes += f.size || 0;
        const n = app.files.length;
        card.innerHTML =
            // The name: double-click it (or its pencil, on hover) to rename
            `<div class="sb-card-name"${path ? ' data-rename="1"' : ''} title="${this.esc(app.dirHandle.name)}${path ? ' (double-click to rename)' : ''}">${this.icons.project}<span>${this.esc(app.dirHandle.name)}</span>` +
            (path ? `<button class="sb-card-edit" data-act="rename" title="Rename this project" aria-label="Rename this project">${this.icons.rename}</button>` : '') + `</div>` +
            (path ? `<div class="sb-card-path" title="${this.esc(path)}">${this.esc(path)}</div>` : '') +
            `<div class="sb-card-meta">${n.toLocaleString()} photo${n === 1 ? '' : 's'} · ${app.formatBytes(bytes)}</div>` +
            `<div class="sb-card-btns">` +
            `<button class="btn primary sm" data-act="scan">${this.icons.scan}Scan</button>` +
            (path ? `<button class="btn secondary sm" data-act="reveal" title="Show in Explorer">${this.icons.reveal}Explorer</button>` : '') +
            `<button class="btn ghost icon sm" data-act="split" title="Split: this project and another window side by side">${this.icons.split}</button>` +
            (path ? `<button class="btn ghost icon sm sb-card-pin${this.isPinned(path) ? ' on' : ''}" data-act="pin" title="${this.isPinned(path) ? 'Unpin' : 'Pin to the sidebar'}">${this.icons.pin}</button>` : '') +
            `</div>` +
            (app.readOnlyMode ? '' : `<label class="sb-card-defer" title="Crops and turns are kept on the photos, to change as often as you like, and saved into them (or exported) when you're done"><input type="checkbox" data-act="defer"${Edits.defer ? ' checked' : ''}><span>Save edits when done</span></label>`);
        // The current project is marked in the lists
        for (const box of this.boxes) {
            box.querySelectorAll('.sb-row').forEach(r => r.classList.toggle('active', this.key(r.dataset.path) === this.key(path)));
        }
    },

    cardAction(act) {
        const path = this._currentPath;
        if (act === 'scan') Scan.open();
        else if (act === 'rename' && path) this.renameFolder(path);
        else if (act === 'split') Windows.split();
        else if (act === 'reveal' && path) this.native().reveal(path);
        else if (act === 'pin' && path) {
            if (this.isPinned(path)) this.unpin(path);
            else this.pin(path, this.app.dirHandle.name);
        }
    },

    // Called as the sidebar draws (Folders.render), and on going back to
    // the start screen: a different project redraws the lists
    apply() {
        if (!this.native() || !this.boxes) return;
        if (this._dir !== this.app.dirHandle) {
            this._dir = this.app.dirHandle;
            this.counts.clear(); // counted again: scans and moves change them
            this.draw();
        } else {
            this.drawCard();
        }
    },

    // ---- Clicks ----

    async onClick(e) {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        const row = b.closest('.sb-row');
        const path = row && row.dataset.path;
        if (act === 'section') return this.toggleSection(b.dataset.sec);
        if (act === 'choose') return this.chooseFolder();
        if (act === 'newproject') return this.newProject();
        if (act === 'all') { this.showAll = true; return this.drawProjects(); }
        if (!path) return;
        if (act === 'open' && (e.ctrlKey || e.button === 1)) return Windows.newWindow(path); // in a window of its own
        if (act === 'open') return this.open(path);
        if (act === 'toggle') {
            const k = this.key(path);
            if (this.expanded.has(k)) this.expanded.delete(k);
            else { this.expanded.add(k); this.listings.delete(k); }
            this.fresh.delete(k);
            return this.draw();
        }
        if (act === 'pin') return this.pin(path, row.querySelector('.fr-name').textContent);
        if (act === 'unpin') return this.unpin(path);
        if (act === 'eject') return this.eject(path, row.querySelector('.fr-name').textContent);
    },

    toggleSection(id) {
        const closed = this.closed();
        if (closed.has(id)) closed.delete(id); else closed.add(id);
        this.set(this.KEY_CLOSED, [...closed]);
        this.draw();
    },

    async chooseFolder() {
        const path = await this.native().pickPath('Choose your projects folder', this.projectsDir());
        if (!path) return;
        this.set(this.KEY_DIR, path);
        this.showAll = false;
        this.query = '';
        const closed = this.closed();
        closed.delete('projects');
        this.set(this.KEY_CLOSED, [...closed]);
        await this.refresh();
    },

    // A sidebar folder's right-click menu
    rowItems(row) {
        const path = row.dataset.path;
        const name = row.querySelector('.fr-name').textContent;
        const drive = /^[a-z]:\\?$/i.test(path) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(path);
        const pinned = this.pins().some(p => this.key(p.path) === this.key(path));
        const items = [];
        if (this.key(path) !== this.key(this.current())) items.push(['Open as the project', () => this.open(path)]);
        items.push(['Open in a new window', () => Windows.newWindow(path)]);
        if (!drive) items.push(['—'], ['Rename…', () => this.renameFolder(path)]);
        items.push(['—'], ['Show in Explorer', () => this.native().reveal(path)]);
        items.push([pinned ? 'Unpin' : 'Pin to the sidebar', () => pinned ? this.unpin(path) : this.pin(path, name)]);
        return items;
    },

    // Rename a project or folder. Its data (flags, kept edits, thumbnails)
    // goes with it (the app moves it); the open project, if it's this one
    // or inside it, is closed first and opened again after, and pins and
    // the projects folder follow too.
    async renameFolder(path) {
        const parts = path.split(/[\\/]/).filter(Boolean);
        const old = parts[parts.length - 1] || path;
        const name = await UI.prompt({
            title: 'Rename',
            message: 'Its flags, kept edits and thumbnails stay with it.',
            input: { label: 'New name', value: old },
            ok: 'Rename'
        });
        if (name === null || !name.trim() || name.trim() === old) return;
        const k = this.key(path).replace(/[\\/]+$/, '');
        const under = (p) => p && (this.key(p) === k || this.key(p).startsWith(k + '\\'));
        const moved = (p, to) => to + p.slice(k.length);
        const cur = this.current();
        const reopen = under(cur) ? cur : null;
        if (reopen) await this.app.closeFolder();
        let to;
        try {
            to = await this.native().renameFolder(path, name.trim());
        } catch (e) {
            if (reopen) await this.native().openPath(reopen).catch(() => { });
            UI.alert({ title: `Couldn't rename ${old}`, message: e.message });
            return;
        }
        // Everything that pointed at it, at its new name
        this.set(this.KEY_PINS, this.pins().map(p => under(p.path) ? { ...p, path: moved(p.path, to), name: this.key(p.path) === k ? name.trim() : p.name } : p));
        const dir = this.projectsDir();
        if (under(dir)) this.set(this.KEY_DIR, moved(dir, to));
        this.expanded = new Set([...this.expanded].map(e => under(e) ? this.key(moved(e, to)) : e));
        this.listings.clear();
        if (reopen) await this.native().openPath(moved(reopen, to)).catch(() => { });
        await this.refresh();
        this.app.showToast(`Renamed ${old} to ${name.trim()}`, 2500, null, null, { kind: 'rename' });
    },

    // A new folder in the projects folder, opened as the project
    async newProject() {
        const dir = this.projectsDir();
        if (!dir) return this.chooseFolder();
        const dirName = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
        const name = await UI.prompt({
            title: 'New project',
            message: `A new folder in ${dirName}, opened as the project, ready to scan or shoot into.`,
            input: { label: 'Name', placeholder: 'Smith Order' },
            ok: 'Create'
        });
        if (name === null || !name.trim()) return;
        try {
            const path = await this.native().makeFolder(dir, name.trim());
            this.listings.clear();
            await this.open(path);
            this.refresh();
        } catch (e) {
            UI.alert({ title: 'Couldn\'t make the project', message: e.message });
        }
    },

    async open(path) {
        if (this.key(path) === this.key(this.current())) return;
        const ok = await this.native().openPath(path).catch(() => false);
        if (!ok) {
            this.app.showToast(`Couldn't open ${path}: it isn't there any more`, 4000);
            this.listings.clear();
            this.refresh();
        }
    },

    pin(path, name) {
        const pins = this.pins().filter(p => this.key(p.path) !== this.key(path));
        pins.push({ path, name });
        this.set(this.KEY_PINS, pins);
        const closed = this.closed();
        closed.delete('pinned');
        this.set(this.KEY_CLOSED, [...closed]);
        this.draw();
    },

    unpin(path) {
        this.set(this.KEY_PINS, this.pins().filter(p => this.key(p.path) !== this.key(path)));
        this.draw();
    },

    async eject(path, name) {
        const app = this.app;
        // The open project on that drive goes first: Windows won't eject a drive in use
        const cur = this.current();
        if (cur && this.key(cur).startsWith(this.key(path))) {
            const ok = await UI.confirm({
                title: `Close ${app.dirHandle.name} and eject ${name}?`,
                message: 'The open project is on this drive, so it closes first. Edits are already saved.',
                ok: 'Close and eject'
            });
            if (!ok) return;
            await app.closeFolder();
        }
        app.beginTask('eject', `Ejecting ${name}…`);
        const r = await this.native().eject(path).catch(e => ({ ok: false, error: e.message }));
        app.endTask('eject');
        if (r.ok) app.showToast(`${name} can be taken out now`, 4000, null, null, { type: 'success' });
        else app.showToast(`Couldn't eject ${name}: ${r.error}`, 5000);
        this.drivesChanged();
    },

    // ---- Drives coming and going ----

    async drivesChanged() {
        const places = await this.native().places().catch(() => null);
        if (!places) return;
        const now = new Set(places.drives.map(d => this.key(d.path)));
        for (const d of places.drives) {
            const k = this.key(d.path);
            if (this.known && !this.known.has(k) && d.kind !== 'cd') {
                this.fresh.add(k);
                this.app.showToast(`${d.name} plugged in`, 10000, 'drive-' + k, { label: 'Show', run: () => this.reveal(d.path) }, { type: 'info' });
            }
        }
        this.known = now;
        for (const k of [...this.expanded]) if (![...now].some(d => k.startsWith(d))) this.expanded.delete(k);
        for (const k of [...this.fresh]) if (!now.has(k)) this.fresh.delete(k);
        this.drives = places.drives;
        this.listings.clear();
        await this.draw();
    },

    // A drive, opened out in the sidebar (or on the start screen)
    async reveal(path) {
        const app = this.app;
        const k = this.key(path);
        this.expanded.add(k);
        this.fresh.delete(k);
        const closed = this.closed();
        closed.delete('pc');
        this.set(this.KEY_CLOSED, [...closed]);
        if (app.dirHandle) {
            if (app.viewMode !== 'grid') app.setView('grid');
            if (!Folders.railOpen()) Folders.toggleRail();
        }
        await this.draw();
        for (const box of this.boxes) {
            const row = [...box.querySelectorAll('.sb-row')].find(r => this.key(r.dataset.path) === k);
            if (row && row.offsetParent) row.scrollIntoView({ block: 'nearest' });
        }
    }
};
