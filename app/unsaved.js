// Unsaved edits: how many photos in the open project have an edit that's
// in neither the file nor an export yet (the owner's counter, agreed on
// 22 November).
//
//   A photo is unsaved when it's been edited (a crop, a turn or a flip in
//   Photos, Adjust, Paint) since it was last written by Write edits to file
//   or exported. Writing the edit into the file takes the edit off the photo
//   (edits.js), so it's not counted; Export marks the edit it exported
//   (exported); any edit after that is a new one, so it counts again (the
//   same as before or not: undo states aren't matched). Ctrl+Z of a write
//   puts the edit back, unexported, so it counts. Photos deleted aren't in
//   the project, so aren't counted.
//
//   A project that writes turns and crops into the photos as they're made
//   (Settings → Projects → Saving: Edits.keeping() off) counts nothing.
//
// Kept with the project's edits (edits.json: `exported`, the photos whose
// edit was exported as it is), which the apps keep in their own storage on
// the computer, so an update or Clear cache keeps it.
//
// On screen: "12 unsaved" at the bottom of the sidebar while it's open,
// else a glass pill in the bottom-left corner, in every mode (the task pill
// and messages stack above it); hidden at 0. A click: Save over originals,
// Export…, Show these photos (the grid filtered to them: Flags' 'unsaved').
// Their thumbnails' edited dot is the unsaved one (edits.js: decorate).
// Nothing warns on closing or leaving: the edits are kept.

const Unsaved = {
    el(id) { return document.getElementById(id); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        for (const id of ['unsaved-pill', 'unsaved-side']) {
            const b = this.el(id);
            if (b) b.addEventListener('click', (e) => { e.stopPropagation(); this.menu(e.currentTarget); });
        }
        // Where it shows follows the sidebar (open or not, in each mode)
        const soon = () => this.soon();
        const rail = document.getElementById('folder-rail');
        if (rail && typeof MutationObserver === 'function') {
            const mo = new MutationObserver(soon);
            mo.observe(rail, { attributes: true, attributeFilter: ['class'] });
            for (const id of ['main-interface', 'adjust-editor', 'paint-editor', 'drop-zone']) {
                const el = document.getElementById(id);
                if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
            }
            mo.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
        }
        this.update();
    },

    // ---- Which photos ----

    // Counting at all: a project open, keeping its edits in jEditor
    counting() {
        const app = this.app;
        return !!(app && app.dirHandle && !app.readOnlyMode && !app.fixedFiles && Edits.keeping());
    },

    is(f) {
        return !!(f && f._edit && f._exportedEdit !== f._edit && this.counting());
    },

    files() {
        return this.counting() ? this.app.files.filter(f => f._edit && f._exportedEdit !== f._edit) : [];
    },

    // Exported as it is now: saved, until it's edited again
    exported(files) {
        let n = 0;
        for (const f of files) {
            if (f && f._edit && f._exportedEdit !== f._edit) {
                f._exportedEdit = f._edit;
                n++;
                if (f._gridEl) Edits.decorate(f._gridEl, f);
                if (f._stripEl) Edits.decorate(f._stripEl, f);
            }
        }
        if (n) {
            Edits._dirty = true;
            Edits.saveSoon();
        }
        this.update();
    },

    // ---- On screen ----

    // Once a frame at most: edits come in bursts
    soon() {
        if (this._queued) return;
        this._queued = true;
        requestAnimationFrame(() => { this._queued = false; this.update(); });
    },

    update() {
        const pill = this.el('unsaved-pill'), side = this.el('unsaved-side');
        if (!pill || !side) return;
        // Counting started or stopped (the project's choice, Settings →
        // Saving): the thumbnails' dots follow
        const counting = this.counting();
        if (counting !== this._counting) {
            this._counting = counting;
            for (const f of this.app ? this.app.files : []) {
                if (!f._edit) continue;
                if (f._gridEl) Edits.decorate(f._gridEl, f);
                if (f._stripEl) Edits.decorate(f._stripEl, f);
            }
        }
        const n = this.files().length;
        const text = `${n.toLocaleString()} unsaved`;
        const title = n === 1 ? '1 photo has edits that aren\'t saved over the original or exported yet'
            : `${n.toLocaleString()} photos have edits that aren't saved over the originals or exported yet`;
        // In the sidebar while it's shown; else in the corner, but not on
        // the start page, in Crop or in Duplicates
        const rail = document.getElementById('folder-rail');
        const inRail = !!rail && !rail.classList.contains('hidden') && rail.getClientRects().length > 0 && rail.getBoundingClientRect().width > 40;
        for (const [el, on] of [[side, n > 0 && inRail], [pill, n > 0 && !inRail]]) {
            const label = el.querySelector('.unsaved-text');
            if (label && label.textContent !== text) label.textContent = text;
            el.title = title;
            el.setAttribute('aria-label', title);
            el.classList.toggle('hidden', !on);
        }
        document.body.classList.toggle('has-unsaved', n > 0 && !inRail);
    },

    // Save over originals · Export… · Show these photos
    menu(btn) {
        const app = this.app;
        const files = this.files();
        if (!files.length) return;
        const n = files.length, these = n === 1 ? 'this photo' : `these ${n.toLocaleString()} photos`;
        const r = btn.getBoundingClientRect();
        app.openContextMenu([
            [n === 1 ? 'Save over the original' : 'Save over originals', () => Edits.saveAll({ list: this.files() })],
            ['Export…', () => Export.open({ files: this.files() })],
            ['—'],
            [`Show ${these}`, () => this.show()]
        ], r.left, r.top - 6, { above: true });
    },

    // The grid, filtered to them (Flags' filter: the chip takes it off)
    async show() {
        const app = this.app;
        if (typeof Modes !== 'undefined' && Modes.current() !== 'photos') await Modes.go('photos');
        if (app.viewMode !== 'grid') app.setView('grid');
        Flags.setFilter('unsaved');
    }
};
