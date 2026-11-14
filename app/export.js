// Export: one window for taking photos off this computer (the project
// card's Export, ⋯ on the selection bar, a folder's right-click menu).
//
//   USB drive or card  the whole project copied onto one, as it is on
//                      disk (its flags and edits too only if asked: a
//                      .jeditor folder in the copy), and the drive ejected
//                      after if you like (the apps: places.js's copyToDrive)
//   CD or DVD          the whole project burnt onto a disc, ejected after
//                      if you like (the Windows app: disc.js)
//   Copies             copies of the photos (all, the selected ones or the
//                      starred): full quality, for the web, for print or
//                      as set, edits in them, into a folder named after the
//                      project ("Summer 2024 export"), in it, on a USB
//                      drive or in a folder chosen (app.exportCopies); a
//                      drive ejected after if you like
//
// Each says what goes and whether it fits before anything starts, and
// follows drives and discs as they're put in.

const Export = {
    KEY: 'jeditor.export', // the last choices: { tab, size, where }
    // As they are, or another format (AVIF and JPEG XL where the codecs load: codec.js)
    FORMATS: [['same', 'As they are'], ['jpeg', 'JPEG'], ['png', 'PNG (lossless)'], ['tiff', 'TIFF (lossless, for print)'], ['webp', 'WebP'], ['avif', 'AVIF (smallest)'], ['jxl', 'JPEG XL']],
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
            // (its menu stays open: a click anywhere else closes menus)
            else if (b.dataset.act === 'pill') { e.stopPropagation(); this.pillMenu(b); }
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

    // { path, files, tab, drive, where }: the project (its path, in an app),
    // the photos chosen (Copies starts with them), the tab, a drive (or a
    // disc's drive) to pick, where Copies go ('drive:' + a drive's path)
    async open({ path = Host.has('places') ? Places.current() : null, files = null, tab = null, drive = null, where = null } = {}) {
        const app = this.app;
        if (!app.dirHandle && !path) {
            app.showToast('Open a project first', 3000);
            return;
        }
        this.path = path || null;
        this.files = files && files.length ? files.filter(Boolean) : null;
        const saved = this.saved();
        this.which = this.files ? 'selected' : 'all';
        this.loadCopies(saved);
        Codec.ready().then(ok => { this.codecs = ok; if (this.isOpen() && this.tab === 'copies') this.render(); });
        this.where = where || (saved.where === 'project' || !saved.where ? 'project' : saved.where);
        this.chosen = null;
        this.drive = drive;
        this.eject = saved.eject !== false;
        this.withData = saved.withData === true; // off to start with
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
        let html = `<p class="ex-lead">Copies ${this.esc(this.name())}${bytes ? ` (${n.toLocaleString()} photos, ${this.fmt(bytes)})` : ''} onto a USB drive or memory card, as it is on disk.</p>`;
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
        html += this.ejectBox();
        // Its flags and kept edits: on this computer only, unless asked for
        html += `<label class="ex-check"><input type="checkbox" id="ex-with-data"${this.withData ? ' checked' : ''}> Take its flags and edits too, for jEditor on another computer</label>`;
        const d = drives.find(x => Places.key(x.path) === Places.key(this.drive));
        const fits = !(need && d && d.free && need > d.free);
        const kept = Edits.count();
        return {
            html, ready: !!d && fits,
            go: d ? `Copy to ${d.name}` : 'Copy',
            note: d && !fits ? `${this.name()} needs ${this.fmt(need)}; ${d.name} has ${this.fmt(d.free)} free.`
                : kept && !this.withData ? `${kept.toLocaleString()} photo${kept === 1 ? ' has' : 's have'} edits not saved yet: copied without them.` : ''
        };
    },

    // Eject when done: one choice for a drive or a disc, remembered
    ejectBox() {
        return `<label class="ex-check"><input type="checkbox" id="ex-eject"${this.eject ? ' checked' : ''}> Eject when done</label>`;
    },

    // ---- CD or DVD ----

    discBody() {
        const bytes = this.projectBytes();
        const b = this.burnerList;
        let html = `<p class="ex-lead">Burns ${this.esc(this.name())}${bytes ? ` (${this.fmt(bytes)})` : ''} onto a blank CD or DVD, as the photos are on disk.</p>`;
        const again = `<button type="button" class="btn ghost sm" data-act="burners">Look again</button>`;
        if (b === 'loading' || b === null) return { html: html + '<div class="ex-empty">Looking for a disc burner…</div>', ready: false, go: 'Burn' };
        if (b.error) return { html: html + `<div class="ex-empty">Couldn't look for a disc burner: ${this.esc(b.error)} ${again}</div>`, ready: false, go: 'Burn' };
        if (!b.length) return { html: html + `<div class="ex-empty">${this.esc(Host.say('{computer} has no drive that can burn CDs or DVDs.'))} Copy it to a USB drive instead.</div>`, ready: false, go: 'Burn' };
        // The burner asked for (a disc's drive, right-clicked), or one with a blank disc
        const asked = this.drive && b.find(x => x.drive && Places.key(x.drive) === Places.key(this.drive));
        if (asked) { this.burner = asked.id; this.drive = null; }
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
        html += this.ejectBox();
        const pick = b.find(x => x.id === this.burner);
        const fits = !(pick && pick.canWrite && bytes && bytes > pick.free);
        return {
            html, ready: !!pick && pick.canWrite && fits,
            go: pick && pick.canWrite ? `Burn to the ${pick.media}` : 'Burn',
            note: !pick || !pick.canWrite ? 'Put a blank disc in, then Look again.' : !fits ? `${this.name()} has ${this.fmt(bytes)} of photos, and the ${pick.media} holds ${this.fmt(pick.free)}. Use a DVD (or a dual-layer one), or a USB drive.` : ''
        };
    },

    // ---- Copies ----
    //
    // A preset says what they're for, as a row of glass pills; what it sets
    // shows under it as chips (Custom: the fields instead). Then a sentence
    // of what will happen, a pill each for which, names and where (each opens
    // a small menu), and the folder, named after the preset.

    // [value, label, settings, what it's for, the folder's "– …"]
    PRESETS: [
        ['full', 'Full quality', { format: 'same', quality: 92, size: 0, meta: 'all', colour: 'keep' }, 'The photos as they are, at full size', 'full quality'],
        ['email', 'Email', { format: 'jpeg', quality: 80, size: 2048, meta: 'nogps', colour: 'srgb' }, 'Small, to email or send in a message', 'to email'],
        ['web', 'Web', { format: 'jpeg', quality: 90, size: 3000, meta: 'nogps', colour: 'srgb' }, 'Sharp on big screens, for a website or an online album', 'for the web'],
        ['social', 'Social', { format: 'jpeg', quality: 85, size: 1080, meta: 'nogps', colour: 'srgb' }, 'For phones and social media', 'for social'],
        ['print', 'Print', { format: 'jpeg', quality: 95, size: 0, meta: 'all', colour: 'keep' }, 'Full size, the best JPEG, with its colour profile and DPI, for a print shop', 'for print'],
        ['archive', 'Archive', { format: 'tiff', quality: 92, size: 0, meta: 'all', colour: 'keep' }, 'Lossless TIFF with all its metadata, to keep', 'archive'],
        ['custom', 'Custom', null, 'Choose each setting', 'export']
    ],
    PRESET_ICONS: {
        full: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
        email: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
        web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
        social: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
        print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
        archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
        custom: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'
    },
    QUALITIES: [100, 95, 90, 85, 80, 70, 60],
    METAS: [['all', 'All of it'], ['nogps', 'All but the location'], ['none', 'None']],
    COLOURS: [['keep', 'As it is (its own colour profile)'], ['srgb', 'sRGB, for screens and the web']],
    // The settings a preset sets
    SET: ['format', 'quality', 'size', 'meta', 'colour'],

    // Copies' settings, from what was saved (open)
    loadCopies(saved) {
        this.custom = { ...this.PRESETS[0][2], ...(saved.custom || {}) };
        // (before presets: the size and format chosen are Custom)
        if (!saved.preset && (saved.size || (saved.format && saved.format !== 'same'))) Object.assign(this.custom, { size: saved.size || 0, format: saved.format || 'same' });
        this.preset = this.PRESETS.some(([v]) => v === saved.preset) ? saved.preset : !saved.preset && (saved.size || (saved.format && saved.format !== 'same')) ? 'custom' : 'full';
        this.applyPreset(this.preset);
        this.names = saved.names === 'number' ? 'number' : 'keep';
        this.leaveOut = saved.leaveOut !== false;
        this.folder = null; // the preset's name until it's typed
    },

    applyPreset(p) {
        const set = (this.PRESETS.find(([v]) => v === p) || [])[2] || this.custom;
        for (const k of this.SET) this[k] = set[k];
        // (TIFF without the codecs: PNG, lossless too)
        if (this.codecs === false && Codec.of('x.' + this.format)) this.format = 'png';
        this.preset = p;
    },

    // A Custom field: remembered as Custom
    setCopy(k, v) {
        this[k] = v;
        if (this.SET.includes(k)) {
            this.preset = 'custom';
            for (const s of this.SET) this.custom[s] = this[s];
            this.remember({ preset: 'custom', custom: this.custom });
        }
    },

    folderName() {
        if (this.folder !== null) return this.folder;
        const name = this.name() || 'Photos';
        const p = this.PRESETS.find(([v]) => v === this.preset);
        return !p || p[0] === 'custom' ? `${name} export` : `${name} – ${p[4]}`;
    },

    lossy(v = this.format) { return ['jpeg', 'webp', 'avif', 'jxl'].includes(v); },

    // What the settings are, as chips under the preset
    chips() {
        const f = this.FORMATS.find(([x]) => x === this.format);
        const format = this.format === 'same' ? 'As they are' : this.format === 'tiff' ? 'TIFF, lossless'
            : this.format === 'png' ? 'PNG, lossless' : `${(f ? f[1] : this.format).replace(/ \(.*\)$/, '')} ${this.quality}%`;
        return [format, this.size ? `${this.size.toLocaleString()} px` : 'Full size',
            this.colour === 'srgb' ? 'sRGB' : 'Its own colour',
            this.meta === 'all' ? (this.preset === 'print' ? 'All metadata, DPI too' : 'All metadata') : this.meta === 'nogps' ? 'No location' : 'No metadata'];
    },

    whereLabel() {
        if (this.where === 'chosen' && this.chosen) return this.chosen.label.split(/[\\/]/).filter(Boolean).pop() || this.chosen.label;
        const d = this.where.startsWith('drive:') && this.usb().find(x => 'drive:' + x.path === this.where);
        return d ? d.name : 'In this project';
    },

    copiesBody() {
        const files = this.app.files;
        const starred = files.filter(f => Flags.has(f, 'star')).length;
        if (this.which === 'star' && !starred) this.which = 'all';
        const formats = this.FORMATS.filter(([v]) => this.codecs !== false || !Codec.of('x.' + v));
        if (!formats.some(([v]) => v === this.format)) this.format = this.codecs === false && Codec.of('x.' + this.format) ? 'png' : 'same';
        const drives = this.usb();
        if (this.where.startsWith('drive:') && !drives.some(d => 'drive:' + d.path === this.where)) this.where = 'project';
        if (this.where === 'chosen' && !this.chosen) this.where = 'project';
        const list = this.copies();
        const n = list.length;
        const icon = (d) => `<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
        let html = '<div class="ex-presets" role="radiogroup" aria-label="What they\'re for">' +
            this.PRESETS.map(([v, label, , title]) => `<label title="${this.esc(title)}"><input type="radio" name="ex-preset" value="${v}"${v === this.preset ? ' checked' : ''}><span>${icon(this.PRESET_ICONS[v])}${label}</span></label>`).join('') + '</div>';
        // What the preset sets (Custom: the fields)
        if (this.preset === 'custom') {
            const sel = (id, label, opts, v) => `<label class="ex-cf">${label}<select id="${id}" class="field">` +
                opts.map(([x, l]) => `<option value="${x}"${String(x) === String(v) ? ' selected' : ''}>${this.esc(l)}</option>`).join('') + '</select></label>';
            const sizes = this.SIZES.some(([v]) => v === this.size) ? this.SIZES : this.SIZES.concat([[this.size, `${this.size.toLocaleString()} px`]]);
            html += '<div class="ex-under ex-custom">' + sel('ex-format', 'Format', formats, this.format) +
                (this.lossy() ? sel('ex-quality', 'Quality', this.QUALITIES.map(q => [q, `${q}%`]), this.quality) : '') +
                sel('ex-size', 'Size (longest side)', sizes.concat([['other', 'Other…']]), this.size) +
                sel('ex-meta', 'Metadata', this.METAS, this.meta) + sel('ex-colour', 'Colour', this.COLOURS, this.colour) + '</div>';
        } else {
            html += '<div class="ex-under"><div class="ex-chips">' + this.chips().map(c => `<span class="ex-chip">${this.esc(c)}</span>`).join('') + '</div></div>';
        }
        // What happens, in a sentence
        const bytes = this.format === 'same' && !this.size ? list.reduce((t, f) => t + (f.size || 0), 0) : 0;
        const into = this.where === 'project' ? ' in this project' : this.where === 'chosen' ? ` in ${this.esc(this.whereLabel())}` : ` on ${this.esc(this.whereLabel())}`;
        html += `<p class="ex-lead ex-sum">${n.toLocaleString()} photo${n === 1 ? '' : 's'}${bytes ? `, about ${this.fmt(bytes)}` : ''}, into <b>${this.esc(this.folderName())}</b>${into}.</p>`;
        const which = this.which === 'selected' ? `${this.files.length.toLocaleString()} selected` : this.which === 'star' ? `${starred.toLocaleString()} starred` : `All ${files.length.toLocaleString()}`;
        const pill = (k, label, title) => `<button type="button" class="btn secondary ex-pill" data-act="pill" data-pill="${k}" aria-haspopup="menu" title="${title}">${this.esc(label)}<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`;
        html += '<div class="ex-pills">' + pill('which', which, 'Which photos') +
            pill('names', this.names === 'number' ? 'Numbered' : 'Keep names', 'Names') +
            pill('where', this.whereLabel(), 'Where, and whether the project lists them') + '</div>';
        html += `<label class="ex-field">Folder name <input id="ex-folder" class="field" type="text" spellcheck="false" maxlength="200" value="${this.esc(this.folderName())}"></label>`;
        if (this.where.startsWith('drive:')) html += this.ejectBox();
        const problem = this.folderProblem();
        const edited = list.filter(f => f._edit).length;
        const raws = list.filter(f => Raw.is(f.name)).length;
        const notes = [];
        if (edited) notes.push(`${edited.toLocaleString()} with edits not saved yet: exported with them`);
        if (raws && (this.format === 'same' || this.format === 'jpeg')) notes.push(`${raws.toLocaleString()} RAW as JPEG`);
        this.copiesNote = (notes.length ? notes.join(' · ') + '. ' : '') + 'The originals aren\'t changed.';
        return {
            html, ready: n > 0 && !problem,
            go: `Export ${n.toLocaleString()} cop${n === 1 ? 'y' : 'ies'}`,
            note: problem || this.copiesNote
        };
    },

    folderProblem() {
        const name = this.folderName().trim();
        if (!name) return 'Give the folder a name.';
        if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) || /^\.+$/.test(name)) return 'A folder name can\'t contain \\ / : * ? " < > |';
        if (name.toLowerCase() === FolderCache.DIR.toLowerCase()) return 'That name is jEditor\'s own.';
        return '';
    },

    // Copies' folders in a project, left out of it: not listed when it's
    // opened or rescanned, as "jEditor Export" never was. Kept per project
    // (its path in an app, its name in a browser), by name.
    LEFT_OUT: 'jeditor-export-left-out',
    projectKey() {
        const app = this.app;
        return (Host.has('places') && Places.current() ? Places.key(Places.current()) : app && app.dirHandle && app.dirHandle.name) || '';
    },
    leftOut() {
        try { return JSON.parse(localStorage.getItem(this.LEFT_OUT) || '{}') || {}; } catch (e) { return {}; }
    },
    setLeftOut(folder, on) {
        const all = this.leftOut(), k = this.projectKey(), name = folder.toLowerCase();
        const names = new Set(all[k] || []);
        if (on) names.add(name); else names.delete(name);
        if (names.size) all[k] = [...names]; else delete all[k];
        try { localStorage.setItem(this.LEFT_OUT, JSON.stringify(all)); } catch (e) { /* private */ }
        this._leftOut = null;
    },
    // (asked for each folder listed: from a copy, read once per project)
    isLeftOut(name) {
        if (!this.app) return false;
        const k = this.projectKey();
        if (!this._leftOut || this._leftOut.k !== k) this._leftOut = { k, names: new Set(this.leftOut()[k] || []) };
        return this._leftOut.names.size > 0 && this._leftOut.names.has(name.toLowerCase());
    },

    // A pill's menu, under it
    pillMenu(b) {
        const k = b.dataset.pill, app = this.app;
        const tick = (on, label) => (on ? '✓ ' : '') + label;
        const pick = (key, v) => () => { this.setCopy(key, v); this.render(); };
        let items = [];
        if (k === 'which') {
            const files = app.files, starred = files.filter(f => Flags.has(f, 'star')).length;
            if (this.files) items.push([tick(this.which === 'selected', `The ${this.files.length === 1 ? 'photo' : `${this.files.length.toLocaleString()} photos`} selected`), pick('which', 'selected')]);
            items.push([tick(this.which === 'all', `All ${files.length.toLocaleString()} in the project`), pick('which', 'all')]);
            if (starred) items.push([tick(this.which === 'star', `The ${starred.toLocaleString()} starred`), pick('which', 'star')]);
        } else if (k === 'names') {
            const base = this.folderName().trim() || 'Photo';
            items = [[tick(this.names === 'keep', 'Keep their names'), () => { this.names = 'keep'; this.remember({ names: 'keep' }); this.render(); }],
                [tick(this.names === 'number', `Numbered: ${base} 001, ${base} 002…`), () => { this.names = 'number'; this.remember({ names: 'number' }); this.render(); }]];
        } else if (k === 'where') {
            const where = (v) => () => { this.where = v; this.remember({ where: v.startsWith('drive:') ? 'project' : v }); this.render(); };
            items.push([tick(this.where === 'project', 'In this project'), where('project')]);
            for (const d of this.usb()) items.push([tick(this.where === 'drive:' + d.path, `${d.name}${d.free ? ` — ${this.fmt(d.free)} free` : ''}`), where('drive:' + d.path)]);
            if (Host.has('places') || typeof window.showDirectoryPicker === 'function') {
                if (this.chosen) items.push([tick(this.where === 'chosen', this.chosen.label), where('chosen')]);
                items.push(['A folder you choose…', async () => {
                    const chosen = await this.chooseFolder();
                    if (chosen) { this.chosen = chosen; this.where = 'chosen'; }
                    this.render();
                }]);
            }
            // Copies in the project: listed in it, or not (Rescan doesn't list them)
            if (this.where === 'project') {
                items.push(['—']);
                items.push([tick(this.leaveOut, 'Leave them out of the project (Rescan doesn\'t list them)'), () => { this.leaveOut = !this.leaveOut; this.remember({ leaveOut: this.leaveOut }); }]);
            }
        }
        const r = b.getBoundingClientRect();
        app.openContextMenu(items, r.left, r.bottom + 4);
    },

    // ---- Choices ----

    async changed(t) {
        if (t.name === 'ex-drive') this.drive = t.value;
        else if (t.name === 'ex-burner') this.burner = t.value;
        else if (t.id === 'ex-eject') { this.eject = t.checked; this.remember({ eject: t.checked }); return; }
        else if (t.id === 'ex-with-data') { this.withData = t.checked; this.remember({ withData: t.checked }); }
        else if (t.id === 'ex-save-first') { this.saveFirst = t.checked; return; }
        else if (t.id === 'ex-label') { this.label = t.value; return; }
        else if (t.name === 'ex-preset') { this.applyPreset(t.value); this.remember({ preset: t.value }); }
        else if (t.id === 'ex-folder') {
            this.folder = t.value;
            // Only the sentence and the note change: the field keeps its caret
            const sum = this.el('ex-body').querySelector('.ex-sum b');
            if (sum) sum.textContent = this.folderName();
            const problem = this.folderProblem();
            this.ready = this.copies().length > 0 && !problem;
            this.el('ex-go').disabled = !this.ready;
            this.el('ex-note').textContent = problem || this.copiesNote;
            return;
        }
        else if (t.id === 'ex-meta') this.setCopy('meta', t.value);
        else if (t.id === 'ex-colour') this.setCopy('colour', t.value);
        else if (t.id === 'ex-format') this.setCopy('format', t.value);
        else if (t.id === 'ex-quality') this.setCopy('quality', +t.value);
        else if (t.id === 'ex-size') {
            if (t.value !== 'other') this.setCopy('size', +t.value);
            else {
                const v = await UI.prompt({ title: 'Size', input: { label: 'Longest side in pixels', value: String(this.size || 2000), inputMode: 'numeric' }, ok: 'Use' });
                const px = parseInt(v, 10);
                if (px >= 16) this.setCopy('size', px);
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
            if (drive) await Places.copyToDrive(path, { drive, eject: this.eject, withData: this.withData });
        } else if (this.tab === 'disc') {
            const pick = Array.isArray(this.burnerList) && this.burnerList.find(x => x.id === this.burner);
            const path = this.path, label = this.label, saveEdits = this.saveFirst, eject = this.eject;
            this.close();
            if (pick) await Disc.burn(pick, path, label, { saveEdits, eject });
        } else {
            const list = this.copies();
            const folder = this.folderName().trim();
            let dir = null, where = `"${folder}"`, drive = null;
            try {
                let root;
                if (this.where === 'chosen' && this.chosen) {
                    root = this.chosen.handle;
                    where = `"${folder}" in ${this.chosen.label}`;
                } else if (this.where.startsWith('drive:')) {
                    drive = this.usb().find(d => 'drive:' + d.path === this.where);
                    root = await this.native().folderHandle(drive.path);
                    where = `${drive.name}, "${folder}"`;
                } else {
                    root = app.dirHandle;
                    // Left out of the project (Rescan doesn't list them), or not
                    Export.setLeftOut(folder, this.leaveOut);
                }
                dir = await root.getDirectoryHandle(folder, { create: true });
            } catch (e) {
                UI.alert({ title: 'Couldn\'t export there', message: e.message });
                return;
            }
            const eject = this.eject;
            const opts = { maxEdge: this.size || 0, dir, where, format: this.format, quality: this.quality, meta: this.meta, colour: this.colour, names: this.names === 'number' ? folder : null };
            this.close();
            const r = await app.exportCopies(list, opts);
            // Onto a drive, ejected after if asked (not when some failed: it's left to look at)
            if (drive && eject && r && r.done && !r.failed) await Places.eject(drive.path, drive.name);
        }
    }
};
