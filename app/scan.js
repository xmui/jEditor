// Scanning (the Windows app): photos from a scanner straight into the open
// order.
//
// Scan (toolbar) asks which scanner, which folder of the order and how to
// name the photos: next in the folder's sequence (Smith-014.jpg after
// Smith-013.jpg), worked out from what's there. The scanner's own window
// then opens for size, resolution, feeder and the backs of photos. Each
// photo is saved into the folder as it comes in and shows up straight away,
// so a stack in the feeder fills the grid while it scans.

const Scan = {
    KEY: 'jeditor.scan', // last scanner used (this PC)
    KEY_COMPAT: 'jeditor.scanCompat', // scanners in compatibility mode
    PHOTO: /^(.*?)(\d+)\.(jpe?g|tiff?|png|webp)$/i,

    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        const panel = this.el('scan-panel');
        if (!panel || !FolderCache.native()) return;
        this.el('btn-scan').addEventListener('click', () => this.open());
        this.el('scan-x').addEventListener('click', () => this.close());
        this.el('scan-cancel').addEventListener('click', () => this.close());
        this.el('scan-refresh').addEventListener('click', () => this.loadDevices(true));
        this.el('scan-device').addEventListener('change', () => this.syncCompat());
        this.el('scan-folder').addEventListener('change', () => this.fillNames());
        this.el('scan-prefix').addEventListener('input', () => this.preview());
        this.el('scan-next').addEventListener('input', () => this.preview());
        this.el('scan-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.start();
        });
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.close(); });
        panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || UI.isOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            this.close();
        });
    },

    isOpen() {
        const panel = this.el('scan-panel');
        return !!panel && !panel.classList.contains('hidden');
    },

    async open() {
        const app = this.app;
        if (this.running) {
            app.showToast('A scan is already running', 2500, null, null, { type: 'info' });
            return;
        }
        if (!app.dirHandle || app.readOnlyMode) {
            app.showToast('Open a project first: scans go into its folder', 3500);
            return;
        }
        this.el('scan-panel').classList.remove('hidden');
        this.fillFolders();
        this.fillNames();
        const last = this.last();
        this.el('scan-autocrop').checked = !last || last.autoCrop !== false;
        this.el('scan-go').focus();
        await this.loadDevices(false);
    },

    close() {
        this.el('scan-panel').classList.add('hidden');
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
        this.close();
        this.run({ device: device.id, driver: device.driver, folder, prefix, next, digits: this.digits, autoCrop, compat })
            .catch(() => { /* said already */ });
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
        // Stays while it scans, with Stop (a scanner whose window never
        // shows can't hold jEditor up)
        const scannerName = ((this.devices || []).find(d => d.id === device) || {}).name || 'the scanner';
        const stop = app.showToast(`Scanning with ${scannerName}. Its window may be behind jEditor.`, 0, 'scanning',
            { label: 'Stop', run: () => native.cancelScan() }, { type: 'info' });
        const done = () => { if (stop && stop.isConnected) app.dismissToast(stop); };
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
                show();
            });
            (result.names || []).forEach(add); // the full list, in case a message was missed
        } catch (e) {
            (e.names || []).forEach(add);
            show();
            app.endTask('scanner');
            done();
            this.running = false;
            UI.alert({
                title: 'The scan didn\'t finish',
                message: e.message + (names.length ? ` (${names.length} photo${names.length === 1 ? ' was' : 's were'} saved before it stopped.)` : '')
            });
            throw e;
        }
        show();
        app.endTask('scanner');
        done();
        this.running = false;
        const n = names.length;
        if (n) {
            app.showToast(`Scanned ${n} photo${n === 1 ? '' : 's'} into ${Folders.label(folder)}`, 6000, 'scanned',
                { label: 'Scan more', run: () => this.again({ device, driver, folder, autoCrop, compat }) }, { type: 'success' });
            if (autoCrop) await this.autoCrop(names);
        } else if (result.cancelled) {
            app.showToast('Scan stopped', 2500, null, null, { type: 'info' });
        } else {
            app.showToast('Nothing was scanned', 3000, null, null, { type: 'info' });
        }
        return { count: n, names, cancelled: result.cancelled };
    },

    // Same scanner and folder, names following on from the last scan
    again({ device, driver, folder, autoCrop, compat }) {
        // After the folder check has picked up the last photos
        setTimeout(() => this.run({ device, driver, folder, autoCrop, compat }).catch(() => { }), Watch.DEBOUNCE_MS + 400);
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
