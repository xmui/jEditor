// The first time a folder is opened, and each folder's first time.
//
// Once ever (the first Open a folder, or the first folder dragged in):
// one dialog with both first questions, remembered (jeditor.firstOpen:
// { asked, ask }):
//   - where your projects are kept (the apps with places; Settings →
//     Projects and the Open a folder card's foot change it later)
//   - Save edits when done, on or off (uiPrefs.deferNew; the ⚙ menu and
//     Settings change it later). It's for the folder being opened too.
//
// After that, a folder opened for the first time (one that hasn't chosen:
// edits.js, Edits.chosen) is asked whether it keeps its edits until saved,
// unless Settings → Projects → "Ask about saving edits when opening a
// folder" is off (ask: false): then it follows Save edits when done.
// A project made with New project chose in its name dialog (places.js), so
// it isn't asked.

const FirstOpen = {
    el(id) { return document.getElementById(id); },

    CHOICES: {
        off: ['Save straight away', 'Turns and crops are written into the photos as you go.'],
        on: ['Keep until I save', 'Edits wait in jEditor, and Save writes them into the photos when you\'re done.']
    },

    init(app) {
        this.app = app;
    },

    KEY: 'jeditor.firstOpen',
    get() {
        try { return JSON.parse(localStorage.getItem(this.KEY) || 'null') || {}; } catch (e) { return {}; }
    },
    set(change) {
        try { localStorage.setItem(this.KEY, JSON.stringify({ ...this.get(), ...change })); } catch (e) { /* private */ }
    },

    asked() { return !!this.get().asked; },

    // Before the first Open a folder: the dialog, then go on
    async before(go) {
        if (!this.asked()) {
            await this.welcome();
            this.next = true; // its answer is the next folder's too
        }
        go();
    },

    // The welcome dialog → resolves once it's answered (or closed)
    welcome({ folder = null } = {}) {
        const app = this.app;
        const places = Host.has('places') && typeof Places !== 'undefined';
        const box = document.createElement('div');
        box.id = 'first-open';
        box.className = 'dialog-overlay';
        const radio = (v) => `<label class="fo-choice"><input type="radio" name="fo-defer" value="${v}"${!!app.uiPrefs.deferNew === (v === 'on') ? ' checked' : ''}>` +
            `<span><span class="fo-choice-name">${this.CHOICES[v][0]}</span><small>${this.CHOICES[v][1]}</small></span></label>`;
        box.innerHTML =
            `<div class="dialog first-open" role="dialog" aria-modal="true" aria-labelledby="fo-title">` +
            `<div class="dialog-head"><h2 id="fo-title" class="dialog-title">${folder ? `Opening ${this.esc(folder)}` : 'Before you open a folder'}</h2></div>` +
            `<div class="dialog-body fo-body">` +
            (places ? `<section class="fo-part"><h3 class="fo-sub">Where your projects are</h3><p class="fo-help">${FolderMove.ADVICE}</p>` +
                `<div class="fo-row"><span id="fo-dir" class="fo-dir"></span><button id="fo-choose" class="btn secondary">Choose…</button></div></section>` : '') +
            `<section class="fo-part"><h3 class="fo-sub">When you edit a photo</h3>` +
            `<div class="fo-choices" role="radiogroup" aria-label="Save edits when done">${radio('off')}${radio('on')}</div></section>` +
            `<p class="fo-note">You can change both later in Settings → Projects${places ? ', and the folder from the foot of Open a folder' : ''}.</p>` +
            `</div>` +
            `<div class="dialog-foot"><span></span><span class="dialog-actions"><button id="fo-ok" class="btn primary">Continue</button></span></div>` +
            `</div>`;
        document.body.appendChild(box);
        const showDir = () => {
            const d = this.el('fo-dir');
            if (!d) return;
            const dir = Places.projectsDir();
            d.textContent = dir || 'Not chosen yet';
            d.classList.toggle('none', !dir);
            this.el('fo-choose').textContent = dir ? 'Change…' : 'Choose…';
        };
        if (places) {
            showDir();
            this.el('fo-choose').addEventListener('click', async () => { await FolderMove.changeProjects(); showDir(); });
        }
        return new Promise((resolve) => {
            const done = () => {
                const on = (box.querySelector('input[name="fo-defer"]:checked') || {}).value === 'on';
                box.remove();
                this.set({ asked: true });
                if (!!app.uiPrefs.deferNew !== on) Start.setDeferNew(on);
                resolve(on);
            };
            this.el('fo-ok').addEventListener('click', done);
            box.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
            });
            requestAnimationFrame(() => { const ok = this.el('fo-ok'); if (ok) ok.focus(); });
        });
    },

    esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
    },

    // New project: what its name dialog chose (places.js), for when it opens
    preset(name, on) {
        this._preset = { name, on: !!on };
    },

    // A folder has loaded (script.js): its first time?
    async afterLoad() {
        const app = this.app;
        const dir = app.dirHandle;
        if (!dir || app.readOnlyMode || app.library || typeof Edits === 'undefined') return;
        const preset = this._preset;
        this._preset = null;
        // Dragged in before anything was asked: the welcome, for this folder
        if (!this.asked()) {
            const on = await this.welcome({ folder: dir.name });
            if (app.dirHandle === dir) await this.keep(on);
            return;
        }
        if (Edits.chosen) { this.next = false; return; }
        if (preset && preset.name === dir.name) return this.keep(preset.on);
        if (this.next) { this.next = false; return this.keep(!!app.uiPrefs.deferNew); }
        if (this.get().ask === false) return;
        const how = await UI.choose({
            title: `Save edits to ${dir.name} when done?`,
            items: [`${this.CHOICES.on[0]}: ${this.CHOICES.on[1]}`, `${this.CHOICES.off[0]}: ${this.CHOICES.off[1]}`],
            note: 'Its card changes it later. Settings → Projects can stop this question.',
            ok: this.CHOICES.on[0],
            alt: this.CHOICES.off[0],
            cancel: 'Ask next time'
        });
        if (!how || app.dirHandle !== dir) return;
        await this.keep(how === 'ok');
    },

    // This project's choice, kept (edits.json) even when it's the default
    async keep(on) {
        Edits.chosen = true;
        if (on !== Edits.defer) await Edits.setDefer(on);
        else { Edits.saveSoon(); await Edits.flush(); }
    }
};
