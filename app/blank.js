// Paint's start: a new canvas, or something to open (the landing page's
// Paint, and New blank image… on a folder's right-click menu). Two tabs:
//
//   New canvas   a size from the list (prints at 300 dpi, screens and social
//                posts, the photo open now, the last one made) or typed, in
//                pixels, inches or centimetres at a resolution, turned either
//                way; white, black, see-through or a colour; saved as a PNG
//                (with its resolution, so it prints at that size) in a folder
//                of the project, or a folder chosen, and opened in Paint
//   Open a file  an image from anywhere, opened on its own (leaving Paint paints
//                into it), or a folder of photos, opened as a project in Paint

const Blank = {
    MAX: 10000, // pixels a side
    // [key, label, w, h (px), dpi, unit, group]: prints are portrait (⇄ turns them)
    SIZES: [
        ['4x6', '4 × 6 in', 1200, 1800, 300, 'in', 'Print · 300 dpi'],
        ['5x7', '5 × 7 in', 1500, 2100, 300, 'in', 'Print · 300 dpi'],
        ['8x10', '8 × 10 in', 2400, 3000, 300, 'in', 'Print · 300 dpi'],
        ['a4', 'A4', 2480, 3508, 300, 'cm', 'Print · 300 dpi'],
        ['letter', 'Letter', 2550, 3300, 300, 'in', 'Print · 300 dpi'],
        ['hd', 'HD screen', 1920, 1080, 72, 'px', 'Screen and social'],
        ['4k', '4K screen', 3840, 2160, 72, 'px', 'Screen and social'],
        ['square', 'Square post', 1080, 1080, 72, 'px', 'Screen and social'],
        ['portrait', 'Portrait post', 1080, 1350, 72, 'px', 'Screen and social'],
        ['story', 'Story', 1080, 1920, 72, 'px', 'Screen and social']
    ],
    UNITS: { px: 'px', in: 'in', cm: 'cm' },
    KEY: 'jeditor.blank', // the last size, resolution, units and background

    el(id) { return document.getElementById(id); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        const panel = this.el('blank-panel');
        if (!panel) return;
        this.el('blank-tab-new').addEventListener('click', () => this.tab('new'));
        this.el('blank-tab-open').addEventListener('click', () => this.tab('open'));
        this.el('blank-open-instead').addEventListener('click', () => this.tab('open'));
        for (const id of ['blank-w', 'blank-h']) this.el(id).addEventListener('input', () => this.typed());
        this.el('blank-unit').addEventListener('change', () => this.setUnit(this.el('blank-unit').value));
        this.el('blank-dpi').addEventListener('change', () => this.setDpi(+this.el('blank-dpi').value));
        this.el('blank-turn').addEventListener('click', () => this.turn());
        for (const r of panel.querySelectorAll('input[name="blank-bg"]')) r.addEventListener('change', () => this.sync());
        this.el('blank-color').addEventListener('input', () => {
            this.el('blank-bg-color').checked = true;
            this.sync();
        });
        this.el('blank-name').addEventListener('input', () => this.sync());
        this.el('blank-where').addEventListener('change', () => this.sync());
        this.el('blank-cancel').addEventListener('click', () => this.close(false));
        this.el('blank-close').addEventListener('click', () => this.close(false));
        this.el('blank-go').addEventListener('click', () => this.close(true));
        this.el('blank-open-image').addEventListener('click', () => this.close('image'));
        this.el('blank-open-folder').addEventListener('click', () => this.close('folder'));
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.close(false); });
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(false); }
            else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && this.pane === 'new') { e.preventDefault(); e.stopPropagation(); this.close(true); }
        });
    },

    isOpen() {
        const panel = this.el('blank-panel');
        return !!panel && !panel.classList.contains('hidden');
    },

    // A project open that can be written to
    can() {
        const app = this.app;
        return !!(app && app.dirHandle && !app.readOnlyMode);
    },

    get() {
        try { return JSON.parse(localStorage.getItem(this.KEY) || 'null') || {}; } catch (e) { return {}; }
    },

    // folder: where it goes ('' the project itself; null: as the dialog
    // chooses). start: from the landing page, Open a file offered too
    async open(folder = null, { start = false } = {}) {
        const app = this.app;
        if (!start && !this.can() && app.dirHandle) {
            app.showToast('This folder can\'t be written to', 3000);
            return null;
        }
        this.start = start || !this.can();
        this.folder = folder;
        const last = this.get();
        this.dpi = [72, 150, 300, 600].includes(last.dpi) ? last.dpi : 72;
        this.unit = this.UNITS[last.unit] ? last.unit : 'px';
        this.px = { w: Math.round(last.w) || 1920, h: Math.round(last.h) || 1080 };
        this.fillPresets();
        this.fillWhere();
        this.el('blank-unit').value = this.unit;
        this.el('blank-dpi').value = String(this.dpi);
        this.show();
        const bg = ['white', 'black', 'clear', 'color'].includes(last.bg) ? last.bg : 'white';
        this.el(`blank-bg-${bg}`).checked = true;
        if (/^#[0-9a-f]{6}$/i.test(last.color || '')) this.el('blank-color').value = last.color;
        this.el('blank-panel').querySelector('.blank-tabs').classList.toggle('hidden', !this.start);
        this.el('blank-open-instead').classList.toggle('hidden', !this.start);
        this.el('blank-title').textContent = this.start ? 'Paint' : 'New blank image';
        this.el('blank-name').value = this.freeName('Untitled');
        this.tab('new');
        this.el('blank-panel').classList.remove('hidden');
        this.sync();
        requestAnimationFrame(() => { const n = this.el('blank-name'); n.focus(); n.select(); });
        const go = await new Promise(res => { this._done = res; });
        if (go === 'image') return this.openImage();
        if (go === 'folder') return this.openFolder();
        if (!go) return null;
        return this.create();
    },

    close(go) {
        if (go === true && !this.valid()) return;
        const panel = this.el('blank-panel');
        panel.classList.add('hidden');
        if (panel.contains(document.activeElement)) document.activeElement.blur();
        const done = this._done;
        this._done = null;
        if (done) done(go);
    },

    tab(which) {
        this.pane = which;
        this.el('blank-tab-new').setAttribute('aria-selected', String(which === 'new'));
        this.el('blank-tab-open').setAttribute('aria-selected', String(which === 'open'));
        this.el('blank-tab-new').classList.toggle('active', which === 'new');
        this.el('blank-tab-open').classList.toggle('active', which === 'open');
        this.el('blank-new').classList.toggle('hidden', which !== 'new');
        this.el('blank-open').classList.toggle('hidden', which !== 'open');
        this.el('blank-go').classList.toggle('hidden', which !== 'new');
        this.el('blank-open-instead').classList.toggle('hidden', which !== 'new' || !this.start);
        if (which === 'open') requestAnimationFrame(() => this.el('blank-open-image').focus());
    },

    // ---- Sizes ----

    // The list: the last one made, the photo open now, prints, screens
    fillPresets() {
        const list = this.el('blank-presets');
        list.textContent = '';
        const groups = [];
        const add = (group, key, label, w, h, dpi, unit) => {
            let g = groups.find(x => x.name === group);
            if (!g) { g = { name: group, items: [] }; groups.push(g); }
            g.items.push({ key, label, w, h, dpi, unit });
        };
        const last = this.get();
        if (last.w && last.h) add('Recent', 'last', 'Last used', Math.round(last.w), Math.round(last.h), last.dpi || 72, last.unit || 'px');
        const f = this.app.currentFile;
        const dims = f && f._dims;
        if (dims && dims.w && dims.h) add('Recent', 'photo', `Same as ${f.name}`, dims.w, dims.h, 72, 'px');
        for (const [key, label, w, h, dpi, unit, group] of this.SIZES) add(group, key, label, w, h, dpi, unit);
        this.presets = groups.flatMap(g => g.items);
        for (const g of groups) {
            const p = document.createElement('p');
            p.className = 'blank-group';
            p.textContent = g.name;
            list.appendChild(p);
            for (const it of g.items) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'blank-preset';
                b.dataset.key = it.key;
                b.setAttribute('role', 'option');
                const s = 18 / Math.max(it.w, it.h);
                b.innerHTML = '<i aria-hidden="true"><b></b></i><span></span><small></small>';
                const shape = b.querySelector('b');
                shape.style.width = `${Math.max(4, Math.round(it.w * s))}px`;
                shape.style.height = `${Math.max(4, Math.round(it.h * s))}px`;
                b.querySelector('span').textContent = it.label;
                b.querySelector('small').textContent = `${it.w} × ${it.h}`;
                b.title = `${it.label}: ${it.w} × ${it.h} pixels${it.dpi >= 150 ? `, ${this.inUnit(it.w, it.unit === 'px' ? 'in' : it.unit, it.dpi)} × ${this.inUnit(it.h, it.unit === 'px' ? 'in' : it.unit, it.dpi)} ${it.unit === 'cm' ? 'cm' : 'in'} at ${it.dpi} dpi` : ''}`;
                b.addEventListener('click', () => this.pick(it));
                list.appendChild(b);
            }
        }
    },

    pick(it) {
        this.px = { w: it.w, h: it.h };
        this.dpi = it.dpi;
        this.unit = it.unit;
        this.el('blank-unit').value = this.unit;
        this.el('blank-dpi').value = String(this.dpi);
        this.show();
        this.sync();
    },

    // Pixels in a unit at the resolution, rounded to what's sensible to type
    inUnit(px, unit, dpi = this.dpi) {
        if (unit === 'px') return Math.round(px);
        const v = unit === 'in' ? px / dpi : px / dpi * 2.54;
        return Math.round(v * 100) / 100;
    },

    toPx(v, unit = this.unit, dpi = this.dpi) {
        v = +v;
        if (!(v > 0)) return 0;
        return Math.round(unit === 'px' ? v : unit === 'in' ? v * dpi : v / 2.54 * dpi);
    },

    // The boxes from the size in pixels
    show() {
        this.el('blank-w').value = this.inUnit(this.px.w, this.unit);
        this.el('blank-h').value = this.inUnit(this.px.h, this.unit);
        this.el('blank-w').step = this.unit === 'px' ? '1' : 'any';
        this.el('blank-h').step = this.unit === 'px' ? '1' : 'any';
    },

    // Numbers typed: the size in pixels from them
    typed() {
        this.px = { w: this.toPx(this.el('blank-w').value), h: this.toPx(this.el('blank-h').value) };
        this.sync();
    },

    setUnit(unit) {
        this.unit = unit;
        this.show();
        this.sync();
    },

    // Another resolution: inches and centimetres stay, the pixels follow
    setDpi(dpi) {
        if (this.unit !== 'px') {
            const w = +this.el('blank-w').value, h = +this.el('blank-h').value;
            this.dpi = dpi;
            this.px = { w: this.toPx(w), h: this.toPx(h) };
        } else {
            this.dpi = dpi;
        }
        this.sync();
    },

    turn() {
        this.px = { w: this.px.h, h: this.px.w };
        this.show();
        this.sync();
    },

    size() {
        const clamp = (v) => Math.max(1, Math.min(this.MAX, Math.round(v) || 1));
        return { w: clamp(this.px.w), h: clamp(this.px.h) };
    },

    // ---- Where it goes ----

    // A folder of the project (the one right-clicked, or being looked at),
    // or one chosen when it's made
    fillWhere() {
        const select = this.el('blank-where');
        select.textContent = '';
        if (this.can()) {
            const dirs = new Set(['']);
            for (const p of Folders.map.keys()) dirs.add(p);
            for (const p of [...dirs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
                const o = document.createElement('option');
                o.value = p;
                o.textContent = p ? Folders.label(p) : Folders.rootName();
                select.appendChild(o);
            }
        }
        const pick = document.createElement('option');
        pick.value = '\u0000pick';
        pick.textContent = this.can() ? 'Another folder…' : 'Choose a folder when it\'s made…';
        select.appendChild(pick);
        const want = this.folder !== null && this.folder !== undefined ? this.folder : Folders.newFolderParent();
        select.value = this.can() && [...select.options].some(o => o.value === want) ? want : pick.value;
    },

    where() {
        const v = this.el('blank-where').value;
        return v === '\u0000pick' ? null : v;
    },

    // The names of what's in the folder now (lower case)
    taken(folder = this.where()) {
        const set = new Set();
        if (folder === null || !this.app.dirHandle) return set;
        for (const f of this.app.files) if (Folders.dirOf(f) === folder) set.add(f.name.toLowerCase());
        return set;
    },

    // Untitled, Untitled-2, Untitled-3… whichever isn't there
    freeName(base) {
        const taken = this.taken(this.can() ? (this.folder !== null && this.folder !== undefined ? this.folder : Folders.newFolderParent()) : null);
        for (let i = 1; i < 10000; i++) {
            const n = i === 1 ? base : `${base}-${i}`;
            if (!taken.has(`${n}.png`.toLowerCase())) return n;
        }
        return `${base}-${Date.now()}`;
    },

    background() {
        const r = this.el('blank-panel').querySelector('input[name="blank-bg"]:checked');
        const bg = r ? r.value : 'white';
        return { bg, fill: bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : bg === 'color' ? this.el('blank-color').value : null };
    },

    problem() {
        const name = this.el('blank-name').value.trim();
        const typed = ['blank-w', 'blank-h'].map(id => +this.el(id).value);
        if (typed.some(v => !(v > 0))) return 'Give it a width and a height';
        if (this.px.w > this.MAX || this.px.h > this.MAX) return `${this.MAX.toLocaleString()} pixels a side at most (that's ${this.inUnit(this.MAX, 'in')} in at ${this.dpi} dpi)`;
        if (!name) return 'Give it a name';
        const bad = Folders.nameProblem(name);
        if (bad && !/Export/.test(bad)) return bad.replace('A folder name', 'A name');
        if (this.taken().has(`${name}.png`.toLowerCase())) return `“${name}.png” is already there`;
        return null;
    },

    valid() {
        const p = this.problem();
        this.el('blank-error').textContent = p || '';
        return !p;
    },

    sync() {
        const { w, h } = this.size();
        const { bg, fill } = this.background();
        this.el('blank-color').classList.toggle('dim', bg !== 'color');
        // Which size in the list this is, either way round
        let match = null;
        for (const it of this.presets || []) {
            if ((it.w === w && it.h === h) || (it.w === h && it.h === w)) { match = it.key; break; }
        }
        for (const b of this.el('blank-presets').querySelectorAll('.blank-preset')) {
            b.classList.toggle('on', b.dataset.key === match);
            b.setAttribute('aria-selected', String(b.dataset.key === match));
        }
        // The shape, to scale
        const shape = this.el('blank-shape');
        const s = 120 / Math.max(w, h);
        shape.style.width = `${Math.max(6, Math.round(w * s))}px`;
        shape.style.height = `${Math.max(6, Math.round(h * s))}px`;
        shape.style.background = fill || '';
        shape.classList.toggle('clear', !fill);
        const mp = (w * h) / 1e6;
        const big = Math.max(w, h) > Paint.MAX_EDGE;
        const inches = `${this.inUnit(w, 'in')} × ${this.inUnit(h, 'in')} in`;
        this.el('blank-info').textContent = `${w.toLocaleString()} × ${h.toLocaleString()} px · ${mp < 1 ? mp.toFixed(2) : mp.toFixed(1)} megapixels`
            + (this.dpi >= 150 || this.unit !== 'px' ? ` · ${inches} at ${this.dpi} dpi` : '')
            + (big ? ` · Paint draws at up to ${Paint.MAX_EDGE.toLocaleString()} px on its long side, and scales up to this` : '');
        const p = this.problem();
        this.el('blank-error').textContent = p && this.el('blank-name').value ? p : '';
        this.el('blank-go').disabled = !!p;
    },

    // ---- Making it ----

    // The picture, as a PNG with its resolution (pHYs), so it prints at size
    async render(w, h, fill, dpi = 72) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d');
        if (fill) {
            g.fillStyle = fill;
            g.fillRect(0, 0, w, h);
        }
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error('the picture couldn\'t be made (too big for this computer?)');
        return this.withDpi(blob, dpi);
    },

    // A pHYs chunk (pixels per metre) after the PNG's IHDR
    async withDpi(blob, dpi) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length < 33 || bytes[12] !== 0x49 || bytes[13] !== 0x48) return blob; // not IHDR first
        const ppm = Math.round(dpi / 0.0254);
        const chunk = new Uint8Array(21);
        const v = new DataView(chunk.buffer);
        v.setUint32(0, 9);
        chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
        v.setUint32(8, ppm);
        v.setUint32(12, ppm);
        chunk[16] = 1; // per metre
        v.setUint32(17, this.crc(chunk.subarray(4, 17)));
        const at = 33; // signature 8 + IHDR 25
        return new Blob([bytes.subarray(0, at), chunk, bytes.subarray(at)], { type: 'image/png' });
    },

    crc(data) {
        const table = this._crcTable || (this._crcTable = Array.from({ length: 256 }, (_, n) => {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            return c >>> 0;
        }));
        let c = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    },

    // Made and saved, shown and opened in Paint. → the file
    async create() {
        const app = this.app;
        const { w, h } = this.size();
        const { bg, fill } = this.background();
        const dpi = this.dpi;
        const name = `${this.el('blank-name').value.trim()}.png`;
        try { localStorage.setItem(this.KEY, JSON.stringify({ w, h, bg, color: this.el('blank-color').value, dpi, unit: this.unit })); } catch (e) { /* private */ }
        let folder = this.where();
        // A folder to choose first: opened as the project, the canvas made in it
        if (folder === null) {
            const before = app.dirHandle;
            Modes.hold = true;
            try {
                await app.browseFolder();
                for (let i = 0; i < 100 && app.isLoading; i++) await new Promise(r => setTimeout(r, 50));
            } finally {
                Modes.hold = false;
            }
            if (!app.dirHandle || app.dirHandle === before || app.readOnlyMode) return null;
            folder = '';
        }
        const rel = folder ? `${folder}/${name}` : name;
        app.beginTask('blank', `Making ${name}…`);
        try {
            const blob = await this.render(w, h, fill, dpi);
            const dir = await Folders.handleFor(folder);
            let exists = false;
            try { await dir.getFileHandle(name); exists = true; } catch (e) { /* free */ }
            if (exists) throw new Error(`${name} is already there`);
            const handle = await dir.getFileHandle(name, { create: true });
            const out = await handle.createWritable();
            await out.write(blob);
            await out.close();
        } catch (e) {
            console.error('New blank image failed:', e);
            app.showToast(`Couldn't make ${name}: ${e.message}`, 4000);
            return null;
        } finally {
            app.endTask('blank');
        }
        Watch.request({ dirs: [folder] });
        let file = null;
        for (let i = 0; i < 60 && !file; i++) {
            file = app.files.find(f => (f.relPath || f.name) === rel);
            if (!file) await new Promise(r => setTimeout(r, 100));
        }
        if (!file) {
            app.showToast(`Made ${name}`, 2500, null, null, { type: 'success' });
            return null;
        }
        if (!Folders.inView(file) && Folders.scope !== null && Folders.scope !== undefined) Folders.setScope(folder);
        // Out of Adjust or Paint first (what was done there kept)
        if (Modes.current() !== 'photos' && !(await Modes.leave(true))) return file;
        app.openSingle(file);
        if (!app.paintOn()) Experiments.set('paint', true);
        await app.enterPaint(file);
        return file;
    },

    // ---- Open a file ----

    // An image on its own: leaving Paint paints into it. Where the browser can't
    // give a file to write to, the phone's way (picked.js: Save hands it back)
    async openImage() {
        const app = this.app;
        if (typeof window.showOpenFilePicker === 'function') {
            let handle;
            try {
                [handle] = await window.showOpenFilePicker({
                    id: 'jeditor-paint',
                    types: [{ description: 'Images', accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] } }]
                });
            } catch (e) {
                return null; // cancelled
            }
            if (!handle) return null;
            if (Raw.is(handle.name) || /\.gif$/i.test(handle.name)) {
                UI.alert({ title: 'That can\'t be painted on here', message: 'RAW files and GIFs open with their folder: choose A folder… instead.' });
                return null;
            }
            Modes.next = 'paint';
            await app.openFileHandles([handle]);
            return app.files[0] || null;
        }
        if (typeof Picked !== 'undefined' && Picked.available()) {
            Modes.next = 'paint';
            Picked.choose();
            return null;
        }
        app.showToast('This browser can\'t open a single file: choose A folder… instead', 3500);
        return null;
    },

    // A folder of photos, as a project, in Paint
    async openFolder() {
        const app = this.app;
        app.uiPrefs.startIn = 'paint';
        app.saveUiPrefs();
        Modes.next = 'paint';
        await app.browseFolder();
        return null;
    }
};
