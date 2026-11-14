// Export: one window for taking photos off this computer (the project
// card's Export, ⋯ on the selection bar, a folder's right-click menu).
//
//   USB drive or card  the whole project copied onto one, as it is on
//                      disk (its flags and edits too only if asked: a
//                      .jeditor folder in the copy), and the drive ejected
//                      after if you like (the apps: places.js's copyToDrive)
//   CD or DVD          the whole project burnt onto a disc, ejected after
//                      if you like (the Windows app: disc.js)
//   Save into the      edits not saved yet written into their photos (the
//   photos             Save button opens the window here: Edits.saveAll)
//   Copies             copies of the photos (all, the selected ones, the
//                      starred or the edited), as set in sections that
//                      open and close (where, file naming, format, size,
//                      metadata, colour, after), edits in them, into a
//                      folder named after the project ("Summer 2024
//                      export"), in it, on a USB drive or in a folder
//                      chosen (app.exportCopies); the settings can be
//                      saved as a preset of your own
//
// Each says what goes and whether it fits before anything starts, and
// follows drives and discs as they're put in.

const Export = {
    KEY: 'jeditor.export', // the last choices: { tab, size, where }
    // As they are, or another format (AVIF and JPEG XL where the codecs load: codec.js)
    FORMATS: [['same', 'As they are'], ['jpeg', 'JPEG'], ['png', 'PNG (lossless)'], ['tiff', 'TIFF (lossless, for print)'], ['webp', 'WebP'], ['avif', 'AVIF (smallest)'], ['jxl', 'JPEG XL']],
    SIZES: [[0, 'Full size'], [4000, '4000 px'], [3000, '3000 px'], [2048, '2048 px (for the web)'], [1600, '1600 px'], [1080, '1080 px (social media)']],
    TABS: [['save', 'Save into the photos'], ['copies', 'Copies'], ['usb', 'USB drive or card'], ['disc', 'CD or DVD']],

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
            const act = b.dataset.act;
            if (act === 'burners') this.loadBurners();
            // (its menu stays open: a click anywhere else closes menus)
            else if (act === 'pill') { e.stopPropagation(); this.pillMenu(b); }
            else if (act === 'sec') this.toggleSec(b.dataset.sec);
            else if (act === 'token') this.addToken(b.dataset.token);
            else if (act === 'save-preset') this.savePreset();
            else if (act === 'drop-preset') this.dropPreset();
            else if (act === 'preview') { this.preview = !this.preview; this.remember({ preview: this.preview }); this.render(); }
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
        return this.TABS.filter(([t]) => t === 'save' ? !!this.app.dirHandle && this.toSave().length > 0
            : t === 'copies' ? !!this.app.dirHandle
            : t === 'usb' ? !!path && Host.has('places')
            : !!path && Host.has('burn'));
    },

    // { path, files, tab, drive, where }: the project (its path, in an app),
    // the photos chosen (Copies starts with them), the tab, a drive (or a
    // disc's drive) to pick, where Copies go ('drive:' + a drive's path)
    async open({ path = Host.has('places') ? Places.current() : null, files = null, tab = null, drive = null, where = null, save = null } = {}) {
        const app = this.app;
        if (!app.dirHandle && !path) {
            app.showToast('Open a project first', 3000);
            return;
        }
        this.settle(false); // (one left open by a Save: not saved)
        this.path = path || null;
        this.files = files && files.length ? files.filter(Boolean) : null;
        this.saveList = save && save.length ? save.filter(Boolean) : null;
        this.open_ = new Set();
        const saved = this.saved();
        // (from Save: copies would be of the edited photos)
        this.which = this.files ? 'selected' : this.saveList ? 'edited' : 'all';
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
        // (Save into the photos is only opened on when asked for: the Save button)
        const usual = tabs.filter(t => t !== 'save');
        this.tab = tabs.includes(tab) ? tab : this.files && tabs.includes('copies') ? 'copies' : usual.includes(saved.tab) ? saved.tab
            : usual.includes('usb') ? 'usb' : usual[0] || tabs[0]; // (a project on disk: onto a drive, as before)
        this.el('export-panel').classList.remove('hidden');
        this.render();
        this.el('ex-go').focus();
        if (Host.has('places') && !Places.drives) Places.refresh().then(() => this.render()).catch(() => { });
        if (tabs.includes('disc')) this.loadBurners();
    },

    close() {
        this.el('export-panel').classList.add('hidden');
        this.el('export-panel').classList.remove('ex-wide');
        this.files = null;
        this.settle(false);
    },

    show(tab) {
        this.tab = tab;
        if (tab !== 'save') this.remember({ tab });
        this.render();
    },

    // ---- Save into the photos ----
    //
    // Edits.saveAll opens the window here and waits: true once the edits
    // are in the photos or copies of them are made, false when it's closed

    save(list) {
        this.open({ tab: 'save', save: list });
        if (!this.isOpen()) return Promise.resolve(false);
        return new Promise(resolve => { this._saved = resolve; });
    },

    settle(ok) {
        const done = this._saved;
        this._saved = null;
        if (done) done(ok);
    },

    // The photos Save would write: the ones asked for, else every edited one
    toSave() {
        return (this.saveList || Edits.edited()).filter(f => f && f._edit);
    },

    saveBody() {
        const list = this.toSave(), n = list.length;
        const never = list.filter(f => Raw.is(f.name) || Codec.isHeif(f.name)).length;
        const into = n - never;
        let html = `<p class="ex-lead">${into ? `${into.toLocaleString()} photo${into === 1 ? ' changes' : 's change'}. jEditor keeps the original${into === 1 ? '' : 's'}, so ${Host.say('Ctrl+Z')} puts ${into === 1 ? 'it' : 'them'} back.` : ''}` +
            `${never ? `${into ? ' ' : ''}${never.toLocaleString()} RAW or HEIC photo${never === 1 ? ' is' : 's are'} never written: a JPEG copy of ${never === 1 ? 'it' : 'each'} goes into "jEditor Export".` : ''}</p>`;
        html += '<p class="ex-lead ex-quiet">To keep the photos as they are and make edited copies, choose Copies.</p>';
        return {
            html, ready: n > 0,
            go: `Save into ${n.toLocaleString()} photo${n === 1 ? '' : 's'}`,
            note: `<span class="ex-sum"><b>${n.toLocaleString()} photo${n === 1 ? '' : 's'}</b> in ${this.esc(this.name() || 'this project')} ${n === 1 ? 'is' : 'are'} written with ${n === 1 ? 'its' : 'their'} edits.</span>`
        };
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
        if (this.which === 'edited') return files.filter(f => f._edit);
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
        const r = this.tab === 'save' ? this.saveBody() : this.tab === 'usb' ? this.usbBody() : this.tab === 'disc' ? this.discBody() : this.copiesBody();
        const n = this.tab === 'save' ? this.toSave().length : 0;
        this.el('ex-title').textContent = this.tab === 'save' ? `Save ${n === 1 ? 'the edit' : `${n.toLocaleString()} edits`}`
            : `Export ${this.files ? `${this.files.length.toLocaleString()} photo${this.files.length === 1 ? '' : 's'}` : this.name()}`;
        const scroll = body.scrollTop;
        body.innerHTML = r.html;
        body.scrollTop = scroll;
        // (wider with the preview beside the sections)
        this.el('export-panel').classList.toggle('ex-wide', this.tab === 'copies' && !!this.preview);
        this.ready = r.ready;
        const go = this.el('ex-go');
        go.textContent = r.go;
        go.disabled = !r.ready;
        // (Save's and Copies' summary has the folder's name in bold: built here, escaped)
        if (this.tab === 'save' || this.tab === 'copies') this.el('ex-note').innerHTML = r.note || '';
        else this.el('ex-note').textContent = r.note || '';
        if (keep) {
            const again = body.querySelector(`[name="${keep}"]:checked, #${CSS.escape(keep)}`);
            if (again && again.type !== 'radio') again.focus();
        }
        if (this.tab === 'copies' && this.preview) this.drawPreview();
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
    // Sections that open and close, each saying what it's set to while
    // it's closed, so the whole export can be read without opening one:
    // Photos, Where, File naming, Format, Size, Metadata, Colour, After
    // export. No presets come with it; the settings as they stand can be
    // saved as one of your own, and picked again. A preview of the first
    // photo can be shown beside them (off to start with). The line by the
    // buttons says how many photos, about how big, and where they go.

    // What the built-in presets set, before there were only your own: the
    // one last used is carried over as the settings (loadCopies)
    OLD_PRESETS: {
        full: { format: 'same', quality: 92, size: 0, meta: 'all', colour: 'keep' },
        email: { format: 'jpeg', quality: 80, size: 2048, meta: 'nogps', colour: 'srgb' },
        web: { format: 'jpeg', quality: 90, size: 3000, meta: 'nogps', colour: 'srgb' },
        social: { format: 'jpeg', quality: 85, size: 1080, meta: 'nogps', colour: 'srgb' },
        print: { format: 'jpeg', quality: 95, size: 0, meta: 'all', colour: 'keep' },
        archive: { format: 'tiff', quality: 92, size: 0, meta: 'all', colour: 'keep' }
    },
    QUALITIES: [100, 95, 90, 85, 80, 70, 60],
    METAS: [['all', 'All of it'], ['nogps', 'All but the location'], ['none', 'None']],
    COLOURS: [['keep', 'As it is (its own colour profile)'], ['srgb', 'sRGB, for screens and the web']],
    CLASHES: [['both', 'Keep both'], ['replace', 'Replace it'], ['skip', 'Skip the photo']],
    // The pieces a name is made of (script.js exportName fills them in)
    TOKENS: [['name', 'Name'], ['project', 'Project'], ['date', 'Date'], ['n', 'Number']],
    SECS: [['which', 'Photos'], ['where', 'Where'], ['naming', 'File naming'], ['format', 'Format'], ['size', 'Size'], ['meta', 'Metadata'], ['colour', 'Colour'], ['after', 'After export']],
    // The settings a preset keeps
    SET: ['format', 'quality', 'size', 'meta', 'colour', 'pattern', 'clash'],
    DEFAULTS: { format: 'same', quality: 92, size: 0, meta: 'all', colour: 'keep', pattern: '{name}', clash: 'both' },

    // Copies' settings, from what was saved (open)
    loadCopies(saved) {
        const old = this.OLD_PRESETS[saved.preset];
        this.custom = { ...this.DEFAULTS, ...(saved.custom || {}), ...(old || {}) };
        // (before presets: the size and format chosen)
        if (!saved.preset && !saved.custom && (saved.size || (saved.format && saved.format !== 'same'))) Object.assign(this.custom, { size: saved.size || 0, format: saved.format || 'same' });
        // (names were kept or numbered after the folder)
        if (saved.names === 'number' && !(saved.custom && saved.custom.pattern)) this.custom.pattern = '{project} {n}';
        this.presets = Array.isArray(saved.presets) ? saved.presets.filter(p => p && typeof p.name === 'string' && p.set) : [];
        this.preset = this.presets.some(p => p.name === saved.mine) ? saved.mine : null;
        for (const k of this.SET) this[k] = this.custom[k];
        if (this.codecs === false && Codec.of('x.' + this.format)) this.format = 'png';
        this.leaveOut = saved.leaveOut !== false;
        this.reveal = saved.reveal === true;
        this.preview = saved.preview === true; // off to start with
        this.folder = null; // named after the project (or the preset) until it's typed
    },

    // One of your presets picked: its settings
    applyPreset(name) {
        const p = this.presets.find(x => x.name === name);
        if (!p) return;
        for (const k of this.SET) this[k] = k in p.set ? p.set[k] : this.DEFAULTS[k];
        // (TIFF without the codecs: PNG, lossless too)
        if (this.codecs === false && Codec.of('x.' + this.format)) this.format = 'png';
        this.preset = name;
        for (const k of this.SET) this.custom[k] = this[k];
        this.remember({ mine: name, custom: this.custom, preset: null });
    },

    // A setting changed: remembered, and no longer a preset as it was saved
    setCopy(k, v) {
        this[k] = v;
        if (this.SET.includes(k)) {
            this.preset = null;
            for (const x of this.SET) this.custom[x] = this[x];
            this.remember({ mine: null, custom: this.custom, preset: null });
        }
    },

    // The settings as they stand, kept under a name of your own
    async savePreset() {
        const name = await UI.prompt({ title: 'Save as preset', message: 'These settings (format, size, metadata, colour and file naming) are kept under this name, to pick again.', input: { label: 'Name', placeholder: 'Client proofs', value: this.preset || '' }, ok: 'Save' });
        const n = typeof name === 'string' ? name.trim().slice(0, 40) : '';
        if (!n) return;
        const set = {};
        for (const k of this.SET) set[k] = this[k];
        this.presets = this.presets.filter(p => p.name.toLowerCase() !== n.toLowerCase()).concat([{ name: n, set }]);
        this.preset = n;
        this.remember({ presets: this.presets, mine: n });
        if (this.isOpen()) this.render();
    },

    dropPreset() {
        const n = this.preset;
        if (!n) return;
        this.presets = this.presets.filter(p => p.name !== n);
        this.preset = null;
        this.remember({ presets: this.presets, mine: null });
        this.render();
        this.app.showToast(`Removed the preset ${n}`, 3000);
    },

    folderName() {
        if (this.folder !== null) return this.folder;
        const name = this.name() || 'Photos';
        return this.preset ? `${name} – ${this.preset}` : `${name} export`;
    },

    lossy(v = this.format) { return ['jpeg', 'webp', 'avif', 'jxl'].includes(v); },

    whereLabel() {
        if (this.where === 'chosen' && this.chosen) return this.chosen.label.split(/[\\/]/).filter(Boolean).pop() || this.chosen.label;
        const d = this.where.startsWith('drive:') && this.usb().find(x => 'drive:' + x.path === this.where);
        return d ? d.name : 'In this project';
    },

    toggleSec(k) {
        if (this.open_.has(k)) this.open_.delete(k); else this.open_.add(k);
        this.render();
        const head = this.el('ex-body').querySelector(`[data-sec="${k}"]`);
        if (head) head.focus();
    },

    // A piece put at the end of the name
    addToken(t) {
        const p = this.pattern || '';
        this.setCopy('pattern', (p && !/[\s\-_]$/.test(p) ? p + ' ' : p) + `{${t}}`);
        this.render();
    },

    // What a photo will be called (as script.js exportName makes it; the
    // extension is its own unless the format changes it)
    exampleName(f, i, total) {
        const app = this.app;
        const ext = this.format === 'same' ? (Raw.is(f.name) || Codec.isHeif(f.name) ? '.jpg' : (f.name.match(/\.[^.]+$/) || [''])[0]) : '.' + Codec.ext(this.format);
        const own = f.name.replace(/\.[^.]+$/, '') + ext;
        return app.exportName(this.pattern, { own, i, total, project: this.name(), date: f.lastModified || Date.now() });
    },

    patternProblem() {
        const p = (this.pattern || '').trim();
        if (!p) return 'Give the copies a name: add a piece, such as Name.';
        if (/[\\/:*?"<>|\u0000-\u001f]/.test(p.replace(/\{(name|project|date|n)\}/g, ''))) return 'A file name can\'t contain \\ / : * ? " < > |';
        return '';
    },

    // What each section is set to, said in a few words (shown while it's closed)
    says(k, { n, starred, edited }) {
        const files = this.app.files;
        if (k === 'which') return this.which === 'selected' ? `${n.toLocaleString()} selected` : this.which === 'star' ? `The ${starred.toLocaleString()} starred`
            : this.which === 'edited' ? `The ${edited.toLocaleString()} edited` : `All ${files.length.toLocaleString()}`;
        if (k === 'where') return `${this.folderName()}, ${this.where === 'project' ? 'in this project' : this.where === 'chosen' ? `in ${this.whereLabel()}` : `on ${this.whereLabel()}`}`;
        if (k === 'naming') {
            const first = this.copies()[0];
            const eg = first && !this.patternProblem() ? this.exampleName(first, 0, n) : '';
            return (this.pattern === '{name}' ? 'Their own names' : 'Renamed') + (eg ? ` · ${eg}` : '');
        }
        if (k === 'format') {
            const f = this.FORMATS.find(([x]) => x === this.format);
            const label = (f ? f[1] : this.format).replace(/ \(.*\)$/, '');
            return this.format === 'same' ? 'As they are' : this.lossy() ? `${label}, ${this.quality}%` : `${label}, lossless`;
        }
        if (k === 'size') return this.size ? `${this.size.toLocaleString()} px on the long side, never enlarged` : 'Full size';
        if (k === 'meta') return this.meta === 'all' ? 'All of it' : this.meta === 'nogps' ? 'All but the location' : 'None';
        if (k === 'colour') return this.colour === 'srgb' ? 'sRGB, for screens' : 'As it is';
        if (k === 'after') {
            const a = [];
            if (this.reveal && this.canReveal()) a.push(Host.say('Show the folder in {files}'));
            if (this.where.startsWith('drive:') && this.eject) a.push('Eject the drive');
            return a.join(', ') || 'Nothing';
        }
        return '';
    },

    // The folder can be shown after: an app that can, and a place it knows the path of
    canReveal() {
        return Host.has('reveal') && Host.has('places');
    },

    secBody(k, { formats, starred, edited }) {
        const sel = (id, label, opts, v) => `<label class="ex-row"><span>${label}</span><select id="${id}" class="field">` +
            opts.map(([x, l]) => `<option value="${x}"${String(x) === String(v) ? ' selected' : ''}>${this.esc(l)}</option>`).join('') + '</select></label>';
        const pill = (key, label, title) => `<button type="button" class="btn secondary ex-pill" data-act="pill" data-pill="${key}" aria-haspopup="menu" title="${title}">${this.esc(label)}<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`;
        if (k === 'which') {
            const files = this.app.files;
            const opt = (v, label) => `<label class="ex-opt"><input type="radio" name="ex-which" value="${v}"${this.which === v ? ' checked' : ''}> ${this.esc(label)}</label>`;
            return '<div class="ex-opts">' + (this.files ? opt('selected', `The ${this.files.length === 1 ? 'photo' : `${this.files.length.toLocaleString()} photos`} selected`) : '') +
                opt('all', `All ${files.length.toLocaleString()} in the project`) + (starred ? opt('star', `The ${starred.toLocaleString()} starred`) : '') +
                (edited ? opt('edited', `The ${edited.toLocaleString()} with edits not saved yet`) : '') + '</div>';
        }
        if (k === 'where') {
            return `<div class="ex-row"><span>Put them</span>${pill('where', this.whereLabel(), 'Where, and whether the project lists them')}</div>` +
                `<label class="ex-row"><span>Folder</span><input id="ex-folder" class="field" type="text" spellcheck="false" maxlength="200" value="${this.esc(this.folderName())}"></label>` +
                sel('ex-clash', 'If a name\'s there', this.CLASHES, this.clash);
        }
        if (k === 'naming') {
            const list = this.copies();
            const eg = list.slice(0, 2).map((f, i) => `<code>${this.esc(this.exampleName(f, i, list.length))}</code>`).join(', ');
            return `<input id="ex-pattern" class="field" type="text" spellcheck="false" maxlength="120" value="${this.esc(this.pattern)}" aria-label="File name, in pieces">` +
                '<div class="ex-tokens">' + this.TOKENS.map(([t, l]) => `<button type="button" class="btn secondary sm" data-act="token" data-token="${t}" title="Add {${t}} to the name">+ ${l}</button>`).join('') + '</div>' +
                `<p class="ex-eg">${this.patternProblem() ? this.esc(this.patternProblem()) : `For example ${eg}${list.length > 2 ? ' …' : ''}`}</p>`;
        }
        if (k === 'format') return sel('ex-format', 'Format', formats, this.format) + (this.lossy() ? sel('ex-quality', 'Quality', this.QUALITIES.map(q => [q, `${q}%`]), this.quality) : '');
        if (k === 'size') {
            const sizes = this.SIZES.some(([v]) => v === this.size) ? this.SIZES : this.SIZES.concat([[this.size, `${this.size.toLocaleString()} px`]]);
            return sel('ex-size', 'Longest side', sizes.concat([['other', 'Other…']]), this.size) + '<p class="ex-eg">A photo smaller than this is left at its own size.</p>';
        }
        if (k === 'meta') return sel('ex-meta', 'Keep', this.METAS, this.meta);
        if (k === 'colour') return sel('ex-colour', 'Colour', this.COLOURS, this.colour);
        if (k === 'after') {
            return (this.canReveal() ? `<label class="ex-check"><input type="checkbox" id="ex-reveal"${this.reveal ? ' checked' : ''}> ${Host.say('Show the folder in {files}')}</label>` : '') +
                (this.where.startsWith('drive:') ? this.ejectBox() : '') +
                (!this.canReveal() && !this.where.startsWith('drive:') ? '<p class="ex-eg">Nothing to do after here: a drive can be ejected, and the apps can show the folder.</p>' : '');
        }
        return '';
    },

    copiesBody() {
        const files = this.app.files;
        const starred = files.filter(f => Flags.has(f, 'star')).length;
        const edited = files.filter(f => f._edit).length;
        if (this.which === 'star' && !starred) this.which = 'all';
        if (this.which === 'edited' && !edited) this.which = 'all';
        const formats = this.FORMATS.filter(([v]) => this.codecs !== false || !Codec.of('x.' + v));
        if (!formats.some(([v]) => v === this.format)) this.format = this.codecs === false && Codec.of('x.' + this.format) ? 'png' : 'same';
        const drives = this.usb();
        if (this.where.startsWith('drive:') && !drives.some(d => 'drive:' + d.path === this.where)) this.where = 'project';
        if (this.where === 'chosen' && !this.chosen) this.where = 'project';
        const list = this.copies();
        const n = list.length;
        const ctx = { n, starred, edited, formats };
        const chev = '<svg class="i sm ex-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
        // Your presets (none: only the way to save one), and the preview's switch
        let html = '<div class="ex-top">';
        if (this.presets.length) {
            html += '<div class="ex-presets" role="radiogroup" aria-label="Your presets">' +
                this.presets.map(p => `<label title="Use these settings"><input type="radio" name="ex-preset" value="${this.esc(p.name)}"${p.name === this.preset ? ' checked' : ''}><span>${this.esc(p.name)}</span></label>`).join('') + '</div>';
        }
        html += `<button type="button" class="btn ghost sm" data-act="save-preset" title="Keep these settings under a name, to pick again">Save as preset…</button>` +
            (this.preset ? `<button type="button" class="btn ghost sm" data-act="drop-preset" title="Remove the preset ${this.esc(this.preset)}">Remove preset</button>` : '') +
            `<button type="button" class="btn ghost sm ex-prev-btn" data-act="preview" aria-pressed="${!!this.preview}" title="A preview of the first photo beside the settings">${this.preview ? 'Hide preview' : 'Show preview'}</button></div>`;
        html += '<div class="ex-cols"><div class="ex-secs">';
        for (const [k, label] of this.SECS) {
            const open = this.open_.has(k);
            html += `<div class="ex-sec${open ? ' open' : ''}"><button type="button" class="ex-sec-head" data-act="sec" data-sec="${k}" aria-expanded="${open}">${chev}<b>${label}</b><em>${open ? '' : this.esc(this.says(k, ctx))}</em></button>` +
                (open ? `<div class="ex-sec-body">${this.secBody(k, ctx)}</div>` : '') + '</div>';
        }
        html += '</div>';
        if (this.preview) {
            html += '<div class="ex-prev"><div class="ex-prev-pic"><img id="ex-prev-img" alt=""></div><div id="ex-prev-name" class="ex-prev-name"></div><small id="ex-prev-size"></small></div>';
        }
        html += '</div>';
        // How many, about how big, and where: the line by the buttons
        const bytes = this.format === 'same' && !this.size ? list.reduce((t, f) => t + (f.size || 0), 0) : 0;
        const into = this.where === 'project' ? ' in this project' : this.where === 'chosen' ? ` in ${this.esc(this.whereLabel())}` : ` on ${this.esc(this.whereLabel())}`;
        const problem = this.folderProblem() || this.patternProblem();
        const edits = list.filter(f => f._edit).length;
        const raws = list.filter(f => Raw.is(f.name)).length;
        const notes = [];
        if (edits) notes.push(`${edits.toLocaleString()} with edits not saved yet: exported with them`);
        if (raws && (this.format === 'same' || this.format === 'jpeg')) notes.push(`${raws.toLocaleString()} RAW as JPEG`);
        this.copiesNote = `<span class="ex-sum"><b>${n.toLocaleString()} photo${n === 1 ? '' : 's'}</b>${bytes ? `, about ${this.fmt(bytes)}` : ''}, into <b class="ex-sum-folder">${this.esc(this.folderName())}</b>${into}.</span> ` +
            this.esc((notes.length ? notes.join(' · ') + '. ' : '') + 'The originals aren\'t changed.');
        return {
            html, ready: n > 0 && !problem,
            go: `Export ${n.toLocaleString()} cop${n === 1 ? 'y' : 'ies'}`,
            note: problem ? this.esc(problem) : this.copiesNote
        };
    },

    // The preview: the first photo, what it'll be called and how big
    drawPreview() {
        const list = this.copies(), f = list[0];
        const img = this.el('ex-prev-img');
        if (!img) return;
        if (!f) { img.removeAttribute('src'); this.el('ex-prev-name').textContent = 'No photos'; this.el('ex-prev-size').textContent = ''; return; }
        if (f.thumbnailUrl) img.src = f.thumbnailUrl; else img.removeAttribute('src');
        this.el('ex-prev-name').textContent = this.patternProblem() ? f.name : this.exampleName(f, 0, list.length);
        const d = f._dims;
        let size = '';
        if (d && d.w && d.h) {
            const k = this.size ? Math.min(1, this.size / Math.max(d.w, d.h)) : 1;
            size = `${Math.round(d.w * k).toLocaleString()} × ${Math.round(d.h * k).toLocaleString()} px`;
        }
        this.el('ex-prev-size').textContent = [size, list.length > 1 ? `1 of ${list.length.toLocaleString()}` : ''].filter(Boolean).join(' · ');
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
        let items = [];
        if (k === 'where') {
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
        else if (t.id === 'ex-reveal') { this.reveal = t.checked; this.remember({ reveal: t.checked }); return; }
        else if (t.name === 'ex-preset') this.applyPreset(t.value);
        else if (t.name === 'ex-which') this.which = t.value;
        else if (t.id === 'ex-clash') this.setCopy('clash', t.value);
        else if (t.id === 'ex-folder' || t.id === 'ex-pattern') {
            if (t.id === 'ex-folder') this.folder = t.value;
            else this.setCopy('pattern', t.value);
            // Only the line by the buttons and the example change: the field keeps its caret
            const problem = this.folderProblem() || this.patternProblem();
            this.copiesBody(); // (the line again, with the name as typed)
            this.ready = this.copies().length > 0 && !problem;
            this.el('ex-go').disabled = !this.ready;
            this.el('ex-note').innerHTML = problem ? this.esc(problem) : this.copiesNote;
            if (t.id === 'ex-pattern') {
                const list = this.copies(), eg = this.el('ex-body').querySelector('.ex-eg');
                if (eg) eg.innerHTML = this.patternProblem() ? this.esc(this.patternProblem())
                    : 'For example ' + list.slice(0, 2).map((f, i) => `<code>${this.esc(this.exampleName(f, i, list.length))}</code>`).join(', ') + (list.length > 2 ? ' …' : '');
                if (this.preview) this.drawPreview();
            }
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
        if (this.tab === 'save') {
            const list = this.toSave(), done = this._saved;
            this._saved = null;
            this.close();
            const ok = await app.saveEdits(list);
            if (done) done(ok);
        } else if (this.tab === 'usb') {
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
            const eject = this.eject, done = this._saved;
            const opts = { maxEdge: this.size || 0, dir, where, format: this.format, quality: this.quality, meta: this.meta, colour: this.colour,
                pattern: this.pattern, project: this.name(), clash: this.clash };
            // Shown after, where the app knows the folder's path
            const show = this.reveal && this.canReveal() ? await this.native().folderPath(dir).catch(() => null) : null;
            this._saved = null;
            this.close();
            const r = await app.exportCopies(list, opts);
            if (done) done(!!(r && r.done));
            // Onto a drive, ejected after if asked (not when some failed: it's left to look at)
            if (drive && eject && r && r.done && !r.failed) await Places.eject(drive.path, drive.name);
            else if (show && r && r.done) this.native().reveal(show);
        }
    }
};
