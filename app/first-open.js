// The first time a folder is opened: in the apps with places, one dialog,
// asked once ever (jeditor.firstOpen: { asked }), for where your projects
// are kept (Settings → Projects and the Open a folder card's foot change
// it later). Edits are kept in jEditor (edits.js; Settings → Saving
// turns it off), so there's nothing to ask about saving.

const FirstOpen = {
    el(id) { return document.getElementById(id); },

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
        if (!this.asked() && this.places()) await this.welcome();
        go();
    },

    places() {
        return Host.has('places') && typeof Places !== 'undefined';
    },

    // The welcome dialog → resolves once it's answered (or closed)
    welcome({ folder = null } = {}) {
        const places = this.places();
        const box = document.createElement('div');
        box.id = 'first-open';
        box.className = 'dialog-overlay focus-quiet'; // (ui.js: no ring until the keyboard moves)
        box.innerHTML =
            `<div class="dialog first-open" role="dialog" aria-modal="true" aria-labelledby="fo-title">` +
            `<div class="dialog-head"><h2 id="fo-title" class="dialog-title">${folder ? `Opening ${this.esc(folder)}` : 'Before you open a folder'}</h2></div>` +
            `<div class="dialog-body fo-body">` +
            (places ? `<section class="fo-part"><h3 class="fo-sub">Where your projects are</h3><p class="fo-help">${FolderMove.ADVICE}</p>` +
                `<div class="fo-row"><span id="fo-dir" class="fo-dir"></span><button id="fo-choose" class="btn secondary">Choose…</button></div></section>` : '') +
            `<p class="fo-note">Edits are kept in jEditor, and your photos stay as they are until you choose Write edits to file (${Host.say('Ctrl+S')}). Export makes edited copies. You can change this${places ? ', and the folder,' : ''} later in Settings → Projects.</p>` +
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
                box.remove();
                this.set({ asked: true });
                resolve();
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

    // A folder has loaded (script.js): dragged in before anything was
    // asked, the welcome, for this folder
    async afterLoad() {
        const app = this.app;
        const dir = app.dirHandle;
        if (!dir || app.readOnlyMode || app.library || this.asked() || !this.places()) return;
        await this.welcome({ folder: dir.name });
    }
};
