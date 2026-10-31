// Photos, Adjust and Paint as modes, like Lightroom's modules: a place you
// stay in, not a dialog. Where the switch is:
//
//   the sidebar open     Photos | Adjust | Paint along its top (#mode-seg)
//   the sidebar closed   a chip naming the mode in the folder pill, with a
//                        menu to switch (#mode-chip-bar)
//   single view, Adjust  the same chip on its own, top left (#mode-float)
//   and Paint
//
// Adjust and Paint have no Done bar: what's done is kept as you go, as in
// Lightroom. The switch, Esc or Enter go back to Photos keeping it (and
// Ctrl+Z there takes it off again); a film strip runs along the bottom
// (#mode-strip), and another photo there opens in the same mode.
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
            rail.prepend(seg);
        }
        // In a browser, leaving the page with something not kept asks too
        // (the apps ask in closing(); a held beforeunload there would just
        // stop the window closing)
        addEventListener('beforeunload', (e) => {
            if (!Host.get() && this.unkept()) { e.preventDefault(); e.returnValue = ''; }
        });
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
        // The strip in Adjust and Paint
        const strip = document.createElement('div');
        strip.id = 'mode-strip';
        strip.className = 'mode-strip';
        strip.setAttribute('aria-label', 'Photos: another one opens in this mode');
        strip.addEventListener('wheel', (e) => {
            if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            e.preventDefault();
            strip.scrollLeft += Wheel.pixels(e, strip).y;
        }, { passive: false });
        this.strip = strip;
        // Start in, on the landing page
        const start = this.el('start-in');
        if (start) {
            for (const b of start.querySelectorAll('[data-mode]')) {
                b.addEventListener('click', () => this.pickStart(b.dataset.mode));
            }
        }
        const blank = this.el('start-blank');
        if (blank) blank.addEventListener('click', () => this.paintStart());
        // Convert photos…: any folder, without opening it (convert.js)
        const convert = this.el('start-convert');
        if (convert) convert.addEventListener('click', () => Convert.open({ choose: true }));
        // A project opened from the landing page lands in Start in's mode
        const drop = app.elements.dropZone;
        if (drop) {
            let shown = !drop.classList.contains('hidden');
            new MutationObserver(() => {
                const now = !drop.classList.contains('hidden');
                if (shown && !now && !this.hold) this.pending = this.next || this.startIn();
                if (now) { this.pending = null; this.next = null; }
                shown = now;
                this.renderStart();
            }).observe(drop, { attributes: true, attributeFilter: ['class'] });
        }
        document.addEventListener('pointerdown', (e) => {
            if (this.menu && !this.menu.contains(e.target) && !e.target.closest('.mode-chip')) this.closeMenu();
        }, true);
        addEventListener('resize', () => this.closeMenu());
        this.render();
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

    startIn() {
        const m = this.app.uiPrefs && this.app.uiPrefs.startIn;
        return m && m !== 'photos' && this.on(m) ? m : 'photos';
    },

    pickStart(mode) {
        const app = this.app;
        app.uiPrefs.startIn = mode;
        app.saveUiPrefs();
        this.renderStart();
        if (mode === 'paint') this.paintStart();
    },

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
                b.innerHTML = `${this.icon(svg)}<span>${label}</span>`;
                b.addEventListener('click', () => this.go(m));
                seg.appendChild(b);
            }
        }
        const railShown = this.visible('folder-rail');
        const barShown = this.visible('folder-bar');
        // The chip in the folder pill: while the sidebar's closed
        const chipBar = this.el('mode-chip-bar');
        if (chipBar) {
            chipBar.classList.toggle('hidden', !any || railShown);
            this.drawChip(chipBar, mode);
        }
        // The chip on its own: single view (no folder pill), Adjust, Paint
        const float = this.el('mode-float');
        if (float) {
            const editing = mode !== 'photos';
            const crop = app.cropState && app.cropState.active && !editing;
            const want = any && open && !crop && (editing || (!barShown && !railShown));
            float.classList.toggle('hidden', !want);
            float.classList.toggle('over-mode', editing);
            this.drawChip(float.firstElementChild, mode);
        }
        this.placeStrip(mode);
        this.renderStart();
        // Closing the window asks first while in Adjust or Paint
        this.holdClose(mode !== 'photos');
    },

    holdClose(on) {
        const n = Host.get();
        if (!n || !n.holdClose || this._held === on) return;
        this._held = on;
        n.holdClose(on ? () => this.closing() : null);
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

    // ---- The strip in Adjust and Paint ----

    placeStrip(mode) {
        const app = this.app;
        const strip = this.strip;
        if (!strip) return;
        const host = mode === 'adjust' ? this.el('adjust-editor') : mode === 'paint' ? this.el('paint-editor') : null;
        const want = host && app.elements.thumbnailStrip && !app.elements.thumbnailStrip.classList.contains('hidden') && app.viewFiles().length > 1;
        if (!want) {
            if (strip.parentElement) strip.remove();
            this._stripFor = null;
            return;
        }
        if (strip.parentElement !== host) host.appendChild(strip);
        const files = app.viewFiles();
        const current = mode === 'adjust' ? Adjust.file : PaintEditor.file;
        // The same photos: kept as they are (their thumbnails loaded)
        const same = this._stripFor && this._stripFor.length === files.length && files.every((f, i) => f === this._stripFor[i]);
        if (!same || strip.childElementCount !== files.length) this.fillStrip(files);
        for (const div of strip.children) {
            div.classList.toggle('active', div._file === current);
            div.classList.toggle('sel', mode === 'adjust' && div._file !== current && app.selection.has(div._file));
        }
        const on = [...strip.children].find(d => d._file === current);
        if (on) {
            const target = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
            if (Math.abs(strip.scrollLeft - target) > 1) strip.scrollLeft = target;
        }
    },

    // In Adjust, Ctrl+click picks others too and Shift+click a run of
    // them, for Sync (adjust-sync.js); a plain click opens that one alone
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

    fillStrip(files) {
        const app = this.app;
        const strip = this.strip;
        strip.textContent = '';
        this._stripFor = files;
        if (this._observer) this._observer.disconnect();
        this._observer = new IntersectionObserver((entries) => {
            for (const en of entries) {
                if (!en.isIntersecting) continue;
                const div = en.target;
                this._observer.unobserve(div);
                const img = document.createElement('img');
                img.alt = '';
                img.draggable = false;
                div.appendChild(img);
                app.loadImageThumbnail(div._file, img).catch(() => { /* the name shows */ });
            }
        }, { root: strip, rootMargin: '0px 400px' });
        const frag = document.createDocumentFragment();
        for (const f of files) {
            const div = document.createElement('button');
            div.type = 'button';
            div.className = 'mode-thumb';
            div.title = f.relPath || f.name;
            div.setAttribute('aria-label', f.name);
            div._file = f;
            div.addEventListener('click', (e) => this.stripClick(f, e));
            div.addEventListener('contextmenu', (e) => {
                if (this.current() !== 'adjust') return;
                e.preventDefault();
                if (f !== Adjust.file && !app.selection.has(f)) this.stripSelect(new Set([...app.selection, Adjust.file, f]));
                app.openContextMenu(AdjustSync.stripItems(), e.clientX, e.clientY);
            });
            frag.appendChild(div);
            this._observer.observe(div);
        }
        strip.appendChild(frag);
    },

    // ---- Start in, on the landing page ----

    renderStart() {
        const start = this.el('start-in');
        if (!start || !this.app || !this.app.uiPrefs) return;
        const shown = this.shown();
        start.classList.toggle('hidden', shown.length < 2);
        const mode = this.startIn();
        for (const b of start.querySelectorAll('[data-mode]')) {
            b.classList.toggle('hidden', !this.on(b.dataset.mode));
            b.classList.toggle('active', b.dataset.mode === mode);
            b.setAttribute('aria-checked', String(b.dataset.mode === mode));
        }
        const blank = this.el('start-blank-wrap');
        if (blank) blank.classList.toggle('hidden', !this.on('paint'));
    }
};
