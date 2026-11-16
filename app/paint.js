// Paint: layers painted over a photo (paint-editor.js is the screen).
// Like every edit it's kept with the photo, never in the file until it's
// saved or exported: the photo's edit gets `paint`, a list of layers, and
// each layer's pixels are a PNG in the project's own folder
// (.jeditor/paint/<id>-<layer>-<rev>.png; a new rev each time a layer
// changes, so Ctrl+Z on the edit finds the old one still there).
//
//   paint: { id, w, h, layers: [{ id, rev, name, opacity, blend, hidden, lock? }],
//            ext?, pad?, fill? }
//
// Layers cover the whole photo as it is on disk (before any crop or turn,
// w × h: the photo's own size, or less for a very big one), so cropping
// later doesn't move what was painted. They go on last, over the photo as
// cropped and adjusted, so what's painted looks as it was painted (a film
// look or a slider doesn't change it); they're scaled to whatever size the
// photo is shown or saved at.
//
// The canvas can be bigger (or smaller) than the photo: Paint's Canvas
// size and its crop. pad { l, t, r, b } is how far the canvas's edges are
// out from the picture's as it's shown (cropped and turned), in layer px
// (less than 0: in from it); fill is the colour of what's added (none:
// clear). The layers then reach past the photo: ext { l, t, r, b } is how
// far, on the photo as on disk, so the layer pictures are
// (w + l + r) × (h + t + b), the photo at (l, t). Only what's drawn as
// shown is padded (onto with a crop editor): a photo-sized picture (the
// Crop tool, Adjust) shows just the photo's part of the layers.

