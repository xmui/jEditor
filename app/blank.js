// New blank image (right-click a folder, or the grid's background): a
// picture of nothing, any size, to paint on. Its size from a list (screens,
// social posts, prints at 300 dpi, the photo open now) or typed, turned
// either way; white, black, see-through or a colour; saved as a PNG in the
// folder and, if you like, opened in Paint straight away.

const Blank = {
    MAX: 10000, // pixels a side
    // [key, label, w, h]: prints are portrait (⇄ turns them)
    SIZES: [
        ['hd', 'HD screen · 1920 × 1080', 1920, 1080],
        ['4k', '4K screen · 3840 × 2160', 3840, 2160],
        ['square', 'Square post · 1080 × 1080', 1080, 1080],
        ['portrait', 'Portrait post · 1080 × 1350', 1080, 1350],
        ['story', 'Story · 1080 × 1920', 1080, 1920],
        ['4x6', '4 × 6 in print · 1200 × 1800', 1200, 1800],
        ['5x7', '5 × 7 in print · 1500 × 2100', 1500, 2100],
        ['8x10', '8 × 10 in print · 2400 × 3000', 2400, 3000],
        ['a4', 'A4 · 2480 × 3508', 2480, 3508],
        ['letter', 'Letter · 2550 × 3300', 2550, 3300]
    ],
    KEY: 'jeditor.blank', // the last size, background and Open in Paint

    el(id) { return document.getElementById(id); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        const panel = this.el('blank-panel');
        if (!panel) return;
        const size = this.el('blank-size');
        for (const [key, label] of this.SIZES) {
            const o = document.createElement('option');
            o.value = key;
            o.textContent = label;
            size.appendChild(o);
        }
        size.addEventListener('change', () => this.pickSize());
        for (const id of ['blank-w', 'blank-h']) this.el(id).addEventListener('input', () => this.typed());
        this.el('blank-turn').addEventListener('click', () => this.turn());
        for (const r of panel.querySelectorAll('input[name="blank-bg"]')) r.addEventListener('change', () => this.sync());
        this.el('blank-color').addEventListener('input', () => {
            this.el('blank-bg-color').checked = true;
            this.sync();
        });
        this.el('blank-name').addEventListener('input', () => this.sync());
        this.el('blank-cancel').addEventListener('click', () => this.close(false));
        this.el('blank-close').addEventListener('click', () => this.close(false));
        this.el('blank-go').addEventListener('click', () => this.close(true));
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.close(false); });
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(false); }
            else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); this.close(true); }
        });
    },

    isOpen() {
        const panel = this.el('blank-panel');
        return !!panel && !panel.classList.contains('hidden');
    },

    can() {
        const app = this.app;
        return !!(app && app.dirHandle && !app.readOnlyMode);
    },

    get() {
        try { return JSON.parse(localStorage.getItem(this.KEY) || 'null') || {}; } catch (e) { return {}; }
    },

    // The dialog, for a new image in `folder` ('' is the project itself)
    async open(folder = Folders.newFolderParent()) {
        if (!this.can()) {
            this.app.showToast('Open a project first: the image goes into one of its folders', 3000);
            return;
        }
        this.folder = folder || '';
        const last = this.get();
        const size = this.el('blank-size');
        // The photo open now: its size first
        size.querySelector('option[value="photo"]')?.remove();
        const f = this.app.currentFile;
        const dims = f && f._dims;
        if (dims && dims.w && dims.h) {
            const o = document.createElement('option');
            o.value = 'photo';
            o.textContent = `Same as ${f.name} · ${dims.w} × ${dims.h}`;
            o.dataset.w = dims.w;
            o.dataset.h = dims.h;
            size.insertBefore(o, size.querySelector('option[value="custom"]').nextSibling);
        }
        const w = Math.round(last.w) || 1920, h = Math.round(last.h) || 1080;
        this.el('blank-w').value = w;
        this.el('blank-h').value = h;
        this.matchSize();
        const bg = ['white', 'black', 'clear', 'color'].includes(last.bg) ? last.bg : 'white';
        this.el(`blank-bg-${bg}`).checked = true;
        if (/^#[0-9a-f]{6}$/i.test(last.color || '')) this.el('blank-color').value = last.color;
        const paint = this.el('blank-paint');
        paint.checked = last.paint !== false;
        this.el('blank-where').textContent = `Into ${this.folder ? Folders.label(this.folder) : Folders.rootName()}`;
        const name = this.el('blank-name');
        name.value = this.freeName('Untitled');
        this.el('blank-panel').classList.remove('hidden');
        this.sync();
        requestAnimationFrame(() => { name.focus(); name.select(); });
        const go = await new Promise(res => { this._done = res; });
        if (!go) return null;
        return this.create();
    },

    close(go) {
        if (go && !this.valid()) return;
        const panel = this.el('blank-panel');
        panel.classList.add('hidden');
        if (panel.contains(document.activeElement)) document.activeElement.blur();
        const done = this._done;
        this._done = null;
        if (done) done(!!go);
    },

    // The names of what's in the folder now (lower case)
    taken() {
        const set = new Set();
        for (const f of this.app.files) if (Folders.dirOf(f) === this.folder) set.add(f.name.toLowerCase());
        return set;
    },

    // Untitled, Untitled-2, Untitled-3… whichever isn't there
    freeName(base) {
        const taken = this.taken();
        for (let i = 1; i < 10000; i++) {
            const n = i === 1 ? base : `${base}-${i}`;
            if (!taken.has(`${n}.png`.toLowerCase())) return n;
        }
        return `${base}-${Date.now()}`;
    },

    size() {
        const clamp = (v) => Math.max(1, Math.min(this.MAX, Math.round(+v) || 0));
        return { w: clamp(this.el('blank-w').value), h: clamp(this.el('blank-h').value) };
    },

    // A size chosen from the list: its numbers in the boxes
    pickSize() {
        const v = this.el('blank-size').value;
        const opt = this.el('blank-size').selectedOptions[0];
        const s = this.SIZES.find(x => x[0] === v);
        const w = s ? s[2] : opt && opt.dataset.w ? +opt.dataset.w : 0;
        const h = s ? s[3] : opt && opt.dataset.h ? +opt.dataset.h : 0;
        if (w && h) {
            this.el('blank-w').value = w;
            this.el('blank-h').value = h;
        }
        this.sync();
    },

    // Numbers typed: the list says which size that is (either way round), or Custom
    matchSize() {
        const { w, h } = this.size();
        const size = this.el('blank-size');
        let match = 'custom';
        for (const o of size.options) {
            const s = this.SIZES.find(x => x[0] === o.value);
            const ow = s ? s[2] : +o.dataset.w, oh = s ? s[3] : +o.dataset.h;
            if (ow && oh && ((ow === w && oh === h) || (ow === h && oh === w))) { match = o.value; break; }
        }
        size.value = match;
    },

    typed() {
        this.matchSize();
        this.sync();
    },

    turn() {
        const w = this.el('blank-w').value;
        this.el('blank-w').value = this.el('blank-h').value;
        this.el('blank-h').value = w;
        this.sync();
    },

    background() {
        const r = this.el('blank-panel').querySelector('input[name="blank-bg"]:checked');
        const bg = r ? r.value : 'white';
        return { bg, fill: bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : bg === 'color' ? this.el('blank-color').value : null };
    },

    problem() {
        const name = this.el('blank-name').value.trim();
        const typed = ['blank-w', 'blank-h'].map(id => +this.el(id).value);
        if (typed.some(v => !(v >= 1))) return 'Give it a width and a height';
        if (typed.some(v => v > this.MAX)) return `${this.MAX.toLocaleString()} pixels a side at most`;
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
        const { bg } = this.background();
        this.el('blank-color').classList.toggle('dim', bg !== 'color');
        const mp = (w * h) / 1e6;
        const big = Math.max(w, h) > Paint.MAX_EDGE;
        this.el('blank-info').textContent = `${w.toLocaleString()} × ${h.toLocaleString()} px · ${mp < 1 ? mp.toFixed(2) : mp.toFixed(1)} megapixels`
            + (big ? ` · Paint draws at up to ${Paint.MAX_EDGE.toLocaleString()} px on its long side, so it's painted at that size and scaled up` : '');
        const p = this.problem();
        this.el('blank-error').textContent = p && this.el('blank-name').value ? p : '';
        this.el('blank-go').disabled = !!p;
    },

    // The picture, as a PNG
    async render(w, h, fill) {
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
        return blob;
    },

    // Made and saved, shown, and opened in Paint if asked. → the file
    async create() {
        const app = this.app;
        const { w, h } = this.size();
        const { bg, fill } = this.background();
        const paint = this.el('blank-paint').checked;
        const name = `${this.el('blank-name').value.trim()}.png`;
        try { localStorage.setItem(this.KEY, JSON.stringify({ w, h, bg, color: this.el('blank-color').value, paint })); } catch (e) { /* private */ }
        const folder = this.folder;
        const rel = folder ? `${folder}/${name}` : name;
        app.beginTask('blank', `Making ${name}…`);
        try {
            const blob = await this.render(w, h, fill);
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
        app.openSingle(file);
        if (paint) {
            if (!app.paintOn()) Experiments.set('paint', true);
            await app.enterPaint(file);
        } else {
            app.showToast(`Made ${name}`, 2500, null, null, { type: 'success' });
        }
        return file;
    }
};
