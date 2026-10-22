// Scanning (the Windows app): photos from a scanner straight into the open
// project, in the scan dock: a panel floating over the photos (drag it by
// its title, resize it by its edges, make it small with —) that never blocks
// anything, so you can keep working, or work in another window, while it
// scans.
//
//   setup     which scanner (only those plugged in and on; the rest under
//             More…), which folder of the project and how to name the
//             photos: next in the folder's sequence (Smith-014.jpg after
//             Smith-013.jpg), worked out from what's there; How (the glass
//             or the feeder, from what the scanner has) and jEditor's own
//             settings: resolution, color, sides (feeder: backs saved as
//             Smith-014-b.jpg), file type and quality, brightness and
//             contrast, and saved setups; only what the scanner can do
//             (resolutions up to its optical one, grayscale, backs, its
//             own crop). No scanner window: Advanced has the scanner's own
//             window, for when jEditor's aren't enough.
//   scanning  the last photos in, as they land (each also shows up in the
//             grid straight away), Show each one turned on or off, and Stop
//   done      how many, and Scan more (names carry on), Change settings
//
// The glass (How → Glass):
//   preview   the glass, small, with a box round each print found on it
//             (scan-preview.js); boxes can be moved, resized, tilted, turned,
//             drawn (or a print clicked) and deleted. The settings sit
//             beside it (brightness and contrast show on the preview). Scan:
//             one scan of the glass, saved as a photo per box. Scan more
//             previews again.
//
// Details (the >_ button) shows the app's log as it's written: what the
// scanner's driver is doing, for when it isn't. It opens by itself when a
// scan fails.

