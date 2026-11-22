// Adjust: looks, light, color, levels, curves, the color mixer, color
// grading and effects (vignette, grain), like
// Lightroom's Develop, on one photo at a time (E, or the sliders button).
// develop.js does the maths; this is the screen. The photo is shown as
// it's being changed (on the GPU, so the sliders keep up on a big scan),
// with its histogram, and Done keeps the settings with the photo: in a
// project, as an edit (edits.js), never in the file, so they can be
// changed again later from the photo as it was; Export, or Save over the
// original, writes the result. Without a project (photos picked on a phone,
// dropped photos) Done writes them into the photo, as a crop does.
//
// The photo is adjusted as it's cropped (an edit's crop is applied
// first), at screen size; saving renders it again at full size.

const Adjust = {
    isOpen: false,
    ready: false,
    file: null,
    a: null,           // the settings being made (Develop.full)
    channel: 'rgb',    // levels and curve: all, or red, green, blue
    mixer: 'hue',      // the color mixer's page: hue, sat, lum
    before: false,

    LIGHT: [['exposure', 'Exposure'], ['contrast', 'Contrast'], ['highlights', 'Highlights'], ['shadows', 'Shadows'], ['whites', 'Whites'], ['blacks', 'Blacks']],
    COLOR: [['temp', 'Temperature'], ['tint', 'Tint'], ['texture', 'Texture'], ['clarity', 'Clarity'], ['dehaze', 'Dehaze'], ['vibrance', 'Vibrance'], ['saturation', 'Saturation']],
    DETAIL: [['sharpen', 'Sharpening'], ['sharpRadius', 'Radius'], ['sharpMask', 'Masking'], ['noise', 'Noise reduction'], ['colorNoise', 'Color noise']],
    EFFECTS: [['vignette', 'Vignette'], ['vigMid', 'Midpoint'], ['vigFeather', 'Feather'], ['vigRound', 'Roundness'], ['grain', 'Grain'], ['grainSize', 'Grain size'], ['grainColor', 'Grain color'], ['halation', 'Halation']],
    TRACKS: {
        temp: 'linear-gradient(to right, #3f7fe0, #9aa3ad, #e0b23f)',
        tint: 'linear-gradient(to right, #3fbf5a, #9aa3ad, #c84fc8)',
        saturation: 'linear-gradient(to right, #8a8a8a, #e5484d)',
        vibrance: 'linear-gradient(to right, #8a8a8a, #f76b15)'
    },
    EDGE: 2560,        // the working copy's longest side, at most
    SAMPLE: 320,       // the histogram's and Auto's copy

    el(id) { return document.getElementById(id); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        this.root = this.el('adjust-editor');
        this.canvas = this.el('adj-canvas');
        this.gl = Develop.renderer(this.canvas);
        if (!this.gl) this.ctx = this.canvas.getContext('2d');

        const bind = (id, fn) => this.el(id).addEventListener('click', (e) => {
            e.currentTarget.blur();
            if (this.busy) return;
            fn();
        });
        bind('adj-before', () => this.toggleBefore());
        // Done, in the file's pill: back to Photos, what's done is kept (Enter)
        bind('adj-done', () => { if (this.ready && !this.busy) Modes.go('photos'); });
        bind('adj-reset', () => this.reset());
        // ⋯: what isn't Before (the plan: extras go in menus, not on bars)
        this.el('adj-more').addEventListener('click', (e) => {
            const b = e.currentTarget;
            if (this.busy) return;
            const r = b.getBoundingClientRect();
            this.app.openContextMenu(this.moreItems(), r.left, r.bottom + 6);
        });
        bind('adj-copy', () => this.copy());
        bind('adj-paste', () => this.paste());
        bind('adj-auto', () => this.auto());
        bind('adj-backlight', () => this.backlight());
        // Restore color is a quick fix in Edit and the first tool in Restore
        bind('adj-restore', () => this.restore());
        bind('adj-restore-fade', () => this.restore());
        bind('adj-restore-fix', () => this.restore(this.foundKind()));
        bind('adj-restore-keep', () => this.restore('keep'));
        this.el('adj-restore-pick').addEventListener('click', (e) => {
            e.currentTarget.blur();
            if (!this.busy) this.pickWhite(this.picking !== 'restore', 'restore');
        });
        // Restore color's strength, under the histogram while it's on
        const restoreRow = this.slider('restoreAmount', 'Restore color', {
            range: { min: 0, max: 100, step: 1, def: 0 },
            get: () => (this.a.restore ? this.a.restore.amount : 0),
            set: (v) => { if (this.a.restore) this.a.restore.amount = v; }
        });
        restoreRow.classList.add('adj-restore-row');
        const sync = restoreRow._sync;
        restoreRow._sync = () => { sync(); restoreRow.classList.toggle('hidden', !this.a.restore); this.syncRestore(); };
        const histBox = this.el('adj-hist').closest('section');
        histBox.insertBefore(restoreRow, histBox.querySelector('.adj-levels-foot'));
        (this.extraRows || (this.extraRows = [])).push(restoreRow);
        this.el('adj-wb-pick').addEventListener('click', (e) => {
            e.preventDefault(); // in the section's head: not to fold it
            e.stopPropagation();
            e.currentTarget.blur();
            if (!this.busy) this.pickWhite(this.picking !== 'wb');
        });
        // Picking white balance: a click on the photo is the grey, before
        // masks, spots or the 1:1 view see it
        this.el('adj-stage').addEventListener('pointerdown', (e) => {
            if (!this.picking || e.button !== 0 || this.space) return;
            e.preventDefault();
            e.stopPropagation();
            if (this.picking === 'level') this.levelFrom(e);
            else this.pickAt(e);
        }, true);
        this.el('adj-presets').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.blur();
            this.presetMenu(r.left, r.bottom + 4);
        });

        this.sliders = {};
        const light = this.el('adj-light'), wb = this.el('adj-wb'), color = this.el('adj-color');
        for (const [k, label] of this.LIGHT) light.appendChild(this.slider(k, label));
        // White balance above Light, Vibrance and Saturation below it, as in Lightroom
        for (const [k, label] of this.COLOR) (k === 'temp' || k === 'tint' ? wb : color).appendChild(this.slider(k, label));
        const detail = this.el('adj-detail');
        for (const [k, label] of this.DETAIL) detail.appendChild(this.slider(k, label));
        // Descreen, in Restore: its sliders once it's on
        const ds = this.el('adj-descreen-tools');
        for (const [k, label] of [['descreen', 'Descreen'], ['screen', 'Dot spacing']]) {
            const row = this.slider(k, label), sync = row._sync;
            row._sync = () => { sync(); ds.classList.toggle('hidden', !this.a.descreen); };
            ds.appendChild(row);
        }
        bind('adj-descreen', () => this.descreen());
        this.initLoupe();
        const effects = this.el('adj-effects');
        for (const [k, label] of this.EFFECTS) effects.appendChild(this.slider(k, label));
        this.initGeo();
        this.el('adj-look-amount').appendChild(this.slider('lookAmount', 'Amount'));
        this.initLookDial();
        const grade = this.el('adj-grade-more');
        grade.appendChild(this.slider('gradeBlend', 'Blending'));
        grade.appendChild(this.slider('gradeBalance', 'Balance'));
        this.initLooks();
        this.initWheels();
        AdjustMasks.init(this);
        AdjustSpots.init(this);
        this.initPanes();
        this.initZoom();
        this.mixerSliders = Develop.HUES.map((h, i) => {
            const row = this.slider(`mix-${h.id}`, h.name, {
                range: { min: -100, max: 100, step: 1 },
                get: () => this.a.hsl[this.mixer][i],
                set: (v) => { this.a.hsl[this.mixer][i] = v; }
            });
            row.style.setProperty('--swatch', h.color);
            row.classList.add('adj-mix-row');
            this.el('adj-mixer').appendChild(row);
            return row;
        });

        // Channel tabs (levels and curve share one choice) and the mixer's
        for (const box of document.querySelectorAll('.adj-chan')) {
            for (const [c, label, title] of [['rgb', 'RGB', 'All channels'], ['r', 'R', 'Red'], ['g', 'G', 'Green'], ['b', 'B', 'Blue']]) {
                const b = document.createElement('button');
                b.className = 'adj-tab';
                b.dataset.chan = c;
                b.textContent = label;
                b.title = title;
                b.setAttribute('role', 'tab');
                b.addEventListener('click', () => { b.blur(); this.channel = c; this.sync(); this.drawPanels(); });
                box.appendChild(b);
            }
        }
        for (const b of this.root.querySelectorAll('.adj-mix-tabs .adj-tab')) {
            b.addEventListener('click', () => { b.blur(); this.mixer = b.dataset.mix; this.sync(); });
        }
        // A section's Reset is in the right-click menu on its heading (on
        // the histogram, for the levels): one Reset per section, not a
        // button on each
        for (const sec of this.root.querySelectorAll('[data-reset]')) {
            const head = sec.querySelector(':scope > summary') || sec;
            head.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.busy) return;
                this.app.openContextMenu([[`Reset ${sec.dataset.resetName}`, () => this.resetSection(sec.dataset.reset)]], e.clientX, e.clientY);
            });
        }

        this.initLevels();
        this.initCurve();
        this._resize = new ResizeObserver(() => { this.viewChanged(); this.drawPanels(); });
        this._resize.observe(this.el('adj-stage'));
        this._resize.observe(this.el('adj-panel'));
    },

    // A slider with its number. opts: { range, get, set } for one that
    // isn't a plain setting
    slider(key, label, opts = {}) {
        const range = opts.range || Develop.SLIDERS[key];
        const get = opts.get || (() => this.a[key]);
        const set = opts.set || ((v) => { this.a[key] = v; });
        const row = document.createElement('div');
        row.className = 'adj-row';
        const id = 'adj-' + key;
        row.innerHTML = `<label class="adj-label" for="${id}"></label>
            <input type="number" class="adj-num field" aria-label="">
            <input type="range" class="adj-range" id="${id}">`;
        const lab = row.querySelector('label'), num = row.querySelector('.adj-num'), input = row.querySelector('.adj-range');
        lab.textContent = label;
        lab.title = 'Double-click to reset';
        num.setAttribute('aria-label', label);
        for (const x of [input, num]) {
            x.min = range.min;
            x.max = range.max;
            x.step = range.step;
        }
        if (this.TRACKS[key]) row.style.setProperty('--track', this.TRACKS[key]);
        const put = (v, { history = true } = {}) => {
            v = Math.min(range.max, Math.max(range.min, v));
            if (history) this.pushHistory();
            set(v);
            this.changed();
        };
        input.addEventListener('input', () => {
            if (!this._sliding) { this.pushHistory(); this._sliding = true; }
            put(parseFloat(input.value), { history: false });
        });
        input.addEventListener('change', () => { this._sliding = false; });
        num.addEventListener('change', () => { put(parseFloat(num.value) || 0); num.blur(); });
        const zero = () => put(range.def || 0);
        lab.addEventListener('dblclick', zero);
        input.addEventListener('dblclick', zero);
        row._sync = () => {
            const v = get();
            input.value = v;
            if (document.activeElement !== num) num.value = range.step < 1 ? v.toFixed(2) : Math.round(v);
            const pos = (x) => ((x - range.min) / (range.max - range.min)) * 100;
            const def = range.def || 0;
            const zeroAt = pos(Math.max(range.min, Math.min(range.max, def)));
            row.style.setProperty('--lo', `${Math.min(zeroAt, pos(v))}%`);
            row.style.setProperty('--hi', `${Math.max(zeroAt, pos(v))}%`);
            row.classList.toggle('changed', v !== def);
        };
        if (!opts.get) this.sliders[key] = row;
        return row;
    },

    // ---- Geometry: straighten (the crop's angle, as Photos' Crop sets it) ----

    initGeo() {
        const angle = this.slider('angle', 'Angle', {
            range: { min: -45, max: 45, step: 0.1 },
            get: () => (this.geo && this.geo.angle) || 0,
            set: (v) => this.applyGeo(this.geoAt(v))
        });
        this.el('adj-geo').appendChild(angle);
        (this.extraRows || (this.extraRows = [])).push(angle);
        // Perspective (retouch.js warps the photo before its spots and crop)
        const persp = [['v', 'Vertical'], ['h', 'Horizontal']].map(([k, label]) => this.slider('persp-' + k, label, {
            range: { min: -Retouch.PERSP_MAX, max: Retouch.PERSP_MAX, step: 1 },
            get: () => (this.a.persp && this.a.persp[k]) || 0,
            set: (v) => { this.a.persp = Retouch.cleanPersp({ ...(this.a.persp || {}), [k]: v }); }
        }));
        this.el('adj-persp').append(...persp);
        this.extraRows.push(...persp);
        // Lens fixes (retouch.js, in the same warp)
        const lens = [['dist', 'Distortion'], ['fringe', 'Fringes'], ['vig', 'Dark corners']].map(([k, label]) => this.slider('lens-' + k, label, {
            range: { min: -Retouch.LENS_MAX, max: Retouch.LENS_MAX, step: 1 },
            get: () => (this.a.lens && this.a.lens[k]) || 0,
            set: (v) => { this.a.lens = Retouch.cleanLens({ ...(this.a.lens || {}), [k]: v }); }
        }));
        this.el('adj-lens').append(...lens);
        this.extraRows.push(...lens);
        this.el('adj-persp-auto').addEventListener('click', (e) => {
            e.currentTarget.blur();
            this.autoPersp();
        });
        this.el('adj-level').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
            if (!this.busy) this.pickWhite(this.picking !== 'level', 'level');
        });
    },

    // The crop's part of an edit (null: the whole photo, as it is)
    geoOf(e, W, H) {
        if (!e || Edits.wholePhoto(e)) return null;
        const g = { q: e.q || 0, angle: e.angle || 0, aspectKey: e.aspectKey || 'free', landscape: !!e.landscape, n: { ...e.n } };
        if (e.m) g.m = true;
        if (typeof e.wide === 'boolean') g.wide = e.wide;
        return g;
    },

    geoChanged() {
        return JSON.stringify(this.geo) !== JSON.stringify(this.geo0);
    },

    // The geometry straightened to `deg`: from the crop it opened with (so
    // dragging the angle there and back gives the same frame back), its
    // frame kept inside the turned photo as Crop keeps it
    geoAt(deg) {
        deg = Math.max(-45, Math.min(45, Math.round(deg * 100) / 100));
        const h = this.turned(this.baseGeo(), Object.is(deg, -0) ? 0 : deg);
        return this.geoOf(h.snapshot(), this.base.width, this.base.height);
    },

    // The crop it opened with, to straighten from; the whole photo (its
    // quarter turn and flip kept) when that crop was only the frame a
    // straighten left, so going back to level gives the whole photo back
    baseGeo() {
        const W = this.base.width, H = this.base.height, g = this.geo0;
        const q = g ? g.q || 0 : 0;
        const whole = { q, ...(g && g.m ? { m: true } : {}), angle: 0, aspectKey: 'free', landscape: q % 2 ? H >= W : W >= H, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } };
        if (!g) return whole;
        const auto = this.turned(whole, g.angle || 0).snapshot().n;
        const same = ['x0', 'y0', 'x1', 'y1'].every(k => Math.abs(auto[k] - g.n[k]) < 1e-3);
        return same ? whole : g;
    },

    // A headless crop of `g`, turned to `deg`, its frame kept inside
    turned(g, deg) {
        const h = CropEditor.fromSnapshot(this.base.width, this.base.height, g);
        h.angle = deg;
        h.refit();
        return h;
    },

    // An edit with this geometry on it (for Save): unchanged when it is
    withGeo(e) {
        if (!this.geoChanged()) return e;
        const out = { ...(e || { q: 0, angle: 0, n: {} }) };
        for (const k of ['q', 'm', 'angle', 'aspectKey', 'landscape', 'wide', 'n']) delete out[k];
        Object.assign(out, this.geo || { q: 0, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } });
        return out;
    },

    // The picture shown as `g` crops it: the frame, the size, the paint
    applyGeo(g) {
        if (!this.base) return;
        this.geo = g;
        const W = this.base.width, H = this.base.height;
        this.cropped = g ? CropEditor.fromSnapshot(W, H, g) : null;
        this.map = Develop.cropMap(this.cropped, W, H);
        const o = this.cropped ? this.cropped.outputRect() : { w: W, h: H };
        this.el('adj-dims').textContent = `${Math.round(o.w * this.fullScale)} × ${Math.round(o.h * this.fullScale)}`;
        this.PW = o.w * this.fullScale;
        this.PH = o.h * this.fullScale;
        this.fullCanvas = this.fullCtx = null;
        this._fullFor = null;
        this.hideSharp();
        this.fitted = true;
        this.view = null;
        this._pictureKey = undefined;
        this.usePicture();
        this.drawPaint(this._painted);
        this.layout();
        AdjustMasks.sync();
        AdjustSpots.sync();
    },

    // Straighten by drawing a line: dragged along something that should be
    // level or upright, the photo turns so it is (Crop's level tool, here)
    levelFrom(e) {
        if (!this.ready) return;
        const a = { x: e.clientX, y: e.clientY };
        this.levelLine(a, a);
        const move = (ev) => this.levelLine(a, { x: ev.clientX, y: ev.clientY });
        const up = (ev) => {
            removeEventListener('pointermove', move, true);
            removeEventListener('pointerup', up, true);
            removeEventListener('pointercancel', up, true);
            this.levelLine(null);
            this.pickWhite(false);
            const t = this.levelAngle(a, { x: ev.clientX, y: ev.clientY });
            if (t === null) return;
            this.pushHistory();
            this.applyGeo(this.geoAt(t));
            this.changed();
        };
        addEventListener('pointermove', move, true);
        addEventListener('pointerup', up, true);
        addEventListener('pointercancel', up, true);
    },

    // The angle that makes the line from a to b (on screen, over the photo
    // as shown) level, or upright if it's nearer that; null when it's too
    // short to tell. As crop.js's levelAngle.
    levelAngle(a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.hypot(dx, dy) < 12) return null;
        let alpha = Math.atan2(dy, dx) * 180 / Math.PI;
        if (alpha > 90) alpha -= 180;
        if (alpha <= -90) alpha += 180;
        const delta = Math.abs(alpha) <= 45 ? -alpha : (alpha > 0 ? 90 - alpha : -90 - alpha);
        const now = (this.geo && this.geo.angle) || 0;
        return Math.max(-45, Math.min(45, Math.round((now + delta) * 100) / 100));
    },

    // The line being drawn, over the photo (null: none)
    levelLine(a, b) {
        let svg = this.el('adj-level-line');
        if (!a) { if (svg) svg.classList.add('hidden'); return; }
        const stage = this.el('adj-stage');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.id = 'adj-level-line';
            svg.classList.add('adj-level-line');
            svg.setAttribute('aria-hidden', 'true');
            svg.innerHTML = '<line class="adj-level-under"/><line class="adj-level-over"/>';
            stage.appendChild(svg);
        }
        svg.classList.remove('hidden');
        const r = stage.getBoundingClientRect();
        for (const l of svg.querySelectorAll('line')) {
            l.setAttribute('x1', a.x - r.left); l.setAttribute('y1', a.y - r.top);
            l.setAttribute('x2', b.x - r.left); l.setAttribute('y2', b.y - r.top);
        }
    },

    // ---- Opening and closing ----

    async open(app, file) {
        this.init(app);
        this.file = file;
        this.ready = false;
        this.isOpen = true;
        this.before = false;
        this.history = [];
        this.future = [];
        const kept = Edits.get(file);
        this.a = Develop.full(kept && kept.adj);
        this.start = JSON.stringify(Develop.clean(this.a));
        this.root.classList.remove('hidden');
        if (typeof Modes !== 'undefined') Modes.arrive(this.root);
        this.el('adj-file').textContent = file.name;
        this.el('adj-dims').textContent = 'Loading…';
        this.sync();

        const token = this._openToken = (this._openToken || 0) + 1;
        const current = () => this.isOpen && this.file === file && this._openToken === token;
        const src = await app.getDisplaySource(file, { raw: true });
        const blob = src.blob || await (await fetch(src.url)).blob();
        let bmp = await createImageBitmap(blob);
        const fullW = src.w || bmp.width;
        if (Math.max(bmp.width, bmp.height) > this.EDGE) {
            const s = this.EDGE / Math.max(bmp.width, bmp.height);
            const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: 'high' });
            bmp.close();
            bmp = small;
        }
        // Another photo opened (or Adjust closed) while this one loaded:
        // nothing of this one's is kept, so the other's picture and crop
        // aren't overwritten
        if (!current()) { bmp.close(); return; }
        const scale = fullW / bmp.width;
        // This working copy's pixels to one of the photo's (detail needs it)
        this.pxScale = 1 / scale;
        this.fullCanvas = this.fullCtx = null;
        this._fullFor = null;
        this.loupeAt = { u: 0.5, v: 0.5 };
        this._detailKey = null;
        // Its crop: adjusted as it will be seen. Masks and spots are placed
        // on the photo before it: the map from one to the other
        this.cropped = kept && !Edits.wholePhoto(kept) ? CropEditor.fromSnapshot(bmp.width, bmp.height, kept) : null;
        // Its geometry (the crop's turn, straighten and frame), changed here
        // by Geometry: as it opened, and as it is now
        this.fullScale = scale;
        this.geo0 = this.geoOf(kept, bmp.width, bmp.height);
        this.geo = this.geo0;
        this.map = Develop.cropMap(this.cropped, bmp.width, bmp.height);
        // The whole working copy, kept: spots are done on it, before the crop
        const base = document.createElement('canvas');
        base.width = bmp.width;
        base.height = bmp.height;
        base.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        this.dropPicture();
        this.raw = this.base = base;
        this._baseKey = 'null';
        // Paint goes over everything (paint.js): shown on top, as it will be
        const painted = Paint.has(kept) ? await Paint.prepare(kept).catch(() => null) : null;
        // Gone stale while its paint was made: only its own canvas is let
        // go (the photo open now may already have its own)
        if (!current()) {
            if (this.base === base) this.dropPicture();
            else base.width = base.height = 0;
            return;
        }
        this._painted = painted;
        const o = this.cropped ? this.cropped.outputRect() : { w: base.width, h: base.height };
        this.el('adj-dims').textContent = `${Math.round(o.w * scale)} × ${Math.round(o.h * scale)}`;
        // The photo's own size, as shown (cropped): what the zoom is of
        this.PW = o.w * scale;
        this.PH = o.h * scale;
        this.fitted = true;
        this.view = null;
        this.hideSharp();
        if (this.gl && this.gl.lost) this.useCpu();
        this.usePicture();
        this.ready = true;
        this.drawPaint(painted);
        this.layout();
        AdjustMasks.reset();
        AdjustSpots.reset();
        this.draw();
    },

    // ---- The picture being adjusted ----
    //
    // The working copy with its spots (and paint) done, then cropped: made
    // again when the spots change. The spots done last are remembered, so
    // adding one, or dragging the one added last, doesn't do them all again.

    dropPicture() {
        if (this.raw && this.raw !== this.base) this.raw.width = this.raw.height = 0;
        for (const k of ['base', '_pre', '_all']) {
            const c = k === 'base' ? this.base : this[k] && this[k].canvas;
            if (c) c.width = c.height = 0;
        }
        this.raw = this.base = null;
        this._baseKey = undefined;
        this._pre = this._all = null;
        this._pictureKey = undefined;
    },

    copyCanvas(src) {
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0);
        return c;
    },

    // The working copy with these spots done (a canvas, not to be changed)
    retouchedBase(spots) {
        const W = this.base.width, H = this.base.height;
        const key = (l) => JSON.stringify(l);
        const all = key(spots);
        if (!spots.length) return this.base;
        if (this._all && this._all.key === all) return this._all.canvas;
        const head = spots.slice(0, -1), headKey = key(head);
        let pre;
        if (this._pre && this._pre.key === headKey) pre = this._pre;
        else if (this._all && this._all.key === headKey) {
            // One added: what was all of them is the start now
            if (this._pre) this._pre.canvas.width = this._pre.canvas.height = 0;
            pre = this._pre = this._all;
            this._all = null;
        } else {
            const c = this.copyCanvas(this.base);
            Retouch.applySpots(c.getContext('2d', { willReadFrequently: true }), W, H, head);
            if (this._pre) this._pre.canvas.width = this._pre.canvas.height = 0;
            pre = this._pre = { key: headKey, canvas: c };
        }
        const c = this._all && this._all.canvas !== pre.canvas ? this._all.canvas : document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(pre.canvas, 0, 0);
        Retouch.applySpot(ctx, W, H, spots[spots.length - 1]);
        this._all = { key: all, canvas: c };
        return c;
    },

    // The picture made again if the spots changed: true when it was
    usePicture() {
        if (!this.base) return false;
        // The working copy warped (perspective), first: the spots are done
        // on it, so they're all done again when it changes
        const persp = Retouch.cleanPersp(this.a.persp), lens = Retouch.cleanLens(this.a.lens);
        const baseKey = JSON.stringify([persp, lens]);
        if (baseKey !== this._baseKey) {
            if (this.base !== this.raw) this.base.width = this.base.height = 0;
            for (const k of ['_pre', '_all']) if (this[k]) this[k].canvas.width = this[k].canvas.height = 0;
            this._pre = this._all = null;
            this.base = persp || lens ? Retouch.warp(this.raw, persp, lens) : this.raw;
            this._baseKey = baseKey;
            this._pictureKey = undefined;
            AdjustSpots._Y = null;
            this.hideSharp();
        }
        const spots = this.a.spots || [];
        const key = JSON.stringify(spots);
        if (key === this._pictureKey) return false;
        this._pictureKey = key;
        const pic = this.retouchedBase(spots);
        const shown = this.cropped ? this.cropped.drawOutput(pic) : pic;
        this.setPicture(shown);
        if (shown !== pic) shown.width = shown.height = 0;
        return true;
    },

    // The photo's paint, over the picture (its own canvas, laid on top)
    drawPaint(prepared) {
        const cv = this.el('adj-paint');
        if (!cv) return;
        cv.classList.toggle('hidden', !prepared);
        if (!prepared) { cv.width = cv.height = 0; return; }
        const o = this.cropped ? this.cropped.outputRect() : { w: this.base.width, h: this.base.height };
        cv.width = Math.max(1, Math.round(o.w));
        cv.height = Math.max(1, Math.round(o.h));
        Paint.composite(cv, prepared, this.cropped);
    },

    placePaint() {
        const cv = this.el('adj-paint');
        if (!cv || cv.classList.contains('hidden') || !this.ready) return;
        const cr = this.canvas.getBoundingClientRect(), sr = this.el('adj-stage').getBoundingClientRect();
        Object.assign(cv.style, { left: `${cr.left - sr.left}px`, top: `${cr.top - sr.top}px`, width: `${cr.width}px`, height: `${cr.height}px` });
    },

    // A canvas: what's adjusted from now on
    setPicture(bmp) {
        this.w = bmp.width;
        this.h = bmp.height;
        this._detailKey = null;
        this._glow = this._hist = null;

        // What the histogram and Auto look at
        const s = Math.min(1, this.SAMPLE / Math.max(bmp.width, bmp.height));
        const sc = document.createElement('canvas');
        sc.width = Math.max(1, Math.round(bmp.width * s));
        sc.height = Math.max(1, Math.round(bmp.height * s));
        const sctx = sc.getContext('2d', { willReadFrequently: true });
        sctx.drawImage(bmp, 0, 0, sc.width, sc.height);
        this.sample = sctx.getImageData(0, 0, sc.width, sc.height).data;
        this.sampleW = sc.width;
        this.sampleH = sc.height;
        this.sampleOut = new Uint8ClampedArray(this.sample.length);

        if (this.gl) {
            this.gl.setImage(bmp);
            // Kept, to do detail on: sharpening and noise show on a small
            // photo (shown at half size or more), descreen on most
            this.srcData = bmp.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, bmp.width, bmp.height);
        } else {
            // No GPU: a smaller working copy, adjusted on the CPU
            const s2 = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
            const c = document.createElement('canvas');
            c.width = Math.round(bmp.width * s2);
            c.height = Math.round(bmp.height * s2);
            const cx = c.getContext('2d', { willReadFrequently: true });
            cx.drawImage(bmp, 0, 0, c.width, c.height);
            this.src = cx.getImageData(0, 0, c.width, c.height);
            this.out = new ImageData(c.width, c.height);
            this.w = c.width;
            this.h = c.height;
        }
    },

    // The GPU went away (or never came): the same on the CPU
    useCpu() {
        const fresh = document.createElement('canvas');
        fresh.id = 'adj-canvas';
        this.canvas.replaceWith(fresh);
        this.canvas = fresh;
        this.gl = null;
        this.ctx = fresh.getContext('2d');
    },

    close() {
        AdjustSync.leave();
        if (this.picking) this.pickWhite(false);
        this.isOpen = false;
        this.ready = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
        this.src = this.out = this.sample = this.sampleOut = this.srcData = null;
        this.dropPicture();
        this.drawPaint(null);
        clearTimeout(this._sharpTimer);
        this.hideSharp();
        this.view = null;
        this.pan = null;
        clearTimeout(this._detailTimer);
        clearTimeout(this._loupeTimer);
        if (this.fullCanvas) this.fullCanvas.width = this.fullCanvas.height = 0;
        this.fullCanvas = this.fullCtx = null;
        this._fullFor = null;
        if (this.root) this.root.classList.add('hidden');
        this.file = null;
    },

    // Settings as kept (null: none)
    result() {
        return Develop.clean(this.a);
    },

    changedSinceOpen() {
        return JSON.stringify(this.result()) !== this.start || this.geoChanged();
    },

    // ---- Changing ----

    changed() {
        this.sync();
        this.schedule();
        AdjustSync.changed();
    },

    // A step: the settings and the geometry (Geometry's straighten)
    state() {
        return JSON.stringify({ a: this.result(), g: this.geo });
    },

    putState(s) {
        const { a, g } = JSON.parse(s);
        if (JSON.stringify(g) !== JSON.stringify(this.geo)) this.applyGeo(g);
        this.setAll(a, { history: false });
    },

    pushHistory() {
        const s = this.state();
        if (this.history[this.history.length - 1] === s) return;
        this.history.push(s);
        if (this.history.length > 200) this.history.shift();
        this.future = [];
    },

    setAll(adj, { history = true } = {}) {
        if (history) this.pushHistory();
        this.a = Develop.full(adj);
        this.changed();
        this.drawPanels();
        AdjustMasks.sync();
        AdjustSpots.sync();
    },

    undo() {
        if (!this.history.length) return false;
        this.future.push(this.state());
        this.putState(this.history.pop());
        return true;
    },

    redo() {
        if (!this.future.length) return false;
        this.history.push(this.state());
        this.putState(this.future.pop());
        return true;
    },

    reset() {
        if (!this.result()) return;
        this.setAll(null);
    },

    resetSection(which) {
        const a = this.result() || {};
        if (which === 'light') for (const [k] of this.LIGHT) delete a[k];
        if (which === 'color') for (const [k] of this.COLOR) delete a[k];
        if (which === 'levels' && a.levels) delete a.levels[this.channel];
        if (which === 'curve' && a.curve) delete a.curve[this.channel];
        if (which === 'mixer') delete a.hsl;
        if (which === 'grading') { delete a.grade; delete a.gradeBlend; delete a.gradeBalance; }
        if (which === 'effects') for (const [k] of this.EFFECTS) delete a[k];
        if (which === 'detail') for (const [k] of this.DETAIL) delete a[k];
        if (which === 'geometry') {
            this.pushHistory();
            this.applyGeo(this.geoAt(0));
            delete a.persp;
            delete a.lens;
            this.setAll(a, { history: false });
            return;
        }
        if (which === 'masks') delete a.masks;
        if (which === 'spots') delete a.spots;
        if (which === 'look' || which === 'basic') { delete a.look; delete a.lookAmount; delete a.lookAdj; delete a.lookName; }
        if (which === 'basic') for (const [k] of [...this.LIGHT, ...this.COLOR]) delete a[k];
        this.setAll(a);
    },

    // Backlight: Shadows up and Highlights down, from the photo
    backlight() {
        if (!this.ready) return;
        this.setAll(Develop.backlight(this.sample, this.result()));
        this.app.showToast('Backlight: the dark part lifted and the bright part held back', 1800, null, null, { kind: 'adjust' });
    },

    // Adjust's ⋯ menu, by its keys as they're set now
    moreItems() {
        const sel = this.app.selection && [...this.app.selection].filter(f => f !== this.file);
        return [
            ['Auto color', () => this.auto({ color: true }), false, undefined, 'adjust.autoColor'],
            ['—'],
            ['Reset all', () => this.reset(), false, undefined, 'adjust.reset'],
            ['Copy settings', () => this.copy(), false, undefined, 'adjust.copy'],
            ...(Adjust.clipboard() ? [['Paste settings', () => this.paste(), false, undefined, 'adjust.paste']] : []),
            ...(sel && sel.length ? [['Sync to selected…', () => AdjustSync.fromAdjust(), false, undefined, 'adjust.sync']] : []),
            ['—'],
            ['Show clipping', () => this.toggleClip(), false, !!this.clip, 'adjust.clip'],
            ['Before and after', () => this.toggleBefore(), false, !!this.before, 'adjust.before'],
            ...(Edits.canKeep() ? [['—'], ['Write edits to file', () => this.app.saveOverOriginal([this.file]), false, undefined, 'adjust.saveOver']] : [])
        ];
    },

    // Show clipping (J): what's lost at white red, at black blue, on the photo
    toggleClip(on = !this.clip) {
        this.clip = on;
        this.app.showToast(on ? 'Clipping shown: lost highlights red, lost shadows blue (J)' : 'Clipping hidden (J)', 1600, 'adj-clip', null, { kind: 'adjust' });
        this.schedule();
    },

    toggleBefore(on = !this.before) {
        this.before = on;
        this.el('adj-before').setAttribute('aria-pressed', String(on));
        this.el('adj-before-tag').classList.toggle('hidden', !on);
        this.schedule();
    },

    auto({ color = false } = {}) {
        if (!this.ready) return;
        this.setAll(Develop.auto(this.sample, this.result(), { colour: color }));
        this.app.showToast(color ? 'Auto color: levels set for each channel' : 'Auto: levels set from the photo', 1600, null, null, { kind: 'adjust' });
    },

    // Auto perspective (retouch.js: autoPersp), from the photo as it is
    // before it's warped (its lens fixed, though), so it gives the same each time
    autoPersp() {
        if (!this.ready || !this.raw) return;
        const lens = Retouch.cleanLens(this.a.lens);
        const src = lens ? Retouch.warp(this.raw, null, lens) : this.raw;
        const p = Retouch.autoPersp(src);
        if (src !== this.raw) src.width = src.height = 0;
        if (!p) {
            this.app.showToast('Auto perspective: no straight lines found to go by', 1800, null, null, { kind: 'adjust' });
            return;
        }
        this.setAll({ ...(this.result() || {}), persp: p });
        this.app.showToast(Retouch.cleanPersp(p) ? 'Auto perspective: the lines made parallel. Straighten levels them if they still lean'
            : 'Auto perspective: the lines are parallel already', 2200, null, null, { kind: 'adjust' });
    },

    // Restore color, from the photo (develop.js: restoreAuto): Auto finds
    // how it faded, or type says (keep: the colours kept). The strength
    // stays where it was set, at full to start with
    restore(type = 'auto') {
        if (!this.ready) return;
        const now = this.a.restore;
        const adj = Develop.restoreAuto(this.sample, this.result(), now ? now.amount : 100, type);
        this.setAll(adj);
        const r = adj.restore;
        const kind = r && Develop.RESTORE_TYPES[r.type];
        const msg = !r ? 'Restore color: nothing to restore'
            : r.type === 'keep' ? (type === 'keep' ? 'Restore color: the colors kept, the light and any stain fixed' : 'Restore color: no colour fade found, so the colours are kept; the light and any stain are fixed')
            : `Restore color: ${kind.name.toLowerCase()} found, its colors brought back`;
        this.app.showToast(msg + '. Restore color\'s slider sets how much', 2600, null, null, { kind: 'adjust' });
    },

    // The kind of fade Auto finds in this photo (not keep)
    foundKind() {
        const m = Develop.restoreMeasure(this.sample);
        const t = m ? Develop.restoreType(m) : 'keep';
        return t === 'keep' ? 'print' : t;
    },

    // Descreen: the dot screen found in the full-size photo (a preview has
    // lost the dots), from up to 1024 px square in its middle, and taken off
    async descreen() {
        if (this._descreening) return;
        this._descreening = true;
        try {
            const full = await this.loadFull();
            if (!full || !this.isOpen) return;
            const w = Math.min(1024, full.width), h = Math.min(1024, full.height);
            const x = Math.round((full.width - w) / 2), y = Math.round((full.height - h) / 2);
            const found = Develop.findScreen(this.fullCtx.getImageData(x, y, w, h).data, w, h);
            if (!found) {
                const on = () => this.setAll({ ...this.result(), descreen: 100 });
                this.app.showToast('Descreen: no printed dot pattern found', 4000, null, this.a.descreen ? null : { label: 'Turn on anyway', run: on }, { kind: 'adjust' });
                return;
            }
            this.setAll({ ...this.result(), descreen: this.a.descreen || 100, screen: found.screen });
            this.app.showToast(`Descreen: dots ${found.screen} px apart found and taken off. Zoom to 100% to see it`, 3000, null, null, { kind: 'adjust' });
        } finally {
            this._descreening = false;
        }
    },

    // The Restore tool's colour options, while Restore color is on
    syncRestore() {
        const r = this.a && this.a.restore;
        const box = this.el('adj-restore-opts');
        if (!box) return;
        box.classList.toggle('hidden', !(r && r.d));
        if (!(r && r.d)) return;
        const keep = r.type === 'keep';
        this.el('adj-restore-fix').setAttribute('aria-pressed', String(!keep));
        this.el('adj-restore-keep').setAttribute('aria-pressed', String(keep));
        const kind = Develop.RESTORE_TYPES[r.type];
        const roll = r.roll ? `, with the roll of ${r.roll} photos` : '';
        this.el('adj-restore-found').textContent = r.grey ? 'Set from the gray you picked'
            : keep ? (r.auto ? 'No color fade found' + roll : '') : `Found: ${kind.name.toLowerCase()}${roll}`;
    },

    // White balance from the photo (W): click something that should be
    // white or grey, and Temperature and Tint make it so
    // kind 'restore': the grey sets Restore color instead (the Restore tool)
    pickWhite(on = !this.picking, kind = 'wb') {
        if (on && !this.ready) return;
        this.picking = on ? kind : false;
        // W shows the button it presses: Edit, with Basic open
        if (on && kind === 'wb') { this.showPane('edit'); this.el('adj-basic-sec').open = true; }
        this.root.classList.toggle('adj-picking', !!on);
        this.el('adj-wb-pick').setAttribute('aria-pressed', String(this.picking === 'wb'));
        this.el('adj-restore-pick').setAttribute('aria-pressed', String(this.picking === 'restore'));
        this.el('adj-level').setAttribute('aria-pressed', String(this.picking === 'level'));
        if (!on) this.levelLine(null);
        if (on) this.app.showToast(kind === 'level' ? 'Drag along something that should be level or upright (Esc to stop)' : kind === 'restore' ? 'Click something that should be gray (Esc to stop)' : 'Click something that should be white or gray (Esc to stop)', 2400, null, null, { kind: 'adjust' });
    },

    pickAt(e) {
        const r = this.canvas.getBoundingClientRect();
        const a = (e.clientX - r.left) / r.width, b = (e.clientY - r.top) / r.height;
        if (a < 0 || a > 1 || b < 0 || b > 1) return;
        // On the photo before its crop, with its spots done, unadjusted
        const m = this.map.m;
        const pic = this.retouchedBase(this.a.spots || []);
        const W = pic.width, H = pic.height;
        const x = Math.round((m[0] * a + m[1] * b + m[2]) * W), y = Math.round((m[3] * a + m[4] * b + m[5]) * H);
        const k = Math.max(2, Math.round(Math.max(W, H) / 400));
        const x0 = Math.max(0, x - k), y0 = Math.max(0, y - k);
        const x1 = Math.min(W, x + k + 1), y1 = Math.min(H, y + k + 1);
        if (x1 <= x0 || y1 <= y0) return;
        const px = pic.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, x1 - x0, y1 - y0).data;
        if (this.picking === 'restore') return this.pickRestore(px);
        const wb = Develop.neutralWB(px);
        if (!wb) {
            this.app.showToast('That\'s too bright or too dark to tell: click a light gray', 2400, null, null, { kind: 'adjust' });
            return;
        }
        this.pickWhite(false);
        this.pushHistory();
        this.a.temp = wb.temp;
        this.a.tint = wb.tint;
        this.changed();
        this.app.showToast(`White balance: Temperature ${wb.temp}, Tint ${wb.tint}`, 1600, null, null, { kind: 'adjust' });
    },

    // Restore color from a grey the user clicked (px: the pixels round it):
    // Restore color is worked out first if it's off
    pickRestore(px) {
        const base = this.a.restore && this.a.restore.d ? this.result() : Develop.restoreAuto(this.sample, this.result());
        const r = Develop.restoreNeutral(base.restore, px);
        if (!r) {
            this.app.showToast('That\'s too light or too dark to tell: click a mid gray', 2400, null, null, { kind: 'adjust' });
            return;
        }
        this.pickWhite(false);
        this.setAll({ ...base, restore: r });
        this.app.showToast('Restore color: set from that gray', 1600, null, null, { kind: 'adjust' });
    },

    // Settings to put on another photo: its spots are its own
    portable(adj) {
        const c = Develop.clean(adj);
        if (c) delete c.spots;
        return c && Object.keys(c).length ? c : null;
    },

    // Other settings, this photo's spots kept
    withOwnSpots(adj) {
        const spots = this.a && this.a.spots && this.a.spots.length ? this.a.spots : null;
        return spots ? { ...(adj || {}), spots } : adj;
    },

    // Copied settings, for this photo or others (Ctrl+Shift+C / V)
    clipboard() {
        if (this._clip === undefined) {
            try { this._clip = JSON.parse(localStorage.getItem('jeditor.adjustCopy') || 'null'); } catch (e) { this._clip = null; }
            if (this._clip && typeof this._clip === 'object' && 'adj' in this._clip) this._clip = { adj: this.portable(this._clip.adj) };
            else this._clip = null;
        }
        return this._clip;
    },

    remember(adj) {
        this._clip = { adj: this.portable(adj) };
        try { localStorage.setItem('jeditor.adjustCopy', JSON.stringify(this._clip)); } catch (e) { /* private mode */ }
    },

    copy() {
        this.remember(this.result());
        this.app.showToast('Copied the adjustments', 1400, null, null, { kind: 'adjust' });
    },

    paste() {
        const clip = this.clipboard();
        if (!clip) {
            this.app.showToast('Nothing copied yet: Copy on an adjusted photo first');
            return;
        }
        this.setAll(this.withOwnSpots(clip.adj));
    },

    // ---- Drawing ----

    schedule() {
        if (this._raf || !this.ready) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = 0;
            this.draw();
        });
    },

    // ---- Zoom and pan ----
    //
    // As in Lightroom: the photo fitted to start with; Ctrl/Cmd + wheel (or
    // a pinch) zooms about the pointer, Ctrl/Cmd + = and − in and out,
    // Ctrl/Cmd + 0 fits, Ctrl/Cmd + 1 is 100%, a double-click goes between
    // the two. Zoomed in, a drag (or the wheel, or two fingers) moves about;
    // Space and a drag does too, whatever tool is out. The zoom is shown in
    // a quiet chip in the corner (Fit · 100%).
    //
    // view.z is screen (css) pixels to one of the photo's own pixels, so 1
    // is 100%, as in Photos' viewer and Paint; view.x and y are where the
    // picture's top left corner is on the stage. The canvas is laid out at
    // that size and place, and everything over it (paint, masks, spots, the
    // 1:1 box) follows the canvas, as it did when it only fitted. Past the
    // working copy's own pixels (a photo bigger than EDGE), what's on
    // screen is drawn again from the full-size photo, so 100% is sharp.
    // Past 100% the photo's pixels are sharp squares, not smoothed (layout).

    MAX_ZOOM: 16,       // 1600%, as Lightroom
    PAD: 16,            // round the photo when it's fitted

    // Where the fitted photo goes in the stage: PAD round it, and at the
    // top clear of the head's pills by the gutter, so they never sit on it
    // at Fit (the owner: "make sure pills aren't touching the photo")
    fitBox() {
        const box = this.el('adj-stage').getBoundingClientRect();
        let top = this.PAD;
        const head = this.root && this.root.querySelector('.adj-head');
        if (head && head.offsetParent !== null && !document.documentElement.dataset.skin) {
            const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 20;
            top = Math.max(top, head.getBoundingClientRect().bottom - box.top + gutter);
        }
        // At the right, clear of the panel, which floats over the stage in
        // jEditor's own look: zoomed in, the photo runs on under it
        const right = this.PAD + this.paneRoom();
        return { x: this.PAD, y: top, w: Math.max(1, box.width - this.PAD - right), h: Math.max(1, box.height - top - this.PAD) };
    },

    // How much of the stage's right the panel covers (0 beside it, as in a
    // theme or a narrow window, or hidden)
    paneRoom() {
        const p = this.el('adj-panel'), st = this.el('adj-stage');
        if (!p || !st || !p.getClientRects().length) return 0;
        const r = p.getBoundingClientRect(), b = st.getBoundingClientRect();
        if (!r.width || r.top >= b.bottom || r.left <= b.left + b.width / 2) return 0;
        return Math.max(0, b.right - r.left);
    },

    // The zoom that fits the photo (at most 4× the working copy, as before)
    fitZoom() {
        const f = this.fitBox();
        return Math.max(1e-3, Math.min(f.w / this.PW, f.h / this.PH, 4 * this.w / this.PW));
    },

    // The view kept on the photo: centred on an axis where it's smaller
    // than the stage, never past its edges where it's bigger
    clampView() {
        const box = this.el('adj-stage').getBoundingClientRect(), v = this.view;
        const cw = this.PW * v.z, ch = this.PH * v.z;
        // Across: centred in the room beside the panel (fitBox) while it fits
        // there; bigger, its left edge as far as the stage's, its right as
        // far as the room's, so it can be seen clear of the panel
        const f = this.fitBox();
        if (cw <= f.w) v.x = f.x + (f.w - cw) / 2;
        else {
            const lo = Math.min(f.x + f.w - cw, box.width - cw), hi = Math.max(lo, 0);
            v.x = Math.min(hi, Math.max(lo, v.x));
        }
        // Up and down: centred in the room under the pills (fitBox) while it
        // fits there; bigger, its top can come down as far as that room's
        // top, so it can be seen clear of the pills, and its bottom up to
        // the stage's
        if (ch <= f.h) v.y = f.y + (f.h - ch) / 2;
        else {
            const lo = box.height - ch, hi = Math.max(lo, f.y);
            v.y = Math.min(hi, Math.max(lo, v.y));
        }
    },

    // The canvas at the view's size and place (fitted: the stage's size)
    layout() {
        if (!this.ready) return;
        const box = this.el('adj-stage').getBoundingClientRect();
        if (!this.view || this.fitted) {
            const z = this.fitZoom();
            const cw = Math.max(1, Math.floor(this.PW * z)), ch = Math.max(1, Math.floor(this.PH * z));
            const f = this.fitBox();
            this.view = { z: cw / this.PW, x: Math.round(f.x + (f.w - cw) / 2), y: Math.round(f.y + (f.h - ch) / 2) };
        } else {
            this.clampView();
        }
        const v = this.view;
        // The zoom pill in the middle of the room beside the panel (style.css)
        const pane = `${Math.round(this.paneRoom())}px`, st = this.el('adj-stage');
        if (st.style.getPropertyValue('--pane-room') !== pane) st.style.setProperty('--pane-room', pane);
        Object.assign(this.canvas.style, { width: `${Math.max(1, this.PW * v.z)}px`, height: `${Math.max(1, this.PH * v.z)}px`, left: `${v.x}px`, top: `${v.y}px` });
        this.root.classList.toggle('adj-zoomed', !this.fitted);
        // Past 100% (a pixel of the photo bigger than one of the screen's):
        // its pixels as sharp squares, as in Photos' viewer; smooth at or
        // below it. On the sharp part, which is the photo's own pixels,
        // and on the picture itself only when it is (a photo no bigger
        // than the working copy): blown up, the working copy of a bigger
        // one would show blocks that aren't the photo's
        const dpr = window.devicePixelRatio || 1;
        this.root.classList.toggle('adj-pixels', v.z * dpr > 1 + 1e-6);
        this.root.classList.toggle('adj-whole', this.PW <= this.w * 1.01);
        this.placePaint();
        this.placeSharp();
        this.showZoom();
    },

    // Everything over the photo put where the photo now is
    viewChanged() {
        this.layout();
        this.placeLoupeBox();
        AdjustMasks.place();
        AdjustMasks.draw();
        AdjustSpots.place();
        AdjustSpots.draw();
        this.sharpSoon();
    },

    // To zoom z, keeping the stage point (cx, cy) where it is (the middle
    // when not given). At or below fit, fitted (a small photo can go down
    // to 100%)
    zoomAt(z, cx = null, cy = null) {
        if (!this.ready) return;
        const box = this.el('adj-stage').getBoundingClientRect();
        if (cx === null) { const f = this.fitBox(); cx = f.x + f.w / 2; cy = f.y + f.h / 2; }
        const fit = this.fitZoom();
        z = Math.max(Math.min(fit, 1), Math.min(this.MAX_ZOOM, z));
        const v = this.view;
        if (Math.abs(z - fit) < 1e-4 * fit || (z < fit && fit <= 1)) {
            this.fitted = true;
        } else {
            // The photo's point under (cx, cy) stays there
            const px = (cx - v.x) / v.z, py = (cy - v.y) / v.z;
            this.fitted = false;
            this.view = { z, x: cx - px * z, y: cy - py * z };
        }
        this.viewChanged();
    },

    zoomBy(k) {
        if (this.ready) this.zoomAt(this.view.z * k);
    },

    zoomFit() {
        if (!this.ready) return;
        this.fitted = true;
        this.viewChanged();
    },

    // 100%: one photo pixel to one screen pixel (a photo smaller than
    // the stage: twice fit, so it still zooms in)
    zoom100(cx = null, cy = null) {
        if (!this.ready) return;
        const fit = this.fitZoom();
        this.zoomAt(fit >= 0.99 ? fit * 2 : 1, cx, cy);
    },

    // Double-click: fit to 100% on the spot, anything else back to fit
    toggleZoom(cx, cy) {
        if (this.fitted) this.zoom100(cx, cy);
        else this.zoomFit();
    },

    // Moved about by (dx, dy) screen pixels, when zoomed in
    panBy(dx, dy) {
        if (!this.ready || this.fitted) return;
        this.view.x += dx;
        this.view.y += dy;
        this.viewChanged();
    },

    // The chip: Fit or 100% lit when it's at that, the zoom between
    showZoom() {
        const chip = this.el('adj-zoom');
        if (!chip) return;
        const z = this.view ? this.view.z : 1;
        const at100 = !this.fitted && Math.abs(z - 1) < 0.005;
        this.el('adj-zoom-fit').setAttribute('aria-pressed', String(!!this.fitted));
        this.el('adj-zoom-100').setAttribute('aria-pressed', String(at100));
        const level = this.el('adj-zoom-level');
        level.textContent = `${Math.round(z * 100)}%`;
        level.classList.toggle('hidden', !!this.fitted || at100);
    },

    initZoom() {
        const stage = this.el('adj-stage');
        this.el('adj-zoom-fit').addEventListener('click', (e) => { e.currentTarget.blur(); this.zoomFit(); });
        this.el('adj-zoom-100').addEventListener('click', (e) => { e.currentTarget.blur(); this.zoom100(); });
        const at = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        // Ctrl/Cmd + wheel, or a pinch (Ctrl + wheel to the page), zooms
        // about the pointer; zoomed in, the wheel or two fingers move about
        stage.addEventListener('wheel', (e) => {
            if (!this.ready || e.target.closest('.adj-zoom')) return;
            const px = Wheel.pixels(e, stage);
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const dy = Math.max(-25, Math.min(25, px.y || px.x));
                this.zoomAt(this.view.z * Math.exp(-dy * 0.01), ...at(e));
                return;
            }
            if (this.fitted) return;
            e.preventDefault();
            // A mouse with Shift held goes sideways
            if (e.shiftKey && !px.x) this.panBy(-px.y, 0);
            else this.panBy(-px.x, -px.y);
        }, { passive: false });
        stage.addEventListener('dblclick', (e) => {
            if (!this.ready || this.picking || e.target.closest('.adj-zoom')) return;
            // The masks' and spots' tools have the photo while they're out
            if (e.target.classList.contains('adj-overlay')) return;
            e.preventDefault();
            this.toggleZoom(...at(e));
        });
        // A drag moves about: Space held (first, whatever tool is out), or
        // zoomed in with no tool out (the masks and spots tools keep theirs)
        const grab = (e) => {
            if (!this.ready || this.pan || (e.button !== 0 && e.button !== 1)) return;
            if (e.target.closest('.adj-zoom')) return;
            if (!this.space && e.button !== 1 && (this.fitted || this.picking)) return;
            e.preventDefault();
            e.stopPropagation();
            this.pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, at: at(e) };
            try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
            this.root.classList.add('adj-grabbing');
        };
        stage.addEventListener('pointerdown', (e) => { if (this.space) grab(e); }, true);
        stage.addEventListener('pointerdown', grab);
        stage.addEventListener('pointermove', (e) => {
            const p = this.pan;
            if (!p || e.pointerId !== p.id) return;
            const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
            if (!p.moved && Math.hypot(dx, dy) < 3) return;
            p.moved = true;
            p.sx = e.clientX;
            p.sy = e.clientY;
            this.panBy(dx, dy);
        });
        const end = (e) => {
            const p = this.pan;
            if (!p || e.pointerId !== p.id) return;
            this.pan = null;
            this.root.classList.remove('adj-grabbing');
            // A click (no drag) with the 1:1 view out moves it there
            if (!p.moved && e.type === 'pointerup' && this.detailOpen()) this.loupeTo(e);
        };
        stage.addEventListener('pointerup', end);
        stage.addEventListener('pointercancel', end);
        // Space held: the hand, as in Paint
        window.addEventListener('keydown', (e) => {
            if (!this.isOpen || e.code !== 'Space' || this.app.isTypingTarget(e.target)) return;
            if (this.root.classList.contains('hidden')) return;
            e.preventDefault();
            if (!this.space) { this.space = true; this.root.classList.add('adj-space'); }
        }, true);
        const up = () => { this.space = false; if (this.root) this.root.classList.remove('adj-space'); };
        window.addEventListener('keyup', (e) => { if (e.code === 'Space') up(); }, true);
        window.addEventListener('blur', up);
    },

    // ---- At 100%, sharp ----
    //
    // The working copy is at most EDGE across. Zoomed in past its pixels,
    // the part on screen is drawn from the full-size photo (loadFull, as
    // the 1:1 view is), with detail done on its own pixels, and adjusted on
    // the GPU as the sliders move, on its own canvas laid over the
    // picture. A moment after the view stops moving it's drawn again for
    // where it is now; in between, the picture under it shows round it.

    SHARP_MAX: 16e6,    // pixels in the sharp part, at most

    // Is there more to see than the working copy has?
    needSharp() {
        if (!this.ready || this.fitted || !this.view) return false;
        if (this.PW <= this.w * 1.01) return false;       // it's the whole photo already
        const dpr = window.devicePixelRatio || 1;
        return this.view.z * dpr * this.PW / this.w > 1.01;
    },

    sharpSoon() {
        clearTimeout(this._sharpTimer);
        if (!this.needSharp()) { this.hideSharp(); return; }
        this._sharpTimer = setTimeout(() => this.renderSharp(), 120);
    },

    hideSharp() {
        const cv = this.el('adj-sharp');
        if (cv) cv.classList.add('hidden');
        this._sharp = null;
    },

    // The part of the full-size photo on screen (a little round it too),
    // in its pixels
    sharpRegion(FW, FH) {
        const box = this.el('adj-stage').getBoundingClientRect(), v = this.view;
        const cw = this.PW * v.z, ch = this.PH * v.z;
        const m = 48;
        const x0 = Math.max(0, Math.floor((Math.max(0, -v.x) - m) / cw * FW));
        const y0 = Math.max(0, Math.floor((Math.max(0, -v.y) - m) / ch * FH));
        const x1 = Math.min(FW, Math.ceil((Math.min(cw, box.width - v.x) + m) / cw * FW));
        const y1 = Math.min(FH, Math.ceil((Math.min(ch, box.height - v.y) + m) / ch * FH));
        return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    },

    async renderSharp() {
        if (!this.needSharp()) { this.hideSharp(); return; }
        const full = await this.loadFull();
        if (!full || !this.needSharp() || full !== this.fullCanvas) return;
        const cv = this.el('adj-sharp');
        const FW = full.width, FH = full.height;
        const r = this.sharpRegion(FW, FH);
        if (!r.w || !r.h || r.w * r.h > this.SHARP_MAX) { this.hideSharp(); return; }
        if (this._sharpGl === undefined) this._sharpGl = Develop.renderer(cv);
        const R = this._sharpGl && !this._sharpGl.lost ? this._sharpGl : null;
        if (R && (r.w > R.max || r.h > R.max)) { this.hideSharp(); return; }
        const d = this.before ? null : Develop.detail(this.a, 1, FW, FH);
        const key = JSON.stringify([r, this._fullKey, d, this.before]);
        if (!this._sharp || this._sharp.key !== key) {
            const img = d ? Develop.detailBlock((a, b, c, e) => this.fullCtx.getImageData(a, b, c, e), r.x, r.y, r.w, r.h, FW, FH, d, 1)
                : this.fullCtx.getImageData(r.x, r.y, r.w, r.h);
            if (R) R.setImage(img);
            this._sharp = { key, r, FW, FH, img: R ? null : img, out: R ? null : new ImageData(r.w, r.h) };
        }
        this.drawSharp();
        this.placeSharp();
        cv.classList.remove('hidden');
    },

    // The sharp part adjusted as the picture is (called with draw())
    drawSharp(T = null) {
        const s = this._sharp;
        if (!s) return;
        T = T || Develop.tables(this.a);
        const { r, FW, FH } = s;
        const frame = { x: r.x, y: r.y, w: r.w, W: FW, H: FH, glow: this.glow, map: this.map };
        const R = this._sharpGl && !this._sharpGl.lost ? this._sharpGl : null;
        if (R) {
            try {
                if (this.glow) R.setGlow(this.glow);
                const brush = Develop.brushFor(T.masks, this.map.asp);
                if (brush) R.setBrush(brush);
                R.setTables(T);
                R.draw(r.w, r.h, { before: this.before, frame, clip: this.clip && !this.before });
            } catch (e) {
                console.warn('Adjust: GPU failed (100%):', e);
                this.hideSharp();
            }
        } else if (s.img) {
            const cv = this.el('adj-sharp');
            if (cv.width !== r.w) cv.width = r.w;
            if (cv.height !== r.h) cv.height = r.h;
            const ctx = cv.getContext('2d');
            if (this.before) ctx.putImageData(s.img, 0, 0);
            else {
                Develop.applyCPU(s.img.data, T, s.out.data, { ...frame, brush: Develop.brushFor(T.masks, this.map.asp) });
                ctx.putImageData(s.out, 0, 0);
            }
        }
    },

    // Over the picture, where its part of the photo is
    placeSharp() {
        const cv = this.el('adj-sharp'), s = this._sharp;
        if (!cv || !s || !this.view) return;
        const v = this.view, kx = this.PW * v.z / s.FW, ky = this.PH * v.z / s.FH;
        Object.assign(cv.style, { left: `${v.x + s.r.x * kx}px`, top: `${v.y + s.r.y * ky}px`, width: `${s.r.w * kx}px`, height: `${s.r.h * ky}px` });
    },

    // Where the canvas shows on the stage, for what's laid over it: only
    // the part on the stage (zoomed in, the canvas is far bigger), and
    // where that is on the canvas. { left, top, w, h } on the stage, ox, oy
    // into the canvas, cw, ch the canvas's whole size (css px)
    overlayRect() {
        const cr = this.canvas.getBoundingClientRect(), sr = this.el('adj-stage').getBoundingClientRect();
        const l = Math.max(cr.left, sr.left), t = Math.max(cr.top, sr.top);
        const r = Math.min(cr.right, sr.right), b = Math.min(cr.bottom, sr.bottom);
        return { left: l - sr.left, top: t - sr.top, w: Math.max(1, r - l), h: Math.max(1, b - t), ox: l - cr.left, oy: t - cr.top, cw: cr.width, ch: cr.height };
    },

    draw() {
        if (!this.ready) return;
        if (this.usePicture()) this.layout();
        const T = Develop.tables(this.a);
        // Halation's glow, from the whole picture (as saving makes it):
        // made again only when the settings change, not on every redraw
        let glow = null;
        if (T.fx && T.fx.hal[0]) {
            if (!this._glow || this._glow.key !== T.key) {
                this._glow = { key: T.key, map: Develop.glowMap(Develop.applyCPU(this.sample, { ...T, fx: null }, this.sampleOut), this.sampleW, this.sampleH) };
            }
            glow = this._glow.map;
        }
        this.glow = glow;
        this.detailSoon();
        this.loupeSoon();
        const brush = Develop.brushFor(T.masks, this.map.asp);
        if (this.gl) {
            try {
                if (glow) this.gl.setGlow(glow);
                if (brush) this.gl.setBrush(brush);
                this.gl.setTables(T);
                this.gl.draw(this.w, this.h, { before: this.before, clip: this.clip && !this.before, frame: { x: 0, y: 0, W: this.w, H: this.h, map: this.map } });
            } catch (e) {
                console.warn('Adjust: GPU failed:', e);
            }
        } else if (this.src) {
            if (this.canvas.width !== this.w) this.canvas.width = this.w;
            if (this.canvas.height !== this.h) this.canvas.height = this.h;
            if (this.before) this.ctx.putImageData(this.src, 0, 0);
            else {
                Develop.applyCPU(this.src.data, T, this.out.data, { x: 0, y: 0, w: this.w, W: this.w, H: this.h, glow, map: this.map, brush });
                this.ctx.putImageData(this.out, 0, 0);
            }
        }
        this.drawSharp(T);
        this.sharpSoon();
        // The histogram, once per change (a redraw for detail, spots or
        // masks shown doesn't change it)
        const histKey = this.before ? 'before' : T.key;
        if (!this._hist || this._hist.key !== histKey) {
            const px = this.before ? this.sample : Develop.applyCPU(this.sample, T, this.sampleOut, { x: 0, y: 0, w: this.sampleW, W: this.sampleW, H: this.sampleH, glow, map: this.map, brush });
            this._hist = { key: histKey, hist: Develop.histogram(px) };
        }
        this.hist = this._hist.hist;
        this.drawPanels();
        AdjustMasks.draw();
        AdjustSpots.draw();
    },

    // ---- Detail: sharpening and noise reduction ----
    //
    // They work on the photo's own pixels, so they only show near 1:1:
    // the 1:1 view in the Detail section shows them, from the full photo,
    // where you click on it. A small photo (shown at half size or more)
    // gets them in the main view too, a moment after the sliders stop.

    detailOpen() {
        const sec = this.el('adj-detail-sec');
        return !!(sec && sec.open && this.pane === 'edit');
    },

    initLoupe() {
        const sec = this.el('adj-detail-sec');
        sec.addEventListener('toggle', () => {
            this.root.classList.toggle('adj-detail-open', sec.open);
            if (sec.open) this.renderLoupe();
            this.placeLoupeBox();
        });
        // A click on the photo moves the 1:1 view there (zoomed in, a
        // drag moves about: a click without one does, initZoom)
        this.el('adj-stage').addEventListener('pointerdown', (e) => {
            if (!this.ready || !this.detailOpen() || !this.fitted || this.space) return;
            this.loupeTo(e);
        });
    },

    loupeTo(e) {
        const r = this.canvas.getBoundingClientRect();
        const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
        if (u < 0 || u > 1 || v < 0 || v > 1) return;
        this.loupeAt = { u, v };
        this.renderLoupe();
    },

    // The working copy with detail done (debounced: it's on the CPU)
    detailSoon() {
        if (!this.gl || !this.srcData) return;
        const d = Develop.detail(this.a, this.pxScale, this.srcData.width, this.srcData.height);
        const key = JSON.stringify(d);
        if (key === this._detailKey) return;
        clearTimeout(this._detailTimer);
        this._detailTimer = setTimeout(() => {
            if (!this.ready || !this.srcData) return;
            this._detailKey = key;
            const img = new ImageData(new Uint8ClampedArray(this.srcData.data), this.srcData.width, this.srcData.height);
            if (d) Develop.applyDetail(img.data, img.width, img.height, d, this.pxScale);
            this.gl.setImage(img);
            this.schedule();
        }, 250);
    },

    // What the full-size picture is made from: its spots, perspective, lens
    // and geometry (it's made again when they change)
    fullKey() {
        return JSON.stringify([this.a.spots || [], Retouch.cleanPersp(this.a.persp), Retouch.cleanLens(this.a.lens), this.geo]);
    },

    // The photo at full size, cropped as it's being adjusted (for 1:1)
    loadFull() {
        const file = this.file;
        // Made again when what it's made from changes (fullKey)
        const spots = this.a.spots, persp = this.a.persp, lens = this.a.lens, geo = this.geo;
        const key = this.fullKey();
        if (this._fullFor === file && this._fullKey === key) return this._fullPromise;
        this._fullFor = file;
        this._fullKey = key;
        this._fullPromise = (async () => {
            const bmp = await createImageBitmap(await this.app.readImage(file));
            const base = await Retouch.retouched(bmp, { adj: { spots, persp, lens } });
            let c;
            if (geo) {
                c = CropEditor.fromSnapshot(bmp.width, bmp.height, geo).drawOutput(base);
                if (base !== bmp) base.width = base.height = 0;
            } else if (base !== bmp) {
                c = base;
            } else {
                c = document.createElement('canvas');
                c.width = bmp.width;
                c.height = bmp.height;
                c.getContext('2d').drawImage(bmp, 0, 0);
            }
            bmp.close();
            if (this.file !== file || !this.isOpen || this._fullKey !== key) { c.width = c.height = 0; return null; }
            if (this.fullCanvas && this.fullCanvas !== c) this.fullCanvas.width = this.fullCanvas.height = 0;
            this.fullCanvas = c;
            this.fullCtx = c.getContext('2d', { willReadFrequently: true });
            return c;
        })().catch((e) => {
            console.warn('Adjust: no full-size photo for 1:1:', e);
            // Tried again next time (a photo still being written, a drive
            // that came back), not left empty for as long as it's open
            if (this._fullKey === key && this._fullFor === file) this._fullFor = null;
            return null;
        });
        return this._fullPromise;
    },

    loupeSoon() {
        if (!this.detailOpen()) return;
        clearTimeout(this._loupeTimer);
        this._loupeTimer = setTimeout(() => this.renderLoupe(), 90);
    },

    // The 1:1 view: the photo's own pixels round the point, as saved
    renderLoupe() {
        const cv = this.el('adj-loupe');
        if (!cv || !this.ready || !this.detailOpen()) return;
        this.placeLoupeBox();
        if (this.fullCanvas && this._fullKey !== this.fullKey()) {
            this.loadFull().then(c => { if (c) this.renderLoupe(); });
        }
        if (!this.fullCanvas) {
            const ctx = cv.getContext('2d');
            ctx.clearRect(0, 0, cv.width, cv.height);
            this.loadFull().then(c => { if (c) this.renderLoupe(); });
            return;
        }
        const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        const FW = this.fullCanvas.width, FH = this.fullCanvas.height;
        const lw = Math.max(1, Math.min(FW, Math.round(r.width * dpr))), lh = Math.max(1, Math.min(FH, Math.round(r.height * dpr)));
        if (cv.width !== lw) cv.width = lw;
        if (cv.height !== lh) cv.height = lh;
        const x = Math.min(FW - lw, Math.max(0, Math.round(this.loupeAt.u * FW - lw / 2)));
        const y = Math.min(FH - lh, Math.max(0, Math.round(this.loupeAt.v * FH - lh / 2)));
        this._loupeRect = { x: x / FW, y: y / FH, w: lw / FW, h: lh / FH };
        let img;
        if (this.before) {
            img = this.fullCtx.getImageData(x, y, lw, lh);
        } else {
            const d = Develop.detail(this.a, 1, FW, FH);
            img = d ? Develop.detailBlock((a, b, c, e) => this.fullCtx.getImageData(a, b, c, e), x, y, lw, lh, FW, FH, d, 1)
                : this.fullCtx.getImageData(x, y, lw, lh);
            Develop.applyCPU(img.data, Develop.tables(this.a), img.data, { x, y, w: lw, W: FW, H: FH, glow: this.glow, map: this.map });
        }
        cv.getContext('2d').putImageData(img, 0, 0);
        this.placeLoupeBox();
    },

    // Where the 1:1 view is, outlined on the photo
    placeLoupeBox() {
        const box = this.el('adj-loupe-box');
        if (!box) return;
        const lr = this._loupeRect;
        if (!this.ready || !this.detailOpen() || !lr) { box.classList.add('hidden'); return; }
        const cr = this.canvas.getBoundingClientRect(), sr = this.el('adj-stage').getBoundingClientRect();
        box.style.left = `${cr.left - sr.left + lr.x * cr.width}px`;
        box.style.top = `${cr.top - sr.top + lr.y * cr.height}px`;
        box.style.width = `${Math.max(4, lr.w * cr.width)}px`;
        box.style.height = `${Math.max(4, lr.h * cr.height)}px`;
        box.classList.remove('hidden');
    },

    // ---- Looks ----
    //
    // Film looks (develop.js LOOKS), each shown on this photo as it now is

    initLooks() {
        // One line in Basic: the look's name, opening a menu of the films
        // by process (the plan: a picker, not a wall of thumbnails)
        this.el('adj-look-pick').addEventListener('click', (e) => {
            const b = e.currentTarget;
            e.stopPropagation(); // not to the window, which closes menus
            b.blur();
            if (this.busy || !this.ready) return;
            const r = b.getBoundingClientRect();
            this.app.openContextMenu(this.lookItems(), r.left, r.bottom + 4);
        });
    },

    lookName(l) {
        return l ? [l.maker, l.name].filter(Boolean).join(' ') : 'None';
    },

    // The look's name as shown: its own, and if it's been dialled in, so
    shownLookName() {
        const l = Develop.lookOf(this.a);
        return !l ? 'None' : l.modified ? `${l.name} (modified)` : l.name;
    },

    setLook(id) {
        if (!this.ready || (id || null) === (this.a.look || null)) return;
        this.pushHistory();
        this.a.look = id || null;
        this.a.lookAdj = null;
        this.a.lookName = null;
        if (!id) this.a.lookAmount = 100;
        this.openDial();
        this.changed();
    },

    // One of your own looks (its settings come with it)
    setOwnLook(o) {
        if (!this.ready) return;
        this.pushHistory();
        this.a.look = 'own:' + o.id;
        this.a.lookName = o.name;
        this.a.lookAdj = JSON.parse(JSON.stringify(o.adj));
        this.openDial();
        this.changed();
    },

    // The film look as it was made again, its sliders as they came
    resetLook() {
        if (!this.ready || !this.a.lookAdj || String(this.a.look).startsWith('own:')) return;
        this.pushHistory();
        this.a.lookAdj = null;
        this.changed();
    },

    // None, then each process with its films beside it, your own looks,
    // and saving the settings as one of yours
    lookItems() {
        const on = this.a.look || null;
        const l = Develop.lookOf(this.a);
        const own = this.ownLooks();
        return [
            ['None', () => this.setLook(null), false, !on],
            ['—'],
            ...Develop.PROCESSES.map(([id, label]) => [label, Develop.LOOKS.filter(lk => lk.process === id)
                .map(lk => [this.lookName(lk), () => this.setLook(lk.id), false, on === lk.id])]),
            ...(own.length ? [['—'], ['Your looks', null],
                // Right-click one of yours: rename, duplicate or delete it
                ...own.map(o => [o.name, () => this.setOwnLook(o), false, on === 'own:' + o.id, undefined, this.ownLookItems(o)]),
                ['Change your looks', own.map(o => [o.name, this.ownLookItems(o)])]] : []),
            ['—'],
            ['Save as a look…', () => this.saveLook()],
            ...(l && l.modified ? [[`Reset ${l.name} to as made`, () => this.resetLook()]] : [])
        ];
    },

    // ---- A look's own sliders ----
    //
    // Picking a look opens them under its Amount, so a look is never fixed
    // (the plan): each changes the look's own settings (lookAdj, kept with
    // the photo's), and the look shows as modified, with Reset in its menu

    initLookDial() {
        this.lookMixer = 'hue';
        const rows = [];
        const add = (box, key, label, range, get, set) => {
            const row = this.slider('look-' + key, label, { range, get: () => get(this.lookFull()), set: (v) => this.editLook(la => set(la, v)) });
            this.el(box).appendChild(row);
            rows.push(row);
            return row;
        };
        const pct = { min: -100, max: 100, step: 1 }, up = { min: 0, max: 100, step: 1 };
        add('adj-look-tone', 'contrast', 'Contrast', pct, f => f.contrast, (la, v) => { la.contrast = v; });
        // Lifted blacks: where the tone curve starts
        add('adj-look-tone', 'fade', 'Fade', { min: 0, max: 30, step: 1 }, f => Math.round(f.curve.rgb[0][1] * 100), (la, v) => {
            const c = la.curve = la.curve || {};
            const rgb = (c.rgb || [[0, 0], [1, 1]]).map(p => p.slice());
            if (rgb[0][0] === 0) rgb[0][1] = v / 100; else rgb.unshift([0, v / 100]);
            c.rgb = rgb;
        });
        add('adj-look-tone', 'warmth', 'Warmth', pct, f => f.temp, (la, v) => { la.temp = v; });
        const zone = (z, name) => {
            const g = (f) => f.grade[z];
            const put = (la, k, v) => { la.grade = la.grade || {}; const t = (la.grade[z] || [0, 0, 0]).slice(); t[k] = v; la.grade[z] = t; };
            add('adj-look-tint', z + 'hue', `${name} hue`, { min: 0, max: 360, step: 1 }, f => g(f)[0], (la, v) => put(la, 0, v));
            add('adj-look-tint', z + 'tint', `${name} tint`, up, f => g(f)[1], (la, v) => put(la, 1, v));
        };
        zone('s', 'Shadow');
        zone('h', 'Highlight');
        add('adj-look-colour', 'saturation', 'Saturation', pct, f => f.saturation, (la, v) => { la.saturation = v; });
        add('adj-look-colour', 'vibrance', 'Vibrance', pct, f => f.vibrance, (la, v) => { la.vibrance = v; });
        // Colour response: a small mixer of the look's own
        Develop.HUES.forEach((h, i) => {
            const row = add('adj-look-mixer', 'mix-' + h.id, h.name, pct, f => f.hsl[this.lookMixer][i], (la, v) => {
                la.hsl = la.hsl || {};
                const t = (la.hsl[this.lookMixer] || new Array(8).fill(0)).slice();
                t[i] = v;
                la.hsl[this.lookMixer] = t;
            });
            row.style.setProperty('--swatch', h.color);
            row.classList.add('adj-mix-row');
        });
        for (const b of this.root.querySelectorAll('.adj-look-mix-tabs .adj-tab')) {
            b.addEventListener('click', () => { b.blur(); this.lookMixer = b.dataset.mix; this.sync(); });
        }
        add('adj-look-film', 'grain', 'Grain', up, f => f.grain, (la, v) => { la.grain = v; });
        add('adj-look-film', 'grainSize', 'Grain size', up, f => f.grainSize, (la, v) => { la.grainSize = v; });
        add('adj-look-film', 'grainColor', 'Grain color', up, f => f.grainColor, (la, v) => { la.grainColor = v; });
        add('adj-look-film', 'halation', 'Halation', up, f => f.halation, (la, v) => { la.halation = v; });
        add('adj-look-film', 'vignette', 'Vignette', pct, f => f.vignette, (la, v) => { la.vignette = v; });
        this.lookRows = rows;
        (this.extraRows || (this.extraRows = [])).push(...rows);
    },

    // The look's settings as dialled in, every one filled in
    lookFull() {
        const l = this.a && Develop.lookOf(this.a);
        return Develop.full(l ? l.adj : {});
    },

    // A change to the look's own settings: from then on the photo keeps
    // them (lookAdj), made from the look as it came
    editLook(fn) {
        const l = Develop.lookOf(this.a);
        if (!l) return;
        const la = JSON.parse(JSON.stringify(l.adj || {}));
        fn(la);
        this.a.lookAdj = Develop.cleanLookAdj(la);
    },

    // Picking a look opens its sliders (they stay as left after that)
    openDial() {
        const d = this.el('adj-look-dial');
        if (d && this.a.look) d.open = true;
    },

    syncLookDial() {
        const d = this.el('adj-look-dial');
        if (!d) return;
        d.classList.toggle('hidden', !Develop.lookOf(this.a));
        for (const b of this.root.querySelectorAll('.adj-look-mix-tabs .adj-tab')) b.setAttribute('aria-selected', String(b.dataset.mix === this.lookMixer));
    },

    // ---- Your own looks ----
    //
    // Kept on this computer (as presets are), each { id, name, adj }; a
    // photo using one keeps a copy of its settings, so it looks the same
    // wherever its settings go, and changing or deleting the look later
    // doesn't change photos already done with it

    ownLooks() {
        try {
            const list = JSON.parse(localStorage.getItem('jeditor.looks') || '[]');
            return Array.isArray(list) ? list.filter(o => o && typeof o.id === 'string' && typeof o.name === 'string' && o.adj && typeof o.adj === 'object') : [];
        } catch (e) { return []; }
    },

    saveOwnLooks(list) {
        try { localStorage.setItem('jeditor.looks', JSON.stringify(list)); } catch (e) { /* private mode */ }
    },

    // Rename, duplicate or delete one (its right-click menu)
    ownLookItems(o) {
        return [
            ['Rename…', () => this.renameLook(o)],
            ['Duplicate', () => {
                const list = this.ownLooks();
                list.push({ id: this.newLookId(), name: this.freeLookName(o.name + ' copy'), adj: JSON.parse(JSON.stringify(o.adj)) });
                this.saveOwnLooks(list);
                this.app.showToast(`Duplicated “${o.name}”`, 1600, null, null, { kind: 'adjust' });
            }],
            ['Delete', () => {
                this.saveOwnLooks(this.ownLooks().filter(q => q.id !== o.id));
                this.app.showToast(`Deleted the look “${o.name}”; photos done with it keep it`, 2400, null, null, { kind: 'adjust' });
            }, true]
        ];
    },

    newLookId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },

    // A name not already used by one of yours
    freeLookName(name) {
        const used = new Set(this.ownLooks().map(o => o.name.toLowerCase()));
        let n = name, i = 2;
        while (used.has(n.toLowerCase())) n = `${name} ${i++}`;
        return n;
    },

    async renameLook(o) {
        const name = await UI.prompt({ title: 'Rename the look', message: 'Photos already done with it keep their name for it.', ok: 'Rename', input: { label: 'Name', value: o.name } });
        if (!name || !name.trim() || name.trim() === o.name) return;
        const list = this.ownLooks();
        const it = list.find(q => q.id === o.id);
        if (!it) return;
        it.name = this.freeLookName(name.trim().slice(0, 60));
        this.saveOwnLooks(list);
    },

    // Save as a look: the look as dialled in, if one's on; otherwise the
    // photo's own settings (not its masks, spots or Restore colour, which
    // are this photo's)
    async saveLook() {
        if (!this.ready) return;
        const l = Develop.lookOf(this.a);
        const adj = l ? Develop.cleanLookAdj(l.adj) : Develop.cleanLookAdj(this.result() || {});
        if (!Object.keys(adj).length) {
            this.app.showToast('Adjust the photo or dial in a look first: a look keeps the settings', 2400, null, null, { kind: 'adjust' });
            return;
        }
        const name = await UI.prompt({
            title: 'Save as a look',
            message: l ? `${l.name} as you've dialled it in, to put on other photos from the Look menu.` : 'These settings, to put on other photos from the Look menu.',
            ok: 'Save', input: { label: 'Name', value: l ? this.freeLookName(l.own ? l.name : `My ${l.name}`) : '' }
        });
        if (!name || !name.trim()) return;
        const list = this.ownLooks();
        const o = { id: this.newLookId(), name: this.freeLookName(name.trim().slice(0, 60)), adj };
        list.push(o);
        this.saveOwnLooks(list);
        this.app.showToast(`Saved the look “${o.name}”: it's under Your looks in the Look menu`, 2400, null, null, { kind: 'adjust' });
    },

    // The four tools: Edit, Restore, Heal and Masks. Restore, Heal and
    // Masks each hold one section that's open while it's shown, so the
    // tools there work on the photo only then. Restore and Heal share the
    // spot tool (Restore uses it for red-eye and shows the dust it finds),
    // so its section is open for both
    initPanes() {
        const spots = this.el('adj-spots-sec'), masks = this.el('adj-masks-sec'), restore = this.el('adj-restore-sec');
        for (const b of this.root.querySelectorAll('.adj-pane-tabs .adj-tool')) {
            b.addEventListener('click', () => { b.blur(); this.showPane(b.dataset.pane); });
        }
        for (const sec of [spots, masks, restore]) sec.querySelector('summary').addEventListener('click', (e) => e.preventDefault());
        spots.addEventListener('toggle', () => {
            if (spots.open) { if (this.pane !== 'restore') this.showPane('heal'); }
            else if (this.pane === 'heal' || this.pane === 'restore') this.showPane('edit');
        });
        masks.addEventListener('toggle', () => {
            if (masks.open) this.showPane('masks');
            else if (this.pane === 'masks') this.showPane('edit');
        });
        // Edit's sections: opening one shows Edit and folds the one open before
        const edit = [...this.root.querySelectorAll('.adj-pane[data-pane="edit"] > details.adj-sec')];
        for (const sec of edit) {
            sec.addEventListener('toggle', () => {
                if (!sec.open) return;
                for (const o of edit) if (o !== sec && o.open) o.open = false;
                this.showPane('edit');
            });
        }
        this.pane = 'edit';
    },

    showPane(id) {
        if (this.pane === id) return;
        this.pane = id;
        for (const b of this.root.querySelectorAll('.adj-pane-tabs .adj-tool')) b.setAttribute('aria-selected', String(b.dataset.pane === id));
        for (const p of this.root.querySelectorAll('.adj-pane')) p.classList.toggle('hidden', p.dataset.pane !== id);
        AdjustSpots.usePane(id);
        this.el('adj-spots-sec').open = id === 'heal' || id === 'restore';
        this.el('adj-masks-sec').open = id === 'masks';
        this.drawPanels();
        this.drawWheels();
        this.placeLoupeBox();
        if (this.detailOpen()) this.renderLoupe();
    },

    // ---- Presets: settings saved under a name, for any photo ----

    presets() {
        try {
            const list = JSON.parse(localStorage.getItem('jeditor.presets') || '[]');
            return Array.isArray(list) ? list.filter(p => p && typeof p.name === 'string').map(p => ({ name: p.name, adj: this.portable(p.adj) })) : [];
        } catch (e) {
            return [];
        }
    },

    savePresets(list) {
        try { localStorage.setItem('jeditor.presets', JSON.stringify(list)); } catch (e) { /* private mode */ }
    },

    presetMenu(x, y) {
        const list = this.presets();
        const items = list.map(p => [p.name, () => this.setAll(this.withOwnSpots(p.adj))]);
        if (items.length) items.push(['—']);
        items.push(['Save these settings as a preset…', () => this.savePreset()]);
        if (list.length) {
            items.push(['—']);
            for (const p of list) items.push([`Delete “${p.name}”`, () => this.savePresets(this.presets().filter(q => q.name !== p.name)), true]);
        }
        this.app.openContextMenu(items, x, y);
    },

    async savePreset() {
        const adj = this.portable(this.result());
        if (!adj) {
            this.app.showToast('Adjust the photo first: a preset keeps the settings');
            return;
        }
        const name = await UI.prompt({ title: 'Save a preset', message: 'These settings, to put on other photos from Presets.', ok: 'Save', input: { label: 'Name', value: '' } });
        if (name === null || !name.trim()) return;
        const list = this.presets().filter(p => p.name.toLowerCase() !== name.trim().toLowerCase());
        list.push({ name: name.trim(), adj });
        list.sort((a, b) => a.name.localeCompare(b.name));
        this.savePresets(list);
        this.app.showToast(`Saved the preset “${name.trim()}”`, 1800, null, null, { kind: 'adjust' });
    },

    // ---- Color grading: a wheel each for shadows, midtones, highlights ----
    //
    // The angle is the hue, the distance from the middle how strong;
    // the slider under it is brightness. Double-click a wheel to clear it.

    initWheels() {
        const box = this.el('adj-wheels');
        this.wheels = Develop.ZONES.map(([z, name], i) => {
            const cell = document.createElement('div');
            cell.className = 'adj-wheel';
            cell.innerHTML = '<span class="adj-wheel-name"></span><canvas></canvas>';
            cell.querySelector('span').textContent = name;
            const cv = cell.querySelector('canvas');
            cv.title = `${name}: drag to tint, double-click to clear`;
            const at = (e) => {
                const r = cv.getBoundingClientRect();
                const x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
                const g = this.a.grade[z];
                g[0] = Math.round(((Math.atan2(-y, x) * 180 / Math.PI) + 360) % 360);
                g[1] = Math.round(Math.min(1, Math.hypot(x, y) / 0.9) * 100);
                this.changed();
            };
            cv.addEventListener('pointerdown', (e) => {
                if (!this.ready) return;
                e.preventDefault();
                cv.setPointerCapture(e.pointerId);
                this.pushHistory();
                this._wheel = z;
                at(e);
            });
            cv.addEventListener('pointermove', (e) => { if (this._wheel === z) at(e); });
            const end = () => { this._wheel = null; };
            cv.addEventListener('pointerup', end);
            cv.addEventListener('pointercancel', end);
            cv.addEventListener('dblclick', () => {
                this.pushHistory();
                this.a.grade[z] = [0, 0, this.a.grade[z][2]];
                this.changed();
            });
            const lum = this.slider(`grade-${z}`, 'Luminance', {
                range: { min: -100, max: 100, step: 1 },
                get: () => this.a.grade[z][2],
                set: (v) => { this.a.grade[z][2] = v; }
            });
            lum.classList.add('adj-wheel-lum');
            lum.querySelector('.adj-range').title = `${name}: brightness (double-click to reset)`;
            (this.extraRows || (this.extraRows = [])).push(lum);
            cell.appendChild(lum);
            box.appendChild(cell);
            return { z, cv };
        });
    },

    drawWheels() {
        if (!this.wheels || !this.isOpen) return;
        for (const { z, cv } of this.wheels) {
            const { ctx, w, h } = this.fit(cv);
            if (Math.min(w, h) < 8) continue; // folded away, or on a tab not shown
            const R = Math.min(w, h) / 2 - 2, cx = w / 2, cy = h / 2;
            // Hues round the ring (red to the right, going anticlockwise), grey in the middle
            const g = ctx.createConicGradient(0, cx, cy);
            for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `hsl(${360 - i * 30}, 75%, 55%)`);
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
            const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
            rg.addColorStop(0, 'rgba(128,128,128,1)');
            rg.addColorStop(1, 'rgba(128,128,128,0)');
            ctx.fillStyle = rg;
            ctx.fill();
            const [hue, sat] = this.a.grade[z];
            const d = sat / 100 * R * 0.9, a = hue * Math.PI / 180;
            const px = cx + Math.cos(a) * d, py = cy - Math.sin(a) * d;
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fillStyle = sat ? `hsl(${hue}, 80%, 55%)` : '#808080';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        }
    },

    drawPanels() {
        if (!this.isOpen) return;
        this.drawHistogram();
        this.drawLevels();
        this.drawCurve();
    },

    // Every control showing the settings
    sync() {
        for (const row of Object.values(this.sliders)) row._sync();
        for (const row of this.mixerSliders.concat(this.extraRows || [])) row._sync();
        for (const b of this.root.querySelectorAll('.adj-chan .adj-tab')) b.setAttribute('aria-selected', String(b.dataset.chan === this.channel));
        for (const b of this.root.querySelectorAll('.adj-mix-tabs .adj-tab')) b.setAttribute('aria-selected', String(b.dataset.mix === this.mixer));
        this.el('adj-look-name').textContent = this.shownLookName();
        this.el('adj-look-amount').classList.toggle('hidden', !Develop.lookOf(this.a));
        this.syncLookDial();
        this.drawWheels();
        const l = this.a.levels[this.channel];
        this.el('adj-levels-read').textContent = `${Math.round(l[0] * 255)} · ${l[1].toFixed(2)} · ${Math.round(l[2] * 255)}` +
            (l[3] || l[4] !== 1 ? `  →  ${Math.round(l[3] * 255)} – ${Math.round(l[4] * 255)}` : '');
        const any = !!this.result();
        this.el('adj-reset').disabled = !any;
        this.root.classList.toggle('adj-changed', any);
    },

    css(name) {
        return getComputedStyle(this.root).getPropertyValue(name).trim();
    },

    // A canvas at its CSS size, for crisp lines: its 2D context, scaled
    fit(canvas) {
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, r.width, r.height);
        return { ctx, w: r.width, h: r.height };
    },

    CH_COLORS: { r: '#ff5b5b', g: '#4cd964', b: '#4c8dff' },

    // Red, green and blue over each other (where they meet: grey), or one
    drawHistogram() {
        const cv = this.el('adj-hist');
        if (!cv || !this.hist) return;
        const { ctx, w, h } = this.fit(cv);
        const H = this.hist;
        const chans = this.channel === 'rgb' ? ['r', 'g', 'b'] : [this.channel];
        // Scaled to the tallest bar but the very ends (clipped pixels pile up there)
        let peak = 1;
        for (const c of chans) for (let i = 2; i < 254; i++) peak = Math.max(peak, H[c][i]);
        const light = document.documentElement.dataset.theme === 'light';
        ctx.globalCompositeOperation = light ? 'multiply' : 'lighter';
        for (const c of chans) {
            ctx.fillStyle = this.CH_COLORS[c] + (chans.length > 1 ? 'a0' : 'd0');
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let i = 0; i < 256; i++) {
                const y = h - Math.min(1, Math.sqrt(H[c][i] / peak)) * (h - 2);
                ctx.lineTo((i / 255) * w, y);
            }
            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        // Clipping: a mark at an end with more than a sliver there
        const clip = (i) => chans.some(c => H[c][i] > H.n * 0.002);
        ctx.fillStyle = light ? '#1c1c1e' : '#fff';
        if (clip(0)) ctx.fillRect(0, 0, 3, 8);
        if (clip(255)) ctx.fillRect(w - 3, 0, 3, 8);
    },

    // ---- Levels: handles under the histogram ----
    //
    // Top row: black, middle grey and white in; below, a gradient with
    // black and white out

    initLevels() {
        const cv = this.el('adj-levels');
        cv.addEventListener('pointerdown', (e) => {
            if (!this.ready) return;
            const r = cv.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width, y = e.clientY - r.top;
            const l = this.a.levels[this.channel];
            const handles = y < 16
                ? [['in0', l[0]], ['gamma', this.gammaAt(l)], ['in1', l[2]]]
                : [['out0', l[3]], ['out1', l[4]]];
            let best = null, dist = 14 / r.width;
            for (const [k, at] of handles) {
                const d = Math.abs(at - x);
                if (d <= dist) { best = k; dist = d; }
            }
            if (!best) return;
            e.preventDefault();
            cv.setPointerCapture(e.pointerId);
            this.pushHistory();
            this._levelDrag = best;
            this.moveLevel(x);
        });
        cv.addEventListener('pointermove', (e) => {
            if (!this._levelDrag) return;
            const r = cv.getBoundingClientRect();
            this.moveLevel((e.clientX - r.left) / r.width);
        });
        const end = () => { this._levelDrag = null; };
        cv.addEventListener('pointerup', end);
        cv.addEventListener('pointercancel', end);
        cv.addEventListener('dblclick', () => this.resetSection('levels'));
    },

    // Where the middle handle sits: the input that comes out as mid grey
    gammaAt(l) {
        return l[0] + (l[2] - l[0]) * Math.pow(0.5, l[1]);
    },

    moveLevel(x) {
        const l = this.a.levels[this.channel];
        x = Math.min(1, Math.max(0, x));
        switch (this._levelDrag) {
            case 'in0': l[0] = Math.min(x, l[2] - 0.02); break;
            case 'in1': l[2] = Math.max(x, l[0] + 0.02); break;
            case 'gamma': {
                const t = Math.min(0.99, Math.max(0.01, (x - l[0]) / (l[2] - l[0])));
                l[1] = Math.min(9.99, Math.max(0.1, Math.log(t) / Math.log(0.5)));
                break;
            }
            case 'out0': l[3] = x; break;
            case 'out1': l[4] = x; break;
        }
        this.changed();
    },

    drawLevels() {
        const cv = this.el('adj-levels');
        if (!cv) return;
        const { ctx, w } = this.fit(cv);
        const l = this.a.levels[this.channel];
        const tri = (at, y, up, fill) => {
            const x = at * w;
            ctx.beginPath();
            ctx.moveTo(x, up ? y : y + 8);
            ctx.lineTo(x - 6, up ? y + 9 : y - 1);
            ctx.lineTo(x + 6, up ? y + 9 : y - 1);
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = this.css('--text-2') || '#999';
            ctx.lineWidth = 1;
            ctx.stroke();
        };
        const end = this.channel === 'rgb' ? '#ffffff' : this.CH_COLORS[this.channel];
        tri(l[0], 2, true, '#000');
        tri(this.gammaAt(l), 2, true, '#808080');
        tri(l[2], 2, true, end);
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, '#000');
        g.addColorStop(1, end);
        ctx.fillStyle = g;
        ctx.fillRect(0, 18, w, 6);
        tri(l[3], 26, true, '#000');
        tri(l[4], 26, true, end);
    },

    // ---- Curve ----

    initCurve() {
        const cv = this.el('adj-curve');
        const at = (e) => {
            const r = cv.getBoundingClientRect();
            return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height, r };
        };
        cv.addEventListener('pointerdown', (e) => {
            if (!this.ready) return;
            e.preventDefault();
            const p = at(e);
            const pts = this.a.curve[this.channel];
            let i = this.nearPoint(pts, p);
            this.pushHistory();
            if (i < 0) {
                if (pts.length >= 16) return;
                // A new point on the curve where it was clicked
                if (pts.some(q => Math.abs(q[0] - p.x) < 0.015)) return;
                const y = Develop.spline(pts)(p.x);
                pts.push([p.x, y]);
                pts.sort((a, b) => a[0] - b[0]);
                i = pts.findIndex(q => q[0] === p.x);
            }
            cv.setPointerCapture(e.pointerId);
            this._curveDrag = { i };
            this.changed();
        });
        cv.addEventListener('pointermove', (e) => {
            const d = this._curveDrag;
            if (!d) return;
            const p = at(e);
            const pts = this.a.curve[this.channel];
            const i = d.i;
            const lo = i > 0 ? pts[i - 1][0] + 0.01 : 0, hi = i < pts.length - 1 ? pts[i + 1][0] - 0.01 : 1;
            // Dragged well off the side (not an end): taken away
            const off = p.y < -0.12 || p.y > 1.12 || p.x < lo - 0.12 || p.x > hi + 0.12;
            if (off && i > 0 && i < pts.length - 1) {
                pts.splice(i, 1);
                this._curveDrag = null;
                this.changed();
                return;
            }
            pts[i] = [Math.min(hi, Math.max(lo, p.x)), Math.min(1, Math.max(0, p.y))];
            this.changed();
        });
        const end = () => { this._curveDrag = null; };
        cv.addEventListener('pointerup', end);
        cv.addEventListener('pointercancel', end);
        cv.addEventListener('dblclick', (e) => {
            const pts = this.a.curve[this.channel];
            const i = this.nearPoint(pts, at(e));
            if (i > 0 && i < pts.length - 1) {
                this.pushHistory();
                pts.splice(i, 1);
                this.changed();
            }
        });
    },

    nearPoint(pts, p) {
        const r = p.r;
        let best = -1, dist = 10;
        pts.forEach(([x, y], i) => {
            const d = Math.hypot((x - p.x) * r.width, (y - p.y) * r.height);
            if (d <= dist) { best = i; dist = d; }
        });
        return best;
    },

    drawCurve() {
        const cv = this.el('adj-curve');
        if (!cv) return;
        const { ctx, w, h } = this.fit(cv);
        const line = this.css('--border') || '#444';
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) {
            ctx.beginPath();
            ctx.moveTo((k / 4) * w, 0); ctx.lineTo((k / 4) * w, h);
            ctx.moveTo(0, (k / 4) * h); ctx.lineTo(w, (k / 4) * h);
            ctx.stroke();
        }
        // The histogram behind it, faint
        if (this.hist) {
            const bins = this.channel === 'rgb' ? this.hist.l : this.hist[this.channel];
            let peak = 1;
            for (let i = 2; i < 254; i++) peak = Math.max(peak, bins[i]);
            ctx.fillStyle = (this.css('--text-2') || '#888') ;
            ctx.globalAlpha = 0.18;
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * w, h - Math.min(1, Math.sqrt(bins[i] / peak)) * h * 0.9);
            ctx.lineTo(w, h);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(w, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        const pts = this.a.curve[this.channel];
        const f = Develop.spline(pts);
        const color = this.channel === 'rgb' ? (this.css('--text-1') || '#fff') : this.CH_COLORS[this.channel];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 128; i++) {
            const x = i / 128;
            const y = f(x);
            if (i) ctx.lineTo(x * w, (1 - y) * h);
            else ctx.moveTo(x * w, (1 - y) * h);
        }
        ctx.stroke();
        for (const [x, y] of pts) {
            ctx.beginPath();
            ctx.arc(x * w, (1 - y) * h, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = this.css('--bg-surface') || '#222';
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
};
