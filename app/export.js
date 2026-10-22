// Export: one window for taking photos off this computer (the project
// card's Export, ⋯ on the selection bar, a folder's right-click menu).
//
//   USB drive or card  the whole project copied onto one, its flags and
//                      edits with it, and the drive ejected after if you
//                      like (the apps: places.js's copyToDrive)
//   CD or DVD          the whole project burnt onto a disc (the Windows
//                      app: disc.js)
//   Copies             copies of the photos (all, the selected ones or the
//                      starred), full size or smaller, edits in them: into
//                      "jEditor Export" in the project, onto a USB drive,
//                      or into a folder chosen (app.exportCopies)
//
// Each says what goes and whether it fits before anything starts, and
// follows drives and discs as they're put in.

const Export = {
    KEY: 'jeditor.export', // the last choices: { tab, size, where }
    SIZES: [[0, 'Full size'], [4000, '4000 px'], [3000, '3000 px'], [2048, '2048 px (for the web)'], [1600, '1600 px'], [1080, '1080 px (social media)']],
    TABS: [['usb', 'USB drive or card'], ['disc', 'CD or DVD'], ['copies', 'Copies']],

    el(id) { return document.getElementById(id); },
    native() { return FolderCache.native(); },

    init(app) {
        this.app = app;
        const panel = this.el('export-panel');
        if (!panel) return;
        this.el('ex-close').addEventListener('click', () => this.close());
        this.el('ex-cancel').addEventListener('click', () => this.close());
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.close(); });
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !UI.isOpen()) { e.preventDefault(); this.close(); }
            e.stopPropagation();
        });
        this.el('ex-tabs').addEventListener('click', (e) => {
            const b = e.target.closest('[data-tab]');
            if (b) this.show(b.dataset.tab);
        });
        // Choices in the body: radios and fields, by name
        const body = this.el('ex-body');
        body.addEventListener('change', (e) => this.changed(e.target));
        body.addEventListener('input', (e) => { if (e.target.matches('input[type="text"], input[type="number"]')) this.changed(e.target); });
        body.addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]');
            if (!b) return;
            if (b.dataset.act === 'burners') this.loadBurners();
        });
        this.el('ex-go').addEventListener('click', () => this.go());
        // A drive plugged in or taken out while it's open
        addEventListener('jeditor-drives', () => { if (this.isOpen()) setTimeout(() => this.render(), 800); });
    },

    isOpen() {
        const p = this.el('export-panel');
        return !!p && !p.classList.contains('hidden');
    },

    saved() {
        try { return JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch (e) { return {}; }
    },

    remember(o) {
        try { localStorage.setItem(this.KEY, JSON.stringify({ ...this.saved(), ...o })); } catch (e) { /* private */ }
    },

    // The tabs this app has: a project on disk to copy or burn, and the
    // features for it
    tabs() {
        const path = this.path;
        return this.TABS.filter(([t]) => t === 'copies' ? !!this.app.dirHandle
            : t === 'usb' ? !!path && Host.has('places')
            : !!path && Host.has('burn'));
    },

    // { path, files, tab, drive }: the project (its path, in an app), the
    // photos chosen (Copies starts with them), the tab, a drive to pick
    async open({ path = Host.has('places') ? Places.current() : null, files = null, tab = null, drive = null } = {}) {
        const app = this.app;
        if (!app.dirHandle && !path) {
            app.showToast('Open a project first', 3000);
            return;
        }
        this.path = path || null;
        this.files = files && files.length ? files.filter(Boolean) : null;
        const saved = this.saved();
        this.which = this.files ? 'selected' : 'all';
        this.size = saved.size || 0;
        this.where = saved.where === 'project' || !saved.where ? 'project' : saved.where;
        this.chosen = null;
        this.drive = drive;
        this.eject = saved.eject !== false;
        this.saveFirst = true;
        this.label = Places.baseName(path || (app.dirHandle && app.dirHandle.name) || '').slice(0, 16);
        this.burnerList = null;
        const tabs = this.tabs().map(t => t[0]);
        if (!tabs.length) return;
        this.tab = tabs.includes(tab) ? tab : this.files ? 'copies' : tabs.includes(saved.tab) ? saved.tab : tabs[0];
        this.el('export-panel').classList.remove('hidden');
        this.el('ex-title').textContent = `Export ${this.files ? `${this.files.length.toLocaleString()} photo${this.files.length === 1 ? '' : 's'}` : this.name()}`;
        this.render();
        this.el('ex-go').focus();
        if (Host.has('places') && !Places.drives) Places.refresh().then(() => this.render()).catch(() => { });
        if (tabs.includes('disc')) this.loadBurners();
    },

    close() {
        this.el('export-panel').classList.add('hidden');
        this.files = null;
    },

    show(tab) {
        this.tab = tab;
        this.remember({ tab });
        this.render();
    },

    name() {
        return this.path ? Places.baseName(this.path) : (this.app.dirHandle ? this.app.dirHandle.name : '');
    },

    // The project's photos' size, when it's the one open (else not known)
    projectBytes() {
        if (this.path && Host.has('places') && Places.key(this.path) !== Places.key(Places.current())) return 0;
        return this.app.files.reduce((n, f) => n + (f.size || 0), 0);
    },

    usb() {
        return Host.has('places') ? Places.usbDrives(this.path) : [];
    },

    async loadBurners() {
        this.burnerList = 'loading';
        this.render();
        try {
            this.burnerList = await Disc.burners();
        } catch (e) {
            this.burnerList = { error: e.message };
        }
        if (this.isOpen()) this.render();
    },

    // The photos Copies would export
    copies() {
        const files = this.app.files;
        if (this.which === 'selected' && this.files) return this.files;
        if (this.which === 'star') return files.filter(f => Flags.has(f, 'star'));
        return files;
    },

    esc(t) {
        return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    },

    fmt(n) { return this.app.formatBytes(n); },

    // A drive or disc as a choice: its name, room left (a bar) and whether
    // what goes fits
    item(name, value, checked, { label = '', icon = '', sub = '', used = null, fits = null } = {}) {
        return `<label class="ex-item"><input type="radio" name="${name}" value="${this.esc(value)}"${checked ? ' checked' : ''}>` +
            `<span class="ex-icon">${icon}</span><span class="ex-name"><span>${this.esc(label)}</span><small>${this.esc(sub)}</small></span>` +
            (used !== null ? `<span class="ex-bar${used > 90 ? ' low' : ''}"><span style="width:${used}%"></span></span>` : '') +
            (fits === null ? '' : `<span class="ex-fit ${fits ? 'ok' : 'no'}">${fits ? 'Fits' : 'Not enough room'}</span>`) + '</label>';
    },

    render() {
        if (!this.isOpen()) return;
        const tabs = this.tabs();
        if (!tabs.some(t => t[0] === this.tab)) this.tab = tabs[0][0];
        this.el('ex-tabs').innerHTML = tabs.map(([t, label]) =>
            `<button data-tab="${t}" class="${t === this.tab ? 'active' : ''}" role="tab" aria-selected="${t === this.tab}">${label}</button>`).join('');
        this.el('ex-tabs').classList.toggle('hidden', tabs.length < 2);
        const body = this.el('ex-body');
        const keep = document.activeElement && body.contains(document.activeElement) ? document.activeElement.name || document.activeElement.id : null;
        const r = this.tab === 'usb' ? this.usbBody() : this.tab === 'disc' ? this.discBody() : this.copiesBody();
        body.innerHTML = r.html;
        this.ready = r.ready;
        const go = this.el('ex-go');
        go.textContent = r.go;
        go.disabled = !r.ready;
        this.el('ex-note').textContent = r.note || '';
        if (keep) {
            const again = body.querySelector(`[name="${keep}"]:checked, #${CSS.escape(keep)}`);
            if (again && again.type !== 'radio') again.focus();
        }
    },

    // ---- USB drive or card ----

    usbBody() {
        const drives = this.usb();
        const bytes = this.projectBytes();
        const need = bytes ? Math.ceil(bytes * 1.02) + 8 * 1024 * 1024 : 0;
        const n = this.app.files.length;
        if (drives.length && !drives.some(d => Places.key(d.path) === Places.key(this.drive || ''))) {
            // The one with the most room, to start with
            this.drive = drives.slice().sort((a, b) => (b.free || 0) - (a.free || 0))[0].path;
        }
        let html = `<p class="ex-lead">Copies ${this.esc(this.name())}${bytes ? ` (${n.toLocaleString()} photos, ${this.fmt(bytes)})` : ''} onto a USB drive or memory card, with its flags and edits, for opening in jEditor on another computer.</p>`;
        if (!drives.length) {
            html += '<div class="ex-empty">Plug in a USB drive or a memory card: it shows up here.</div>';
            return { html, ready: false, go: 'Copy' };
        }
        html += '<div class="ex-list" role="radiogroup" aria-label="Drive">';
        for (const d of drives) {
            const used = d.total ? Math.min(100, Math.max(0, Math.round((1 - d.free / d.total) * 100))) : null;
            const fits = need && d.free ? need <= d.free : null;
            html += this.item('ex-drive', d.path, Places.key(d.path) === Places.key(this.drive), {
                label: d.name, icon: Places.icons.usb, used, fits,
                sub: d.total ? `${this.fmt(d.free)} free of ${this.fmt(d.total)}` : ''
            });
        }
        html += '</div>';
        html += `<label class="ex-check"><input type="checkbox" id="ex-eject"${this.eject ? ' checked' : ''}> Eject it when it's done, ready to take out</label>`;
        const d = drives.find(x => Places.key(x.path) === Places.key(this.drive));
        const fits = !(need && d && d.free && need > d.free);
        return {
            html, ready: !!d && fits,
            go: d ? `Copy to ${d.name}` : 'Copy',
            note: d && !fits ? `${this.name()} needs ${this.fmt(need)}; ${d.name} has ${this.fmt(d.free)} free.` : ''
        };
    },

    // ---- CD or DVD ----

    discBody() {
        const bytes = this.projectBytes();
        const b = this.burnerList;
        let html = `<p class="ex-lead">Burns ${this.esc(this.name())}${bytes ? ` (${this.fmt(bytes)})` : ''} onto a blank CD or DVD, as the photos are on disk. The disc comes out when it's done.</p>`;
        const again = `<button type="button" class="btn ghost sm" data-act="burners">Look again</button>`;
        if (b === 'loading' || b === null) return { html: html + '<div class="ex-empty">Looking for a disc burner…</div>', ready: false, go: 'Burn' };
        if (b.error) return { html: html + `<div class="ex-empty">Couldn't look for a disc burner: ${this.esc(b.error)} ${again}</div>`, ready: false, go: 'Burn' };
        if (!b.length) return { html: html + `<div class="ex-empty">${this.esc(Host.say('{computer} has no drive that can burn CDs or DVDs.'))} Copy it to a USB drive instead.</div>`, ready: false, go: 'Burn' };
        if (!b.some(x => x.id === this.burner)) this.burner = (b.find(x => x.canWrite) || b[0]).id;
        html += '<div class="ex-list" role="radiogroup" aria-label="Burner">';
        for (const x of b) {
            const sub = x.canWrite ? `Blank ${x.media}, ${this.fmt(x.free)} free`
                : x.media === 'none' ? 'No disc: put in a blank CD or DVD' : `The ${x.media} in it isn't blank`;
            html += this.item('ex-burner', x.id, x.id === this.burner, {
                label: `${x.name}${x.drive ? ` (${x.drive})` : ''}`, icon: Places.icons.cd, sub,
                fits: x.canWrite && bytes ? bytes <= x.free : null
            });
        }
        html += `</div><div class="ex-row">${again}</div>`;
        html += `<label class="ex-field">The disc's name <input id="ex-label" class="field" type="text" maxlength="16" spellcheck="false" value="${this.esc(this.label)}"></label>`;
        const n = Edits.count();
        if (n) html += `<label class="ex-check"><input type="checkbox" id="ex-save-first"${this.saveFirst ? ' checked' : ''}> Save the edits into ${n.toLocaleString()} photo${n === 1 ? '' : 's'} first (else the disc gets them without)</label>`;
        const pick = b.find(x => x.id === this.burner);
        const fits = !(pick && pick.canWrite && bytes && bytes > pick.free);
        return {
            html, ready: !!pick && pick.canWrite && fits,
            go: pick && pick.canWrite ? `Burn to the ${pick.media}` : 'Burn',
            note: !pick || !pick.canWrite ? 'Put a blank disc in, then Look again.' : !fits ? `${this.name()} has ${this.fmt(bytes)} of photos, and the ${pick.media} holds ${this.fmt(pick.free)}. Use a DVD (or a dual-layer one), or a USB drive.` : ''
        };
    },

    // ---- Copies ----

    copiesBody() {
        const files = this.app.files;
        const starred = files.filter(f => Flags.has(f, 'star')).length;
        if (this.which === 'star' && !starred) this.which = 'all';
        const list = this.copies();
        const radio = (name, value, label, checked, sub = '') =>
            `<label class="ex-opt"><input type="radio" name="${name}" value="${this.esc(value)}"${checked ? ' checked' : ''}><span>${label}${sub ? `<small>${sub}</small>` : ''}</span></label>`;
        let html = '<div class="ex-field">Which photos<div class="ex-opts" role="radiogroup">';
        if (this.files) html += radio('ex-which', 'selected', `The ${this.files.length === 1 ? 'photo' : `${this.files.length.toLocaleString()} photos`} selected`, this.which === 'selected');
        html += radio('ex-which', 'all', `All ${files.length.toLocaleString()} in the project`, this.which === 'all');
        if (starred) html += radio('ex-which', 'star', `The ${starred.toLocaleString()} starred`, this.which === 'star');
        html += '</div></div>';
        const custom = !this.SIZES.some(([v]) => v === this.size);
        html += `<label class="ex-field">Size <span class="ex-row"><select id="ex-size" class="field">` +
            this.SIZES.map(([v, label]) => `<option value="${v}"${v === this.size && !custom ? ' selected' : ''}>${label}${v ? ' on the longest side' : ''}</option>`).join('') +
            `<option value="custom"${custom ? ' selected' : ''}>Other…</option></select>` +
            (custom ? `<input id="ex-size-px" class="field ex-px" type="number" min="100" step="1" value="${this.size || 2000}" aria-label="Longest side in pixels"> px` : '') + '</span></label>';
        // Where: the project's own export folder, a USB drive, or one chosen
        html += '<div class="ex-field">Where<div class="ex-opts" role="radiogroup">';
        html += radio('ex-where', 'project', '"jEditor Export", in this project', this.where === 'project');
        const drives = this.usb();
        if (!drives.some(d => 'drive:' + d.path === this.where) && this.where.startsWith('drive:')) this.where = 'project';
        for (const d of drives) html += radio('ex-where', 'drive:' + d.path, `${this.esc(d.name)}`, this.where === 'drive:' + d.path, `in "jEditor Export"${d.free ? ` · ${this.fmt(d.free)} free` : ''}`);
        const canChoose = Host.has('places') || typeof window.showDirectoryPicker === 'function';
        if (canChoose) html += radio('ex-where', 'chosen', this.chosen ? this.esc(this.chosen.label) : 'A folder you choose…', this.where === 'chosen' && !!this.chosen, this.chosen ? 'chosen' : '');
        if (this.where === 'chosen' && !this.chosen) this.where = 'project';
        html += '</div></div>';
        const n = list.length;
        const edited = list.filter(f => f._edit).length;
        const raws = list.filter(f => Raw.is(f.name)).length;
        const notes = [];
        if (edited) notes.push(`${edited.toLocaleString()} with edits not saved yet: exported with them`);
        if (raws) notes.push(`${raws.toLocaleString()} RAW as JPEG`);
        return {
            html, ready: n > 0,
            go: `Export ${n.toLocaleString()} cop${n === 1 ? 'y' : 'ies'}`,
            note: (notes.length ? notes.join(' · ') + '. ' : '') + 'The originals aren\'t changed.'
        };
    },

    // ---- Choices ----

    async changed(t) {
        if (t.name === 'ex-drive') this.drive = t.value;
        else if (t.name === 'ex-burner') this.burner = t.value;
        else if (t.id === 'ex-eject') { this.eject = t.checked; this.remember({ eject: t.checked }); return; }
        else if (t.id === 'ex-save-first') { this.saveFirst = t.checked; return; }
        else if (t.id === 'ex-label') { this.label = t.value; return; }
        else if (t.name === 'ex-which') this.which = t.value;
        else if (t.id === 'ex-size') {
            this.size = t.value === 'custom' ? (this.size || 2000) : +t.value;
            if (t.value === 'custom' && this.SIZES.some(([v]) => v === this.size)) this.size = 2000;
            this.remember({ size: this.size });
        } else if (t.id === 'ex-size-px') {
            this.size = Math.max(0, parseInt(t.value, 10) || 0);
            this.remember({ size: this.size });
            return;
        } else if (t.name === 'ex-where') {
            if (t.value === 'chosen') {
                const chosen = await this.chooseFolder();
                if (chosen) this.chosen = chosen;
                this.where = chosen || this.chosen ? 'chosen' : this.where;
            } else {
                this.where = t.value;
                this.remember({ where: t.value.startsWith('drive:') ? 'project' : t.value });
            }
        }
        this.render();
    },

    // A folder for Copies: Explorer's (Finder's) window in an app, the
    // browser's own picker in a browser → { handle, label }
    async chooseFolder() {
        try {
            if (Host.has('places')) {
                const path = await this.native().pickPath('Export the copies into', null);
                if (!path) return null;
                return { handle: await this.native().folderHandle(path), label: path };
            }
            const handle = await window.showDirectoryPicker({ id: 'jeditor-export', mode: 'readwrite' });
            return { handle, label: handle.name };
        } catch (e) {
            if (e && e.name !== 'AbortError') this.app.showToast(`Couldn't use that folder: ${e.message}`, 4000);
            return null;
        }
    },

    async go() {
        if (!this.ready) return;
        const app = this.app;
        if (this.tab === 'usb') {
            const drive = this.usb().find(d => Places.key(d.path) === Places.key(this.drive));
            const path = this.path;
            this.close();
            if (drive) await Places.copyToDrive(path, { drive, eject: this.eject });
        } else if (this.tab === 'disc') {
            const pick = Array.isArray(this.burnerList) && this.burnerList.find(x => x.id === this.burner);
            const path = this.path, label = this.label, saveEdits = this.saveFirst;
            this.close();
            if (pick) await Disc.burn(pick, path, label, { saveEdits });
        } else {
            const list = this.copies();
            const maxEdge = this.size || 0;
            let dir = null, where = '"jEditor Export"';
            try {
                if (this.where === 'chosen' && this.chosen) {
                    dir = this.chosen.handle;
                    where = this.chosen.label;
                } else if (this.where.startsWith('drive:')) {
                    const drive = this.usb().find(d => 'drive:' + d.path === this.where);
                    const root = await this.native().folderHandle(drive.path);
                    dir = await (await root.getDirectoryHandle('jEditor Export', { create: true })).getDirectoryHandle(this.name() || 'Photos', { create: true });
                    where = `${drive.name}, "jEditor Export"`;
                }
            } catch (e) {
                UI.alert({ title: 'Couldn\'t export there', message: e.message });
                return;
            }
            this.close();
            await app.exportCopies(list, { maxEdge, dir, where });
        }
    }
};
