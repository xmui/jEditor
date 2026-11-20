// Crop & Straighten editor.
//
// Replaces Cropper.js, which never handled straightening well (rotated
// images left empty corners inside the crop) and cropped whatever bitmap
// happened to be on screen — including a stale one after a rotation.
//
// Model: the upright image (W × H, EXIF orientation applied) is centered on
// the origin and rotated clockwise by phi = quarterTurns·90° + angle. The
// crop is an axis-aligned rectangle in that rotated ("output") space and is
// always kept entirely inside the rotated image, so a straightened crop can
// never contain empty corners. The saved file is rendered from the original
// bytes read fresh from disk, at full resolution.
//
// Interaction follows Lightroom, Apple Photos and Windows Photos: the crop
// frame sits in the middle of the screen and the photo moves behind it.
// Drag a handle to resize (the view then glides so the crop fills the screen
// again), drag inside to move the photo, drag outside to rotate it. Turning
// pivots on the crop's center and zooms in just enough to hide the corners.
//
// The frame reads on any photo (white over a soft shadow), its handles
// reach a little past it and grow bolder under the pointer, and what's
// drawn over the photo eases in and out: thirds while resizing, a fine grid
// and an angle ruler while turning, the outside lighter while dragging. A
// quarter turn is seen turning; a new aspect glides the frame into place.
//
// For a closer look at an edge: the loupe shows the corner or edge being
// dragged, close up, in a top corner of the stage; and the wheel, + and −
// zoom the view (see "zoom" below). Both draw from the full-size photo once
// it's needed, since the working copy is only screen-sized.

const CropGeom = {
    rad(deg) { return deg * Math.PI / 180; },

    // A turn q, tilt and mirror m flipped as it's seen: 'h' left to right,
    // 'v' upside down. A flip of what's on screen is the mirror the other
    // way round with the turn and tilt reversed (upside down: half a turn
    // more); the crop (n, in output space) is mirrored with it, when given
    flipped(e, axis) {
        const q = e.q || 0;
        const out = { q: ((axis === 'v' ? 2 - q : -q) % 4 + 4) % 4, angle: e.angle ? -e.angle : 0, m: !e.m };
        const n = e.n;
        if (n) out.n = axis === 'v' ? { x0: n.x0, y0: -n.y1, x1: n.x1, y1: -n.y0 } : { x0: -n.x1, y0: n.y0, x1: -n.x0, y1: n.y1 };
        return out;
    },

    // cos/sin of the total rotation; exact for pure quarter turns so an
    // unstraightened crop is a pixel-exact copy
    cosSin(q, angle) {
        if (angle === 0) return [[1, 0], [0, 1], [-1, 0], [0, -1]][((q % 4) + 4) % 4];
        const phi = this.rad(q * 90 + angle);
        return [Math.cos(phi), Math.sin(phi)];
    },

    // Largest s such that the rect centered at (cx, cy) with half-size
    // (a·s, b·s) lies inside the rotated image (inset by m). Negative when
    // the center itself is outside.
    maxScale(cx, cy, a, b, W, H, cs, m = 0) {
        const [c, s] = cs;
        const hw = W / 2 - m, hh = H / 2 - m;
        const uc = cx * c + cy * s, vc = -cx * s + cy * c;
        let best = Infinity;
        const limit = (pc, pd, half) => {
            if (pd > 1e-12) best = Math.min(best, (half - pc) / pd);
            else if (pd < -1e-12) best = Math.min(best, (half + pc) / -pd);
            else if (Math.abs(pc) > half) best = -1;
        };
        for (const [dx, dy] of [[a, b], [a, -b], [-a, b], [-a, -b]]) {
            limit(uc, dx * c + dy * s, hw);
            limit(vc, -dx * s + dy * c, hh);
        }
        return best;
    },

    fits(r, W, H, cs, m = 0) {
        const a = (r.x1 - r.x0) / 2, b = (r.y1 - r.y0) / 2;
        if (a < 0 || b < 0) return false;
        return this.maxScale((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, a, b, W, H, cs, m) >= 1 - 1e-9;
    },

    scaled(cx, cy, a, b) {
        return { x0: cx - a, y0: cy - b, x1: cx + a, y1: cy + b };
    },

    // Shrink (keeping aspect) and if necessary re-center a rect so it fits.
    fit(r, W, H, cs, m = 0) {
        const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
        const a = (r.x1 - r.x0) / 2, b = (r.y1 - r.y0) / 2;
        const s = this.maxScale(cx, cy, a, b, W, H, cs, m);
        if (s >= 1) return { ...r };
        if (s > 0.2) return this.scaled(cx, cy, a * s, b * s);
        // Center is at (or past) the edge: pull it toward the middle until
        // a reasonably sized rect fits there.
        const want = Math.min(1, this.maxScale(0, 0, a, b, W, H, cs, m)) * 0.6;
        let lo = 0, hi = 1;
        for (let i = 0; i < 30; i++) {
            const mid = (lo + hi) / 2;
            if (this.maxScale(cx * mid, cy * mid, a, b, W, H, cs, m) >= want) lo = mid; else hi = mid;
        }
        const k = Math.min(1, this.maxScale(cx * lo, cy * lo, a, b, W, H, cs, m));
        return this.scaled(cx * lo, cy * lo, a * k, b * k);
    },

    lerp(p, q, t) {
        return {
            x0: p.x0 + (q.x0 - p.x0) * t, y0: p.y0 + (q.y0 - p.y0) * t,
            x1: p.x1 + (q.x1 - p.x1) * t, y1: p.y1 + (q.y1 - p.y1) * t
        };
    },

    // Largest t in [0,1] with lerp(from, to, t) inside the image. Rects
    // inside a convex polygon form a convex set, so bisection is exact.
    reach(from, to, W, H, cs, m) {
        if (this.fits(to, W, H, cs, m)) return 1;
        let lo = 0, hi = 1;
        for (let i = 0; i < 30; i++) {
            const mid = (lo + hi) / 2;
            if (this.fits(this.lerp(from, to, mid), W, H, cs, m)) lo = mid; else hi = mid;
        }
        return lo;
    },

    // Move `from` (which fits) toward `to` as far as the image allows. With
    // slide, leftover motion continues along each axis on its own, so a
    // drag that hits one edge keeps following the pointer along it.
    clampToward(from, to, W, H, cs, m, slide) {
        let r = this.lerp(from, to, this.reach(from, to, W, H, cs, m));
        if (slide) {
            const rx = { ...r, x0: to.x0, x1: to.x1 };
            r = this.lerp(r, rx, this.reach(r, rx, W, H, cs, m));
            const ry = { ...r, y0: to.y0, y1: to.y1 };
            r = this.lerp(r, ry, this.reach(r, ry, W, H, cs, m));
        }
        return r;
    },

    // The turned image's extent across a line: x = at (axis 'x': its top
    // and bottom there) or y = at (axis 'y': its left and right). → [lo, hi]
    // or null outside it. Inset by m, as maxScale is
    extent(axis, at, W, H, cs, m = 0) {
        const [c, s] = cs;
        const hw = W / 2 - m, hh = H / 2 - m;
        // Image space (u, v) → output: x = c·u − s·v, y = s·u + c·v
        const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => ({ x: c * u - s * v, y: s * u + c * v }));
        const a = axis, b = axis === 'x' ? 'y' : 'x';
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < 4; i++) {
            const P = pts[i], Q = pts[(i + 1) % 4];
            if ((P[a] - at) * (Q[a] - at) > 0) continue;
            if (Math.abs(Q[a] - P[a]) < 1e-12) { lo = Math.min(lo, P[b], Q[b]); hi = Math.max(hi, P[b], Q[b]); continue; }
            const t = (at - P[a]) / (Q[a] - P[a]);
            const y = P[b] + t * (Q[b] - P[b]);
            lo = Math.min(lo, y);
            hi = Math.max(hi, y);
        }
        return lo <= hi ? [lo, hi] : null;
    },

    // A side dragged out (handle e, w, n or s) on a turned photo, its
    // opposite side staying put. Where one of its corners meets the photo's
    // slanted edge it doesn't stop: first the crop slides along the side,
    // out of the way, keeping its size; when sliding can't help any more it
    // gets shorter, just enough for the side to keep following the pointer
    // to the photo's edge. Worked out from the start of the drag (target),
    // so dragging back in gives the size back. `reached`: how far it got
    // as it was; → the rect, or null when this gets it no further.
    slideSide(target, handle, reached, W, H, cs, m = 0, minSize = 1) {
        const key = { e: 'x1', w: 'x0', s: 'y1', n: 'y0' }[handle];
        if (!key) return null;
        const out = key === 'x1' || key === 'y1' ? 1 : -1;
        if ((target[key] - reached[key]) * out <= 1e-6) return null;
        const axis = key[0]; // the dragged side runs across this axis
        const across = axis === 'x' ? 'y' : 'x';
        const fixed = target[axis + (key[1] === '1' ? '0' : '1')];
        const eps = 1e-6;
        // The room across, where both the fixed side and the dragged one can be
        const room = (v) => {
            const e1 = this.extent(axis, fixed, W, H, cs, m), e2 = this.extent(axis, v, W, H, cs, m);
            if (!e1 || !e2) return null;
            return [Math.max(e1[0], e2[0]) + eps, Math.min(e1[1], e2[1]) - eps];
        };
        const span = (r) => (r ? r[1] - r[0] : -Infinity);
        // Somewhere the side can be: room enough, and not past the photo's
        // edge facing it. Along the slanted top and bottom the room closes
        // slowly (the crop gets a little shorter as the side goes); the edge
        // the side runs into closes it fast (into the corner's wedge), and
        // that's where it stops: both its corners at the edge
        const band = (v) => {
            const r = room(v);
            if (span(r) < minSize) return null;
            const d = 0.5;
            if ((span(r) - span(room(v + out * d))) / d > 1) return null;
            return r;
        };
        // The side as far out as there's room for (the room shrinks steadily
        // the further out it goes, so a bisection finds the end of it)
        let lo = reached[key], hi = target[key];
        if (band(hi)) lo = hi;
        else {
            if (!band(lo)) return null;
            for (let i = 0; i < 50; i++) {
                const mid = (lo + hi) / 2;
                if (band(mid)) lo = mid; else hi = mid;
            }
        }
        if ((lo - reached[key]) * out <= 1e-6) return null;
        const [a, b] = band(lo);
        // Its size across kept if it fits there (slid as little as it can), else all the room there is
        const p0 = target[across + '0'], p1 = target[across + '1'], size = p1 - p0;
        let q0, q1;
        if (b - a >= size) {
            q0 = Math.min(Math.max(p0, a), b - size);
            q1 = q0 + size;
        } else {
            q0 = a;
            q1 = b;
        }
        return { ...target, [key]: lo, [across + '0']: q0, [across + '1']: q1 };
    },

    // Axis-aligned size of the rotated image
    bounds(W, H, cs) {
        const [c, s] = cs;
        return { w: W * Math.abs(c) + H * Math.abs(s), h: W * Math.abs(s) + H * Math.abs(c) };
    }
};

