// Preview and crop (the Windows app, the scan dock): the scanner's whole
// glass, small, with a box around each print on it. jEditor finds the prints
// (find); the boxes can be moved, resized, drawn and deleted; Scan then
// saves each box as its own photo, at full resolution (scan.js, the app).
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
            Object.assign(div.style, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
            const n = document.createElement('span');
            n.className = 'pv-n';
            n.textContent = i + 1;
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'pv-x';
            x.title = 'Remove this box';
            x.setAttribute('aria-label', `Remove box ${i + 1}`);
            x.textContent = '×';
            x.addEventListener('pointerdown', (e) => e.stopPropagation());
            x.addEventListener('click', () => this.remove(i));
            div.append(n, x);
            for (const c of ['nw', 'ne', 'se', 'sw']) {
                const h = document.createElement('i');
                h.className = 'pv-h ' + c;
                h.dataset.h = c;
                div.appendChild(h);
            }
            layer.appendChild(div);
        });
    },

    // Drag: a corner resizes its box, a box moves, the glass draws a new one
    pointerDown(e) {
        if (e.button !== 0 || !this.image) return;
        const layer = this.el('scan-pv-boxes');
        layer.focus({ preventScroll: true });
        const r = layer.getBoundingClientRect();
        const at = (ev) => ({
            x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
            y: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))
        });
        const p0 = at(e);
        const boxEl = e.target.closest('.pv-box');
        let i, mode, corner = null, start;
        if (boxEl) {
            i = +boxEl.dataset.i;
            corner = e.target.dataset && e.target.dataset.h;
            mode = corner ? 'resize' : 'move';
        } else {
            this.boxes.push({ x: p0.x, y: p0.y, w: 0, h: 0 });
            i = this.boxes.length - 1;
            mode = 'draw';
        }
        start = { ...this.boxes[i] };
        this.sel = i;
        this.render();
        try { layer.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
        e.preventDefault();
        const move = (ev) => {
            const p = at(ev);
            const b = this.boxes[i];
            if (mode === 'move') {
                b.x = Math.max(0, Math.min(1 - start.w, start.x + p.x - p0.x));
                b.y = Math.max(0, Math.min(1 - start.h, start.y + p.y - p0.y));
            } else {
                // The corner opposite the one dragged stays put
                const fixed = mode === 'draw' ? p0 : {
                    x: corner.includes('w') ? start.x + start.w : start.x,
                    y: corner.includes('n') ? start.y + start.h : start.y
                };
                b.x = Math.min(fixed.x, p.x);
                b.y = Math.min(fixed.y, p.y);
                b.w = Math.abs(p.x - fixed.x);
                b.h = Math.abs(p.y - fixed.y);
            }
            const el = layer.children[i];
            if (el) Object.assign(el.style, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
        };
        const up = () => {
            layer.removeEventListener('pointermove', move);
            layer.removeEventListener('pointerup', up);
            layer.removeEventListener('pointercancel', up);
            const b = this.boxes[i];
            if (b.w < this.MIN || b.h < this.MIN) {
                if (mode === 'draw') {
                    this.boxes.splice(i, 1);
                    this.sel = -1;
                } else {
                    Object.assign(b, start); // too small: as it was
                }
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
        const k = Math.min(1, 640 / Math.max(W, H));
        const w = Math.max(16, Math.round(W * k)), h = Math.max(16, Math.round(H * k));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        canvas.width = canvas.height = 0;
        return this.findIn(d, w, h);
    },

    // RGBA pixels → boxes
    findIn(d, w, h) {
        const n = w * h;
        // The glass (the lid behind the prints): the commonest colour round
        // the edge
        const ring = Math.max(2, Math.round(Math.min(w, h) * 0.01));
        const hist = new Map();
        const edge = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
                const i = (y * w + x) * 4;
                edge.push(i);
                const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
                hist.set(key, (hist.get(key) || 0) + 1);
            }
        }
        let best = -1, most = 0;
        for (const [key, c] of hist) if (c > most) { best = key; most = c; }
        let br = 0, bg = 0, bb = 0, cnt = 0;
        const bucket = (i) => (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
        for (const i of edge) if (bucket(i) === best) { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; cnt++; }
        if (!cnt) return [];
        br /= cnt; bg /= cnt; bb /= cnt;
        let noise = 0;
        for (const i of edge) if (bucket(i) === best) noise += Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb);
        noise /= cnt;

        // Not glass: a different colour, or an edge (a white-bordered
        // print on a white lid still has an outline)
        const lum = new Float32Array(n);
        for (let p = 0; p < n; p++) lum[p] = d[p * 4] * 0.3 + d[p * 4 + 1] * 0.59 + d[p * 4 + 2] * 0.11;
        const colourStep = Math.max(42, noise * 6);
        const edgeStep = Math.max(22, noise * 4);
        let fg = new Uint8Array(n);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = y * w + x, i = p * 4;
                const diff = Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb);
                let g = 0;
                if (x > 0 && x < w - 1 && y > 0 && y < h - 1) g = Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + w] - lum[p - w]);
                if (diff > colourStep || g > edgeStep) fg[p] = 1;
            }
        }
        // Close small gaps in outlines
        fg = this.dilate(fg, w, h, 2);

        // Glass reachable from the edge is outside; everything else is a
        // print (its inside too, whatever colour)
        const outside = new Uint8Array(n);
        const stack = [];
        const seed = (p) => { if (!fg[p] && !outside[p]) { outside[p] = 1; stack.push(p); } };
        for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
        while (stack.length) {
            const p = stack.pop();
            const x = p % w;
            if (x > 0) seed(p - 1);
            if (x < w - 1) seed(p + 1);
            if (p >= w) seed(p - w);
            if (p < n - w) seed(p + w);
        }

        // Each print: a group of inside pixels
        const label = new Int32Array(n);
        const found = [];
        for (let p0 = 0; p0 < n; p0++) {
            if (outside[p0] || label[p0]) continue;
            const id = found.length + 1;
            let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
            label[p0] = id;
            stack.push(p0);
            while (stack.length) {
                const p = stack.pop();
                const x = p % w, y = (p - x) / w;
                area++;
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
                const visit = (q) => { if (!outside[q] && !label[q]) { label[q] = id; stack.push(q); } };
                if (x > 0) visit(p - 1);
                if (x < w - 1) visit(p + 1);
                if (y > 0) visit(p - w);
                if (y < h - 1) visit(p + w);
            }
            found.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, area });
        }
        // Prints, not dust: big enough, and mostly filling their box (a
        // rectangle, even tilted)
        let boxes = found.filter(b => {
            const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
            return b.area >= n * 0.006 && bw >= w * 0.04 && bh >= h * 0.03 && b.area >= bw * bh * 0.45;
        });
        // One inside another (a print's own picture): the outer one
        boxes = boxes.filter(b => !boxes.some(o => o !== b && o.x0 <= b.x0 && o.y0 <= b.y0 && o.x1 >= b.x1 && o.y1 >= b.y1));

        // A margin of glass round each, short of the next print
        const margin = Math.round(Math.min(w, h) * 0.025);
        const padded = boxes.map(b => {
            const gap = (side) => {
                let room = margin;
                for (const o of boxes) {
                    if (o === b) continue;
                    const overlapY = Math.min(b.y1, o.y1) > Math.max(b.y0, o.y0);
                    const overlapX = Math.min(b.x1, o.x1) > Math.max(b.x0, o.x0);
                    if (side === 'l' && overlapY && o.x1 <= b.x0) room = Math.min(room, Math.floor((b.x0 - o.x1) / 2));
                    if (side === 'r' && overlapY && o.x0 >= b.x1) room = Math.min(room, Math.floor((o.x0 - b.x1) / 2));
                    if (side === 't' && overlapX && o.y1 <= b.y0) room = Math.min(room, Math.floor((b.y0 - o.y1) / 2));
                    if (side === 'b' && overlapX && o.y0 >= b.y1) room = Math.min(room, Math.floor((o.y0 - b.y1) / 2));
                }
                return Math.max(0, room);
            };
            const x0 = Math.max(0, b.x0 - gap('l')), y0 = Math.max(0, b.y0 - gap('t'));
            const x1 = Math.min(w, b.x1 + gap('r')), y1 = Math.min(h, b.y1 + gap('b'));
            return { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };
        });
        return this.readingOrder(padded);
    },

    dilate(m, w, h, r) {
        const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let v = 0;
                for (let dx = -r; dx <= r && !v; dx++) {
                    const xx = x + dx;
                    if (xx >= 0 && xx < w && m[y * w + xx]) v = 1;
                }
                tmp[y * w + x] = v;
            }
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let v = 0;
                for (let dy = -r; dy <= r && !v; dy++) {
                    const yy = y + dy;
                    if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1;
                }
                out[y * w + x] = v;
            }
        }
        return out;
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