const Scan = {
    KEY: 'jeditor.scan', // last scanner used (this PC)
    KEY_COMPAT: 'jeditor.scanCompat', // scanners in compatibility mode
    KEY_POS: 'jeditor.scanDock', // where the dock was dragged to
    KEY_DETAILS: 'jeditor.scanDetails', // Details showing
    KEY_MODE: 'jeditor.scanMode', // how each scanner is used: glass, feeder or driver
    KEY_SWAP: 'jeditor.scanSwap', // scanners whose front and back are swapped
    KEY_AUTOSIZE: 'jeditor.scanAutoSize', // feeders that crop each photo themselves (off: jEditor does)
    KEY_BED: 'jeditor.scanBed', // each scanner's glass size, when chosen
    KEY_EPSON: 'jeditor.scanEpson', // an Epson feeder's own fixes, when changed: { even, streaks }
    KEY_KEEP: 'jeditor.scanKeep', // scanners kept listed though not found plugged in (on the network)
    KEY_SIZE: 'jeditor.scanDockSize', // the dock's size, when it was resized
    MORE: '\u0000more', // the scanner list's More… item

    // Glass sizes (inches). Auto: what the scanner says, else what jEditor
    // knows of the model, else A4
    BEDS: [
        ['auto', 'As the scanner says'],
        ['a4', 'A4 · 8.3 × 11.7 in', 8.27, 11.69],
        ['letter', 'Letter · 8.5 × 11 in', 8.5, 11],
        ['epson', '8.5 × 11.7 in (most flatbeds)', 8.5, 11.7],
        ['legal', 'Legal · 8.5 × 14 in', 8.5, 14],
        ['a3', 'A3 · 11.7 × 16.5 in', 11.69, 16.54],
        ['tabloid', '11 × 17 in', 11, 17]
    ],
    KNOWN_BEDS: [[/OpticBook\s*A300/i, 'a3'], [/Perfection\s*V\d{3}/i, 'epson'], [/OpticBook\s*3[89]00|OpticBook\s*4800/i, 'letter']],
    KEY_OPTS: 'jeditor.scanOpts', // the settings last used
    KEY_DEV_OPTS: 'jeditor.scanOptsBy', // …and with each scanner
    KEY_SETUPS: 'jeditor.scanSetups', // saved setups: [{ name, …settings }]
    caps: {}, // what each scanner can do (asked once)
    STRIP: 6, // photos shown in the dock
    STRIP_SIZED: 60, // …once it's been made bigger
    PHOTO: /^(.*?)(\d+)\.(jpe?g|tiff?|png|webp)$/i,

    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        const panel = this.el('scan-panel');
        if (!panel || !Host.has('scan')) return;
        this.el('btn-scan').addEventListener('click', () => this.open());
        this.el('scan-x').addEventListener('click', () => this.close());
        this.el('scan-min').addEventListener('click', () => this.setSmall(!panel.classList.contains('small')));
        this.el('scan-cancel').addEventListener('click', () => this.close());
        this.el('scan-stop').addEventListener('click', () => FolderCache.native().cancelScan());
        this.el('scan-settings').addEventListener('click', () => this.setState('setup'));
        this.el('scan-refresh').addEventListener('click', () => this.loadDevices(true));
        this.details = LogView.attach(this.el('scan-log'), app);
        document.querySelectorAll('input[name="scan-mode"]').forEach(r => r.addEventListener('change', () => this.syncMode()));
        this.el('scan-driver').addEventListener('change', () => this.syncMode());
        this.el('scan-swap').addEventListener('change', () => this.saveSwap());
        this.el('scan-autosize').addEventListener('change', () => {
            const d = this.device();
            if (!d) return;
            const all = this.get(this.KEY_AUTOSIZE, {}) || {};
            all[d.id] = this.el('scan-autosize').checked;
            this.put(this.KEY_AUTOSIZE, all);
            this.syncMode();
        });
        for (const id of ['scan-even', 'scan-streaks']) this.el(id).addEventListener('change', () => this.saveEpson());
        // Show each one: in the settings, and while it scans
        this.el('scan-show').addEventListener('change', () => this.setShow(this.el('scan-show').checked));
        this.el('scan-show-live').addEventListener('change', () => this.setShow(this.el('scan-show-live').checked, true));
        ScanPreview.init(boxes => this.boxesChanged(boxes));
        this.el('scan-pv-again').addEventListener('click', () => this.previewGlass());
        this.el('scan-pv-find').addEventListener('click', () => ScanPreview.set(ScanPreview.find(this.el('scan-pv-img'))));
        this.el('scan-pv-clear').addEventListener('click', () => ScanPreview.set([]));
        // Another glass size: remembered for the scanner, previewed again
        this.el('scan-pv-glass').addEventListener('change', () => {
            const pv = this.pv;
            if (!pv) return;
            const all = this.get(this.KEY_BED, {}) || {};
            all[pv.device.id] = this.el('scan-pv-glass').value;
            this.put(this.KEY_BED, all);
            this.previewGlass();
        });
        for (const id of ['scan-dpi', 'scan-color', 'scan-sides', 'scan-format', 'scan-quality', 'scan-bright', 'scan-contrast']) {
            this.el(id).addEventListener('input', () => this.optsChanged());
            this.el(id).addEventListener('change', () => this.optsChanged());
        }
        this.el('scan-setup-pick').addEventListener('change', () => this.applySetup(this.el('scan-setup-pick').value));
        this.el('scan-setup-save').addEventListener('click', () => this.saveSetup());
        this.el('scan-setup-del').addEventListener('click', () => this.deleteSetup());
        this.el('scan-details').addEventListener('click', () => this.showDetails(!this.details.shown, true));
        this.el('scan-device').addEventListener('change', () => {
            if (this.el('scan-device').value === this.MORE) this.showMoreScanners();
            this.syncCompat(); this.syncMode(true); this.loadOptsFor(this.device()); this.loadCaps();
        });
        // A scanner plugged in or out while the dock is open: the list follows
        addEventListener('jeditor-devices', () => {
            if (this.visible() && this.devices && !this.running && !this.waiting && panel.dataset.state === 'setup') this.loadDevices(true, true);
        });
        this.el('scan-folder').addEventListener('change', () => this.fillNames());
        this.el('scan-prefix').addEventListener('input', () => this.preview());
        this.el('scan-next').addEventListener('input', () => this.preview());
        this.el('scan-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.start();
        });
        this.el('scan-whole').addEventListener('click', () => this.start({ whole: true }));
        this.el('scan-own').addEventListener('click', () => this.ownSettings('show'));
        this.el('scan-own-forget').addEventListener('click', () => this.ownSettings('forget'));
        panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || UI.isOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            this.close();
        });
        this.initDrag();
    },

    // Keys typed in the dock are its own (the photo shortcuts wait)
    isOpen() {
        const panel = this.el('scan-panel');
        return !!panel && !panel.classList.contains('hidden') && panel.contains(document.activeElement) &&
            document.activeElement !== panel;
    },

    visible() {
        const panel = this.el('scan-panel');
        return !!panel && !panel.classList.contains('hidden');
    },

    async open() {
        const app = this.app;
        const panel = this.el('scan-panel');
        if (this.running) {
            panel.classList.remove('hidden');
            this.setSmall(false);
            return;
        }
        if (!app.dirHandle || app.readOnlyMode) {
            app.showToast('Open a project first: scans go into its folder', 3500);
            return;
        }
        panel.classList.remove('hidden');
        this.setSmall(false);
        this.setState('setup');
        this.fitDock();
        if (this.detailsWanted()) this.showDetails(true);
        this.fillFolders();
        this.fillNames();
        const last = this.last();
        // Off unless turned on. Kept as autoCropOn: autoCrop is the old
        // choice, made when it was on to start with, so it isn't read
        this.el('scan-autocrop').checked = !!last && last.autoCropOn === true;
        this.el('scan-show').checked = this.el('scan-show-live').checked = !last || last.show !== false;
        this.placeOpts('home');
        this.loadOpts();
        this.el('scan-go').focus();
        await this.loadDevices(false);
        this.loadOptsFor(this.device());
        await this.loadCaps();
    },

    // While it scans, closing only makes it small
    close() {
        if (this.running) return this.setSmall(true);
        if (this.waiting) FolderCache.native().cancelScan(); // a preview: stop it
        this.el('scan-panel').classList.add('hidden');
        if (this.details.shown) this.details.hide(); // (still wanted next time)
    },

    // Show each one as it comes in: both switches, remembered. Turned on
    // while it scans: the newest one so far, large, at once
    setShow(on, live = false) {
        this.el('scan-show').checked = this.el('scan-show-live').checked = on;
        this.put(this.KEY, { ...(this.last() || {}), show: on });
        if (on && live && this.running && this.newest) this.app.showWhenIn(this.newest);
    },

    // ---- Details ----

    detailsWanted() {
        try { return localStorage.getItem(this.KEY_DETAILS) === '1'; } catch (e) { return false; }
    },

    // `remember`: the button was pressed (so next time too)
    showDetails(on, remember = false) {
        if (on) this.details.show(); else this.details.hide();
        this.el('scan-details').setAttribute('aria-pressed', String(on));
        if (remember) try { localStorage.setItem(this.KEY_DETAILS, on ? '1' : '0'); } catch (e) { /* private */ }
    },

    setSmall(small) {
        this.el('scan-panel').classList.toggle('small', small);
        if (this.fitDock) this.fitDock();
        this.el('scan-min').title = small ? 'Show it all' : 'Make small';
    },

    setState(state) {
        const panel = this.el('scan-panel');
        const was = panel.dataset.state;
        panel.dataset.state = state;
        this.el('scan-go').textContent = state === 'done' ? 'Scan more' : 'Scan';
        this.el('scan-cancel').textContent = state === 'done' ? 'Done' : 'Cancel';
        if (state === 'setup') {
            this.el('scan-title').textContent = 'Scan into this project';
            this.el('scan-go').disabled = !(this.devices && this.devices.length);
            // Back from a scan: the names carry on from it (not the numbers
            // the boxes had before it, which are taken now)
            if (was && was !== 'setup' && this.el('scan-folder').options.length) this.fillNames();
            this.placeOpts('home');
            this.syncMode();
        }
        if (state === 'preview') this.boxesChanged(ScanPreview.boxes);
        if (state === 'done') this.el('scan-go').disabled = false;
    },

    // Dragged by its title; stays where it was put. Fitted on screen each
    // time it opens and when the window changes size (a spot chosen in a
    // big window would leave it hanging off a small one), going back to
    // that spot when there's room again
    initDrag() {
        const panel = this.el('scan-panel');
        const head = this.el('scan-head');
        const place = (x, y) => {
            panel.style.removeProperty('--dock-max');
            const r = panel.getBoundingClientRect();
            x = Math.max(4, Math.min(innerWidth - r.width - 4, x));
            y = Math.max(4, Math.min(innerHeight - r.height - 4, y));
            Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
            panel.style.setProperty('--dock-max', `${innerHeight - y - 4}px`);
            return { x, y };
        };
        // Its size, when it was resized: no bigger than the window
        const size = () => {
            const want = this.get(this.KEY_SIZE, null);
            panel.classList.toggle('sized', !!want);
            if (!want) {
                panel.style.removeProperty('width');
                panel.style.removeProperty('height');
                return;
            }
            panel.style.width = `${Math.min(want.w, innerWidth - 8)}px`;
            panel.style.height = `${Math.min(want.h, innerHeight - 8)}px`;
        };
        this.fitDock = () => {
            size();
            let want = null;
            try { want = JSON.parse(localStorage.getItem(this.KEY_POS) || 'null'); } catch (e) { /* none */ }
            if (want && !panel.classList.contains('hidden')) place(want.x, want.y);
        };
        this.initResize(place, size);
        addEventListener('resize', () => this.fitDock());
        head.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || e.target.closest('button')) return;
            const r = panel.getBoundingClientRect();
            const dx = e.clientX - r.left, dy = e.clientY - r.top;
            head.setPointerCapture(e.pointerId);
            let pos = null;
            const move = (ev) => { pos = place(ev.clientX - dx, ev.clientY - dy); };
            const up = () => {
                head.removeEventListener('pointermove', move);
                head.removeEventListener('pointerup', up);
                if (!pos) return;
                try { localStorage.setItem(this.KEY_POS, JSON.stringify(pos)); } catch (err) { /* private */ }
            };
            head.addEventListener('pointermove', move);
            head.addEventListener('pointerup', up);
        });
    },

    // Resized by its edges and corners, as a window is; the size is kept,
    // and where it was put with it. Double-click an edge: its usual size
    initResize(place, size) {
        const panel = this.el('scan-panel');
        const MIN_W = 340, MIN_H = 220;
        panel.querySelectorAll('.scan-grip').forEach(grip => {
            const edge = grip.dataset.edge;
            grip.addEventListener('dblclick', () => {
                try { localStorage.removeItem(this.KEY_SIZE); } catch (e) { /* private */ }
                this.fitDock();
            });
            grip.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                const r = panel.getBoundingClientRect();
                const x0 = e.clientX, y0 = e.clientY;
                grip.setPointerCapture(e.pointerId);
                panel.style.setProperty('--dock-max', 'none');
                let box = null;
                const move = (ev) => {
                    const dx = ev.clientX - x0, dy = ev.clientY - y0;
                    let { left, top, right, bottom } = r;
                    if (edge.includes('w')) left = Math.max(4, Math.min(right - MIN_W, left + dx));
                    if (edge.includes('e')) right = Math.min(innerWidth - 4, Math.max(left + MIN_W, right + dx));
                    if (edge.includes('n')) top = Math.max(4, Math.min(bottom - MIN_H, top + dy));
                    if (edge.includes('s')) bottom = Math.min(innerHeight - 4, Math.max(top + MIN_H, bottom + dy));
                    box = { x: left, y: top, w: right - left, h: bottom - top };
                    panel.classList.add('sized');
                    Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto', width: `${box.w}px`, height: `${box.h}px` });
                };
                const up = () => {
                    grip.removeEventListener('pointermove', move);
                    grip.removeEventListener('pointerup', up);
                    if (!box) { place(r.left, r.top); return; }
                    this.put(this.KEY_SIZE, { w: Math.round(box.w), h: Math.round(box.h) });
                    this.put(this.KEY_POS, { x: Math.round(box.x), y: Math.round(box.y) });
                    size();
                    place(box.x, box.y);
                };
                grip.addEventListener('pointermove', move);
                grip.addEventListener('pointerup', up);
            });
        });
    },

    // ---- The photos coming in ----

    async addThumb(folder, name) {
        const strip = this.el('scan-strip');
        const fig = document.createElement('figure');
        const cap = document.createElement('figcaption');
        cap.textContent = name.replace(/\.[^.]+$/, '');
        fig.appendChild(cap);
        strip.appendChild(fig);
        // Resized: as many as fill it (the newest at the bottom)
        const sized = this.el('scan-panel').classList.contains('sized');
        while (strip.children.length > (sized ? this.STRIP_SIZED : this.STRIP)) {
            const old = strip.firstElementChild;
            const img = old.querySelector('img');
            if (img) URL.revokeObjectURL(img.src);
            old.remove();
        }
        try {
            const dir = await Folders.handleFor(folder);
            const file = await (await dir.getFileHandle(name)).getFile();
            if (!fig.isConnected) return;
            const img = document.createElement('img');
            img.alt = '';
            img.decoding = 'async';
            img.src = URL.createObjectURL(file);
            fig.prepend(img);
        } catch (e) { /* not readable yet: the name shows */ }
        if (sized) strip.scrollTop = strip.scrollHeight;
    },

    clearStrip() {
        const strip = this.el('scan-strip');
        strip.querySelectorAll('img').forEach(img => URL.revokeObjectURL(img.src));
        strip.innerHTML = '';
    },

    status(text, error = false) {
        const el = this.el('scan-status');
        el.textContent = text;
        el.classList.toggle('error', error);
    },

    // ---- Scanners ----

    // Only the scanners plugged in and on are listed (a TWAIN driver stays
    // listed after its scanner is unplugged; the app tells which are found).
    // The rest, under More…: a scanner on the network isn't found that way,
    // so one scanned with from there is kept listed (KEY_KEEP). With none
    // found, all are listed. `quiet`: a device was plugged in or out, so
    // the list changes only if what's found did
    async loadDevices(fresh, quiet = false) {
        const select = this.el('scan-device');
        const note = this.el('scan-problems');
        if (!this.devices || fresh) {
            if (!quiet) {
                select.innerHTML = '<option value="">Looking for scanners…</option>';
                select.disabled = true;
                this.el('scan-go').disabled = true;
                note.textContent = '';
            }
            let devices, problems;
            try {
                const r = await FolderCache.native().scanners();
                devices = r.devices || [];
                problems = r.problems || [];
            } catch (e) {
                if (quiet) return;
                devices = [];
                problems = ['Couldn\'t look for scanners: ' + e.message];
            }
            const was = this.devices && this.devices.map(d => d.id + (d.found === false ? '-' : '+')).join('|');
            this.devices = devices;
            this.problems = problems;
            if (quiet && was === devices.map(d => d.id + (d.found === false ? '-' : '+')).join('|')) return;
        }
        const keep = this.get(this.KEY_KEEP, []) || [];
        const listed = (d) => d.found !== false || keep.includes(d.id);
        const shown = this.devices.filter(listed);
        const others = this.devices.filter(d => !listed(d));
        const all = this.showAllScanners || !shown.length;
        const prev = select.value;
        select.innerHTML = '';
        const option = (d, parent) => {
            const o = document.createElement('option');
            o.value = d.id;
            o.textContent = d.driver === 'wia' ? `${d.name} (WIA)` : d.name;
            parent.appendChild(o);
        };
        for (const d of shown) option(d, select);
        if (others.length && all) {
            const group = document.createElement('optgroup');
            group.label = shown.length ? 'Not found: unplugged, off, or on the network' : 'None found plugged in: unplugged, off, or on the network';
            for (const d of others) option(d, group);
            select.appendChild(group);
        } else if (others.length) {
            const o = document.createElement('option');
            o.value = this.MORE;
            o.textContent = `More: ${others.length} not plugged in…`;
            select.appendChild(o);
        }
        const last = this.last();
        const ids = [...select.options].map(o => o.value).filter(v => v && v !== this.MORE);
        if (quiet && ids.includes(prev)) select.value = prev;
        else if (last && ids.includes(last.device)) select.value = last.device;
        else select.value = ids[0] || '';
        select.disabled = !this.devices.length;
        this.el('scan-go').disabled = !this.devices.length;
        if (!this.devices.length) {
            const o = document.createElement('option');
            o.value = '';
            o.textContent = 'No scanners found';
            select.appendChild(o);
        }
        this.syncCompat();
        this.syncMode(true);
        note.textContent = !this.devices.length ? 'Is the scanner plugged in and turned on? ' + this.problems.join('. ')
            : !shown.length ? 'None of these seem to be plugged in. Is the scanner plugged in and turned on? One on the network can still be chosen.'
            : this.problems.join('. ');
        if (quiet && select.value !== prev) {
            this.loadOptsFor(this.device());
            this.loadCaps();
        }
    },

    // The scanners not found, listed too (More… chosen)
    showMoreScanners() {
        this.showAllScanners = true;
        const others = (this.devices || []).filter(d => d.found === false);
        this.loadDevices(false);
        if (others.length) this.el('scan-device').value = others[0].id;
    },

    // A scanner not found that scanned all the same (on the network): kept listed
    keepListed(id) {
        const d = (this.devices || []).find(x => x.id === id);
        if (!d || d.found !== false) return;
        const keep = this.get(this.KEY_KEEP, []) || [];
        if (!keep.includes(id)) this.put(this.KEY_KEEP, [...keep, id]);
    },

    // Compatibility mode: TWAIN scanners only, remembered for each
    compat() {
        try { return JSON.parse(localStorage.getItem(this.KEY_COMPAT) || '{}') || {}; } catch (e) { return {}; }
    },

    // The scanner only worked in Older TWAIN mode (jEditor tries it when a
    // TWAIN scanner won't open): kept on for it from now on
    adoptCompat(deviceId, reply) {
        if (!reply || !reply.compat) return;
        const all = this.compat();
        if (all[deviceId]) return;
        all[deviceId] = true;
        this.put(this.KEY_COMPAT, all);
        if (this.pv && this.pv.device.id === deviceId) this.pv.compat = true;
        this.syncCompat();
        const d = (this.devices || []).find(x => x.id === deviceId);
        this.app.showToast(`${d ? d.name : 'This scanner'} only works in Older TWAIN mode, so jEditor turned that on for it (under Advanced)`, 7000, null, null, { type: 'info' });
    },

    syncCompat() {
        const device = this.devices && this.devices.find(d => d.id === this.el('scan-device').value);
        const twain = !!device && device.driver === 'twain';
        this.el('scan-compat-row').classList.toggle('hidden', !twain);
        this.el('scan-compat').checked = twain && !!this.compat()[device.id];
    },

    last() {
        try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; }
    },

    // ---- How: the glass, the feeder, or the scanner's own window ----

    get(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch (e) { return fallback; }
    },

    put(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private */ }
    },

    modes() {
        const m = this.get(this.KEY_MODE, {}) || {};
        for (const k of Object.keys(m)) if (m[k] === true) m[k] = 'glass'; // (1.23: Preview and crop)
        return m;
    },

    device() {
        return (this.devices || []).find(d => d.id === this.el('scan-device').value) || null;
    },

    // glass, feeder or driver (Advanced: the scanner's own window)
    mode() {
        if (this.el('scan-driver').checked) return 'driver';
        const r = document.querySelector('input[name="scan-mode"]:checked');
        return r ? r.value : 'glass';
    },

    // What the scanner can do: its glass, feeder and resolutions (asked once)
    // The scanner is busy while it's asked (its driver is open), so a scan
    // or preview started meanwhile waits for it (capsLoading)
    async loadCaps() {
        const d = this.device();
        if (!d) return;
        // Asked already: its resolutions (not the last scanner's)
        if (this.caps[d.id]) return this.fillDpis(this.caps[d.id]);
        // Until it answers, or if it never does (a slow or stuck driver):
        // the usual ones, so there's always a resolution to choose
        this.fillDpis({ dpis: [], dpisSure: false, asking: true });
        if (this.running || this.waiting) return;
        let asked;
        this.capsLoading = asked = FolderCache.native().scanCaps({ device: d.id, driver: d.driver, compat: d.driver === 'twain' && !!this.compat()[d.id] })
            .catch(() => null);
        try {
            const caps = await asked;
            if (caps) this.caps[d.id] = caps;
            this.adoptCompat(d.id, caps);
        } catch (e) { /* both offered */ }
        if (this.capsLoading === asked) this.capsLoading = null;
        if (this.device() === d) {
            this.syncMode(true);
            this.fillDpis(this.caps[d.id] || { dpis: [], dpisSure: false });
        }
    },

    // `fromDevice`: How (and the swap) as last used with the scanner chosen,
    // else from what it has: the glass if it has one, else the feeder
    syncMode(fromDevice = false) {
        const d = this.device();
        const caps = d && this.caps[d.id];
        // Not known (the scanner didn't say): both offered
        const unsure = !caps || caps.guessed || (!caps.flatbed && !caps.feeder);
        const hasGlass = unsure || caps.flatbed !== false;
        const hasFeeder = unsure || !!caps.feeder;
        this.el('scan-mode-glass').classList.toggle('hidden', !hasGlass);
        this.el('scan-mode-feeder').classList.toggle('hidden', !hasFeeder);
        if (fromDevice && d) {
            const m = this.modes()[d.id];
            this.el('scan-driver').checked = m === 'driver';
            const want = m === 'glass' || m === 'feeder' ? m : caps && !caps.flatbed && caps.feeder ? 'feeder' : 'glass';
            const r = document.querySelector(`input[name="scan-mode"][value="${want}"]`);
            if (r) r.checked = true;
            const swaps = this.get(this.KEY_SWAP, {}) || {};
            this.el('scan-swap').checked = d.id in swaps ? !!swaps[d.id] : this.isFastFoto(d);
            const sizes = this.get(this.KEY_AUTOSIZE, {}) || {};
            this.el('scan-autosize').checked = d.id in sizes ? !!sizes[d.id] : true;
            // As FastFoto has them unless changed: both on
            const fixes = (this.get(this.KEY_EPSON, {}) || {})[d.id] || {};
            this.el('scan-even').checked = fixes.even !== false;
            this.el('scan-streaks').checked = fixes.streaks !== false;
        }
        // A choice the scanner doesn't have: the other one
        const pick = document.querySelector('input[name="scan-mode"]:checked');
        if (pick && pick.closest('label').classList.contains('hidden')) {
            const other = document.querySelector(`input[name="scan-mode"][value="${pick.value === 'glass' ? 'feeder' : 'glass'}"]`);
            if (other) other.checked = true;
        }
        const mode = this.mode();
        const panel = this.el('scan-panel');
        panel.dataset.mode = mode;
        for (const m of ['glass', 'feeder', 'driver']) this.el(`scan-help-${m}`).classList.toggle('hidden', m !== mode);
        // Only one way (a feeder alone, or the scanner's window): no choice shown
        this.el('scan-mode-row').classList.toggle('hidden', mode === 'driver' || !(hasGlass && hasFeeder));
        this.el('scan-swap-row').classList.toggle('hidden', mode !== 'feeder');
        // Its own crop: a TWAIN feeder's, unless it said it can't
        const autosize = mode === 'feeder' && !!d && d.driver === 'twain' && !(caps && caps.autoSize === false);
        this.el('scan-autosize-row').classList.toggle('hidden', !autosize);
        // Epson's own fixes: sent with its own crop (Twain32's Epson photo scan)
        const epson = autosize && this.isFastFoto(d) && this.el('scan-autosize').checked;
        this.el('scan-even-row').classList.toggle('hidden', !epson);
        this.el('scan-streaks-row').classList.toggle('hidden', !epson);
        this.syncOwn(mode === 'feeder' && d && d.driver === 'twain' ? d : null);
        // Backs only from a feeder that scans both sides
        const oneSided = !unsure && caps.duplex === false;
        for (const v of ['back', 'both']) {
            const o = this.el('scan-sides').querySelector(`option[value="${v}"]`);
            o.hidden = o.disabled = oneSided;
        }
        if (oneSided) this.el('scan-sides').value = 'front';
        this.el('scan-sides-row').classList.toggle('hidden', mode !== 'feeder' || oneSided);
        if (panel.dataset.state === 'setup') this.el('scan-go').textContent = mode === 'glass' ? 'Preview' : 'Scan';
        this.preview();
    },

    // Scanner's own settings… (a TWAIN feeder): offered, and whether some
    // are saved for this scanner
    async syncOwn(d) {
        const row = this.el('scan-own-row');
        row.classList.toggle('hidden', !d);
        if (!d) return;
        const native = FolderCache.native();
        const state = native && native.scannerSettings ? await native.scannerSettings(d.id, 'state').catch(() => null) : null;
        if (this.device() !== d) return;
        if (!state || !state.helper) { row.classList.add('hidden'); return; }
        this.el('scan-own-forget').classList.toggle('hidden', !state.saved);
        this.el('scan-own').textContent = state.saved ? 'Scanner\'s own settings… (saved)' : 'Scanner\'s own settings…';
    },

    async ownSettings(act) {
        const d = this.device();
        if (!d) return;
        const btn = this.el('scan-own');
        btn.disabled = true;
        if (act === 'show') this.app.showToast('The scanner\'s window opens: choose its settings there, then Save. It may be behind jEditor.', 6000);
        try {
            const r = await FolderCache.native().scannerSettings(d.id, act);
            this.app.showToast(act === 'forget' ? 'Back to the scanner\'s default settings'
                : r.saved ? 'Saved: feeder scans use the scanner\'s own settings now' : 'Nothing was saved', 3500);
        } catch (e) {
            UI.alert({ title: 'The scanner\'s settings didn\'t open', message: e.message });
        } finally {
            btn.disabled = false;
            this.syncOwn(d);
        }
    },

    saveEpson() {
        const d = this.device();
        if (!d) return;
        const all = this.get(this.KEY_EPSON, {}) || {};
        all[d.id] = { even: this.el('scan-even').checked, streaks: this.el('scan-streaks').checked };
        this.put(this.KEY_EPSON, all);
    },

    saveSwap() {
        const d = this.device();
        if (!d) return;
        const swaps = this.get(this.KEY_SWAP, {}) || {};
        swaps[d.id] = this.el('scan-swap').checked;
        this.put(this.KEY_SWAP, swaps);
    },

    // ---- jEditor's settings ----

    // The settings: in setup, or beside the glass
    placeOpts(where) {
        const box = this.el(where === 'pv' ? 'scan-opts-pv' : 'scan-opts-home');
        const opts = this.el('scan-opts');
        if (opts.parentElement !== box) box.appendChild(opts);
    },

    opts() {
        return {
            dpi: +this.el('scan-dpi').value || 300,
            color: this.el('scan-color').value,
            sides: this.el('scan-sides').value,
            format: this.el('scan-format').value,
            quality: +this.el('scan-quality').value,
            brightness: +this.el('scan-bright').value,
            contrast: +this.el('scan-contrast').value
        };
    },

    setOpts(o) {
        const set = (id, v) => { if (v !== undefined && v !== null) this.el(id).value = v; };
        set('scan-color', o.color);
        set('scan-sides', o.sides);
        set('scan-format', o.format);
        set('scan-quality', o.quality);
        set('scan-bright', o.brightness);
        set('scan-contrast', o.contrast);
        if (o.dpi && [...this.el('scan-dpi').options].some(x => +x.value === o.dpi)) this.el('scan-dpi').value = o.dpi;
        this.syncOpts();
    },

    // Kept for the scanner they were used with, and as the last used
    saveOpts(o) {
        this.put(this.KEY_OPTS, o);
        const d = this.device();
        if (!d) return;
        const all = this.get(this.KEY_DEV_OPTS, {}) || {};
        all[d.id] = o;
        this.put(this.KEY_DEV_OPTS, all);
    },

    // A scanner's own settings, else the last used, at a resolution that
    // suits it (a photo feeder: 300 dpi, plenty for prints and quick)
    loadOptsFor(d) {
        if (!d) return;
        const mine = (this.get(this.KEY_DEV_OPTS, {}) || {})[d.id];
        if (mine) return this.setOpts(mine);
        this.setOpts({ ...(this.get(this.KEY_OPTS, {}) || {}), dpi: this.defaultDpi(d) });
    },

    isFastFoto(d) {
        return !!d && /FF-\d|FastFoto/i.test(d.name || d.id);
    },

    defaultDpi(d) {
        return this.isFastFoto(d) ? 300 : 600;
    },

    // The last settings used (1.23's resolution and color too)
    loadOpts() {
        const old = this.get('jeditor.scanPv', {}) || {};
        this.setOpts({ dpi: old.dpi, color: old.color, ...(this.get(this.KEY_OPTS, {}) || {}) });
        this.fillSetups();
    },

    optsChanged() {
        this.syncOpts();
        this.saveOpts(this.opts());
        // Changed from a saved setup: it's custom now
        const pick = this.el('scan-setup-pick');
        const s = this.setups().find(x => x.name === pick.value);
        if (s && !this.same(s, this.opts())) pick.value = '';
        this.preview();
        if (this.el('scan-panel').dataset.state === 'preview') this.boxesChanged(ScanPreview.boxes);
    },

    same(a, b) {
        return ['dpi', 'color', 'sides', 'format', 'quality', 'brightness', 'contrast'].every(k => a[k] === undefined || a[k] === b[k]);
    },

    // Numbers beside the sliders, the quality only for JPEG, and the
    // preview showing brightness and contrast as the scan will have them
    syncOpts() {
        const o = this.opts();
        this.el('scan-quality-out').textContent = o.quality;
        this.el('scan-bright-out').textContent = o.brightness;
        this.el('scan-contrast-out').textContent = o.contrast;
        this.el('scan-quality-row').classList.toggle('hidden', o.format !== 'jpeg');
        const f = (100 + o.contrast) / 100;
        const t = (1 - f) / 2 + o.brightness / 200;
        for (const c of ['r', 'g', 'b']) {
            const fn = this.el(`scan-adj-${c}`);
            fn.setAttribute('slope', f);
            fn.setAttribute('intercept', t);
        }
    },

    setups() {
        return this.get(this.KEY_SETUPS, []) || [];
    },

    fillSetups(selected = '') {
        const pick = this.el('scan-setup-pick');
        pick.innerHTML = '<option value="">Custom</option>';
        for (const s of this.setups()) {
            const o = document.createElement('option');
            o.value = s.name;
            o.textContent = s.name;
            pick.appendChild(o);
        }
        pick.value = selected;
        this.el('scan-setup-del').disabled = !selected;
    },

    applySetup(name) {
        const s = this.setups().find(x => x.name === name);
        this.el('scan-setup-del').disabled = !s;
        if (!s) return;
        this.setOpts(s);
        this.saveOpts(this.opts());
        this.preview();
    },

    async saveSetup() {
        const current = this.el('scan-setup-pick').value;
        const name = await UI.prompt({ title: 'Save these settings', message: 'A name for this setup, to pick it next time (e.g. "Reprints 600 dpi TIFF").', ok: 'Save', input: { label: 'Name', value: current } });
        if (!name || !name.trim()) return;
        const list = this.setups().filter(x => x.name !== name.trim());
        list.push({ name: name.trim(), ...this.opts() });
        list.sort((a, b) => a.name.localeCompare(b.name));
        this.put(this.KEY_SETUPS, list);
        this.fillSetups(name.trim());
        this.app.showToast(`Saved the setup "${name.trim()}"`, 2500, null, null, { type: 'success' });
    },

    async deleteSetup() {
        const name = this.el('scan-setup-pick').value;
        if (!name) return;
        if (!await UI.confirm({ title: `Delete the setup "${name}"?`, ok: 'Delete' })) return;
        this.put(this.KEY_SETUPS, this.setups().filter(x => x.name !== name));
        this.fillSetups('');
    },

    // Resolutions the scanner has (100 dpi and up; those above its optical
    // one under their own heading, interpolated); the last one used, else
    // the nearest below it. Grayscale only if it has it. Unsure (the driver didn't
    // say): the usual ones, and the dock says so
    fillDpis(caps) {
        const select = this.el('scan-dpi');
        const dpis = (caps.dpis || []).filter(d => d >= 100);
        const usual = [150, 200, 300, 400, 600, 1200];
        const list = dpis.length ? dpis : caps.optical >= 100 ? usual.filter(d => d <= caps.optical) : usual;
        const d = this.device();
        const mine = d && (this.get(this.KEY_DEV_OPTS, {}) || {})[d.id];
        const want = (mine && mine.dpi) || (d ? this.defaultDpi(d) : 0) || +select.value || (this.get(this.KEY_OPTS, {}) || {}).dpi;
        select.innerHTML = '';
        const made = caps.optical >= 100 ? list.filter(d => d > caps.optical) : [];
        let group = null;
        for (const d of list) {
            const o = document.createElement('option');
            o.value = d;
            o.textContent = made.includes(d) ? `${d} dpi (interpolated)` : `${d} dpi`;
            if (made.includes(d) && !group) {
                group = document.createElement('optgroup');
                group.label = `Interpolated: more pixels, no more detail than ${caps.optical} dpi`;
                select.appendChild(group);
            }
            (made.includes(d) ? group : select).appendChild(o);
        }
        const below = list.filter(d => d <= want);
        select.value = list.includes(want) ? want : below.length ? below[below.length - 1] : list[0];
        select.title = caps.optical >= 100 ? `Up to ${caps.optical} dpi, the scanner's optical resolution` : '';
        const unsure = this.el('scan-dpi-note');
        unsure.textContent = caps.asking ? 'Asking the scanner which resolutions it has…'
            : caps.dpisSure === false ? 'The scanner didn\'t say which resolutions it has: these are the usual ones. If one doesn\'t work, choose a lower one.' : '';
        unsure.classList.toggle('hidden', caps.dpisSure !== false);
        const gray = this.el('scan-color').querySelector('option[value="gray"]');
        gray.hidden = gray.disabled = caps.gray === false;
        if (gray.disabled) this.el('scan-color').value = 'color';
    },

    // ---- Where, and what names ----

    folders() {
        const dirs = new Set(['']);
        for (const p of Folders.map.keys()) dirs.add(p);
        for (const f of this.app.files) dirs.add(Folders.dirOf(f));
        return [...dirs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    },

    fillFolders() {
        const select = this.el('scan-folder');
        select.innerHTML = '';
        for (const p of this.folders()) {
            const o = document.createElement('option');
            o.value = p;
            o.textContent = Folders.label(p);
            select.appendChild(o);
        }
        select.value = this.defaultFolder();
    },

    // The folder being looked at; with the whole order showing, the one
    // with the most photos (where an order's scans usually go)
    defaultFolder() {
        if (Folders.scope !== null && Folders.scope !== undefined) return Folders.scope;
        const counts = new Map();
        for (const f of this.app.files) counts.set(Folders.dirOf(f), (counts.get(Folders.dirOf(f)) || 0) + 1);
        let best = '', most = -1;
        for (const [p, n] of counts) if (n > most) { best = p; most = n; }
        return best;
    },

    // → { prefix, next, digits }: after the folder's last photo, in its most
    // used pattern; else the order's; else the order's name ("Smith-001")
    naming(folder) {
        const scan = (files) => {
            const by = new Map();
            for (const f of files) {
                const m = this.PHOTO.exec(f.name);
                if (!m) continue;
                const k = m[1];
                const e = by.get(k) || { prefix: k, n: 0, max: 0, digits: 1 };
                e.n++;
                e.max = Math.max(e.max, parseInt(m[2], 10));
                e.digits = Math.max(e.digits, m[2].length);
                by.set(k, e);
            }
            let best = null;
            for (const e of by.values()) if (!best || e.n > best.n) best = e;
            return best;
        };
        const here = scan(this.app.files.filter(f => Folders.dirOf(f) === folder));
        if (here) return { prefix: here.prefix, next: here.max + 1, digits: here.digits };
        const order = scan(this.app.files);
        if (order) return { prefix: order.prefix, next: 1, digits: order.digits };
        const word = (Folders.rootName() || 'Scan').trim().split(/\s+/)[0].replace(/[<>:"/\\|?*]/g, '');
        return { prefix: (word.charAt(0).toUpperCase() + word.slice(1) || 'Scan') + '-', next: 1, digits: 3 };
    },

    // The folder's next names: carrying on from the last scan into it
    fillNames() {
        const n = this.continuing(this.el('scan-folder').value);
        this.el('scan-prefix').value = n.prefix;
        this.el('scan-next').value = n.next;
        this.digits = n.digits;
        this.preview();
    },

    ext() {
        const f = this.el('scan-format').value;
        return f === 'tiff' ? '.tif' : f === 'png' ? '.png' : '.jpg';
    },

    name(prefix, n, digits, back = false) {
        return prefix + String(n).padStart(digits, '0') + (back ? '-b' : '') + this.ext();
    },

    preview() {
        const prefix = this.el('scan-prefix').value;
        const next = Math.max(0, parseInt(this.el('scan-next').value, 10) || 0);
        const d = this.digits || 3;
        const both = this.mode() === 'feeder' && this.el('scan-sides').value === 'both';
        this.el('scan-preview').textContent = both
            ? `${this.name(prefix, next, d)} and its back ${this.name(prefix, next, d, true)}, ${this.name(prefix, next + 1, d)}, …`
            : `${this.name(prefix, next, d)}, ${this.name(prefix, next + 1, d)}, …`;
    },

    // ---- Scanning ----

    // whole: Scan whole glass (one photo of the whole glass, no preview)
    async start({ whole = false } = {}) {
        if (this.capsLoading) {
            this.status('Waiting for the scanner…');
            await this.capsLoading;
        }
        const device = this.devices && this.devices.find(d => d.id === this.el('scan-device').value);
        if (!device) return;
        const folder = this.el('scan-folder').value;
        const prefix = this.el('scan-prefix').value;
        const next = Math.max(0, parseInt(this.el('scan-next').value, 10) || 0);
        const autoCrop = this.el('scan-autocrop').checked;
        const compat = device.driver === 'twain' && this.el('scan-compat').checked;
        try {
            const all = this.compat();
            if (compat) all[device.id] = true; else delete all[device.id];
            localStorage.setItem(this.KEY_COMPAT, JSON.stringify(all));
        } catch (e) { /* private */ }
        try { localStorage.setItem(this.KEY, JSON.stringify({ device: device.id, autoCropOn: autoCrop, show: this.el('scan-show').checked })); } catch (e) { /* private */ }
        const state = this.el('scan-panel').dataset.state;
        if (state === 'preview') return this.scanBoxes();
        // Scan more: the names carry on from the photos just scanned
        const more = state === 'done';
        const mode = whole ? 'whole' : more ? this.lastMode || this.mode() : this.mode();
        if (mode === 'whole') {
            // The whole glass as one photo, at the settings chosen: no
            // preview, no boxes (Auto crop each photo still trims it to the
            // print, when it's on)
            this.lastMode = 'whole';
            const o = this.opts();
            this.saveOpts(o);
            const bed = this.bedFor(device, this.caps[device.id] || null);
            const opts = {
                device: device.id, driver: device.driver, folder, autoCrop, compat, source: 'glass',
                crops: [{ x: 0, y: 0, w: 1, h: 1, angle: 0, turn: 0 }],
                dpi: o.dpi, gray: o.color === 'gray', bedW: bed.w, bedH: bed.h,
                brightness: o.brightness, contrast: o.contrast, format: o.format, quality: o.quality
            };
            if (!more) Object.assign(opts, { prefix, next, digits: this.digits });
            this.run(opts).catch(() => { /* said already */ });
            return;
        }
        const modes = this.modes();
        modes[device.id] = mode;
        this.put(this.KEY_MODE, modes);
        this.lastMode = mode;
        if (mode === 'glass') {
            this.pv = { device, folder, autoCrop, compat, more, prefix, next, digits: this.digits, bed: null };
            this.previewGlass();
            return;
        }
        const o = this.opts();
        const opts = { device: device.id, driver: device.driver, folder, autoCrop, compat, source: mode, format: o.format, quality: o.quality };
        if (mode === 'feeder') {
            const caps = this.caps[device.id] || {};
            Object.assign(opts, {
                dpi: o.dpi, gray: o.color === 'gray', sides: o.sides, swap: this.el('scan-swap').checked,
                autosize: device.driver === 'twain' && this.el('scan-autosize').checked,
                even: this.el('scan-even').checked, streaks: this.el('scan-streaks').checked,
                brightness: o.brightness, contrast: o.contrast, bedW: caps.feedW || 8.5, bedH: caps.feedH || 14
            });
        }
        if (!more) Object.assign(opts, { prefix, next, digits: this.digits });
        this.run(opts).catch(() => { /* said already */ });
    },

    // ---- Preview and crop ----

    // The glass, small, with the prints found on it
    async previewGlass() {
        if (this.capsLoading) await this.capsLoading;
        const pv = this.pv;
        if (!pv || this.running || this.waiting) return;
        const native = FolderCache.native();
        const panel = this.el('scan-panel');
        const wait = (text) => { this.el('scan-pv-wait').textContent = text; };
        panel.classList.remove('hidden');
        this.setSmall(false);
        this.waiting = true;
        panel.classList.add('waiting');
        ScanPreview.clearImage();
        this.setState('preview');
        this.placeOpts('pv');
        this.el('scan-title').textContent = `Preview · ${pv.device.name}`;
        this.pvError('');
        try {
            let caps = this.caps[pv.device.id];
            if (!caps) {
                wait('Asking the scanner about its glass…');
                caps = await native.scanCaps({ device: pv.device.id, driver: pv.device.driver, compat: pv.compat });
                if (!caps) return this.pvError('Stopped');
                this.caps[pv.device.id] = caps;
                this.adoptCompat(pv.device.id, caps);
            }
            this.fillDpis(caps);
            const bed = this.bedFor(pv.device, caps);
            this.fillBeds(pv.device);
            // Sharp enough to find the prints well (near 150 dpi), small
            // enough to come quickly (5 million pixels at most); the scan
            // itself is at the resolution chosen
            const most = Math.floor(Math.sqrt(5e6 / (bed.w * bed.h)));
            const want = Math.min(150, most);
            const low = (caps.dpis || []).filter(d => d >= 50 && d <= Math.max(want, 75));
            const dpi = low.length ? low.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : Math.min(want, 150);
            wait(`Previewing the glass of ${pv.device.name} (${dpi} dpi, to find the prints)…`);
            const p = await native.scanPreview({ device: pv.device.id, driver: pv.device.driver, compat: pv.compat, bedW: bed.w, bedH: bed.h, dpi });
            if (!p) return this.pvError('Preview stopped');
            this.adoptCompat(pv.device.id, p);
            pv.bed = { w: p.bedW, h: p.bedH };
            await ScanPreview.show(p);
            ScanPreview.set(ScanPreview.find(this.el('scan-pv-img')));
            if (bed.guessed) this.app.showToast('The scanner didn\'t say how big its glass is, so jEditor took it to be A4: choose its size under Glass if that\'s wrong', 6000);
        } catch (e) {
            this.pvError(`The preview didn't work: ${e.message}`);
            this.showDetails(true); // what the driver did
            if (e.code) {
                this.trouble(e, pv.device.name, 0).then(again => { if (again) this.previewGlass(); });
            }
        } finally {
            this.waiting = false;
            panel.classList.remove('waiting');
            if (panel.dataset.state === 'preview') this.boxesChanged(ScanPreview.boxes);
        }
    },

    // The glass to preview: chosen for this scanner, or what the scanner
    // says, or what jEditor knows of the model, or A4. { w, h, guessed }
    bedFor(device, caps) {
        const pick = (key) => { const b = this.BEDS.find(x => x[0] === key); return b && b[2] ? { w: b[2], h: b[3] } : null; };
        const chosen = pick((this.get(this.KEY_BED, {}) || {})[device.id]);
        // (not one bigger than the glass the scanner says it has)
        const said = caps && !caps.guessed && caps.bedW > 1 && caps.bedH > 1 ? caps : null;
        if (chosen && !(said && (chosen.w > said.bedW + 0.15 || chosen.h > said.bedH + 0.15))) return chosen;
        if (caps && !caps.guessed && caps.bedW > 1 && caps.bedH > 1) return { w: caps.bedW, h: caps.bedH };
        const known = this.KNOWN_BEDS.find(([re]) => re.test(device.name || device.id));
        if (known) return pick(known[1]);
        return { w: 8.27, h: 11.69, guessed: true };
    },

    // The glass sizes: none bigger than the glass the scanner says it has
    fillBeds(device) {
        const select = this.el('scan-pv-glass');
        const caps = this.caps[device.id];
        const said = caps && !caps.guessed && caps.bedW > 1 && caps.bedH > 1 ? caps : null;
        select.innerHTML = '';
        for (const [key, label, w, h] of this.BEDS) {
            if (said && w && (w > said.bedW + 0.15 || h > said.bedH + 0.15)) continue;
            const o = document.createElement('option');
            o.value = key;
            o.textContent = key === 'auto' && said ? `As the scanner says · ${+said.bedW.toFixed(1)} × ${+said.bedH.toFixed(1)} in` : label;
            select.appendChild(o);
        }
        const chosen = (this.get(this.KEY_BED, {}) || {})[device.id];
        select.value = [...select.options].some(o => o.value === chosen) ? chosen : 'auto';
    },

    // The scanner went away (unplugged, switched off, asleep), jammed, or
    // had nothing in its feeder: a dialog saying what to do. → Try again?
    trouble(e, name, saved) {
        const kept = saved ? [`${saved} photo${saved === 1 ? ' was' : 's were'} saved before it stopped; Try again carries on with the names after ${saved === 1 ? 'it' : 'them'}.`] : [];
        if (e.code === 'offline') {
            return UI.confirm({
                title: `${name || 'The scanner'} isn't answering`,
                message: 'It may have been unplugged, switched off, or gone to sleep.',
                items: ['Check its USB cable at both ends, and that it\'s switched on.', 'Asleep? Press a button on it, or switch it off and on again, and wait for it to be ready.', ...kept],
                ok: 'Try again',
                cancel: 'Close'
            });
        }
        if (e.code === 'jam') {
            return UI.confirm({
                title: 'Paper jam',
                message: `${name || 'The scanner'} has a photo stuck in it. Open it, take the photo out gently, and check it's not damaged.`,
                items: kept,
                ok: 'Try again',
                cancel: 'Close'
            });
        }
        return UI.confirm({
            title: 'Nothing in the feeder',
            message: 'Load the photos into the feeder (face down, top edge first, unless your scanner says otherwise), then Try again.',
            items: kept,
            ok: 'Try again',
            cancel: 'Close'
        });
    },

    pvError(text) {
        this.pvErrorText = text;
        this.boxesChanged(ScanPreview.boxes);
    },

    boxesChanged(boxes) {
        const n = boxes.length;
        const count = this.el('scan-pv-count');
        const go = this.el('scan-go');
        const error = !n && this.pvErrorText;
        count.classList.toggle('error', !!error);
        count.textContent = error ? this.pvErrorText
            : n ? `${n} photo${n === 1 ? '' : 's'}`
            : this.waiting ? '' : 'No prints found: drag on the glass to mark one';
        if (n) this.pvErrorText = '';
        if (this.el('scan-panel').dataset.state !== 'preview') return;
        go.textContent = n ? `Scan ${n} photo${n === 1 ? '' : 's'}` : 'Scan';
        go.disabled = !n || !!this.waiting || !(this.pv && this.pv.bed);
        const pv = this.pv;
        const names = this.el('scan-pv-names');
        if (!pv || !n) { names.textContent = ''; return; }
        const { prefix, next, digits } = pv.more ? this.continuing(pv.folder) : pv;
        names.textContent = `Into ${Folders.label(pv.folder)}: ${this.name(prefix, next, digits || 3)}` + (n > 1 ? ` … ${this.name(prefix, next + n - 1, digits || 3)}` : '');
    },

    scanBoxes() {
        const pv = this.pv;
        const boxes = ScanPreview.boxes.filter(b => b.w > 0 && b.h > 0);
        if (!pv || !pv.bed || !boxes.length) return;
        const r4 = (v) => Math.round(v * 10000) / 10000;
        const o = this.opts();
        this.saveOpts(o);
        const opts = {
            device: pv.device.id, driver: pv.device.driver, folder: pv.folder, autoCrop: pv.autoCrop, compat: pv.compat,
            source: 'glass',
            crops: boxes.map(b => ({ x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h), angle: Math.round((b.angle || 0) * 10) / 10, turn: b.turn || 0 })),
            dpi: o.dpi, gray: o.color === 'gray', bedW: pv.bed.w, bedH: pv.bed.h,
            brightness: o.brightness, contrast: o.contrast, format: o.format, quality: o.quality
        };
        if (!pv.more) Object.assign(opts, { prefix: pv.prefix, next: pv.next, digits: pv.digits });
        pv.more = true; // next time, the names carry on
        this.lastMode = 'glass';
        this.run(opts).catch(() => { /* said already */ });
    },

    // Scans into `folder` (a folder of the order: '' is the order itself).
    // Without prefix/next, names follow on from the folder's photos.
    // → { count, names, cancelled }
    // jEditor's settings (source 'glass' with crops, or 'feeder'): dpi,
    // gray, bedW, bedH, sides, swap, brightness, contrast, format, quality.
    // Scan more and Try again: the names the last scan used, carried on
    // (a prefix typed for it, like Smith-B-, isn't swapped for the folder's
    // most used one); else as the folder's photos go
    continuing(folder) {
        const last = this.lastNaming;
        if (!last || last.folder !== folder || last.dir !== this.app.dirHandle) return this.naming(folder);
        let next = last.next;
        for (const f of this.app.files) {
            if (Folders.dirOf(f) !== folder) continue;
            const m = this.PHOTO.exec(f.name);
            if (m && m[1] === last.prefix) next = Math.max(next, parseInt(m[2], 10) + 1);
        }
        return { prefix: last.prefix, next, digits: last.digits };
    },

    async run({ device, driver, folder = '', prefix, next, digits, autoCrop = false, compat, crops, dpi, source = 'driver', ...settings }) {
        const original = arguments[0];
        const app = this.app;
        const native = FolderCache.native();
        if (this.running) throw new Error('A scan is already running');
        if (prefix === undefined || next === undefined) ({ prefix, next, digits } = this.continuing(folder));
        this.lastNaming = { dir: app.dirHandle, folder, prefix, next, digits: digits || 3 };
        // The names saved move it on (one stopped part way included)
        const advance = (name) => {
            const m = this.PHOTO.exec(name.split('/').pop());
            if (m && m[1] === prefix) this.lastNaming.next = Math.max(this.lastNaming.next, parseInt(m[2], 10) + 1);
        };
        // TIFFs aren't shown in jEditor, so there's nothing to auto crop
        if (settings.format === 'tiff') autoCrop = false;
        const root = await FolderCache.orderPath(app);
        if (!root) {
            app.showToast('jEditor can\'t tell where this project is on disk, so it can\'t scan into it. Open it with Open folder.', 6000);
            throw new Error('order path unknown');
        }
        const path = root.replace(/\\$/, '') + (folder ? '\\' + folder.split('/').join('\\') : '');
        const names = [];
        const label = () => names.length ? `Scanning… ${names.length} photo${names.length === 1 ? '' : 's'}`
            : crops ? `Scanning the glass at ${dpi} dpi…` : source === 'feeder' ? `Scanning the feeder at ${dpi} dpi…` : 'Scanning… (the scanner\'s window may be behind jEditor)';
        this.running = true;
        app.beginTask('scanner', label());
        // The dock shows it, with Stop (a scanner whose window never shows
        // can't hold jEditor up)
        const scannerName = ((this.devices || []).find(d => d.id === device) || {}).name || 'the scanner';
        const panel = this.el('scan-panel');
        panel.classList.remove('hidden');
        this.setState('scanning');
        this.el('scan-title').textContent = `Scanning · ${scannerName}`;
        this.el('scan-summary').textContent = `Into ${Folders.label(folder)} · ${this.name(prefix, next, digits || 3)}, ${this.name(prefix, next + 1, digits || 3)}, …`;
        this.clearStrip();
        this.newest = null;
        this.el('scan-show-live').checked = this.el('scan-show').checked;
        this.status(crops ? `Scanning the glass at ${dpi} dpi: ${crops.length} photo${crops.length === 1 ? '' : 's'} to cut from it.`
            : source === 'feeder' ? `Scanning the feeder at ${dpi} dpi: each photo shows up as it comes in.` : `Waiting for ${scannerName}. Its window may be behind jEditor.`);
        const done = (text, error) => {
            this.setState('done');
            this.el('scan-title').textContent = `Scanned · ${scannerName}`;
            this.status(text, error);
        };
        const show = () => Watch.request({ dirs: [folder] });
        const add = (name) => {
            const rel = folder ? `${folder}/${name}` : name;
            if (!names.includes(rel)) names.push(rel);
            advance(name);
        };
        let result;
        try {
            if (compat === undefined) compat = driver === 'twain' && !!this.compat()[device];
            const request = { device, driver, folder: path, prefix, next, digits: digits || 3, compat, source, ...settings };
            if (crops) Object.assign(request, { crops });
            if (dpi) request.dpi = dpi;
            result = await native.scan(request, (name) => {
                add(name);
                app.updateTask('scanner', label());
                this.status(label());
                this.addThumb(folder, name);
                show();
                // The newest one, large (a back stays behind its photo)
                if (!/-b\.[^.]+$/.test(name) && /\.(jpe?g|png|webp)$/i.test(name)) {
                    this.newest = folder ? `${folder}/${name}` : name;
                    if (this.el('scan-show').checked) app.showWhenIn(this.newest);
                }
            });
            (result.names || []).forEach(add); // the full list, in case a message was missed
            this.adoptCompat(device, result);
            if (names.length) this.keepListed(device);
        } catch (e) {
            (e.names || []).forEach(add);
            show();
            app.endTask('scanner');
            this.running = false;
            done(`Stopped: ${e.message}` + (names.length ? ` (${names.length} saved)` : ''), true);
            this.showDetails(true); // what the driver did
            if (e.code) {
                // Unplugged, off or asleep; jammed; or nothing in the feeder:
                // say so, and Try again carries on (the names follow on)
                const saved = names.length;
                this.trouble(e, scannerName, saved).then(again => {
                    if (!again) return;
                    const more = { ...original };
                    delete more.prefix;
                    delete more.next;
                    this.run(more).catch(() => { /* said already */ });
                });
            } else {
                UI.alert({
                    title: 'The scan didn\'t finish',
                    message: e.message + (names.length ? ` (${names.length} photo${names.length === 1 ? ' was' : 's were'} saved before it stopped.)` : '')
                });
            }
            throw e;
        }
        show();
        app.endTask('scanner');
        this.running = false;
        const n = names.length;
        const said = `${n} photo${n === 1 ? '' : 's'} into ${Folders.label(folder)}`;
        // The scanner cropped each photo itself (its own auto-size, as the
        // FastFoto's): Auto crop would only find edges inside the photos
        if (result.autosized) autoCrop = false;
        if (n) {
            done((result.cancelled ? 'Stopped after ' : 'Scanned ') + said + (autoCrop ? ' · auto cropping…' : '') + (source === 'feeder' && !result.cancelled ? '. Load the next batch, then Scan more.' : ''));
            app.showToast(`Scanned ${said}`, 4000, 'scanned', null, { type: 'success', kind: 'scan' });
            if (autoCrop) {
                await this.autoCrop(names, { feeder: source === 'feeder' });
                if (panel.dataset.state === 'done') this.status((result.cancelled ? 'Stopped after ' : 'Scanned ') + said + ' · auto cropped');
            }
        } else if (result.cancelled) {
            done('Scan stopped');
            app.showToast('Scan stopped', 2500, null, null, { type: 'info' });
        } else {
            done('Nothing was scanned');
            app.showToast('Nothing was scanned', 3000, null, null, { type: 'info' });
        }
        return { count: n, names, cancelled: result.cancelled };
    },

    // Prints come in all sizes: each scan is cropped to the print on it
    // (Auto crop; the originals are kept, so Ctrl+Z undoes it)
    async autoCrop(names, { feeder = false } = {}) {
        const app = this.app;
        const find = () => names.map(n => app.files.find(f => (f.relPath || f.name) === n)).filter(Boolean);
        for (let i = 0; i < 50 && find().length < names.length; i++) await new Promise(r => setTimeout(r, 200));
        const files = find();
        if (files.length) await app.batchAutoCrop(files, { ask: false, feeder, scan: true });
    }
};