const CropEditor = {
    // Aspect presets: value is short side / long side; the orientation
    // follows the crop (or is flipped with X). Named by print size.
    ASPECTS: [
        ['free', 'Free', 0],
        ['original', 'Original', -1],
        ['1:1', 'Square 1:1', 1],
        ['2:3', '4×6 · 8×12 (2:3)', 2 / 3],
        ['5:7', '5×7', 5 / 7],
        ['4:5', '8×10 (4:5)', 4 / 5],
        ['11:14', '11×14', 11 / 14],
        ['3:4', '3:4', 3 / 4],
        ['9:16', '16:9', 9 / 16]
    ],
    MAX_ANGLE: 45,
    PAD: 40,       // screen px between the resting crop frame and the stage edge
    MAX_ZOOM: 4,   // the resting view magnifies at most this much past whole-photo fit
    ANIM_MS: 220,
    HISTORY: 100,
    MAX_SCALE: 16,     // zoomed in, at most this many screen px per photo pixel (1600%)
    LOUPE: 220,        // the loupe's side, in screen px, at most
    DETAIL_PX: 48e6,   // the full-size copy for close-ups has at most this many pixels
    // How near (screen px) a side or a corner takes the pointer: further
    // out than in, so the frame's middle stays free for moving the photo,
    // and more for a finger
    GRAB: { side: 14, corner: 22, touch: 1.6 },
    FADE_MS: 160,      // the dimming, guides and angle readout ease in and out this fast
    SPIN_MS: 260,      // a quarter turn, shown turning
    SNAP_DEG: 0.3,     // turning by hand, this close to level is level

    // Curved double arrow, shown outside the frame where dragging rotates
    ROTATE_CURSOR: 'url("data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M5 15a8 8 0 0 1 14 0" stroke="#000" stroke-width="4"/><path d="M3 12l2 3 3-2M21 12l-2 3-3-2" stroke="#000" stroke-width="4"/>' +
        '<path d="M5 15a8 8 0 0 1 14 0" stroke="#fff" stroke-width="2"/><path d="M3 12l2 3 3-2M21 12l-2 3-3-2" stroke="#fff" stroke-width="2"/></svg>'
    ) + '") 12 12, alias',

    isOpen: false,
    busy: false,

    el(id) { return document.getElementById(id); },

    // ---- lifecycle ----

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        this.root = this.el('crop-editor');
        this.canvas = this.el('crop-canvas');
        this.ctx = this.canvas.getContext('2d');

        const aspect = this.el('crop-aspect');
        this.ASPECTS.forEach(([key, label]) => {
            const o = document.createElement('option');
            o.value = key;
            o.textContent = label;
            aspect.appendChild(o);
        });
        aspect.addEventListener('change', () => { this.setAspect(aspect.value); aspect.blur(); });

        const bind = (id, fn) => this.el(id).addEventListener('click', (e) => {
            e.currentTarget.blur(); // keep Enter/Space for the editor's shortcuts
            if (this.busy) return; // saving: the crop being written stays as it is
            fn();
        });
        bind('crop-cancel', () => app.cancelCrop());
        bind('crop-save', () => app.saveCrop());
        bind('crop-save-next', () => app.saveCrop({ next: true }));
        bind('crop-rot-left', () => this.rotateQuarter(-1));
        bind('crop-rot-right', () => this.rotateQuarter(1));
        bind('crop-swap', () => this.swapOrientation());
        bind('crop-level', () => this.toggleLevel());
        bind('crop-auto', () => this.autoDetect());
        bind('crop-auto-each', () => this.setAutoEach(!this.autoEach()));
        bind('crop-previous', () => this.usePrevious());
        bind('crop-reset', () => this.reset());
        bind('crop-loupe', () => this.setLoupe(!this.loupeOn()));
        bind('crop-zoom-in', () => this.zoomBy(1.25));
        bind('crop-zoom-out', () => this.zoomBy(0.8));
        bind('crop-zoom-fit', () => this.fitView());

        const slider = this.el('crop-angle');
        const num = this.el('crop-angle-num');
        slider.addEventListener('input', () => {
            if (!this._sliding) { this.pushHistory(); this._sliding = true; }
            this.setAngle(parseFloat(slider.value), { flash: true });
        });
        slider.addEventListener('change', () => { this._sliding = false; slider.blur(); });
        slider.addEventListener('dblclick', () => this.straighten(0));
        num.addEventListener('change', () => { this.straighten(parseFloat(num.value) || 0); num.blur(); });
        const wheelNudge = (e) => {
            e.preventDefault();
            if (!e.deltaY) return; // a sideways scroll doesn't turn it
            this.nudgeAngle((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
        };
        slider.addEventListener('wheel', wheelNudge, { passive: false });
        num.addEventListener('wheel', wheelNudge, { passive: false });

        const cv = this.canvas;
        cv.addEventListener('pointerdown', (e) => this.onDown(e));
        cv.addEventListener('pointermove', (e) => this.onMove(e));
        cv.addEventListener('pointerup', (e) => this.onUp(e));
        cv.addEventListener('pointercancel', (e) => this.onUp(e));
        cv.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        cv.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll
        // Ctrl/⌘ turns the pointer into the level tool; Space held, a hand
        // that moves the view
        const mod = (e) => {
            if (!this.isOpen) return;
            if (e.key === ' ' && !(e.target && e.target.closest && e.target.closest('input, select, textarea, button'))) {
                this._space = e.type === 'keydown';
                if (this._space) e.preventDefault();
            }
            if (!this.drag) this.updateCursor(e);
        };
        window.addEventListener('keydown', mod);
        window.addEventListener('keyup', mod);
        window.addEventListener('blur', () => { this._space = false; });

        const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
        this.el('crop-tip').textContent =
            `Drag the photo to move it · drag outside the frame to rotate · ${mac ? '⌘' : 'Ctrl'}+drag along a straight line to level it · scroll to zoom`;

        this._resizeObs = new ResizeObserver(() => this.resizeCanvas());
        this._resizeObs.observe(cv.parentElement);
    },

    // How Crop works, said the first three times it opens, then left to
    // the guide (audit M1): it fades after a few seconds each time
    TIP_SEEN: 'jeditor.cropTipSeen',
    showTipOnce() {
        const tip = this.el('crop-tip');
        let seen = 0;
        try { seen = +localStorage.getItem(this.TIP_SEEN) || 0; } catch (e) { /* no storage */ }
        clearTimeout(this._tipFade);
        tip.classList.toggle('crop-tip-done', seen >= 3);
        if (seen >= 3) return;
        try { localStorage.setItem(this.TIP_SEEN, String(seen + 1)); } catch (e) { /* no storage */ }
        this._tipFade = setTimeout(() => tip.classList.add('crop-tip-done'), 8000);
    },

    // Show the editor for `file`. The pixels come from disk, so they always
    // match what is saved (the caller drains any rotation queue first).
    async open(app, file) {
        this.init(app);
        this.file = file;
        this.ready = false;
        this.isOpen = true;
        this.showTipOnce();
        this.level = false;
        this.drag = null;
        this.vw = null;
        this.zoomed = false;
        this.updateZoomUi();
        this.dropDetail();
        this.history = [];
        this.future = [];
        this._auto = null; // what Auto found on this photo (crop-log.js)
        this.root.classList.remove('hidden');
        this.colors = this.themeColors();
        this.el('crop-file').textContent = file.name;
        this.el('crop-dims').textContent = 'Loading…';
        // Edits kept until saved (edits.js): the crop is kept, not written
        const later = Edits.keeps(file);
        this.el('crop-save').textContent = later ? 'Done' : 'Save';
        this.el('crop-save').title = later ? 'Keep this crop; it\'s saved to the file when you save the project\'s edits (Enter)' : 'Save (Enter)';
        this.el('crop-save-next').textContent = later ? 'Done & next' : 'Save & next';
        this.updateButtons();
        this.resizeCanvas();

        // Screen-sized working copy — the viewer's cached preview when there
        // is one (made from the file's current bytes); the full-resolution
        // render happens on save, from the original. Always the whole
        // photo, even with an edit kept until saved (edits.js): that edit
        // is where the crop starts, so it can be changed
        // Closed, or opened again, while this one was loading: it stops
        const token = this._openToken = (this._openToken || 0) + 1;
        const current = () => this.isOpen && this.file === file && this._openToken === token;
        const src = await app.getDisplaySource(file, { raw: true });
        let preview, w, h;
        if (src.isPreview && src.blob) {
            preview = await createImageBitmap(src.blob);
            w = src.w;
            h = src.h;
        } else {
            const data = await app.readImage(file);
            preview = await createImageBitmap(data); // EXIF orientation applied by default
            w = preview.width;
            h = preview.height;
        }
        const data = await app.readImage(file);
        const dpi = ImageMeta.readDpi(new Uint8Array(await data.slice(0, 256 * 1024).arrayBuffer()));
        // Adjusted (adjust.js): shown with its adjustments
        const shownEdit = Edits.get(file);
        const adj = shownEdit && shownEdit.adj;
        // Spots (retouch.js), then the adjustments, then paint (paint.js)
        if (shownEdit && Retouch.needed(shownEdit) && current()) {
            const c = await Retouch.retouched(preview, shownEdit);
            const bmp = await createImageBitmap(c);
            c.width = c.height = 0;
            preview.close();
            preview = bmp;
        }
        if (adj && current()) {
            const shown = await Develop.applyBitmap(preview, adj, { scale: w ? preview.width / w : 1 });
            if (shown !== preview) { preview.close(); preview = shown; }
        }
        if (Paint.has(shownEdit) && current()) {
            const c = document.createElement('canvas');
            c.width = preview.width;
            c.height = preview.height;
            c.getContext('2d').drawImage(preview, 0, 0);
            await Paint.onto(c, shownEdit, null);
            const bmp = await createImageBitmap(c);
            c.width = c.height = 0;
            preview.close();
            preview = bmp;
        }
        if (!current()) { preview.close(); return; }
        if (this.preview && this.preview !== preview && this.preview.close) this.preview.close();
        this.preview = preview;
        this.W = w;
        this.H = h;
        this.dpi = dpi;

        this.q = 0;
        this.m = false;
        this.angle = 0;
        this.aspectKey = this.loadAspect();
        this.landscape = this.W >= this.H;
        this.el('crop-aspect').value = this.aspectKey;
        this.rect = this.fullRect();
        this.applyAspectToRect(this.rect);
        this.ready = true;
        this.syncAngleUi();
        const kept = Edits.get(file);
        if (kept) {
            this.applySnapshot(kept);
            this._auto = kept.auto || null; // batch Auto crop's (crop-log.js)
            this.el('crop-aspect').value = this.aspectKey;
            this.syncAngleUi();
        }
        this.vw = this.homeView();
        if (!kept && this.autoEach()) {
            this.autoDetect({ quiet: true, animate: false });
            this.history = []; // the starting point is the detected crop
        }
        this.render();
    },

    close() {
        this.isOpen = false;
        this.ready = false;
        this.drag = null;
        this.stopPush();
        if (this._anim) cancelAnimationFrame(this._anim);
        this._anim = 0;
        if (this.preview) { this.preview.close(); this.preview = null; }
        this.dropDetail();
        clearTimeout(this._gridTimer);
        if (this._fadeRaf) cancelAnimationFrame(this._fadeRaf);
        this._fadeRaf = 0;
        this._spin = null;
        this._glide = null;
        this.fx = null;
        if (this.root) this.root.classList.add('hidden');
        this.file = null;
    },

    // ---- geometry helpers ----

    cs() { return CropGeom.cosSin(this.q, this.angle); },

    // Mirrored (m: flipped left to right before it's turned): −1, or 1.
    // A flip upside down is kept as a mirror and half a turn (see flip)
    mx() { return this.m ? -1 : 1; },

    // The photo's own centered coordinates → output space, as a canvas
    // transform's [a, b, c, d]: the turn after the mirror
    mat() {
        const [c, s] = this.cs(), k = this.mx();
        return [c * k, s * k, -s, c];
    },

    // Straightened crops stay 1px clear of the edge so resampling never
    // blends in the transparent outside
    margin() { return this.angle === 0 ? 0 : 1; },

    // Size of the image after quarter turns (before straightening)
    turnedDims() {
        return this.q % 2 ? { w: this.H, h: this.W } : { w: this.W, h: this.H };
    },

    // Output space ↔ the upright image's own (centered) coordinates
    toImage(p) {
        const [c, s] = this.cs();
        return { x: this.mx() * (c * p.x + s * p.y), y: -s * p.x + c * p.y };
    },
    fromImage(p) {
        const [c, s] = this.cs(), x = this.mx() * p.x;
        return { x: c * x - s * p.y, y: s * x + c * p.y };
    },

    fullRect() {
        const d = this.turnedDims();
        return CropGeom.fit({ x0: -d.w / 2, y0: -d.h / 2, x1: d.w / 2, y1: d.h / 2 },
            this.W, this.H, this.cs(), this.margin());
    },

    fitRect(r) { return CropGeom.fit(r, this.W, this.H, this.cs(), this.margin()); },

    // The crop the user asked for is remembered as a spot on the photo plus
    // a size; turning the photo re-fits that, so turning back restores it
    setRect(r, { base = true } = {}) {
        this.rect = r;
        if (base) {
            const c = this.toImage({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
            this.base = { c, a: (r.x1 - r.x0) / 2, b: (r.y1 - r.y0) / 2 };
        }
        this.render();
    },

    refit() {
        const b = this.base;
        const c = this.fromImage(b.c);
        this.rect = this.fitRect(CropGeom.scaled(c.x, c.y, b.a, b.b));
    },

    ratio() {
        const entry = this.ASPECTS.find(a => a[0] === this.aspectKey);
        let v = entry ? entry[2] : 0;
        if (v === 0) return 0;
        if (v === -1) {
            const d = this.turnedDims();
            v = Math.min(d.w, d.h) / Math.max(d.w, d.h);
        }
        return this.landscape ? 1 / v : v;
    },

    // Largest rect of the current ratio inside `within`, centered on it
    aspectRect(within) {
        const r = this.ratio();
        if (!r) return { ...within };
        const cw = within.x1 - within.x0, ch = within.y1 - within.y0;
        const w = Math.min(cw, ch * r), h = w / r;
        return CropGeom.scaled((within.x0 + within.x1) / 2, (within.y0 + within.y1) / 2, w / 2, h / 2);
    },

    applyAspectToRect(within) {
        this.setRect(this.fitRect(this.aspectRect(within)));
    },

    // The rect that is actually rendered: whole pixels, snapped inward to
    // the image's pixel grid so unstraightened crops copy pixels exactly.
    outputRect() {
        const r = this.rect;
        const d = this.turnedDims();
        const ox = (d.w / 2) % 1, oy = (d.h / 2) % 1;
        const x0 = Math.ceil(r.x0 - ox - 1e-6) + ox;
        const y0 = Math.ceil(r.y0 - oy - 1e-6) + oy;
        const x1 = Math.max(x0 + 1, Math.floor(r.x1 - ox + 1e-6) + ox);
        const y1 = Math.max(y0 + 1, Math.floor(r.y1 - oy + 1e-6) + oy);
        return { x0, y0, x1, y1, w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
    },

    // Nothing to save: full frame, no rotation of any kind and no flip
    // (mirror: true, a flip doesn't count)
    isIdentity(mirror = false) {
        const o = this.outputRect(), d = this.turnedDims();
        return (mirror || !this.m) && this.angle === 0 && o.w === d.w && o.h === d.h;
    },

    // ---- edit history (Ctrl+Z inside the editor) ----

    state() {
        return {
            q: this.q, m: this.m, angle: this.angle, rect: { ...this.rect },
            base: { ...this.base, c: { ...this.base.c } },
            aspectKey: this.aspectKey, landscape: this.landscape
        };
    },

    sameState(p, q) {
        const r = p.rect, t = q.rect;
        return p.q === q.q && !p.m === !q.m && p.angle === q.angle && p.aspectKey === q.aspectKey && p.landscape === q.landscape &&
            Math.abs(r.x0 - t.x0) < 1e-6 && Math.abs(r.y0 - t.y0) < 1e-6 &&
            Math.abs(r.x1 - t.x1) < 1e-6 && Math.abs(r.y1 - t.y1) < 1e-6;
    },

    // Before each change. Repeats of one kind (a run of nudges) within a
    // second collapse into a single step.
    pushHistory(kind = null) {
        if (!this.ready) return;
        const now = Date.now();
        if (kind && kind === this._histKind && now - this._histTime < 1000) {
            this._histTime = now;
            return;
        }
        this._histKind = kind;
        this._histTime = now;
        this.history.push(this.state());
        if (this.history.length > this.HISTORY) this.history.shift();
        this.future = [];
    },

    // Forget the last step if nothing actually changed (a click, not a drag)
    dropHistoryIfUnchanged() {
        const last = this.history[this.history.length - 1];
        if (last && this.sameState(last, this.state())) this.history.pop();
    },

    restore(st) {
        Object.assign(this, {
            q: st.q, m: !!st.m, angle: st.angle, rect: { ...st.rect },
            base: { ...st.base, c: { ...st.base.c } },
            aspectKey: st.aspectKey, landscape: st.landscape
        });
        this.el('crop-aspect').value = this.aspectKey;
        this._histKind = null;
        this.syncAngleUi();
        this.settle(false);
    },

    undo() {
        if (!this.ready || !this.history.length) return false;
        this.future.push(this.state());
        this.restore(this.history.pop());
        return true;
    },

    redo() {
        if (!this.ready || !this.future.length) return false;
        this.history.push(this.state());
        this.restore(this.future.pop());
        return true;
    },

    // ---- edits ----

    // Turn the photo behind the frame. The frame stays put on screen; the
    // photo pivots on the crop's center and zooms just enough to fill it.
    setAngle(deg, { flash = false } = {}) {
        if (!this.ready || !isFinite(deg)) return;
        deg = Math.max(-this.MAX_ANGLE, Math.min(this.MAX_ANGLE, Math.round(deg * 100) / 100));
        this.angle = Object.is(deg, -0) ? 0 : deg;
        this.refit();
        this.syncAngleUi();
        if (flash) this.flashGrid({ angle: true });
        this.settle(false);
    },

    // A one-off angle change (typed, zeroed): its own undo step
    straighten(deg) {
        this.pushHistory();
        this.setAngle(deg, { flash: true });
        this.dropHistoryIfUnchanged();
    },

    nudgeAngle(delta) {
        this.pushHistory('nudge');
        this.setAngle(Math.round((this.angle + delta) * 10) / 10, { flash: true });
    },

    rotateQuarter(dir) {
        if (!this.ready) return;
        this.pushHistory();
        const from = this.spinFrom();
        this.q = (this.q + (dir > 0 ? 1 : 3)) % 4;
        // Same spot on the photo; the frame's sides swap
        this.base = { c: this.base.c, a: this.base.b, b: this.base.a };
        this.landscape = !this.landscape;
        this.refit();
        this.fitView(false);
        this.spin(from, dir > 0 ? 90 : -90);
    },

    // Upside down: the same crop, turned half way round
    rotateHalf() {
        if (!this.ready) return;
        this.pushHistory();
        const from = this.spinFrom();
        this.q = (this.q + 2) % 4;
        this.refit();
        this.fitView(false);
        this.spin(from, 180);
    },

    // Flipped as it's seen: 'h' left to right, 'v' upside down. The crop
    // stays on the same part of the photo, mirrored with it
    flip(axis) {
        if (!this.ready) return;
        this.pushHistory();
        Object.assign(this, CropGeom.flipped(this, axis));
        this.syncAngleUi();
        this.refit();
        this.fitView(false);
    },

    setAspect(key) {
        if (!this.ready) return;
        this.pushHistory();
        this.aspectKey = key;
        this.el('crop-aspect').value = key;
        try { localStorage.setItem('jeditor.cropAspect', key); } catch (e) { /* private mode */ }
        // Inside the current crop: after Auto, a print size never takes in bed
        const r = this.rect;
        this.landscape = (r.x1 - r.x0) >= (r.y1 - r.y0);
        this.applyAspectToRect(r);
        this.fitView();
    },

    cycleAspect() {
        const i = this.ASPECTS.findIndex(a => a[0] === this.aspectKey);
        this.setAspect(this.ASPECTS[(i + 1) % this.ASPECTS.length][0]);
    },

    loadAspect() {
        try {
            const k = localStorage.getItem('jeditor.cropAspect');
            if (k && this.ASPECTS.some(a => a[0] === k)) return k;
        } catch (e) { /* private mode */ }
        return 'free';
    },

    swapOrientation() {
        if (!this.ready) return;
        this.pushHistory();
        const r = this.rect;
        const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
        const a = (r.x1 - r.x0) / 2, b = (r.y1 - r.y0) / 2;
        this.landscape = b > a;
        this.setRect(this.fitRect(CropGeom.scaled(cx, cy, b, a)));
        this.fitView();
    },

    selectAll() {
        if (!this.ready) return;
        this.pushHistory();
        this.applyAspectToRect(this.fullRect());
        this.fitView();
    },

    reset() {
        if (!this.ready) return;
        this.pushHistory();
        this.q = 0;
        this.m = false;
        this.angle = 0;
        this.level = false;
        this.landscape = this.W >= this.H;
        this.syncAngleUi();
        this.updateButtons();
        this.applyAspectToRect(this.fullRect());
        this.fitView(false);
    },

    toggleLevel() {
        if (!this.ready) return;
        this.level = !this.level;
        this.updateButtons();
        this.render();
    },

    // ---- auto: straighten and crop to the print on a scan ----

    // Auto is an experiment (Settings → Experimental), asked directly: the
    // editor may not have been opened yet (this.app unset)
    autoOn() {
        return typeof Experiments !== 'undefined' && Experiments.on('auto-crop');
    },

    autoEach() {
        if (!this.autoOn()) return false;
        try { return localStorage.getItem('jeditor.cropAutoEach') === '1'; } catch (e) { return false; }
    },

    setAutoEach(on) {
        try { localStorage.setItem('jeditor.cropAutoEach', on ? '1' : '0'); } catch (e) { /* private mode */ }
        this.updateButtons();
        if (on && this.ready) this.autoDetect();
    },

    autoDetect({ quiet = false, animate = true } = {}) {
        if (!this.ready || !this.autoOn()) return false;
        const det = CropAuto.find(this.preview, this.W, this.H);
        if (!det) {
            CropLog.noteAuto(this, null);
            if (!quiet) this.app.showToast('No print edge found — Auto needs a plain scanner border around the photo', 3500);
            return false;
        }
        this.pushHistory();
        this.fitToPrint(det);
        CropLog.noteAuto(this, det);
        this.syncAngleUi();
        this.flashGrid();
        this.fitView(animate);
        if (!quiet) {
            const a = this.angle;
            this.app.showToast(a ? `Straightened ${a > 0 ? '+' : ''}${a.toFixed(1)}° and cropped to the print` : 'Cropped to the print', 2200, null, null, { kind: 'crop' });
        }
        return true;
    },

    // Straighten and crop to the print CropAuto found (no screen updates)
    fitToPrint(det) {
        const angle = Math.max(-this.MAX_ANGLE, Math.min(this.MAX_ANGLE, Math.round(-det.tilt * 100) / 100));
        this.angle = Object.is(angle, -0) ? 0 : angle;
        // The print's corners, straightened: crop to the largest upright
        // rectangle inside them, a hair in from the edge so no bed shows
        const pts = det.corners.map(([x, y]) => this.fromImage({ x: x - this.W / 2, y: y - this.H / 2 }));
        const xs = pts.map(p => p.x).sort((a, b) => a - b);
        const ys = pts.map(p => p.y).sort((a, b) => a - b);
        const inset = 1.5 * det.scale + 0.001 * Math.min(this.W, this.H);
        const print = { x0: xs[1] + inset, x1: xs[2] - inset, y0: ys[1] + inset, y1: ys[2] - inset };
        this.landscape = print.x1 - print.x0 >= print.y1 - print.y0;
        this.setRect(this.fitRect(this.aspectRect(print)));
    },

    // The editor's geometry for one photo, off screen: batch Auto crop
    // works out and renders each crop exactly as the editor would, with
    // the aspect ratio last chosen there
    headless(W, H) {
        const h = Object.create(this);
        Object.assign(h, { W, H, q: 0, m: false, angle: 0, aspectKey: this.loadAspect(), landscape: W >= H, render() { } });
        h.setRect(h.fullRect());
        return h;
    },

    // Remember this crop so the next photo can reuse it (scan batches share
    // borders). Stored relative to the image size.
    snapshot() {
        const d = this.turnedDims();
        const r = this.rect;
        return {
            q: this.q, ...(this.m ? { m: true } : {}), angle: this.angle, aspectKey: this.aspectKey, landscape: this.landscape,
            wide: d.w >= d.h, // the photo's way round, for likeOn
            n: { x0: r.x0 / d.w, y0: r.y0 / d.h, x1: r.x1 / d.w, y1: r.y1 / d.h }
        };
    },

    usePrevious() {
        if (!this.ready) return;
        const snap = this.app.getLastCrop();
        if (!snap) {
            this.app.showToast('No previous crop yet');
            return;
        }
        this.pushHistory();
        this.applySnapshot(snap);
        this.el('crop-aspect').value = this.aspectKey;
        this.syncAngleUi();
        this.fitView(false);
    },

    // Put a snapshot (see above) on this photo: the same turn, tilt and
    // crop, scaled to its size and kept inside it
    applySnapshot(snap) {
        this.q = (((snap.q || 0) % 4) + 4) % 4;
        this.m = !!snap.m;
        this.angle = snap.angle || 0;
        this.aspectKey = snap.aspectKey || 'free';
        this.landscape = !!snap.landscape;
        const d = this.turnedDims();
        const n = snap.n;
        this.setRect({ x0: n.x0 * d.w, y0: n.y0 * d.h, x1: n.x1 * d.w, y1: n.y1 * d.h });
        this.refit();
    },

    // A crop on another W × H photo, the way Lightroom syncs one: the same
    // aspect, frame and straighten, relative to its size. A photo the other
    // way round (portrait for landscape) gets the frame turned with it; it
    // keeps its own quarter turn (q) and flip (m). Off screen, like headless.
    likeOn(W, H, snap, q = 0, m = false) {
        const h = this.headless(W, H);
        h.q = ((q % 4) + 4) % 4;
        h.m = !!m;
        h.angle = Math.max(-this.MAX_ANGLE, Math.min(this.MAX_ANGLE, snap.angle || 0));
        h.aspectKey = snap.aspectKey || 'free';
        h.landscape = !!snap.landscape;
        const d = h.turnedDims();
        let n = snap.n;
        if (typeof snap.wide === 'boolean' && snap.wide !== (d.w >= d.h)) {
            // Turned a quarter clockwise, as Edits.turned does
            n = { x0: -n.y1, y0: n.x0, x1: -n.y0, y1: n.x1 };
            h.landscape = !h.landscape;
        }
        // The ratio kept exactly (a 4 × 6 stays 4 × 6 on any size)
        h.applyAspectToRect({ x0: n.x0 * d.w, y0: n.y0 * d.h, x1: n.x1 * d.w, y1: n.y1 * d.h });
        return h;
    },

    // A snapshot on a W × H photo, off screen (edits kept until saved, see
    // edits.js, are snapshots: they're shown and saved through this)
    fromSnapshot(W, H, snap) {
        const h = this.headless(W, H);
        h.applySnapshot(snap);
        return h;
    },

    // ---- output ----

    // Render the crop at full resolution from the file's own bytes.
    async renderOutput(fileData, type, original = null) {
        const bmp = await this.decodeFor(fileData, type, original);
        try {
            if (bmp.width !== this.W || bmp.height !== this.H) {
                throw new Error('the file changed on disk — reopen crop');
            }
            return this.drawOutput(bmp);
        } finally {
            bmp.close();
        }
    },

    // The crop as it was when Save was pressed (snap, on a W × H photo),
    // whatever happens in the editor while the file is read
    async renderFrozen(fileData, snap, W, H, type, original = null) {
        const bmp = await this.decodeFor(fileData, type, original);
        try {
            if (bmp.width !== W || bmp.height !== H) throw new Error('the file changed on disk — reopen crop');
            return this.fromSnapshot(W, H, snap).drawOutput(bmp);
        } finally {
            bmp.close();
        }
    },

    // EXIF orientation is applied by default ('from-image')
    decodeFor(fileData, type, original) {
        return createImageBitmap(fileData, {
            colorSpaceConversion: ImageMeta.canCarryProfile(type, original) ? 'none' : 'default'
        });
    },

    // The crop of `bmp` (W × H) on a canvas of its own
    drawOutput(bmp) {
        const o = this.outputRect();
        const canvas = document.createElement('canvas');
        canvas.width = o.w;
        canvas.height = o.h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('image too large to process');
        const [a, b, c, d] = this.mat();
        ctx.imageSmoothingEnabled = this.angle !== 0;
        ctx.imageSmoothingQuality = 'high';
        ctx.setTransform(a, b, c, d, -o.x0, -o.y0);
        ctx.drawImage(bmp, -this.W / 2, -this.H / 2);
        return canvas;
    },

    // A snapshot rendered at full resolution from a file's bytes (saving
    // edits kept until saved). Null when it changes nothing.
    async renderSnapshot(fileData, snap, type, original = null) {
        const bmp = await this.decodeFor(fileData, type, original);
        try {
            const ed = this.fromSnapshot(bmp.width, bmp.height, snap);
            const adj = snap.adj && Develop.active(snap.adj);
            if (ed.isIdentity() && !ed.q && !adj && !Paint.has(snap)) return null; // (a flip isn't identity)
            // Spots (retouch.js) on the whole photo, then the crop
            const base = await Retouch.retouched(bmp, snap);
            const canvas = ed.drawOutput(base);
            if (base !== bmp) base.width = base.height = 0;
            // Its adjustments (adjust.js), after the crop
            if (adj) Develop.applyCanvas(canvas, snap.adj, { map: Develop.cropMap(ed, bmp.width, bmp.height) });
            // And paint over it all (paint.js)
            // (a new canvas when Paint's canvas is bigger or smaller)
            const out = await Paint.onto(canvas, snap, ed);
            if (out !== canvas) canvas.width = canvas.height = 0;
            return out;
        } finally {
            bmp.close();
        }
    },

    // ---- view ----

    resizeCanvas() {
        if (!this.canvas) return;
        const box = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.cssW = box.width;
        this.cssH = box.height;
        this.canvas.width = Math.max(1, Math.round(box.width * dpr));
        this.canvas.height = Math.max(1, Math.round(box.height * dpr));
        if (this.ready && !this.drag) this.vw = this.zoomed && this.vw ? this.clampView(this.vw) : this.homeView();
        this.render();
    },

    avail() {
        return { w: Math.max(1, this.cssW - 2 * this.PAD), h: Math.max(1, this.cssH - 2 * this.PAD) };
    },

    // The resting view: the crop centered, as large as the stage allows
    homeView(r = this.rect) {
        const A = this.avail();
        const d = this.turnedDims();
        const cap = Math.min(A.w / d.w, A.h / d.h) * this.MAX_ZOOM;
        const s = Math.min(A.w / Math.max(1e-6, r.x1 - r.x0), A.h / Math.max(1e-6, r.y1 - r.y0), cap);
        return { s, cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 };
    },

    // Glide to the resting view (or jump there). Zoomed, the view stays
    // where it was put
    settle(animate = true) {
        if (this._anim) cancelAnimationFrame(this._anim);
        this._anim = 0;
        // The frame as last drawn glides to the new crop with the view (a
        // new aspect, Swap, Auto), rather than jumping there
        const shown = this._drawn;
        this._glide = null;
        if (this.zoomed && this.vw) {
            this.vw = this.clampView(this.vw);
            this.render();
            return;
        }
        const to = this.homeView();
        const from = this.vw;
        const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!animate || !from || still) {
            this.vw = to;
            this.render();
            return;
        }
        const t0 = performance.now();
        const rFrom = shown && shown.q === this.q && shown.angle === this.angle && shown.m === this.m ? shown.r : null;
        const tick = (now) => {
            if (!this.isOpen) return;
            const t = Math.min(1, (now - t0) / this.ANIM_MS);
            const e = 1 - Math.pow(1 - t, 3);
            this.vw = {
                s: from.s * Math.pow(to.s / from.s, e),
                cx: from.cx + (to.cx - from.cx) * e,
                cy: from.cy + (to.cy - from.cy) * e
            };
            this._glide = rFrom && t < 1 ? CropGeom.lerp(rFrom, this.rect, e) : null;
            this.render();
            this._anim = t < 1 ? requestAnimationFrame(tick) : 0;
        };
        this._anim = requestAnimationFrame(tick);
    },

    // screen = stage center + s · (output − c)
    view() { return this.vw || this.homeView(); },
    toScreen(x, y, v = this.view()) { return { x: this.cssW / 2 + (x - v.cx) * v.s, y: this.cssH / 2 + (y - v.cy) * v.s }; },
    toOutput(sx, sy, v = this.view()) { return { x: v.cx + (sx - this.cssW / 2) / v.s, y: v.cy + (sy - this.cssH / 2) / v.s }; },

    flashGrid({ angle = false } = {}) {
        this.fineGrid = true;
        this._angleShown = angle;
        clearTimeout(this._gridTimer);
        this._gridTimer = setTimeout(() => { this.fineGrid = false; this.render(); }, 900);
    },

    syncAngleUi() {
        const a = this.angle || 0;
        const slider = this.el('crop-angle');
        slider.value = a;
        const pos = 50 + (a / this.MAX_ANGLE) * 50;
        slider.style.setProperty('--lo', Math.min(50, pos) + '%');
        slider.style.setProperty('--hi', Math.max(50, pos) + '%');
        const num = this.el('crop-angle-num');
        if (document.activeElement !== num) num.value = a.toFixed(1);
    },

    updateButtons() {
        this.el('crop-level').classList.toggle('active', !!this.level);
        const each = this.autoEach();
        const eachBtn = this.el('crop-auto-each');
        eachBtn.classList.toggle('active', each);
        eachBtn.setAttribute('aria-pressed', each ? 'true' : 'false');
        this.el('crop-previous').disabled = !this.app.getLastCrop();
        const loupe = this.loupeOn();
        const loupeBtn = this.el('crop-loupe');
        loupeBtn.classList.toggle('active', loupe);
        loupeBtn.setAttribute('aria-pressed', loupe ? 'true' : 'false');
        this.updateHint();
        if (this.canvas) this.canvas.style.cursor = this.level ? 'crosshair' : 'default';
    },

    updateHint() {
        const levelling = !!this.level || !!(this.drag && this.drag.mode === 'level');
        this.el('crop-hint').classList.toggle('hidden', !levelling);
        this.el('crop-tip').classList.toggle('hidden', levelling);
    },

    updateDims() {
        const o = this.outputRect();
        let text = `${o.w} × ${o.h} px`;
        if (this.dpi && this.dpi.x > 0) {
            text += ` · ${(o.w / this.dpi.x).toFixed(2)} × ${(o.h / this.dpi.y).toFixed(2)} in @ ${Math.round(this.dpi.x)} dpi`;
        }
        if (this.angle) text += ` · ${this.angle > 0 ? '+' : ''}${this.angle.toFixed(1)}°`;
        this.el('crop-dims').textContent = text;
    },

    // The canvas can't use CSS variables: resolve the ones it draws with
    // (the color behind photos, the accent, the labels on the photo and
    // the theme's typeface) once per opening
    // A colour as the browser gives it ("rgb(r, g, b)"), light or not
    isLight(css) {
        const m = String(css).match(/[\d.]+/g);
        return !!m && (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 > 0.55;
    },

    themeColors() {
        const probe = document.createElement('span');
        probe.style.display = 'none';
        this.root.appendChild(probe);
        const read = (v, fallback) => {
            probe.style.color = fallback;
            probe.style.color = `var(${v})`;
            return getComputedStyle(probe).color || fallback;
        };
        const colors = {
            bg: read('--surround', '#0b0b0b'), accent: read('--accent-text', '#7aa7ff'),
            // Outside the crop: dimmed on a dark stage, a light veil on a light one
            veil: this.isLight(read('--surround', '#0b0b0b')) ? '236, 236, 239' : '0, 0, 0',
            label: read('--on-photo-bg', 'rgba(0,0,0,0.6)'), labelText: read('--on-photo-text', '#fff'),
            font: getComputedStyle(probe).getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif'
        };
        probe.remove();
        return colors;
    },

    // ---- the overlay's fades ----
    //
    // The dimming, the guides and the angle readout ease toward what the
    // moment calls for instead of popping: thirds while the frame is moved
    // or resized, a fine grid while turning, the outside a little lighter
    // while dragging so there's more to judge by (as in Lightroom and
    // Photos). Each render steps them on and asks for another frame until
    // they've arrived.

    fxTargets() {
        const d = this.drag, mode = d && d.mode;
        const turning = mode === 'rotate' || mode === 'level';
        const fine = this.fineGrid || !!this.level || turning;
        return {
            dim: mode === 'resize' || mode === 'pan' || turning ? 0.5 : 0.66,
            thirds: mode === 'resize' || mode === 'pan' ? 1 : 0,
            fine: fine ? 1 : 0,
            angle: mode === 'rotate' || (this.fineGrid && !mode && this._angleShown) ? 1 : 0
        };
    },

    stepFx() {
        const to = this.fxTargets();
        const now = performance.now();
        const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!this.fx || still) {
            this.fx = { ...to };
        } else {
            const k = 1 - Math.exp(-(now - (this._fxAt || now)) / (this.FADE_MS / 3));
            for (const key in to) {
                const v = this.fx[key] + (to[key] - this.fx[key]) * k;
                this.fx[key] = Math.abs(to[key] - v) < 0.01 ? to[key] : v;
            }
        }
        this._fxAt = now;
        const moving = Object.keys(to).some(key => this.fx[key] !== to[key]);
        if (moving && !this._fadeRaf) {
            this._fadeRaf = requestAnimationFrame(() => { this._fadeRaf = 0; this.render(); });
        }
        if (!moving) this._fxAt = 0;
        return this.fx;
    },

    // ---- a quarter turn, seen turning ----

    // What the screen shows now, to turn from
    spinFrom() {
        return this.ready && !this.zoomed ? { s: this.view().s } : null;
    },

    // The photo and frame were just turned by `deg` (clockwise) about the
    // middle of the stage: show them starting where they were and turning
    // into place, scaling from the old view to the new
    spin(from, deg) {
        const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!from || still || !this.isOpen) { this._spin = null; return; }
        const t0 = performance.now();
        const k0 = from.s / this.view().s;
        const tick = (now) => {
            if (!this.isOpen || !this._spin) return;
            const t = Math.min(1, (now - t0) / this.SPIN_MS);
            const e = 1 - Math.pow(1 - t, 3);
            this._spin = t < 1 ? { rot: -deg * (1 - e) * Math.PI / 180, k: Math.pow(k0, 1 - e), raf: 0 } : null;
            this.render();
            if (this._spin) this._spin.raf = requestAnimationFrame(tick);
        };
        this._spin = { rot: -deg * Math.PI / 180, k: k0, raf: 0 };
        this.render();
        this._spin.raf = requestAnimationFrame(tick);
    },

    render() {
        if (!this.isOpen || !this.canvas) return;
        const colors = this.colors || { bg: '#0b0b0b', accent: '#7aa7ff', label: 'rgba(0,0,0,0.6)', labelText: '#fff', font: 'system-ui, sans-serif' };
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, this.cssW, this.cssH);
        if (!this.ready) return;
        const fx = this.stepFx();

        // CSS pixels, turned about the stage's middle while a quarter turn plays
        const sp = this._spin;
        const base = () => {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (!sp) return;
            ctx.translate(this.cssW / 2, this.cssH / 2);
            ctx.rotate(sp.rot);
            ctx.scale(sp.k, sp.k);
            ctx.translate(-this.cssW / 2, -this.cssH / 2);
        };

        const v = this.view();
        const [c, s] = this.cs();
        base();
        ctx.transform(v.s * c, v.s * s, -v.s * s, v.s * c, this.cssW / 2 - v.cx * v.s, this.cssH / 2 - v.cy * v.s);
        this.drawPhoto(ctx, v.s, this.zoomed);

        // Everything below is in CSS pixels
        base();
        const shown = this._glide || this.rect;
        this._drawn = { r: { ...this.rect }, q: this.q, angle: this.angle, m: this.m };
        const a = this.toScreen(shown.x0, shown.y0, v);
        const b = this.toScreen(shown.x1, shown.y1, v);
        const R = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };

        // Outside the crop, dimmed (far enough out to cover a turning stage)
        const big = Math.hypot(this.cssW, this.cssH) * (sp ? 2 / Math.min(1, sp.k) : 1);
        ctx.fillStyle = `rgba(${colors.veil || '0, 0, 0'}, ${fx.dim})`;
        ctx.beginPath();
        ctx.rect(this.cssW / 2 - big, this.cssH / 2 - big, 2 * big, 2 * big);
        ctx.rect(R.x, R.y, R.w, R.h);
        ctx.fill('evenodd');

        // Guides: a fine grid while straightening, thirds while adjusting.
        // Each line has a faint dark one beside it, so it reads on a pale sky
        const guides = (n, alpha) => {
            if (alpha <= 0) return;
            const path = (off) => {
                ctx.beginPath();
                for (let i = 1; i < n; i++) {
                    const x = Math.round(R.x + (R.w * i) / n) + 0.5 + off;
                    const y = Math.round(R.y + (R.h * i) / n) + 0.5 + off;
                    ctx.moveTo(x, R.y); ctx.lineTo(x, R.y + R.h);
                    ctx.moveTo(R.x, y); ctx.lineTo(R.x + R.w, y);
                }
            };
            ctx.lineWidth = 1;
            path(1);
            ctx.strokeStyle = `rgba(0,0,0,${0.18 * alpha})`;
            ctx.stroke();
            path(0);
            ctx.strokeStyle = `rgba(255,255,255,${(n > 3 ? 0.3 : 0.6) * alpha})`;
            ctx.stroke();
        };
        ctx.save();
        ctx.beginPath();
        ctx.rect(R.x, R.y, R.w, R.h);
        ctx.clip();
        guides(this.FINE_LINES, fx.fine);
        guides(3, fx.thirds * (1 - 0.5 * fx.fine));
        ctx.restore();

        // The frame: a hairline, with a soft dark one outside it
        const fr = { x: Math.round(R.x) + 0.5, y: Math.round(R.y) + 0.5, w: Math.round(R.w) - 1, h: Math.round(R.h) - 1 };
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.strokeRect(fr.x - 1, fr.y - 1, fr.w + 2, fr.h + 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeRect(fr.x, fr.y, fr.w, fr.h);

        if (!this.level) this.drawHandles(ctx, R);

        // Angle readout while turning: the angle, over a short ruler
        if (fx.angle > 0) this.drawAngle(ctx, R, colors, fx.angle);

        // Level line being drawn
        if (this.drag && this.drag.mode === 'level') {
            const p = this.toScreen(this.drag.a.x, this.drag.a.y, v);
            const q = this.toScreen(this.drag.b.x, this.drag.b.y, v);
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
            ctx.setLineDash([]);
            const t = this.levelAngle(this.drag.a, this.drag.b);
            if (t !== null) {
                ctx.font = `600 12px ${colors.font}`;
                ctx.fillStyle = colors.accent;
                ctx.fillText(`${t > 0 ? '+' : ''}${t.toFixed(1)}°`, q.x + 10, q.y - 10);
            }
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.drawLoupe(ctx, v, colors);
        this.updateDims();
        this.updateZoomUi();
    },

    FINE_LINES: 12,

    // Corner brackets and side bars, white over a soft shadow so they read
    // on any photo (dark on a light stage). The one under the pointer (or being dragged) is bolder
    drawHandles(ctx, R) {
        const d = this.drag;
        const hot = d && d.mode === 'resize' ? d.handle : (d ? null : this._hot);
        const L = Math.min(22, R.w / 3, R.h / 3), E = Math.min(14, R.w / 6, R.h / 6);
        const shapes = {
            nw: [[R.x + L, R.y], [R.x, R.y], [R.x, R.y + L]],
            ne: [[R.x + R.w - L, R.y], [R.x + R.w, R.y], [R.x + R.w, R.y + L]],
            sw: [[R.x + L, R.y + R.h], [R.x, R.y + R.h], [R.x, R.y + R.h - L]],
            se: [[R.x + R.w - L, R.y + R.h], [R.x + R.w, R.y + R.h], [R.x + R.w, R.y + R.h - L]],
            n: [[R.x + R.w / 2 - E, R.y], [R.x + R.w / 2 + E, R.y]],
            s: [[R.x + R.w / 2 - E, R.y + R.h], [R.x + R.w / 2 + E, R.y + R.h]],
            w: [[R.x, R.y + R.h / 2 - E], [R.x, R.y + R.h / 2 + E]],
            e: [[R.x + R.w, R.y + R.h / 2 - E], [R.x + R.w, R.y + R.h / 2 + E]]
        };
        // Drawn just outside the frame's line, so they never cover the photo's edge
        const out = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0], nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1] };
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const stroke = (key, width, style) => {
            const [ox, oy] = out[key].map(o => o * (width / 2 - 0.5));
            ctx.beginPath();
            shapes[key].forEach(([x, y], i) => (i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy)));
            ctx.lineWidth = width;
            ctx.strokeStyle = style;
            ctx.stroke();
        };
        // On a light stage (light appearance), dark handles, as white ones
        // would vanish into it
        const light = !!(this.colors && this.colors.veil && this.colors.veil !== '0, 0, 0');
        for (const key in shapes) {
            const w = key === hot ? 5 : 3.5;
            stroke(key, w + 2, light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.22)');
            stroke(key, w, light ? '#1c1c1e' : '#fff');
        }
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
    },

    // The angle, large, over a ruler of degrees that slides under a fixed
    // mark: whole degrees, longer every 5°, level marked; ends fading out
    drawAngle(ctx, R, colors, alpha) {
        const a = this.angle || 0;
        const t = `${a > 0 ? '+' : ''}${a.toFixed(1)}°`;
        const W = Math.min(220, R.w - 24);
        if (W < 80) return;
        const cx = R.x + R.w / 2, top = R.y + 12;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `600 13px ${colors.font}`;
        const tw = ctx.measureText(t).width;
        const boxW = Math.max(W, tw + 24), boxH = 46;
        ctx.fillStyle = colors.label;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx - boxW / 2, top, boxW, boxH, 10); else ctx.rect(cx - boxW / 2, top, boxW, boxH);
        ctx.fill();
        ctx.fillStyle = colors.labelText;
        ctx.textAlign = 'center';
        ctx.fillText(t, cx, top + 18);
        // Ruler: 6 px a degree, ±(W/12)° seen
        const per = 6, base = top + boxH - 8, span = (boxW - 16) / 2;
        for (let deg = Math.ceil(a - span / per); deg <= Math.floor(a + span / per); deg++) {
            const x = cx + (deg - a) * per;
            const fade = 1 - Math.pow(Math.abs(x - cx) / span, 3);
            const len = deg === 0 ? 12 : deg % 5 === 0 ? 8 : 4;
            ctx.globalAlpha = alpha * Math.max(0, fade) * (deg === 0 ? 1 : 0.7);
            ctx.fillStyle = deg === 0 ? colors.accent : colors.labelText;
            ctx.fillRect(Math.round(x) - (deg === 0 ? 1 : 0.5), base - len, deg === 0 ? 2 : 1, len);
        }
        // The fixed mark: where the photo is now
        ctx.globalAlpha = alpha;
        ctx.fillStyle = colors.labelText;
        ctx.beginPath();
        ctx.moveTo(cx - 4, base + 4); ctx.lineTo(cx + 4, base + 4); ctx.lineTo(cx, base - 1);
        ctx.fill();
        ctx.restore();
    },

    // The photo, at `s` screen px per photo pixel, under the transform set.
    // Close up (crisp), pixels bigger than about two on screen are shown as
    // they are, not blurred.
    drawPhoto(ctx, s, crisp = false) {
        const src = this.source(s);
        ctx.imageSmoothingEnabled = !crisp || s * (window.devicePixelRatio || 1) * this.W / src.width < 2;
        ctx.imageSmoothingQuality = 'high';
        if (this.m) ctx.scale(-1, 1); // flipped (the transform set has the turn)
        ctx.drawImage(src, -this.W / 2, -this.H / 2, this.W, this.H);
    },

    // What to draw the photo from at `s`: the working copy, or the full-size
    // one once the working copy would be blown up (and it's in)
    source(s) {
        const need = s * (window.devicePixelRatio || 1) * this.W > this.preview.width * 1.2;
        if (need) this.ensureDetail();
        return need && this.detail ? this.detail : this.preview;
    },

    // The photo at full size for close-ups, read from disk the first time
    // one needs it (once per opening). Very large scans are kept to
    // DETAIL_PX, still far more than the working copy.
    ensureDetail() {
        if (this.detail || this._detailTried || !this.ready) return;
        if (this.preview.width >= this.W * 0.95) return; // the working copy is the photo
        this._detailTried = true;
        const file = this.file, token = this._openToken;
        const current = () => this.isOpen && this.file === file && this._openToken === token;
        (async () => {
            const data = await file.handle.getFile();
            const k = Math.min(1, Math.sqrt(this.DETAIL_PX / (this.W * this.H)));
            let bmp = await createImageBitmap(data, k < 1
                ? { resizeWidth: Math.round(this.W * k), resizeHeight: Math.round(this.H * k), resizeQuality: 'high' }
                : {});
            // Not the photo the editor has (changed on disk, or turned): not used
            if (Math.abs(bmp.width / bmp.height - this.W / this.H) > 0.01) { bmp.close(); return; }
            const edit = Edits.get(file);
            if (edit && Retouch.needed(edit) && current()) {
                // Its perspective and spots (retouch.js), as the working copy's
                const c = await Retouch.retouched(bmp, edit);
                const done = await createImageBitmap(c).finally(() => { bmp.close(); });
                c.width = c.height = 0;
                bmp = done;
            }
            const adj = edit && edit.adj;
            if (adj && current()) {
                // Shown with its adjustments, as the working copy is, or not at all
                const shown = await Develop.applyBitmap(bmp, adj, { scale: bmp.width / this.W }).catch((err) => { bmp.close(); throw err; });
                if (shown !== bmp) { bmp.close(); bmp = shown; }
            }
            if (!current()) { bmp.close(); return; }
            this.detail = bmp;
            this.render();
        })().catch(() => { /* close-ups stay on the working copy */ });
    },

    dropDetail() {
        if (this.detail) this.detail.close();
        this.detail = null;
        this._detailTried = false;
    },

    // ---- loupe: the edge being dragged, close up ----

    loupeOn() {
        try { return localStorage.getItem('jeditor.cropLoupe') !== '0'; } catch (e) { return true; }
    },

    setLoupe(on) {
        try { localStorage.setItem('jeditor.cropLoupe', on ? '1' : '0'); } catch (e) { /* private mode */ }
        this.updateButtons();
        this.render();
    },

    // Where the loupe looks, in output space: the corner being dragged, the
    // spot on the edge across from the pointer, or the end of a level line.
    // null when it isn't showing.
    loupeFocus() {
        const d = this.drag;
        if (!d || !this.loupeOn()) return null;
        if (d.mode === 'level') return d.b;
        if (d.mode !== 'resize') return null;
        const r = this.outputRect(), h = d.handle;
        const P = this.toOutput(this._hover.x, this._hover.y);
        const x = h.includes('w') ? r.x0 : h.includes('e') ? r.x1 : Math.max(r.x0, Math.min(r.x1, P.x));
        const y = h.includes('n') ? r.y0 : h.includes('s') ? r.y1 : Math.max(r.y0, Math.min(r.y1, P.y));
        return { x, y };
    },

    // The loupe's square: a top corner, the other one when the pointer
    // comes near it. null when the stage is too small for one.
    loupeBox() {
        const size = Math.round(Math.min(this.LOUPE, this.cssW * 0.34, this.cssH * 0.45));
        if (size < 96) return null;
        const M = 12, p = this._hover;
        const at = (side) => ({ x: side === 'left' ? M : this.cssW - M - size, y: M, size });
        let b = at(this._loupeSide);
        if (p.x > b.x - 2 * M && p.x < b.x + size + 2 * M && p.y < b.y + size + 2 * M) {
            this._loupeSide = this._loupeSide === 'left' ? 'right' : 'left';
            b = at(this._loupeSide);
        }
        return b;
    },

    // How close the loupe is, in screen px per photo pixel: the photo's own
    // pixels (100%) when that's at least 3× the view, but at most 8 screen
    // px a pixel unless the view itself is near that
    loupeScale(s) {
        return Math.max(s * 2, Math.min(Math.max(s * 3, 1), 8));
    },

    drawLoupe(ctx, v, colors) {
        const F = this.loupeFocus();
        const B = F && this.loupeBox();
        if (!B) return;
        const dpr = window.devicePixelRatio || 1;
        const ls = this.loupeScale(v.s);
        const mx = B.x + B.size / 2, my = B.y + B.size / 2;
        const at = (x, y) => ({ x: mx + (x - F.x) * ls, y: my + (y - F.y) * ls });
        const round = (path) => {
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(B.x, B.y, B.size, B.size, 10); else ctx.rect(B.x, B.y, B.size, B.size);
            if (path) ctx.rect(path.x, path.y, path.w, path.h);
        };

        ctx.save();
        round();
        ctx.clip();
        ctx.fillStyle = colors.bg;
        ctx.fillRect(B.x, B.y, B.size, B.size);
        const [c, s] = this.cs();
        const k = dpr * ls;
        ctx.setTransform(k * c, k * s, -k * s, k * c, dpr * (mx - F.x * ls), dpr * (my - F.y * ls));
        this.drawPhoto(ctx, ls, true);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // The crop as it will be saved (whole pixels): outside it dimmed
        const o = this.outputRect();
        const a = at(o.x0, o.y0), b = at(o.x1, o.y1);
        const R = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
        ctx.fillStyle = `rgba(${colors.veil || '0, 0, 0'}, 0.62)`;
        round(R);
        ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1;
        ctx.strokeRect(R.x, R.y, R.w, R.h);
        if (this.drag.mode === 'level') {
            const p = at(this.drag.a.x, this.drag.a.y), q = at(this.drag.b.x, this.drag.b.y);
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
            ctx.setLineDash([]);
        }

        // How close, in the corner
        const t = `${Math.round(ls * 100)}%`;
        ctx.font = `600 11px ${colors.font}`;
        const tw = ctx.measureText(t).width;
        ctx.fillStyle = colors.label;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(B.x + 8, B.y + B.size - 28, tw + 14, 20, 10); else ctx.rect(B.x + 8, B.y + B.size - 28, tw + 14, 20);
        ctx.fill();
        ctx.fillStyle = colors.labelText;
        ctx.fillText(t, B.x + 15, B.y + B.size - 14);
        ctx.restore();

        // A ring that reads on light and dark photos
        round();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.stroke();
    },

    // ---- zoom: a closer look while cropping ----
    //
    // The view rests on the crop (homeView) and glides back to it after each
    // change. Zoomed (the wheel or a pinch, + and −, or the view moved with
    // Space or the middle button held) it stays where it was put instead,
    // through drags and straightening, until Fit or a change to the whole
    // crop: the aspect, a quarter turn, Auto, Reset, Previous.

    // The view's scale: from the whole photo (or the crop, if that's
    // smaller) up to MAX_SCALE
    scaleLimits() {
        const A = this.avail();
        const b = CropGeom.bounds(this.W, this.H, this.cs());
        const home = this.homeView().s;
        return { min: Math.min(home, A.w / b.w, A.h / b.h), max: Math.max(home, this.MAX_SCALE), home };
    },

    // The middle of the view stays on the photo
    clampView(v) {
        const b = CropGeom.bounds(this.W, this.H, this.cs());
        return {
            s: v.s,
            cx: Math.max(-b.w / 2, Math.min(b.w / 2, v.cx)),
            cy: Math.max(-b.h / 2, Math.min(b.h / 2, v.cy))
        };
    },

    // Zoom by `factor`, keeping the screen point (x, y) where it is. Back
    // across the resting view, it rests there again.
    zoomAt(factor, x = this.cssW / 2, y = this.cssH / 2) {
        if (!this.ready) return;
        const d = this.drag;
        if (d && d.mode !== 'resize' && d.mode !== 'level') return; // those hold on to the view they started with
        if (this._anim) { cancelAnimationFrame(this._anim); this._anim = 0; }
        const v = this.view(), lim = this.scaleLimits();
        const s = Math.max(lim.min, Math.min(lim.max, v.s * factor));
        if (s === v.s) return;
        if (!d && this.zoomed && ((v.s > lim.home) !== (s > lim.home) || Math.abs(s / lim.home - 1) < 0.02)) {
            this.fitView();
            return;
        }
        const P = this.toOutput(x, y, v);
        this.zoomed = true;
        this.vw = this.clampView({ s, cx: P.x - (x - this.cssW / 2) / s, cy: P.y - (y - this.cssH / 2) / s });
        // Mid-drag, the handle stays under the pointer
        if (d && d.mode === 'resize' && d.last) this.dragTo(d.last.p, d.last.shift, d.last.alt);
        else this.render();
    },

    zoomBy(factor) { this.zoomAt(factor); },

    // Back to resting on the crop
    fitView(animate = true) {
        this.zoomed = false;
        this.settle(animate);
    },

    // The wheel (or a trackpad pinch) zooms about the pointer, as in the viewer
    onWheel(e) {
        e.preventDefault();
        if (!this.ready) return;
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;       // lines
        else if (e.deltaMode === 2) dy *= 400; // pages
        dy = Math.max(-300, Math.min(300, dy));
        if (!dy) return;
        const p = this.point(e);
        this.zoomAt(Math.exp(-dy * 0.002), p.x, p.y);
    },

    updateZoomUi() {
        const t = this.zoomed ? `${Math.round(this.view().s * 100)}%` : 'Fit';
        const el = this.el('crop-zoom-fit');
        if (el.textContent !== t) el.textContent = t;
    },

    // ---- pointer interaction ----

    point(e) {
        const r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    },

    // What is under the pointer: a handle ('n','se',…), 'inside' or 'outside'
    hit(p, v = this.view()) {
        const a = this.toScreen(this.rect.x0, this.rect.y0, v);
        const b = this.toScreen(this.rect.x1, this.rect.y1, v);
        const k = this._touch ? this.GRAB.touch : 1;
        const w = b.x - a.x, h = b.y - a.y;
        // Outward the full reach; inward less on a small frame, so there's
        // always a middle to move the photo by
        const side = this.GRAB.side * k, corner = this.GRAB.corner * k;
        const inS = Math.min(side, w / 5, h / 5), inC = Math.min(corner, w / 4, h / 4);
        // d: how far outside the frame on that side (negative: inside)
        const at = (d, reach, inward) => (d >= 0 ? d <= reach : -d <= inward);
        const dl = a.x - p.x, dr = p.x - b.x, dt = a.y - p.y, db = p.y - b.y;
        const cl = at(dl, corner, inC), cr = at(dr, corner, inC), ct = at(dt, corner, inC), cb = at(db, corner, inC);
        if (ct && cl) return 'nw';
        if (ct && cr) return 'ne';
        if (cb && cl) return 'sw';
        if (cb && cr) return 'se';
        const inX = dl < side && dr < side, inY = dt < side && db < side;
        if (at(dt, side, inS) && inX) return 'n';
        if (at(db, side, inS) && inX) return 's';
        if (at(dl, side, inS) && inY) return 'w';
        if (at(dr, side, inS) && inY) return 'e';
        if (dl < 0 && dr < 0 && dt < 0 && db < 0) return 'inside';
        return 'outside';
    },

    // The handle under the pointer, drawn a little bolder
    setHot(h) {
        const hot = h && h !== 'inside' && h !== 'outside' ? h : null;
        if (hot === this._hot) return;
        this._hot = hot;
        this.render();
    },

    CURSORS: {
        nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', inside: 'grab'
    },

    updateCursor(e) {
        if (!this.ready || !this.canvas) return;
        if (this._space) { this.canvas.style.cursor = 'grab'; return; }
        if (this.level || e.ctrlKey || e.metaKey) { this.canvas.style.cursor = 'crosshair'; return; }
        if (!this._hover) return;
        const h = this.hit(this._hover);
        this.canvas.style.cursor = h === 'outside' ? this.ROTATE_CURSOR : this.CURSORS[h];
    },

    onDown(e) {
        // The middle button, or the left with Space held, moves the view
        const moveView = e.button === 1 || (e.button === 0 && this._space);
        if (!this.ready || this.busy || (e.button !== 0 && !moveView)) return;
        // Stop any glide where it is: the frame is where the user sees it
        if (this._anim) { cancelAnimationFrame(this._anim); this._anim = 0; }
        this._glide = null;
        this._spin = null;
        this._touch = e.pointerType === 'touch' || e.pointerType === 'pen';
        const v = { ...this.view() };
        this.vw = v;
        const p = this.point(e);
        this._hover = p;
        this._loupeSide = p.x < this.cssW / 2 ? 'right' : 'left';
        try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
        if (moveView) {
            this.drag = { mode: 'view', v, p };
            this.canvas.style.cursor = 'grabbing';
            return;
        }
        this.pushHistory();
        const r = this.rect;
        if (this.level || e.ctrlKey || e.metaKey) {
            const P = this.toOutput(p.x, p.y, v);
            this.drag = { mode: 'level', a: P, b: P };
            this.updateHint();
        } else {
            const h = this.hit(p, v);
            if (h === 'outside') {
                const c = this.toScreen((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, v);
                this.drag = { mode: 'rotate', centre: c, a0: Math.atan2(p.y - c.y, p.x - c.x), startAngle: this.angle };
            } else if (h === 'inside') {
                this.drag = { mode: 'pan', start: { ...r }, v, p };
                this.canvas.style.cursor = 'grabbing';
            } else {
                this.drag = { mode: 'resize', handle: h, start: { ...r }, p };
            }
        }
        this.render();
    },

    onMove(e) {
        if (!this.ready) return;
        const p = this.point(e);
        this._hover = p;
        if (!this.drag) {
            this._touch = e.pointerType === 'touch' || e.pointerType === 'pen';
            this.updateCursor(e);
            this.setHot(this.level ? null : this.hit(p));
            return;
        }
        this.drag.last = { p, shift: e.shiftKey, alt: e.altKey };
        this.dragTo(p, e.shiftKey, e.altKey);
        if (this.drag.mode === 'resize') this.maybePush();
    },

    dragTo(p, shift, alt) {
        const d = this.drag;
        const v = this.view();
        if (d.mode === 'level') {
            d.b = this.toOutput(p.x, p.y, v);
            this.render();
            return;
        }
        if (d.mode === 'view') {
            this.zoomed = true;
            this.vw = this.clampView({ s: d.v.s, cx: d.v.cx - (p.x - d.p.x) / d.v.s, cy: d.v.cy - (p.y - d.p.y) / d.v.s });
            this.render();
            return;
        }
        if (d.mode === 'rotate') {
            let delta = (Math.atan2(p.y - d.centre.y, p.x - d.centre.x) - d.a0) * 180 / Math.PI;
            delta = ((delta + 540) % 360) - 180;
            // Further from the middle, finer: whole tenths, with a little
            // catch at level so it's easy to find again
            let a = Math.round((d.startAngle + delta) * 10) / 10;
            if (Math.abs(a) < this.SNAP_DEG && (d.startAngle === 0 || Math.abs(d.startAngle) >= this.SNAP_DEG)) a = 0;
            this.setAngle(a);
            return;
        }
        if (d.mode === 'pan') {
            // The photo follows the pointer; the frame stays where it is
            const dx = (p.x - d.p.x) / d.v.s, dy = (p.y - d.p.y) / d.v.s;
            const st = d.start;
            const target = { x0: st.x0 - dx, y0: st.y0 - dy, x1: st.x1 - dx, y1: st.y1 - dy };
            const next = CropGeom.clampToward(this.rect, target, this.W, this.H, this.cs(), this.margin(), true);
            const off = { x: d.v.cx - (st.x0 + st.x1) / 2, y: d.v.cy - (st.y0 + st.y1) / 2 };
            this.vw = { s: d.v.s, cx: (next.x0 + next.x1) / 2 + off.x, cy: (next.y0 + next.y1) / 2 + off.y };
            this.setRect(next);
            return;
        }
        const P = this.toOutput(p.x, p.y, v);
        const minSize = Math.max(1, 24 / v.s);
        // Shift keeps the shape the frame had when the drag began
        const st = d.start;
        const ratio = this.ratio() || (shift ? (st.x1 - st.x0) / (st.y1 - st.y0) : 0);
        const target = this.resizeTarget(st, d.handle, P, minSize, ratio, alt);
        let next = CropGeom.clampToward(this.rect, target, this.W, this.H, this.cs(), this.margin(), !ratio);
        // A side meeting the edge at one corner slides along, rather than stopping
        if (!ratio && !alt && d.handle.length === 1) {
            const slid = CropGeom.slideSide(target, d.handle, next, this.W, this.H, this.cs(), this.margin(), minSize);
            if (slid) next = slid;
        }
        this.setRect(next);
    },

    // Dragging a handle past the edge of the screen zooms out, so the crop
    // can grow beyond what the resting view shows
    // How far past the edge the pointer is pushing (0 when it isn't)
    pushing(p) {
        const h = this.drag.handle, E = this.PAD / 2;
        let over = 0;
        if (h.includes('w')) over = Math.max(over, E - p.x);
        if (h.includes('e')) over = Math.max(over, p.x - (this.cssW - E));
        if (h.includes('n')) over = Math.max(over, E - p.y);
        if (h.includes('s')) over = Math.max(over, p.y - (this.cssH - E));
        return Math.max(0, over);
    },

    maybePush() {
        if (this._push || !this.pushing(this.drag.last.p)) return;
        const tick = () => {
            const d = this.drag;
            if (!d || d.mode !== 'resize' || !this.pushing(d.last.p)) { this._push = 0; return; }
            const v = this.view();
            const A = this.avail();
            const b = CropGeom.bounds(this.W, this.H, this.cs());
            const minS = Math.min(A.w / b.w, A.h / b.h);
            if (v.s <= minS) { this._push = 0; return; }
            // Zoom out about the side opposite the handle, which stays put
            const h = d.handle, st = d.start;
            const ax = h.includes('w') ? st.x1 : h.includes('e') ? st.x0 : (st.x0 + st.x1) / 2;
            const ay = h.includes('n') ? st.y1 : h.includes('s') ? st.y0 : (st.y0 + st.y1) / 2;
            const as = this.toScreen(ax, ay, v);
            // Faster the further past the edge (about 1–4 % a frame)
            const rate = 0.01 + 0.03 * Math.min(1, this.pushing(d.last.p) / this.PAD);
            const s = Math.max(minS, v.s * (1 - rate));
            this.vw = { s, cx: ax - (as.x - this.cssW / 2) / s, cy: ay - (as.y - this.cssH / 2) / s };
            this.dragTo(d.last.p, d.last.shift, d.last.alt);
            this._push = requestAnimationFrame(tick);
        };
        this._push = requestAnimationFrame(tick);
    },

    stopPush() {
        if (this._push) cancelAnimationFrame(this._push);
        this._push = 0;
    },

    onUp(e) {
        const d = this.drag;
        if (!d) return;
        this.drag = null;
        this.stopPush();
        if (e.pointerType !== 'mouse') this._hot = null; // a finger lifted isn't hovering
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        if (d.mode === 'view') {
            this.updateCursor(e);
            return;
        }
        if (d.mode === 'level') {
            const t = this.levelAngle(d.a, d.b);
            this.level = false;
            this.updateButtons();
            if (t !== null) this.setAngle(t, { flash: true });
            else this.render();
            this.dropHistoryIfUnchanged();
            return;
        }
        if (d.mode === 'rotate') this.flashGrid({ angle: true });
        this.dropHistoryIfUnchanged();
        this.updateCursor(e);
        this.settle();
    },

    // The straighten angle that makes the drawn line level (or plumb, if it
    // was drawn closer to vertical). null for a too-short line.
    levelAngle(a, b) {
        const v = this.view();
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.hypot(dx, dy) * v.s < 12) return null;
        let alpha = Math.atan2(dy, dx) * 180 / Math.PI; // (−180, 180]
        if (alpha > 90) alpha -= 180;
        if (alpha <= -90) alpha += 180;                  // (−90, 90]
        const delta = Math.abs(alpha) <= 45 ? -alpha : (alpha > 0 ? 90 - alpha : -90 - alpha);
        const t = Math.round((this.angle + delta) * 100) / 100;
        return Math.max(-this.MAX_ANGLE, Math.min(this.MAX_ANGLE, t));
    },

    // Where a handle drag wants the crop. ratio: keep this width/height;
    // fromCentre (Alt): the opposite side mirrors the dragged one.
    resizeTarget(start, h, P, minSize, ratio = 0, fromCentre = false) {
        const cx = (start.x0 + start.x1) / 2, cy = (start.y0 + start.y1) / 2;
        const horiz = h.includes('w') || h.includes('e'), vert = h.includes('n') || h.includes('s');
        if (fromCentre) {
            let a = (start.x1 - start.x0) / 2, b = (start.y1 - start.y0) / 2;
            if (horiz) a = Math.max(minSize / 2, Math.abs(P.x - cx));
            if (vert) b = Math.max(minSize / 2, Math.abs(P.y - cy));
            if (ratio) {
                if (horiz && vert) { if (a / b > ratio) a = b * ratio; else b = a / ratio; }
                else if (horiz) b = a / ratio;
                else a = b * ratio;
            }
            return CropGeom.scaled(cx, cy, a, b);
        }
        let { x0, y0, x1, y1 } = start;
        if (h.includes('w')) x0 = Math.min(P.x, x1 - minSize);
        if (h.includes('e')) x1 = Math.max(P.x, x0 + minSize);
        if (h.includes('n')) y0 = Math.min(P.y, y1 - minSize);
        if (h.includes('s')) y1 = Math.max(P.y, y0 + minSize);
        if (!ratio) return { x0, y0, x1, y1 };

        if (horiz && vert) {
            // Corner: anchor the opposite corner, keep the ratio
            const ax = h.includes('w') ? start.x1 : start.x0;
            const ay = h.includes('n') ? start.y1 : start.y0;
            let w = x1 - x0, hh = y1 - y0;
            if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
            const sx = h.includes('w') ? -1 : 1, sy = h.includes('n') ? -1 : 1;
            return {
                x0: Math.min(ax, ax + sx * w), x1: Math.max(ax, ax + sx * w),
                y0: Math.min(ay, ay + sy * hh), y1: Math.max(ay, ay + sy * hh)
            };
        }
        // Edge: the other dimension follows, centered
        if (horiz) {
            const hh = (x1 - x0) / ratio;
            return { x0, x1, y0: cy - hh / 2, y1: cy + hh / 2 };
        }
        const w = (y1 - y0) * ratio;
        return { x0: cx - w / 2, x1: cx + w / 2, y0, y1 };
    }
};
