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
            // ⋯: the date tools, for scans with no date or a wrong one
            const box = document.createElement('div');
            box.className = 'meta-date';
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'btn secondary icon meta-date-more';
            more.id = 'meta-date-tools';
            more.textContent = '⋯';
            more.title = n > 1 ? 'Set one date for all, shift them, or number them in grid order' : 'Shift the date by an amount';
            more.setAttribute('aria-label', 'Date tools');
            more.addEventListener('click', (e) => {
                e.preventDefault();
                const r = more.getBoundingClientRect();
                const items = [];
                if (n > 1) items.push(['Set one date for all…', () => this.dateTools('set')]);
                items.push(['Shift by an amount…', () => this.dateTools('shift')]);
                if (n > 1) items.push(['Number in grid order…', () => this.dateTools('order')]);
                app.openContextMenu(items, r.right - 220, r.bottom + 6);
            });
            box.append(el, more);
            const row = field('taken', 'Taken', box);
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
        const right = document.createElement('span');
        right.className = 'meta-foot-right';
        right.append(cancel, done);
        // Every EXIF, IPTC and XMP field, for one photo
        if (n === 1) {
            const all = document.createElement('button');
            all.type = 'button';
            all.className = 'btn ghost';
            all.id = 'meta-all';
            all.textContent = 'All fields…';
            all.title = 'Every EXIF, IPTC and XMP field this photo has, to change, add or remove';
            all.addEventListener('click', () => this.allFields(files[0]));
            foot.appendChild(all);
        }
        foot.appendChild(right);
        form.appendChild(foot);
        // Presets: a set of fields kept to put on other photos
        const presets = document.createElement('button');
        presets.type = 'button';
        presets.className = 'btn secondary info-edit';
        presets.id = 'meta-presets';
        presets.textContent = 'Presets';
        presets.title = 'Fill in a saved author, copyright and keywords, or save these';
        presets.addEventListener('click', () => this.presetsMenu(presets));
        h3.after(presets);
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
        this._presetsBtn = presets;
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
            this.addWords(words);
        };
        this.addWords = (words) => {
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

    // ---- A dialog of its own (the date tools, All fields) ----

    dialogOpen() {
        return !!this._dialog;
    },

    // → { overlay, body, ok, note }; onOk returns true to close
    dialog({ id, title, okText, wide = false, onOk, onClose }) {
        const o = document.createElement('div');
        o.className = 'dialog-overlay meta-dialog';
        o.id = id;
        const card = document.createElement('div');
        card.className = 'dialog' + (wide ? ' meta-dialog-wide' : '');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        const head = document.createElement('div');
        head.className = 'dialog-head';
        const h = document.createElement('h2');
        h.className = 'dialog-title';
        h.id = `${id}-title`;
        h.textContent = title;
        card.setAttribute('aria-labelledby', h.id);
        const x = document.createElement('button');
        x.className = 'btn ghost icon';
        x.type = 'button';
        x.title = 'Close (Esc)';
        x.setAttribute('aria-label', 'Close');
        x.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
        head.append(h, x);
        const body = document.createElement('div');
        body.className = 'dialog-body';
        const foot = document.createElement('div');
        foot.className = 'dialog-foot';
        const note = document.createElement('span');
        note.className = 'dialog-note';
        note.setAttribute('aria-live', 'polite');
        const actions = document.createElement('span');
        actions.className = 'dialog-actions';
        const cancel = document.createElement('button');
        cancel.className = 'btn secondary';
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        const ok = document.createElement('button');
        ok.className = 'btn primary';
        ok.type = 'button';
        ok.id = `${id}-ok`;
        ok.textContent = okText;
        actions.append(cancel, ok);
        foot.append(note, actions);
        card.append(head, body, foot);
        o.appendChild(card);
        document.body.appendChild(o);
        const close = (saved) => {
            if (this._dialog !== o) return;
            this._dialog = null;
            o.remove();
            if (onClose) onClose(saved);
        };
        x.addEventListener('click', () => close(false));
        cancel.addEventListener('click', () => close(false));
        ok.addEventListener('click', async () => {
            ok.disabled = true;
            try { if (await onOk()) close(true); } finally { ok.disabled = false; }
        });
        o.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
            else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.target.closest('.meta-all-add')) { e.preventDefault(); ok.click(); }
        });
        this._dialog = o;
        return { overlay: o, body, ok, note, close };
    },

    // ---- The date tools (⋯ beside Taken) ----

    // 'YYYY-MM-DDTHH:MM:SS' ↔ a Date in local time (the photo's own clock)
    toDate(s) {
        const m = s && s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        const d = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        d.setFullYear(+m[1]); // years before 100 stay as they are
        return d;
    },

    fromDate(d) {
        const p = (n, w = 2) => String(n).padStart(w, '0');
        return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },

    showDate(s) {
        const d = this.toDate(s);
        return d ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'no date';
    },

    // The new date of each photo for these settings → [{ file, was, now }]
    datePlan(mode, files, s) {
        const was = (f) => (this._dateWas.get(f) || {}).taken || '';
        if (mode === 'set') return s.set ? files.map(f => ({ file: f, was: was(f), now: s.set })) : [];
        if (mode === 'shift') {
            return files.map(f => {
                const d = this.toDate(was(f));
                if (!d) return { file: f, was: '', now: '' }; // no date: nothing to shift
                d.setFullYear(d.getFullYear() + (s.years || 0));
                d.setDate(d.getDate() + (s.days || 0));
                d.setHours(d.getHours() + (s.hours || 0));
                d.setMinutes(d.getMinutes() + (s.minutes || 0));
                return { file: f, was: was(f), now: this.fromDate(d) };
            });
        }
        // In the order the grid shows them, from the start, a step apart
        const start = this.toDate(s.start);
        if (!start) return [];
        const inGrid = this.app.viewFiles().filter(f => files.includes(f));
        const rest = files.filter(f => !inGrid.includes(f));
        const unit = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[s.unit] || 60000;
        return [...inGrid, ...rest].map((f, i) => {
            const d = new Date(start.getTime());
            if (s.unit === 'days') d.setDate(d.getDate() + i * (s.step || 0));
            else d.setTime(d.getTime() + i * (s.step || 0) * unit);
            return { file: f, was: was(f), now: this.fromDate(d) };
        });
    },

    // mode: 'set', 'shift' or 'order'. What's typed in the form is saved first;
    // the form comes back after, with the new dates
    async dateTools(mode) {
        const files = this.files;
        if (!files) return;
        if (this.dirty.size) await this.done();
        else this.close();
        this._dateWas = new Map();
        for (const f of files) this._dateWas.set(f, await this.fields(f));
        const n = files.length;
        const d = this.dialog({
            id: 'meta-dates', title: n > 1 ? `Date taken for ${n.toLocaleString()} photos` : `Date taken for ${files[0].name}`, okText: 'Set dates',
            onOk: async () => {
                const plan = this.datePlan(mode, files, read()).filter(p => p.now && p.now !== p.was);
                if (!plan.length) return true;
                await this.save(plan.map(p => ({ file: p.file, changes: { taken: p.now } })));
                return true;
            },
            onClose: () => { this._dateWas = null; this.open(files); }
        });
        const body = d.body;
        body.classList.add('meta-dates');
        // Which tool
        const seg = document.createElement('div');
        seg.className = 'seg meta-dates-mode';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'How');
        const tools = [['set', 'Set one date'], ['shift', 'Shift'], ['order', 'In grid order']].filter(([m]) => n > 1 || m === 'shift' || m === 'set');
        for (const [m, label] of tools) {
            const b = document.createElement('button');
            b.type = 'button';
            b.dataset.mode = m;
            b.textContent = label;
            b.addEventListener('click', () => { mode = m; show(); });
            seg.appendChild(b);
        }
        const fields = document.createElement('div');
        fields.className = 'meta-dates-fields';
        const preview = document.createElement('div');
        preview.className = 'meta-dates-preview';
        preview.id = 'meta-dates-preview';
        body.append(seg, fields, preview);
        const first = files.map(f => this._dateWas.get(f).taken).find(Boolean) || '';
        const input = (id, label, attrs) => {
            const l = document.createElement('label');
            const s = document.createElement('span');
            s.textContent = label;
            const el = document.createElement(attrs.tag || 'input');
            el.className = 'field';
            el.id = id;
            for (const [k, v] of Object.entries(attrs)) if (k !== 'tag' && k !== 'options') el[k] = v;
            if (attrs.options) for (const [v, t] of attrs.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; el.appendChild(o); }
            if (attrs.value != null) el.value = attrs.value;
            el.addEventListener('input', () => draw());
            el.addEventListener('change', () => draw());
            l.append(s, el);
            return l;
        };
        const state = { set: first, years: 0, days: 0, hours: 0, minutes: 0, start: first || '', step: 1, unit: 'minutes' };
        const read = () => {
            const v = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
            const num = (id) => { const x = Number(v(id)); return isFinite(x) ? Math.trunc(x) : 0; };
            const dt = (x) => x ? (x.length === 16 ? x + ':00' : x.slice(0, 19)) : '';
            if (mode === 'set') state.set = dt(v('meta-dates-set'));
            if (mode === 'shift') Object.assign(state, { years: num('meta-dates-years'), days: num('meta-dates-days'), hours: num('meta-dates-hours'), minutes: num('meta-dates-minutes') });
            if (mode === 'order') Object.assign(state, { start: dt(v('meta-dates-start')), step: num('meta-dates-step'), unit: v('meta-dates-unit') });
            return state;
        };
        const draw = () => {
            const plan = this.datePlan(mode, files, read());
            preview.textContent = '';
            const shown = plan.slice(0, 6);
            for (const p of shown) {
                const row = document.createElement('div');
                row.className = 'meta-dates-row';
                const a = document.createElement('span');
                a.textContent = p.file.name;
                const b = document.createElement('span');
                b.className = 'meta-dates-change';
                b.textContent = !p.now ? 'no date: left as it is' : p.now === p.was ? `${this.showDate(p.now)}, as it is` : `${p.was ? this.showDate(p.was) : 'no date'} → ${this.showDate(p.now)}`;
                row.append(a, b);
                preview.appendChild(row);
            }
            if (plan.length > shown.length) {
                const more = document.createElement('div');
                more.className = 'meta-dates-more';
                more.textContent = `and ${(plan.length - shown.length).toLocaleString()} more`;
                preview.appendChild(more);
            }
            const changing = plan.filter(p => p.now && p.now !== p.was).length;
            d.ok.disabled = !changing;
            d.ok.textContent = changing > 1 ? `Set ${changing.toLocaleString()} dates` : 'Set date';
            const z = Host.say('Ctrl+Z');
            d.note.textContent = mode === 'order' ? `In the grid's order, kept apart so they sort that way. ${z} undoes ${changing > 1 ? 'all of them' : 'it'}.`
                : mode === 'shift' ? `For a camera whose clock was wrong. ${z} undoes ${changing > 1 ? 'all of them' : 'it'}.`
                    : `${z} undoes ${changing > 1 ? 'all of them' : 'it'}.`;
        };
        const show = () => {
            for (const b of seg.children) b.classList.toggle('active', b.dataset.mode === mode);
            fields.textContent = '';
            fields.className = `meta-dates-fields meta-dates-${mode}`;
            if (mode === 'set') fields.append(input('meta-dates-set', 'Date and time', { type: 'datetime-local', step: 1, value: state.set }));
            else if (mode === 'shift') {
                fields.append(
                    input('meta-dates-years', 'Years', { type: 'number', value: state.years, step: 1 }),
                    input('meta-dates-days', 'Days', { type: 'number', value: state.days, step: 1 }),
                    input('meta-dates-hours', 'Hours', { type: 'number', value: state.hours, step: 1 }),
                    input('meta-dates-minutes', 'Minutes', { type: 'number', value: state.minutes, step: 1 }));
            } else {
                fields.append(
                    input('meta-dates-start', 'Start', { type: 'datetime-local', step: 1, value: state.start }),
                    input('meta-dates-step', 'Then each one', { type: 'number', value: state.step, min: 0, step: 1 }),
                    input('meta-dates-unit', 'later by', { tag: 'select', options: [['seconds', 'seconds'], ['minutes', 'minutes'], ['hours', 'hours'], ['days', 'days']], value: state.unit }));
            }
            draw();
            const f = fields.querySelector('input');
            if (f) f.focus();
        };
        show();
    },

    // ---- All fields… (one photo) ----

    async allFields(file) {
        if (this.dirty && this.dirty.size) await this.done();
        else this.close();
        const sidecar = MetaFields.where(file.name) === 'sidecar';
        let bytes;
        try {
            bytes = new Uint8Array(await (await file.handle.getFile()).arrayBuffer());
        } catch (e) {
            this.app.showToast(`Couldn't read ${file.name}: ${e.message}`);
            return;
        }
        const side = await this.sidecarText(file);
        const list = await MetaFields.listAll(bytes, side, { readOnlyExif: sidecar });
        const edits = new Map(); // row key → { row, value } (value null: removed)
        const added = [];
        const d = this.dialog({
            id: 'meta-all-fields', title: `All fields · ${file.name}`, okText: 'Save', wide: true,
            onOk: async () => {
                const raw = { exif: { ifd0: {}, exif: {}, gps: {} }, iptc: {}, xmp: [] };
                const split = (ds) => [20, 25].includes(ds);
                for (const { row, value } of [...edits.values(), ...added]) {
                    if (row.group === 'EXIF') raw.exif[row.ifd][row.tag] = value == null ? null : { type: row.type, text: value, ucs2: row.ucs2 };
                    else if (row.group === 'IPTC') raw.iptc[row.ds] = value == null ? null : split(row.ds) ? value.split(';').map(x => x.trim()).filter(Boolean) : [value];
                    else raw.xmp.push({ uri: row.uri, name: row.name, kind: row.kind, value: value == null ? '' : value });
                }
                if (!edits.size && !added.length) return true;
                try {
                    // A wrong number is caught before anything's written
                    MetaFields.exifTags(null, { raw: { exif: raw.exif } });
                } catch (e) {
                    d.note.textContent = e.message;
                    return false;
                }
                await this.save([{ file, changes: { raw } }]);
                return true;
            },
            onClose: () => this.app.refreshInfoPanel()
        });
        const body = d.body;
        body.classList.add('meta-all');
        const top = document.createElement('div');
        top.className = 'meta-all-top';
        const find = document.createElement('input');
        find.type = 'search';
        find.className = 'field';
        find.id = 'meta-all-find';
        find.placeholder = 'Find a field';
        find.setAttribute('aria-label', 'Find a field');
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn secondary';
        addBtn.id = 'meta-all-add';
        addBtn.textContent = 'Add field';
        top.append(find, addBtn);
        const addRow = document.createElement('div');
        addRow.className = 'meta-all-add';
        addRow.hidden = true;
        const scroll = document.createElement('div');
        scroll.className = 'meta-all-list';
        scroll.id = 'meta-all-list';
        body.append(top, addRow, scroll);
        const rowEl = (row, value, fresh = false) => {
            const el = document.createElement('div');
            el.className = 'meta-all-row' + (row.editable ? '' : ' kept');
            el.dataset.key = row.key;
            const name = document.createElement('label');
            name.textContent = row.name;
            name.title = row.group === 'XMP' ? row.name : row.group === 'IPTC' ? `IPTC 2:${row.ds}` : `EXIF 0x${row.tag.toString(16).toUpperCase().padStart(4, '0')}`;
            const v = document.createElement('input');
            v.type = 'text';
            v.className = 'field';
            v.value = value;
            v.disabled = !row.editable;
            v.id = `meta-all-${row.key.replace(/[^\w-]/g, '_')}`;
            name.htmlFor = v.id;
            if (!row.editable) v.title = row.kept ? 'jEditor keeps this one right itself' : 'This one can\'t be typed in';
            v.addEventListener('input', () => {
                if (fresh) { fresh.value = v.value; return; }
                edits.set(row.key, { row, value: v.value });
            });
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'btn ghost icon meta-all-x';
            x.textContent = '−';
            x.title = `Remove ${row.name}`;
            x.setAttribute('aria-label', `Remove ${row.name}`);
            x.hidden = !row.editable;
            x.addEventListener('click', () => {
                if (fresh) added.splice(added.indexOf(fresh), 1);
                else edits.set(row.key, { row, value: null });
                el.remove();
            });
            el.append(name, v, x);
            return el;
        };
        const groups = [['EXIF', list.exif], ['IPTC', list.iptc], ['XMP', list.xmp]];
        for (const [g, rows] of groups) {
            if (!rows.length) continue;
            const h = document.createElement('div');
            h.className = 'meta-all-group';
            h.dataset.group = g;
            h.textContent = g + (g === 'EXIF' && sidecar ? ' (in the photo: shown, not changed)' : '');
            scroll.appendChild(h);
            for (const r of rows) scroll.appendChild(rowEl(r, r.value));
        }
        if (!list.exif.length && !list.iptc.length && !list.xmp.length) {
            const p = document.createElement('p');
            p.className = 'meta-all-empty';
            p.textContent = 'This photo has no metadata yet. Add field puts some in.';
            scroll.appendChild(p);
        }
        find.addEventListener('input', () => {
            const q = find.value.trim().toLowerCase();
            for (const el of scroll.querySelectorAll('.meta-all-row')) {
                const t = (el.querySelector('label').textContent + ' ' + el.querySelector('input').value + ' ' + el.querySelector('label').title).toLowerCase();
                el.hidden = !!q && !t.includes(q);
            }
        });
        // Add field: which kind, its name (suggested as you type), its value
        const kinds = sidecar ? [['XMP', 'XMP']] : [['XMP', 'XMP'], ['EXIF', 'EXIF']];
        const group = document.createElement('select');
        group.className = 'field';
        group.id = 'meta-all-add-group';
        group.setAttribute('aria-label', 'Kind');
        for (const [v, t] of kinds) { const o = document.createElement('option'); o.value = v; o.textContent = t; group.appendChild(o); }
        const nameIn = document.createElement('input');
        nameIn.className = 'field';
        nameIn.id = 'meta-all-add-name';
        nameIn.placeholder = 'Name';
        nameIn.setAttribute('aria-label', 'Field name');
        nameIn.setAttribute('list', 'meta-all-names');
        const names = document.createElement('datalist');
        names.id = 'meta-all-names';
        const valueIn = document.createElement('input');
        valueIn.className = 'field';
        valueIn.id = 'meta-all-add-value';
        valueIn.placeholder = 'Value';
        valueIn.setAttribute('aria-label', 'Value');
        const put = document.createElement('button');
        put.type = 'button';
        put.className = 'btn secondary';
        put.id = 'meta-all-add-ok';
        put.textContent = 'Add';
        addRow.append(group, nameIn, names, valueIn, put);
        const addable = () => {
            names.textContent = '';
            const opts = group.value === 'XMP' ? MetaFields.XMP_COMMON : this.exifAddable().map(x => x.name);
            for (const n of opts) { const o = document.createElement('option'); o.value = n; names.appendChild(o); }
            nameIn.placeholder = group.value === 'XMP' ? 'prefix:Name, as photoshop:City' : 'Name, as Lens model';
        };
        group.addEventListener('change', addable);
        addBtn.addEventListener('click', () => { addRow.hidden = false; addable(); nameIn.focus(); });
        const doAdd = () => {
            const name = nameIn.value.trim(), value = valueIn.value;
            let row = null;
            if (group.value === 'XMP') {
                const m = name.match(/^(\w+):(\w+)$/);
                const uri = m && MetaFields.XMP_PREFIXES[m[1]];
                if (!uri) { d.note.textContent = `An XMP name is prefix:Name, with one of these prefixes: ${Object.keys(MetaFields.XMP_PREFIXES).join(', ')}`; return; }
                row = { key: `xmp:${name}`, group: 'XMP', uri, name, kind: MetaFields.xmpKind(name), editable: true };
            } else {
                const x = this.exifAddable().find(e => e.name.toLowerCase() === name.toLowerCase());
                if (!x) { d.note.textContent = 'Pick an EXIF field from the list'; return; }
                row = { key: `exif:${x.ifd}:${x.tag}`, group: 'EXIF', ifd: x.ifd, tag: x.tag, type: x.ucs2 ? 1 : 2, ucs2: x.ucs2, name: x.name, editable: true };
            }
            if (!value.trim()) { d.note.textContent = 'Type a value for it'; valueIn.focus(); return; }
            const had = scroll.querySelector(`.meta-all-row[data-key="${CSS.escape(row.key)}"]`);
            if (had) { had.querySelector('input').value = value; had.querySelector('input').dispatchEvent(new Event('input')); }
            else {
                const fresh = { row, value };
                added.push(fresh);
                let h = scroll.querySelector(`.meta-all-group[data-group="${row.group}"]`);
                if (!h) { h = document.createElement('div'); h.className = 'meta-all-group'; h.dataset.group = row.group; h.textContent = row.group; scroll.prepend(h); }
                h.after(rowEl(row, value, fresh));
            }
            d.note.textContent = '';
            nameIn.value = valueIn.value = '';
            nameIn.focus();
        };
        put.addEventListener('click', doAdd);
        addRow.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
        const z = Host.say('Ctrl+Z');
        d.note.textContent = sidecar ? `Saved in ${MetaFields.sidecarName(file.name)}, beside it. ${z} undoes it.` : `Saved into the photo. Gray ones jEditor keeps right itself. ${z} undoes it.`;
        find.focus();
    },

    // EXIF text fields that can be added
    exifAddable() {
        const out = [];
        const text = { ifd0: [0x010E, 0x010F, 0x0110, 0x0131, 0x013B, 0x013C, 0x8298], exif: [0x9003, 0x9004, 0x9010, 0xA420, 0xA430, 0xA431, 0xA433, 0xA434, 0xA435] };
        for (const [ifd, tags] of Object.entries(text)) for (const tag of tags) out.push({ ifd, tag, name: MetaFields.EXIF_NAMES[ifd][tag] });
        for (const tag of [0x9C9B, 0x9C9C, 0x9C9D, 0x9C9E, 0x9C9F]) out.push({ ifd: 'ifd0', tag, ucs2: true, name: MetaFields.EXIF_NAMES.ifd0[tag] });
        return out;
    },

    // ---- Presets: an author, copyright and keywords kept to put on others ----

    PRESETS_KEY: 'jeditor.metaPresets',

    presets() {
        try {
            const p = JSON.parse(localStorage.getItem(this.PRESETS_KEY) || '[]');
            return Array.isArray(p) ? p.filter(x => x && typeof x.name === 'string') : [];
        } catch (e) {
            return [];
        }
    },

    savePresets(list) {
        try { localStorage.setItem(this.PRESETS_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
    },

    presetsMenu(btn) {
        const list = this.presets();
        const items = [];
        if (list.length) {
            items.push(['Fill in', null]);
            for (const p of list) items.push([p.name, () => this.applyPreset(p)]);
            items.push(['—']);
        }
        items.push(['Save these as a preset…', () => this.savePreset()]);
        if (list.length) items.push(['Delete a preset', list.map(p => [p.name, () => this.savePresets(this.presets().filter(x => x.name !== p.name))])]);
        const r = btn.getBoundingClientRect();
        this.app.openContextMenu(items, r.right - 230, r.bottom + 6);
    },

    // What's in the form for a preset: the author, the copyright and the
    // keywords every photo will have
    formPreset() {
        const v = (id) => (document.getElementById(id) || {}).value || '';
        const n = this.files.length;
        const words = [...document.querySelectorAll('#meta-keywords .meta-chip')].map(c => c.dataset.word).filter(w => this.kwCount(w) === n);
        return { author: v('meta-author').trim(), copyright: v('meta-copyright').trim(), keywords: words };
    },

    async savePreset() {
        const p = this.formPreset();
        if (!p.author && !p.copyright && !p.keywords.length) {
            this.app.showToast('Type an author, a copyright or keywords first: a preset keeps those');
            return;
        }
        const name = await UI.prompt({
            title: 'Save as preset',
            message: `Keeps ${[p.author && 'the author', p.copyright && 'the copyright', p.keywords.length && `${p.keywords.length} keyword${p.keywords.length === 1 ? '' : 's'}`].filter(Boolean).join(', ')}, to fill in on other photos from Presets.`,
            input: { label: 'Name', placeholder: 'Kowalski family scans', value: p.author || '' },
            ok: 'Save'
        });
        if (!name || !name.trim()) return;
        const list = this.presets().filter(x => x.name !== name.trim());
        list.push({ name: name.trim(), ...p });
        list.sort((a, b) => a.name.localeCompare(b.name));
        this.savePresets(list);
        this.app.showToast(`Saved the preset ${name.trim()}`, 1800);
    },

    // Filled in on the form; Done saves it on the photos
    applyPreset(p) {
        if (!this.isOpen()) return;
        const set = (k, v) => {
            if (!v) return;
            const el = document.getElementById(`meta-${k}`);
            el.value = v;
            el.classList.remove('meta-mixed');
            this.dirty.add(k);
        };
        set('author', p.author);
        set('copyright', p.copyright);
        if (p.keywords && p.keywords.length) this.addWords(p.keywords);
        this.app.showToast(`Filled in ${p.name}: Done saves it`, 2000);
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
        if (this._presetsBtn) this._presetsBtn.remove();
        this._presetsBtn = null;
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
