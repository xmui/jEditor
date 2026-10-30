// Experimental features (Settings → Experimental): ones still being made,
// off until turned on, one at a time. A feature asks Experiments.on(id)
// before it shows itself; turning one on or off takes effect at once (a
// 'jeditor-experiments' event on window says so). Betas (Settings →
// Updates → Beta builds) get new ones first.
//
// An experiment: { id, title, text, beta, needs }. beta: on to start with
// in a beta build (still off in a release until turned on). needs: a
// feature the app must have (host.js), or it isn't offered. When one is done
// it leaves this list and is simply part of jEditor.
//
// What only shows with one on is marked data-experiment="id" in the page:
// apply() hides it (.exp-off) while that one is off.

const Experiments = {
    LIST: [
        {
            id: 'auto-crop',
            title: 'Auto crop',
            text: 'Finds the print on a scan, straightens it and crops to it: Auto in the crop editor, Auto crop on the selection (Shift+A), Auto crop in the scan window, and keeping test scans to improve it. Off while it\'s being fixed'
        }
    ],

    init(app) {
        this.app = app;
        this.render();
        this.apply();
    },

    // Shows or hides what's marked data-experiment, by whether it's on
    apply(root = document) {
        root.querySelectorAll('[data-experiment]').forEach(el => el.classList.toggle('exp-off', !this.on(el.dataset.experiment)));
    },

    on(id) {
        const prefs = (this.app && this.app.uiPrefs && this.app.uiPrefs.experiments) || {};
        const x = this.shown().find(e => e.id === id);
        if (!x) return false;
        if (typeof prefs[id] === 'boolean') return prefs[id];
        return !!(x.beta && this.betaBuild());
    },

    // The ones this app can have
    shown() {
        return this.LIST.filter(x => !x.needs || (typeof Host !== 'undefined' && Host.has(x.needs)));
    },

    // This is a beta (v1.42.0-beta.3)
    betaBuild() {
        return typeof APP_BUILD !== 'undefined' && /-beta\./.test(APP_BUILD);
    },

    set(id, value) {
        const app = this.app;
        app.uiPrefs.experiments = { ...(app.uiPrefs.experiments || {}), [id]: !!value };
        app.saveUiPrefs();
        this.apply();
        dispatchEvent(new CustomEvent('jeditor-experiments', { detail: { id, on: !!value } }));
    },

    render() {
        const list = document.getElementById('exp-list');
        if (!list) return;
        list.textContent = '';
        if (!this.shown().length) {
            const p = document.createElement('p');
            p.className = 'exp-empty';
            p.textContent = 'Nothing to try right now. New features show up here first, before they\'re finished.';
            list.appendChild(p);
            return;
        }
        for (const x of this.shown()) {
            const row = document.createElement('div');
            row.className = 'set-row';
            const label = document.createElement('label');
            label.className = 'set-label';
            label.htmlFor = 'exp-' + x.id;
            label.textContent = x.title;
            const small = document.createElement('small');
            small.textContent = x.text;
            label.appendChild(small);
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'switch';
            input.id = 'exp-' + x.id;
            input.checked = this.on(x.id);
            input.addEventListener('change', () => this.set(x.id, input.checked));
            row.append(label, input);
            list.appendChild(row);
        }
    }
};
