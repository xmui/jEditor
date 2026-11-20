// Photos, Adjust and Paint as modes, like Lightroom's modules: a place you
// stay in, not a dialog. Where the switch is:
//
//   the sidebar open     one row along its top (#mode-row): Photos ·
//                        Adjust · Paint as icons at the left (#mode-seg),
//                        the sidebar button and Find anything at the right
//   the sidebar closed   the same row, in the same place, as a glass pill
//                        (jEditor's own look; a theme keeps its switch in
//                        the sidebar, and the chip below in the folder pill)
//   Adjust and Paint     the sidebar beside them, as in Photos, and the row
//                        with it; hidden, the row in their head's corner
//                        (a theme: a chip naming the mode, #mode-float)
//
// Adjust and Paint have no Done bar: what's done is kept as you go, as in
// Lightroom. The switch, Esc or Enter go back to Photos keeping it (and
// Ctrl+Z there takes it off again); the film strip runs along the bottom,
// the same one as Photos' (#thumbnail-strip, moved in: its size, badges,
// clicks and showing or hiding are the same everywhere), and another photo
// there opens in the same mode.
//
// The landing page's Start in (Photos · Adjust · Paint, remembered) is
// where a project opened from it lands; Paint there asks what to paint on
// (blank.js: a new canvas, or an image or folder to open).

