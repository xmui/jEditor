// Small motions in jEditor's own look (style.css, "Motion"): the mode
// switch's highlight glides to the mode chosen, rotate buttons turn their
// icon the way they turn the photo, the selection count ticks when it
// changes, and in the grid a folder's photos ripple in, deleted ones
// shrink away while the rest slide into their places, and a new flag
// fades in. A photo opened from the grid zooms out of its tile into the
// viewer, and going back zooms it down into its tile again (zoom). Selection never animates, and photos that turn up in
// the folder while it's open fade into their places. Nothing bounces or overshoots. They follow what happened and never hold anything up (the change
// is made first, then shown moving); the themes and Reduce motion have
// none, nor with Settings → Animations off. A theme can still open a photo
// from the grid its own way (--grid-zoom: zoomStyle).
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
        // A key held (its repeats): the grid races along. The easing at
        // its edges lagged a frame behind, which showed whole rows faded
        // to the background in the middle of the view (a black flash), and
        // the bounces piled up: none of it until the key is let go
        addEventListener('keydown', (e) => { if (e.repeat) this.hold(); }, true);
        addEventListener('keyup', () => this.release(), true);
        addEventListener('blur', () => this.release());
        // Photos that arrive in the folder (watch.js marks them is-new) fly in
        const g = document.getElementById('grid-view');
        if (g) new MutationObserver((list) => {
            if (!this.on()) return;
            let n = 0;
            for (const m of list) for (const el of m.addedNodes) {
                if (!el.classList || !el.classList.contains('is-new')) continue;
                const r = el.getBoundingClientRect();
                if (r.bottom < 0 || r.top > innerHeight) continue;
                // (a fade and a short rise: nothing overshoots)
                el.animate([
                    { transform: 'translateY(12px)', opacity: 0 },
                    { transform: 'none', opacity: 1 }
                ], { duration: 280, delay: Math.min(n++ * 60, 600), easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' });
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
            const ghost = this.copy(el);
            ghost.classList.remove('selected', 'active');
            Object.assign(ghost.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, pointerEvents: 'none', zIndex: 1, animation: 'none' });
            document.body.appendChild(ghost);
            ghost.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.7 }], { duration: 200, easing: EASE }).finished.then(() => ghost.remove(), () => ghost.remove());
        }
    },

    // A tile, its photos drawn from its own: a gone photo's thumbnail
    // address is let go of, and a copied <img> would fetch it again
    copy(n) {
        if (n.nodeName !== 'IMG') {
            const c = n.cloneNode(false);
            for (const k of n.childNodes) c.appendChild(this.copy(k));
            return c;
        }
        const c = document.createElement('canvas');
        c.className = n.className;
        c.style.cssText = n.style.cssText;
        Object.assign(c.style, { width: '100%', height: '100%', display: 'block', objectFit: document.getElementById('grid-view').classList.contains('thumb-contain') ? 'contain' : 'cover' });
        if (n.complete && n.naturalWidth) {
            c.width = n.naturalWidth;
            c.height = n.naturalHeight;
            try { c.getContext('2d').drawImage(n, 0, 0); } catch (e) { /* not drawable: an empty tile */ }
        }
        return c;
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
            // A huge folder's grid builds its tiles as it scrolls (gridWindow)
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
            // Measured now, not a frame later: only what the drawing moved
            // slides, not a tile size changed after it (the size slider)
            if (before) self.flip(before); else requestAnimationFrame(() => self.ripple());
            return out;
        };
        // In a huge folder's grid a jump (the scroll bar dragged, Page Down,
        // End) builds a screenful of new tiles at once, and easing each in
        // as it scrolls (style.css) would cost a frame there: the easing
        // waits until the grid has settled. So does a fast fling (more than
        // half a screen a frame): the easing doubled its frames (60 ms, not
        // 28) and can hardly be seen at that speed. Scrolling along keeps it
        const update = app.updateGridWindow;
        app.updateGridWindow = function (...args) {
            const grid = this.elements.gridView;
            const y = grid.scrollTop;
            if (this._gridWin && self._gridY !== undefined && Math.abs(y - self._gridY) > grid.clientHeight / 2) {
                grid.classList.add('grid-jump');
                clearTimeout(self._jumpTimer);
                self._jumpTimer = setTimeout(() => { if (!self.held) grid.classList.remove('grid-jump'); }, 250);
            }
            self._gridY = y;
            return update.apply(this, args);
        };
        // (Selection never animates: its ring and tick appear at once)
        const remove = app.removeFilesFromApp;
        app.removeFilesFromApp = function (...args) {
            if (!self.on()) return remove.apply(this, args);
            const before = self.snap();
            const out = remove.apply(this, args);
            self.flip(before);
            return out;
        };
        // Grid to viewer and back: the photo zooms out of its tile, and down into it
        const view = app.setView;
        app.setView = function (mode, ...rest) {
            const from = this.viewMode;
            const how = self.zoomStyle();
            if (from === mode || !how || self.held) return view.call(this, mode, ...rest);
            const tile = from === 'grid' && mode === 'single' ? self.tileOf(this.currentFile) : null;
            const was = from === 'single' && mode === 'grid' ? self.photoRect(this.currentFile) : null;
            const out = view.call(this, mode, ...rest);
            if (how === 'rects') {
                if (tile && this.viewMode === 'single' && this.currentFile === tile._file) self.zoomRects(tile.r, self.photoRect(tile._file, tile.w, tile.h));
                if (was && this.viewMode === 'grid') self.zoomRects(was, self.revealTile(this.currentFile));
                return out;
            }
            if (tile && this.viewMode === 'single' && this.currentFile === tile._file) self.zoomOut(tile);
            if (was && this.viewMode === 'grid') self.zoomIn(this.currentFile, was);
            return out;
        };
        // A flag set on a tile in sight fades in (not each time tiles are drawn)
        if (typeof Flags !== 'undefined') {
            const decorate = Flags.decorate;
            Flags.decorate = function (el, f) {
                const live = el.isConnected && self.on();
                const had = live ? new Set([...el.querySelectorAll('.tile-flags > i')].map(i => i.className)) : null;
                const out = decorate.call(this, el, f);
                if (had) el.querySelectorAll('.tile-flags > i').forEach(i => {
                    if (!had.has(i.className)) i.animate([{ scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1 }], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
                });
                return out;
            };
        }
    },

    ZOOM: 200, // ms: grid to viewer, and back

    // How a photo opens from the grid: 'zoom' (jEditor's own look), or in a
    // theme what its stylesheets say (--grid-zoom: zoom, rects or none);
    // nothing with Animations off or Reduce motion
    zoomStyle() {
        const root = document.documentElement;
        if (root.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches) return '';
        if (!root.dataset.skin) return 'zoom';
        const how = getComputedStyle(root).getPropertyValue('--grid-zoom').trim();
        return how === 'none' ? '' : how;
    },

    // The photo's tile, scrolled into sight: where it is
    revealTile(f) {
        const el = f && (app.revealInGrid ? app.revealInGrid(f) : f._gridEl);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        const t = this.tileOf(f);
        return t && t.r;
    },

    // The classic Mac's zoom: outlines stepping from one box to the other,
    // each drawn and then rubbed out (XOR'd: white with difference, the same
    // over any picture in every look)
    zoomRects(from, to) {
        this.endZoom();
        if (!from || !to) return;
        const box = document.createElement('div');
        Object.assign(box.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 50 });
        document.body.appendChild(box);
        const N = 8, step = this.ZOOM / N, timers = [];
        const at = (k, t) => from[k] + (to[k] - from[k]) * t;
        for (let i = 1; i <= N; i++) {
            const t = i / N, r = document.createElement('div');
            Object.assign(r.style, {
                position: 'absolute', left: at('left', t) + 'px', top: at('top', t) + 'px', width: at('width', t) + 'px', height: at('height', t) + 'px',
                border: '1px solid #fff', mixBlendMode: 'difference', visibility: 'hidden'
            });
            box.appendChild(r);
            timers.push(setTimeout(() => { r.style.visibility = 'visible'; }, (i - 1) * step));
            timers.push(setTimeout(() => r.remove(), (i + 2) * step));
        }
        const done = () => { timers.forEach(clearTimeout); box.remove(); if (this._zoom === done) this._zoom = null; };
        this._zoom = done;
        timers.push(setTimeout(done, (N + 3) * step));
    },

    // A photo's tile in sight in the grid, with where it is
    tileOf(f) {
        const el = f && f._gridEl;
        if (!el || !el.isConnected || !el.offsetParent) return null;
        const img = el.querySelector('img');
        const r = (img || el).getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > innerHeight) return null;
        return { el, img, r, _file: f, w: img && img.naturalWidth, h: img && img.naturalHeight };
    },

    // Where the photo is (or will be) in the viewer: the image on screen
    // when it's this photo's, or the viewer's box fitted to its shape
    photoRect(f, w, h) {
        const cur = app.elements.currentImage;
        if (cur && app._displayFile === f && cur.naturalWidth) {
            const r = cur.getBoundingClientRect();
            if (r.width) return r;
        }
        const box = app.elements.imageContainer.getBoundingClientRect();
        if (!box.width || !box.height) return null;
        w = w || (f && f._dims && f._dims.w) || box.width;
        h = h || (f && f._dims && f._dims.h) || box.height;
        if (Math.round(app.getDisplayRotation(f, 'thumb') / 90) % 2) [w, h] = [h, w];
        const k = Math.min(box.width / w, box.height / h, f && f._dims ? Math.max(f._dims.w, f._dims.h) / Math.max(w, h) : Infinity);
        const pw = w * k, ph = h * k;
        return { left: box.left + (box.width - pw) / 2, top: box.top + (box.height - ph) / 2, width: pw, height: ph };
    },

    // One zoom at a time: a new one (or Space pressed again) ends the last
    endZoom() {
        if (this._zoom) this._zoom();
        this._zoom = null;
    },

    // Opened from the grid: the viewer starts on the tile and grows into place
    zoomOut(tile) {
        this.endZoom();
        const box = app.elements.imageContainer;
        const C = box.getBoundingClientRect();
        const P = this.photoRect(tile._file, tile.w, tile.h);
        if (!P || !C.width) return;
        // Scaled about the viewer's middle, the photo lands on the tile
        const s = Math.min(tile.r.width / P.width, tile.r.height / P.height);
        const cx = C.left + C.width / 2, cy = C.top + C.height / 2;
        const px = P.left + P.width / 2, py = P.top + P.height / 2;
        const tx = tile.r.left + tile.r.width / 2 - cx - s * (px - cx);
        const ty = tile.r.top + tile.r.height / 2 - cy - s * (py - cy);
        const a = box.animate([
            { translate: `${tx}px ${ty}px`, scale: String(s), opacity: 0.4 },
            { translate: '0 0', scale: '1', opacity: 1 }
        ], { duration: this.ZOOM, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
        this._zoom = () => a.cancel();
        a.finished.then(() => { if (this._zoom) this._zoom = null; }, () => { });
    },

    // Back to the grid: the photo's tile starts where the photo was and
    // shrinks into its place (a copy above the grid, the tile's own hidden under it)
    zoomIn(f, P) {
        this.endZoom();
        if (!f) return;
        // Scrolled to now (setView does it again a moment later, to the same place)
        const el = app.revealInGrid ? app.revealInGrid(f) : f._gridEl;
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        const tile = this.tileOf(f);
        if (!tile) return;
        const r = tile.r;
        // Only the photo: its name and flags would grow huge at the start
        const img = tile.img;
        if (!img) return;
        const ghost = document.createElement('div');
        const shot = img.cloneNode(false);
        shot.removeAttribute('loading');
        Object.assign(shot.style, { width: '100%', height: '100%', display: 'block', objectFit: getComputedStyle(img).objectFit });
        ghost.appendChild(shot);
        Object.assign(ghost.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', overflow: 'hidden', borderRadius: getComputedStyle(img).borderRadius, pointerEvents: 'none', zIndex: 50, transformOrigin: '0 0', willChange: 'transform' });
        document.body.appendChild(ghost);
        img.style.visibility = 'hidden';
        const s = Math.max(P.width / r.width, P.height / r.height);
        const tx = P.left + P.width / 2 - s * r.width / 2 - r.left;
        const ty = P.top + P.height / 2 - s * r.height / 2 - r.top;
        const a = ghost.animate([
            { transform: `translate(${tx}px, ${ty}px) scale(${s})`, opacity: 0.6 },
            { transform: 'none', opacity: 1 }
        ], { duration: this.ZOOM, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
        const done = () => { ghost.remove(); img.style.visibility = ''; if (this._zoom === done) this._zoom = null; };
        this._zoom = done;
        a.finished.then(done, done);
    },

    held: false, // a key is held down (app.goTo scrolls at once then)

    hold() {
        this.held = true;
        clearTimeout(this._jumpTimer);
        const g = document.getElementById('grid-view');
        if (g) g.classList.add('grid-jump');
    },

    release() {
        if (!this.held) return;
        this.held = false;
        clearTimeout(this._jumpTimer);
        this._jumpTimer = setTimeout(() => {
            const g = document.getElementById('grid-view');
            if (g) g.classList.remove('grid-jump');
        }, 250);
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
