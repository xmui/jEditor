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
    PAD: 28, // screen px around the image in the editor

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
        bind('crop-previous', () => this.usePrevious());
        bind('crop-reset', () => this.reset());

        const slider = this.el('crop-angle');
        const num = this.el('crop-angle-num');
        slider.addEventListener('input', () => this.setAngle(parseFloat(slider.value), { flash: true }));
        slider.addEventListener('dblclick', () => this.setAngle(0));
        num.addEventListener('change', () => { this.setAngle(parseFloat(num.value) || 0, { flash: true }); num.blur(); });
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
        cv.addEventListener('dblclick', () => { if (!this.level) this.selectAll(); });

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
        this.render();
    },

    close() {
        this.isOpen = false;
        this.ready = false;
        this.drag = null;
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

    fullRect() {
        const d = this.turnedDims();
        return CropGeom.fit({ x0: -d.w / 2, y0: -d.h / 2, x1: d.w / 2, y1: d.h / 2 },
            this.W, this.H, this.cs(), this.margin());
    },

    fitRect(r) { return CropGeom.fit(r, this.W, this.H, this.cs(), this.margin()); },

    setRect(r, { base = true } = {}) {
        this.rect = r;
        if (base) this.base = { ...r }; // what the user asked for, before angle fitting
        this.render();
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
    applyAspectToRect(within) {
        const r = this.ratio();
        let rect = { ...within };
        if (r) {
            const cw = within.x1 - within.x0, ch = within.y1 - within.y0;
            const w = Math.min(cw, ch * r), h = w / r;
            const cx = (within.x0 + within.x1) / 2, cy = (within.y0 + within.y1) / 2;
            rect = CropGeom.scaled(cx, cy, w / 2, h / 2);
        }
        this.setRect(this.fitRect(rect));
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

    // ---- edits ----

    setAngle(deg, { flash = false } = {}) {
        if (!this.ready || !isFinite(deg)) return;
        deg = Math.max(-this.MAX_ANGLE, Math.min(this.MAX_ANGLE, Math.round(deg * 100) / 100));
        this.angle = Object.is(deg, -0) ? 0 : deg;
        // Refit what the user drew, so rotating back restores it
        this.rect = this.fitRect(this.base || this.rect);
        this.syncAngleUi();
        if (flash) this.flashGrid();
        this.render();
    },

    nudgeAngle(delta) {
        this.setAngle(Math.round((this.angle + delta) * 10) / 10, { flash: true });
    },

    rotateQuarter(dir) {
        if (!this.ready) return;
        const turn = (r) => dir > 0
            ? { x0: -r.y1, y0: r.x0, x1: -r.y0, y1: r.x1 }   // (x, y) → (−y, x)
            : { x0: r.y0, y0: -r.x1, x1: r.y1, y1: -r.x0 };  // (x, y) → (y, −x)
        this.q = (this.q + (dir > 0 ? 1 : 3)) % 4;
        this.base = turn(this.base || this.rect);
        this.landscape = !this.landscape;
        this.rect = this.fitRect(this.base);
        this.render();
    },

    setAspect(key) {
        if (!this.ready) return;
        this.aspectKey = key;
        this.el('crop-aspect').value = key;
        try { localStorage.setItem('jeditor.cropAspect', key); } catch (e) { /* private mode */ }
        const r = this.rect;
        this.landscape = (r.x1 - r.x0) >= (r.y1 - r.y0);
        this.applyAspectToRect(r);
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
        const r = this.rect;
        const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
        const a = (r.x1 - r.x0) / 2, b = (r.y1 - r.y0) / 2;
        this.landscape = b > a;
        this.setRect(this.fitRect(CropGeom.scaled(cx, cy, b, a)));
    },

    selectAll() {
        if (!this.ready) return;
        this.applyAspectToRect(this.fullRect());
    },

    reset() {
        if (!this.ready) return;
        this.q = 0;
        this.angle = 0;
        this.level = false;
        this.landscape = this.W >= this.H;
        this.syncAngleUi();
        this.updateButtons();
        this.applyAspectToRect(this.fullRect());
    },

    toggleLevel() {
        if (!this.ready) return;
        this.level = !this.level;
        this.updateButtons();
        this.render();
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
        this.q = snap.q || 0;
        this.angle = snap.angle || 0;
        this.aspectKey = snap.aspectKey || 'free';
        this.landscape = !!snap.landscape;
        this.el('crop-aspect').value = this.aspectKey;
        const d = this.turnedDims();
        const n = snap.n;
        this.base = { x0: n.x0 * d.w, y0: n.y0 * d.h, x1: n.x1 * d.w, y1: n.y1 * d.h };
        this.rect = this.fitRect(this.base);
        this.syncAngleUi();
        this.render();
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
        this.render();
    },

    // screen = origin + scale · output
    view() {
        const b = CropGeom.bounds(this.W, this.H, this.cs());
        const s = Math.max(1e-6, Math.min((this.cssW - 2 * this.PAD) / b.w, (this.cssH - 2 * this.PAD) / b.h));
        return { s, ox: this.cssW / 2, oy: this.cssH / 2 };
    },

    toScreen(x, y, v = this.view()) { return { x: v.ox + x * v.s, y: v.oy + y * v.s }; },
    toOutput(sx, sy, v = this.view()) { return { x: (sx - v.ox) / v.s, y: (sy - v.oy) / v.s }; },

    pointInImage(p) {
        const [c, s] = this.cs();
        const u = p.x * c + p.y * s, w = -p.x * s + p.y * c;
        return Math.abs(u) <= this.W / 2 && Math.abs(w) <= this.H / 2;
    },

    flashGrid() {
        this.fineGrid = true;
        clearTimeout(this._gridTimer);
        this._gridTimer = setTimeout(() => { this.fineGrid = false; this.render(); }, 900);
    },

    syncAngleUi() {
        const a = this.angle || 0;
        this.el('crop-angle').value = a;
        const num = this.el('crop-angle-num');
        if (document.activeElement !== num) num.value = a.toFixed(1);
    },

    updateButtons() {
        this.el('crop-level').classList.toggle('active', !!this.level);
        this.el('crop-hint').classList.toggle('hidden', !this.level);
        this.el('crop-previous').disabled = !this.app.getLastCrop();
        if (this.canvas) this.canvas.style.cursor = this.level ? 'crosshair' : 'default';
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
        ctx.setTransform(k * c, k * s, -k * s, k * c, dpr * v.ox, dpr * v.oy);
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

        // Guides: thirds while dragging, a fine grid while straightening
        const lines = this.fineGrid || this.level ? 12 : (this.drag ? 3 : 0);
        if (lines) {
            ctx.strokeStyle = this.fineGrid || this.level ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.45)';
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
        const T = 14;
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
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', inside: 'move', outside: 'crosshair'
    },

    onDown(e) {
        if (!this.ready || e.button !== 0) return;
        const v = this.view();
        const p = this.point(e);
        const P = this.toOutput(p.x, p.y, v);
        this.canvas.setPointerCapture(e.pointerId);
        if (this.level) {
            this.drag = { mode: 'level', a: P, b: P };
        } else {
            const h = this.hit(p, v);
            if (h === 'outside') {
                if (!this.pointInImage(P)) return;
                this.drag = { mode: 'new', anchor: P, prev: { ...this.rect } };
                this.rect = { x0: P.x, y0: P.y, x1: P.x, y1: P.y };
            } else {
                this.drag = { mode: h === 'inside' ? 'move' : 'resize', handle: h, start: { ...this.rect }, startP: P };
            }
        }
        this.render();
    },

    onMove(e) {
        if (!this.ready) return;
        const v = this.view();
        const p = this.point(e);
        if (!this.drag) {
            this.canvas.style.cursor = this.level ? 'crosshair' : this.CURSORS[this.hit(p, v)];
            return;
        }
        const P = this.toOutput(p.x, p.y, v);
        const d = this.drag;
        if (d.mode === 'level') {
            d.b = P;
            this.render();
            return;
        }
        const minSize = Math.max(1, 12 / v.s);
        let target;
        if (d.mode === 'move') {
            const dx = P.x - d.startP.x, dy = P.y - d.startP.y;
            target = { x0: d.start.x0 + dx, y0: d.start.y0 + dy, x1: d.start.x1 + dx, y1: d.start.y1 + dy };
        } else if (d.mode === 'new') {
            target = this.rectFromAnchor(d.anchor, P, minSize);
        } else {
            target = this.resizeTarget(d.start, d.handle, P, minSize);
        }
        const slide = d.mode === 'move' || !this.ratio();
        const next = CropGeom.clampToward(this.rect, target, this.W, this.H, this.cs(), this.margin(), slide);
        this.setRect(next);
    },

    onUp(e) {
        const d = this.drag;
        if (!d) return;
        this.drag = null;
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        if (d.mode === 'level') {
            const t = this.levelAngle(d.a, d.b);
            this.level = false;
            this.updateButtons();
            if (t !== null) this.setAngle(t, { flash: true });
            else this.render();
            return;
        }
        if (d.mode === 'new') {
            // A click without a drag keeps the previous crop
            const v = this.view();
            if ((this.rect.x1 - this.rect.x0) * v.s < 6 || (this.rect.y1 - this.rect.y0) * v.s < 6) {
                this.setRect(d.prev);
                return;
            }
        }
        this.render();
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

    rectFromAnchor(A, P, minSize) {
        let w = Math.max(minSize, Math.abs(P.x - A.x));
        let h = Math.max(minSize, Math.abs(P.y - A.y));
        const r = this.ratio();
        if (r) { if (w / h > r) w = h * r; else h = w / r; }
        const sx = P.x >= A.x ? 1 : -1, sy = P.y >= A.y ? 1 : -1;
        return {
            x0: Math.min(A.x, A.x + sx * w), x1: Math.max(A.x, A.x + sx * w),
            y0: Math.min(A.y, A.y + sy * h), y1: Math.max(A.y, A.y + sy * h)
        };
    },

    resizeTarget(start, h, P, minSize) {
        let { x0, y0, x1, y1 } = start;
        if (h.includes('w')) x0 = Math.min(P.x, x1 - minSize);
        if (h.includes('e')) x1 = Math.max(P.x, x0 + minSize);
        if (h.includes('n')) y0 = Math.min(P.y, y1 - minSize);
        if (h.includes('s')) y1 = Math.max(P.y, y0 + minSize);
        const r = this.ratio();
        if (!r) return { x0, y0, x1, y1 };

        if (h.length === 2) {
            // Corner: anchor the opposite corner, keep the ratio
            const ax = h.includes('w') ? start.x1 : start.x0;
            const ay = h.includes('n') ? start.y1 : start.y0;
            let w = x1 - x0, hh = y1 - y0;
            if (w / hh > r) w = hh * r; else hh = w / r;
            const sx = h.includes('w') ? -1 : 1, sy = h.includes('n') ? -1 : 1;
            return {
                x0: Math.min(ax, ax + sx * w), x1: Math.max(ax, ax + sx * w),
                y0: Math.min(ay, ay + sy * hh), y1: Math.max(ay, ay + sy * hh)
            };
        }
        // Edge: the other dimension follows, centred
        if (h === 'e' || h === 'w') {
            const cy = (start.y0 + start.y1) / 2, hh = (x1 - x0) / r;
            return { x0, x1, y0: cy - hh / 2, y1: cy + hh / 2 };
        }
        const cx = (start.x0 + start.x1) / 2, w = (y1 - y0) * r;
        return { x0: cx - w / 2, x1: cx + w / 2, y0, y1 };
    }
};
