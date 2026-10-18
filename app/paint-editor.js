// Paint (B, or the brush button): painting over a photo, in layers, as a
// tool like Crop. paint.js keeps the layers with the photo's edit; this is
// the screen.
//
//   Move (V): drag the layer, or what's selected, and its handles to scale
//     and turn it; Enter puts it down
//   Select: rectangle (M), ellipse, lasso (L), magic wand (W, by colour);
//     Shift adds to the selection, Alt takes away; Ctrl+A all, Ctrl+D none
//   Brush (B), pencil (N), spray, eraser (E): size, hardness, opacity, flow
//   Fill (G), gradient: fill a colour, or a gradient to the background
//     colour (or to nothing)
//   Line (U), rectangle (R), ellipse (O): stroked, filled or both; Shift
//     keeps lines to 45° and shapes square
//   Text (T): click, type, Ctrl+Enter (or a click elsewhere) puts it down
//   Picker (I): the colour under it (Alt-click with any brush does too)
//   Hand (H, or hold Space): move about; the wheel zooms (on a Mac's
//     trackpad, two fingers move about and a pinch zooms)
//
// Everything is drawn on the photo as it is shown (cropped and turned as
// its edit says), and kept on the photo as it is on disk, so a crop later
// keeps it in place. Painting goes into a stroke of its own first, then
// onto the layer with the tool's opacity, inside the selection.

