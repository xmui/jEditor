// Paint: layers painted over a photo (paint-editor.js is the screen).
// Like every edit it's kept with the photo, never in the file until it's
// saved or exported: the photo's edit gets `paint`, a list of layers, and
// each layer's pixels are a PNG in the project's own folder
// (.jeditor/paint/<id>-<layer>-<rev>.png; a new rev each time a layer
// changes, so Ctrl+Z on the edit finds the old one still there).
//
//   paint: { id, w, h, layers: [{ id, rev, name, opacity, blend, hidden }] }
//
// Layers cover the whole photo as it is on disk (before any crop or turn,
// w × h: the photo's own size, or less for a very big one), so cropping
// later doesn't move what was painted. They go on last, over the photo as
// cropped and adjusted, so what's painted looks as it was painted (a film
// look or a slider doesn't change it); they're scaled to whatever size the
// photo is shown or saved at.

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
        return !!(e && e.paint && Array.isArray(e.paint.layers) && e.paint.layers.length);
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
                hidden: !!l.hidden
            });
        }
        return layers.length ? { id: v.id, w: v.w, h: v.h, layers } : null;
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
        for (const e of edits) if (this.has(e)) for (const l of e.paint.layers) used.add(this.fileName(e.paint, l));
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

    // The visible layers' pictures, ready to draw: { w, h, layers: [{ src,
    // opacity, blend }] } (src: an ImageBitmap or canvas), or null
    async prepare(e) {
        if (!this.has(e)) return null;
        const p = e.paint;
        const layers = [];
        for (const l of p.layers) {
            if (l.hidden || !l.opacity) continue;
            const src = await this.layerBitmap(p, l);
            if (src) layers.push({ src, opacity: l.opacity, blend: l.blend });
        }
        return layers.length ? { w: p.w, h: p.h, layers } : null;
    },

    // ---- Drawn over a photo ----

    // The layers onto `canvas`: the photo as cropped by `ed` (a crop
    // editor on the W × H photo, CropEditor.fromSnapshot), or the whole
    // photo filling the canvas when there's no crop
    composite(canvas, prepared, ed = null) {
        if (!prepared) return;
        const ctx = canvas.getContext('2d');
        ctx.save();
        for (const l of prepared.layers) {
            ctx.globalAlpha = l.opacity;
            ctx.globalCompositeOperation = l.blend;
            this.drawThrough(ctx, ed, l.src, canvas.width, canvas.height);
        }
        ctx.restore();
    },

    // A picture of the whole photo drawn as `ed` crops it (as
    // CropEditor.drawOutput does), or stretched over w × h without one
    drawThrough(ctx, ed, src, w, h) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (!ed) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(src, 0, 0, w, h);
            return;
        }
        const o = ed.outputRect();
        const [c, s] = ed.cs();
        // The output canvas may be a different size from ed's (a preview)
        const k = w / o.w;
        ctx.setTransform(c * k, s * k, -s * k, c * k, -o.x0 * k, -o.y0 * k);
        ctx.drawImage(src, -ed.W / 2, -ed.H / 2, ed.W, ed.H);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    },

    // The edit's paint onto a canvas of the photo as shown (see composite)
    async onto(canvas, e, ed = null) {
        if (!this.has(e)) return;
        const prepared = await this.prepare(e);
        this.composite(canvas, prepared, ed);
    }
};
