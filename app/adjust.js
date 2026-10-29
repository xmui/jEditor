// Adjust: looks, light, color, levels, curves, the color mixer, color
// grading and effects (vignette, grain), like
// Lightroom's Develop, on one photo at a time (E, or the sliders button).
// develop.js does the maths; this is the screen. The photo is shown as
// it's being changed (on the GPU, so the sliders keep up on a big scan),
// with its histogram, and Done keeps the settings with the photo: in a
// project, as an edit (edits.js), never in the file, so they can be
// changed again later from the photo as it was; Export, or Save edits,
// writes the result. Without a project (photos picked on a phone,
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
    COLOR: [['temp', 'Temperature'], ['tint', 'Tint'], ['vibrance', 'Vibrance'], ['saturation', 'Saturation']],
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
        bind('adj-reset', () => this.reset());
        bind('adj-copy', () => this.copy());
        bind('adj-paste', () => this.paste());
        bind('adj-auto', () => this.auto());
        bind('adj-auto-color', () => this.auto({ color: true }));
        this.el('adj-wb-pick').addEventListener('click', (e) => {
            e.preventDefault(); // in the section's head: not to fold it
            e.stopPropagation();
            e.currentTarget.blur();
            if (!this.busy) this.pickWhite();
        });
        // Picking white balance: a click on the photo is the grey, before
        // masks, spots or the 1:1 view see it
        this.el('adj-stage').addEventListener('pointerdown', (e) => {
            if (!this.picking || e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            this.pickAt(e);
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
        this.initLoupe();
        const effects = this.el('adj-effects');
        for (const [k, label] of this.EFFECTS) effects.appendChild(this.slider(k, label));
        this.el('adj-look-amount').appendChild(this.slider('lookAmount', 'Amount'));
        const grade = this.el('adj-grade-more');
        grade.appendChild(this.slider('gradeBlend', 'Blending'));
        grade.appendChild(this.slider('gradeBalance', 'Balance'));
        this.initLooks();
        this.initWheels();
        AdjustMasks.init(this);
        AdjustSpots.init(this);
        this.initPanes();
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
        // A section's Reset puts just that section back
        for (const b of this.root.querySelectorAll('[data-reset]')) {
            b.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                b.blur();
                this.resetSection(b.dataset.reset);
            });
        }

        this.initLevels();
        this.initCurve();
        this._resize = new ResizeObserver(() => { this.layout(); this.drawPanels(); this.placeLoupeBox(); AdjustMasks.place(); AdjustMasks.draw(); AdjustSpots.place(); AdjustSpots.draw(); this.placePaint(); });
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
        const look = Develop.look(this.a.look);
        if (look && this._inited && look.process !== this.lookTab) this.showLookTab(look.process);
        this.start = JSON.stringify(Develop.clean(this.a));
        this.root.classList.remove('hidden');
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
        this.map = Develop.cropMap(this.cropped, bmp.width, bmp.height);
        // The whole working copy, kept: spots are done on it, before the crop
        const base = document.createElement('canvas');
        base.width = bmp.width;
        base.height = bmp.height;
        base.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        this.dropPicture();
        this.base = base;
        // Paint goes over everything (paint.js): shown on top, as it will be
        const painted = Paint.has(kept) ? await Paint.prepare(kept).catch(() => null) : null;
        if (!current()) { this.dropPicture(); return; }
        const o = this.cropped ? this.cropped.outputRect() : { w: base.width, h: base.height };
        this.el('adj-dims').textContent = `${Math.round(o.w * scale)} × ${Math.round(o.h * scale)}`;
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
        for (const k of ['base', '_pre', '_all']) {
            const c = k === 'base' ? this.base : this[k] && this[k].canvas;
            if (c) c.width = c.height = 0;
        }
        this.base = null;
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
        this._looksKey = null;

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
        // And the looks' pictures
        const ts = Math.min(1, 84 / Math.max(bmp.width, bmp.height));
        sc.width = Math.max(1, Math.round(bmp.width * ts));
        sc.height = Math.max(1, Math.round(bmp.height * ts));
        sctx.drawImage(bmp, 0, 0, sc.width, sc.height);
        this.thumb = sctx.getImageData(0, 0, sc.width, sc.height);
        this.sampleOut = new Uint8ClampedArray(this.sample.length);

        if (this.gl) {
            this.gl.setImage(bmp);
            // Big enough for detail to show (a small photo): kept, to do it on
            if (this.pxScale >= 0.5) {
                this.srcData = bmp.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, bmp.width, bmp.height);
            } else {
                this.srcData = null;
            }
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
        if (this.picking) this.pickWhite(false);
        this.isOpen = false;
        this.ready = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
        this.src = this.out = this.sample = this.sampleOut = this.srcData = null;
        this.dropPicture();
        this.drawPaint(null);
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
        return JSON.stringify(this.result()) !== this.start;
    },

    // ---- Changing ----

    changed() {
        this.sync();
        this.schedule();
    },

    pushHistory() {
        const s = JSON.stringify(this.result());
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
        this.future.push(JSON.stringify(this.result()));
        this.setAll(JSON.parse(this.history.pop()), { history: false });
        return true;
    },

    redo() {
        if (!this.future.length) return false;
        this.history.push(JSON.stringify(this.result()));
        this.setAll(JSON.parse(this.future.pop()), { history: false });
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
        if (which === 'masks') delete a.masks;
        if (which === 'spots') delete a.spots;
        if (which === 'look' || which === 'basic') { delete a.look; delete a.lookAmount; }
        if (which === 'basic') for (const [k] of [...this.LIGHT, ...this.COLOR]) delete a[k];
        this.setAll(a);
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

    // White balance from the photo (W): click something that should be
    // white or grey, and Temperature and Tint make it so
    pickWhite(on = !this.picking) {
        if (on && !this.ready) return;
        this.picking = on;
        // W shows the button it presses: Edit, with Basic open
        if (on) { this.showPane('edit'); this.el('adj-basic-sec').open = true; }
        this.root.classList.toggle('adj-picking', on);
        this.el('adj-wb-pick').setAttribute('aria-pressed', String(on));
        if (on) this.app.showToast('Click something that should be white or grey (Esc to stop)', 2400, null, null, { kind: 'adjust' });
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
        const wb = Develop.neutralWB(px);
        if (!wb) {
            this.app.showToast('That\'s too bright or too dark to tell: click a light grey', 2400, null, null, { kind: 'adjust' });
            return;
        }
        this.pickWhite(false);
        this.pushHistory();
        this.a.temp = wb.temp;
        this.a.tint = wb.tint;
        this.changed();
        this.app.showToast(`White balance: Temperature ${wb.temp}, Tint ${wb.tint}`, 1600, null, null, { kind: 'adjust' });
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

    // The canvas at the stage's size, the photo fitted in it
    layout() {
        if (!this.ready) return;
        const box = this.el('adj-stage').getBoundingClientRect();
        const pad = 16;
        const s = Math.min((box.width - 2 * pad) / this.w, (box.height - 2 * pad) / this.h, 4);
        this.canvas.style.width = `${Math.max(1, Math.floor(this.w * s))}px`;
        this.canvas.style.height = `${Math.max(1, Math.floor(this.h * s))}px`;
        this.placePaint();
    },

    draw() {
        if (!this.ready) return;
        if (this.usePicture()) this.layout();
        const T = Develop.tables(this.a);
        // Halation's glow, from the whole picture (as saving makes it)
        let glow = null;
        if (T.fx && T.fx.hal[0]) {
            glow = Develop.glowMap(Develop.applyCPU(this.sample, { ...T, fx: null }, this.sampleOut), this.sampleW, this.sampleH);
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
                this.gl.draw(this.w, this.h, { before: this.before, frame: { x: 0, y: 0, W: this.w, H: this.h, map: this.map } });
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
        const px = this.before ? this.sample : Develop.applyCPU(this.sample, T, this.sampleOut, { x: 0, y: 0, w: this.sampleW, W: this.sampleW, H: this.sampleH, glow, map: this.map, brush });
        this.hist = Develop.histogram(px);
        this.drawPanels();
        AdjustMasks.draw();
        AdjustSpots.draw();
        this.looksSoon();
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
        // A click on the photo moves the 1:1 view there
        this.el('adj-stage').addEventListener('pointerdown', (e) => {
            if (!this.ready || !this.detailOpen()) return;
            const r = this.canvas.getBoundingClientRect();
            const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
            if (u < 0 || u > 1 || v < 0 || v > 1) return;
            this.loupeAt = { u, v };
            this.renderLoupe();
        });
    },

    // The working copy with detail done (debounced: it's on the CPU)
    detailSoon() {
        if (!this.gl || !this.srcData) return;
        const d = Develop.detail(this.a);
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

    // The photo at full size, cropped as it's being adjusted (for 1:1)
    loadFull() {
        const file = this.file;
        // Made again when the spots change (they're done on it first)
        const key = JSON.stringify(this.a.spots || []);
        if (this._fullFor === file && this._fullKey === key) return this._fullPromise;
        this._fullFor = file;
        this._fullKey = key;
        const kept = Edits.get(file);
        const spots = this.a.spots;
        this._fullPromise = (async () => {
            const bmp = await createImageBitmap(await this.app.readImage(file));
            const base = await Retouch.retouched(bmp, { adj: { spots } });
            let c;
            if (kept && !Edits.wholePhoto(kept)) {
                c = CropEditor.fromSnapshot(bmp.width, bmp.height, kept).drawOutput(base);
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
        })().catch((e) => { console.warn('Adjust: no full-size photo for 1:1:', e); return null; });
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
        if (this.fullCanvas && this._fullKey !== JSON.stringify(this.a.spots || [])) {
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
            const d = Develop.detail(this.a);
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
        const tabs = this.el('adj-look-tabs');
        try { this.lookTab = localStorage.getItem('jeditor.lookTab'); } catch (e) { /* private mode */ }
        if (!Develop.PROCESSES.some(p => p[0] === this.lookTab)) this.lookTab = 'C-41';
        for (const [id, label, title] of Develop.PROCESSES) {
            const b = document.createElement('button');
            b.className = 'adj-tab';
            b.dataset.tab = id;
            b.textContent = label;
            b.title = title;
            b.setAttribute('role', 'tab');
            b.addEventListener('click', () => { b.blur(); this.showLookTab(id); });
            tabs.appendChild(b);
        }
        const box = this.el('adj-looks');
        // One row in Basic: a mouse wheel moves along it, not down the panel
        box.addEventListener('wheel', (e) => {
            if (e.deltaX || e.ctrlKey || box.scrollWidth <= box.clientWidth) return;
            e.preventDefault();
            box.scrollLeft += e.deltaY;
        }, { passive: false });
        const tile = (look) => {
            const b = document.createElement('button');
            b.className = 'adj-look';
            b.dataset.look = look ? look.id : '';
            b.dataset.tab = look ? look.process : '';
            b.title = look ? `${look.maker} ${look.name} · ${look.code || look.process}\n${look.note}` : 'No look';
            b.innerHTML = '<canvas></canvas><span></span>';
            b.querySelector('span').textContent = look ? look.name : 'None';
            b.addEventListener('click', () => {
                b.blur();
                if (!this.ready) return;
                this.pushHistory();
                this.a.look = look ? look.id : null;
                if (!look) this.a.lookAmount = 100;
                this.changed();
            });
            box.appendChild(b);
        };
        tile(null);
        for (const l of Develop.LOOKS) tile(l);
        this.showLookTab(this.lookTab);
    },

    // Edit, Retouch and Masks. Retouch and Masks each hold one section
    // (spots, masks) that's open while its tab is shown, so the tools there
    // work only then; opening one of those sections shows its tab
    initPanes() {
        const tool = { retouch: this.el('adj-spots-sec'), masks: this.el('adj-masks-sec') };
        for (const b of this.root.querySelectorAll('.adj-pane-tabs .adj-tab')) {
            b.addEventListener('click', () => { b.blur(); this.showPane(b.dataset.pane); });
        }
        for (const [pane, sec] of Object.entries(tool)) {
            sec.querySelector('summary').addEventListener('click', (e) => e.preventDefault());
            sec.addEventListener('toggle', () => {
                if (sec.open) this.showPane(pane);
                else if (this.pane === pane) this.showPane('edit');
            });
        }
        // Edit's sections: opening one shows the tab and folds the one open before
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
        for (const b of this.root.querySelectorAll('.adj-pane-tabs .adj-tab')) b.setAttribute('aria-selected', String(b.dataset.pane === id));
        for (const p of this.root.querySelectorAll('.adj-pane')) p.classList.toggle('hidden', p.dataset.pane !== id);
        this.el('adj-spots-sec').open = id === 'retouch';
        this.el('adj-masks-sec').open = id === 'masks';
        this.drawPanels();
        this.drawWheels();
        this.placeLoupeBox();
        if (this.detailOpen()) this.renderLoupe();
    },

    // One process's films (None is always there)
    showLookTab(id) {
        this.lookTab = id;
        try { localStorage.setItem('jeditor.lookTab', id); } catch (e) { /* private mode */ }
        for (const b of this.root.querySelectorAll('.adj-look-tabs .adj-tab')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
        for (const b of this.root.querySelectorAll('.adj-look')) b.classList.toggle('hidden', !!b.dataset.tab && b.dataset.tab !== id);
        this._looksKey = null;
        if (this.ready) this.renderLooks();
    },

    // The pictures, once the sliders have rested
    looksSoon() {
        clearTimeout(this._looksTimer);
        this._looksTimer = setTimeout(() => this.renderLooks(), this._looksKey ? 350 : 0);
    },

    renderLooks() {
        if (!this.ready || !this.thumb) return;
        // Each look over the settings without one
        const base = { ...(this.result() || {}) };
        delete base.look;
        delete base.lookAmount;
        const key = JSON.stringify(base) + this.lookTab;
        if (key === this._looksKey) return;
        this._looksKey = key;
        const { width: w, height: h } = this.thumb;
        const out = new ImageData(w, h);
        for (const b of this.root.querySelectorAll('.adj-look:not(.hidden)')) {
            const cv = b.querySelector('canvas');
            cv.width = w;
            cv.height = h;
            const T = Develop.tables(b.dataset.look ? { ...base, look: b.dataset.look } : base);
            Develop.applyCPU(this.thumb.data, T, out.data, { x: 0, y: 0, w, W: w, H: h });
            cv.getContext('2d').putImageData(out, 0, 0);
        }
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
        for (const b of this.root.querySelectorAll('.adj-look')) b.setAttribute('aria-pressed', String((b.dataset.look || null) === this.a.look));
        this.el('adj-look-amount').classList.toggle('hidden', !this.a.look);
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
        ctx.globalCompositeOperation = 'lighter';
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
        ctx.fillStyle = '#fff';
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
