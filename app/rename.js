// Batch rename: new names with a sequence, or find & replace on the
// existing names, numbered in a chosen order (current sort, date taken…).
//
// Patterns can use:
//   {###}  sequence number, zero-padded to the number of #s (1 → 001)
//   {name} the current name (without extension)
//   {date} date taken, YYYY-MM-DD (file date when there's no EXIF)
//   {time} time taken, HH-MM-SS
// The extension is always kept. Names are checked before anything is
// touched: invalid characters, duplicates within the batch and clashes
// with other files in the folder (case-insensitively, as on Windows and
// macOS) block the rename. The renaming itself is done by app.renameMany,
// which handles overlapping names safely and is undone in one step.

const Renamer = {
    isOpen: false,
    PREVIEW_ROWS: 300,
    TOKEN: /\{(#+|name|date|time)\}/g,
    INVALID: /[\\/:*?"<>|\u0000-\u001f]/,
    RESERVED: /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i,

    el(id) { return document.getElementById(id); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        const refresh = () => this.schedule();
        ['rename-pattern', 'rename-find', 'rename-replace', 'rename-start', 'rename-step']
            .forEach(id => this.el(id).addEventListener('input', refresh));
        ['rename-case', 'rename-order', 'rename-dir'].forEach(id => this.el(id).addEventListener('change', refresh));
        document.querySelectorAll('input[name="rename-scope"]').forEach(r => r.addEventListener('change', refresh));
        document.querySelectorAll('.rename-mode button').forEach(b => b.addEventListener('click', () => {
            this.mode = b.dataset.mode;
            this.syncMode();
            this.schedule();
        }));
        document.querySelectorAll('.rename-token').forEach(b => b.addEventListener('click', () => {
            const input = this.mode === 'replace' ? this.el('rename-replace') : this.el('rename-pattern');
            const at = input.selectionStart ?? input.value.length;
            input.value = input.value.slice(0, at) + b.dataset.token + input.value.slice(input.selectionEnd ?? at);
            input.focus();
            input.setSelectionRange(at + b.dataset.token.length, at + b.dataset.token.length);
            this.schedule();
        }));
        this.el('rename-cancel').addEventListener('click', () => this.close());
        this.el('rename-close').addEventListener('click', () => this.close());
        this.el('rename-apply').addEventListener('click', () => this.apply());
        const panel = this.el('rename-panel');
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.close(); });
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); this.close(); }
            if (e.key === 'Enter' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') {
                e.preventDefault();
                this.apply();
            }
        });
    },

    // selected: the photos the user picked (may be empty → whole folder)
    open(app, selected = []) {
        this.init(app);
        this.selected = selected.filter(Boolean);
        // "All" is what the grid shows: one folder's photos when a folder is open
        const all = app.viewFiles().length;
        const sel = this.selected.length;
        this.el('rename-scope-selected').disabled = sel === 0;
        this.el('rename-scope-selected-label').textContent = sel === 1
            ? `This photo (${this.selected[0].name})` : `Selected photos (${sel})`;
        this.el('rename-scope-all-label').textContent = Folders.scope !== null && app.dirHandle
            ? `All photos in ${Folders.nameOf(Folders.scope)} (${all.toLocaleString()})`
            : `All photos${Folders.hasSubfolders() ? ', in every folder' : ' in the folder'} (${all.toLocaleString()})`;
        this.el(sel ? 'rename-scope-selected' : 'rename-scope-all').checked = true;

        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('jeditor.rename') || '{}'); } catch (e) { /* defaults */ }
        this.mode = saved.mode === 'replace' ? 'replace' : 'new';
        // One photo: start from its current name, the common "fix a name" case
        this.el('rename-pattern').value = sel === 1 && this.mode === 'new'
            ? this.selected[0].name.replace(/\.[^.]+$/, '') : (saved.pattern || 'photo_{###}');
        this.el('rename-find').value = saved.find || '';
        this.el('rename-replace').value = saved.replace || '';
        this.el('rename-case').checked = !!saved.matchCase;
        this.el('rename-start').value = saved.start ?? 1;
        this.el('rename-step').value = saved.step ?? 1;
        this.el('rename-order').value = saved.order || 'current';
        this.el('rename-dir').value = saved.dir || 'asc';
        this.syncMode();
        this.isOpen = true;
        this.el('rename-panel').classList.remove('hidden');
        const focus = this.mode === 'replace' ? this.el('rename-find') : this.el('rename-pattern');
        focus.focus();
        focus.select();
        this.refresh();
    },

    close() {
        this.isOpen = false;
        clearTimeout(this._timer);
        this.el('rename-panel').classList.add('hidden');
    },

    syncMode() {
        document.querySelectorAll('.rename-mode button').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === this.mode));
        this.el('rename-new-fields').classList.toggle('hidden', this.mode !== 'new');
        this.el('rename-replace-fields').classList.toggle('hidden', this.mode !== 'replace');
    },

    options() {
        const num = (id, d) => { const v = parseInt(this.el(id).value, 10); return Number.isFinite(v) ? v : d; };
        return {
            mode: this.mode,
            pattern: this.el('rename-pattern').value,
            find: this.el('rename-find').value,
            replace: this.el('rename-replace').value,
            matchCase: this.el('rename-case').checked,
            start: num('rename-start', 1),
            step: num('rename-step', 1) || 1,
            order: this.el('rename-order').value,
            dir: this.el('rename-dir').value
        };
    },

    scope() {
        const sel = this.el('rename-scope-selected').checked && this.selected.length;
        return sel ? [...this.selected] : [...this.app.viewFiles()];
    },

    schedule() {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.refresh(), 120);
    },

    // ---- naming ----

    needsDates(o) {
        const text = o.mode === 'new' ? o.pattern : o.replace;
        return o.order === 'taken' || /\{(date|time)\}/.test(text);
    },

    // Files in numbering order
    ordered(files, o) {
        const app = this.app;
        const pos = new Map(app.files.map((f, i) => [f, i]));
        const key = {
            current: (f) => pos.get(f),
            taken: (f) => f.dateTaken ?? f.lastModified ?? 0,
            modified: (f) => f.lastModified || 0,
            size: (f) => f.size || 0
        }[o.order];
        const out = [...files];
        if (o.order === 'name') {
            out.sort((a, b) => app.NAME_ORDER.compare(a.name, b.name));
        } else {
            out.sort((a, b) => key(a) - key(b) || pos.get(a) - pos.get(b));
        }
        if (o.dir === 'desc') out.reverse();
        return out;
    },

    fill(template, file, n) {
        const base = file.name.replace(/\.[^.]+$/, '');
        const when = new Date(file.dateTaken ?? file.lastModified ?? 0);
        const p2 = (v) => String(v).padStart(2, '0');
        return template.replace(this.TOKEN, (m, t) => {
            if (t[0] === '#') return String(n).padStart(t.length, '0');
            if (t === 'name') return base;
            if (t === 'date') return `${when.getFullYear()}-${p2(when.getMonth() + 1)}-${p2(when.getDate())}`;
            if (t === 'time') return `${p2(when.getHours())}-${p2(when.getMinutes())}-${p2(when.getSeconds())}`;
            return m;
        });
    },

    // [{ file, oldName, newName, error }] in numbering order
    plan(files, o) {
        const rows = this.ordered(files, o).map((file, i) => {
            const n = o.start + i * o.step;
            const ext = (file.name.match(/\.[^.]+$/) || [''])[0];
            const base = file.name.slice(0, file.name.length - ext.length);
            let next;
            if (o.mode === 'new') {
                next = this.fill(o.pattern, file, n);
            } else if (!o.find) {
                next = base;
            } else {
                const esc = o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                next = base.replace(new RegExp(esc, o.matchCase ? 'g' : 'gi'), () => this.fill(o.replace, file, n));
            }
            next = next.trim();
            return { file, oldName: file.name, newName: next + ext, base: next };
        });
        this.validate(rows);
        return rows;
    },

    dirOf(file) {
        const rel = file.relPath || file.name;
        return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    },

    validate(rows) {
        const app = this.app;
        const inBatch = new Set(rows.map(r => r.file));
        // Names the batch can't take: other photos in the same folder
        const taken = new Set(app.files.filter(f => !inBatch.has(f))
            .map(f => this.dirOf(f) + '/' + f.name.toLowerCase()));
        const seen = new Map();
        for (const r of rows) {
            const key = this.dirOf(r.file) + '/' + r.newName.toLowerCase();
            if (!r.base) r.error = 'Empty name';
            else if (this.INVALID.test(r.base)) r.error = 'Contains \\ / : * ? " < > |';
            else if (this.RESERVED.test(r.base)) r.error = 'Reserved name on Windows';
            else if (/[. ]$/.test(r.base)) r.error = 'Ends with a dot or space';
            else if (r.newName.length > 200) r.error = 'Too long';
            else if (taken.has(key)) r.error = 'Another file already has this name';
            else if (seen.has(key)) {
                r.error = 'Same name as another photo in this batch';
                const first = seen.get(key);
                if (!first.error) first.error = r.error;
            }
            if (!seen.has(key)) seen.set(key, r);
        }
    },

    // ---- preview ----

    async refresh() {
        if (!this.isOpen) return;
        const o = this.options();
        const files = this.scope();
        const token = (this._token = (this._token || 0) + 1);
        if (this.needsDates(o) && files.some(f => f.dateTaken === undefined)) {
            this.renderMessage('Reading capture dates…');
            await this.app.ensureDatesTaken();
            if (token !== this._token || !this.isOpen) return;
        }
        this.rows = this.plan(files, o);
        this.render(o);
    },

    renderMessage(text) {
        const list = this.el('rename-preview');
        list.innerHTML = '';
        const p = document.createElement('div');
        p.className = 'rename-note';
        p.textContent = text;
        list.appendChild(p);
        this.el('rename-apply').disabled = true;
    },

    render(o) {
        const rows = this.rows;
        const errors = rows.filter(r => r.error);
        const changing = rows.filter(r => !r.error && r.newName !== r.oldName);
        const list = this.el('rename-preview');
        list.innerHTML = '';

        const summary = this.el('rename-summary');
        if (errors.length) {
            const dupes = errors.filter(r => /Same name/.test(r.error)).length;
            summary.textContent = `${errors.length} problem${errors.length === 1 ? '' : 's'} to fix` +
                (dupes && o.mode === 'new' && !/\{#+\}/.test(o.pattern) ? ' — add {###} to number the photos' : '');
            summary.className = 'rename-summary bad';
        } else if (!changing.length) {
            summary.textContent = 'No names change yet';
            summary.className = 'rename-summary';
        } else {
            summary.textContent = `${changing.length.toLocaleString()} photo${changing.length === 1 ? '' : 's'} will be renamed` +
                (rows.length > changing.length ? ` · ${rows.length - changing.length} keep their name` : '');
            summary.className = 'rename-summary';
        }

        // Problems first, then the rest in numbering order
        const shown = [...errors, ...rows.filter(r => !r.error)].slice(0, this.PREVIEW_ROWS);
        const frag = document.createDocumentFragment();
        for (const r of shown) {
            const row = document.createElement('div');
            row.className = 'rename-row' + (r.error ? ' bad' : r.newName === r.oldName ? ' same' : '');
            const a = document.createElement('span');
            a.className = 'rename-old';
            a.textContent = r.oldName;
            const arrow = document.createElement('span');
            arrow.className = 'rename-arrow';
            arrow.textContent = '→';
            const b = document.createElement('span');
            b.className = 'rename-new';
            b.textContent = r.newName;
            row.append(a, arrow, b);
            if (r.error) {
                const e = document.createElement('span');
                e.className = 'rename-error';
                e.textContent = r.error;
                row.appendChild(e);
            }
            frag.appendChild(row);
        }
        list.appendChild(frag);
        if (rows.length > shown.length) {
            const more = document.createElement('div');
            more.className = 'rename-note';
            more.textContent = `…and ${(rows.length - shown.length).toLocaleString()} more`;
            list.appendChild(more);
        }

        const apply = this.el('rename-apply');
        apply.disabled = !!errors.length || !changing.length;
        apply.textContent = changing.length
            ? `Rename ${changing.length.toLocaleString()} photo${changing.length === 1 ? '' : 's'}` : 'Rename';
    },

    async apply() {
        if (!this.rows || this._applying) return;
        const o = this.options();
        // Re-plan against the latest state (another rename may have run)
        this.rows = this.plan(this.scope(), o);
        if (this.rows.some(r => r.error)) { this.render(o); return; }
        const pairs = this.rows.filter(r => r.newName !== r.oldName)
            .map(r => ({ file: r.file, newName: r.newName }));
        if (!pairs.length) return;
        try {
            localStorage.setItem('jeditor.rename', JSON.stringify({
                mode: o.mode, pattern: o.pattern, find: o.find, replace: o.replace,
                matchCase: o.matchCase, start: o.start, step: o.step, order: o.order, dir: o.dir
            }));
        } catch (e) { /* private mode */ }
        this._applying = true;
        this.el('rename-apply').disabled = true;
        try {
            const done = await this.app.renameMany(pairs);
            if (done) {
                this.close();
                this.app.showToast(`Renamed ${pairs.length.toLocaleString()} photo${pairs.length === 1 ? '' : 's'} — Ctrl+Z to undo`, 3000);
            } else {
                this.refresh();
            }
        } finally {
            this._applying = false;
        }
    }
};
