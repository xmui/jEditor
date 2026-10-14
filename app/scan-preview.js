// Preview and crop (the Windows app, the scan dock): the scanner's whole
// glass, small, with a box around each print on it. jEditor finds the prints
// (find, with PhotoFind: each box tilted to its print); a click on a print
// boxes it; the boxes can be moved, resized, tilted, drawn and deleted; Scan
// then saves each box as its own photo, at full resolution (scan.js, the app).
//
// Boxes are fractions of the glass: { x, y, w, h }, numbered in the order
// they're saved (reading order when found; drawn ones go last).

const ScanPreview = {
    MIN: 0.02, // smallest box (fraction of the glass)

    el(id) { return document.getElementById(id); },

    init(onChange) {
        this.onChange = onChange;
        this.boxes = [];
        this.sel = -1;
        this.image = null; // { width, height } of the preview
        const layer = this.el('scan-pv-boxes');
        layer.addEventListener('pointerdown', (e) => this.pointerDown(e));
        layer.addEventListener('keydown', (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel >= 0) {
                e.preventDefault();
                e.stopPropagation();
                this.remove(this.sel);
            }
        });
        new ResizeObserver(() => this.fit()).observe(this.el('scan-pv-stage'));
    },

    // A new preview: { image (URL), width, height }
    async show(p) {
        const img = this.el('scan-pv-img');
        this.image = { width: p.width, height: p.height };
        img.src = p.image;
        try { await img.decode(); } catch (e) { /* shows when it can */ }
        this.fit();
    },

    clearImage() {
        this.el('scan-pv-img').removeAttribute('src');
        this.image = null;
        this.set([]);
    },

    // The glass as big as the stage allows, keeping its shape
    fit() {
        const stage = this.el('scan-pv-stage');
        const bed = this.el('scan-pv-bed');
        if (!this.image || !stage.clientWidth) return;
        const pad = 16;
        const sw = stage.clientWidth - pad * 2, sh = stage.clientHeight - pad * 2;
        const ar = this.image.width / this.image.height;
        let w = sw, h = w / ar;
        if (h > sh) { h = sh; w = h * ar; }
        bed.style.width = `${Math.max(0, Math.floor(w))}px`;
        bed.style.height = `${Math.max(0, Math.floor(h))}px`;
    },

    set(boxes) {
        this.boxes = boxes.map(b => ({ ...b }));
        this.sel = -1;
        this.render();
        this.changed();
    },

    remove(i) {
        this.boxes.splice(i, 1);
        this.sel = Math.min(i, this.boxes.length - 1);
        this.render();
        this.changed();
    },

    changed() {
        if (this.onChange) this.onChange(this.boxes);
    },

    render() {
        const layer = this.el('scan-pv-boxes');
        layer.innerHTML = '';
        this.boxes.forEach((b, i) => {
            const div = document.createElement('div');
            div.className = 'pv-box' + (i === this.sel ? ' sel' : '');
            div.dataset.i = i;
            this.place(div, b);
            const n = document.createElement('span');
            n.className = 'pv-n';
            n.textContent = i + 1;
            // Which way is up in the saved photo
            const up = document.createElement('span');
            up.className = 'pv-up';
            up.title = 'This side up in the photo';
            up.textContent = '↑';
            up.style.transform = `rotate(${-(b.turn || 0)}deg)`;
            const turn = this.button('pv-turn', '↻', `Turn photo ${i + 1} a quarter (which way is up)`, () => {
                b.turn = ((b.turn || 0) + 90) % 360;
                this.render();
                this.changed();
            });
            const x = this.button('pv-x', '×', `Remove box ${i + 1}`, () => this.remove(i));
            const rot = document.createElement('i');
            rot.className = 'pv-rot';
            rot.dataset.h = 'rot';
            rot.title = 'Drag to tilt the box to match a crooked print (it comes out straight)';
            div.append(n, up, turn, x, rot);
            for (const c of ['nw', 'ne', 'se', 'sw']) {
                const h = document.createElement('i');
                h.className = 'pv-h ' + c;
                h.dataset.h = c;
                div.appendChild(h);
            }
            layer.appendChild(div);
        });
    },

    button(cls, text, label, click) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls;
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.textContent = text;
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', click);
        return btn;
    },

    place(el, b) {
        Object.assign(el.style, {
            left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
            transform: b.angle ? `rotate(${b.angle}deg)` : ''
        });
    },

    // A box round a print (PhotoFind's { cx, cy, w, h, tilt } in the
    // preview's pixels), with a little glass round it for Auto crop to trim
    boxFor(f, W = this.image.width, H = this.image.height) {
        const m = Math.min(W, H) * 0.01;
        const w = f.w + 2 * m, h = f.h + 2 * m;
        return {
            x: (f.cx - w / 2) / W, y: (f.cy - h / 2) / H, w: w / W, h: h / H,
            angle: Math.abs(f.tilt) < 0.3 ? 0 : Math.round(f.tilt * 10) / 10, turn: 0
        };
    },

    // A click on the glass: a box round the print there, or (none found)
    // one the size of the last box, centred on the click
    clickBox(p) {
        const img = this.el('scan-pv-img');
        const { width: W, height: H } = this.image;
        let f = null;
        try { f = PhotoFind.at(img, img.naturalWidth || W, img.naturalHeight || H, p.x * (img.naturalWidth || W), p.y * (img.naturalHeight || H)); } catch (e) { /* none */ }
        let box;
        if (f) {
            // (in the image's own pixels, which may not be the preview's)
            const k = W / (img.naturalWidth || W);
            box = this.boxFor({ cx: f.cx * k, cy: f.cy * k, w: f.w * k, h: f.h * k, tilt: f.tilt });
        } else {
            const size = this.lastSize || { w: 0.3, h: 0.2 };
            box = { x: Math.max(0, Math.min(1 - size.w, p.x - size.w / 2)), y: Math.max(0, Math.min(1 - size.h, p.y - size.h / 2)), w: size.w, h: size.h, angle: 0, turn: 0 };
        }
        // Already boxed: that box is chosen instead
        const same = this.boxes.findIndex(b => Math.abs(b.x + b.w / 2 - (box.x + box.w / 2)) < box.w * 0.2 && Math.abs(b.y + b.h / 2 - (box.y + box.h / 2)) < box.h * 0.2);
        if (same >= 0) {
            this.sel = same;
            this.render();
            return;
        }
        this.boxes.push(box);
        this.sel = this.boxes.length - 1;
        this.lastSize = { w: box.w, h: box.h };
        this.render();
        this.changed();
    },

    // Drag: a corner resizes its box, the round handle tilts it, a box
    // moves, the glass draws a new one
    pointerDown(e) {
        if (e.button !== 0 || !this.image) return;
        const layer = this.el('scan-pv-boxes');
        layer.focus({ preventScroll: true });
        const r = layer.getBoundingClientRect();
        const W = r.width, H = r.height;
        const at = (ev) => ({
            x: Math.max(0, Math.min(1, (ev.clientX - r.left) / W)),
            y: Math.max(0, Math.min(1, (ev.clientY - r.top) / H))
        });
        const p0 = at(e);
        const boxEl = e.target.closest('.pv-box');
        let i, mode, corner = null;
        if (boxEl) {
            i = +boxEl.dataset.i;
            corner = e.target.dataset && e.target.dataset.h;
            mode = corner === 'rot' ? 'rotate' : corner ? 'resize' : 'move';
        } else {
            this.boxes.push({ x: p0.x, y: p0.y, w: 0, h: 0, angle: 0, turn: 0 });
            i = this.boxes.length - 1;
            mode = 'draw';
        }
        const start = { ...this.boxes[i] };
        this.sel = i;
        this.render();
        try { layer.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
        e.preventDefault();
        // Pixel geometry (the glass keeps its shape on screen, so angles are true)
        const rad = (start.angle || 0) * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const c0 = { x: (start.x + start.w / 2) * W, y: (start.y + start.h / 2) * H };
        const move = (ev) => {
            const p = at(ev);
            const b = this.boxes[i];
            if (mode === 'move') {
                b.x = Math.max(-start.w / 2, Math.min(1 - start.w / 2, start.x + p.x - p0.x));
                b.y = Math.max(-start.h / 2, Math.min(1 - start.h / 2, start.y + p.y - p0.y));
            } else if (mode === 'rotate') {
                // The handle sits above the middle: its angle from there
                let a = Math.atan2(p.x * W - c0.x, -(p.y * H - c0.y)) * 180 / Math.PI;
                if (Math.abs(a) < 1.5) a = 0;
                b.angle = Math.max(-45, Math.min(45, Math.round(a * 10) / 10));
            } else if (mode === 'draw' || !start.angle) {
                // The corner opposite the one dragged stays put
                const fixed = mode === 'draw' ? p0 : {
                    x: corner.includes('w') ? start.x + start.w : start.x,
                    y: corner.includes('n') ? start.y + start.h : start.y
                };
                b.x = Math.min(fixed.x, p.x);
                b.y = Math.min(fixed.y, p.y);
                b.w = Math.abs(p.x - fixed.x);
                b.h = Math.abs(p.y - fixed.y);
            } else {
                // A tilted box: the opposite corner stays put, sizes measured
                // along the box's own sides
                const sx = corner.includes('w') ? -1 : 1, sy = corner.includes('n') ? -1 : 1;
                const hw = start.w * W / 2, hh = start.h * H / 2;
                const fixed = { x: c0.x + (-sx * hw) * cos - (-sy * hh) * sin, y: c0.y + (-sx * hw) * sin + (-sy * hh) * cos };
                const dx = p.x * W - fixed.x, dy = p.y * H - fixed.y;
                const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos; // in the box's frame
                const w = Math.max(4, sx * lx), h = Math.max(4, sy * ly);
                const cx = fixed.x + (sx * w / 2) * cos - (sy * h / 2) * sin;
                const cy = fixed.y + (sx * w / 2) * sin + (sy * h / 2) * cos;
                b.w = w / W;
                b.h = h / H;
                b.x = cx / W - b.w / 2;
                b.y = cy / H - b.h / 2;
            }
            const el = layer.children[i];
            if (el) this.place(el, b);
        };
        const up = () => {
            layer.removeEventListener('pointermove', move);
            layer.removeEventListener('pointerup', up);
            layer.removeEventListener('pointercancel', up);
            const b = this.boxes[i];
            if (b.w < this.MIN || b.h < this.MIN) {
                if (mode === 'draw') {
                    // A click, not a drag: the print there
                    this.boxes.splice(i, 1);
                    this.sel = -1;
                    this.clickBox(p0);
                    return;
                }
                Object.assign(b, start); // too small: as it was
            } else if (mode !== 'move') {
                this.lastSize = { w: b.w, h: b.h };
            }
            this.render();
            this.changed();
        };
        layer.addEventListener('pointermove', move);
        layer.addEventListener('pointerup', up);
        layer.addEventListener('pointercancel', up);
    },

    // ---- Finding the prints ----

    // The prints on a preview (an image element) → boxes, in reading order,
    // each with a margin of glass around it (Auto crop then trims to the
    // print and straightens it)
    find(img) {
        const W = img.naturalWidth, H = img.naturalHeight;
        if (!W || !H) return [];
        const found = PhotoFind.all(img, W, H).map(f => this.boxFor(f, W, H));
        return this.readingOrder(found);
    },

    // Rows top to bottom (boxes side by side share a row), each left to right
    readingOrder(boxes) {
        const rest = boxes.slice().sort((a, b) => a.y - b.y);
        const out = [];
        while (rest.length) {
            const first = rest.shift();
            const row = [first];
            for (let i = 0; i < rest.length;) {
                const b = rest[i];
                const overlap = Math.min(first.y + first.h, b.y + b.h) - Math.max(first.y, b.y);
                if (overlap > Math.min(first.h, b.h) * 0.5) row.push(...rest.splice(i, 1));
                else i++;
            }
            out.push(...row.sort((a, b) => a.x - b.x));
        }
        return out;
    }
};