const PaintEditor = {
    isOpen: false,
    ready: false,
    busy: false,
    file: null,
    tool: 'brush',
    fg: '#e5484d',
    bg: '#ffffff',
    opts: {
        size: 24, hardness: 80, opacity: 100, flow: 100,
        tolerance: 32, contiguous: true, sampleAll: true,
        lineWidth: 8, shapeFill: 'none', arrow: false,
        gradient: 'linear', gradTo: 'bg',
        density: 40,
        font: 'system-ui, sans-serif', fontSize: 72, bold: false, italic: false
    },
    PALETTE: ['#000000', '#ffffff', '#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#8e4ec6', '#d6409f', '#8d6e63', '#9e9e9e', '#ffd6a5', '#caffbf', '#a0c4ff', '#ffadad'],
    FONTS: [['system-ui, sans-serif', 'Sans'], ['Georgia, serif', 'Serif'], ['"Courier New", monospace', 'Mono'], ['"Comic Sans MS", "Comic Neue", cursive', 'Comic'], ['Impact, "Arial Black", sans-serif', 'Impact']],

    TOOLS: [
        ['move', 'Move (V)', '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>'],
        ['sep'],
        ['rect-select', 'Rectangle select (M)', '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2"/>'],
        ['ellipse-select', 'Ellipse select', '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 2"/>'],
        ['lasso', 'Lasso (L)', '<path d="M7 18c-2-1-4-3-4-6 0-4 4-8 9-8s9 3 9 7-4 7-9 7c-1 0-2 0-3-.3" stroke-dasharray="3 2"/><path d="M7 18c-1 1-1 3 1 3"/>'],
        ['wand', 'Magic wand: select by colour (W)', '<path d="m15 4 .8 2.2L18 7l-2.2.8L15 10l-.8-2.2L12 7l2.2-.8z"/><path d="M3 21 13 11"/>'],
        ['sep'],
        ['brush', 'Brush (B)', '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z"/><path d="M9.2 12c-2.5 0-4.2 1.6-4.2 4 0 1.5-.8 2.6-2.4 3.4C4.4 21 6.3 21.5 8 21.5c3 0 5-1.9 4.9-4.6z"/>'],
        ['pencil', 'Pencil: hard edges (N)', '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>'],
        ['spray', 'Spray', '<path d="M9 3h3v4H9zM8 7h5v14H8z"/><path d="M16 6h.01M19 4h.01M19 8h.01M17 10h.01M21 6h.01"/>'],
        ['eraser', 'Eraser (E)', '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/><path d="M22 21H7M5 11l9 9"/>'],
        ['sep'],
        ['fill', 'Fill (G)', '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0z"/><path d="m5 2 5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4z"/>'],
        ['gradient', 'Gradient', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18" opacity=".5"/>'],
        ['sep'],
        ['line', 'Line (U)', '<path d="M5 19 19 5"/>'],
        ['rect', 'Rectangle (R)', '<rect x="4" y="6" width="16" height="12" rx="1"/>'],
        ['ellipse', 'Ellipse (O)', '<ellipse cx="12" cy="12" rx="9" ry="7"/>'],
        ['text', 'Text (T)', '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'],
        ['sep'],
        ['picker', 'Colour picker (I)', '<path d="m2 22 1-1h3l9-9M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/>'],
        ['hand', 'Hand: move about (H, or hold Space)', '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>']
    ],
    // What each tool's options are
    OPTIONS: {
        brush: ['size', 'hardness', 'opacity', 'flow'],
        pencil: ['size', 'opacity'],
        spray: ['size', 'density', 'opacity'],
        eraser: ['size', 'hardness', 'opacity'],
        fill: ['tolerance', 'contiguous', 'sampleAll', 'opacity'],
        gradient: ['gradient', 'gradTo', 'opacity'],
        line: ['lineWidth', 'arrow', 'opacity'],
        rect: ['lineWidth', 'shapeFill', 'opacity'],
        ellipse: ['lineWidth', 'shapeFill', 'opacity'],
        text: ['font', 'fontSize', 'bold', 'italic', 'opacity'],
        wand: ['tolerance', 'contiguous', 'sampleAll'],
        'rect-select': [], 'ellipse-select': [], lasso: [], move: [], picker: [], hand: []
    },
    HISTORY_BYTES: 400 * 1024 * 1024,

    el(id) { return document.getElementById(id); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        this.root = this.el('paint-editor');
        this.stage = this.el('paint-stage');
        this.canvas = this.el('paint-canvas');
        try {
            const kept = JSON.parse(localStorage.getItem('jeditor.paint') || 'null');
            if (kept && typeof kept === 'object') {
                for (const k of Object.keys(this.opts)) if (typeof kept[k] === typeof this.opts[k]) this.opts[k] = kept[k];
                if (/^#[0-9a-f]{6}$/i.test(kept.fg)) this.fg = kept.fg;
                if (/^#[0-9a-f]{6}$/i.test(kept.bg)) this.bg = kept.bg;
                if (this.OPTIONS[kept.tool]) this.tool = kept.tool;
            }
        } catch (e) { /* private mode */ }

        const tools = this.el('paint-tools');
        for (const [id, title, svg] of this.TOOLS) {
            if (id === 'sep') {
                const s = document.createElement('span');
                s.className = 'paint-tool-sep';
                tools.appendChild(s);
                continue;
            }
            const b = document.createElement('button');
            b.className = 'paint-tool';
            b.dataset.tool = id;
            b.title = title;
            b.setAttribute('aria-label', title.replace(/ \(.*\)$/, ''));
            b.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
            b.addEventListener('click', () => { b.blur(); this.setTool(id); });
            tools.appendChild(b);
        }
        const bind = (id, fn) => this.el(id).addEventListener('click', (e) => { e.currentTarget.blur(); if (!this.busy) fn(); });
        bind('paint-cancel', () => app.cancelPaint());
        bind('paint-done', () => app.savePaint());
        bind('paint-undo', () => this.undo());
        bind('paint-redo', () => this.redo());
        bind('paint-zoom-fit', () => this.fit());
        bind('paint-zoom-1', () => this.zoomTo(1));
        bind('paint-swap', () => this.swapColours());
        bind('paint-default', () => this.defaultColours());
        bind('paint-layer-add', () => this.addLayer());
        bind('paint-layer-dup', () => this.duplicateLayer());
        bind('paint-layer-up', () => this.moveLayer(1));
        bind('paint-layer-down', () => this.moveLayer(-1));
        bind('paint-layer-merge', () => this.mergeDown());
        bind('paint-layer-delete', () => this.deleteLayer());
        this.el('paint-fg').addEventListener('input', (e) => { this.fg = e.target.value; this.remember(); });
        this.el('paint-bg').addEventListener('input', (e) => { this.bg = e.target.value; this.remember(); });
        const pal = this.el('paint-palette');
        for (const c of this.PALETTE) {
            const b = document.createElement('button');
            b.style.background = c;
            b.title = `${c} (Alt-click: background)`;
            b.setAttribute('aria-label', c);
            b.addEventListener('click', (e) => { b.blur(); if (e.altKey) this.bg = c; else this.fg = c; this.syncColours(); this.remember(); });
            pal.appendChild(b);
        }
        const blend = this.el('paint-layer-blend');
        for (const [v, label] of Paint.BLENDS) {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = label;
            blend.appendChild(o);
        }
        blend.addEventListener('change', () => {
            const l = this.layer();
            if (!l) return;
            this.pushState();
            l.blend = blend.value;
            l.changed = true;
            this.afterState();
        });
        this.opacityRow = this.slider('Opacity', 0, 100, 1, () => Math.round((this.layer() ? this.layer().opacity : 1) * 100), (v, start) => {
            const l = this.layer();
            if (!l) return;
            if (start) this.pushState();
            l.opacity = v / 100;
            l.changed = true;
            this.renderSoon();
        }, () => this.afterState());
        this.el('paint-layer-opacity').appendChild(this.opacityRow);

        // The photo
        const st = this.stage;
        st.addEventListener('pointerdown', (e) => this.down(e));
        st.addEventListener('pointermove', (e) => this.move(e));
        st.addEventListener('pointerup', (e) => this.up(e));
        st.addEventListener('pointercancel', (e) => this.up(e));
        st.addEventListener('pointerleave', () => { this.hover = null; this.renderSoon(); });
        st.addEventListener('wheel', (e) => {
            if (!this.ready) return;
            e.preventDefault();
            const r = this.canvas.getBoundingClientRect();
            // On a Mac (wheel.js): two fingers move about, a pinch zooms
            if (Host.mac() && Wheel.kind(e) === 'trackpad') {
                this.view.x -= e.deltaX;
                this.view.y -= e.deltaY;
                this.positionText();
                this.renderSoon();
                return;
            }
            const k = Math.exp(-Wheel.pixels(e).y * (e.ctrlKey ? 0.01 : 0.0015));
            this.zoomAt(this.view.z * k, e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });
        st.addEventListener('dblclick', (e) => { if (this.tool === 'hand') this.fit(); });
        // Space held: the hand
        window.addEventListener('keydown', (e) => {
            if (!this.isOpen || e.code !== 'Space' || this.app.isTypingTarget(e.target)) return;
            e.preventDefault();
            if (!this.space) { this.space = true; this.cursor(); }
        }, true);
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && this.space) { this.space = false; this.cursor(); }
        }, true);
        // The text being typed
        const ta = this.el('paint-text');
        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.endText(false); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); this.endText(true); }
            else e.stopPropagation();
        });
        ta.addEventListener('input', () => this.sizeText());
        this._resize = new ResizeObserver(() => { if (this.ready) { this.sizeCanvas(); this.render(); } });
        this._resize.observe(st);
    },

    remember() {
        try { localStorage.setItem('jeditor.paint', JSON.stringify({ ...this.opts, fg: this.fg, bg: this.bg, tool: this.tool })); } catch (e) { /* private mode */ }
    },

    // A slider with its number, for the options bar and the layer panel.
    // set(value, start): start is true for the first change of a drag;
    // end(): the drag's over
    slider(label, min, max, step, get, set, end = null) {
        const row = document.createElement('label');
        row.className = 'paint-opt';
        row.innerHTML = '<span></span><input type="range"><span class="paint-num"></span>';
        row.querySelector('span').textContent = label;
        const input = row.querySelector('input'), num = row.querySelector('.paint-num');
        Object.assign(input, { min, max, step });
        input.setAttribute('aria-label', label);
        let sliding = false;
        input.addEventListener('input', () => {
            set(parseFloat(input.value), !sliding);
            sliding = true;
            num.textContent = input.value;
        });
        input.addEventListener('change', () => { sliding = false; input.blur(); if (end) end(); });
        row._sync = () => { const v = get(); input.value = v; num.textContent = String(v); };
        row._sync();
        return row;
    },

    // ---- Opening and closing ----

    async open(app, file) {
        this.init(app);
        this.file = file;
        this.ready = false;
        this.isOpen = true;
        this.history = [];
        this.future = [];
        this.historyBytes = 0;
        this.sel = null;
        this.float = null;
        this.drag = null;
        this.root.classList.remove('hidden');
        this.el('paint-file').textContent = file.name;
        this.el('paint-dims').textContent = 'Loading…';
        this.el('paint-done').title = Edits.canKeep() ? 'Keep the painting with the photo; the file isn\'t changed (Enter)' : 'Paint it into the photo (Enter)';
        const token = this._token = (this._token || 0) + 1;
        const current = () => this.isOpen && this.file === file && this._token === token;

        const kept = Edits.get(file);
        const data = await app.readImage(file);
        const bmp = await createImageBitmap(data);
        const fullW = bmp.width, fullH = bmp.height;
        const size = kept && kept.paint ? { w: kept.paint.w, h: kept.paint.h } : Paint.sizeFor(fullW, fullH);
        this.W = size.w;
        this.H = size.h;
        this.paintId = kept && kept.paint ? kept.paint.id : Paint.newId();
        // The photo at the layers' size, its spots done (for the fill and
        // the wand), and as shown: cropped and adjusted (behind the layers)
        const photo = document.createElement('canvas');
        photo.width = this.W;
        photo.height = this.H;
        const pg = photo.getContext('2d', { willReadFrequently: true });
        pg.imageSmoothingQuality = 'high';
        pg.drawImage(bmp, 0, 0, this.W, this.H);
        bmp.close();
        const base = await Retouch.retouched(photo, kept);
        if (base !== photo) photo.width = photo.height = 0;
        this.photo = base;
        this.ed = kept && !Edits.wholePhoto(kept) ? CropEditor.fromSnapshot(this.W, this.H, kept) : null;
        const shown = this.ed ? this.ed.drawOutput(base) : (() => { const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; c.getContext('2d').drawImage(base, 0, 0); return c; })();
        if (kept && kept.adj) Develop.applyCanvas(shown, kept.adj, { scale: this.W / fullW, map: Develop.cropMap(this.ed, this.W, this.H) });
        this.backdrop = shown;
        this.OW = shown.width;
        this.OH = shown.height;
        // Layer space (the photo as on disk) to the picture shown, and back
        if (this.ed) {
            const o = this.ed.outputRect();
            const [c, s] = this.ed.cs();
            this.C = new DOMMatrix([c, s, -s, c, -o.x0, -o.y0]).translate(-this.W / 2, -this.H / 2);
        } else {
            this.C = new DOMMatrix();
        }
        this.Ci = this.C.inverse();
        // The layers
        this.layers = [];
        if (kept && kept.paint) {
            for (const l of kept.paint.layers) {
                const c = this.newCanvas();
                const src = await Paint.layerBitmap(kept.paint, l);
                if (src) c.getContext('2d').drawImage(src, 0, 0, this.W, this.H);
                this.layers.push({ id: l.id, rev: l.rev, name: l.name, opacity: l.opacity, blend: l.blend, hidden: l.hidden, canvas: c, changed: false });
            }
        }
        if (!this.layers.length) this.layers.push(this.makeLayer('Layer 1'));
        this.cur = this.layers.length - 1;
        if (!current()) { this.dropCanvases(); return; }
        this.stroke = this.newCanvas();
        this.before = this.newCanvas();
        this.el('paint-dims').textContent = `${fullW} × ${fullH}`;
        this.ready = true;
        this.syncColours();
        this.setTool(this.tool);
        this.sizeCanvas();
        this.fit();
        this.drawLayers();
    },

    close() {
        if (this.text) this.endText(false);
        this.isOpen = false;
        this.ready = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
        this.dropCanvases();
        this.history = this.future = [];
        if (this.root) this.root.classList.add('hidden');
        this.file = null;
    },

    dropCanvases() {
        const all = [this.photo, this.backdrop, this.stroke, this.before, this.sel && this.sel.mask, this.sel && this.sel.edge, this.float && this.float.canvas, this._scratch];
        for (const l of this.layers || []) all.push(l.canvas);
        for (const c of all) if (c) c.width = c.height = 0;
        this.photo = this.backdrop = this.stroke = this.before = this._scratch = null;
        this.layers = [];
        this.sel = this.float = null;
    },

    newCanvas(w = this.W, h = this.H) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
    },

    makeLayer(name) {
        return { id: Paint.newId().slice(-8), rev: null, name, opacity: 1, blend: 'source-over', hidden: false, canvas: this.newCanvas(), changed: true };
    },

    layer() {
        return (this.layers && this.layers[this.cur]) || null;
    },

    // Anything painted (not saved yet)
    changedSinceOpen() {
        return this.history.length > 0 || !!this.float;
    },

    // ---- The tool ----

    setTool(id) {
        if (!this.OPTIONS[id]) return;
        if (this.text) this.endText(true);
        if (this.float && id !== 'move') this.commitFloat();
        this.tool = id;
        this.remember();
        for (const b of this.root.querySelectorAll('.paint-tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
        this.buildOptions();
        this.cursor();
        this.renderSoon();
    },

    cursor() {
        const t = this.space || this.tool === 'hand' ? (this.drag && this.drag.kind === 'pan' ? 'grabbing' : 'grab')
            : this.tool === 'move' ? 'move'
            : this.tool === 'text' ? 'text'
            : ['brush', 'pencil', 'spray', 'eraser'].includes(this.tool) ? 'none' : 'crosshair';
        this.stage.style.cursor = t;
    },

    buildOptions() {
        const box = this.el('paint-options');
        box.textContent = '';
        const o = this.opts;
        const save = () => this.remember();
        const add = (el) => { box.appendChild(el); return el; };
        const check = (label, key) => {
            const l = document.createElement('label');
            l.className = 'paint-opt';
            l.innerHTML = '<input type="checkbox"><span></span>';
            l.querySelector('span').textContent = label;
            const i = l.querySelector('input');
            i.checked = !!o[key];
            i.addEventListener('change', () => { o[key] = i.checked; save(); i.blur(); });
            return add(l);
        };
        const choose = (label, key, items) => {
            const l = document.createElement('label');
            l.className = 'paint-opt';
            l.innerHTML = '<span></span><select class="field"></select>';
            l.querySelector('span').textContent = label;
            const sel = l.querySelector('select');
            for (const [v, t] of items) {
                const op = document.createElement('option');
                op.value = v;
                op.textContent = t;
                sel.appendChild(op);
            }
            sel.value = String(o[key]);
            sel.addEventListener('change', () => { o[key] = typeof o[key] === 'number' ? +sel.value : sel.value; save(); sel.blur(); });
            return add(l);
        };
        const num = (label, key, min, max, step = 1) => add(this.slider(label, min, max, step, () => o[key], (v) => { o[key] = v; save(); this.renderSoon(); }));
        for (const k of this.OPTIONS[this.tool]) {
            if (k === 'size') num('Size', 'size', 1, 400);
            if (k === 'hardness') num('Hardness', 'hardness', 0, 100);
            if (k === 'opacity') num('Opacity', 'opacity', 1, 100);
            if (k === 'flow') num('Flow', 'flow', 1, 100);
            if (k === 'density') num('Density', 'density', 1, 100);
            if (k === 'tolerance') num('Tolerance', 'tolerance', 0, 255);
            if (k === 'lineWidth') num('Line', 'lineWidth', 0, 200);
            if (k === 'fontSize') num('Size', 'fontSize', 6, 600);
            if (k === 'contiguous') check('Joined only', 'contiguous');
            if (k === 'sampleAll') check('All layers', 'sampleAll');
            if (k === 'arrow') check('Arrow', 'arrow');
            if (k === 'bold') check('Bold', 'bold');
            if (k === 'italic') check('Italic', 'italic');
            if (k === 'shapeFill') choose('Fill', 'shapeFill', [['none', 'None'], ['fg', 'Foreground'], ['bg', 'Background']]);
            if (k === 'gradient') choose('Shape', 'gradient', [['linear', 'Linear'], ['radial', 'Radial']]);
            if (k === 'gradTo') choose('To', 'gradTo', [['bg', 'Background colour'], ['clear', 'Nothing']]);
            if (k === 'font') choose('Font', 'font', this.FONTS);
        }
        const hint = document.createElement('span');
        hint.className = 'paint-opt';
        hint.textContent = {
            move: this.sel ? 'Drag what\'s selected; its corners scale it, the knob above turns it. Enter puts it down' : 'Drag the layer; select first to move part of it',
            'rect-select': 'Drag a rectangle. Shift adds, Alt takes away; Ctrl+D selects nothing',
            'ellipse-select': 'Drag an ellipse. Shift adds, Alt takes away',
            lasso: 'Draw round what to select. Shift adds, Alt takes away',
            wand: 'Click a colour to select it. Shift adds, Alt takes away',
            picker: 'Click for the foreground colour, Alt-click for the background',
            hand: 'Drag to move about; the wheel zooms; double-click fits',
            text: 'Click where the text goes; Ctrl+Enter puts it down',
            fill: 'Click to fill with the foreground colour',
            gradient: 'Drag from where it starts to where it ends'
        }[this.tool] || '';
        if (hint.textContent) {
            hint.style.color = 'var(--text-3, var(--text-2))';
            add(hint);
        }
    },

    // ---- Colours ----

    syncColours() {
        this.el('paint-fg').value = this.fg;
        this.el('paint-bg').value = this.bg;
    },

    swapColours() {
        [this.fg, this.bg] = [this.bg, this.fg];
        this.syncColours();
        this.remember();
    },

    defaultColours() {
        this.fg = '#000000';
        this.bg = '#ffffff';
        this.syncColours();
        this.remember();
    },

    // ---- The view ----

    sizeCanvas() {
        const r = this.stage.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.cssW = r.width;
        this.cssH = r.height;
        this.canvas.width = Math.max(1, Math.round(r.width * dpr));
        this.canvas.height = Math.max(1, Math.round(r.height * dpr));
        this.dpr = dpr;
    },

    fit() {
        if (!this.ready) return;
        const pad = 24;
        const z = Math.min((this.cssW - 2 * pad) / this.OW, (this.cssH - 2 * pad) / this.OH, 8);
        this.view = { z, x: (this.cssW - this.OW * z) / 2, y: (this.cssH - this.OH * z) / 2 };
        this.render();
    },

    zoomTo(z) {
        this.zoomAt(z, this.cssW / 2, this.cssH / 2);
    },

    zoomAt(z, cx, cy) {
        if (!this.ready) return;
        z = Math.min(32, Math.max(0.02, z));
        const v = this.view;
        const ox = (cx - v.x) / v.z, oy = (cy - v.y) / v.z;
        this.view = { z, x: cx - ox * z, y: cy - oy * z };
        this.positionText();
        this.renderSoon();
    },

    // The view as a matrix: the picture shown (output px) → css px
    V() {
        return new DOMMatrix([this.view.z, 0, 0, this.view.z, this.view.x, this.view.y]);
    },

    // A pointer event → the picture shown (output px) and layer px
    point(e) {
        const r = this.canvas.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        const o = this.V().inverse().transformPoint({ x: sx, y: sy });
        const l = this.Ci.transformPoint(o);
        return { sx, sy, ox: o.x, oy: o.y, x: l.x, y: l.y };
    },

    renderSoon() {
        if (this._raf || !this.ready) return;
        this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
    },

    render() {
        if (!this.ready) return;
        const ctx = this.canvas.getContext('2d');
        const dpr = this.dpr || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const VD = new DOMMatrix([dpr, 0, 0, dpr, 0, 0]).multiply(this.V());
        ctx.setTransform(VD);
        ctx.imageSmoothingEnabled = this.view.z < 2;
        ctx.imageSmoothingQuality = 'high';
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 12;
        ctx.drawImage(this.backdrop, 0, 0);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        // Clipped to the picture (a crop shows only its part of the layers)
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, this.OW, this.OH);
        ctx.clip();
        const LD = VD.multiply(this.C);
        this.layers.forEach((l, i) => {
            if (l.hidden) return;
            ctx.save();
            ctx.globalAlpha = l.opacity;
            ctx.globalCompositeOperation = l.blend;
            ctx.setTransform(LD);
            let src = l.canvas;
            // The stroke being made, shown as it'll go on
            if (i === this.cur && this.drag && this.drag.stroke) {
                src = this.scratch();
                const g = src.getContext('2d');
                g.globalCompositeOperation = 'copy';
                g.drawImage(l.canvas, 0, 0);
                this.putStroke(g);
            }
            ctx.drawImage(src, 0, 0);
            if (i === this.cur && this.float) this.drawFloat(ctx, VD);
            ctx.restore();
        });
        ctx.restore();
        this.drawSelection(ctx, VD, LD);
        this.drawGuides(ctx, VD, LD);
    },

    // A spare layer-sized canvas
    scratch() {
        if (!this._scratch) this._scratch = this.newCanvas();
        return this._scratch;
    },

    // ---- Pointer ----

    down(e) {
        if (!this.ready || this.busy) return;
        if (e.button === 1 || e.button === 2) {
            if (e.button === 1) this.startPan(e);
            return;
        }
        e.preventDefault();
        try { this.stage.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
        const p = this.point(e);
        if (this.space || this.tool === 'hand') { this.startPan(e); return; }
        if (this.text && e.target !== this.el('paint-text')) { this.endText(true); return; }
        const t = this.tool;
        if (e.altKey && ['brush', 'pencil', 'spray', 'fill', 'line', 'rect', 'ellipse', 'gradient', 'text'].includes(t)) {
            this.pick(p, false);
            return;
        }
        if (t === 'picker') { this.pick(p, e.altKey); return; }
        if (!this.layer()) return;
        if (this.layer().hidden && !['rect-select', 'ellipse-select', 'lasso', 'wand', 'move'].includes(t)) {
            this.app.showToast('That layer is hidden: show it to paint on it', 2000);
            return;
        }
        if (['brush', 'pencil', 'spray', 'eraser'].includes(t)) return this.startStroke(p);
        if (['line', 'rect', 'ellipse', 'gradient', 'rect-select', 'ellipse-select'].includes(t)) {
            this.drag = { kind: 'shape', start: p, end: p, mode: e.altKey ? 'sub' : e.shiftKey && t.endsWith('select') ? 'add' : 'new' };
            return;
        }
        if (t === 'lasso') {
            this.drag = { kind: 'lasso', pts: [p], mode: e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new' };
            return;
        }
        if (t === 'wand') { this.wand(p, e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new'); return; }
        if (t === 'fill') { this.fillAt(p); return; }
        if (t === 'text') { this.startText(p); return; }
        if (t === 'move') { this.startMove(p); return; }
    },

    move(e) {
        if (!this.ready) return;
        const p = this.point(e);
        this.hover = p;
        const d = this.drag;
        if (!d) { this.renderSoon(); return; }
        if (d.kind === 'pan') {
            this.view.x = d.vx + (p.sx - d.sx);
            this.view.y = d.vy + (p.sy - d.sy);
            this.positionText();
        } else if (d.kind === 'paint') {
            this.strokeTo(p);
        } else if (d.kind === 'shape') {
            d.end = p;
            d.shift = e.shiftKey;
        } else if (d.kind === 'lasso') {
            const last = d.pts[d.pts.length - 1];
            if (Math.hypot(p.sx - last.sx, p.sy - last.sy) >= 2) d.pts.push(p);
        } else if (d.kind === 'float') {
            this.dragFloat(p, e.shiftKey);
        }
        this.renderSoon();
    },

    up(e) {
        const d = this.drag;
        if (this.stage.hasPointerCapture && this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
        if (!d) return;
        if (d.kind === 'paint') this.endStroke();
        else if (d.kind === 'shape') this.endShape(d);
        else if (d.kind === 'lasso') this.endLasso(d);
        this.drag = null;
        this.cursor();
        this.renderSoon();
    },

    startPan(e) {
        const p = this.point(e);
        this.drag = { kind: 'pan', sx: p.sx, sy: p.sy, vx: this.view.x, vy: this.view.y };
        this.cursor();
    },

    pick(p, toBg) {
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        const dpr = this.dpr || 1;
        const px = ctx.getImageData(Math.round(p.sx * dpr), Math.round(p.sy * dpr), 1, 1).data;
        const hex = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        if (toBg) this.bg = hex; else this.fg = hex;
        this.syncColours();
        this.remember();
    },

    // ---- Undo ----

    // Before a change to a layer's pixels: the layer as it was
    beginPixels(l) {
        const g = this.before.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.drawImage(l.canvas, 0, 0);
        g.globalCompositeOperation = 'source-over';
        this._beforeOf = l;
    },

    // After it: the part that changed (r), before and after
    endPixels(l, r) {
        r = this.clampRect(r);
        if (!r || this._beforeOf !== l) return;
        const before = this.before.getContext('2d', { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h);
        const after = l.canvas.getContext('2d', { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h);
        l.changed = true;
        this.record({ kind: 'px', layer: l, r, before, after, bytes: r.w * r.h * 8 });
    },

    clampRect(r) {
        if (!r) return null;
        const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
        const x1 = Math.min(this.W, Math.ceil(r.x + r.w)), y1 = Math.min(this.H, Math.ceil(r.y + r.h));
        return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    },

    record(entry) {
        this.history.push(entry);
        this.historyBytes += entry.bytes || 0;
        this.future = [];
        while (this.history.length > 1 && (this.history.length > 60 || this.historyBytes > this.HISTORY_BYTES)) {
            this.historyBytes -= this.history.shift().bytes || 0;
        }
        this.drawLayersSoon();
    },

    // The layer list as it is (for undoing a change to it)
    snapshot() {
        return { layers: this.layers.map(l => ({ ...l })), cur: this.cur };
    },

    pushState() {
        this._state = this.snapshot();
    },

    afterState(extra = null) {
        const before = this._state;
        this._state = null;
        if (!before) return;
        const entry = { kind: 'state', before, after: this.snapshot(), extra, bytes: extra ? extra.bytes : 0 };
        this.record(entry);
        this.drawLayers();
        this.renderSoon();
    },

    apply(entry, undo) {
        if (entry.kind === 'px') {
            entry.layer.canvas.getContext('2d').putImageData(undo ? entry.before : entry.after, entry.r.x, entry.r.y);
            entry.layer.changed = true;
        } else if (entry.kind === 'state') {
            if (undo && entry.extra) this.apply(entry.extra, true);
            const s = undo ? entry.before : entry.after;
            this.layers = s.layers.map(l => ({ ...l, changed: true }));
            this.cur = Math.min(s.cur, this.layers.length - 1);
            if (!undo && entry.extra) this.apply(entry.extra, false);
        }
    },

    undo() {
        if (this.float) { this.cancelFloat(); return true; }
        if (this.text) { this.endText(false); return true; }
        const e = this.history.pop();
        if (!e) return false;
        this.historyBytes -= e.bytes || 0;
        this.apply(e, true);
        this.future.push(e);
        this.drawLayers();
        this.renderSoon();
        return true;
    },

    redo() {
        const e = this.future.pop();
        if (!e) return false;
        this.apply(e, false);
        this.history.push(e);
        this.historyBytes += e.bytes || 0;
        this.drawLayers();
        this.renderSoon();
        return true;
    },

    // ---- Brushes ----

    startStroke(p) {
        const l = this.layer();
        this.beginPixels(l);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, this.W, this.H);
        this.drag = { kind: 'paint', stroke: true, last: p, dirty: null, tool: this.tool, carry: 0 };
        this.dab(p);
        if (this.tool === 'spray') this.sprayLoop();
        this.renderSoon();
    },

    // Brush size in layer px (sizes are the photo's own pixels)
    radius() {
        return Math.max(0.5, this.opts.size / 2);
    },

    grow(r) {
        const d = this.drag;
        if (!d.dirty) d.dirty = { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
        else {
            d.dirty.x0 = Math.min(d.dirty.x0, r.x); d.dirty.y0 = Math.min(d.dirty.y0, r.y);
            d.dirty.x1 = Math.max(d.dirty.x1, r.x + r.w); d.dirty.y1 = Math.max(d.dirty.y1, r.y + r.h);
        }
    },

    dab(p) {
        const g = this.stroke.getContext('2d');
        const r = this.radius(), t = this.drag.tool;
        const colour = t === 'eraser' ? '#000000' : this.fg;
        if (t === 'pencil') {
            const s = Math.max(1, Math.round(this.opts.size));
            g.fillStyle = colour;
            g.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
            this.grow({ x: p.x - s, y: p.y - s, w: 2 * s, h: 2 * s });
            return;
        }
        if (t === 'spray') {
            const n = Math.max(1, Math.round(this.opts.density * r * r / 400));
            const dot = Math.max(0.6, r / 24);
            g.fillStyle = colour;
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
                g.beginPath();
                g.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, dot, 0, Math.PI * 2);
                g.fill();
            }
            this.grow({ x: p.x - r - 2, y: p.y - r - 2, w: 2 * r + 4, h: 2 * r + 4 });
            return;
        }
        const hard = t === 'eraser' || t === 'brush' ? this.opts.hardness / 100 : 1;
        const flow = t === 'brush' ? this.opts.flow / 100 : 1;
        const rgb = this.rgb(colour);
        if (hard >= 0.99) {
            g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${flow})`;
        } else {
            const grad = g.createRadialGradient(p.x, p.y, r * hard, p.x, p.y, r);
            grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${flow})`);
            grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
            g.fillStyle = grad;
        }
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        g.fill();
        this.grow({ x: p.x - r - 1, y: p.y - r - 1, w: 2 * r + 2, h: 2 * r + 2 });
    },

    strokeTo(p) {
        const d = this.drag, a = d.last;
        if (d.tool === 'spray') { d.last = p; return; }
        const len = Math.hypot(p.x - a.x, p.y - a.y);
        const step = d.tool === 'pencil' ? 1 : Math.max(0.5, this.radius() * 0.18);
        let t = step - d.carry;
        while (t <= len) {
            const k = t / len;
            this.dab({ x: a.x + (p.x - a.x) * k, y: a.y + (p.y - a.y) * k });
            t += step;
        }
        d.carry = len - (t - step);
        d.last = p;
    },

    sprayLoop() {
        const d = this.drag;
        if (!d || d.kind !== 'paint' || d.tool !== 'spray') return;
        this.dab(d.last);
        this.renderSoon();
        setTimeout(() => this.sprayLoop(), 30);
    },

    // The stroke onto a layer's context (the layer itself, or the preview
    // of it): inside the selection, with the tool's opacity
    putStroke(g) {
        const d = this.drag;
        if (this.sel) {
            const sg = this.stroke.getContext('2d');
            sg.globalCompositeOperation = 'destination-in';
            sg.drawImage(this.sel.mask, 0, 0);
            sg.globalCompositeOperation = 'source-over';
        }
        g.save();
        g.globalAlpha = this.opts.opacity / 100;
        g.globalCompositeOperation = d && d.tool === 'eraser' ? 'destination-out' : 'source-over';
        g.drawImage(this.stroke, 0, 0);
        g.restore();
    },

    endStroke() {
        const d = this.drag, l = this.layer();
        if (!d.dirty) return;
        this.putStroke(l.canvas.getContext('2d'));
        const r = { x: d.dirty.x0, y: d.dirty.y0, w: d.dirty.x1 - d.dirty.x0, h: d.dirty.y1 - d.dirty.y0 };
        this.stroke.getContext('2d').clearRect(0, 0, this.W, this.H);
        this.drag = null;
        this.endPixels(l, r);
    },

    rgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },

    // ---- Shapes, gradients and rectangle/ellipse selections ----
    //
    // Drawn in the picture as shown (so a square looks square however the
    // photo's turned), onto layer space through Ci

    shapeGeom(d) {
        let a = { x: d.start.ox, y: d.start.oy }, b = { x: d.end.ox, y: d.end.oy };
        if (d.shift) {
            if (this.tool === 'line' || this.tool === 'gradient') {
                const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
            } else {
                const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
                b = { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s };
            }
        }
        return { a, b };
    },

    // A shape's path, in the picture as shown
    shapePath(kind, a, b) {
        const p = new Path2D();
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        if (kind === 'rect' || kind === 'rect-select') p.rect(x, y, w, h);
        else if (kind === 'ellipse' || kind === 'ellipse-select') p.ellipse(x + w / 2, y + h / 2, w / 2 || 0.01, h / 2 || 0.01, 0, 0, Math.PI * 2);
        else { p.moveTo(a.x, a.y); p.lineTo(b.x, b.y); }
        return p;
    },

    // Shape options as drawn: draws onto g (already set to output space)
    drawShape(g, kind, a, b) {
        const o = this.opts;
        const path = this.shapePath(kind, a, b);
        g.lineJoin = 'round';
        g.lineCap = 'round';
        if (kind !== 'line' && o.shapeFill !== 'none') {
            g.fillStyle = o.shapeFill === 'bg' ? this.bg : this.fg;
            g.fill(path);
        }
        if (o.lineWidth > 0) {
            g.strokeStyle = this.fg;
            g.lineWidth = o.lineWidth;
            g.stroke(path);
            if (kind === 'line' && o.arrow) {
                const ang = Math.atan2(b.y - a.y, b.x - a.x), L = Math.max(10, o.lineWidth * 4);
                g.beginPath();
                g.moveTo(b.x, b.y);
                g.lineTo(b.x - Math.cos(ang - 0.45) * L, b.y - Math.sin(ang - 0.45) * L);
                g.lineTo(b.x - Math.cos(ang + 0.45) * L, b.y - Math.sin(ang + 0.45) * L);
                g.closePath();
                g.fillStyle = this.fg;
                g.fill();
            }
        }
    },

    // A shape's bounds in layer px (for undo)
    layerBounds(pts, pad = 0) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of pts) {
            const l = this.Ci.transformPoint(q);
            x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y); x1 = Math.max(x1, l.x); y1 = Math.max(y1, l.y);
        }
        return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    },

    endShape(d) {
        const t = this.tool;
        const { a, b } = this.shapeGeom(d);
        const tiny = Math.hypot(b.x - a.x, b.y - a.y) * this.view.z < 3;
        if (t === 'rect-select' || t === 'ellipse-select') {
            if (tiny) { if (d.mode === 'new') this.deselect(); return; }
            this.selectPath(this.shapePath(t, a, b), d.mode);
            return;
        }
        if (tiny) return;
        const l = this.layer();
        this.beginPixels(l);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.W, this.H);
        g.setTransform(this.Ci);
        let r;
        if (t === 'gradient') {
            const o = this.opts;
            const grad = o.gradient === 'radial'
                ? g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y))
                : g.createLinearGradient(a.x, a.y, b.x, b.y);
            grad.addColorStop(0, this.fg);
            const to = this.rgb(this.bg);
            grad.addColorStop(1, o.gradTo === 'clear' ? `rgba(${this.rgb(this.fg).join(',')},0)` : `rgb(${to.join(',')})`);
            g.fillStyle = grad;
            g.fillRect(-1e5, -1e5, 2e5, 2e5);
            r = { x: 0, y: 0, w: this.W, h: this.H };
        } else {
            this.drawShape(g, t, a, b);
            const pad = this.opts.lineWidth * (this.opts.arrow ? 4 : 1) + 4;
            r = this.layerBounds([a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }], pad);
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        this.drag = { tool: t };
        this.putStroke(l.canvas.getContext('2d'));
        this.drag = null;
        g.clearRect(0, 0, this.W, this.H);
        this.endPixels(l, r);
    },

    // ---- Selections ----
    //
    // A mask the size of the layers (alpha: how much is selected), and its
    // edge for showing it

    selectPath(path, mode) {
        const m = this.newCanvas();
        const g = m.getContext('2d');
        g.setTransform(this.Ci);
        g.fillStyle = '#000';
        g.fill(path);
        this.combineSelection(m, mode);
    },

    combineSelection(m, mode) {
        if (this.float) this.commitFloat();
        if (mode !== 'new' && this.sel) {
            const g = this.sel.mask.getContext('2d');
            g.globalCompositeOperation = mode === 'sub' ? 'destination-out' : 'source-over';
            g.drawImage(m, 0, 0);
            g.globalCompositeOperation = 'source-over';
            m.width = m.height = 0;
        } else if (mode === 'sub') {
            m.width = m.height = 0;
            return;
        } else {
            this.dropSelection();
            this.sel = { mask: m };
        }
        this.selectionChanged();
    },

    dropSelection() {
        if (this.sel) {
            if (this.sel.mask) this.sel.mask.width = this.sel.mask.height = 0;
            if (this.sel.edge) this.sel.edge.width = this.sel.edge.height = 0;
        }
        this.sel = null;
    },

    // Its bounds and edge, worked out again; an empty one is none
    selectionChanged() {
        const m = this.sel.mask;
        const d = m.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.W, this.H).data;
        const W = this.W, H = this.H;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (d[(y * W + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) { this.dropSelection(); this.buildOptions(); this.renderSoon(); return; }
        this.sel.box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
        // The edge: selected pixels next to unselected ones
        const e = this.newCanvas();
        const eg = e.getContext('2d');
        const img = eg.createImageData(W, H);
        const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 127;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            if (!at(x, y)) continue;
            if (at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1)) continue;
            const i = (y * W + x) * 4, dark = ((x + y) >> 2) & 1;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = dark ? 0 : 255;
            img.data[i + 3] = 255;
        }
        eg.putImageData(img, 0, 0);
        if (this.sel.edge) this.sel.edge.width = this.sel.edge.height = 0;
        this.sel.edge = e;
        this.buildOptions();
        this.renderSoon();
    },

    selectAll() {
        if (!this.ready) return;
        const m = this.newCanvas();
        m.getContext('2d').fillRect(0, 0, this.W, this.H);
        this.combineSelection(m, 'new');
    },

    deselect() {
        if (this.float) this.commitFloat();
        this.dropSelection();
        this.buildOptions();
        this.renderSoon();
    },

    endLasso(d) {
        if (d.pts.length < 3) { if (d.mode === 'new') this.deselect(); return; }
        const p = new Path2D();
        d.pts.forEach((q, i) => i ? p.lineTo(q.ox, q.oy) : p.moveTo(q.ox, q.oy));
        p.closePath();
        this.selectPath(p, d.mode);
    },

    // What the fill and the wand look at: the photo and the layers shown,
    // or just this layer (RGBA bytes at layer size)
    sample() {
        const c = this.scratch();
        const g = c.getContext('2d', { willReadFrequently: true });
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'copy';
        if (this.opts.sampleAll) {
            g.drawImage(this.photo, 0, 0, this.W, this.H);
            g.globalCompositeOperation = 'source-over';
            for (const l of this.layers) {
                if (l.hidden) continue;
                g.globalAlpha = l.opacity;
                g.globalCompositeOperation = l.blend;
                g.drawImage(l.canvas, 0, 0);
            }
            g.globalAlpha = 1;
        } else {
            g.drawImage(this.layer().canvas, 0, 0);
        }
        g.globalCompositeOperation = 'source-over';
        return g.getImageData(0, 0, this.W, this.H).data;
    },

    // The pixels like the one at (x, y): a mask (1 each), and its bounds
    region(px, x, y) {
        const W = this.W, H = this.H;
        x = Math.floor(x); y = Math.floor(y);
        if (x < 0 || y < 0 || x >= W || y >= H) return null;
        const tol = this.opts.tolerance;
        const i0 = (y * W + x) * 4;
        const c = [px[i0], px[i0 + 1], px[i0 + 2], px[i0 + 3]];
        const like = (i) => Math.abs(px[i] - c[0]) <= tol && Math.abs(px[i + 1] - c[1]) <= tol && Math.abs(px[i + 2] - c[2]) <= tol && Math.abs(px[i + 3] - c[3]) <= tol;
        const mask = new Uint8Array(W * H);
        let x0 = x, x1 = x, y0 = y, y1 = y;
        if (!this.opts.contiguous) {
            for (let k = 0; k < W * H; k++) if (like(k * 4)) {
                mask[k] = 1;
                const xx = k % W, yy = (k - xx) / W;
                if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
            }
        } else {
            // Scanlines
            const stack = [[x, y]];
            while (stack.length) {
                const [sx, sy] = stack.pop();
                let lx = sx;
                while (lx >= 0 && !mask[sy * W + lx] && like((sy * W + lx) * 4)) lx--;
                lx++;
                let rx = lx;
                let up = false, down = false;
                while (rx < W && !mask[sy * W + rx] && like((sy * W + rx) * 4)) {
                    mask[sy * W + rx] = 1;
                    if (sy > 0) {
                        const u = like(((sy - 1) * W + rx) * 4) && !mask[(sy - 1) * W + rx];
                        if (u && !up) { stack.push([rx, sy - 1]); up = true; } else if (!u) up = false;
                    }
                    if (sy < H - 1) {
                        const dn = like(((sy + 1) * W + rx) * 4) && !mask[(sy + 1) * W + rx];
                        if (dn && !down) { stack.push([rx, sy + 1]); down = true; } else if (!dn) down = false;
                    }
                    rx++;
                }
                if (lx < x0) x0 = lx; if (rx - 1 > x1) x1 = rx - 1;
                if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
            }
        }
        return { mask, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
    },

    // A region as a canvas (white where it is), a pixel's anti-aliasing
    // round its edge
    regionCanvas(reg, colour) {
        const c = this.newCanvas();
        const g = c.getContext('2d');
        const { x, y, w, h } = reg.box;
        const img = g.createImageData(w, h);
        const rgb = this.rgb(colour);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
            if (!reg.mask[(y + yy) * this.W + x + xx]) continue;
            const i = (yy * w + xx) * 4;
            img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
        }
        g.putImageData(img, x, y);
        return c;
    },

    wand(p, mode) {
        const reg = this.region(this.sample(), p.x, p.y);
        if (!reg) return;
        this.combineSelection(this.regionCanvas(reg, '#000000'), mode);
    },

    fillAt(p) {
        const l = this.layer();
        const reg = this.region(this.sample(), p.x, p.y);
        if (!reg) return;
        this.beginPixels(l);
        const c = this.regionCanvas(reg, this.fg);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.W, this.H);
        g.drawImage(c, 0, 0);
        c.width = c.height = 0;
        this.drag = { tool: 'fill' };
        this.putStroke(l.canvas.getContext('2d'));
        this.drag = null;
        g.clearRect(0, 0, this.W, this.H);
        const b = reg.box;
        this.endPixels(l, { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 });
        this.renderSoon();
    },

    // Delete: what's selected on this layer gone (or the whole layer)
    clearSelected() {
        if (this.float) { this.discardFloat(); return; }
        const l = this.layer();
        if (!l) return;
        this.beginPixels(l);
        const g = l.canvas.getContext('2d');
        let r = { x: 0, y: 0, w: this.W, h: this.H };
        if (this.sel) {
            g.globalCompositeOperation = 'destination-out';
            g.drawImage(this.sel.mask, 0, 0);
            g.globalCompositeOperation = 'source-over';
            r = this.sel.box;
        } else {
            g.clearRect(0, 0, this.W, this.H);
        }
        this.endPixels(l, r);
        this.renderSoon();
    },

    // ---- Text ----

    font(scale = 1) {
        const o = this.opts;
        return `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${Math.max(1, o.fontSize * scale)}px ${o.font}`;
    },

    startText(p) {
        this.text = { ox: p.ox, oy: p.oy };
        const ta = this.el('paint-text');
        ta.value = '';
        ta.classList.remove('hidden');
        ta.style.color = this.fg;
        ta.style.opacity = String(this.opts.opacity / 100);
        this.positionText();
        setTimeout(() => ta.focus(), 0);
    },

    positionText() {
        if (!this.text) return;
        const ta = this.el('paint-text');
        const s = this.V().transformPoint({ x: this.text.ox, y: this.text.oy });
        ta.style.left = `${s.x}px`;
        ta.style.top = `${s.y}px`;
        ta.style.font = this.font(this.view.z);
        this.sizeText();
    },

    sizeText() {
        const ta = this.el('paint-text');
        const g = this.canvas.getContext('2d');
        g.save();
        g.font = this.font(this.view.z);
        const lines = (ta.value || ' ').split('\n');
        const w = Math.max(...lines.map(t => g.measureText(t || ' ').width));
        g.restore();
        ta.style.width = `${Math.ceil(w) + 8}px`;
        ta.style.height = `${Math.ceil(lines.length * this.opts.fontSize * this.view.z * 1.2) + 4}px`;
    },

    endText(keep) {
        const t = this.text;
        if (!t) return;
        this.text = null;
        const ta = this.el('paint-text');
        const value = ta.value;
        ta.classList.add('hidden');
        ta.blur();
        if (!keep || !value.trim()) return;
        const l = this.layer();
        this.beginPixels(l);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.W, this.H);
        g.setTransform(this.Ci);
        g.font = this.font();
        g.fillStyle = this.fg;
        g.textBaseline = 'top';
        const lines = value.split('\n'), lh = this.opts.fontSize * 1.2;
        let w = 0;
        lines.forEach((line, i) => {
            g.fillText(line, t.ox, t.oy + i * lh + this.opts.fontSize * 0.1);
            w = Math.max(w, g.measureText(line).width);
        });
        g.setTransform(1, 0, 0, 1, 0, 0);
        this.drag = { tool: 'text' };
        this.putStroke(l.canvas.getContext('2d'));
        this.drag = null;
        g.clearRect(0, 0, this.W, this.H);
        const h = lines.length * lh;
        this.endPixels(l, this.layerBounds([{ x: t.ox, y: t.oy }, { x: t.ox + w, y: t.oy }, { x: t.ox, y: t.oy + h }, { x: t.ox + w, y: t.oy + h }], this.opts.fontSize * 0.5));
        this.renderSoon();
    },

    // ---- Move: a floating copy of the layer, or what's selected ----
    //
    // Lifted off the layer into the picture as shown (an axis-lined box
    // there), moved, scaled and turned about its middle, and put back down
    // through Ci when it's done

    startMove(p) {
        if (this.float) {
            const hit = this.floatHit(p);
            if (hit) {
                this.drag = { kind: 'float', part: hit, start: p, orig: { ...this.float.t } };
                return;
            }
            this.commitFloat();
        }
        if (!this.liftFloat()) return;
        this.drag = { kind: 'float', part: 'move', start: p, orig: { ...this.float.t } };
    },

    liftFloat() {
        const l = this.layer();
        if (!l) return false;
        this.beginPixels(l);
        // What's lifted, in layer space: the selection of the layer, or all of it
        const lifted = this.newCanvas();
        const lg = lifted.getContext('2d');
        lg.drawImage(l.canvas, 0, 0);
        if (this.sel) {
            lg.globalCompositeOperation = 'destination-in';
            lg.drawImage(this.sel.mask, 0, 0);
            lg.globalCompositeOperation = 'source-over';
        }
        const g = l.canvas.getContext('2d');
        if (this.sel) {
            g.globalCompositeOperation = 'destination-out';
            g.drawImage(this.sel.mask, 0, 0);
            g.globalCompositeOperation = 'source-over';
        } else {
            g.clearRect(0, 0, this.W, this.H);
        }
        // Into the picture as shown, its bounds there
        const lb = this.sel ? this.sel.box : { x: 0, y: 0, w: this.W, h: this.H };
        const corners = [[lb.x, lb.y], [lb.x + lb.w, lb.y], [lb.x, lb.y + lb.h], [lb.x + lb.w, lb.y + lb.h]].map(([x, y]) => this.C.transformPoint({ x, y }));
        const x0 = Math.floor(Math.min(...corners.map(q => q.x))), y0 = Math.floor(Math.min(...corners.map(q => q.y)));
        const x1 = Math.ceil(Math.max(...corners.map(q => q.x))), y1 = Math.ceil(Math.max(...corners.map(q => q.y)));
        const fc = this.newCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
        const fg = fc.getContext('2d');
        fg.setTransform(new DOMMatrix().translate(-x0, -y0).multiply(this.C));
        fg.drawImage(lifted, 0, 0);
        lifted.width = lifted.height = 0;
        this.float = { canvas: fc, x0, y0, w: x1 - x0, h: y1 - y0, t: { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 }, layer: l, sel: this.sel ? this.sel.box : null };
        this.buildOptions();
        return true;
    },

    // The float's matrix in the picture as shown (its own px → output px)
    floatM() {
        const f = this.float, t = f.t;
        const cx = f.x0 + f.w / 2, cy = f.y0 + f.h / 2;
        return new DOMMatrix().translate(cx + t.tx, cy + t.ty).rotate(t.rot * 180 / Math.PI).scale(t.sx, t.sy).translate(-f.w / 2, -f.h / 2);
    },

    // Its corners and the turning knob, in output px
    floatHandles() {
        const f = this.float, M = this.floatM();
        const at = (x, y) => M.transformPoint({ x, y });
        const knobLen = 28 / this.view.z;
        const top = at(f.w / 2, 0), mid = at(f.w / 2, f.h / 2);
        const dx = top.x - mid.x, dy = top.y - mid.y, len = Math.hypot(dx, dy) || 1;
        return {
            corners: [['nw', at(0, 0)], ['ne', at(f.w, 0)], ['sw', at(0, f.h)], ['se', at(f.w, f.h)]],
            knob: { x: top.x + dx / len * knobLen * Math.sign(this.float.t.sy || 1), y: top.y + dy / len * knobLen * Math.sign(this.float.t.sy || 1) },
            M
        };
    },

    floatHit(p) {
        const h = this.floatHandles(), r = 9 / this.view.z;
        if (Math.hypot(p.ox - h.knob.x, p.oy - h.knob.y) <= r) return 'rotate';
        for (const [id, q] of h.corners) if (Math.hypot(p.ox - q.x, p.oy - q.y) <= r) return id;
        const l = h.M.inverse().transformPoint({ x: p.ox, y: p.oy });
        if (l.x >= 0 && l.y >= 0 && l.x <= this.float.w && l.y <= this.float.h) return 'move';
        return null;
    },

    dragFloat(p, keepShape) {
        const d = this.drag, f = this.float, t = f.t, o = d.orig;
        const cx = f.x0 + f.w / 2 + o.tx, cy = f.y0 + f.h / 2 + o.ty;
        if (d.part === 'move') {
            t.tx = o.tx + (p.ox - d.start.ox);
            t.ty = o.ty + (p.oy - d.start.oy);
        } else if (d.part === 'rotate') {
            const a0 = Math.atan2(d.start.oy - cy, d.start.ox - cx), a1 = Math.atan2(p.oy - cy, p.ox - cx);
            let rot = o.rot + a1 - a0;
            if (keepShape) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
            t.rot = rot;
        } else {
            // A corner: scaled about the middle, on the box's own axes
            const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
            const lx = c * (p.ox - cx) - s * (p.oy - cy), ly = s * (p.ox - cx) + c * (p.oy - cy);
            let sx = Math.max(0.02, Math.abs(lx) / (f.w / 2)), sy = Math.max(0.02, Math.abs(ly) / (f.h / 2));
            if (keepShape) sx = sy = Math.max(sx, sy);
            t.sx = sx * Math.sign(o.sx || 1);
            t.sy = sy * Math.sign(o.sy || 1);
        }
    },

    drawFloat(ctx, VD) {
        ctx.save();
        ctx.setTransform(VD.multiply(this.floatM()));
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.float.canvas, 0, 0);
        ctx.restore();
    },

    // Put down where it is
    commitFloat() {
        const f = this.float;
        if (!f) return;
        this.float = null;
        const l = f.layer;
        const g = l.canvas.getContext('2d');
        g.save();
        g.setTransform(this.Ci.multiply(this.floatM.call({ float: f, view: this.view })));
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(f.canvas, 0, 0);
        g.restore();
        f.canvas.width = f.canvas.height = 0;
        // The selection moves with it
        if (this.sel) {
            const m = this.newCanvas();
            const mg = m.getContext('2d');
            mg.setTransform(this.Ci.multiply(this.floatM.call({ float: f, view: this.view })).multiply(new DOMMatrix().translate(-f.x0, -f.y0)).multiply(this.C));
            mg.drawImage(this.sel.mask, 0, 0);
            this.dropSelection();
            this.sel = { mask: m };
            this.selectionChanged();
        }
        this.endPixels(l, { x: 0, y: 0, w: this.W, h: this.H });
        this.buildOptions();
        this.renderSoon();
    },

    // Put back as it was
    cancelFloat() {
        const f = this.float;
        if (!f) return;
        this.float = null;
        const l = f.layer;
        const g = l.canvas.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.drawImage(this.before, 0, 0);
        g.globalCompositeOperation = 'source-over';
        f.canvas.width = f.canvas.height = 0;
        this._beforeOf = null;
        this.buildOptions();
        this.renderSoon();
    },

    // Thrown away (Delete while moving)
    discardFloat() {
        const f = this.float;
        if (!f) return;
        this.float = null;
        f.canvas.width = f.canvas.height = 0;
        this.endPixels(f.layer, { x: 0, y: 0, w: this.W, h: this.H });
        this.buildOptions();
        this.renderSoon();
    },

    // Copy and paste, inside Paint: what's selected on this layer
    copy() {
        const l = this.layer();
        if (!l) return;
        const b = this.sel ? this.sel.box : { x: 0, y: 0, w: this.W, h: this.H };
        const c = this.newCanvas(b.w, b.h);
        const g = c.getContext('2d');
        g.drawImage(l.canvas, -b.x, -b.y);
        if (this.sel) {
            g.globalCompositeOperation = 'destination-in';
            g.drawImage(this.sel.mask, -b.x, -b.y);
        }
        if (this._clip) this._clip.width = this._clip.height = 0;
        this._clip = c;
        this.app.showToast('Copied', 1000);
    },

    paste() {
        const c = this._clip;
        if (!c) { this.app.showToast('Nothing copied yet: select something and copy it (Ctrl+C)', 2000); return; }
        if (this.float) this.commitFloat();
        const l = this.layer();
        this.beginPixels(l);
        const fc = this.newCanvas(c.width, c.height);
        fc.getContext('2d').drawImage(c, 0, 0);
        // In the middle of what's on screen
        const mid = this.V().inverse().transformPoint({ x: this.cssW / 2, y: this.cssH / 2 });
        this.float = { canvas: fc, x0: mid.x - c.width / 2, y0: mid.y - c.height / 2, w: c.width, h: c.height, t: { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 }, layer: l, sel: null };
        this.dropSelection();
        this.setTool('move');
        this.renderSoon();
    },

    // ---- Drawn over the photo: selection, shapes being drawn, handles ----

    drawSelection(ctx, VD, LD) {
        if (!this.sel || !this.sel.edge || this.float) return;
        ctx.save();
        ctx.setTransform(LD);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.sel.edge, 0, 0);
        ctx.restore();
    },

    drawGuides(ctx, VD, LD) {
        const d = this.drag, z = this.view.z;
        ctx.save();
        ctx.setTransform(VD);
        const outline = (path, dash = [5 / z, 4 / z]) => {
            for (const [c, w] of [['rgba(0,0,0,0.7)', 2.5 / z], ['#fff', 1.2 / z]]) {
                ctx.setLineDash(c === '#fff' ? dash : []);
                ctx.strokeStyle = c;
                ctx.lineWidth = w;
                ctx.stroke(path);
            }
            ctx.setLineDash([]);
        };
        if (d && d.kind === 'shape') {
            const { a, b } = this.shapeGeom(d);
            if (this.tool === 'gradient' || this.tool.endsWith('select')) {
                outline(this.shapePath(this.tool === 'gradient' ? 'line' : this.tool, a, b));
            } else {
                ctx.globalAlpha = this.opts.opacity / 100;
                this.drawShape(ctx, this.tool, a, b);
                ctx.globalAlpha = 1;
            }
        }
        if (d && d.kind === 'lasso' && d.pts.length > 1) {
            const p = new Path2D();
            d.pts.forEach((q, i) => i ? p.lineTo(q.ox, q.oy) : p.moveTo(q.ox, q.oy));
            outline(p);
        }
        if (this.float) {
            const h = this.floatHandles(), f = this.float;
            const box = new Path2D();
            const c = h.corners.map(x => x[1]);
            box.moveTo(c[0].x, c[0].y); box.lineTo(c[1].x, c[1].y); box.lineTo(c[3].x, c[3].y); box.lineTo(c[2].x, c[2].y); box.closePath();
            outline(box, [4 / z, 3 / z]);
            const top = h.M.transformPoint({ x: f.w / 2, y: 0 });
            const knob = new Path2D();
            knob.moveTo(top.x, top.y); knob.lineTo(h.knob.x, h.knob.y);
            outline(knob, []);
            for (const q of [...c, h.knob]) {
                ctx.beginPath();
                ctx.arc(q.x, q.y, 5 / z, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.lineWidth = 1.5 / z;
                ctx.strokeStyle = 'rgba(0,0,0,0.7)';
                ctx.stroke();
            }
        }
        // The brush
        if (this.hover && !this.space && ['brush', 'pencil', 'spray', 'eraser'].includes(this.tool) && !(d && d.kind === 'pan')) {
            const r = this.radius();
            const p = new Path2D();
            p.arc(this.hover.ox, this.hover.oy, Math.max(r, 1 / z), 0, Math.PI * 2);
            outline(p, []);
        }
        ctx.restore();
    },

    // ---- Layers ----

    drawLayersSoon() {
        clearTimeout(this._layersTimer);
        this._layersTimer = setTimeout(() => this.drawLayers(), 150);
    },

    drawLayers() {
        const list = this.el('paint-layer-list');
        if (!list || !this.ready) return;
        list.textContent = '';
        const asp = this.W / this.H;
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const l = this.layers[i];
            const row = document.createElement('div');
            row.className = 'paint-layer' + (l.hidden ? ' hidden-layer' : '');
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(i === this.cur));
            row.innerHTML = '<button class="paint-eye"></button><canvas></canvas><span class="paint-layer-name"></span>';
            const eye = row.querySelector('.paint-eye');
            eye.title = l.hidden ? 'Show' : 'Hide';
            eye.setAttribute('aria-label', `${l.hidden ? 'Show' : 'Hide'} ${l.name}`);
            eye.innerHTML = l.hidden
                ? '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2l20 20M10.6 6.1A10 10 0 0 1 22 12a14 14 0 0 1-2.4 3.4M6.6 6.6A14 14 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/></svg>'
                : '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
            eye.addEventListener('click', (e) => {
                e.stopPropagation();
                eye.blur();
                this.pushState();
                l.hidden = !l.hidden;
                l.changed = true;
                this.afterState();
            });
            const cv = row.querySelector('canvas');
            cv.width = 96;
            cv.height = 72;
            const g = cv.getContext('2d');
            const w = asp > 96 / 72 ? 96 : 72 * asp, h = asp > 96 / 72 ? 96 / asp : 72;
            g.drawImage(l.canvas, (96 - w) / 2, (72 - h) / 2, w, h);
            row.querySelector('.paint-layer-name').textContent = l.name;
            row.addEventListener('click', () => {
                if (this.float) this.commitFloat();
                this.cur = i;
                this.drawLayers();
            });
            row.addEventListener('dblclick', () => this.renameLayer(i));
            list.appendChild(row);
        }
        const l = this.layer();
        if (l) this.el('paint-layer-blend').value = l.blend;
        this.opacityRow._sync();
        this.el('paint-layer-merge').disabled = this.cur <= 0;
        this.el('paint-layer-down').disabled = this.cur <= 0;
        this.el('paint-layer-up').disabled = this.cur >= this.layers.length - 1;
        this.el('paint-layer-delete').disabled = this.layers.length <= 1;
        this.el('paint-undo').disabled = !this.history.length && !this.float;
        this.el('paint-redo').disabled = !this.future.length;
    },

    addLayer() {
        if (!this.ready) return;
        if (this.layers.length >= Paint.MAX_LAYERS) { this.app.showToast(`Up to ${Paint.MAX_LAYERS} layers`); return; }
        if (this.float) this.commitFloat();
        this.pushState();
        const n = this.layers.length + 1;
        this.layers.splice(this.cur + 1, 0, this.makeLayer(`Layer ${n}`));
        this.cur++;
        this.afterState();
    },

    duplicateLayer() {
        const l = this.layer();
        if (!l || this.layers.length >= Paint.MAX_LAYERS) return;
        if (this.float) this.commitFloat();
        this.pushState();
        const copy = this.makeLayer(`${l.name} copy`);
        Object.assign(copy, { opacity: l.opacity, blend: l.blend, hidden: l.hidden });
        copy.canvas.getContext('2d').drawImage(l.canvas, 0, 0);
        this.layers.splice(this.cur + 1, 0, copy);
        this.cur++;
        this.afterState();
    },

    deleteLayer() {
        if (this.layers.length <= 1) return;
        if (this.float) this.commitFloat();
        this.pushState();
        this.layers.splice(this.cur, 1);
        this.cur = Math.max(0, this.cur - 1);
        this.afterState();
    },

    moveLayer(dir) {
        const j = this.cur + dir;
        if (j < 0 || j >= this.layers.length) return;
        if (this.float) this.commitFloat();
        this.pushState();
        [this.layers[this.cur], this.layers[j]] = [this.layers[j], this.layers[this.cur]];
        this.cur = j;
        this.afterState();
    },

    mergeDown() {
        if (this.cur <= 0) return;
        if (this.float) this.commitFloat();
        const top = this.layer(), below = this.layers[this.cur - 1];
        this.pushState();
        this.beginPixels(below);
        const g = below.canvas.getContext('2d');
        if (!top.hidden) {
            g.save();
            g.globalAlpha = top.opacity;
            g.globalCompositeOperation = top.blend;
            g.drawImage(top.canvas, 0, 0);
            g.restore();
        }
        const before = this.before.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.W, this.H);
        const after = g.getImageData(0, 0, this.W, this.H);
        below.changed = true;
        this.layers.splice(this.cur, 1);
        this.cur--;
        this.afterState({ kind: 'px', layer: below, r: { x: 0, y: 0, w: this.W, h: this.H }, before, after, bytes: this.W * this.H * 8 });
    },

    async renameLayer(i) {
        const l = this.layers[i];
        if (!l) return;
        const name = await UI.prompt({ title: 'Rename the layer', input: { label: 'Name', value: l.name }, ok: 'Rename' });
        if (name === null || !name.trim()) return;
        this.pushState();
        l.name = name.trim().slice(0, 60);
        this.afterState();
    },

    // Is there anything on a layer?
    empty(l) {
        const d = l.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.W, this.H).data;
        for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
        return true;
    },

    // ---- Done ----

    // The paint record to keep (layers written to the project), or null:
    // nothing painted
    async keep() {
        if (this.text) this.endText(true);
        if (this.float) this.commitFloat();
        const paint = { id: this.paintId, w: this.W, h: this.H, layers: [] };
        for (const l of this.layers) {
            if ((l.changed || !l.rev) && this.empty(l)) continue;
            const rec = { id: l.id, rev: l.rev, name: l.name, opacity: l.opacity, blend: l.blend, hidden: l.hidden };
            if (l.changed || !l.rev) {
                rec.rev = Paint.newId().slice(-10);
                await Paint.writeLayer(paint, rec, l.canvas);
            }
            paint.layers.push(rec);
        }
        return Paint.clean(paint);
    },

    // For writing into the photo (no project): the layers to put on
    layersNow() {
        if (this.text) this.endText(true);
        if (this.float) this.commitFloat();
        return { w: this.W, h: this.H, layers: this.layers.filter(l => !l.hidden && l.opacity > 0).map(l => ({ src: l.canvas, opacity: l.opacity, blend: l.blend })) };
    }
};
