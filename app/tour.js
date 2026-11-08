// The welcome tour (take A): a step-by-step walk through the real app. Each
// stop lights up a real control (the rest of the window dims, but keeps
// working: press ] and the photo turns) with a card beside it that says
// what it does and its keys as they're set now. The tour goes to the view
// each stop needs: the grid with the sidebar, one photo, More opened,
// Adjust, Paint; at the end it puts the view back as it was.
//
// Offered once, on first run: a welcome card on the home page's empty table
// (#home-empty only shows before anything has been opened). Afterwards:
// the home page's gear menu, Help in a theme's menu bar, and "Watch the
// tour again" in the guide (guide.js).
//
// Ctrl+K works during it: Find anything opens over the tour's card.
//
// Every platform. Scan and Camera are stops only where the app has them
// (Host.has). In a browser (no app around the page) the tour ends with a
// few lines on what the apps also do, from the feature names the apps
// report (docs/platforms.md), and Download the full version.

const Tour = {
    KEY: 'jeditor.tour',
    state: { offered: false },
    running: false,
    steps: [],
    i: 0,

    // What the apps do that a browser can't, by feature name (Host.has):
    // the web's ending lists the first few
    APP_ONLY: [
        ['places', 'Your projects, pinned folders and drives in the sidebar'],
        ['scan', 'Scanning straight into a project'],
        ['camera', 'Shooting from a camera on a cable'],
        ['windows', 'Several windows side by side'],
        ['recycle', 'Deleting to the Recycle Bin, and Ctrl+Z bringing it back'],
        ['themes', 'Themes'],
        ['reveal', 'Show in Explorer or Finder']
    ],

    // Each stop: where it is (the view it needs), what it lights up (the
    // first of these that's on screen), its words and where its card goes.
    STOPS: [
        {
            id: 'open', view: 'home', when: () => !app.files || !app.files.length,
            target: ['#btn-browse-folder'], side: 'above',
            title: 'Start with a folder',
            text: () => 'Open a folder of your photos, or drop one on the window. The tour carries on from there.'
        },
        {
            id: 'modes', view: 'grid', target: ['#mode-seg', '#mode-chip-bar', '#mode-chip-float'], side: 'right',
            title: 'Three apps in one',
            text: () => 'Photos, Adjust and Paint, each with only what it needs on screen. {key:edit.adjust} opens Adjust, {key:edit.paint} Paint, and Esc comes back.'
        },
        {
            id: 'sidebar', view: 'grid', target: ['#folder-rail'], side: 'right',
            title: 'The sidebar',
            text: () => 'The folders in this project' +
                (Host.has('places') ? ', your projects, pinned folders and drives' : '') +
                (Host.has('photosLibrary') ? ', and your Photos library' : '') +
                ', and the flags you\'ve set. {key:folders.rail} shows or hides it.'
        },
        {
            id: 'strip', view: 'single', target: ['#thumbnail-strip'], side: 'above',
            title: 'Look, flag, move on',
            text: () => '{key:nav.prev} {key:nav.next} move through the folder. {key:flag.star} stars a photo and {key:flag.rescan} marks it to scan again; flags show here.'
        },
        {
            id: 'turn', view: 'single', target: ['#btn-rotate-left', '#btn-rotate-right'], both: true, side: 'above',
            title: 'Turn it the right way up',
            text: () => 'Try it: {key:edit.rotateRight}. It\'s saved to the file straight away, and {key:edit.undo} puts it back.'
        },
        {
            id: 'crop', view: 'single', toolbar: true, target: ['#btn-crop'], side: 'below',
            title: 'Crop and straighten',
            text: () => '{key:edit.crop} opens Crop: drag the corners, turn the dial. {key:crop.save} saves, and {key:crop.saveNext} saves and opens the next photo.'
        },
        {
            id: 'scan', needs: 'scan', view: 'single', toolbar: true, target: ['#btn-scan'], side: 'below',
            title: 'Scan',
            text: () => 'Scans go straight into this project. Lay prints on the glass: each one becomes a photo of its own.'
        },
        {
            id: 'camera', needs: 'camera', view: 'single', toolbar: true, target: ['#btn-camera'], side: 'below',
            title: 'Shoot from the camera',
            text: () => 'With the camera on a USB cable, the photos you take come straight into this project, RAW files too.'
        },
        {
            id: 'more', view: 'single', more: false, target: ['#btn-more'], side: 'below',
            title: 'The rest is a click away',
            text: () => 'Rename ({key:edit.rename}), move ({key:edit.moveTo}), export and the rest are in More and the right-click menu, so the screen stays clear.'
        },
        {
            id: 'find', view: 'single', target: ['#mode-chip-bar', '#mode-chip-float', '#mode-seg'], side: 'below',
            title: 'Find anything',
            text: () => 'Or just type what you want: {key:app.palette}, then a command, a photo, a folder or a project, and Enter runs it. Each command shows its key, so you learn them. It\'s in this menu too.'
        },
        {
            id: 'dupes', view: 'single', more: true, target: ['#btn-dupes'], side: 'below',
            title: 'Find duplicates',
            text: () => 'Groups the photos that look the same and suggests which to keep. Nothing goes until you say.'
        },
        {
            id: 'convert', view: 'single', more: true, target: ['#btn-convert'], side: 'below',
            title: 'Convert to save room',
            text: () => 'AVIF, WebP or JPEG XL: the same photos in much less space, for a few photos or a whole folder.'
        },
        {
            id: 'adjust', view: 'adjust', target: ['#adj-panel'], side: 'left', square: true,
            title: 'Adjust: light and colour',
            text: () => 'Exposure, white balance, curves and film looks, as in Lightroom. Nothing is lost: the photo stays as it was until you save or export.'
        },
        {
            id: 'paint', view: 'paint', target: ['#paint-tools'], side: 'right', square: true,
            title: 'Paint: layers and brushes',
            text: () => 'Brush, fill, text and shapes, on layers over the photo. They\'re kept with the project, so the painting can be changed later.'
        },
        {
            id: 'end', view: 'single', target: [], side: 'center', end: true,
            title: 'That\'s jEditor',
            text: () => 'Whenever you need it, the guide has short how-tos and every shortcut: {key:app.guide}.'
        }
    ],

    init() {
        try { Object.assign(this.state, JSON.parse(localStorage.getItem(this.KEY) || '{}')); } catch (e) { /* new */ }
        // Esc leaves the tour (before the app's own Esc, which would leave Adjust)
        addEventListener('keydown', (e) => {
            if (!this.running || e.key !== 'Escape' || (typeof Guide !== 'undefined' && Guide.isOpen)) return;
            if (typeof Palette !== 'undefined' && Palette.isOpen()) return; // Find anything closes first
            if (document.querySelector('.modal:not(.hidden), .context-menu:not(.hidden), #context-menu')) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            this.end();
        }, true);
        addEventListener('resize', () => { if (this.running) this.place(); });
        // The empty table shows once the home page knows nothing's been opened
        let tries = 0;
        const wait = setInterval(() => {
            if (this.offer() || ++tries > 40) clearInterval(wait);
        }, 150);
    },

    save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.state)); } catch (e) { /* not kept */ } },

    esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); },
    // Words with each {key:id} as its keycaps, as the keys are set now
    words(text) {
        return this.esc(text).replace(/\{key:([\w.]+)\}/g, (_, id) => {
            const k = app.keyBindings && app.keyBindings[id] && app.keyBindings[id][0];
            return k ? `<span class="tour-keys">${app.formatCombo(k).split(' + ').map(p => `<kbd class="guide-k">${this.esc(p)}</kbd>`).join('')}</span>` : '';
        }).replace(/ \(\)/g, '').replace(/\s+([.,;:])/g, '$1');
    },
    seen(el) {
        if (!el || !el.getClientRects().length) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    },
    home() { return app.elements.mainInterface.classList.contains('hidden'); },

    // ---- The offer: a welcome card on the empty table ----
    offer() {
        const empty = document.getElementById('home-empty');
        if (this.state.offered || this.running || !empty || empty.classList.contains('hidden') || !this.home()) return false;
        if (empty.querySelector('.tour-offer')) return true;
        const card = document.createElement('div');
        card.className = 'tour-offer';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-labelledby', 'tour-offer-title');
        const tile = (svg, name) => `<span class="tour-offer-mode"><svg class="i" viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>${name}</span>`;
        card.innerHTML = `<div class="tour-offer-modes">${Modes.LIST.map(m => tile(m[3], m[1])).join('')}</div>
            <h2 id="tour-offer-title">Welcome to jEditor</h2>
            <p>Three apps in one, and only what you need on screen. Take a one‑minute tour?</p>
            <div class="tour-offer-row"><button type="button" class="btn ghost" data-later>Not now</button><button type="button" class="btn primary" data-go>Take the tour</button></div>
            <small>The tour and the guide are in the ⚙ menu any time, and F1 opens the guide.</small>`;
        card.querySelector('[data-later]').addEventListener('click', () => this.dropOffer());
        card.querySelector('[data-go]').addEventListener('click', () => { this.dropOffer(); this.start(); });
        empty.classList.add('tour-offering');
        empty.appendChild(card);
        return true;
    },
    dropOffer() {
        this.state.offered = true;
        this.save();
        document.querySelector('.tour-offer')?.remove();
        document.getElementById('home-empty')?.classList.remove('tour-offering');
    },

    // ---- The tour ----
    start() {
        if (typeof Guide !== 'undefined' && Guide.isOpen) Guide.close();
        if (!this.state.offered) this.dropOffer();
        if (this.running) this.end(true);
        this.steps = this.STOPS.filter(s => (!s.needs || Host.has(s.needs)) && (!s.when || s.when()));
        this.was = {
            view: document.body.dataset.view,
            rail: this.seen(document.getElementById('folder-rail'))
        };
        this.railFlips = 0;
        this.running = true;
        document.body.classList.add('touring');
        this.hole = document.createElement('div');
        this.hole.className = 'tour-hole';
        this.hole.setAttribute('aria-hidden', 'true');
        this.card = document.createElement('div');
        this.card.className = 'tour-card';
        this.card.setAttribute('role', 'dialog');
        this.card.setAttribute('aria-live', 'polite');
        this.card.setAttribute('aria-labelledby', 'tour-title');
        this.card.tabIndex = -1;
        this.card.addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]');
            if (!b) return;
            const act = b.dataset.act;
            if (act === 'next') this.go(this.i + 1);
            else if (act === 'back') this.go(this.i - 1);
            else if (act === 'end') this.end();
            else if (act === 'guide') { this.end(); Guide.open('start'); }
            else if (act === 'open') document.getElementById('btn-browse-folder')?.click();
        });
        document.body.append(this.hole, this.card);
        this.go(0);
        this.card.focus({ preventScroll: true });
        clearInterval(this.timer);
        // Layout moves (a panel opens, the window's resized): follow it.
        // The first stop goes on by itself once a folder is open.
        this.timer = setInterval(() => {
            if (!this.running || this.busy) return;
            if (this.steps[this.i]?.id === 'open' && !this.home() && app.files && app.files.length) this.go(this.i + 1);
            else this.place();
        }, 300);
    },

    async go(i) {
        if (!this.running || i < 0 || i >= this.steps.length) return;
        this.i = i;
        this.busy = true;
        this.card.classList.add('moving');
        try { await this.ready(this.steps[i]); } catch (e) { /* show it where it can */ }
        this.busy = false;
        if (!this.running || this.i !== i) return;
        this.card.classList.remove('moving');
        this.place(true);
    },

    async mode(m) {
        if (typeof Modes === 'undefined' || Modes.current() === m) return;
        await Modes.go(m);
        const ok = () => m === 'adjust' ? Adjust.isOpen && Adjust.ready : m === 'paint' ? PaintEditor.isOpen && PaintEditor.ready : Modes.current() === 'photos';
        for (let t = 0; t < 60 && !ok(); t++) await new Promise(r => setTimeout(r, 80));
    },

    toggleRail() {
        const h = app.keyHandlers()['folders.rail'];
        if (h) { h(); this.railFlips++; }
    },

    more(open) {
        const hc = app.elements.headerControls, btn = app.elements.btnMore;
        if (!hc || !btn || !this.seen(btn)) return;
        if (hc.classList.contains('expanded') !== open) btn.click();
    },

    // Take the app to the view a stop needs
    async ready(s) {
        if (s.view === 'home') return;
        if (s.view === 'adjust' || s.view === 'paint') { this.more(false); await this.mode(s.view); return; }
        await this.mode('photos');
        if (s.view === 'grid') {
            if (document.body.dataset.view !== 'grid') app.setView('grid');
            await new Promise(r => setTimeout(r, 60));
            if (!this.seen(document.getElementById('folder-rail'))) this.toggleRail();
        } else if (s.view === 'single' && document.body.dataset.view !== 'single') {
            if (app.currentFile) app.setView('single');
            else if (app.files && app.files.length) app.openSingle(app.files[0]);
        }
        await new Promise(r => setTimeout(r, 60));
        if (s.more !== undefined) this.more(s.more);
        // A toolbar button the user put under More: open More to show it
        else if (s.toolbar) this.more(!this.seen(document.querySelector(s.target[0])) && document.querySelector(s.target[0])?.closest('#header-controls') ? true : false);
        else this.more(false);
        await new Promise(r => setTimeout(r, 60));
    },

    // The lit-up part: one element, or the box round two (the turn buttons)
    rect(s) {
        const els = s.target.map(q => document.querySelector(q)).filter(e => this.seen(e));
        if (!els.length) return null;
        const list = s.both ? els : [els[0]];
        const rs = list.map(e => e.getBoundingClientRect());
        const left = Math.min(...rs.map(r => r.left)), top = Math.min(...rs.map(r => r.top));
        const right = Math.max(...rs.map(r => r.right)), bottom = Math.max(...rs.map(r => r.bottom));
        return { left: Math.max(0, left), top: Math.max(0, top), right: Math.min(innerWidth, right), bottom: Math.min(innerHeight, bottom) };
    },

    place(fill = false) {
        if (!this.running) return;
        const s = this.steps[this.i];
        const r = s.end ? null : this.rect(s);
        const pad = s.square ? 0 : 6;
        const h = this.hole.style;
        if (r) {
            const w = r.right - r.left, ht = r.bottom - r.top;
            Object.assign(h, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: w + pad * 2 + 'px', height: ht + pad * 2 + 'px' });
            this.hole.classList.toggle('square', !!s.square);
            this.hole.classList.toggle('pill', !s.square && ht <= 64);
        } else {
            Object.assign(h, { left: innerWidth / 2 + 'px', top: innerHeight / 2 + 'px', width: '0px', height: '0px' });
        }
        if (fill) this.fill(s);
        // The card: beside what's lit, on the side asked for if it fits
        const c = this.card, W = c.offsetWidth, H = c.offsetHeight, gap = 14, m = 16;
        // Never up in the window's top: a theme's bars, the Mac's toolbar
        // or traffic lights (UI.topSafe)
        const top = UI.topSafe() + m;
        let x = innerWidth / 2 - W / 2, y = innerHeight / 2 - H / 2;
        if (r) {
            const fits = {
                below: r.bottom + pad + gap + H <= innerHeight - m, above: r.top - pad - gap - H >= top,
                right: r.right + pad + gap + W <= innerWidth - m, left: r.left - pad - gap - W >= m
            };
            const side = fits[s.side] ? s.side : ['below', 'above', 'right', 'left'].find(k => fits[k]) || 'inside';
            const cx = (r.left + r.right) / 2 - W / 2, cy = (r.top + r.bottom) / 2 - H / 2;
            if (side === 'below') { x = cx; y = r.bottom + pad + gap; }
            else if (side === 'above') { x = cx; y = r.top - pad - gap - H; }
            else if (side === 'right') { x = r.right + pad + gap; y = cy; }
            else if (side === 'left') { x = r.left - pad - gap - W; y = cy; }
            else { x = r.right - W - m; y = r.bottom - H - m; }
        }
        c.style.left = Math.round(Math.max(m, Math.min(innerWidth - W - m, x))) + 'px';
        c.style.top = Math.round(Math.max(top, Math.min(innerHeight - H - m, y))) + 'px';
    },

    fill(s) {
        const n = this.steps.length, i = this.i;
        const web = !Host.get();
        const gaps = s.end && web ? this.APP_ONLY.filter(([f]) => !Host.has(f)).slice(0, 4) : [];
        const get = gaps.length ? this.download() : null;
        let buttons;
        if (s.id === 'open') buttons = '<button type="button" class="btn primary" data-act="open">Open a folder</button>';
        else if (s.end) buttons = `<button type="button" class="btn ${get ? 'ghost' : 'secondary'}" data-act="guide">Open the guide</button>` +
            (get ? `<a class="btn primary" href="${this.esc(get)}" rel="noopener" target="_blank">Download the full version</a>` : '<button type="button" class="btn primary" data-act="end">Done</button>');
        else buttons = (i > 0 ? '<button type="button" class="btn ghost" data-act="back">Back</button>' : '') + `<button type="button" class="btn primary" data-act="next">${i === n - 2 ? 'Finish' : 'Next'}</button>`;
        this.card.innerHTML = `<button type="button" class="tour-x" data-act="end" title="End the tour (Esc)" aria-label="End the tour">×</button>
            <div class="tour-progress" aria-hidden="true"><i style="width:${Math.round((i + 1) / n * 100)}%"></i></div>
            <div class="tour-step">${i + 1} of ${n}</div>
            <h3 id="tour-title">${this.esc(s.title)}</h3>
            <p>${this.words(s.text())}</p>
            ${gaps.length ? `<p class="tour-gaps-head">The full version, for Windows, Mac and Linux, also has:</p><ul class="tour-gaps">${gaps.map(([, what]) => `<li>${this.esc(what)}</li>`).join('')}</ul>` : ''}
            <div class="tour-foot">${buttons}</div>`;
        this.card.classList.toggle('wide', gaps.length > 0);
    },

    // The app for this computer, from the home page's list (start.js)
    download() {
        const all = typeof Start !== 'undefined' && typeof APP_VERSION !== 'undefined' ? Start.downloads(APP_VERSION) : {};
        const mine = all[Start.device()];
        const first = mine && mine.find(d => d.href);
        return first ? first.href : `${Start.RELEASES}/latest`;
    },

    async end(quiet = false) {
        if (!this.running) return;
        this.running = false;
        clearInterval(this.timer);
        this.hole?.remove();
        this.card?.remove();
        document.body.classList.remove('touring');
        if (quiet || this.home()) return;
        // Back as it was: Photos, its view, the sidebar
        this.more(false);
        await this.mode('photos');
        if (this.was.view && document.body.dataset.view !== this.was.view && (this.was.view === 'grid' || app.currentFile)) app.setView(this.was.view);
        await new Promise(r => setTimeout(r, 60));
        if (this.railFlips % 2 && this.seen(document.getElementById('folder-rail')) !== this.was.rail) this.toggleRail();
    }
};
