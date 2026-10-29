// Small motions in jEditor's own look (style.css, "Motion"): the mode
// switch's highlight glides to the mode chosen, rotate buttons turn their
// icon the way they turn the photo, the selection count ticks when it
// changes, and in the grid a folder's photos ripple in, deleted ones
// shrink away while the rest slide into their places, and a new flag
// pops. A tile clicked gives a little bounce, and photos that turn up in
// the folder while it's open fly into their places. They follow what happened and never hold anything up (the change
// is made first, then shown moving); the themes and Reduce motion have
// none, nor with Settings → Animations off. The tiles easing in and out as the grid scrolls are CSS only.
const Motion = {
    init() {
        // The mode switch is made after this (modes.js), into the sidebar
        const rail = document.getElementById('folder-rail');
        const seg = () => {
            const el = document.getElementById('mode-seg');
            if (el && !el.querySelector(':scope > .seg-glide')) this.glide(el);
        };
        seg();
        if (rail) new MutationObserver(seg).observe(rail, { childList: true });
        // A rotate button: its arrow turns once, as the photo does
        document.addEventListener('click', (e) => {
            const b = e.target.closest('button[id*="rotate-left"], button[id*="rotate-right"]');
            if (b) this.replay(b, b.id.includes('left') ? 'turn-left' : 'turn-right');
        }, true);
        this.grid();
        // A tile clicked (chosen, or opened) bounces
        document.addEventListener('click', (e) => {
            const tile = e.target.closest('#grid-view .grid-item');
            if (tile && this.on()) tile.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.94)', offset: 0.3 }, { transform: 'scale(1.03)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
        }, true);
        // Photos that arrive in the folder (watch.js marks them is-new) fly in
        const g = document.getElementById('grid-view');
        if (g) new MutationObserver((list) => {
            if (!this.on()) return;
            let n = 0;
            for (const m of list) for (const el of m.addedNodes) {
                if (!el.classList || !el.classList.contains('is-new')) continue;
                const r = el.getBoundingClientRect();
                if (r.bottom < 0 || r.top > innerHeight) continue;
                el.animate([
                    { transform: 'translateY(48px) scale(0.5)', opacity: 0 },
                    { transform: 'translateY(-4px) scale(1.04)', opacity: 1, offset: 0.7 },
                    { transform: 'none', opacity: 1 }
                ], { duration: 460, delay: Math.min(n++ * 60, 600), easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' });
            }
        }).observe(g, { childList: true });
        const count = document.getElementById('selection-count');
        if (count) {
            let last = count.textContent;
            new MutationObserver(() => {
                if (count.textContent !== last) this.replay(count, 'tick');
                last = count.textContent;
            }).observe(count, { childList: true, characterData: true, subtree: true });
        }
    },

    on() {
        const root = document.documentElement;
        return !root.dataset.skin && root.dataset.motion !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    },

    // The grid's tiles in sight, in order (a binary search: a folder can
    // have thousands)
    inSight() {
        const g = document.getElementById('grid-view');
        if (!g || g.classList.contains('hidden') || !g.offsetParent) return [];
        const kids = g.children, H = innerHeight;
        let lo = 0, hi = kids.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (kids[mid].getBoundingClientRect().bottom < 0) lo = mid + 1; else hi = mid;
        }
        const out = [];
        for (let i = lo; i < kids.length && out.length < 200; i++) {
            const r = kids[i].getBoundingClientRect();
            if (r.top > H) break;
            if (kids[i].classList.contains('grid-item')) out.push([kids[i], r]);
        }
        return out;
    },

    // Where each tile in sight is, by its photo (or folder name)
    snap() {
        const m = new Map();
        for (const [el, r] of this.inSight()) m.set(el._file || el.dataset.name || el, { el, r });
        return m;
    },

    // Tiles that moved slide from where they were; tiles gone shrink away
    flip(before) {
        const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
        for (const [el, r] of this.inSight()) {
            const was = before.get(el._file || el.dataset.name || el);
            if (!was) continue;
            before.delete(el._file || el.dataset.name || el);
            const dx = was.r.left - r.left, dy = was.r.top - r.top;
            if (Math.abs(dx) + Math.abs(dy) < 1) continue;
            el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 240, easing: EASE });
        }
        for (const { el, r } of before.values()) {
            if (el.isConnected) continue;
            const ghost = el.cloneNode(true);
            ghost.classList.remove('selected', 'active');
            Object.assign(ghost.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, pointerEvents: 'none', zIndex: 1, animation: 'none' });
            document.body.appendChild(ghost);
            ghost.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.7 }], { duration: 200, easing: EASE }).finished.then(() => ghost.remove(), () => ghost.remove());
        }
    },

    // A folder's photos come in one after another, quickly, from the top
    ripple() {
        this.inSight().forEach(([el], i) => el.animate(
            [{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }],
            { duration: 220, delay: Math.min(i * 12, 240), easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' }));
    },

    // The grid's own calls, with the motion around them
    grid() {
        if (typeof app === 'undefined') return;
        const self = this;
        const render = app.renderGrid;
        app.renderGrid = function (...args) {
            // A huge folder's grid builds its tiles as it scrolls (gridWindow):
            // there the tiles don't ease in and out (style.css), it would cost
            // a frame on each page scrolled
            const mark = () => this.elements.gridView.classList.toggle('grid-windowed', !!this._gridWin);
            if (!self.on()) { const out = render.apply(this, args); mark(); return out; }
            // The same folder drawn again (sorted, filtered, refreshed):
            // tiles slide to their new places. Another folder: a ripple
            const key = [this.dirHandle && this.dirHandle.name, typeof Folders !== 'undefined' ? Folders.scope : ''].join('|');
            const same = key === self._gridKey;
            self._gridKey = key;
            const before = same ? self.snap() : null;
            const out = render.apply(this, args);
            mark();
            requestAnimationFrame(() => { if (before) self.flip(before); else self.ripple(); });
            return out;
        };
        const remove = app.removeFilesFromApp;
        app.removeFilesFromApp = function (...args) {
            if (!self.on()) return remove.apply(this, args);
            const before = self.snap();
            const out = remove.apply(this, args);
            self.flip(before);
            return out;
        };
        // A flag set on a tile in sight pops in (not each time tiles are drawn)
        if (typeof Flags !== 'undefined') {
            const decorate = Flags.decorate;
            Flags.decorate = function (el, f) {
                const live = el.isConnected && self.on();
                const had = live ? new Set([...el.querySelectorAll('.tile-flags > i')].map(i => i.className)) : null;
                const out = decorate.call(this, el, f);
                if (had) el.querySelectorAll('.tile-flags > i').forEach(i => {
                    if (!had.has(i.className)) i.animate([{ scale: 0.3, opacity: 0 }, { scale: 1.25, offset: 0.6 }, { scale: 1, opacity: 1 }], { duration: 280, easing: 'ease-out' });
                });
                return out;
            };
        }
    },

    // Start a class's animation again, and take the class off when it ends
    replay(el, cls) {
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
    },

    // One highlight behind a segmented switch, moved under the chosen button
    glide(seg) {
        if (!seg) return;
        const hl = document.createElement('span');
        hl.className = 'seg-glide';
        hl.setAttribute('aria-hidden', 'true');
        seg.prepend(hl);
        const place = () => {
            const on = seg.querySelector(':scope > button.on');
            hl.style.opacity = on ? '' : '0';
            if (!on) return;
            hl.style.left = on.offsetLeft + 'px';
            hl.style.top = on.offsetTop + 'px';
            hl.style.width = on.offsetWidth + 'px';
            hl.style.height = on.offsetHeight + 'px';
        };
        place();
        // Placed at once the first time, so it never slides in from the edge
        requestAnimationFrame(() => seg.classList.add('glides'));
        // Its buttons are made again for each mode (modes.js), which takes
        // the highlight out: put back, it moves from where it was
        new MutationObserver(() => {
            if (!hl.isConnected) seg.prepend(hl);
            place();
        }).observe(seg, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        new ResizeObserver(place).observe(seg);
    }
};

document.addEventListener('DOMContentLoaded', () => Motion.init());
