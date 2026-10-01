// Crop & Straighten editor.
//
// Replaces Cropper.js, which never handled straightening well (rotated
// images left empty corners inside the crop) and cropped whatever bitmap
// happened to be on screen — including a stale one after a rotation.
//
// Model: the upright image (W × H, EXIF orientation applied) is centred on
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
// pivots on the crop's centre and zooms in just enough to hide the corners.

const CropGeom = {
    rad(deg) { return deg * Math.PI / 180; },

    // cos/sin of the total rotation; exact for pure quarter turns so an
    // unstraightened crop is a pixel-exact copy
    cosSin(q, angle) {
        if (angle === 0) return [[1, 0], [0, 1], [-1, 0], [0, -1]][((q % 4) + 4) % 4];
        const phi = this.rad(q * 90 + angle);
        return [Math.cos(phi), Math.sin(phi)];
    },

    // Largest s such that the rect centred at (cx, cy) with half-size
    // (a·s, b·s) lies inside the rotated image (inset by m). Negative when
    // the centre itself is outside.
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

    // Shrink (keeping aspect) and if necessary re-centre a rect so it fits.
    fit(r, W, H, cs, m = 0) {
        const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
        const a = (r.x1 - r.x0) / 2, b = (r.y1 - r.y0) / 2;
        const s = this.maxScale(cx, cy, a, b, W, H, cs, m);
        if (s >= 1) return { ...r };
        if (s > 0.2) return this.scaled(cx, cy, a * s, b * s);
        // Centre is at (or past) the edge: pull it toward the middle until
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
            this.nudgeAngle((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
        };
        slider.addEventListener('wheel', wheelNudge, { passive: false });
        num.addEventListener('wheel', wheelNudge, { passive: false });

        const cv = this.canvas;
        cv.addEventListener('pointerdown', (e) => this.onDown(e));
        cv.addEventListener('pointermove', (e) => this.onMove(e));
        cv.addEventListener('pointerup', (e) => this.onUp(e));
        cv.addEventListener('pointercancel', (e) => this.onUp(e));
        // Ctrl/⌘ turns the pointer into the level tool
        const mod = (e) => { if (this.isOpen && !this.drag) this.updateCursor(e); };
        window.addEventListener('keydown', mod);
        window.addEventListener('keyup', mod);

        const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
        this.el('crop-tip').textContent =
            `Drag the photo to move it · drag outside the frame to rotate · ${mac ? '⌘' : 'Ctrl'}+drag along a straight line to level it`;

        this._resizeObs = new ResizeObserver(() => this.resizeCanvas());
        this._resizeObs.observe(cv.parentElement);
    },

    // Show the editor for `file`. The pixels come from disk, so they always
    // match what is saved (the caller drains any rotation queue first).
    async open(app, file) {
        this.init(app);
        this.file = file;
        this.ready = false;
        this.isOpen = true;
        this.level = false;
        this.drag = null;
        this.vw = null;
        this.history = [];
        this.future = [];
        this.root.classList.remove('hidden');
        this.el('crop-file').textContent = file.name;
        this.el('crop-dims').textContent = 'Loading…';
        this.updateButtons();
        this.resizeCanvas();

        // Screen-sized working copy — the viewer's cached preview when there
        // is one (made from the file's current bytes); the full-resolution
        // render happens on save, from the original.
        const src = await app.getDisplaySource(file);
        let preview;
        if (src.isPreview && src.blob) {
            preview = await createImageBitmap(src.blob);
            this.W = src.w;
            this.H = src.h;
        } else {
            const data = await file.handle.getFile();
            preview = await createImageBitmap(data); // EXIF orientation applied by default
            this.W = preview.width;
            this.H = preview.height;
        }
        const data = await file.handle.getFile();
        if (!this.isOpen || this.file !== file) { preview.close(); return; }
        this.preview = preview;
        this.dpi = ImageMeta.readDpi(new Uint8Array(await data.slice(0, 256 * 1024).arrayBuffer()));

        this.q = 0;
        this.angle = 0;
        this.aspectKey = this.loadAspect();
        this.landscape = this.W >= this.H;
        this.el('crop-aspect').value = this.aspectKey;
        this.rect = this.fullRect();
        this.applyAspectToRect(this.rect);
        this.ready = true;
        this.syncAngleUi();
        this.vw = this.homeView();
        if (this.autoEach()) {
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
        clearTimeout(this._gridTimer);
        if (this.root) this.root.classList.add('hidden');
        this.file = null;
    },

    // ---- geometry helpers ----

    cs() { return CropGeom.cosSin(this.q, this.angle); },

    // Straightened crops stay 1px clear of the edge so resampling never
    // blends in the transparent outside
    margin() { return this.angle === 0 ? 0 : 1; },

    // Size of the image after quarter turns (before straightening)
    turnedDims() {
        return this.q % 2 ? { w: this.H, h: this.W } : { w: this.W, h: this.H };
    },

    // Output space ↔ the upright image's own (centred) coordinates
    toImage(p) {
        const [c, s] = this.cs();
        return { x: c * p.x + s * p.y, y: -s * p.x + c * p.y };
    },
    fromImage(p) {
        const [c, s] = this.cs();
        return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
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

    // Largest rect of the current ratio inside `within`, centred on it
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

    // Nothing to save: full frame, no rotation of any kind
    isIdentity() {
        const o = this.outputRect(), d = this.turnedDims();
        return this.angle === 0 && o.w === d.w && o.h === d.h;
    },

    // ---- edit history (Ctrl+Z inside the editor) ----

    state() {
        return {
            q: this.q, angle: this.angle, rect: { ...this.rect },
            base: { ...this.base, c: { ...this.base.c } },
            aspectKey: this.aspectKey, landscape: this.landscape
        };
    },

    sameState(p, q) {
        const r = p.rect, t = q.rect;
        return p.q === q.q && p.angle === q.angle && p.aspectKey === q.aspectKey && p.landscape === q.landscape &&
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
            q: st.q, angle: st.angle, rect: { ...st.rect },
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
    // photo pivots on the crop's centre and zooms just enough to fill it.
    setAngle(deg, { flash = false } = {}) {
        if (!this.ready || !isFinite(deg)) return;
        deg = Math.max(-this.MAX_ANGLE, Math.min(this.MAX_ANGLE, Math.round(deg * 100) / 100));
        this.angle = Object.is(deg, -0) ? 0 : deg;
        this.refit();
        this.syncAngleUi();
        if (flash) this.flashGrid();
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
        this.q = (this.q + (dir > 0 ? 1 : 3)) % 4;
        // Same spot on the photo; the frame's sides swap
        this.base = { c: this.base.c, a: this.base.b, b: this.base.a };
        this.landscape = !this.landscape;
        this.refit();
        this.settle(false);
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
        this.settle();
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
        this.settle();
    },

    selectAll() {
        if (!this.ready) return;
        this.pushHistory();
        this.applyAspectToRect(this.fullRect());
        this.settle();
    },

    reset() {
        if (!this.ready) return;
        this.pushHistory();
        this.q = 0;
        this.angle = 0;
        this.level = false;
        this.landscape = this.W >= this.H;
        this.syncAngleUi();
        this.updateButtons();
        this.applyAspectToRect(this.fullRect());
        this.settle(false);
    },

    toggleLevel() {
        if (!this.ready) return;
        this.level = !this.level;
        this.updateButtons();
        this.render();
    },

    // ---- auto: straighten and crop to the print on a scan ----

    autoEach() {
        try { return localStorage.getItem('jeditor.cropAutoEach') === '1'; } catch (e) { return false; }
    },

    setAutoEach(on) {
        try { localStorage.setItem('jeditor.cropAutoEach', on ? '1' : '0'); } catch (e) { /* private mode */ }
        this.updateButtons();
        if (on && this.ready) this.autoDetect();
    },

    autoDetect({ quiet = false, animate = true } = {}) {
        if (!this.ready) return false;
        const det = CropAuto.detect(this.preview, this.W, this.H);
        if (!det) {
            if (!quiet) this.app.showToast('No print edge found — Auto needs a plain scanner border around the photo', 3500);
            return false;
        }
        this.pushHistory();
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
        this.syncAngleUi();
        this.flashGrid();
        this.settle(animate);
        if (!quiet) {
            const a = this.angle;
            this.app.showToast(a ? `Straightened ${a > 0 ? '+' : ''}${a.toFixed(1)}° and cropped to the print` : 'Cropped to the print', 2200);
        }
        return true;
    },

    // Remember this crop so the next photo can reuse it (scan batches share
    // borders). Stored relative to the image size.
    snapshot() {
        const d = this.turnedDims();
        const r = this.rect;
        return {
            q: this.q, angle: this.angle, aspectKey: this.aspectKey, landscape: this.landscape,
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
        this.q = snap.q || 0;
        this.angle = snap.angle || 0;
        this.aspectKey = snap.aspectKey || 'free';
        this.landscape = !!snap.landscape;
        this.el('crop-aspect').value = this.aspectKey;
        const d = this.turnedDims();
        const n = snap.n;
        this.setRect({ x0: n.x0 * d.w, y0: n.y0 * d.h, x1: n.x1 * d.w, y1: n.y1 * d.h });
        this.refit();
        this.syncAngleUi();
        this.settle(false);
    },

    // ---- output ----

    // Render the crop at full resolution from the file's own bytes.
    async renderOutput(fileData, type, original = null) {
        // EXIF orientation is applied by default ('from-image')
        const bmp = await createImageBitmap(fileData, {
            colorSpaceConversion: ImageMeta.canCarryProfile(type, original) ? 'none' : 'default'
        });
        try {
            if (bmp.width !== this.W || bmp.height !== this.H) {
                throw new Error('the file changed on disk — reopen crop');
            }
            const o = this.outputRect();
            const canvas = document.createElement('canvas');
            canvas.width = o.w;
            canvas.height = o.h;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('image too large to process');
            const [c, s] = this.cs();
            ctx.imageSmoothingEnabled = this.angle !== 0;
            ctx.imageSmoothingQuality = 'high';
            ctx.setTransform(c, s, -s, c, -o.x0, -o.y0);
            ctx.drawImage(bmp, -this.W / 2, -this.H / 2);
            return canvas;
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
        if (this.ready && !this.drag) this.vw = this.homeView();
        this.render();
    },

    avail() {
        return { w: Math.max(1, this.cssW - 2 * this.PAD), h: Math.max(1, this.cssH - 2 * this.PAD) };
    },

    // The resting view: the crop centred, as large as the stage allows
    homeView(r = this.rect) {
        const A = this.avail();
        const d = this.turnedDims();
        const cap = Math.min(A.w / d.w, A.h / d.h) * this.MAX_ZOOM;
        const s = Math.min(A.w / Math.max(1e-6, r.x1 - r.x0), A.h / Math.max(1e-6, r.y1 - r.y0), cap);
        return { s, cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 };
    },

    // Glide to the resting view (or jump there)
    settle(animate = true) {
        if (this._anim) cancelAnimationFrame(this._anim);
        this._anim = 0;
        const to = this.homeView();
        const from = this.vw;
        const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!animate || !from || still) {
            this.vw = to;
            this.render();
            return;
        }
        const t0 = performance.now();
        const tick = (now) => {
            if (!this.isOpen) return;
            const t = Math.min(1, (now - t0) / this.ANIM_MS);
            const e = 1 - Math.pow(1 - t, 3);
            this.vw = {
                s: from.s * Math.pow(to.s / from.s, e),
                cx: from.cx + (to.cx - from.cx) * e,
                cy: from.cy + (to.cy - from.cy) * e
            };
            this.render();
            this._anim = t < 1 ? requestAnimationFrame(tick) : 0;
        };
        this._anim = requestAnimationFrame(tick);
    },

    // screen = stage centre + s · (output − c)
    view() { return this.vw || this.homeView(); },
    toScreen(x, y, v = this.view()) { return { x: this.cssW / 2 + (x - v.cx) * v.s, y: this.cssH / 2 + (y - v.cy) * v.s }; },
    toOutput(sx, sy, v = this.view()) { return { x: v.cx + (sx - this.cssW / 2) / v.s, y: v.cy + (sy - this.cssH / 2) / v.s }; },

    flashGrid() {
        this.fineGrid = true;
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

    render() {
        if (!this.isOpen || !this.canvas) return;
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0b0b0c';
        ctx.fillRect(0, 0, this.cssW, this.cssH);
        if (!this.ready) return;

        const v = this.view();
        const [c, s] = this.cs();
        const k = dpr * v.s;
        ctx.setTransform(k * c, k * s, -k * s, k * c,
            dpr * (this.cssW / 2 - v.cx * v.s), dpr * (this.cssH / 2 - v.cy * v.s));
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.preview, -this.W / 2, -this.H / 2, this.W, this.H);

        // Everything below is in CSS pixels
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const a = this.toScreen(this.rect.x0, this.rect.y0, v);
        const b = this.toScreen(this.rect.x1, this.rect.y1, v);
        const R = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };

        ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
        ctx.beginPath();
        ctx.rect(0, 0, this.cssW, this.cssH);
        ctx.rect(R.x, R.y, R.w, R.h);
        ctx.fill('evenodd');

        // Guides: thirds while adjusting, a fine grid while straightening
        const fine = this.fineGrid || this.level || (this.drag && (this.drag.mode === 'rotate' || this.drag.mode === 'level'));
        const lines = fine ? 12 : (this.drag ? 3 : 0);
        if (lines) {
            ctx.strokeStyle = fine ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 1; i < lines; i++) {
                const x = Math.round(R.x + (R.w * i) / lines) + 0.5;
                const y = Math.round(R.y + (R.h * i) / lines) + 0.5;
                ctx.moveTo(x, R.y); ctx.lineTo(x, R.y + R.h);
                ctx.moveTo(R.x, y); ctx.lineTo(R.x + R.w, y);
            }
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(R.x) + 0.5, Math.round(R.y) + 0.5, Math.round(R.w) - 1, Math.round(R.h) - 1);

        if (!this.level) {
            // Corner brackets and edge bars
            ctx.lineWidth = 3;
            ctx.lineCap = 'square';
            const L = Math.min(20, R.w / 3, R.h / 3);
            ctx.beginPath();
            [[R.x, R.y, 1, 1], [R.x + R.w, R.y, -1, 1], [R.x, R.y + R.h, 1, -1], [R.x + R.w, R.y + R.h, -1, -1]]
                .forEach(([x, y, dx, dy]) => {
                    ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L);
                });
            const mx = R.x + R.w / 2, my = R.y + R.h / 2, E = Math.min(12, R.w / 6, R.h / 6);
            ctx.moveTo(mx - E, R.y); ctx.lineTo(mx + E, R.y);
            ctx.moveTo(mx - E, R.y + R.h); ctx.lineTo(mx + E, R.y + R.h);
            ctx.moveTo(R.x, my - E); ctx.lineTo(R.x, my + E);
            ctx.moveTo(R.x + R.w, my - E); ctx.lineTo(R.x + R.w, my + E);
            ctx.stroke();
        }

        // Angle readout while turning by hand
        if (this.drag && this.drag.mode === 'rotate') {
            const t = `${this.angle > 0 ? '+' : ''}${this.angle.toFixed(1)}°`;
            ctx.font = '600 13px system-ui, sans-serif';
            const tw = ctx.measureText(t).width;
            const bx = R.x + R.w / 2 - tw / 2 - 10, by = R.y + 12;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(bx, by, tw + 20, 24, 12) : ctx.rect(bx, by, tw + 20, 24);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(t, bx + 10, by + 17);
        }

        // Level line being drawn
        if (this.drag && this.drag.mode === 'level') {
            const p = this.toScreen(this.drag.a.x, this.drag.a.y, v);
            const q = this.toScreen(this.drag.b.x, this.drag.b.y, v);
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
            ctx.setLineDash([]);
            const t = this.levelAngle(this.drag.a, this.drag.b);
            if (t !== null) {
                ctx.font = '600 12px system-ui, sans-serif';
                ctx.fillStyle = '#facc15';
                ctx.fillText(`${t > 0 ? '+' : ''}${t.toFixed(1)}°`, q.x + 10, q.y - 10);
            }
        }
        this.updateDims();
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
        const T = 16;
        const nearL = Math.abs(p.x - a.x) <= T, nearR = Math.abs(p.x - b.x) <= T;
        const nearT = Math.abs(p.y - a.y) <= T, nearB = Math.abs(p.y - b.y) <= T;
        const inX = p.x > a.x - T && p.x < b.x + T, inY = p.y > a.y - T && p.y < b.y + T;
        if (nearT && nearL) return 'nw';
        if (nearT && nearR) return 'ne';
        if (nearB && nearL) return 'sw';
        if (nearB && nearR) return 'se';
        if (nearT && inX) return 'n';
        if (nearB && inX) return 's';
        if (nearL && inY) return 'w';
        if (nearR && inY) return 'e';
        if (p.x > a.x && p.x < b.x && p.y > a.y && p.y < b.y) return 'inside';
        return 'outside';
    },

    CURSORS: {
        nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', inside: 'grab'
    },

    updateCursor(e) {
        if (!this.ready || !this.canvas) return;
        if (this.level || e.ctrlKey || e.metaKey) { this.canvas.style.cursor = 'crosshair'; return; }
        if (!this._hover) return;
        const h = this.hit(this._hover);
        this.canvas.style.cursor = h === 'outside' ? this.ROTATE_CURSOR : this.CURSORS[h];
    },

    onDown(e) {
        if (!this.ready || e.button !== 0) return;
        // Stop any glide where it is: the frame is where the user sees it
        if (this._anim) { cancelAnimationFrame(this._anim); this._anim = 0; }
        const v = { ...this.view() };
        this.vw = v;
        const p = this.point(e);
        try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
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
            this.updateCursor(e);
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
        if (d.mode === 'rotate') {
            let delta = (Math.atan2(p.y - d.centre.y, p.x - d.centre.x) - d.a0) * 180 / Math.PI;
            delta = ((delta + 540) % 360) - 180;
            this.setAngle(Math.round((d.startAngle + delta) * 10) / 10);
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
        const next = CropGeom.clampToward(this.rect, target, this.W, this.H, this.cs(), this.margin(), !ratio);
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
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        if (d.mode === 'level') {
            const t = this.levelAngle(d.a, d.b);
            this.level = false;
            this.updateButtons();
            if (t !== null) this.setAngle(t, { flash: true });
            else this.render();
            this.dropHistoryIfUnchanged();
            return;
        }
        if (d.mode === 'rotate') this.flashGrid();
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
        // Edge: the other dimension follows, centred
        if (horiz) {
            const hh = (x1 - x0) / ratio;
            return { x0, x1, y0: cy - hh / 2, y1: cy + hh / 2 };
        }
        const w = (y1 - y0) * ratio;
        return { x0: cx - w / 2, x1: cx + w / 2, y0, y1 };
    }
};
