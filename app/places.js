// Browse (the Windows app): other orders, folders and drives, from the
// sidebar and the start screen.
//
// The folder list gets two tabs: This order (its folders) and Browse.
// Browse starts with recent orders, the drives on this PC (USB sticks show
// up as they're plugged in) and the usual folders. Click one to look
// inside, with how many photos each folder has; Open as order opens the
// folder you're in. On the start screen the same list sits under Recent.
// A USB drive plugged in while jEditor is open offers to browse it.

class PlaceBrowser {
    // `el`: where it draws; `recents`: list recent orders first
    constructor(el, { recents = false } = {}) {
        this.el = el;
        this.recents = recents;
        this.path = null; // null: the top (recent orders, drives, folders)
        this.seq = 0;
        el.classList.add('pl');
        el.addEventListener('click', (e) => this.onClick(e));
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && this.path && !e.target.closest('input')) {
                e.preventDefault();
                this.up();
            }
        });
    }

    esc(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    async go(path) {
        this.path = path || null;
        await this.render();
        const first = this.el.querySelector('.pl-row, .pl-open');
        if (first && this.el.contains(document.activeElement)) first.focus();
    }

    up() {
        this.go(this.listing && this.listing.parent || null);
    }

    async onClick(e) {
        const b = e.target.closest('button');
        if (!b || !this.el.contains(b)) return;
        if (b.classList.contains('pl-up')) this.up();
        else if (b.classList.contains('pl-top')) this.go(null);
        else if (b.classList.contains('pl-open')) Places.open(b.dataset.path);
        else if (b.dataset.recent) Places.openRecent(b.dataset.recent);
        else if (b.dataset.path) this.go(b.dataset.path);
    }

    async render() {
        const seq = ++this.seq;
        const native = FolderCache.native();
        if (!native) return;
        if (this.path === null) {
            const places = await Places.places();
            const recents = this.recents ? (await Recents.list().catch(() => [])).slice(0, 6) : [];
            if (seq !== this.seq) return;
            this.listing = null;
            this.el.innerHTML = this.top(places, recents);
            return;
        }
        let listing;
        try {
            listing = await native.listDir(this.path);
        } catch (e) {
            if (seq !== this.seq) return;
            Places.app.showToast(`Couldn't open ${this.path}: ${e.message}`, 4000);
            this.path = null;
            return this.render();
        }
        if (seq !== this.seq) return;
        this.listing = listing;
        this.el.innerHTML = this.folder(listing);
    }

    section(title, rows) {
        return rows.length ? `<div class="pl-section">${this.esc(title)}</div>${rows.join('')}` : '';
    }

    row({ path, name, meta = '', icon = Places.icons.folder, cls = '', title = '', recent = '' }) {
        const data = recent ? `data-recent="${this.esc(recent)}"` : `data-path="${this.esc(path)}"`;
        return `<button class="fr-row pl-row ${cls}" ${data} title="${this.esc(title || path || name)}">` +
            `<span class="pl-icon">${icon}</span><span class="fr-name">${this.esc(name)}</span>` +
            (meta ? `<span class="fr-count">${this.esc(meta)}</span>` : '') + '</button>';
    }

    top(places, recents) {
        const app = Places.app;
        const current = app.dirHandle ? app.dirHandle.name : null;
        const fmt = (n) => app.formatBytes(n);
        const drives = places.drives
            .slice()
            .sort((a, b) => (a.kind === 'usb' ? 0 : 1) - (b.kind === 'usb' ? 0 : 1) || a.path.localeCompare(b.path))
            .map(d => this.row({
                path: d.path, name: d.name, icon: Places.icons[d.kind] || Places.icons.disk,
                meta: d.kind === 'usb' ? 'USB' : '', cls: d.kind === 'usb' ? 'pl-usb' : '',
                title: `${d.name}${d.total ? ` — ${fmt(d.free)} free of ${fmt(d.total)}` : ''}`
            }));
        return this.section('Recent orders', recents.map(r => this.row({
            recent: r.id, name: r.name, icon: Places.icons.order,
            meta: r.name === current ? 'Open' : Recents.when(r.openedAt), cls: r.name === current ? 'pl-current' : ''
        }))) +
            this.section('Drives', drives) +
            this.section('Folders', places.home.map(h => this.row({ path: h.path, name: h.name }))) +
            (places.drives.length || places.home.length ? '' : '<p class="pl-empty">No drives found</p>');
    }

    folder(l) {
        // A drive by its name ("USB drive (E:)"), not just E:\
        const drive = !l.parent && (Places.last || { drives: [] }).drives.find(d => d.path.toLowerCase() === l.path.toLowerCase());
        if (drive) l = { ...l, name: drive.name };
        const photos = l.photos ? `${l.photos.toLocaleString()}${l.more ? '+' : ''} photo${l.photos === 1 && !l.more ? '' : 's'}` : 'No photos here';
        const head = `<div class="pl-head">` +
            `<button class="btn ghost icon pl-up" title="Up (Backspace)" aria-label="Up one folder"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>` +
            `<div class="pl-where" title="${this.esc(l.path)}"><div class="pl-name">${this.esc(l.name)}</div><div class="pl-path">${this.esc(l.path)}</div></div>` +
            `<button class="btn ghost icon pl-top" title="Drives and recent orders" aria-label="Back to the start"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg></button>` +
            `</div>` +
            `<button class="btn primary pl-open" data-path="${this.esc(l.path)}" title="Open ${this.esc(l.path)} in jEditor">Open as order <span class="pl-photos">${photos}</span></button>`;
        const sorted = l.folders.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        const rows = sorted.map(f => this.row({ path: f.path, name: f.name }));
        return head + `<div class="pl-list">${rows.length ? rows.join('') : '<p class="pl-empty">No folders inside</p>'}</div>`;
    }
}

