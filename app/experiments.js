// Experimental features (Settings → Experimental): ones still being made,
// off until turned on, one at a time. A feature asks Experiments.on(id)
// before it shows itself; turning one on or off takes effect at once (a
// 'jeditor-experiments' event on window says so). Betas (Settings →
// Updates → Beta builds) get new ones first.
//
// An experiment: { id, title, text, beta }. beta: on to start with in a
// beta build (still off in a release until turned on). When one is done
// it leaves this list and is simply part of jEditor.

const Experiments = {
    LIST: [
        {
            id: 'adjust', beta: true,
            title: 'Adjust: Lightroom-style editing',
            text: 'Light, color, levels and curves, film looks of real stocks, color grading, masks, spot and dust removal, sharpening and noise reduction (E, or the sliders button). Never changes the photo until you export or save. Adjustments already made stay on the photos when this is off'
        },
        {
            id: 'paint', beta: true,
            title: 'Paint: brushes, shapes, text and layers',
            text: 'Paint over a photo in layers (B, or the brush button): brush, pencil, spray, eraser, fill, gradients, lines and shapes, text, and selections to move, scale and turn. Kept with the photo until you export or save. Painting already done stays on the photos when this is off'
        }
    ],

    init(app) {
        this.app = app;
        this.render();
    },

    on(id) {
        const prefs = (this.app && this.app.uiPrefs && this.app.uiPrefs.experiments) || {};
        const x = this.LIST.find(e => e.id === id);
        if (!x) return false;
        if (typeof prefs[id] === 'boolean') return prefs[id];
        return !!(x.beta && this.betaBuild());
    },

    // This is a beta (v1.42.0-beta.3)
    betaBuild() {
        return typeof APP_BUILD !== 'undefined' && /-beta\./.test(APP_BUILD);
    },

    set(id, value) {
        const app = this.app;
        app.uiPrefs.experiments = { ...(app.uiPrefs.experiments || {}), [id]: !!value };
        app.saveUiPrefs();
        dispatchEvent(new CustomEvent('jeditor-experiments', { detail: { id, on: !!value } }));
    },

    render() {
        const list = document.getElementById('exp-list');
        if (!list) return;
        list.textContent = '';
        if (!this.LIST.length) {
            const p = document.createElement('p');
            p.className = 'exp-empty';
            p.textContent = 'Nothing to try right now. New features show up here first, before they\'re finished.';
            list.appendChild(p);
            return;
        }
        for (const x of this.LIST) {
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
