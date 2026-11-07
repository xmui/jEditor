// The Open a folder card: what the home page's Open a folder tile opens.
//
//   Search      finds recents and projects as you type (Enter opens the first)
//   Drag a folder here, or Browse…   (the picker: app.browseFolder)
//   Recent      the recent folders (recents.js), with a picture each
//   Photos library   where the app has it (photosLibrary, places.js)
//   Projects    every folder in the projects folder (places.js), newest
//               first, scrolling; each with three of its thumbnails from
//               the cache (folder-cache.js), or ghost frames without
//
// Where there's no folder to pick (Safari, phones: picked.js) the tile
// goes straight to the photo picker instead. Choosing the projects folder
// isn't in the card (Settings → Projects, or the sidebar); .oc-foot is
// kept for it.

const OpenCard = {
    SHOWN_RECENTS: 6,
    THUMBED: 40, // projects whose pictures are looked up
    icons: {
        search: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
        drop: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
        close: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
        photos: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>'
    },

    el(id) { return document.getElementById(id); },

    // A card wherever a folder can be picked; elsewhere the photo picker
    available() {
        return !(typeof Picked !== 'undefined' && Picked.available());
    },

    init(app) {
        this.app = app;
        if (this.el('open-card')) return;
        const box = document.createElement('div');
        box.id = 'open-card';
        box.className = 'dialog-overlay hidden';
        box.innerHTML =
            `<div class="dialog open-card" role="dialog" aria-modal="true" aria-labelledby="oc-title">` +
            `<div class="dialog-head"><h2 id="oc-title" class="dialog-title">Open a folder</h2>` +
            `<button id="oc-close" class="btn ghost icon" title="Close (Esc)" aria-label="Close">${this.icons.close}</button></div>` +
            `<div class="oc-top">` +
            `<label class="oc-search">${this.icons.search}<input id="oc-search" type="search" placeholder="Search projects and folders" aria-label="Search projects and folders" spellcheck="false" autocomplete="off"></label>` +
            `<div id="oc-drop" class="oc-drop"><span class="oc-drop-icon">${this.icons.drop}</span>` +
            `<span class="oc-drop-text"><span class="oc-drop-name">Drag a folder here</span><span class="oc-drop-sub">or a card, a drive or photos</span></span>` +
            `<button id="oc-browse" class="btn primary">Browse…</button></div>` +
            `<div id="oc-recent-box" class="oc-section hidden"><h3 class="oc-sub">Recent</h3><div id="oc-recents" class="oc-recents"></div></div>` +
            `</div>` +
            `<div id="oc-list" class="oc-list"></div>` +
            `<div id="oc-foot" class="oc-foot hidden"></div>` +
            `</div>`;
        document.body.appendChild(box);
        this.box = box;
        this.el('oc-close').addEventListener('click', () => this.close());
        this.el('oc-browse').addEventListener('click', () => { this.close(); app.browseFolder(); });
        box.addEventListener('mousedown', (e) => { if (e.target === box) this.close(); });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') this.step(e);
        });
        const search = this.el('oc-search');
        search.addEventListener('input', () => { this.query = search.value.trim().toLowerCase(); this.draw(); });
        search.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const first = box.querySelector('[data-oc]');
            if (first) { e.preventDefault(); first.click(); }
        });
        // A folder dragged in: the page opens it (script.js), the card goes
        const drop = this.el('oc-drop');
        box.addEventListener('dragover', () => drop.classList.add('over'));
        box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) drop.classList.remove('over'); });
        box.addEventListener('drop', () => { drop.classList.remove('over'); this.close(); });
        box.addEventListener('click', (e) => {
            const b = e.target.closest('[data-oc]');
            if (b) this.choose(b.dataset.oc, b.dataset.id);
        });
    },

    isOpen() { return !!this.box && !this.box.classList.contains('hidden'); },

    async open() {
        if (!this.box) return;
        this.query = '';
        this.el('oc-search').value = '';
        this.box.classList.remove('hidden');
        this.el('oc-search').focus({ preventScroll: true });
        await this.refresh();
    },

    close() {
        if (!this.isOpen()) return;
        this.box.classList.add('hidden');
        this._gen = (this._gen || 0) + 1; // what's still loading isn't drawn
        const tile = this.el('btn-browse-folder');
        if (tile && !this.app.dirHandle) tile.focus({ preventScroll: true });
    },

    revoke() {
        for (const u of this._urls || []) URL.revokeObjectURL(u);
        this._urls = [];
    },

    url(blob) {
        const u = URL.createObjectURL(blob);
        (this._urls = this._urls || []).push(u);
        return u;
    },

    esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
    },

    // What's in it, again: recents and the projects folder
    async refresh() {
        if (!this.isOpen()) return;
        const gen = this._gen = (this._gen || 0) + 1;
        const recents = typeof Recents !== 'undefined' && Recents.supported() ? await Recents.list().catch(() => []) : [];
        let projects = null;
        const dir = Host.has('places') && typeof Places !== 'undefined' ? Places.projectsDir() : null;
        if (dir) projects = await FolderCache.native().listProjects(dir).catch(() => null);
        if (gen !== this._gen) return;
        this.recents = recents.slice(0, this.SHOWN_RECENTS);
        this.projects = projects;
        this.dir = dir;
        this.pictures = new Map();
        this.draw();
        this.loadPictures(gen);
        this.loadCounts(gen);
    },

    match(name) {
        return !this.query || String(name).toLowerCase().includes(this.query);
    },

    frames(blobs, n) {
        let html = '';
        for (let i = 0; i < n; i++) {
            const b = blobs && blobs[i];
            html += b ? `<img class="oc-pic" src="${this.url(b)}" alt="" decoding="async">` : '<span class="oc-pic ghost"></span>';
        }
        return html;
    },

    draw() {
        if (!this.box) return;
        // The pictures shown now are let go once they're replaced
        const old = this._urls || [];
        this._urls = [];
        const recents = (this.recents || []).filter(r => this.match(r.name));
        const rbox = this.el('oc-recent-box');
        rbox.classList.toggle('hidden', !recents.length);
        this.el('oc-recents').innerHTML = recents.map(r =>
            `<button class="oc-recent" data-oc="recent" data-id="${this.esc(r.id)}" title="Open ${this.esc(r.name)}">` +
            `<span class="oc-pics one">${this.frames(r.thumbs, 1)}</span>` +
            `<span class="oc-text"><span class="oc-name">${this.esc(r.name)}</span><span class="oc-meta">${this.esc(Recents.when(r.openedAt))}</span></span></button>`).join('');

        let html = '';
        if (Host.has('photosLibrary') && this.match('Photos library')) {
            html += `<button class="oc-row oc-library" data-oc="library" title="The Photos library: its albums, to look through (read-only)">` +
                `<span class="oc-pics one oc-icon">${this.icons.photos}</span><span class="oc-name">Photos library</span><span class="oc-meta">Albums, read-only</span></button>`;
        }
        if (this.dir) {
            const list = (this.projects || []).filter(p => this.match(p.name));
            html += `<h3 class="oc-sub">Projects</h3>`;
            if (!this.projects) html += `<p class="oc-empty">The projects folder isn't there. Is the drive connected?</p>`;
            else if (!list.length) html += `<p class="oc-empty">${this.query ? 'No project matches' : 'No projects in this folder yet'}</p>`;
            html += list.map(p => {
                const count = Places.countText(p.path);
                const meta = [count ? `${count} photo${count === '1' ? '' : 's'}` : '', Recents.when(p.modified)].filter(Boolean).join(' · ');
                return `<button class="oc-row" data-oc="project" data-id="${this.esc(p.path)}" title="${this.esc(p.path)}">` +
                    `<span class="oc-pics">${this.frames(this.pictures.get(p.path), 3)}</span>` +
                    `<span class="oc-name">${this.esc(p.name)}</span><span class="oc-meta" data-oc-count="${this.esc(p.path)}">${this.esc(meta)}</span></button>`;
            }).join('');
        } else if (this.query && !recents.length) {
            html += '<p class="oc-empty">Nothing matches</p>';
        }
        this.el('oc-list').innerHTML = html;
        setTimeout(() => old.forEach(u => URL.revokeObjectURL(u)), 0);
    },

    // Three of each project's thumbnails, from the cache
    async loadPictures(gen) {
        const native = FolderCache.native();
        if (!native || !this.projects || !this.projects.length) return;
        let all;
        try { all = await native.dataDir(); } catch (e) { return; }
        let changed = false;
        for (const p of this.projects.slice(0, this.THUMBED)) {
            if (gen !== this._gen) return;
            try {
                const store = await all.getDirectoryHandle(FolderCache.storeName(p.path));
                const thumbs = await (await store.getDirectoryHandle('cache')).getDirectoryHandle('thumbs');
                const blobs = [];
                for await (const h of thumbs.values()) {
                    if (h.kind !== 'file') continue;
                    blobs.push(await h.getFile());
                    if (blobs.length === 3) break;
                }
                if (blobs.length) { this.pictures.set(p.path, blobs); changed = true; }
            } catch (e) { /* none kept: ghost frames */ }
        }
        if (changed && gen === this._gen) this.draw();
    },

    // How many photos each has (Places keeps them for the sidebar too)
    async loadCounts(gen) {
        const native = FolderCache.native();
        if (!native || !native.countPhotos || !this.projects) return;
        const want = this.projects.slice(0, this.THUMBED).map(p => p.path).filter(p => !Places.counts.has(Places.key(p)));
        for (let i = 0; i < want.length; i += 12) {
            if (gen !== this._gen) return;
            const chunk = want.slice(i, i + 12);
            let r;
            try { r = await native.countPhotos(chunk); } catch (e) { return; }
            Places.limit = r.limit;
            chunk.forEach((p, j) => Places.counts.set(Places.key(p), r.counts[j]));
        }
        if (gen !== this._gen) return;
        this.box.querySelectorAll('[data-oc-count]').forEach(s => {
            const p = (this.projects || []).find(x => x.path === s.dataset.ocCount);
            if (!p) return;
            const count = Places.countText(p.path);
            s.textContent = [count ? `${count} photo${count === '1' ? '' : 's'}` : '', Recents.when(p.modified)].filter(Boolean).join(' · ');
        });
    },

    choose(kind, id) {
        this.close();
        if (kind === 'recent') {
            const rec = (this.recents || []).find(r => r.id === id);
            if (rec) Recents.open(rec);
        } else if (kind === 'project') Places.open(id);
        else if (kind === 'library') Places.open(Places.LIBRARY);
    },

    // Up and down move through the search, recents and rows
    step(e) {
        const items = [this.el('oc-search'), ...this.box.querySelectorAll('[data-oc]')];
        const i = items.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        next.focus();
        if (next.scrollIntoView) next.scrollIntoView({ block: 'nearest' });
    }
};
