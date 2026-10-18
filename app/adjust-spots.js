// Spot removal in Adjust (adjust.js; the maths in retouch.js): heal or
// clone circles over specks, dust, scratches and blemishes, like
// Lightroom's Spot Removal, and a dust finder for scans.
//
//   Click a speck: a spot there, its source picked from nearby where the
//     surroundings match best. Drag from a speck instead to choose where
//     it's copied from yourself.
//   Drag a spot to move it, its source (the dashed circle) to copy from
//     somewhere else, its edge to make it bigger or smaller.
//   Right-click a spot, or Delete, to take it away.
//   Find dust puts a heal spot on every speck it finds (Sensitivity: how
//     faint a speck it looks for); Clear found takes those off again.
//
// Places are on the photo as it is on disk (Develop.cropMap), as masks'
// are, so a crop later doesn't move them.

const AdjustSpots = {
    sel: -1,
    tool: 'heal',
    size: 2,          // % of the photo's height (the diameter)
    feather: 40,
    opacity: 100,
    dust: 50,         // the finder's sensitivity
    show: true,

    el(id) { return document.getElementById(id); },

    init(ed) {
        this.ed = ed;
        this.cv = this.el('adj-spot-overlay');
        this.sec = this.el('adj-spots-sec');
        try {
            const kept = JSON.parse(localStorage.getItem('jeditor.spotTool') || 'null');
            if (kept && typeof kept === 'object') {
                if (kept.tool === 'clone') this.tool = 'clone';
                for (const k of ['size', 'feather', 'opacity', 'dust']) if (typeof kept[k] === 'number') this[k] = kept[k];
            }
        } catch (e) { /* private mode */ }
        const tool = (key, label, min, max, step, get, set) => {
            const row = ed.slider(key, label, { range: { min, max, step, def: get() }, get, set });
            (ed.extraRows || (ed.extraRows = [])).push(row);
            return row;
        };
        // The tool's settings, and the selected spot's
        const spot = (fn) => { const s = this.current(); if (s) fn(s); };
        const rows = this.el('adj-spot-tools');
        rows.appendChild(tool('spot-size', 'Size', 0.2, 20, 0.1, () => this.size, (v) => {
            this.size = v;
            spot(s => { s.r = v / 200; });
            this.remember();
        }));
        rows.appendChild(tool('spot-feather', 'Feather', 0, 100, 1, () => this.feather, (v) => {
            this.feather = v;
            spot(s => { s.f = v / 100; });
            this.remember();
        }));
        rows.appendChild(tool('spot-opacity', 'Opacity', 5, 100, 1, () => this.opacity, (v) => {
            this.opacity = v;
            spot(s => { s.o = v / 100; });
            this.remember();
        }));
        this.el('adj-dust-tools').appendChild(tool('dust-sens', 'Sensitivity', 0, 100, 1, () => this.dust, (v) => { this.dust = v; this.remember(); }));

        for (const t of ['heal', 'clone']) {
            this.el(`adj-spot-${t}`).addEventListener('click', (e) => {
                e.currentTarget.blur();
                this.tool = t;
                const s = this.current();
                if (s && s.t !== t) { ed.pushHistory(); s.t = t; ed.changed(); }
                this.remember();
                this.sync();
            });
        }
        this.el('adj-spot-show').addEventListener('change', (e) => { this.show = e.target.checked; this.draw(); });
        this.el('adj-spot-delete').addEventListener('click', (e) => { e.currentTarget.blur(); this.remove(this.sel); });
        this.el('adj-dust-find').addEventListener('click', (e) => { e.currentTarget.blur(); this.findDust(); });
        this.el('adj-dust-clear').addEventListener('click', (e) => { e.currentTarget.blur(); this.clearFound(); });

        // One section drawing on the photo at a time: masks or spots
        const masks = this.el('adj-masks-sec');
        this.sec.addEventListener('toggle', () => {
            ed.root.classList.toggle('adj-spots-open', this.sec.open);
            if (this.sec.open && masks && masks.open) masks.open = false;
            this.sync();
        });
        if (masks) masks.addEventListener('toggle', () => { if (masks.open && this.sec.open) this.sec.open = false; });

        const cv = this.cv;
        cv.addEventListener('pointerdown', (e) => this.down(e));
        cv.addEventListener('pointermove', (e) => this.move(e));
        cv.addEventListener('pointerup', (e) => this.up(e));
        cv.addEventListener('pointercancel', (e) => this.up(e));
        cv.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
        cv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const hit = this.hit(this.point(e));
            if (hit) this.remove(hit.i);
        });
        // Delete or Backspace: the selected spot
        document.addEventListener('keydown', (e) => {
            if (!this.active() || this.sel < 0 || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
            if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
            e.preventDefault();
            e.stopPropagation();
            this.remove(this.sel);
        }, true);
    },

    remember() {
        try { localStorage.setItem('jeditor.spotTool', JSON.stringify({ tool: this.tool, size: this.size, feather: this.feather, opacity: this.opacity, dust: this.dust })); } catch (e) { /* private mode */ }
    },

    // Opened on a photo
    reset() {
        this.sel = -1;
        this.drag = null;
        this._Y = null;
        this.sync();
    },

    active() {
        return !!(this.sec && this.sec.open && this.ed.ready);
    },

    spots() {
        const a = this.ed.a;
        if (!a) return [];
        if (!a.spots) a.spots = [];
        return a.spots;
    },

    current() {
        return this.spots()[this.sel] || null;
    },

    remove(i) {
        if (!this.spots()[i]) return;
        this.ed.pushHistory();
        this.spots().splice(i, 1);
        this.sel = -1;
        this.sync();
        this.ed.changed();
    },

    clearFound() {
        const n = this.spots().filter(s => s.d).length;
        if (!n) { this.ed.app.showToast('No dust spots to clear'); return; }
        this.ed.pushHistory();
        this.ed.a.spots = this.spots().filter(s => !s.d);
        this.sel = -1;
        this.sync();
        this.ed.changed();
        this.ed.app.showToast(`Cleared ${n} dust spot${n === 1 ? '' : 's'}`, 1600, null, null, { kind: 'adjust' });
    },

    // The working copy's brightness, small (picking sources)
    luma() {
        if (this._Y) return this._Y;
        const base = this.ed.base;
        const s = Math.min(1, 1200 / Math.max(base.width, base.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(base.width * s));
        c.height = Math.max(1, Math.round(base.height * s));
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(base, 0, 0, c.width, c.height);
        const img = g.getImageData(0, 0, c.width, c.height);
        this._Y = { Y: Retouch.luma(img), W: c.width, H: c.height };
        c.width = c.height = 0;
        return this._Y;
    },

    async findDust() {
        const ed = this.ed, app = ed.app;
        if (!ed.ready || this._finding) return;
        this._finding = true;
        app.beginTask('dust', 'Finding dust…');
        try {
            await new Promise(r => setTimeout(r, 30));
            const base = ed.base;
            const g = base.getContext('2d', { willReadFrequently: true });
            const img = g.getImageData(0, 0, base.width, base.height);
            const keep = this.spots().filter(s => !s.d);
            const found = Retouch.findDust(img, { sensitivity: this.dust, keep });
            if (!ed.ready) return;
            const had = this.spots().length - keep.length;
            if (!found.length && !had) {
                app.showToast('No dust found. Try a higher Sensitivity', 2200);
                return;
            }
            ed.pushHistory();
            ed.a.spots = keep.concat(found).slice(0, Retouch.MAX_SPOTS);
            this.sel = -1;
            this.sync();
            ed.changed();
            app.showToast(found.length ? `Found ${found.length} speck${found.length === 1 ? '' : 's'} of dust: check them, right-click any that aren't` : 'No dust found this time', 3000, null, null, { kind: 'adjust' });
        } catch (e) {
            console.error('Finding dust failed:', e);
            app.showToast('Couldn\'t look for dust: ' + e.message, 3000);
        } finally {
            this._finding = false;
            app.endTask('dust');
        }
    },

    sync() {
        if (!this.sec) return;
        const s = this.current();
        if (s) {
            this.tool = s.t;
            this.size = Math.round(s.r * 200 * 10) / 10;
            this.feather = Math.round(s.f * 100);
            this.opacity = Math.round(s.o * 100);
        }
        for (const t of ['heal', 'clone']) this.el(`adj-spot-${t}`).setAttribute('aria-pressed', String(this.tool === t));
        this.el('adj-spot-delete').disabled = !s;
        const list = this.spots(), found = list.filter(x => x.d).length;
        this.el('adj-dust-clear').disabled = !found;
        this.el('adj-spot-count').textContent = !list.length ? '' : `${list.length} spot${list.length === 1 ? '' : 's'}` + (found ? `, ${found} found as dust` : '');
        this.el('adj-spot-hint').textContent = s ? 'Drag the spot, its source (dashed) or its edge; right-click or Delete takes it off'
            : 'Click a speck to heal it, or drag from it to where to copy from';
        this.cv.classList.toggle('hidden', !this.active());
        this.place();
        this.draw();
    },

    // ---- Where things are ----

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

    // The spot (or its source, or its edge) under p, the selected first
    hit(p) {
        const list = this.spots(), hp = this.heightPx();
        const order = list.map((s, i) => i).sort((a, b) => (b === this.sel) - (a === this.sel) || b - a);
        for (const i of order) {
            const s = list[i], R = Math.max(5, s.r * hp);
            const d = this.fromPhoto(s.x, s.y), src = this.fromPhoto(s.sx, s.sy);
            const dd = Math.hypot(p.x - d.x, p.y - d.y);
            if (Math.abs(dd - R) <= 5 && R > 10) return { i, part: 'edge' };
            if (dd <= R) return { i, part: 'spot' };
            if ((i === this.sel || this.show) && Math.hypot(p.x - src.x, p.y - src.y) <= R) return { i, part: 'source' };
        }
        return null;
    },

    // ---- Placing and dragging ----

    down(e) {
        if (!this.active() || e.button === 2) return;
        const ed = this.ed, p = this.point(e);
        e.preventDefault();
        e.stopPropagation();
        try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
        const hit = this.hit(p);
        if (hit) {
            ed.pushHistory();
            // Last, so dragging it does only it again (Adjust.retouchedBase)
            const list = this.spots();
            const [s] = list.splice(hit.i, 1);
            list.push(s);
            this.sel = list.length - 1;
            this.drag = { kind: hit.part, start: p, orig: { ...s } };
            this.sync();
            ed.changed();
            return;
        }
        if (this.spots().length >= Retouch.MAX_SPOTS) {
            ed.app.showToast(`Up to ${Retouch.MAX_SPOTS} spots on a photo`);
            return;
        }
        // A new spot, its source from where the pointer's let go
        this.drag = { kind: 'new', start: p, moved: false };
    },

    move(e) {
        if (!this.active()) return;
        const p = this.point(e);
        this.hover = p;
        const d = this.drag;
        if (!d) { this.draw(); return; }
        if (d.kind === 'new') {
            if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 5) return;
            if (!d.moved) {
                d.moved = true;
                this.ed.pushHistory();
                this.spots().push(this.make(d.start, d.start));
                this.sel = this.spots().length - 1;
            }
            const s = this.current();
            s.sx = p.u;
            s.sy = p.v;
            this.ed.changed();
            return;
        }
        const s = this.current();
        if (!s) return;
        const du = p.u - d.start.u, dv = p.v - d.start.v;
        if (d.kind === 'spot') { s.x = d.orig.x + du; s.y = d.orig.y + dv; }
        if (d.kind === 'source') { s.sx = d.orig.sx + du; s.sy = d.orig.sy + dv; }
        if (d.kind === 'edge') {
            const c = this.fromPhoto(s.x, s.y);
            s.r = Math.min(Retouch.MAX_R, Math.max(Retouch.MIN_R, Math.hypot(p.x - c.x, p.y - c.y) / this.heightPx()));
        }
        this.ed.changed();
    },

    up(e) {
        const d = this.drag;
        this.drag = null;
        if (this.cv.hasPointerCapture && this.cv.hasPointerCapture(e.pointerId)) this.cv.releasePointerCapture(e.pointerId);
        if (d && d.kind === 'new' && !d.moved) {
            // A click: the source picked for it
            this.ed.pushHistory();
            const s = this.make(d.start, null);
            this.spots().push(s);
            this.sel = this.spots().length - 1;
        }
        // Dragged onto itself: nothing to copy, so gone
        const s = this.current();
        if (s && Math.hypot((s.sx - s.x) * this.ed.map.asp, s.sy - s.y) < s.r * 0.5) {
            this.spots().splice(this.sel, 1);
            this.sel = -1;
        }
        this.sync();
        this.ed.sync();
        this.ed.changed();
    },

    // A spot at p, copied from q (null: the best place nearby). On a
    // speck bigger than the tool, as big as the speck (up to 4 times)
    make(p, q) {
        const L = this.luma();
        let r = this.size / 200;
        const fit = Retouch.fitSpeck(L.Y, L.W, L.H, p.u, p.v, r * 4);
        if (fit && fit > r) r = fit;
        let src = q ? { sx: q.u, sy: q.v } : null;
        if (!src) src = Retouch.autoSource(L.Y, L.W, L.H, p.u, p.v, r);
        return { t: this.tool, x: p.u, y: p.v, r, sx: src.sx, sy: src.sy, f: this.feather / 100, o: this.opacity / 100 };
    },

    // ---- Drawing ----

    draw() {
        if (!this.cv || !this.active()) return;
        const ctx = this.cv.getContext('2d');
        const dpr = this.cv.width / Math.max(1, this.cssW);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.cv.width, this.cv.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const hp = this.heightPx();
        const circle = (c, R, dash, color, width) => {
            ctx.setLineDash(dash);
            for (const [col, wd] of [['rgba(0,0,0,0.6)', width + 1.5], [color, width]]) {
                ctx.strokeStyle = col;
                ctx.lineWidth = wd;
                ctx.beginPath();
                ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        };
        this.spots().forEach((s, i) => {
            const selected = i === this.sel;
            if (!this.show && !selected) return;
            const R = Math.max(3, s.r * hp);
            const d = this.fromPhoto(s.x, s.y);
            const color = selected ? '#fff' : s.d ? '#ffd166' : 'rgba(255,255,255,0.8)';
            circle(d, R, [], color, selected ? 2 : 1.25);
            if (selected || (this.show && R > 6)) {
                const src = this.fromPhoto(s.sx, s.sy);
                circle(src, R, [4, 3], color, selected ? 1.5 : 1);
                if (selected) {
                    // From the source to the spot
                    const dx = d.x - src.x, dy = d.y - src.y, len = Math.hypot(dx, dy) || 1;
                    if (len > 2 * R) {
                        ctx.setLineDash([2, 3]);
                        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(src.x + dx / len * R, src.y + dy / len * R);
                        ctx.lineTo(d.x - dx / len * R, d.y - dy / len * R);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                }
            }
        });
        // Where a click would put one
        if (this.hover && !this.drag && !this.hit(this.hover)) {
            circle(this.hover, Math.max(3, this.size / 200 * hp), [], 'rgba(255,255,255,0.6)', 1);
        }
    }
};
