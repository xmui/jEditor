// Tethered shooting (the Windows app): a camera on USB (a Sony Alpha in
// PC Remote mode) shooting straight into the open project, as Lightroom's
// tethered capture does. In a dock like the scan dock:
//
//   setup       which camera, which folder of the project, the names (next
//               in the folder's sequence, as for scans), keep a copy on the
//               camera's card, show each photo as it comes in
//   connecting  / live: the camera's live view, the shutter (the round
//               button, Take photo, or F12 anywhere in jEditor), the last
//               photos as they land. Shots taken with the camera's own
//               button come in too; RAW + JPEG keep one number
//               (Smith-014.arw, Smith-014.jpg).
//
// The app runs the camera (Camera/Tether.cs); Details shows what it says.

const Camera = {
    KEY: 'jeditor.camera', // last camera and choices (this PC)
    KEY_POS: 'jeditor.camDock',
    STRIP: 6,

    el(id) { return document.getElementById(id); },
    native() { return FolderCache.native(); },

    init(app) {
        this.app = app;
        const panel = this.el('cam-panel');
        if (!panel || !Host.has('camera')) return;
        this.el('btn-camera').addEventListener('click', () => this.open());
        this.el('cam-x').addEventListener('click', () => this.close());
        this.el('cam-min').addEventListener('click', () => this.setSmall(!panel.classList.contains('small')));
        this.el('cam-big').addEventListener('click', () => this.setBig(!panel.classList.contains('big')));
        this.el('cam-cancel').addEventListener('click', () => this.close());
        this.el('cam-stop').addEventListener('click', () => this.native().tetherStop());
        this.el('cam-take').addEventListener('click', () => this.shoot());
        this.el('cam-shoot').addEventListener('click', () => this.shoot());
        this.el('cam-refresh').addEventListener('click', () => this.loadCameras(true));
        this.el('cam-device').addEventListener('change', () => this.syncNote());
        this.el('cam-folder').addEventListener('change', () => this.fillNames());
        this.el('cam-prefix').addEventListener('input', () => this.namesPreview());
        this.el('cam-next').addEventListener('input', () => this.namesPreview());
        this.el('cam-liveview').addEventListener('change', () => {
            this.syncLive();
            this.save();
        });
        this.el('cam-card').addEventListener('change', () => {
            this.save();
            if (this.session) this.native().tetherSet({ keepOnCard: this.el('cam-card').checked });
        });
        this.el('cam-show').addEventListener('change', () => this.save());
        this.el('cam-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.connect();
        });
        this.details = LogView.attach(this.el('cam-log'), app);
        this.el('cam-details').addEventListener('click', () => {
            const on = !this.details.shown;
            if (on) this.details.show(); else this.details.hide();
            this.el('cam-details').setAttribute('aria-pressed', String(on));
        });
        panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || UI.isOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            this.close();
        });
        // F12 takes a photo, wherever you are in jEditor
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'F12' || !this.connected) return;
            e.preventDefault();
            e.stopPropagation();
            this.shoot();
        }, true);
        this.el('cam-frame').addEventListener('load', () => this.native().tetherAck());
        this.el('cam-frame').addEventListener('error', () => this.native().tetherAck());
        this.initDrag();
    },

    // Keys typed in the dock are its own
    isOpen() {
        const panel = this.el('cam-panel');
        return !!panel && !panel.classList.contains('hidden') && panel.contains(document.activeElement) &&
            document.activeElement !== panel;
    },

    visible() {
        const panel = this.el('cam-panel');
        return !!panel && !panel.classList.contains('hidden');
    },

    prefs() {
        try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch (e) { return {}; }
    },

    save() {
        try {
            localStorage.setItem(this.KEY, JSON.stringify({
                camera: this.el('cam-device').value || this.prefs().camera,
                keepOnCard: this.el('cam-card').checked,
                show: this.el('cam-show').checked,
                live: this.el('cam-liveview').checked
            }));
        } catch (e) { /* private */ }
    },

    async open() {
        const app = this.app;
        const panel = this.el('cam-panel');
        if (this.session) {
            panel.classList.remove('hidden');
            this.setSmall(false);
            return;
        }
        if (!app.dirHandle || app.readOnlyMode) {
            app.showToast('Open a project first: photos go into its folder', 3500);
            return;
        }
        const p = this.prefs();
        this.el('cam-card').checked = p.keepOnCard !== false;
        this.el('cam-show').checked = p.show !== false;
        this.el('cam-liveview').checked = p.live !== false;
        panel.classList.remove('hidden');
        this.setSmall(false);
        this.setState('setup');
        this.fillFolders();
        this.fillNames();
        this.el('cam-go').focus();
        await this.loadCameras(false);
    },

    // While connected, closing only makes it small
    close() {
        if (this.session) return this.setSmall(true);
        this.el('cam-panel').classList.add('hidden');
        if (this.details.shown) {
            this.details.hide();
            this.el('cam-details').setAttribute('aria-pressed', 'false');
        }
    },

    setSmall(small) {
        this.el('cam-panel').classList.toggle('small', small);
        this.el('cam-min').title = small ? 'Show it all' : 'Make small';
        this.syncLive();
    },

    setBig(big) {
        this.el('cam-panel').classList.toggle('big', big);
        this.el('cam-big').setAttribute('aria-pressed', String(big));
    },

    setState(state) {
        this.el('cam-panel').dataset.state = state;
        if (state === 'setup') {
            this.el('cam-title').textContent = 'Camera';
            this.setBig(false);
        }
    },

    // Live view only while it can be seen (frames cost the camera time)
    syncLive() {
        const panel = this.el('cam-panel');
        const on = this.el('cam-liveview').checked && !panel.classList.contains('small') && !panel.classList.contains('hidden');
        if (this.session) this.native().tetherLive(on);
        if (!on) this.el('cam-frame').removeAttribute('src');
        this.el('cam-view-note').textContent = !this.el('cam-liveview').checked && this.connected ? 'Live view is off' : (this.viewNote || '');
    },

    initDrag() {
        const panel = this.el('cam-panel');
        const head = this.el('cam-head');
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
            if (e.button !== 0 || e.target.closest('button') || panel.classList.contains('big')) return;
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

    // ---- Cameras ----

    async loadCameras(fresh) {
        const select = this.el('cam-device');
        if (!this.cameras || fresh) {
            select.innerHTML = '<option value="">Looking for cameras…</option>';
            select.disabled = true;
            this.el('cam-go').disabled = true;
            try {
                this.cameras = await this.native().cameras();
            } catch (e) {
                this.cameras = [];
                this.problem = 'Couldn\'t look for cameras: ' + e.message;
            }
        }
        select.innerHTML = '';
        for (const c of this.cameras) {
            const o = document.createElement('option');
            o.value = c.id;
            o.textContent = c.ready ? c.name : `${c.name} (not in PC Remote mode)`;
            select.appendChild(o);
        }
        if (!this.cameras.length) {
            const o = document.createElement('option');
            o.value = '';
            o.textContent = 'No camera found';
            select.appendChild(o);
        }
        const last = this.prefs().camera;
        if (this.cameras.some(c => c.id === last)) select.value = last;
        else {
            const ready = this.cameras.find(c => c.ready);
            if (ready) select.value = ready.id;
        }
        select.disabled = !this.cameras.length;
        this.syncNote();
    },

    current() {
        return (this.cameras || []).find(c => c.id === this.el('cam-device').value) || null;
    },

    syncNote() {
        const c = this.current();
        const note = this.el('cam-note');
        note.textContent = !this.cameras || !this.cameras.length
            ? (this.problem || 'Is the camera plugged in with a USB cable, turned on, and set to PC Remote? (Menu → Network or Setup → USB Connection → PC Remote)')
            : c && c.note ? c.note : '';
        this.el('cam-go').disabled = !c || !c.ready;
    },

    // ---- Where, and what names (as for scans) ----

    fillFolders() {
        const select = this.el('cam-folder');
        select.innerHTML = '';
        for (const p of Scan.folders()) {
            const o = document.createElement('option');
            o.value = p;
            o.textContent = Folders.label(p);
            select.appendChild(o);
        }
        select.value = Scan.defaultFolder();
    },

    fillNames() {
        const n = Scan.naming(this.el('cam-folder').value);
        this.el('cam-prefix').value = n.prefix;
        this.el('cam-next').value = n.next;
        this.digits = n.digits;
        this.namesPreview();
    },

    namesPreview() {
        const prefix = this.el('cam-prefix').value;
        const next = Math.max(0, parseInt(this.el('cam-next').value, 10) || 0);
        const name = (n) => prefix + String(n).padStart(this.digits || 3, '0');
        this.el('cam-names').textContent = `${name(next)}.jpg, ${name(next + 1)}.jpg, … (RAW files keep the same number)`;
    },

    // ---- Shooting ----

    async connect() {
        const camera = this.current();
        if (!camera || !camera.ready || this.session) return;
        const app = this.app;
        const folder = this.el('cam-folder').value;
        const prefix = this.el('cam-prefix').value;
        const next = Math.max(0, parseInt(this.el('cam-next').value, 10) || 0);
        this.save();
        return this.run({ camera: camera.id, name: camera.name, folder, prefix, next, digits: this.digits || 3 }).catch(() => { /* said already */ });
    },

    // Tethers into `folder` (a folder of the project) until Disconnect, or
    // the camera goes. → { count, names }
    async run({ camera, name, folder = '', prefix, next, digits = 3 }) {
        const app = this.app;
        const native = this.native();
        if (this.session) throw new Error('A camera is already connected');
        const root = await FolderCache.orderPath(app);
        if (!root) {
            app.showToast('jEditor can\'t tell where this project is on disk. Open it with Open folder.', 6000);
            throw new Error('project path unknown');
        }
        const path = root.replace(/\\$/, '') + (folder ? '\\' + folder.split('/').join('\\') : '');
        const names = [];
        const panel = this.el('cam-panel');
        panel.classList.remove('hidden');
        this.session = { folder };
        this.connected = false;
        this.setState('connecting');
        this.el('cam-title').textContent = `Camera · ${name}`;
        this.el('cam-summary').textContent = `Into ${Folders.label(folder)} · ${prefix}${String(next).padStart(digits, '0')}.jpg, …`;
        this.clearStrip();
        this.status(`Connecting to ${name}…`);
        this.viewNote = 'Connecting…';
        this.el('cam-view-note').textContent = this.viewNote;
        const show = () => Watch.request({ dirs: [folder] });
        let result;
        try {
            result = await native.tether({
                camera, name, folder: path, prefix, next, digits,
                keepOnCard: this.el('cam-card').checked,
                live: this.el('cam-liveview').checked && !panel.classList.contains('small')
            }, (e) => {
                if (e.kind === 'connected') {
                    this.connected = true;
                    this.setState('live');
                    this.el('cam-title').textContent = `Camera · ${e.name}`;
                    this.viewNote = '';
                    this.syncLive();
                    app.showToast(`${e.name} connected: F12 takes a photo`, 3000, null, null, { type: 'success', kind: 'scan' });
                } else if (e.kind === 'frame') {
                    if (this.el('cam-liveview').checked) this.el('cam-frame').src = e.image;
                    else native.tetherAck();
                } else if (e.kind === 'saved') {
                    const rel = folder ? `${folder}/${e.name}` : e.name;
                    names.push(rel);
                    this.el('cam-panel').classList.remove('shooting');
                    this.addThumb(folder, e.name);
                    this.status(`${this.countText(names)} · last: ${e.name}`);
                    show();
                    if (this.el('cam-show').checked && /\.(jpe?g|png|webp|tiff?|heic|hif)$/i.test(e.name)) this.app.showWhenIn(rel);
                } else if (e.kind === 'status') {
                    this.status(e.text, !!e.error);
                    if (e.error) this.el('cam-panel').classList.remove('shooting');
                }
            });
        } catch (e) {
            (e.names || []).forEach(n => names.includes(n) || names.push(n));
            this.ended(`Disconnected: ${e.message}`, true);
            UI.alert({ title: 'The camera disconnected', message: e.message + (names.length ? ` (${this.countText(names)} came in before it did.)` : '') });
            show();
            throw e;
        }
        show();
        this.ended(names.length ? `Disconnected · ${this.countText(names)} into ${Folders.label(folder)}` : 'Disconnected', false);
        return { count: result.count, names };
    },

    countText(names) {
        // RAW + JPEG are one photo
        const shots = new Set(names.map(n => n.replace(/\.[^.]+$/, ''))).size;
        return `${shots} photo${shots === 1 ? '' : 's'}`;
    },

    ended(text, error) {
        this.session = null;
        this.connected = false;
        this.el('cam-panel').classList.remove('shooting');
        this.el('cam-frame').removeAttribute('src');
        this.viewNote = '';
        this.setState('setup');
        this.fillFolders();
        this.fillNames();
        this.el('cam-note').textContent = text;
        this.el('cam-note').classList.toggle('error', error);
        if (error && !this.details.shown) {
            this.details.show();
            this.el('cam-details').setAttribute('aria-pressed', 'true');
        }
    },

    shoot() {
        if (!this.connected) return;
        this.el('cam-panel').classList.add('shooting');
        this.native().tetherShoot();
        clearTimeout(this._shooting);
        this._shooting = setTimeout(() => this.el('cam-panel').classList.remove('shooting'), 8000);
    },

    status(text, error = false) {
        const el = this.el('cam-status');
        el.textContent = text;
        el.classList.toggle('error', error);
    },

    async addThumb(folder, name) {
        const strip = this.el('cam-strip');
        const fig = document.createElement('figure');
        const cap = document.createElement('figcaption');
        cap.textContent = name;
        fig.appendChild(cap);
        strip.appendChild(fig);
        while (strip.children.length > this.STRIP) {
            const old = strip.firstElementChild;
            const img = old.querySelector('img');
            if (img) URL.revokeObjectURL(img.src);
            old.remove();
        }
        const raw = Raw.is(name), heif = Codec.isHeif(name);
        if (!raw && !heif && !/\.(jpe?g|png|webp)$/i.test(name)) return; // anything else: the name shows
        try {
            const dir = await Folders.handleFor(folder);
            let file = await (await dir.getFileHandle(name)).getFile();
            // A RAW: its own JPEG (raw.js); a HEIC, decoded (codec.js)
            if (raw) file = await Raw.preview(file);
            else if (heif) file = await Codec.showable(file);
            if (!file) return;
            if (!fig.isConnected) return;
            const img = document.createElement('img');
            img.alt = '';
            img.decoding = 'async';
            img.src = URL.createObjectURL(file);
            fig.prepend(img);
        } catch (e) { /* the name shows */ }
    },

    clearStrip() {
        const strip = this.el('cam-strip');
        strip.querySelectorAll('img').forEach(img => URL.revokeObjectURL(img.src));
        strip.innerHTML = '';
    }
};
