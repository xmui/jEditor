// Info's Edit (I, then Edit): the photo's title, caption, keywords,
// rating, author, copyright, date taken and place, for one photo or a
// whole selection (the owner's pick from the mockups, 24 November: an Edit
// button in Info, layout A). Info reads as before, with the fields that
// have something in them on top; Edit turns the pane into a short form,
// Done (Enter) saves and Cancel (Esc) leaves it.
//
// Saved straight into the photo (meta-fields.js: the picture isn't encoded
// again), or for a RAW, HEIC, AVIF or JPEG XL into an .xmp beside it, as
// Lightroom does. Not kept in jEditor like a crop: only the metadata
// changes, nothing can be lost, and every app sees it at once. Ctrl+Z
// puts the file (or the .xmp) back as it was, the whole selection in one step.
//
// A selection: a field whose value differs between the photos says Mixed,
// and is left alone unless it's changed; a field that's changed is set on
// all of them. A keyword only some have shows how many ("Christmas · 2 of 4");
// clicking it gives it to all, × takes it off all.

const MetaEditor = {
    files: null,     // being edited
    was: null,       // Map file → its fields when Edit was pressed
    form: null,

    init(app) {
        this.app = app;
    },

    // ---- Reading ----

    // A photo's fields, kept on it while the file is the same
    async fields(file) {
        const ver = `${file.size}|${file.lastModified}`;
        if (file._meta && file._meta.ver === ver) return file._meta.fields;
        let fields = MetaFields.empty();
        try {
            const data = await file.handle.getFile();
            // A JPEG's metadata is all at its start
            const jpeg = /\.jpe?g$/i.test(file.name);
            const big = data.size > 64 * 1024 * 1024;
            const bytes = new Uint8Array(await (jpeg ? data.slice(0, 1024 * 1024) : big ? data.slice(0, 4 * 1024 * 1024) : data).arrayBuffer());
            fields = await MetaFields.read(bytes, await this.sidecarText(file));
        } catch (e) { /* none */ }
        file._meta = { ver, fields };
        return fields;
    },

    async sidecarText(file) {
        if (MetaFields.where(file.name) !== 'sidecar') return null;
        try {
            const dir = file.parentDir || this.app.dirHandle;
            if (!dir) return null;
            const h = await dir.getFileHandle(MetaFields.sidecarName(file.name));
            return await (await h.getFile()).text();
        } catch (e) {
            return null;
        }
    },

    // Info's rows for what's filled in, to go on top of the file's own
    async rows(file) {
        const f = await this.fields(file);
        const rows = [];
        if (f.title) rows.push(['Title', f.title]);
        if (f.caption) rows.push(['Caption', f.caption]);
        if (f.keywords.length) rows.push(['Keywords', f.keywords.join(', ')]);
        if (f.rating) rows.push(['Rating', '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating)]);
        if (f.author) rows.push(['Author', f.author]);
        if (f.copyright) rows.push(['Copyright', f.copyright]);
        if (f.gps) rows.push(['Place', this.placeText(f.gps)]);
        return rows;
    },

    placeText(g) {
        return `${+g.lat.toFixed(6)}, ${+g.lon.toFixed(6)}`.replace(/-/g, '−');
    },

    // ---- The Edit button ----

    // Which photos Info is about, when they can be edited (else null)
    canEdit(files) {
        const app = this.app;
        if (!files || !files.length || app.readOnlyMode || app.library) return false;
        return true;
    },

    // The button at the top of Info, for these photos (or hidden)
    button(files) {
        const panel = this.app.elements.infoPanel;
        let b = document.getElementById('info-edit');
        if (!b) {
            b = document.createElement('button');
            b.id = 'info-edit';
            b.type = 'button';
            b.className = 'btn secondary info-edit';
            b.textContent = 'Edit';
            b.addEventListener('click', () => this.open(this._for));
            panel.querySelector('h3').after(b);
        }
        this._for = files;
        b.hidden = this.isOpen() || !this.canEdit(files);
        b.title = files && files.length > 1 ? `Edit the title, keywords, date and more of these ${files.length} photos` : 'Edit the title, caption, keywords, rating, date taken and more';
    },

    isOpen() {
        return !!this.files;
    },

    // ---- The form ----

    async open(files) {
        if (!this.canEdit(files) || !this.app.ensureWritable({ files: true })) return;
        if (this.isOpen()) this.close();
        const app = this.app;
        const list = files.slice();
        this.files = list;
        this.was = new Map();
        app.beginTask && list.length > 20 && app.beginTask('meta-read', `Reading ${list.length} photos…`);
        try {
            for (const f of list) this.was.set(f, await this.fields(f));
        } finally {
            if (list.length > 20) app.endTask('meta-read');
        }
        if (this.files !== list) return;
        this.build(list);
    },

    // Each field's value across the photos: { value, mixed }
    common(k) {
        const vals = [...this.was.values()].map(f => f[k]);
        const first = vals[0];
        const mixed = vals.some(v => !MetaFields.same(k, v, first));
        return { value: mixed ? (k === 'keywords' ? [] : MetaFields.empty()[k]) : first, mixed };
    },

    build(files) {
        const app = this.app;
        const panel = app.elements.infoPanel;
        const n = files.length;
        this.hidePane(true);
        const h3 = panel.querySelector('h3');
        this._title = h3.textContent;
        h3.textContent = n > 1 ? `Edit ${n.toLocaleString()} photos` : 'Edit info';
        const form = document.createElement('form');
        form.id = 'meta-form';
        form.className = 'meta-form';
        form.noValidate = true;
        form.setAttribute('aria-label', h3.textContent);
        this.form = form;
        this.dirty = new Set();
        const mixedWord = 'Mixed';
        const field = (k, label, el) => {
            const l = document.createElement('label');
            l.className = 'meta-row';
            l.dataset.field = k;
            const s = document.createElement('span');
            s.textContent = label;
            l.append(s, el);
            form.appendChild(l);
            return l;
        };
        const text = (k, label, { area = false, placeholder = '' } = {}) => {
            const { value, mixed } = this.common(k);
            const el = document.createElement(area ? 'textarea' : 'input');
            if (!area) el.type = 'text';
            el.className = 'field';
            el.id = `meta-${k}`;
            el.value = value || '';
            el.placeholder = mixed ? mixedWord : placeholder;
            el.classList.toggle('meta-mixed', mixed);
            el.spellcheck = k === 'title' || k === 'caption';
            el.addEventListener('input', () => this.dirty.add(k));
            field(k, label, el);
            return el;
        };
        text('title', 'Title');
        text('caption', 'Caption', { area: true });
        form.appendChild(this.keywordsRow(files));
        form.appendChild(this.ratingRow());
        // The date and time taken, to the second
        {
            const { value, mixed } = this.common('taken');
            const el = document.createElement('input');
            el.type = 'datetime-local';
            el.step = 1;
            el.className = 'field';
            el.id = 'meta-taken';
            el.value = value || '';
            el.addEventListener('input', () => this.dirty.add('taken'));
            const row = field('taken', 'Taken', el);
            if (mixed) row.classList.add('meta-row-mixed');
        }
        text('author', 'Author', { placeholder: 'Separate several with ;' });
        text('copyright', 'Copyright');
        // The place: latitude and longitude (a pair pasted into either is split)
        {
            const { value, mixed } = this.common('gps');
            const box = document.createElement('div');
            box.className = 'meta-two';
            const mk = (id, v, ph) => {
                const el = document.createElement('input');
                el.type = 'text';
                el.inputMode = 'decimal';
                el.className = 'field';
                el.id = id;
                el.value = v == null ? '' : String(+v.toFixed(6));
                el.placeholder = mixed ? mixedWord : ph;
                el.classList.toggle('meta-mixed', mixed);
                el.addEventListener('input', () => {
                    this.dirty.add('gps');
                    const pair = el.value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
                    if (pair) { lat.value = pair[1]; lon.value = pair[2]; }
                    this.checkGps();
                });
                return el;
            };
            const lat = mk('meta-lat', value && value.lat, 'Latitude');
            const lon = mk('meta-lon', value && value.lon, 'Longitude');
            lat.setAttribute('aria-label', 'Latitude');
            lon.setAttribute('aria-label', 'Longitude');
            box.append(lat, lon);
            field('gps', 'Place', box);
        }
        // Done and Cancel; where it's saved
        const foot = document.createElement('div');
        foot.className = 'meta-foot';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn secondary';
        cancel.id = 'meta-cancel';
        cancel.textContent = 'Cancel';
        cancel.title = 'Cancel (Esc)';
        cancel.addEventListener('click', () => this.close());
        const done = document.createElement('button');
        done.type = 'submit';
        done.className = 'btn primary';
        done.id = 'meta-done';
        done.textContent = 'Done';
        done.title = 'Save (Enter)';
        foot.append(cancel, done);
        form.appendChild(foot);
        const note = document.createElement('p');
        note.className = 'meta-note';
        note.id = 'meta-note';
        note.textContent = this.whereNote(files);
        form.appendChild(note);
        form.addEventListener('submit', (e) => { e.preventDefault(); this.done(); });
        form.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
            // Enter in a box of one line saves; in the caption it's a new line, Ctrl+Enter saves
            else if (e.key === 'Enter' && e.target.tagName === 'TEXTAREA' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.done(); }
        });
        app.elements.infoList.after(form);
        panel.classList.add('meta-editing');
        const first = form.querySelector('input, textarea');
        if (first) first.focus({ preventScroll: true });
    },

    // Where it'll be written, in a line under the form
    whereNote(files) {
        const side = files.filter(f => MetaFields.where(f.name) === 'sidecar');
        const z = Host.say('Ctrl+Z');
        if (files.length === 1) {
            return side.length ? `Saved beside it, in ${MetaFields.sidecarName(files[0].name)}. ${z} undoes it.` : `Saved into the photo. ${z} undoes it.`;
        }
        const lead = 'A field you change is set on all of them; Mixed ones are left as they are.';
        if (!side.length) return `${lead} Saved into each photo. ${z} undoes it.`;
        if (side.length === files.length) return `${lead} Saved beside each, in an .xmp file. ${z} undoes it.`;
        return `${lead} Saved into each photo (RAWs and the like: an .xmp beside them). ${z} undoes it.`;
    },

    keywordsRow(files) {
        const n = files.length;
        const row = document.createElement('div');
        row.className = 'meta-row';
        row.dataset.field = 'keywords';
        const label = document.createElement('span');
        label.id = 'meta-kw-label';
        label.textContent = 'Keywords';
        // How many of the photos have each keyword
        const count = new Map();
        for (const f of this.was.values()) for (const k of f.keywords) count.set(k, (count.get(k) || 0) + 1);
        this.kw = { count, added: new Set(), removed: new Set(), all: new Set() };
        const box = document.createElement('div');
        box.className = 'field meta-kw';
        box.id = 'meta-keywords';
        box.setAttribute('role', 'group');
        box.setAttribute('aria-labelledby', 'meta-kw-label');
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'meta-kw-input';
        input.placeholder = 'Add…';
        input.setAttribute('aria-label', 'Add a keyword');
        const chip = (word) => {
            const c = document.createElement('span');
            c.className = 'meta-chip';
            c.dataset.word = word;
            const some = this.kwCount(word);
            const t = document.createElement('span');
            t.textContent = some < n ? `${word} · ${some} of ${n}` : word;
            if (some < n) {
                c.classList.add('meta-chip-some');
                c.title = `On ${some} of these ${n} photos: click to give it to all of them`;
                t.addEventListener('click', () => { this.kw.all.add(word); this.dirty.add('keywords'); c.replaceWith(chip(word)); });
            }
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'meta-chip-x';
            x.textContent = '×';
            x.setAttribute('aria-label', `Take off ${word}`);
            x.addEventListener('click', () => this.removeWord(word, c));
            c.append(t, x);
            return c;
        };
        this._chip = chip;
        for (const word of [...count.keys()].sort((a, b) => count.get(b) - count.get(a))) box.insertBefore(chip(word), null);
        box.appendChild(input);
        const add = () => {
            const words = MetaFields.splitList(input.value);
            input.value = '';
            for (const w of words) {
                if (this.kwCount(w) === n && box.querySelector(`.meta-chip[data-word="${CSS.escape(w)}"]`)) continue;
                this.kw.removed.delete(w);
                this.kw.added.add(w);
                this.dirty.add('keywords');
                const old = box.querySelector(`.meta-chip[data-word="${CSS.escape(w)}"]`);
                if (old) old.replaceWith(chip(w)); else box.insertBefore(chip(w), input);
            }
        };
        input.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ',' || e.key === ';') && input.value.trim()) { e.preventDefault(); add(); }
            else if (e.key === 'Backspace' && !input.value) {
                const last = input.previousElementSibling;
                if (last) this.removeWord(last.dataset.word, last);
            }
        });
        input.addEventListener('blur', () => { if (input.value.trim()) add(); });
        box.addEventListener('click', (e) => { if (e.target === box) input.focus(); });
        row.append(label, box);
        return row;
    },

    // How many of the photos will have this keyword
    kwCount(word) {
        const n = this.files.length;
        if (this.kw.removed.has(word)) return 0;
        if (this.kw.added.has(word) || this.kw.all.has(word)) return n;
        return this.kw.count.get(word) || 0;
    },

    removeWord(word, el) {
        this.kw.added.delete(word);
        this.kw.all.delete(word);
        this.kw.removed.add(word);
        this.dirty.add('keywords');
        if (el) el.remove();
    },

    ratingRow() {
        const { value, mixed } = this.common('rating');
        const row = document.createElement('div');
        row.className = 'meta-row';
        row.dataset.field = 'rating';
        const label = document.createElement('span');
        label.id = 'meta-rating-label';
        label.textContent = 'Rating';
        const stars = document.createElement('div');
        stars.className = 'meta-stars';
        stars.id = 'meta-rating';
        stars.setAttribute('role', 'radiogroup');
        stars.setAttribute('aria-labelledby', 'meta-rating-label');
        this.rating = value || 0;
        const paint = () => {
            [...stars.querySelectorAll('button')].forEach((b, i) => {
                b.classList.toggle('on', i < this.rating);
                b.setAttribute('aria-checked', String(i + 1 === this.rating));
            });
            stars.classList.toggle('meta-mixed', mixed && !this.dirty.has('rating'));
        };
        for (let i = 1; i <= 5; i++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = '★';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-label', `${i} star${i > 1 ? 's' : ''}`);
            b.title = `${i} star${i > 1 ? 's' : ''} (click again for none)`;
            b.addEventListener('click', () => {
                this.rating = this.rating === i ? 0 : i;
                this.dirty.add('rating');
                paint();
            });
            stars.appendChild(b);
        }
        if (mixed) {
            const m = document.createElement('span');
            m.className = 'meta-mixed-word';
            m.textContent = 'Mixed';
            stars.appendChild(m);
        }
        row.append(label, stars);
        paint();
        return row;
    },

    gpsValue() {
        const lat = document.getElementById('meta-lat'), lon = document.getElementById('meta-lon');
        const a = lat.value.trim(), b = lon.value.trim();
        if (!a && !b) return { ok: true, gps: null };
        const la = Number(a.replace('−', '-')), lo = Number(b.replace('−', '-'));
        const ok = a !== '' && b !== '' && isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
        return { ok, gps: ok ? MetaFields.roundGps({ lat: la, lon: lo }) : null };
    },

    checkGps() {
        const { ok } = this.gpsValue();
        for (const id of ['meta-lat', 'meta-lon']) document.getElementById(id).classList.toggle('invalid', !ok);
        return ok;
    },

    // What the form says to change: { field: value } for the fields touched
    edits() {
        const out = {};
        const v = (id) => document.getElementById(id).value;
        for (const k of this.dirty) {
            if (k === 'title' || k === 'caption' || k === 'author' || k === 'copyright') out[k] = v(`meta-${k}`).trim();
            else if (k === 'taken') {
                const t = v('meta-taken');
                out.taken = t ? (t.length === 16 ? t + ':00' : t.slice(0, 19)) : '';
            } else if (k === 'rating') out.rating = this.rating;
            else if (k === 'gps') out.gps = this.gpsValue().gps;
        }
        return out;
    },

    // This photo's changes: only what differs from what it has
    changesFor(file, edits) {
        const was = this.was.get(file);
        const c = {};
        for (const [k, v] of Object.entries(edits)) if (!MetaFields.same(k, was[k], v)) c[k] = v;
        if (this.dirty.has('keywords')) {
            let words = was.keywords.filter(w => !this.kw.removed.has(w));
            for (const w of [...this.kw.all, ...this.kw.added]) if (!words.includes(w)) words.push(w);
            if (!MetaFields.same('keywords', was.keywords, words)) c.keywords = words;
        }
        return c;
    },

    async done() {
        if (!this.isOpen() || this._saving) return;
        if (this.dirty.has('gps') && !this.checkGps()) {
            this.app.showToast('The place needs a latitude (−90 to 90) and a longitude (−180 to 180), or neither');
            document.getElementById('meta-lat').focus();
            return;
        }
        const input = document.getElementById('meta-kw-input');
        if (input && input.value.trim()) input.dispatchEvent(new Event('blur'));
        const edits = this.edits();
        const files = this.files;
        const jobs = files.map(f => ({ file: f, changes: this.changesFor(f, edits) })).filter(j => Object.keys(j.changes).length);
        if (!jobs.length) { this.close(); return; }
        this._saving = true;
        try {
            await this.save(jobs);
        } finally {
            this._saving = false;
        }
        this.close();
    },

    // Written, with one undo step for all of them
    async save(jobs) {
        const app = this.app;
        const many = jobs.length > 1;
        if (many) app.beginTask('meta-save', `Saving 0/${jobs.length}`);
        const items = [];
        const failed = [];
        let done = 0;
        let next = 0;
        const worker = async () => {
            while (next < jobs.length) {
                const job = jobs[next++];
                try {
                    const undo = await this.write(job.file, job.changes);
                    if (undo) items.push(undo);
                } catch (e) {
                    console.error('Saving the metadata failed for', job.file.name, e);
                    failed.push({ file: job.file, why: e.message });
                }
                done++;
                if (many) app.updateTask && app.updateTask('meta-save', `Saving ${done}/${jobs.length}`);
            }
        };
        try {
            await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
        } finally {
            if (many) app.endTask('meta-save');
        }
        if (items.length) app.pushUndo({ type: 'group', label: 'edit info', count: items.length, items, done: Promise.resolve() });
        if (typeof SortKeys !== 'undefined' && SortKeys.save) SortKeys.save();
        if (jobs.some(j => 'taken' in j.changes) && /^taken/.test(app.sortMode || '')) app.sortFiles();
        const saved = items.length;
        if (failed.length) {
            const one = failed[0];
            app.showToast(failed.length === 1 && !saved
                ? `Couldn't save ${one.file.name}: ${one.why}`
                : `Saved ${saved}; ${failed.length} couldn't be (${one.file.name}: ${one.why})`, 6000);
        } else {
            app.showToast(saved === 1 ? 'Saved' : `Saved ${saved.toLocaleString()} photos`, 1800, null, null, { kind: 'undo' });
        }
    },

    // One photo's change written → its undo step
    async write(file, changes) {
        const app = this.app;
        await app.verifyPermission(file.handle, true);
        const before = { size: file.size, lastModified: file.lastModified };
        let undo;
        if (MetaFields.where(file.name) === 'sidecar') {
            const dir = file.parentDir || app.dirHandle;
            if (!dir) throw new Error('an .xmp can only be saved beside it in a folder');
            const name = MetaFields.sidecarName(file.name);
            const old = await this.sidecarText(file);
            const text = MetaFields.sidecarWith(old, changes);
            const h = await dir.getFileHandle(name, { create: true });
            const w = await h.createWritable();
            await w.write(new Blob([text], { type: 'application/rdf+xml' }));
            await w.close();
            undo = { type: 'sidecar', file, name, text: old, label: 'edit info' };
        } else {
            const data = await file.handle.getFile();
            const bytes = new Uint8Array(await data.arrayBuffer());
            const out = await MetaFields.write(bytes, changes);
            file.isBusy = true;
            try {
                const w = await file.handle.createWritable();
                await w.write(new Blob([out], { type: data.type }));
                await w.close();
            } finally {
                file.isBusy = false;
            }
            undo = { type: 'bytes', file, blob: new Blob([bytes], { type: data.type }), label: 'edit info', meta: true };
        }
        await app.afterMetaChanged(file, before, changes);
        return undo;
    },

    // Back to Info as it reads
    close() {
        const app = this.app;
        if (this.form) this.form.remove();
        this.form = null;
        this.files = null;
        this.was = null;
        const panel = app.elements.infoPanel;
        panel.classList.remove('meta-editing');
        if (this._title != null) panel.querySelector('h3').textContent = this._title;
        this.hidePane(false);
        app.refreshInfoPanel();
    },

    hidePane(hide) {
        for (const id of ['info-extra', 'info-list', 'info-foot', 'info-edit']) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (hide) { el.dataset.metaHidden = el.hidden ? '1' : ''; el.hidden = true; }
            else if ('metaHidden' in el.dataset) { el.hidden = el.dataset.metaHidden === '1'; delete el.dataset.metaHidden; }
        }
    },

    // Info is about to show something else: what was typed is saved first
    // (as Preview does), then it reads as before. True while that happens
    leave() {
        if (!this.isOpen()) return null;
        if (!this.dirty.size) { this.close(); return null; }
        return this.done();
    },

    // Info refreshed (another photo, the selection changed): true when
    // it's still these photos and the form stays
    keeps(files) {
        if (!this.isOpen()) return false;
        const same = files && files.length === this.files.length && files.every(f => this.files.includes(f));
        if (same) return true;
        this.leave();
        return true;
    }
};

if (typeof window !== 'undefined') window.MetaEditor = MetaEditor;
