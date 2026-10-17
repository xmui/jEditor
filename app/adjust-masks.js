// Masks in Adjust (adjust.js; the maths in develop.js): settings for part
// of the photo, like Lightroom's masking. A mask is a shape and its own
// sliders (exposure, contrast, the tones, white balance, vibrance and
// saturation), put over the rest by how strongly it covers each pixel.
//
//   Linear gradient: drag across the photo; full where you start, none
//     where you stop (a sky darkened to the horizon)
//   Radial gradient: drag out from the middle; inside full, feathered to
//     none at the edge (a face lifted, or with Invert, the edges darkened)
//   Brush: paint it on; Erase paints it off. Size, Feather and Flow.
//
// Places are kept on the photo as it is on disk, not as cropped (see
// Develop.cropMap), so cropping later doesn't move a mask off its subject.
// Show mask tints what it covers red, as Lightroom does; it's shown by
// itself while you draw or paint.

const AdjustMasks = {
    sel: -1,          // the mask being changed (in Adjust.a.masks)
    mode: null,       // drawing a new 'linear' or 'radial'; 'erase' with the brush
    brush: { size: 8, feather: 50, flow: 100 },   // % of the photo's height, %, %
    showMask: false,
    LABEL: { linear: 'Linear gradient', radial: 'Radial gradient', brush: 'Brush' },

    el(id) { return document.getElementById(id); },

    init(ed) {
        this.ed = ed;
        this.cv = this.el('adj-overlay');
        this.sec = this.el('adj-masks-sec');
        for (const b of ed.root.querySelectorAll('[data-add-mask]')) {
            b.addEventListener('click', () => { b.blur(); this.add(b.dataset.addMask); });
        }
        this.el('adj-mask-invert').addEventListener('change', (e) => {
            const m = this.current();
            if (!m) return;
            ed.pushHistory();
            m.invert = e.target.checked;
            ed.changed();
        });
        this.el('adj-mask-delete').addEventListener('click', (e) => { e.currentTarget.blur(); this.remove(this.sel); });
        this.el('adj-mask-show').addEventListener('change', (e) => { this.showMask = e.target.checked; this.draw(); });
        this.el('adj-brush-paint').addEventListener('click', (e) => { e.currentTarget.blur(); this.mode = null; this.sync(); });
        this.el('adj-brush-erase').addEventListener('click', (e) => { e.currentTarget.blur(); this.mode = 'erase'; this.sync(); });

        // The selected mask's own sliders
        const rows = this.el('adj-mask-sliders');
        const names = { exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows', whites: 'Whites', blacks: 'Blacks', temp: 'Temperature', tint: 'Tint', vibrance: 'Vibrance', saturation: 'Saturation' };
        for (const k of Develop.MASK_SLIDERS) {
            const row = ed.slider(`mask-${k}`, names[k], {
                range: Develop.SLIDERS[k],
                get: () => { const m = this.current(); return (m && m.adj[k]) || 0; },
                set: (v) => { const m = this.current(); if (m) m.adj[k] = v; }
            });
            if (ed.TRACKS[k]) row.style.setProperty('--track', ed.TRACKS[k]);
            (ed.extraRows || (ed.extraRows = [])).push(row);
            rows.appendChild(row);
        }
        // The brush, and a radial's feather
        const tool = (key, label, min, max, get, set) => {
            const row = ed.slider(key, label, { range: { min, max, step: 1, def: get() }, get, set });
            (ed.extraRows || (ed.extraRows = [])).push(row);
            return row;
        };
        const brushRows = this.el('adj-brush-tools');
        brushRows.appendChild(tool('brush-size', 'Size', 1, 50, () => this.brush.size, (v) => { this.brush.size = v; }));
        brushRows.appendChild(tool('brush-feather', 'Feather', 0, 100, () => this.brush.feather, (v) => { this.brush.feather = v; }));
        brushRows.appendChild(tool('brush-flow', 'Flow', 5, 100, () => this.brush.flow, (v) => { this.brush.flow = v; }));
        this.el('adj-radial-tools').appendChild(tool('radial-feather', 'Feather', 0, 100,
            () => { const m = this.current(); return m && m.radial ? Math.round(m.radial[5] * 100) : 50; },
            (v) => { const m = this.current(); if (m && m.radial) m.radial[5] = v / 100; }));

        this.sec.addEventListener('toggle', () => {
            ed.root.classList.toggle('adj-masks-open', this.sec.open);
            if (!this.sec.open) this.mode = this.mode === 'erase' ? 'erase' : null;
            this.sync();
        });
        const cv = this.cv;
        cv.addEventListener('pointerdown', (e) => this.down(e));
        cv.addEventListener('pointermove', (e) => this.move(e));
        cv.addEventListener('pointerup', (e) => this.up(e));
        cv.addEventListener('pointercancel', (e) => this.up(e));
        cv.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    },

    // Opened on a photo
    reset() {
        this.sel = this.masks().length ? 0 : -1;
        this.mode = null;
        this.drag = null;
        this.sync();
    },

    active() {
        return !!(this.sec && this.sec.open && this.ed.ready);
    },

    masks() {
        return (this.ed.a && this.ed.a.masks) || [];
    },

    current() {
        return this.masks()[this.sel] || null;
    },

    add(type) {
        const ed = this.ed;
        if (!ed.ready) return;
        if (this.masks().length >= Develop.MAX_MASKS) {
            ed.app.showToast(`Up to ${Develop.MAX_MASKS} masks on a photo`);
            return;
        }
        if (type === 'brush') {
            ed.pushHistory();
            this.masks().push({ type: 'brush', invert: false, adj: {}, brush: [] });
            this.sel = this.masks().length - 1;
            this.mode = null;
        } else {
            // Drawn on the photo next
            this.mode = type;
            this.sel = -1;
        }
        this.sync();
        ed.changed();
    },

    remove(i) {
        if (!this.masks()[i]) return;
        this.ed.pushHistory();
        this.masks().splice(i, 1);
        this.sel = Math.min(this.sel, this.masks().length - 1);
        this.sync();
        this.ed.changed();
    },

    // The list, the selected mask's controls and the overlay
    sync() {
        if (!this.sec) return;
        const list = this.el('adj-mask-list');
        list.textContent = '';
        const count = {};
        this.masks().forEach((m, i) => {
            count[m.type] = (count[m.type] || 0) + 1;
            const b = document.createElement('button');
            b.className = 'adj-mask-item';
            b.setAttribute('aria-pressed', String(i === this.sel));
            b.textContent = `${this.LABEL[m.type]} ${count[m.type]}${m.invert ? ' (inverted)' : ''}`;
            b.addEventListener('click', () => { b.blur(); this.sel = i; this.mode = null; this.sync(); this.ed.sync(); });
            list.appendChild(b);
        });
        const m = this.current();
        this.el('adj-mask-edit').classList.toggle('hidden', !m);
        this.el('adj-brush-tools-box').classList.toggle('hidden', !(m && m.type === 'brush'));
        this.el('adj-radial-tools').classList.toggle('hidden', !(m && m.type === 'radial'));
        if (m) this.el('adj-mask-invert').checked = !!m.invert;
        this.el('adj-brush-paint').setAttribute('aria-pressed', String(this.mode !== 'erase'));
        this.el('adj-brush-erase').setAttribute('aria-pressed', String(this.mode === 'erase'));
        const hint = this.el('adj-mask-hint');
        hint.textContent = this.mode === 'linear' ? 'Drag across the photo: full where you start, none where you stop'
            : this.mode === 'radial' ? 'Drag out from the middle of what to change'
            : m && m.type === 'brush' ? (this.mode === 'erase' ? 'Paint over the mask to take it off' : 'Paint over what to change')
            : m ? 'Drag the handles on the photo' : 'Add a mask to change part of the photo';
        this.cv.classList.toggle('hidden', !this.active());
        this.cv.style.cursor = this.mode === 'linear' || this.mode === 'radial' ? 'crosshair' : m && m.type === 'brush' ? 'none' : 'default';
        this.place();
        this.draw();
    },

    // ---- Where things are ----

    // The overlay over the photo
    place() {
        const ed = this.ed;
        if (!ed.ready) return;
        const cr = ed.canvas.getBoundingClientRect(), sr = this.el('adj-stage').getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        Object.assign(this.cv.style, { left: `${cr.left - sr.left}px`, top: `${cr.top - sr.top}px`, width: `${cr.width}px`, height: `${cr.height}px` });
        const w = Math.max(1, Math.round(cr.width * dpr)), h = Math.max(1, Math.round(cr.height * dpr));
        if (this.cv.width !== w) this.cv.width = w;
        if (this.cv.height !== h) this.cv.height = h;
        this.cssW = cr.width;
        this.cssH = cr.height;
    },

    // On the photo (0–1 across and down, as on disk) from the overlay (css px)
    toPhoto(x, y) {
        const m = this.ed.map.m, a = x / this.cssW, b = y / this.cssH;
        return { u: m[0] * a + m[1] * b + m[2], v: m[3] * a + m[4] * b + m[5] };
    },

    fromPhoto(u, v) {
        const m = this.ed.map.m;
        const det = m[0] * m[4] - m[1] * m[3];
        const du = u - m[2], dv = v - m[5];
        const a = (m[4] * du - m[1] * dv) / det, b = (-m[3] * du + m[0] * dv) / det;
        return { x: a * this.cssW, y: b * this.cssH };
    },

    point(e) {
        const r = this.cv.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        return { x, y, ...this.toPhoto(x, y) };
    },

    // Photo heights to overlay px
    heightPx() {
        const a = this.fromPhoto(0.5, 0.5), b = this.fromPhoto(0.5, 0.6);
        return Math.hypot(b.x - a.x, b.y - a.y) * 10;
    },

    // The handles of the mask being changed: [{ id, x, y }]
    handles() {
        const m = this.current();
        if (!m) return [];
        const asp = this.ed.map.asp;
        if (m.type === 'linear') {
            const [x0, y0, x1, y1] = m.linear;
            return [{ id: 'p0', ...this.fromPhoto(x0, y0) }, { id: 'p1', ...this.fromPhoto(x1, y1) }];
        }
        if (m.type === 'radial') {
            const [cx, cy, rx, ry, ang] = m.radial;
            const at = (d, t) => this.fromPhoto((cx * asp + Math.cos(t) * d) / asp, cy + Math.sin(t) * d);
            return [{ id: 'c', ...this.fromPhoto(cx, cy) }, { id: 'rx', ...at(rx, ang) }, { id: 'ry', ...at(ry, ang + Math.PI / 2) }];
        }
        return [];
    },

    // ---- Drawing and dragging ----

    down(e) {
        if (!this.active()) return;
        const ed = this.ed, p = this.point(e);
        e.preventDefault();
        e.stopPropagation();
        try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
        const m = this.current();
        if (this.mode === 'linear' || this.mode === 'radial') {
            ed.pushHistory();
            const nm = this.mode === 'linear'
                ? { type: 'linear', invert: false, adj: {}, linear: [p.u, p.v, p.u, p.v] }
                : { type: 'radial', invert: false, adj: {}, radial: [p.u, p.v, 0.002, 0.002, 0, 0.5] };
            this.masks().push(nm);
            this.sel = this.masks().length - 1;
            this.drag = { kind: 'new', start: p };
            this.mode = null;
            return;
        }
        if (m && m.type === 'brush') {
            ed.pushHistory();
            m.brush.push({ size: this.brush.size / 100, feather: this.brush.feather / 100, flow: this.brush.flow / 100, erase: this.mode === 'erase', pts: [p.u, p.v] });
            this.drag = { kind: 'paint', last: p };
            ed.changed();
            return;
        }
        // A handle of the one being changed, or its line or middle
        const hit = this.handles().find(h => Math.hypot(h.x - p.x, h.y - p.y) <= 12);
        if (hit) {
            ed.pushHistory();
            this.drag = { kind: hit.id, start: p, orig: JSON.parse(JSON.stringify(m)) };
            return;
        }
        if (m && Develop.maskWeight(Develop.maskTables([Develop.cleanMasks([m])[0] || m]).list[0], p.u, p.v, ed.map.asp, null) > (m.invert ? 0.99 : 0.01)) {
            ed.pushHistory();
            this.drag = { kind: 'move', start: p, orig: JSON.parse(JSON.stringify(m)) };
        }
    },

    move(e) {
        if (!this.active()) return;
        const p = this.point(e);
        this.hover = p;
        const d = this.drag, m = this.current();
        if (!d || !m) { this.draw(); return; }
        const asp = this.ed.map.asp;
        if (d.kind === 'new' && m.type === 'linear') {
            m.linear = [d.start.u, d.start.v, p.u, p.v];
        } else if (d.kind === 'new' && m.type === 'radial') {
            const dx = (p.u - d.start.u) * asp, dy = p.v - d.start.v;
            m.radial[2] = Math.max(0.01, Math.abs(dx));
            m.radial[3] = Math.max(0.01, Math.abs(dy));
        } else if (d.kind === 'paint') {
            const st = m.brush[m.brush.length - 1];
            const step = st.size * 0.1;
            if (Math.hypot((p.u - d.last.u) * asp, p.v - d.last.v) < step) return;
            st.pts.push(p.u, p.v);
            d.last = p;
        } else if (d.kind === 'move') {
            const du = p.u - d.start.u, dv = p.v - d.start.v;
            if (m.type === 'linear') m.linear = d.orig.linear.map((x, i) => x + (i % 2 ? dv : du));
            if (m.type === 'radial') { m.radial[0] = d.orig.radial[0] + du; m.radial[1] = d.orig.radial[1] + dv; }
        } else if (d.kind === 'p0' || d.kind === 'p1') {
            const i = d.kind === 'p0' ? 0 : 2;
            m.linear[i] = p.u;
            m.linear[i + 1] = p.v;
        } else if (d.kind === 'c') {
            m.radial[0] = p.u;
            m.radial[1] = p.v;
        } else if (d.kind === 'rx' || d.kind === 'ry') {
            const qx = (p.u - m.radial[0]) * asp, qy = p.v - m.radial[1];
            const len = Math.max(0.01, Math.hypot(qx, qy));
            if (d.kind === 'rx') { m.radial[2] = len; m.radial[4] = Math.atan2(qy, qx); }
            else m.radial[3] = len;
        }
        this.ed.changed();
    },

    up(e) {
        const d = this.drag;
        this.drag = null;
        if (this.cv.hasPointerCapture && this.cv.hasPointerCapture(e.pointerId)) this.cv.releasePointerCapture(e.pointerId);
        const m = this.current();
        // Too small to be meant: gone
        if (d && d.kind === 'new' && m) {
            const tiny = m.type === 'linear'
                ? Math.hypot(m.linear[2] - m.linear[0], m.linear[3] - m.linear[1]) < 0.01
                : Math.max(m.radial[2], m.radial[3]) < 0.012;
            if (tiny) {
                this.masks().splice(this.sel, 1);
                this.sel = -1;
            }
        }
        this.sync();
        this.ed.changed();
    },

    // The handles, the brush, and the mask tinted red when it's shown
    draw() {
        if (!this.cv || !this.active()) return;
        const ctx = this.cv.getContext('2d');
        const dpr = this.cv.width / Math.max(1, this.cssW);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.cv.width, this.cv.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const m = this.current();
        const asp = this.ed.map.asp;
        if (m && (this.showMask || this.drag)) {
            const one = Develop.cleanMasks([m]);
            if (one) {
                const M = Develop.maskTables(one);
                const brush = M.brushes ? Develop.brushMaps(M.list, asp) : null;
                const e = M.list[0], cell = 4;
                for (let y = 0; y < this.cssH; y += cell) {
                    for (let x = 0; x < this.cssW; x += cell) {
                        const q = this.toPhoto(x + cell / 2, y + cell / 2);
                        const w = Develop.maskWeight(e, q.u, q.v, asp, brush);
                        if (w > 0.01) {
                            ctx.fillStyle = `rgba(255, 40, 40, ${0.55 * w})`;
                            ctx.fillRect(x, y, cell, cell);
                        }
                    }
                }
            }
        }
        const line = (pts, dash = []) => {
            ctx.setLineDash(dash);
            for (const [color, width] of [['rgba(0,0,0,0.6)', 3], ['#fff', 1.5]]) {
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                ctx.beginPath();
                pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
                ctx.stroke();
            }
            ctx.setLineDash([]);
        };
        if (m && m.type === 'linear') {
            const [x0, y0, x1, y1] = m.linear;
            // Across the photo at the start and the end, square to the drag
            const dx = (x1 - x0) * asp, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len, ny = dx / len, far = 4;
            const across = (u, v) => [this.fromPhoto((u * asp - nx * far) / asp, v - ny * far), this.fromPhoto((u * asp + nx * far) / asp, v + ny * far)];
            line(across(x0, y0));
            line(across(x1, y1), [5, 4]);
            line([this.fromPhoto(x0, y0), this.fromPhoto(x1, y1)], [2, 3]);
        }
        if (m && m.type === 'radial') {
            const [cx, cy, rx, ry, ang, fe] = m.radial;
            const ring = (k) => {
                const pts = [];
                for (let i = 0; i <= 64; i++) {
                    const t = i / 64 * Math.PI * 2, lx = Math.cos(t) * rx * k, ly = Math.sin(t) * ry * k;
                    const X = cx * asp + Math.cos(ang) * lx - Math.sin(ang) * ly, Y = cy + Math.sin(ang) * lx + Math.cos(ang) * ly;
                    pts.push(this.fromPhoto(X / asp, Y));
                }
                return pts;
            };
            line(ring(1));
            if (fe > 0.02) line(ring(1 - Math.max(0.01, fe)), [4, 4]);
        }
        for (const h of this.handles()) {
            ctx.beginPath();
            ctx.arc(h.x, h.y, h.id === 'c' || h.id === 'p0' ? 6 : 5, 0, Math.PI * 2);
            ctx.fillStyle = h.id === 'c' || h.id === 'p0' ? '#fff' : 'rgba(255,255,255,0.85)';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.stroke();
        }
        // The brush, where it would paint
        if (m && m.type === 'brush' && this.hover) {
            const r = this.brush.size / 100 / 2 * this.heightPx();
            ctx.beginPath();
            ctx.arc(this.hover.x, this.hover.y, r, 0, Math.PI * 2);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = this.mode === 'erase' ? '#ff6b6b' : '#fff';
            ctx.stroke();
            if (this.brush.feather) {
                ctx.beginPath();
                ctx.arc(this.hover.x, this.hover.y, r * (1 - this.brush.feather / 100), 0, Math.PI * 2);
                ctx.setLineDash([3, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }
};
