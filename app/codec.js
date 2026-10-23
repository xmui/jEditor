// Writing AVIF, JPEG XL and WebP (Convert, Export, Save edits), and
// reading JPEG XL where the engine
// can't: a few codec-worker.js workers, each doing one picture at a time.
//
//   Codec.ready()               whether the codecs load here (not in the
//                               single-file standalone.html, opened from disk)
//   Codec.encode(blob, format, quality, { crop, preview })
//                               → { bytes, w, h, rgb, preview }
//   Codec.showable(blob)        a JPEG XL as something the engine shows
//                               (itself when it can, else decoded to a PNG)

const Codec = {
    FORMATS: {
        avif: { label: 'AVIF', ext: 'avif', type: 'image/avif', quality: 60 },
        jxl: { label: 'JPEG XL', ext: 'jxl', type: 'image/jxl', quality: 85 },
        webp: { label: 'WebP', ext: 'webp', type: 'image/webp', quality: 80 }
    },
    workers: [],
    queue: [],
    jobs: new Map(),
    nextId: 1,

    // As many as there are cores to spare, up to six
    size() {
        return Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    },

    spawn() {
        const w = new Worker('codec-worker.js', { type: 'module' });
        w.busy = null;
        w.onmessage = (e) => this.settle(w, e.data);
        w.onerror = (e) => {
            e.preventDefault();
            const job = w.busy;
            w.busy = null;
            this.workers = this.workers.filter(x => x !== w);
            w.terminate();
            if (job) job.reject(new Error(e.message || 'the codec stopped'));
            this.pump();
        };
        this.workers.push(w);
        return w;
    },

    settle(w, data) {
        const job = w.busy;
        w.busy = null;
        if (job && job.id === data.id) {
            if (data.error) job.reject(new Error(data.error));
            else job.resolve(data);
        }
        this.pump();
    },

    pump() {
        while (this.queue.length) {
            let w = this.workers.find(x => !x.busy);
            if (!w && this.workers.length < this.size()) {
                try { w = this.spawn(); } catch (e) {
                    this.queue.splice(0).forEach(j => j.reject(e));
                    return;
                }
            }
            if (!w) return;
            const job = this.queue.shift();
            w.busy = job;
            w.postMessage({ id: job.id, ...job.msg });
        }
    },

    run(msg) {
        return new Promise((resolve, reject) => {
            this.queue.push({ id: this.nextId++, msg, resolve, reject });
            this.pump();
        });
    },

    // Once: can a worker load the codecs here?
    ready() {
        if (!this._ready) {
            this._ready = (async () => {
                if (location.protocol === 'file:' || typeof Worker === 'undefined') return false;
                try {
                    await Promise.race([this.run({ op: 'ping', name: 'avif_enc' }), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 20000))]);
                    return true;
                } catch (e) {
                    console.warn('The AVIF and JPEG XL codecs are unavailable:', e.message);
                    return false;
                }
            })();
        }
        return this._ready;
    },

    async encode(blob, format, quality, { crop = null, preview = false } = {}) {
        return this.run({ op: 'encode', file: blob, format, quality, crop, preview });
    },

    // Can the engine show JPEG XL itself? (Chromium can't yet: 141 can't,
    // even with its flag.) A tiny 1 × 1 JPEG XL, decoded once
    engineJxl() {
        if (this._engineJxl === undefined) {
            const b64 = '/woAELATAEiAKAD4AFUPAACoUBll3ODlXM+XHzospm1cZ2irbQsAAADgAfwrSRQZxyapDpnAIUksAhsXwwDGMMBTMseM00CQK0kA';
            this._engineJxl = createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/jxl' }))
                .then(b => { b.close(); return true; }, () => false);
        }
        return this._engineJxl;
    },

    // A JPEG XL file as something createImageBitmap and <img> take. The
    // last few are kept, so going back and forth doesn't decode again
    _shown: [],
    async showable(file) {
        if (await this.engineJxl()) return file;
        const key = `${file.name}|${file.size}|${file.lastModified}`;
        const hit = this._shown.find(x => x.key === key);
        if (hit) return hit.png;
        const { png } = await this.run({ op: 'decode', file });
        this._shown.unshift({ key, png });
        this._shown.length = Math.min(this._shown.length, 4);
        return png;
    },

    isJxl(name) {
        return /\.jxl$/i.test(name);
    },

    // 'avif' or 'jxl' for a file only the codecs write, else null
    of(name) {
        const m = /\.(avif|jxl)$/i.exec(name || '');
        return m ? m[1].toLowerCase() : null;
    },

    // A picture as a file of this format, with this EXIF (meta.js: made
    // true for its upright pixels) → Blob
    async file(blob, format, quality, tiff = null) {
        const r = await this.encode(blob, format, quality);
        return new Blob([this.withExif(r.bytes, format, tiff, r.w, r.h)], { type: this.FORMATS[format].type });
    },

    withExif(bytes, format, tiff, w, h) {
        const t = tiff && ImageMeta.tiffForUpright(tiff, w, h);
        if (!t) return bytes;
        if (format === 'webp') return ImageMeta.withExifWebp(bytes, t, w, h);
        if (format === 'avif') return ImageMeta.withExifAvif(bytes, t);
        if (format === 'jxl') return ImageMeta.withExifJxl(bytes, t);
        return bytes;
    }
};