const Modes = {
    LIST: [
        ['photos', 'Photos', '', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
        ['adjust', 'Adjust', 'E', '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'],
        ['paint', 'Paint', 'B', '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z"/><path d="M9.2 12c-2.5 0-4.2 1.6-4.2 4 0 1.5-.8 2.6-2.4 3.4C4.4 21 6.3 21.5 8 21.5c3 0 5-1.9 4.9-4.6z"/>']
    ],

    el(id) { return document.getElementById(id); },

    icon(svg) {
        return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
    },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        // The sidebar's switch, along its top
        const rail = this.el('folder-rail');
        if (rail) {
            const seg = document.createElement('div');
            seg.id = 'mode-seg';
            seg.className = 'mode-seg';
            seg.setAttribute('role', 'radiogroup');
            seg.setAttribute('aria-label', 'Mode');
            // The one row: the modes, then the sidebar button and Find
            const row = document.createElement('div');
            row.id = 'mode-row';
            row.className = 'mode-row';
            row.setAttribute('role', 'toolbar');
            row.setAttribute('aria-label', 'Modes');
            const gap = document.createElement('span');
            gap.className = 'mode-row-gap';
            gap.setAttribute('aria-hidden', 'true');
            const side = this.rowButton('mode-row-side', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>');
            side.setAttribute('aria-controls', 'folder-rail');
            side.addEventListener('click', () => { if (typeof Folders !== 'undefined') Folders.toggleRail(); });
            const find = this.rowButton('mode-row-find', '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');
            find.addEventListener('click', () => { if (typeof Palette !== 'undefined') Palette.open(); });
            row.append(seg, gap, side, find);
            rail.prepend(row);
        }
        // In a browser, leaving the page with something not kept asks too
        // (the apps ask in closing(); a held beforeunload there would just
        // stop the window closing)
        addEventListener('beforeunload', (e) => {
            if (!Host.get() && this.unkept()) { e.preventDefault(); e.returnValue = ''; }
        });
        // Reload in the apps, as a browser's (which has its own): Ctrl+R,
        // ⌘R on the Mac (its menu's View → Reload sends it here too). Plain
        // R stays Rescan folder.
        addEventListener('keydown', (e) => {
            if (Host.get() && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyR') {
                e.preventDefault();
                e.stopPropagation();
                this.reload();
            }
        }, true);
        // The chip, in the folder pill (after the sidebar button) and on its own
        const bar = this.el('folder-bar');
        if (bar) {
            const chip = this.makeChip('mode-chip-bar');
            const after = this.el('fb-rail');
            if (after) after.after(chip); else bar.prepend(chip);
        }
        const float = document.createElement('div');
        float.id = 'mode-float';
        float.className = 'mode-float toolbar hidden';
        float.appendChild(this.makeChip('mode-chip-float'));
        document.body.appendChild(float);
        // The film strip's place in Photos, to put it back when Adjust or
        // Paint closes (placeStrip)
        const strip = this.strip = app.elements.thumbnailStrip;
        if (strip) {
            this.stripHome = document.createComment('film strip');
            (app.elements.stripResize || strip).before(this.stripHome);
        }
        const blank = this.el('start-blank');
        // New project: a folder for photos or a blank canvas (places.js asks which)
        if (blank) blank.addEventListener('click', () => typeof Places !== 'undefined' ? Places.newProject() : this.paintStart());
        // Convert photos: photos (converted on this page) or any folder,
        // without opening it (convert.js)
        const convert = this.el('start-convert');
        if (convert) convert.addEventListener('click', (e) => { e.stopPropagation(); Convert.startMenu(convert); });
        // A project opened from the home page lands in Photos, unless a tile said otherwise
        const drop = app.elements.dropZone;
        if (drop) {
            let shown = !drop.classList.contains('hidden');
            new MutationObserver(() => {
                const now = !drop.classList.contains('hidden');
                if (shown && !now && !this.hold) this.pending = this.next || 'photos';
                if (now) { this.pending = null; this.next = null; }
                shown = now;
                this.renderStart();
            }).observe(drop, { attributes: true, attributeFilter: ['class'] });
        }
        document.addEventListener('pointerdown', (e) => {
            if (this.menu && !this.menu.contains(e.target) && !e.target.closest('.mode-chip')) this.closeMenu();
        }, true);
        addEventListener('resize', () => { this.closeMenu(); this.chipRoom(); });
        // A theme on or off, full screen (the Mac's lights): the chip moves
        new MutationObserver(() => this.chipRoom()).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-skin', 'style'] });
        this.render();
    },

    rowButton(id, svg) {
        const b = document.createElement('button');
        b.id = id;
        b.type = 'button';
        b.className = 'tb-btn mode-row-btn';
        b.innerHTML = this.icon(svg);
        return b;
    },

    makeChip(id) {
        const b = document.createElement('button');
        b.id = id;
        b.type = 'button';
        b.className = 'mode-chip';
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.menu) this.closeMenu(); else this.openMenu(b, e.detail === 0);
        });
        return b;
    },

    on(mode) {
        return this.LIST.some(([m]) => m === mode);
    },

    // The modes shown: Photos, Adjust and Paint
    shown() {
        return this.LIST;
    },

    current() {
        const t = this.app && this.app.cropState && this.app.cropState.tool;
        if (t === 'adjust' && typeof Adjust !== 'undefined' && Adjust.isOpen) return 'adjust';
        if (t === 'paint' && typeof PaintEditor !== 'undefined' && PaintEditor.isOpen) return 'paint';
        return 'photos';
    },

    // ---- Switching ----

    // Leave Adjust or Paint, keeping what was done (as Done does).
    // → true when it's closed
    async leave(quiet = false) {
        const app = this.app;
        const mode = this.current();
        if (mode === 'adjust') {
            if (!Adjust.ready || Adjust.busy) return false;
            await app.saveAdjust({ quiet });
            return !Adjust.isOpen;
        }
        if (mode === 'paint') {
            if (PaintEditor.float) PaintEditor.commitFloat();
            if (!PaintEditor.ready || PaintEditor.busy) return false;
            await app.savePaint({ quiet });
            return !PaintEditor.isOpen;
        }
        return true;
    },

    async enter(mode, file) {
        const app = this.app;
        if (mode === 'adjust') await app.enterAdjust(file);
        else if (mode === 'paint') await app.enterPaint(file);
        // It couldn't open (a GIF, say): the photo, in Photos
        if (this.current() !== mode && file && app.currentFile !== file) app.openSingle(file);
    },

    async go(mode) {
        const app = this.app;
        this.closeMenu();
        const from = this.current();
        if (mode === from || this._busy) return;
        if (!this.on(mode)) return;
        if (from === 'photos' && app.cropState.active) {
            app.showToast('Finish cropping first (Enter, or Esc)', 2000);
            return;
        }
        const file = app.currentFile;
        if (mode !== 'photos' && !file) {
            if (mode === 'paint') Blank.open();
            else app.showToast('Open a photo first', 2000);
            return;
        }
        this._busy = true;
        try {
            // Into another mode: quietly (what was done is kept all the same)
            if (!(await this.leave(mode !== 'photos'))) return;
            if (mode !== 'photos') await this.enter(mode, file);
        } finally {
            this._busy = false;
            this.render();
        }
    },

    // Another photo, in the mode it's in (from the strip)
    async step(file) {
        const app = this.app;
        const mode = this.current();
        if (!file || this._busy) return;
        if (mode === 'photos') { app.openSingle(file); return; }
        if (file === (mode === 'adjust' ? Adjust.file : PaintEditor.file)) return;
        this._busy = true;
        try {
            if (!(await this.leave(true))) return;
            await this.enter(mode, file);
        } finally {
            this._busy = false;
            this.render();
        }
    },

    // The photo before or after this one (Shift+Enter), in the same mode
    stepBy(dir = 1) {
        const app = this.app;
        const files = app.viewFiles();
        const mode = this.current();
        const cur = mode === 'adjust' ? Adjust.file : mode === 'paint' ? PaintEditor.file : app.currentFile;
        const f = files[files.indexOf(cur) + dir];
        if (!f) { app.showToast(dir > 0 ? 'That was the last photo' : 'That was the first photo', 1500); return; }
        return this.step(f);
    },

    // ---- The landing page ----

    // Paint from the landing page: what to paint on
    paintStart() {
        Blank.open(null, { start: true });
    },

    // A project just opened: from the landing page, into Start in's mode
    afterLoad() {
        const mode = this.pending || this.next;
        this.pending = null;
        this.next = null;
        this.render();
        if (!mode || mode === 'photos' || this.hold) return;
        const app = this.app;
        // A folder of photos: the first one shown (the grid's first)
        const file = app.currentFile || app.viewFiles()[0];
        if (!file) return;
        requestAnimationFrame(() => {
            if (this.current() !== 'photos' || app.cropState.active) return;
            this.enter(mode, file);
        });
    },

    // ---- Drawing the switch ----

    render() {
        const app = this.app;
        if (!app) return;
        const shown = this.shown();
        const any = shown.length > 1;
        const mode = this.current();
        const ui = app.elements.mainInterface;
        const open = !!ui && !ui.classList.contains('hidden');
        document.documentElement.classList.toggle('modes-on', any);
        // Into or out of an editing mode: the sidebar as that mode has it
        // (folders.js: railOpen), which renders this again
        if (this._railFor !== mode) {
            this._railFor = mode;
            if (typeof Folders !== 'undefined' && Folders.app) { Folders.render(); return; }
        }
        // The sidebar's switch
        const seg = this.el('mode-seg');
        if (seg) {
            seg.classList.toggle('hidden', !any);
            seg.textContent = '';
            for (const [m, label, key, svg] of shown) {
                const b = document.createElement('button');
                b.type = 'button';
                b.dataset.mode = m;
                b.setAttribute('role', 'radio');
                b.setAttribute('aria-checked', String(m === mode));
                b.className = m === mode ? 'on' : '';
                b.title = key ? `${label} (${key})` : label;
                b.setAttribute('aria-label', label);
                b.innerHTML = `${this.icon(svg)}<span>${label}</span>`;
                b.addEventListener('click', () => this.go(m));
                seg.appendChild(b);
            }
        }
        const railShown = this.visible('folder-rail');
        const barShown = this.visible('folder-bar');
        const own = !document.documentElement.dataset.skin;
        // (Adjust and Paint are open inside the crop state: only Photos' crop counts)
        const crop = app.cropState && app.cropState.active && mode === 'photos';
        this.renderRow(own, railShown, any && open && !crop, mode !== 'photos');
        // The chip in the folder pill: while the sidebar's closed, in a
        // theme (in jEditor's own look the row stays, as a pill)
        const chipBar = this.el('mode-chip-bar');
        if (chipBar) {
            chipBar.classList.toggle('hidden', !any || railShown || own);
            this.drawChip(chipBar, mode);
        }
        // The chip on its own: single view (no folder pill), Adjust, Paint
        const float = this.el('mode-float');
        if (float) {
            const editing = mode !== 'photos';
            const want = any && open && !crop && (editing || (!own && !barShown && !railShown));
            float.classList.toggle('hidden', !want);
            float.classList.toggle('over-mode', editing);
            this.drawChip(float.firstElementChild, mode);
        }
        this.chipRoom();
        this.placeStrip(mode);
        this.renderStart();
        // Closing the window asks first while in Adjust or Paint
        this.holdClose(mode !== 'photos');
    },

    // The row: along the sidebar's top while it's open; closed, the same
    // row floats where it was, as a pill, and the folder pill moves over
    // for it (--mode-row-w). In a theme it's only the switch, in the sidebar
    renderRow(own, docked, want, editing) {
        const row = this.el('mode-row');
        const rail = this.el('folder-rail');
        if (!row || !rail) return;
        const float = own && !docked;
        if (float ? row.parentElement !== document.body : row.parentElement !== rail) {
            if (float) document.body.appendChild(row); else rail.prepend(row);
        }
        row.classList.toggle('float', float);
        row.classList.toggle('toolbar', float);
        row.classList.toggle('hidden', float && !want);
        const over = float && editing;
        if (row.classList.contains('over-mode') !== over) {
            row.classList.toggle('over-mode', over);
            // Their head moves as the sidebar goes (style.css: .mode-screen's
            // left): its room for the row is measured again once it's there
            clearTimeout(this.roomLater);
            this.roomLater = setTimeout(() => this.chipRoom(), 320);
        }
        const side = this.el('mode-row-side');
        const app = this.app;
        const can = typeof Folders !== 'undefined' && Folders.enabled() && (app.viewMode === 'grid' || Folders.besideSingle());
        side.classList.toggle('hidden', !can);
        side.title = Host.keys(docked ? 'Hide the sidebar (Ctrl+B)' : 'Show the sidebar (Ctrl+B)');
        side.setAttribute('aria-label', docked ? 'Hide the sidebar' : 'Show the sidebar');
        side.setAttribute('aria-expanded', String(docked));
        const keys = (app.keyBindings && app.keyBindings['app.palette']) || [];
        const find = this.el('mode-row-find');
        find.title = keys.length ? Host.keys(`Find anything (${keys[0]})`) : 'Find anything';
        find.setAttribute('aria-label', 'Find anything');
        find.classList.toggle('hidden', typeof Palette === 'undefined');
        // At once, so the folder pill is never under it for a frame
        const shown = float && !editing && !row.classList.contains('hidden');
        document.documentElement.style.setProperty('--mode-row-w', shown ? `${Math.ceil(row.getBoundingClientRect().width)}px` : '0px');
        if (shown && typeof Folders !== 'undefined' && Folders.fitBar) Folders.fitBar();
    },

    // Over Adjust and Paint the chip floats in their head's left corner, and
    // their buttons on its right: the head keeps that much room each side,
    // so its title (centred) never slides under them in a narrow window (on
    // the Mac, the chip is after the traffic lights too)
    chipRoom() {
        cancelAnimationFrame(this.roomFrame);
        this.roomFrame = requestAnimationFrame(() => {
            const row = this.el('mode-row');
            const float = row && row.classList.contains('over-mode') ? row : this.el('mode-float');
            const on = float && float.classList.contains('over-mode') && !float.classList.contains('hidden') && float.getClientRects().length > 0;
            const right = on ? float.getBoundingClientRect().right : 0;
            for (const head of document.querySelectorAll('.adj-head, .paint-head')) {
                const h = head.getBoundingClientRect();
                const acts = head.querySelector('.mode-head-acts');
                // In jEditor's own look the buttons are a pill at the
                // right, over the photo: the file's pill keeps clear of them
                const own = !document.documentElement.dataset.skin;
                const a = (on || own) && acts && acts.getBoundingClientRect();
                head.style.paddingLeft = right && h.width ? `${Math.ceil(right - h.left) + 12}px` : '';
                head.style.paddingRight = a && a.width ? `${Math.ceil(h.right - a.left) + 12}px` : '';
            }
        });
    },

    holdClose(on) {
        const n = Host.get();
        if (!n || !n.holdClose || this._held === on) return;
        this._held = on;
        n.holdClose(on ? () => this.closing() : null);
    },

    // The page again, asking first (as closing does) if something isn't kept
    async reload() {
        if (this.reloading) return;
        this.reloading = true;
        try {
            if (await this.closing()) location.reload();
        } finally {
            this.reloading = false;
        }
    },

    // Anything done in Adjust or Paint that isn't kept yet
    unkept() {
        const mode = this.current();
        const ed = mode === 'adjust' ? Adjust : mode === 'paint' ? PaintEditor : null;
        return !!ed && ed.isOpen && (ed.busy || (ed.ready && ed.changedSinceOpen()));
    },

    // The window closing in Adjust or Paint: "Keep your changes?" (true: close)
    async closing() {
        if (this.unkept()) {
            const adjust = this.current() === 'adjust';
            const ed = adjust ? Adjust : PaintEditor;
            const choice = await UI.choose({
                title: 'Keep your changes?',
                message: `What you did to ${ed.file ? ed.file.name : 'this photo'} in ${adjust ? 'Adjust' : 'Paint'} isn't kept yet.`,
                ok: 'Keep',
                alt: 'Don\'t keep',
                altDanger: true
            });
            if (!choice) return false;
            if (choice === 'ok') {
                while (ed.busy) await new Promise(r => setTimeout(r, 100));
                // (Not kept: saving said why, and the window stays)
                if (!(await this.leave(true))) return false;
            }
        }
        await Edits.flush().catch(() => { });
        return true;
    },

    visible(id) {
        const e = this.el(id);
        return !!e && !e.classList.contains('hidden') && e.offsetParent !== null;
    },

    drawChip(b, mode) {
        const [, label, , svg] = this.LIST.find(x => x[0] === mode);
        b.innerHTML = `${this.icon(svg)}<span>${label}</span><svg class="i mode-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
        b.title = `${label}: switch to ${this.shown().filter(x => x[0] !== mode).map(x => x[1]).join(' or ')}`;
        b.setAttribute('aria-label', `Mode: ${label}`);
        b.classList.toggle('editing', mode !== 'photos');
    },

    // byKeys: opened with Enter or Space, so Esc gives the chip the keys back
    openMenu(chip, byKeys = false) {
        this.closeMenu();
        const mode = this.current();
        const menu = document.createElement('div');
        menu.className = 'mode-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Mode');
        for (const [m, label, key, svg] of this.shown()) {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'menuitemradio');
            b.setAttribute('aria-checked', String(m === mode));
            b.className = 'mode-mi' + (m === mode ? ' on' : '');
            const hint = m === 'photos' ? (mode !== 'photos' ? 'Esc' : '') : key;
            b.innerHTML = `${this.icon(svg)}<span>${label}</span>${hint ? `<kbd>${hint}</kbd>` : ''}`;
            b.addEventListener('click', () => this.go(m));
            menu.appendChild(b);
        }
        // Find anything (palette.js), in each mode: the one menu every mode has
        if (typeof Palette !== 'undefined') {
            const keys = (this.app.keyBindings && this.app.keyBindings['app.palette']) || [];
            const f = document.createElement('button');
            f.type = 'button';
            f.setAttribute('role', 'menuitem');
            f.className = 'mode-mi mode-find';
            f.innerHTML = `${this.icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}<span>Find anything…</span>${keys.length ? `<kbd>${this.app.formatCombo(keys[0]).replace(/ \+ /g, '+')}</kbd>` : ''}`;
            f.addEventListener('click', () => { this.closeMenu(); Palette.open(); });
            menu.appendChild(f);
        }
        document.body.appendChild(menu);
        const r = chip.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left))}px`;
        menu.style.top = `${r.bottom + 6}px`;
        chip.setAttribute('aria-expanded', 'true');
        this.menu = menu;
        this.menuChip = chip;
        this.menuByKeys = byKeys;
        menu.addEventListener('keydown', (e) => {
            const items = [...menu.querySelectorAll('button')];
            const i = items.indexOf(document.activeElement);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeMenu(true); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); items[(i + 1) % items.length].focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(i - 1 + items.length) % items.length].focus(); }
        });
        (menu.querySelector('.on') || menu.firstElementChild).focus();
    },

    closeMenu(refocus = false) {
        if (!this.menu) return;
        this.menu.remove();
        this.menu = null;
        if (this.menuChip) {
            this.menuChip.setAttribute('aria-expanded', 'false');
            // Not after a click: its keyboard ring would show, and stay
            if (refocus && this.menuByKeys) this.menuChip.focus();
        }
        this.menuChip = null;
    },

    // ---- The film strip, in every mode ----

    // Photos' own film strip, at the bottom of Adjust or Paint while one
    // is open, and back in its place in Photos after
    placeStrip(mode) {
        const app = this.app;
        const strip = app.elements.thumbnailStrip;
        if (!strip || !this.stripHome) return;
        const resize = app.elements.stripResize;
        // (a blank canvas with no folder open: no photos, no strip)
        const host = !app.viewFiles().length ? null : mode === 'adjust' ? this.el('adjust-editor') : mode === 'paint' ? this.el('paint-editor') : null;
        const parts = resize ? [resize, strip] : [strip];
        if (host) {
            if (strip.parentElement !== host) host.append(...parts);
        } else if (strip.parentElement !== this.stripHome.parentNode) {
            this.stripHome.after(...parts);
        }
        // Picked for Sync, in Adjust: a ring inside (the open one's outside)
        const sel = mode === 'adjust' ? app.selection : null;
        for (const div of strip.querySelectorAll('.thumb-item')) this.markStrip(div, sel);
        if (host) app.updateActiveThumbnail();
    },

    // One item's Sync ring (sel: the photos picked, in Adjust; else none)
    markStrip(div, sel = this.current() === 'adjust' ? this.app.selection : null) {
        div.classList.toggle('sel', !!sel && div._file !== this.app.currentFile && sel.has(div._file));
    },

    // A click on the film strip, in any mode: that photo, in this mode. In
    // Adjust, Ctrl+click picks others too and Shift+click a run of them,
    // for Sync (adjust-sync.js)
    stripClick(f, e) {
        const app = this.app;
        const cur = Adjust.file;
        if (this.current() !== 'adjust' || !cur || !(e.ctrlKey || e.metaKey || e.shiftKey)) {
            if (this.current() === 'adjust') this.stripSelect(new Set([f]));
            this.step(f);
            return;
        }
        const sel = new Set([...app.selection, cur]);
        if (e.shiftKey) {
            const files = app.viewFiles();
            const [i, j] = [files.indexOf(cur), files.indexOf(f)].sort((x, y) => x - y);
            for (const x of files.slice(i, j + 1)) sel.add(x);
        } else if (f !== cur) {
            if (sel.has(f)) sel.delete(f);
            else sel.add(f);
        }
        this.stripSelect(sel);
    },

    stripSelect(sel) {
        const app = this.app;
        app.selection = sel;
        if (app.updateSelectionUI) app.updateSelectionUI();
        this.placeStrip(this.current());
        AdjustSync.selected();
    },

    // A film strip photo being dragged (into Paint)
    STRIP_TYPE: 'application/x-jeditor-strip',
    dragging: null,

    // What a film strip item does besides a click (script.js: makeStripItem):
    // dragged into Paint, a layer; right-clicked in Adjust, Sync's menu
    wireStripItem(div, f) {
        const app = this.app;
        div.draggable = true;
        div.addEventListener('dragstart', (e) => {
            if (this.current() !== 'paint' || f === PaintEditor.file) { e.preventDefault(); return; }
            this.dragging = f;
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData(this.STRIP_TYPE, f.name);
        });
        div.addEventListener('dragend', () => { this.dragging = null; });
        div.addEventListener('contextmenu', (e) => {
            if (this.current() !== 'adjust') return;
            e.preventDefault();
            if (f !== Adjust.file && !app.selection.has(f)) this.stripSelect(new Set([...app.selection, Adjust.file, f]));
            app.openContextMenu(AdjustSync.stripItems(), e.clientX, e.clientY);
        });
        this.markStrip(div);
    },

    // ---- The home page's tiles (start.js) ----

    renderStart() {
        if (typeof Start !== 'undefined' && Start.app) Start.tiles();
    }
};
