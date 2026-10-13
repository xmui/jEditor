// Scanning (the Windows app): photos from a scanner straight into the open
// project, in the scan dock: a panel floating over the photos (drag it by
// its title, make it small with —) that never blocks anything, so you can
// keep working, or work in another window, while it scans.
//
//   setup     which scanner, which folder of the project and how to name the
//             photos: next in the folder's sequence (Smith-014.jpg after
//             Smith-013.jpg), worked out from what's there. Scan opens the
//             scanner's own window (size, resolution, feeder, backs).
//   scanning  the last photos in, as they land (each also shows up in the
//             grid straight away), and Stop
//   done      how many, and Scan more (names carry on), Change settings

const Scan = {
    KEY: 'jeditor.scan', // last scanner used (this PC)
    KEY_COMPAT: 'jeditor.scanCompat', // scanners in compatibility mode
    KEY_POS: 'jeditor.scanDock', // where the dock was dragged to
    STRIP: 6, // photos shown in the dock
    PHOTO: /^(.*?)(\d+)\.(jpe?g|tiff?|png|webp)$/i,

    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        const panel = this.el('scan-panel');
        if (!panel || !FolderCache.native()) return;
        this.el('btn-scan').addEventListener('click', () => this.open());
        this.el('scan-x').addEventListener('click', () => this.close());
        this.el('scan-min').addEventListener('click', () => this.setSmall(!panel.classList.contains('small')));
        this.el('scan-cancel').addEventListener('click', () => this.close());
        this.el('scan-stop').addEventListener('click', () => FolderCache.native().cancelScan());
        this.el('scan-settings').addEventListener('click', () => this.setState('setup'));
        this.el('scan-refresh').addEventListener('click', () => this.loadDevices(true));
        this.el('scan-device').addEventListener('change', () => this.syncCompat());
        this.el('scan-folder').addEventListener('change', () => this.fillNames());
        this.el('scan-prefix').addEventListener('input', () => this.preview());
        this.el('scan-next').addEventListener('input', () => this.preview());
        this.el('scan-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.start();
        });
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
        this.fillFolders();
        this.fillNames();
        const last = this.last();
        this.el('scan-autocrop').checked = !last || last.autoCrop !== false;
        this.el('scan-go').focus();
        await this.loadDevices(false);
    },

    // While it scans, closing only makes it small
    close() {
        if (this.running) return this.setSmall(true);
        this.el('scan-panel').classList.add('hidden');
    },

    setSmall(small) {
        this.el('scan-panel').classList.toggle('small', small);
        this.el('scan-min').title = small ? 'Show it all' : 'Make small';
    },

    setState(state) {
        const panel = this.el('scan-panel');
        panel.dataset.state = state;
        this.el('scan-go').textContent = state === 'done' ? 'Scan more' : 'Scan';
        this.el('scan-cancel').textContent = state === 'done' ? 'Done' : 'Cancel';
        if (state === 'setup') {
            this.el('scan-title').textContent = 'Scan into this project';
            this.el('scan-go').disabled = !(this.devices && this.devices.length);
        }
    },

    // Dragged by its title; stays where it was put
    initDrag() {
        const panel = this.el('scan-panel');
        const head = this.el('scan-head');
        const place = (x, y) => {
            const r = panel.getBoundingClientRect();
            x = Math.max(4, Math.min(innerWidth - r.width - 4, x));
            y = Math.max(4, Math.min(innerHeight - 40, y));
            Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
            return { x, y };
        };
        try {
            const pos = JSON.parse(localStorage.getItem(this.KEY_POS) || 'null');
            if (pos) requestAnimationFrame(() => place(pos.x, pos.y));
        } catch (e) { /* none */ }
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
                if (pos) try { localStorage.setItem(this.KEY_POS, JSON.stringify(pos)); } catch (err) { /* private */ }
            };
            head.addEventListener('pointermove', move);
            head.addEventListener('pointerup', up);
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
        while (strip.children.length > this.STRIP) {
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

    async loadDevices(fresh) {
        const select = this.el('scan-device');
        const note = this.el('scan-problems');
        if (!this.devices || fresh) {
            select.innerHTML = '<option value="">Looking for scanners…</option>';
            select.disabled = true;
            this.el('scan-go').disabled = true;
            note.textContent = '';
            try {
                const r = await FolderCache.native().scanners();
                this.devices = r.devices || [];
                this.problems = r.problems || [];
            } catch (e) {
                this.devices = [];
                this.problems = ['Couldn\'t look for scanners: ' + e.message];
            }
        }
        select.innerHTML = '';
        for (const d of this.devices) {
            const o = document.createElement('option');
            o.value = d.id;
            o.textContent = d.driver === 'wia' ? `${d.name} (WIA)` : d.name;
            select.appendChild(o);
        }
        const last = this.last();
        if (last && this.devices.some(d => d.id === last.device)) select.value = last.device;
        select.disabled = !this.devices.length;
        this.el('scan-go').disabled = !this.devices.length;
        if (!this.devices.length) {
            const o = document.createElement('option');
            o.value = '';
            o.textContent = 'No scanners found';
            select.appendChild(o);
        }
        this.syncCompat();
        note.textContent = this.devices.length ? '' : 'Is the scanner plugged in and turned on? ' + this.problems.join('. ');
        if (this.devices.length && this.problems.length) note.textContent = this.problems.join('. ');
    },

    // Compatibility mode: TWAIN scanners only, remembered for each
    compat() {
        try { return JSON.parse(localStorage.getItem(this.KEY_COMPAT) || '{}') || {}; } catch (e) { return {}; }
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

    fillNames() {
        const n = this.naming(this.el('scan-folder').value);
        this.el('scan-prefix').value = n.prefix;
        this.el('scan-next').value = n.next;
        this.digits = n.digits;
        this.preview();
    },

    name(prefix, n, digits) {
        return prefix + String(n).padStart(digits, '0') + '.jpg';
    },

    preview() {
        const prefix = this.el('scan-prefix').value;
        const next = Math.max(0, parseInt(this.el('scan-next').value, 10) || 0);
        this.el('scan-preview').textContent = `${this.name(prefix, next, this.digits || 3)}, ${this.name(prefix, next + 1, this.digits || 3)}, …`;
    },

    // ---- Scanning ----

    start() {
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
        try { localStorage.setItem(this.KEY, JSON.stringify({ device: device.id, autoCrop })); } catch (e) { /* private */ }
        // Scan more: the names carry on from the photos just scanned
        const more = this.el('scan-panel').dataset.state === 'done';
        const opts = { device: device.id, driver: device.driver, folder, autoCrop, compat };
        if (!more) Object.assign(opts, { prefix, next, digits: this.digits });
        this.run(opts).catch(() => { /* said already */ });
    },

    // Scans into `folder` (a folder of the order: '' is the order itself).
    // Without prefix/next, names follow on from the folder's photos.
    // → { count, names, cancelled }
    async run({ device, driver, folder = '', prefix, next, digits, autoCrop = false, compat }) {
        const app = this.app;
        const native = FolderCache.native();
        if (this.running) throw new Error('A scan is already running');
        if (prefix === undefined || next === undefined) ({ prefix, next, digits } = this.naming(folder));
        const root = await FolderCache.orderPath(app);
        if (!root) {
            app.showToast('jEditor can\'t tell where this project is on disk, so it can\'t scan into it. Open it with Open folder.', 6000);
            throw new Error('order path unknown');
        }
        const path = root.replace(/\\$/, '') + (folder ? '\\' + folder.split('/').join('\\') : '');
        const names = [];
        const label = () => names.length ? `Scanning… ${names.length} photo${names.length === 1 ? '' : 's'}` : 'Scanning… (the scanner\'s window may be behind jEditor)';
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
        this.status(`Waiting for ${scannerName}. Its window may be behind jEditor.`);
        const done = (text, error) => {
            this.setState('done');
            this.el('scan-title').textContent = `Scanned · ${scannerName}`;
            this.status(text, error);
        };
        const show = () => Watch.request({ dirs: [folder] });
        const add = (name) => {
            const rel = folder ? `${folder}/${name}` : name;
            if (!names.includes(rel)) names.push(rel);
        };
        let result;
        try {
            if (compat === undefined) compat = driver === 'twain' && !!this.compat()[device];
            result = await native.scan({ device, driver, folder: path, prefix, next, digits: digits || 3, compat }, (name) => {
                add(name);
                app.updateTask('scanner', label());
                this.status(label());
                this.addThumb(folder, name);
                show();
            });
            (result.names || []).forEach(add); // the full list, in case a message was missed
        } catch (e) {
            (e.names || []).forEach(add);
            show();
            app.endTask('scanner');
            this.running = false;
            done(`Stopped: ${e.message}` + (names.length ? ` (${names.length} saved)` : ''), true);
            UI.alert({
                title: 'The scan didn\'t finish',
                message: e.message + (names.length ? ` (${names.length} photo${names.length === 1 ? ' was' : 's were'} saved before it stopped.)` : '')
            });
            throw e;
        }
        show();
        app.endTask('scanner');
        this.running = false;
        const n = names.length;
        const said = `${n} photo${n === 1 ? '' : 's'} into ${Folders.label(folder)}`;
        if (n) {
            done((result.cancelled ? 'Stopped after ' : 'Scanned ') + said + (autoCrop ? ' · auto cropping…' : ''));
            app.showToast(`Scanned ${said}`, 4000, 'scanned', null, { type: 'success' });
            if (autoCrop) {
                await this.autoCrop(names);
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
    async autoCrop(names) {
        const app = this.app;
        const find = () => names.map(n => app.files.find(f => (f.relPath || f.name) === n)).filter(Boolean);
        for (let i = 0; i < 50 && find().length < names.length; i++) await new Promise(r => setTimeout(r, 200));
        const files = find();
        if (files.length) await app.batchAutoCrop(files, { ask: false });
    }
};