const Places = {
    tab: 'order', // the folder list: 'order' or 'browse'
    drives: null, // what was plugged in when last looked (paths)

    icons: {
        folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
        order: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
        usb: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="9" width="10" height="13" rx="2"/><path d="M9 9V3h6v6"/><path d="M11 5.5h.01M13 5.5h.01"/></svg>',
        disk: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M5.5 13 8 4h8l2.5 9"/><path d="M17 17h.01"/></svg>',
        network: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="7" rx="2"/><path d="M7 6.5h.01"/><path d="M12 10v5"/><path d="M4 19h16"/><circle cx="12" cy="17" r="2"/></svg>',
        cd: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/></svg>'
    },

    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        if (!FolderCache.native()) return;
        this.rail = new PlaceBrowser(this.el('rail-browse'), { recents: true });
        this.start = new PlaceBrowser(this.el('start-browse-list'));
        this.el('fr-tab-order').addEventListener('click', () => this.setTab('order'));
        this.el('fr-tab-browse').addEventListener('click', () => this.setTab('browse'));
        addEventListener('jeditor-drives', () => this.drivesChanged());
        this.start.render();
        this.places().then(p => { this.drives = new Set(p.drives.map(d => d.path)); }).catch(() => { });
    },

    async places() {
        try {
            return this.last = await FolderCache.native().places();
        } catch (e) {
            return { drives: [], home: [] };
        }
    },

    setTab(tab) {
        this.tab = tab;
        this.apply();
        if (tab === 'browse') this.rail.render();
    },

    // Called as the folder list draws (Folders.render)
    apply() {
        const rail = this.el('folder-rail');
        if (!rail || !this.rail) return;
        const browse = this.tab === 'browse';
        rail.classList.toggle('browsing', browse);
        this.el('fr-tab-order').classList.toggle('active', !browse);
        this.el('fr-tab-browse').classList.toggle('active', browse);
        this.el('fr-tab-order').setAttribute('aria-selected', String(!browse));
        this.el('fr-tab-browse').setAttribute('aria-selected', String(browse));
    },

    // Shows a folder in Browse: in the folder list with an order open,
    // else on the start screen
    async show(path) {
        const app = this.app;
        if (app.dirHandle) {
            if (app.viewMode !== 'grid') app.setView('grid');
            if (!Folders.railOpen()) Folders.toggleRail();
            this.setTab('browse');
            await this.rail.go(path);
        } else {
            await this.start.go(path);
        }
    },

    async open(path) {
        const ok = await FolderCache.native().openPath(path).catch(() => false);
        if (!ok) {
            this.app.showToast(`Couldn't open ${path}: it isn't there any more`, 4000);
            return;
        }
        this.tab = 'order';
        this.apply();
    },

    async openRecent(id) {
        const rec = (await Recents.list()).find(r => r.id === id);
        if (!rec) return;
        this.tab = 'order';
        this.apply();
        await Recents.open(rec);
    },

    // A drive came or went: redraw, offer a new USB drive, and step out of
    // one that's gone
    async drivesChanged() {
        const places = await this.places();
        const now = new Set(places.drives.map(d => d.path));
        const before = this.drives || now;
        this.drives = now;
        for (const d of places.drives) {
            if (before.has(d.path) || d.kind === 'cd') continue;
            this.app.showToast(`${d.name} plugged in`, 10000, 'drive-' + d.path,
                { label: 'Browse', run: () => this.show(d.path) }, { type: 'info' });
        }
        for (const b of [this.rail, this.start]) {
            const gone = b.path && ![...now].some(p => b.path.toLowerCase().startsWith(p.toLowerCase()));
            if (gone) b.path = null;
            if (b.path === null || gone) b.render();
        }
    }
};
