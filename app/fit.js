// Pills that fit the window, however narrow (half a screen, or less, with
// the folder list open). Each row gives up its least needed parts in turn,
// measured, until nothing overlaps:
//
//   Top: the sort's icon, then the sort as just an icon, then the count
//   ("1 / 9"); in the grid the file pill itself (the folder pill has the
//   top left); then header buttons go into More, least used first. The
//   file pill moves off center when it has to, and the name gives way.
//
//   Bottom (grid): "not saved yet" (the count stays), the selection bar
//   off center beside the slider, then its labels, the edits bar up above the size slider, a shorter slider, the
//   separators, then the slider (Ctrl+wheel still sizes); last, the
//   selection bar scrolls sideways.
//
// The steps are tokens in #main-interface's data-fit (style.css), not
// classes, so watching its classes doesn't wake this up again.

const Fit = {
    TOP: ['sort-short', 'sort-icon', 'count-off'],
    BOTTOM: ['edits-short', 'sel-aside', 'sel-icons', 'edits-stacked', 'size-short', 'sel-tight', 'size-off'],
    // Into More first: the least used
    SQUEEZE: ['whatsnew', 'keys', 'convert', 'dupes', 'fullscreen', 'strip', 'fit', 'customize', 'refresh', 'history', 'camera', 'info', 'scan', 'crop', 'view'],
    GAP: 12,       // between pills, screen pixels
    NAME_MIN: 96,  // a name shorter than this is cut with an ellipsis

    el(id) { return document.getElementById(id); },

    init() {
        if (this._inited) return;
        this._inited = true;
        const iface = this.el('main-interface');
        if (!iface) return;
        const soon = () => this.soon();
        if (typeof ResizeObserver === 'function') {
            const ro = this._ro = new ResizeObserver(soon);
            for (const id of ['main-interface', 'folder-bar', 'header-controls', 'selection-bar', 'edits-bar', 'grid-controls', 'file-name-text', 'file-count', 'sort-mode', 'selection-count', 'edits-text', 'fb-crumbs', 'toast-stack'])
                if (this.el(id)) ro.observe(this.el(id));
        }
        // Shown and hidden, the view, the folder list, More opened
        const mo = this._mo = new MutationObserver(soon);
        mo.observe(iface, { attributes: true, attributeFilter: ['class'] });
        mo.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
        for (const id of ['folder-bar', 'header-controls', 'selection-bar', 'edits-bar', 'grid-controls'])
            if (this.el(id)) mo.observe(this.el(id), { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('resize', soon);
        this.run();
    },

    // Something made later (the messages): watched as it changes size
    watch(el) {
        if (this._ro && el) this._ro.observe(el);
    },

    // Once a frame: observers fire in bursts
    soon() {
        if (this._queued) return;
        this._queued = true;
        requestAnimationFrame(() => { this._queued = false; this.run(); });
    },

    shown(el) {
        return !!el && !el.classList.contains('hidden') && el.offsetParent !== null;
    },

    zoom() {
        return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    },

    // What a run changes itself (the folder pill's tight, tried and taken
    // back) isn't news: left in the observer, it woke the next run, every
    // frame, laying out the whole grid over and over
    run() {
        try {
            this.fit();
        } finally {
            if (this._mo) this._mo.takeRecords();
        }
    },

    fit() {
        const iface = this.el('main-interface');
        if (!iface || iface.classList.contains('hidden') || !iface.offsetWidth) return;
        // A theme's docked bars (themes.js) have room for everything, but
        // for the foot bar in a narrow window (fitDocked)
        if (document.documentElement.dataset.layout === 'docked') {
            for (const b of document.querySelectorAll('[data-squeezed]')) delete b.dataset.squeezed;
            const fi = document.querySelector('.file-info');
            if (fi) fi.style.maxWidth = '';
            iface.dataset.fit = '';
            this.fitDocked(iface);
            this.syncMore(this.el('header-controls'), this.el('btn-more'));
            return;
        }
        const tokens = new Set();
        const set = () => { iface.dataset.fit = [...tokens].join(' '); };
        this.fitTop(iface, tokens, set);
        this.fitBottom(iface, tokens, set);
        this.fitToasts(tokens);
        set();
        if (typeof Folders !== 'undefined' && Folders.fitBar) Folders.fitBar();
    },

    // A theme's foot bar: the selection bar and the size slider share it,
    // and in a narrow window the bar ran under the slider. A shorter
    // slider first, then the bar scrolls sideways in the room left
    fitDocked(iface) {
        const sel = this.el('selection-bar'), size = this.el('grid-controls');
        if (!sel || !size) return;
        sel.style.maxWidth = '';
        if (!this.shown(sel) || !this.shown(size)) return;
        // Its buttons, not its box: a theme's bar can be wider than they are
        const clear = () => {
            const r = size.getBoundingClientRect();
            return [...sel.children].every(b => { const c = b.getBoundingClientRect(); return !c.width || c.right <= r.left + 1 || c.left >= r.right - 1 || c.bottom <= r.top || c.top >= r.bottom; });
        };
        if (clear()) return;
        iface.dataset.fit = 'size-short';
        if (clear()) return;
        iface.dataset.fit = 'size-short sel-scroll';
        const room = size.getBoundingClientRect().left - sel.getBoundingClientRect().left - 8;
        sel.style.maxWidth = `${Math.max(0, Math.floor(room / this.zoom()))}px`;
    },

    // ---- Top: file pill between the folder pill and the header buttons ----

    fitTop(iface, tokens, set) {
        const hc = this.el('header-controls');
        const fi = document.querySelector('.file-info');
        const fb = this.el('folder-bar');
        const more = this.el('btn-more');
        if (!hc || !fi) return;
        // Opened More shows everything inline: keep the fit it had
        if (hc.classList.contains('expanded')) {
            for (const t of (iface.dataset.fit || '').split(' ')) if (this.TOP.includes(t) || t === 'name-off') tokens.add(t);
            return;
        }
        const zoom = this.zoom();
        const box = iface.getBoundingClientRect();
        const gutter = parseFloat(getComputedStyle(iface).getPropertyValue('--gutter')) || 16;
        const grid = document.body.dataset.view === 'grid';
        const bar = grid && this.shown(fb) ? fb : null;
        // In the single view the mode chip has the top left (modes.js)
        const chip = this.el('mode-float');
        const left = bar || (chip && !chip.classList.contains('over-mode') && chip.getClientRects().length ? chip : null);
        // Start from everything shown, the folder pill as small as it goes
        for (const b of hc.querySelectorAll('[data-squeezed]')) delete b.dataset.squeezed;
        this.syncMore(hc, more);
        fi.style.maxWidth = 'none';
        fi.style.removeProperty('--fi-shift');
        if (bar) {
            // Its smallest: short labels, at its own width
            bar.classList.add('tight');
            bar.style.setProperty('--bar-room', 'none');
        }
        set();
        const leftEdge = () => left ? left.getBoundingClientRect().right : box.left + gutter;
        const rightEdge = () => this.shown(hc) && !hc.classList.contains('vertical') ? hc.getBoundingClientRect().left : box.right - gutter;
        const room = () => rightEdge() - leftEdge() - 2 * this.GAP;
        const need = () => {
            if (tokens.has('name-off') || !this.shown(fi)) return 0;
            const w = fi.getBoundingClientRect().width;
            const name = this.el('file-name-text');
            const nw = name ? name.getBoundingClientRect().width : 0;
            return w - Math.max(0, nw - this.NAME_MIN * zoom);
        };
        const steps = [...this.TOP];
        if (grid) steps.push('name-off');
        for (const t of steps) {
            if (need() <= room()) break;
            tokens.add(t);
            set();
        }
        // Still short: header buttons into More, least used first (one
        // always stays, with More)
        if (need() > room() && !hc.classList.contains('vertical')) {
            const main = this.SQUEEZE
                .map(k => hc.querySelector(`[data-hc="${k}"]`))
                .filter(b => b && !b.classList.contains('hidden') && !b.classList.contains('hc-extra'));
            for (const b of main.slice(0, -1)) {
                b.dataset.squeezed = '';
                this.syncMore(hc, more);
                if (need() <= room()) break;
            }
        }
        // As wide as there's room for (the name gives way), centered unless
        // that would run into a pill on either side
        if (!this.shown(fi)) return;
        const r = Math.max(0, room());
        fi.style.maxWidth = `${Math.floor(r / zoom)}px`;
        const f = fi.getBoundingClientRect();
        const lo = leftEdge() + this.GAP, hi = rightEdge() - this.GAP;
        const shift = f.left < lo ? lo - f.left : f.right > hi ? hi - f.right : 0;
        if (shift) fi.style.setProperty('--fi-shift', `${Math.round(shift / zoom)}px`);
    },

    // More is shown for buttons put there in Settings, or squeezed in here
    syncMore(hc, more) {
        if (!more) return;
        const any = hc.querySelector('.hc-extra:not(.hidden), [data-squeezed]');
        more.classList.toggle('hidden', !any);
    },

    // ---- Single view: messages beside the prev / rotate / next pill ----

    // They share its row; when they'd run into it, they go up a row
    fitToasts(tokens) {
        const stack = this.el('toast-stack');
        const controls = document.querySelector('#image-container .controls');
        if (!stack || !controls || document.body.dataset.view !== 'single') return;
        if (!stack.children.length || !this.shown(controls) || controls.classList.contains('off')) return;
        if (stack.getBoundingClientRect().right + this.GAP > controls.getBoundingClientRect().left) tokens.add('toast-up');
    },

    // ---- Bottom: selection bar, edits bar and size slider in the grid ----

    fitBottom(iface, tokens, set) {
        const sel = this.el('selection-bar');
        const edits = this.el('edits-bar');
        const size = this.el('grid-controls');
        if (!sel || !size) return;
        const box = iface.getBoundingClientRect();
        const gutter = parseFloat(getComputedStyle(iface).getPropertyValue('--gutter')) || 16;
        // Where the row starts: after the folder list when it's beside the
        // grid (the bar's own offsets are scaled with it by the UI size)
        const startOf = () => box.left + (parseFloat(getComputedStyle(sel).left) || gutter) * this.zoom();
        const measure = () => {
            // The selection bar makes room for the edits bar and the slider
            const ew = edits && this.shown(edits) ? edits.offsetWidth : 0;
            iface.style.setProperty('--edits-room', ew + 'px');
            iface.style.setProperty('--size-room', (this.shown(size) ? size.offsetWidth : 0) + 'px');
        };
        const fits = () => {
            measure();
            const bars = [sel, edits, size].filter(b => this.shown(b));
            if (!bars.length) return true;
            const start = startOf();
            const rects = bars.map(b => b.getBoundingClientRect());
            const apart = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
            for (let i = 0; i < rects.length; i++) {
                if (rects[i].left < start - 1 || rects[i].right > box.right - gutter + 1) return false;
                for (let j = i + 1; j < rects.length; j++) if (!apart(rects[i], rects[j])) return false;
            }
            return true;
        };
        sel.style.maxWidth = '';
        set();
        for (const t of this.BOTTOM) {
            if (fits()) break;
            // Stacking only helps with the selection bar beside it
            if (t === 'edits-stacked' && !(this.shown(sel) && edits && this.shown(edits))) continue;
            tokens.add(t);
            set();
        }
        // Still too wide (a large UI size): it scrolls sideways in the room
        if (!fits() && this.shown(sel)) {
            const start = startOf();
            tokens.add('sel-scroll');
            set();
            sel.style.maxWidth = `${Math.floor((box.right - gutter - start) / this.zoom())}px`;
        }
        measure();
    }
};