const Paint = {
    DIR: 'paint',
    MAX_EDGE: 3000,
    MAX_LAYERS: 24,
    BLENDS: [
        ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
        ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'],
        ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
        ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']
    ],

    init(app) {
        this.app = app;
    },

    // ---- The record ----

    has(e) {
        return !!(e && e.paint && Array.isArray(e.paint.layers) && (e.paint.layers.length || this.padOf(e.paint)));
    },

    clean(v) {
        if (!v || typeof v !== 'object') return null;
        const id = (x) => typeof x === 'string' && /^[a-z0-9]{1,24}$/.test(x);
        const int = (x) => Number.isInteger(x) && x >= 1 && x <= 16384;
        if (!id(v.id) || !int(v.w) || !int(v.h) || !Array.isArray(v.layers)) return null;
        const blends = this.BLENDS.map(b => b[0]);
        const layers = [];
        for (const l of v.layers.slice(0, this.MAX_LAYERS)) {
            if (!l || !id(l.id) || !id(l.rev)) continue;
            layers.push({
                id: l.id, rev: l.rev,
                name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 60) : 'Layer',
                opacity: typeof l.opacity === 'number' && isFinite(l.opacity) ? +Math.min(1, Math.max(0, l.opacity)).toFixed(3) : 1,
                blend: blends.includes(l.blend) ? l.blend : 'source-over',
                hidden: !!l.hidden,
                // Transparency locked (kept only when on)
                ...(l.lock ? { lock: true } : {}),
                // Its mask's rev (a file of its own, maskFile): what shows
                ...(id(l.mask) ? { mask: l.mask } : {})
            });
        }
        const side = (o, min) => {
            if (!o || typeof o !== 'object') return null;
            const r = {};
            for (const k of ['l', 't', 'r', 'b']) r[k] = Number.isInteger(o[k]) ? Math.max(min, Math.min(16384, o[k])) : 0;
            return r.l || r.t || r.r || r.b ? r : null;
        };
        const ext = side(v.ext, 0), pad = side(v.pad, -16384);
        const fill = typeof v.fill === 'string' && /^#[0-9a-f]{6}$/i.test(v.fill) ? v.fill.toLowerCase() : null;
        // (a canvas that's smaller can't be smaller than nothing)
        const ok = !pad || (v.w + pad.l + pad.r >= 1 && v.h + pad.t + pad.b >= 1);
        if (!layers.length && !(pad && ok)) return null;
        return { id: v.id, w: v.w, h: v.h, layers, ...(ext ? { ext } : {}), ...(pad && ok ? { pad } : {}), ...(pad && ok && fill ? { fill } : {}) };
    },

    ZERO: { l: 0, t: 0, r: 0, b: 0 },

    // The canvas's edges out from the picture's, or null: the picture's own
    padOf(p) {
        const d = p && p.pad;
        return d && (d.l || d.t || d.r || d.b) ? d : null;
    },

    // The size layers are painted at for a photo W × H
    sizeFor(W, H) {
        const s = Math.min(1, this.MAX_EDGE / Math.max(W, H));
        return { w: Math.max(1, Math.round(W * s)), h: Math.max(1, Math.round(H * s)) };
    },

    newId() {
        return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 16);
    },

    fileName(paint, layer) {
        return `${paint.id}-${layer.id}-${layer.rev}.png`;
    },

    // A layer's mask, as a layer of its own: its alpha is what shows
    maskOf(layer) {
        return { id: layer.id + 'm', rev: layer.mask };
    },

    // The layer's pixels with its mask on (a new canvas)
    masked(src, mask) {
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const g = c.getContext('2d');
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(mask, 0, 0, c.width, c.height);
        return c;
    },

    // ---- Kept in the project ----

    async dir(create) {
        const app = this.app;
        const root = await FolderCache.root(app, create).catch(() => null);
        if (!root) return null;
        try {
            return await root.getDirectoryHandle(this.DIR, { create });
        } catch (e) {
            return null;
        }
    },

    // A layer's pixels written (a canvas): its new rev
    async writeLayer(paint, layer, canvas) {
        const dir = await this.dir(true);
        if (!dir) throw new Error('this folder can\'t keep painting (open it with Open folder)');
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        if (!blob) throw new Error('the layer couldn\'t be encoded');
        const fh = await dir.getFileHandle(this.fileName(paint, layer), { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        this.remember(paint, layer, await createImageBitmap(blob));
    },

    // A project opened: layer files no edit uses (an older rev, an edit
    // discarded) are deleted. Only then: within a session Ctrl+Z can bring
    // an older rev back. Files written since this started are left.
    async tidy(edits) {
        const started = Date.now();
        const dir = await this.dir(false);
        if (!dir) return 0;
        const used = new Set();
        for (const e of edits) if (this.has(e)) for (const l of e.paint.layers) {
            used.add(this.fileName(e.paint, l));
            if (l.mask) used.add(this.fileName(e.paint, this.maskOf(l)));
        }
        const gone = [];
        for await (const [name, h] of dir.entries()) {
            if (h.kind !== 'file' || used.has(name) || !/\.png$/.test(name)) continue;
            const f = await h.getFile().catch(() => null);
            if (f && f.lastModified < started - 1000) gone.push(name);
        }
        for (const name of gone) await dir.removeEntry(name).catch(() => { });
        return gone.length;
    },

    // Layers' pictures, remembered (the last few)
    remember(paint, layer, bmp) {
        this._bmps = this._bmps || new Map();
        const key = this.fileName(paint, layer);
        const old = this._bmps.get(key);
        if (old && old !== bmp && old.close) old.close();
        this._bmps.delete(key);
        this._bmps.set(key, bmp);
        while (this._bmps.size > 16) {
            const [k, b] = this._bmps.entries().next().value;
            this._bmps.delete(k);
            if (b && b.close) b.close();
        }
    },

    async layerBitmap(paint, layer) {
        const key = this.fileName(paint, layer);
        this._bmps = this._bmps || new Map();
        if (this._bmps.has(key)) {
            const b = this._bmps.get(key);
            this._bmps.delete(key);
            this._bmps.set(key, b);
            return b;
        }
        const dir = await this.dir(false);
        if (!dir) return null;
        try {
            const f = await (await dir.getFileHandle(key)).getFile();
            const bmp = await createImageBitmap(f);
            this.remember(paint, layer, bmp);
            return bmp;
        } catch (e) {
            console.warn('Paint: a layer is missing:', key, e.message);
            return null;
        }
    },

    // The visible layers' pictures, ready to draw: { w, h, ext, pad, fill,
    // layers: [{ src, opacity, blend }] } (src: an ImageBitmap or canvas),
    // or null
    async prepare(e) {
        if (!this.has(e)) return null;
        const p = e.paint;
        const layers = [];
        for (const l of p.layers) {
            if (l.hidden || !l.opacity) continue;
            let src = await this.layerBitmap(p, l);
            const mask = src && l.mask ? await this.layerBitmap(p, this.maskOf(l)) : null;
            if (mask) src = this.masked(src, mask);
            if (src) layers.push({ src, opacity: l.opacity, blend: l.blend });
        }
        const pad = this.padOf(p);
        return layers.length || pad ? { w: p.w, h: p.h, ext: p.ext || this.ZERO, pad, fill: p.fill || null, layers } : null;
    },

    // ---- Drawn over a photo ----

    // The layers onto `canvas`: the photo as cropped by `ed` (a crop
    // editor on the W × H photo, CropEditor.fromSnapshot), or the whole
    // photo filling the canvas when there's no crop. at: where the picture
    // is on the canvas, and how wide (a padded canvas has it inside)
    composite(canvas, prepared, ed = null, at = null) {
        if (!prepared) return;
        at = at || { x: 0, y: 0, w: canvas.width, h: canvas.height };
        const ctx = canvas.getContext('2d');
        ctx.save();
        for (const l of prepared.layers) {
            ctx.globalAlpha = l.opacity;
            ctx.globalCompositeOperation = l.blend;
            this.drawThrough(ctx, ed, l.src, canvas.width, canvas.height, prepared, at);
        }
        ctx.restore();
    },

    // A layer's picture drawn as `ed` crops the photo (as
    // CropEditor.drawOutput does), or stretched over w × h without one;
    // p: the layers' w, h and ext (none: the photo's size); at: where the
    // picture is (all of w × h)
    drawThrough(ctx, ed, src, w, h, p = null, at = null) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const e = (p && p.ext) || this.ZERO;
        at = at || { x: 0, y: 0, w, h };
        if (!ed) {
            const pw = p ? p.w : w, ph = p ? p.h : h;
            ctx.setTransform(at.w / pw, 0, 0, at.h / ph, at.x, at.y);
            ctx.drawImage(src, -e.l, -e.t, pw + e.l + e.r, ph + e.t + e.b);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            return;
        }
        const o = ed.outputRect();
        const [a, b, c, d] = ed.mat(); // the turn, and any flip
        // The output canvas may be a different size from ed's (a preview)
        const k = at.w / o.w;
        const sx = p ? ed.W / p.w : 1, sy = p ? ed.H / p.h : 1;
        ctx.setTransform(a * k, b * k, c * k, d * k, -o.x0 * k + at.x, -o.y0 * k + at.y);
        ctx.drawImage(src, -ed.W / 2 - e.l * sx, -ed.H / 2 - e.t * sy, ed.W + (e.l + e.r) * sx, ed.H + (e.t + e.b) * sy);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    },

    // The layers onto a picture, on a canvas padded as the paint says: a
    // new canvas when it's padded (the picture inside it, what's added
    // filled), else the same one. ed as for composite
    padded(canvas, prepared, ed = null) {
        const pad = prepared && prepared.pad;
        if (!pad) { this.composite(canvas, prepared, ed); return canvas; }
        // Canvas px per layer px, as shown
        const k = ed ? canvas.width / ed.outputRect().w * (ed.W / prepared.w) : canvas.width / prepared.w;
        const x = Math.round(pad.l * k), y = Math.round(pad.t * k);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(canvas.width + (pad.l + pad.r) * k));
        out.height = Math.max(1, Math.round(canvas.height + (pad.t + pad.b) * k));
        const g = out.getContext('2d');
        if (prepared.fill) {
            g.fillStyle = prepared.fill;
            g.fillRect(0, 0, out.width, out.height);
        }
        g.drawImage(canvas, x, y);
        this.composite(out, prepared, ed, { x, y, w: canvas.width, h: canvas.height });
        return out;
    },

    // The edit's paint onto a canvas of the photo as shown (see composite):
    // the canvas to use, a bigger (or smaller) one when the paint pads it.
    // Without `ed` it's the photo's own part only (Crop shows the whole
    // photo; the canvas is the crop's)
    async onto(canvas, e, ed = null) {
        if (!this.has(e)) return canvas;
        const prepared = await this.prepare(e);
        if (!ed) { this.composite(canvas, prepared, null); return canvas; }
        return this.padded(canvas, prepared, ed);
    }
};
