// The guide: a small panel to look things up in, beside the photo, that
// never blocks the app. Short how-tos (from docs/using-jeditor.md) and the
// keyboard shortcuts as they're set now (Toolbar & keys can change them),
// with a search. F1, the home page's gear menu, or Help in a theme's menu
// bar. Every platform.

const Guide = {
    isOpen: false,
    query: '',
    filter: 'howto',

    // As take C: How to (every how-to), Keys, then a how-to's part of jEditor
    FILTERS: [['howto', 'How to'], ['keys', 'Keys'], ['photos', 'Photos'], ['adjust', 'Adjust'], ['paint', 'Paint']],

    // [where, title, how]. {key:id} shows that action's key as it's set now.
    HOWTO: [
        ['photos', 'Open a folder', 'Open a folder on the home page, or drag one onto the window. Subfolders come too. The last ones you opened lie on the home page as stacks of prints.'],
        ['photos', 'Move through photos', '{key:nav.prev} and {key:nav.next}. {key:view.toggle} switches between one photo and the grid.'],
        ['photos', 'Turn a photo', '{key:edit.rotateLeft} and {key:edit.rotateRight}. In the grid, every selected photo turns. It\'s saved to the file straight away.'],
        ['photos', 'Crop and straighten', 'Press {key:edit.crop}. Drag the corners; the dial straightens. {key:crop.save} saves, {key:crop.saveNext} saves and opens the next photo, {key:crop.cancel} cancels.'],
        ['photos', 'Crop many in a row', 'In the grid, select them and press {key:edit.crop}: each one opens in turn.'],
        ['photos', 'Auto crop scans', 'Right-click → Auto crop finds each print on a scan and makes it a photo of its own.'],
        ['photos', 'Undo a crop', '{key:edit.undo}, any time, even after you\'ve moved on.'],
        ['photos', 'Undo', '{key:edit.undo} undoes the last turn, crop, rename, move or delete, even after you\'ve moved on. {key:edit.history} lists them.'],
        ['photos', 'Flag photos', '{key:flag.star} stars a photo, {key:flag.rescan} marks it to scan again, 1 to 5 give it a colour. The Flags list in the sidebar shows only those.'],
        ['photos', 'Rename', '{key:edit.rename} renames the photo, or every selected photo at once, with a pattern.'],
        ['photos', 'Move to a folder', 'Select photos and press {key:edit.moveTo}, or drag them onto a folder in the sidebar.'],
        ['photos', 'Delete', 'Delete sends photos to the Recycle Bin or Trash, and {key:edit.undo} puts them back.'],
        ['photos', 'Export and convert', 'Export, in More or the selection\'s ⋯, makes copies at a size and format. Convert on the home page changes a whole folder\'s format.'],
        ['adjust', 'Open Adjust', '{key:edit.adjust}, or the chip at the top left. Esc goes back to Photos, keeping what you did.'],
        ['adjust', 'Light and colour', 'Exposure, contrast, white balance, curves and a colour mixer, as in Lightroom. Auto and Auto color make a first pass.'],
        ['adjust', 'Looks', 'Film looks (negative, slide, cinema, black and white) are under Basic. Click one to try it.'],
        ['adjust', 'Nothing is lost', 'Adjust keeps the photo as it was. Save edits or Export writes it out; Copy and Paste take the settings to other photos.'],
        ['paint', 'Open Paint', '{key:edit.paint}, or the chip at the top left. New canvas on the home page starts a blank one.'],
        ['paint', 'Brushes', 'Brush, pencil, spray and eraser are down the left. [ and ] size the brush; Alt-click picks a colour from the photo.'],
        ['paint', 'Layers', 'Add, hide, merge and blend layers on the right. They\'re kept with the project, so the painting can be changed later.'],
        ['paint', 'Bring in an image', 'Bring in an image… under the layers, or paste one. Drag to move it, a corner to size it, and Enter puts it down.']
    ],

    keyOf(id) {
        const k = app.keyBindings && app.keyBindings[id] && app.keyBindings[id][0];
        return k ? app.formatCombo(k) : '';
    },
    esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); },
    kbd(text) { return `<kbd class="guide-k">${this.esc(text)}</kbd>`; },
    // A combo as keycaps, one for each key: Ctrl Z
    keycaps(id) {
        const k = app.keyBindings && app.keyBindings[id] && app.keyBindings[id][0];
        if (!k) return '';
        return app.formatCombo(k).split(' + ').map(p => this.kbd(p)).join('');
    },
    // A how-to's words, with its keys as they're set now
    fill(text) {
        return this.esc(text).replace(/\{key:([\w.]+)\}/g, (_, id) => {
            const k = this.keycaps(id);
            return k ? `<span class="guide-keys">${k}</span>` : 'its button';
        });
    },

    toggle() { if (this.isOpen) this.close(); else this.open(); },

    open() {
        let p = document.getElementById('guide-panel');
        if (!p) {
            p = document.createElement('aside');
            p.id = 'guide-panel';
            p.className = 'guide-panel';
            p.setAttribute('role', 'dialog');
            p.setAttribute('aria-label', 'Guide');
            // The welcome tour, once it's built, is the other half of the switch
            p.innerHTML = `<div class="guide-head"><div class="guide-seg"><span aria-current="page">Guide</span></div>
                <button type="button" class="guide-x" title="Close (Esc)" aria-label="Close">×</button></div>
                <div class="guide-body">
                    <label class="guide-search"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                    <input id="guide-search" type="search" placeholder="How do I…" aria-label="Search the guide" autocomplete="off"></label>
                    <div class="guide-chips" role="group" aria-label="Show">${this.FILTERS.map(([f, n]) => `<button type="button" data-filter="${f}" aria-pressed="false">${n}</button>`).join('')}</div>
                    <div id="guide-list" class="guide-list" aria-live="polite"></div>
                </div>
                <div class="guide-foot"><span>From the guide to jEditor (Using jEditor)</span><span id="guide-key"></span></div>`;
            document.body.appendChild(p);
            p.querySelector('.guide-x').addEventListener('click', () => this.close());
            p.querySelector('.guide-chips').addEventListener('click', (e) => {
                const b = e.target.closest('[data-filter]');
                if (b) { this.filter = b.dataset.filter; this.render(); }
            });
            const q = p.querySelector('#guide-search');
            q.addEventListener('input', () => { this.query = q.value; this.render(); });
            // Esc closes it; keys typed in it stay in it
            p.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); }
            });
        }
        this.isOpen = true;
        this.place();
        this.render();
        clearInterval(this._timer);
        // Adjust and Paint have their own panel on the right: the guide moves left
        this._timer = setInterval(() => this.place(), 400);
        setTimeout(() => document.getElementById('guide-search')?.focus(), 30);
    },

    close(refocus = false) {
        this.isOpen = false;
        this.query = '';
        clearInterval(this._timer);
        document.getElementById('guide-panel')?.remove();
        if (refocus) document.activeElement?.blur();
    },

    place() {
        const p = document.getElementById('guide-panel');
        if (!p) return;
        const editing = (typeof Adjust !== 'undefined' && Adjust.isOpen) || (typeof PaintEditor !== 'undefined' && PaintEditor.isOpen);
        p.classList.toggle('left', !!editing);
    },

    render() {
        const p = document.getElementById('guide-panel');
        if (!p) return;
        p.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === this.filter)));
        const k = this.keyOf('app.guide');
        p.querySelector('#guide-key').innerHTML = k ? this.kbd(k) : '';
        const q = this.query.trim().toLowerCase(), f = this.filter;
        const words = q.split(/\s+/).filter(Boolean);
        const hit = (text) => words.every(w => text.toLowerCase().includes(w));
        let html = '';
        if (f === 'keys') {
            html = (app.KEY_ACTIONS || []).filter(([id, , group, label]) => this.keyOf(id) && (!q || hit(`${group} ${label}`)))
                .map(([id, , group, label]) => `<div class="guide-row guide-keyrow"><p><span class="guide-group">${this.esc(group)}</span> ${this.esc(label)}</p><span class="guide-keys">${this.keycaps(id)}</span></div>`).join('');
        } else {
            html = this.HOWTO.filter(([where, title, how]) => (f === 'howto' || where === f) && (!q || hit(`${title} ${how.replace(/\{key:[\w.]+\}/g, '')} ${where}`)))
                .map(([, title, how]) => `<div class="guide-row"><h3>${this.esc(title)}</h3><p>${this.fill(how)}</p></div>`).join('');
        }
        p.querySelector('#guide-list').innerHTML = html || `<p class="guide-none">Nothing found${f === 'keys' ? '' : ' in How to. Try other words, or Keys'}.</p>`;
    }
};
