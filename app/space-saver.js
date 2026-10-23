// Save space: a project's photos (or a folder's, or the selected ones)
// turned into a modern format that takes less room: AVIF, JPEG XL or WebP
// (codec.js). The right-click menus of the project, a folder and the
// selection, and the selection bar's ⋯.
//
//   Before    what it would save, worked out from a sample of the photos
//             (a square from the middle of each, at the quality chosen):
//             Now and After bars, the room saved by folder; the format; a
//             quality slider, with the smallest quality that looks the same
//             as the original marked on it; a close-up of one of the
//             photos, at its own pixels, original beside after, with sizes
//   While     100 dots, each a hundredth of the photos in their own colour
//             faint until they're done; a done dot turns hollow, green, for
//             the room got back, as many as the share saved so far. Goes on
//             with the window closed (the task in the corner says how far)
//   After     the room got back, and the project's size before and after
//
// Replace (the converted photo takes the original's place, the original
// goes to the bin or jEditor's trash; one Ctrl+Z puts them all back) or
// Keep both (smaller copies in "Smaller copies" in the project). Photos
// that wouldn't get smaller are left as they are; RAW files and GIFs too,
// and photos already in the format. Flags and edits go with each photo;
// its EXIF too (meta.js), its pixels upright and in sRGB.

const SpaceSaver = {
    KEY: 'jeditor.space-saver', // { format, keep, quality: { avif, jxl, webp } }
    SAMPLES: 12,
    SAMPLE_SIZE: 512,
    LOOKS_SAME: 0.985,          // SSIM of the close-up, original to after
    COPIES: 'Smaller copies',

    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        const panel = this.el('ss-panel');
        if (!panel) return;
        try { this.prefs = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { /* private mode */ }
        if (!this.prefs || typeof this.prefs !== 'object') this.prefs = {};
        if (!Codec.FORMATS[this.prefs.format]) this.prefs.format = 'avif';
        if (!this.prefs.quality || typeof this.prefs.quality !== 'object') this.prefs.quality = {};
        this.prefs.keep = !!this.prefs.keep;
        this.el('ss-close').addEventListener('click', () => this.close());
        this.el('ss-cancel').addEventListener('click', () => this.cancelOrStop());
        this.el('ss-go').addEventListener('click', () => this.go());
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.close(); });
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !UI.isOpen()) { e.preventDefault(); this.close(); }
            e.stopPropagation();
        });
        this.el('ss-body').addEventListener('click', (e) => {
            const b = e.target.closest('[data-format],[data-keep]');
            if (!b || this.run) return;
            if (b.dataset.format) this.setFormat(b.dataset.format);
            else this.setKeep(b.dataset.keep === 'keep');
        });
    },

    remember() {
        try { localStorage.setItem(this.KEY, JSON.stringify(this.prefs)); } catch (e) { /* private mode */ }
    },

    isOpen() {
        const p = this.el('ss-panel');
        return !!p && !p.classList.contains('hidden');
    },

    // { files } (the selection), { folder } (a folder in the project, '' for
    // all of it) or nothing (the whole project)
    async open({ files = null, folder = null } = {}) {
        const app = this.app;
        if (this.run) { this.show(); return; } // running: show how far it's got
        if (!app.dirHandle || app.readOnlyMode) {
            app.showToast('Save space needs a folder opened with Open folder');
            return;
        }
        if (!(await Codec.ready())) {
            app.showToast('Save space can\'t run here: open jEditor from its app or its web page');
            return;
        }
        const all = files ? files.filter(Boolean)
            : folder ? app.files.filter(f => Folders.within(Folders.dirOf(f), folder)) : app.files.slice();
        // What it's for, as the first line says it
        this.scope = {
            all,
            name: files ? null : folder ? Folders.nameOf(folder) : Folders.rootName()
        };
        this.done = null;
        this.est = null;
        this.suggested = {};
        this.reached = {};
        this.build();
        this.show();
        this.estimate();
    },

    show() {
        this.el('ss-panel').classList.remove('hidden');
        setTimeout(() => this.el('ss-go').focus(), 0);
    },

    close() {
        this.el('ss-panel').classList.add('hidden');
        this._gen = (this._gen || 0) + 1; // estimates still coming are dropped
        if (!this.run) this.dropCloseUp();
    },

    cancelOrStop() {
        if (this.run) this.stop();
        else this.close();
    },

    // The photos it would convert, and the ones it leaves (RAW, GIF, already
    // in the format)
    candidates(format = this.prefs.format) {
        const ext = Codec.FORMATS[format].ext;
        const ok = [], left = [];
        for (const f of this.scope.all) {
            if (Raw.is(f.name) || /\.gif$/i.test(f.name) || new RegExp(`\\.${ext}$`, 'i').test(f.name)) left.push(f);
            else ok.push(f);
        }
        return { ok, left };
    },

    fmt(n) { return this.app.formatBytes(n); },
    esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); },

    // ---- Before: the estimate ----

    build() {
        const f = Codec.FORMATS;
        this.el('ss-title').textContent = 'Save space';
        this.el('ss-body').innerHTML = `
            <p class="ss-lead" id="ss-lead"></p>
            <div class="ss-big" id="ss-big"></div>
            <div id="ss-folders-wrap"><div class="ss-h">By folder</div><div class="ss-folders" id="ss-folders"></div></div>
            <div class="ss-row">
                <div><div class="ss-h">Format</div><div class="ss-seg" role="radiogroup" aria-label="Format">
                    ${['avif', 'jxl', 'webp'].map(k => `<button type="button" role="radio" data-format="${k}">${f[k].label}<small>${{ avif: 'smallest', jxl: 'newest', webp: 'opens anywhere' }[k]}</small></button>`).join('')}
                </div></div>
                <div class="ss-q"><div class="ss-h">Quality <span class="ss-qnum" id="ss-qnum"></span></div>
                    <div class="ss-slider"><div class="ss-track"></div><div class="ss-sugg hidden" id="ss-sugg"><span id="ss-sugg-label">Looks the same</span></div>
                    <input type="range" id="ss-quality" min="20" max="98" step="1" aria-label="Quality"></div>
                    <div class="ss-ends"><span>Smaller</span><span>Better</span></div></div>
            </div>
            <div class="ss-compare">
                <div class="ss-tile"><canvas id="ss-orig" width="340" height="170"></canvas><span class="cap" id="ss-orig-cap">Original</span></div>
                <div class="ss-tile ss-after"><canvas id="ss-after" width="340" height="170"></canvas><span class="cap" id="ss-after-cap">After</span></div>
            </div>
            <div class="ss-keep"><span class="ss-h">The originals</span><div class="ss-seg" role="radiogroup" aria-label="The originals">
                <button type="button" role="radio" data-keep="replace">Replace them<small>to the bin, Ctrl+Z brings them back</small></button>
                <button type="button" role="radio" data-keep="keep">Keep both<small>smaller copies in a folder</small></button>
            </div></div>`;
        const q = this.el('ss-quality');
        q.addEventListener('input', () => {
            this.prefs.quality[this.prefs.format] = +q.value;
            this.prefs.touched = { ...(this.prefs.touched || {}), [this.prefs.format]: true };
            this.remember();
            this.syncQuality();
            this.estimateSoon();
        });
        this.syncChoices();
        this.paint();
    },

    quality(format = this.prefs.format) {
        return this.prefs.quality[format] || Codec.FORMATS[format].quality;
    },

    setFormat(k) {
        if (!Codec.FORMATS[k] || k === this.prefs.format) return;
        this.prefs.format = k;
        this.remember();
        this.syncChoices();
        this.estimate();
    },

    setKeep(on) {
        this.prefs.keep = on;
        this.remember();
        this.syncChoices();
        this.paint();
    },

    syncChoices() {
        for (const b of this.el('ss-body').querySelectorAll('[data-format]')) b.setAttribute('aria-checked', String(b.dataset.format === this.prefs.format));
        for (const b of this.el('ss-body').querySelectorAll('[data-keep]')) b.setAttribute('aria-checked', String((b.dataset.keep === 'keep') === this.prefs.keep));
        this.syncQuality();
    },

    syncQuality() {
        const q = this.el('ss-quality');
        if (!q) return;
        q.value = this.quality();
        this.el('ss-qnum').textContent = String(this.quality());
        const s = this.suggested[this.prefs.format], mark = this.el('ss-sugg');
        mark.classList.toggle('hidden', !s);
        if (s) mark.style.left = `${(s - 20) / (98 - 20) * 100}%`;
        // Grain only the highest qualities keep: the nearest it gets
        this.el('ss-sugg-label').textContent = this.reached[this.prefs.format] === false ? 'Closest to the original' : 'Looks the same';
    },

    estimateSoon() {
        clearTimeout(this._estTimer);
        this._estTimer = setTimeout(() => this.estimate(), 250);
    },

    // Photos spread over the folders and through each
    sample(list) {
        const byDir = new Map();
        for (const f of list) {
            const d = Folders.dirOf(f);
            if (!byDir.has(d)) byDir.set(d, []);
            byDir.get(d).push(f);
        }
        const out = [];
        const lists = [...byDir.values()];
        for (let round = 0; out.length < Math.min(this.SAMPLES, list.length); round++) {
            for (const l of lists) {
                if (out.length >= this.SAMPLES) break;
                // The middle of each folder first, then nearer its ends
                const i = Math.floor(l.length * ((round * 0.618 + 0.5) % 1));
                const f = l[i];
                if (f && !out.includes(f)) out.push(f);
            }
            if (round > this.SAMPLES * 2) break;
        }
        return out;
    },

    async size(f) {
        if (!(f.size >= 0)) { try { f.size = (await f.handle.getFile()).size; } catch (e) { f.size = 0; } }
        return f.size;
    },

    async estimate() {
        const gen = this._gen = (this._gen || 0) + 1;
        const live = () => gen === this._gen && this.isOpen() && !this.run;
        const format = this.prefs.format;
        const { ok } = this.candidates(format);
        let total = 0;
        for (const f of ok) total += await this.size(f);
        this.est = { format, total, list: ok, after: null, byDir: null, working: true };
        this.paint();
        if (!ok.length || !live()) return;
        const picks = this.sample(ok);
        // The close-up: the photo open now, if it's one of them
        const cur = this.app.currentFile && ok.includes(this.app.currentFile) ? this.app.currentFile : picks[0];
        if (!picks.includes(cur)) picks.unshift(cur);
        if (this._closeUpFor !== cur) await this.loadCloseUp(cur);
        if (!live()) return;
        if (!this.suggested[format]) await this.suggest(format, cur, live);
        if (!live()) return;
        const quality = this.quality(format);
        const ratios = new Map(); // folder → [ratio]
        const all = [];
        let preview = null;
        await Promise.all(picks.map(async (f) => {
            try {
                const src = await this.app.readImage(f);
                const r = await Codec.encode(src, format, quality, { crop: { size: this.SAMPLE_SIZE }, preview: f === cur });
                const side = Math.min(this.SAMPLE_SIZE, r.w, r.h);
                // Bytes a pixel after, against the photo's bytes a pixel now
                const ratio = Math.min(1, (r.bytes.length / (side * side)) / ((await this.size(f)) / (r.w * r.h)));
                const d = Folders.dirOf(f);
                if (!ratios.has(d)) ratios.set(d, []);
                ratios.get(d).push(ratio);
                all.push(ratio);
                if (f === cur) preview = { png: r.preview, ratio };
            } catch (e) {
                console.warn('Save space: no sample from', f.name, e.message);
            }
        }));
        if (!live() || !all.length) return;
        const mean = (a) => a.reduce((n, x) => n + x, 0) / a.length;
        const global = mean(all);
        const byDir = new Map();
        let after = 0;
        for (const f of ok) {
            const d = Folders.dirOf(f);
            const r = ratios.has(d) ? mean(ratios.get(d)) : global;
            const s = f.size * r;
            after += s;
            const row = byDir.get(d) || { now: 0, after: 0, n: 0 };
            row.now += f.size; row.after += s; row.n++;
            byDir.set(d, row);
        }
        this.est = { format, quality, total, list: ok, after, byDir, working: false };
        if (preview) await this.showAfter(preview.png, cur, preview.ratio);
        this.paint();
    },

    // ---- The close-up ----

    // The middle of the photo at its own pixels, from the original
    async loadCloseUp(f) {
        this.dropCloseUp();
        try {
            const bmp = await createImageBitmap(await this.app.readImage(f));
            const s = Math.min(this.SAMPLE_SIZE, bmp.width, bmp.height);
            const c = document.createElement('canvas');
            c.width = c.height = s;
            c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, s, s);
            bmp.close();
            this._closeUp = c;
            this._closeUpFor = f;
            this.drawTile('ss-orig', c);
            this.el('ss-orig-cap').innerHTML = `Original<small>${this.fmt(await this.size(f))}</small>`;
        } catch (e) {
            console.warn('Save space: no close-up of', f.name, e.message);
        }
    },

    dropCloseUp() {
        if (this._closeUp) this._closeUp.width = this._closeUp.height = 0;
        this._closeUp = this._closeUpFor = null;
    },

    // The middle of the square at its own pixels, one for one
    drawTile(id, src) {
        const c = this.el(id);
        if (!c || !src) return;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(src, Math.round((src.width - c.width) / 2), Math.round((src.height - c.height) / 2), c.width, c.height, 0, 0, c.width, c.height);
    },

    async showAfter(png, f, ratio) {
        try {
            const bmp = await createImageBitmap(png);
            this.drawTile('ss-after', bmp);
            bmp.close();
            this.el('ss-after-cap').innerHTML = `After<small>${this.fmt(await this.size(f) * ratio)}</small>`;
        } catch (e) { /* stays as it was */ }
    },

    // The smallest quality whose close-up looks the same as the original
    // (structural similarity, on brightness), marked on the slider; taken
    // as the quality until the slider's been moved for this format
    async suggest(format, f, live) {
        if (!this._closeUp) return;
        const ref = this.luma(this._closeUp);
        const src = await this.app.readImage(f);
        const looks = async (q) => {
            const r = await Codec.encode(src, format, q, { crop: { size: this.SAMPLE_SIZE }, preview: true });
            const bmp = await createImageBitmap(r.preview);
            const c = document.createElement('canvas');
            c.width = bmp.width; c.height = bmp.height;
            c.getContext('2d').drawImage(bmp, 0, 0);
            bmp.close();
            const s = this.ssim(ref, this.luma(c));
            c.width = c.height = 0;
            return s;
        };
        let lo = 30, hi = 95;
        try {
            if ((await looks(hi)) < this.LOOKS_SAME) {
                this.suggested[format] = hi;
                this.reached[format] = false;
            } else {
                this.reached[format] = true;
                while (hi - lo > 4) {
                    if (!live()) return;
                    const mid = Math.round((lo + hi) / 2);
                    if ((await looks(mid)) >= this.LOOKS_SAME) hi = mid; else lo = mid;
                }
                this.suggested[format] = hi;
            }
        } catch (e) {
            console.warn('Save space: no suggestion', e.message);
            return;
        }
        if (!(this.prefs.touched || {})[format]) this.prefs.quality[format] = this.suggested[format];
        this.syncQuality();
    },

    luma(c) {
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
        const out = new Float32Array(c.width * c.height);
        for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        out.w = c.width;
        return out;
    },

    // Mean SSIM over 8 × 8 windows
    ssim(a, b) {
        const w = a.w, h = Math.floor(a.length / w), C1 = 6.5025, C2 = 58.5225;
        if (b.length !== a.length) return 0;
        let sum = 0, n = 0;
        for (let y = 0; y + 8 <= h; y += 4) for (let x = 0; x + 8 <= w; x += 4) {
            let ma = 0, mb = 0;
            for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * w + x + i; ma += a[k]; mb += b[k]; }
            ma /= 64; mb /= 64;
            let va = 0, vb = 0, cov = 0;
            for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
                const k = (y + j) * w + x + i, da = a[k] - ma, db = b[k] - mb;
                va += da * da; vb += db * db; cov += da * db;
            }
            va /= 63; vb /= 63; cov /= 63;
            sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
            n++;
        }
        return n ? sum / n : 1;
    },

    // ---- Drawing the window ----

    paint() {
        if (this.run || this.done) return this.paintRun();
        const e = this.est, F = Codec.FORMATS[this.prefs.format];
        const { ok, left } = this.candidates();
        const lead = this.el('ss-lead');
        if (!lead) return;
        const n = `${ok.length.toLocaleString()} photo${ok.length === 1 ? '' : 's'}`;
        const what = this.scope.name ? `<b>${this.esc(this.scope.name)}</b>'s ${n}` : ok.length === 1 ? `<b>${this.esc(ok[0].name)}</b>` : `the <b>${n}</b> selected`;
        lead.innerHTML = `Turns ${what} into ${F.label}, which takes less room. They look the same; their dates, camera details, flags and edits go with them.` +
            (left.length ? ` ${left.length.toLocaleString()} ${left.length === 1 ? 'is' : 'are'} left as ${left.length === 1 ? 'it is' : 'they are'} (RAW, GIF or ${F.label} already).` : '');
        const big = this.el('ss-big');
        const now = e ? e.total : 0;
        if (!ok.length) {
            big.innerHTML = '<span class="ss-empty">Nothing here to convert.</span>';
        } else {
            const after = e && e.after !== null && !e.working ? e.after : null;
            const p = after !== null && now ? Math.max(0, Math.min(100, after / now * 100)) : 100;
            big.innerHTML = `
                <span class="lab">Now</span><div class="ss-bar"><i class="ss-now" style="width:100%"></i></div><span class="num">${this.fmt(now)}</span>
                <span class="lab">As ${F.label}</span><div class="ss-bar${after === null ? ' ss-working' : ''}">${after === null ? '' : `<i class="ss-after-bar" style="width:${p}%"></i><i class="ss-saved" style="left:${p}%;width:${100 - p}%"></i>${100 - p > 12 ? `<span class="ss-savedtag" style="left:${p}%">${this.fmt(now - after)} saved</span>` : ''}`}</div><span class="num">${after === null ? 'Working it out…' : '≈ ' + this.fmt(after)}</span>`;
        }
        const rows = e && e.byDir ? [...e.byDir.entries()].sort((a, b) => b[1].now - a[1].now) : [];
        this.el('ss-folders-wrap').classList.toggle('hidden', rows.length < 2);
        this.el('ss-folders').innerHTML = rows.slice(0, 5).map(([d, r]) => {
            const pct = Math.round((1 - r.after / r.now) * 100);
            return `<div class="ss-folder"><span class="n">${this.esc(Folders.nameOf(d))}<small>${r.n.toLocaleString()} photo${r.n === 1 ? '' : 's'}</small></span><div class="ss-mini"><i style="width:100%" class="ss-now"></i><i class="ss-after-bar" style="width:${100 - pct}%"></i></div><span class="s">${this.fmt(r.now)} → <b>−${pct}%</b></span></div>`;
        }).join('');
        this.el('ss-note').textContent = this.prefs.keep
            ? `Smaller copies go in “${this.COPIES}” in the project; nothing's deleted`
            : Host.say(`The originals go to ${Host.has('recycle') ? Host.words().bin : 'jEditor\'s trash'} until you're happy · Ctrl+Z puts them back`);
        const go = this.el('ss-go');
        go.textContent = ok.length ? `Convert ${ok.length.toLocaleString()} photo${ok.length === 1 ? '' : 's'}` : 'Convert';
        go.disabled = !ok.length;
        go.classList.remove('hidden');
        this.el('ss-cancel').textContent = 'Cancel';
    },

    // ---- While: converting ----

    async go() {
        if (this.done) { this.done = null; this.close(); return; }
        if (this.run) { this.togglePause(); return; }
        const format = this.prefs.format, quality = this.quality(format);
        const { ok } = this.candidates(format);
        if (!ok.length) return;
        this._gen = (this._gen || 0) + 1; // no more estimates
        const total = ok.reduce((n, f) => n + (f.size || 0), 0);
        const run = this.run = {
            format, quality, keep: this.prefs.keep, list: ok, total, scopeName: this.scope.name || `${ok.length.toLocaleString()} photo${ok.length === 1 ? '' : 's'}`,
            at: 0, done: 0, before: 0, after: 0, saved: 0, same: 0, failed: 0, taken: 0,
            colours: new Array(ok.length).fill(null), paused: false, stopped: false,
            items: [], copies: [], started: performance.now(), busyMs: 0
        };
        this.el('ss-title').textContent = 'Saving space';
        this.el('ss-body').innerHTML = `<div class="ss-dots" id="ss-dots">${'<i></i>'.repeat(this.dotCount())}</div>
            <div class="ss-run-row"><span><b id="ss-saved">0 B</b> saved</span><span id="ss-count"></span></div>`;
        this.paintRun();
        this.app.beginTask('space-saver', `Saving space 0/${ok.length}`);
        const tasks = Array.from({ length: Codec.size() }, () => this.worker(run));
        await Promise.all(tasks);
        this.finish(run);
    },

    // A hundred, whatever the number of photos (a few photos: several dots each)
    dotCount() {
        return 100;
    },

    togglePause() {
        const run = this.run;
        if (!run) return;
        run.paused = !run.paused;
        if (!run.paused && run.resume) { run.resume(); run.resume = null; }
        this.paintRun();
    },

    stop() {
        const run = this.run;
        if (!run) return;
        run.stopped = true;
        if (run.resume) { run.resume(); run.resume = null; }
        this.paintRun();
    },

    async worker(run) {
        while (!run.stopped) {
            if (run.paused) { await new Promise(res => { const prev = run.resume; run.resume = () => { if (prev) prev(); res(); }; }); continue; }
            const i = run.at++;
            if (i >= run.list.length) return;
            const f = run.list[i];
            const t0 = performance.now();
            try {
                await this.convertOne(run, f, i);
            } catch (e) {
                console.error('Save space failed for', f.name, e);
                run.failed++;
            }
            run.busyMs += performance.now() - t0;
            run.done++;
            this.app.updateTask('space-saver', `Saving space ${run.done}/${run.list.length}`);
            this.paintRunSoon();
        }
    },

    async convertOne(run, f, i) {
        const app = this.app;
        if (f._rotationQueue) await f._rotationQueue;
        const data = await f.handle.getFile();
        const before = data.size;
        const head = new Uint8Array(await (/\.jpe?g$/i.test(f.name) ? data.slice(0, 256 * 1024) : data).arrayBuffer());
        const r = await Codec.encode(await app.readImage(f), run.format, run.quality);
        run.colours[i] = r.rgb;
        const bytes = Codec.withExif(r.bytes, run.format, ImageMeta.exifOf(head), r.w, r.h);
        run.before += before;
        // Not worth it: left as it is
        if (bytes.length >= before * 0.97) {
            run.after += before;
            run.same++;
            return;
        }
        const newName = f.name.replace(/\.[^.]+$/, '') + '.' + Codec.FORMATS[run.format].ext;
        const dir = f.parentDir || app.dirHandle;
        if (run.keep) {
            const out = await this.copiesDir(Folders.dirOf(f));
            const h = await out.getFileHandle(newName, { create: true });
            const w = await h.createWritable();
            await w.write(bytes);
            await w.close();
            run.copies.push({ dir: out, name: newName });
            run.after += bytes.length;
            run.saved += before - bytes.length;
            return;
        }
        // The name it'll have must be free (another photo may have it)
        try {
            await dir.getFileHandle(newName);
            run.taken++;
            run.after += before;
            return;
        } catch (e) { /* free */ }
        const nh = await dir.getFileHandle(newName, { create: true });
        const w = await nh.createWritable();
        await w.write(bytes);
        await w.close();
        // The original to the bin (or jEditor's trash): Ctrl+Z brings it back
        const trashed = await this.trash(f);
        if (!trashed) {
            await dir.removeEntry(newName).catch(() => { });
            throw new Error('the original couldn\'t be moved to the bin');
        }
        const oldName = f.name;
        f.handle = nh;
        app.nameChanged(f, newName);
        await app.afterFileChanged(f);
        // An edit is kept for the file it was made on (its size): this one now
        const editSize = f._edit ? f._edit.size : undefined;
        if (f._edit && f._edit.size) f._edit = { ...f._edit, size: f.size };
        run.items.push({ file: f, oldName, newName, dir, trash: trashed, editSize });
        run.after += bytes.length;
        run.saved += before - bytes.length;
    },

    // One photo to the bin or jEditor's trash, as Delete does → its undo item
    async trash(f) {
        const app = this.app;
        if (Host.has('recycle')) {
            const res = (await app.recycleFiles([f])).get(f) || {};
            if (res.token) return { file: f, recycled: res.token };
            if (!res.noBin) return null;
        }
        const moved = new Set(), undoItems = [];
        const failed = await app.trashIntoFolder([f], { moved, undoItems, alreadyGone: [] });
        return failed ? null : undoItems[0] || null;
    },

    // "Smaller copies" in the project, with the photo's folders under it
    async copiesDir(rel) {
        let d = await this.app.dirHandle.getDirectoryHandle(this.COPIES, { create: true });
        for (const part of rel.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create: true });
        return d;
    },

    paintRunSoon() {
        if (this._runFrame) return;
        this._runFrame = requestAnimationFrame(() => { this._runFrame = 0; this.paintRun(); });
    },

    // The dots: each a share of the photos, in their colour once done; done
    // ones turn hollow, as many as the share saved so far
    paintRun() {
        const run = this.run || this.done;
        const dots = this.el('ss-dots');
        if (!run || !dots) return;
        const n = dots.children.length, per = run.list.length / n;
        const share = run.before ? run.saved / run.before : 0;
        const dotsDone = [], fill = [];
        for (let k = 0; k < n; k++) {
            const from = Math.floor(k * per), to = Math.max(from + 1, Math.floor((k + 1) * per));
            let r = 0, g = 0, b = 0, c = 0, all = true;
            for (let i = from; i < to; i++) {
                const rgb = run.colours[i];
                if (rgb) { r += rgb[0]; g += rgb[1]; b += rgb[2]; c++; } else all = false;
            }
            if (all && c > 0) dotsDone.push(k);
            fill.push({ c, done: all && c > 0, rgb: c ? `rgb(${Math.round(r / c)},${Math.round(g / c)},${Math.round(b / c)})` : '' });
        }
        // Hollow ones: as many done dots as the share saved, spread through
        // them, and a dot once hollow stays so (they don't jump about)
        const hollow = run.hollow || (run.hollow = new Set());
        const want = Math.floor(dotsDone.length * share);
        while (hollow.size > want) hollow.delete([...hollow].pop());
        const next = dotsDone.filter(k => !hollow.has(k)).sort((a, b) => (a * 0.618) % 1 - (b * 0.618) % 1);
        for (const k of next) { if (hollow.size >= want) break; hollow.add(k); }
        fill.forEach((d, k) => {
            const dot = dots.children[k], h = hollow.has(k);
            dot.className = h ? 'f' : d.done ? 'd' : d.c ? 'p' : '';
            dot.style.background = h ? '' : d.rgb;
            if (!d.done && k === Math.floor(run.done / per) && this.run) dot.classList.add('now');
        });
        this.el('ss-saved').textContent = this.fmt(run.saved);
        const left = run.list.length - run.done;
        const rate = run.done ? run.busyMs / run.done / Codec.size() : 0;
        const mins = rate && left ? Math.max(1, Math.round(left * rate / 60000)) : 0;
        if (this.run) {
            this.el('ss-count').textContent = `${run.done.toLocaleString()} of ${run.list.length.toLocaleString()}` +
                (run.paused ? ' · paused' : run.stopped ? ' · stopping…' : mins ? ` · ${mins} min left` : '');
            this.el('ss-note').textContent = run.paused ? 'Paused: it\'ll wait for you' : 'Keep using jEditor meanwhile: it carries on with this closed';
            const go = this.el('ss-go');
            go.textContent = run.paused ? 'Go on' : 'Pause';
            go.disabled = run.stopped;
            this.el('ss-cancel').textContent = 'Stop';
        } else {
            const notes = [];
            if (run.same) notes.push(`${run.same.toLocaleString()} wouldn't get smaller, so ${run.same === 1 ? 'it was' : 'they were'} left`);
            if (run.taken) notes.push(`${run.taken.toLocaleString()} left: a file with the new name was there`);
            if (run.failed) notes.push(`${run.failed.toLocaleString()} failed`);
            this.el('ss-count').textContent = `${(run.done - run.same - run.taken - run.failed).toLocaleString()} photo${run.done - run.same - run.taken - run.failed === 1 ? '' : 's'}` +
                (run.stopped ? ` (stopped at ${run.done.toLocaleString()} of ${run.list.length.toLocaleString()})` : '');
            this.el('ss-total-line').textContent = `${run.scopeName} ${this.fmt(run.total)} → ${this.fmt(Math.max(0, run.total - run.saved))}`;
            this.el('ss-note').textContent = (notes.length ? notes.join(' · ') + ' · ' : '') + (run.keep
                ? `The copies are in “${this.COPIES}”`
                : Host.say(`The originals are in ${Host.has('recycle') ? Host.words().bin : 'jEditor\'s trash'} until it's emptied · Ctrl+Z puts them back`));
            const go = this.el('ss-go');
            go.textContent = 'Done';
            go.disabled = false;
            this.el('ss-cancel').classList.add('hidden');
        }
    },

    finish(run) {
        this.app.endTask('space-saver');
        this.run = null;
        this.done = run;
        Flags.saveSoon();
        Edits.saveSoon();
        if (run.items.length) this.app.sortFiles();
        if (run.items.length || run.copies.length) {
            this.app.pushUndo({ type: 'space-saver', label: 'save space', format: run.format, items: run.items, copies: run.copies });
        }
        this.el('ss-title').textContent = 'Space saved';
        const row = this.el('ss-body').querySelector('.ss-run-row');
        if (row) row.innerHTML = `<span><b id="ss-saved"></b> back</span><span id="ss-count"></span>`;
        if (!this.el('ss-total-line')) this.el('ss-body').insertAdjacentHTML('beforeend', '<div class="ss-total-line" id="ss-total-line"></div>');
        this.paintRun();
        if (!this.isOpen()) {
            this.app.showToast(`Saved ${this.fmt(run.saved)}: ${(run.done - run.same - run.taken - run.failed).toLocaleString()} photos are ${Codec.FORMATS[run.format].label} now`, 6000, null,
                { label: 'Show', run: () => this.show() }, { type: 'success' });
        }
    },

    // Ctrl+Z: the originals back, the converted photos (or the copies) gone
    async undo(entry) {
        const app = this.app;
        const many = entry.items.length + entry.copies.length > 1;
        if (many) app.beginTask('undo-space', 'Putting the originals back…');
        let failed = 0;
        try {
            for (const c of entry.copies) {
                try { await c.dir.removeEntry(c.name); } catch (e) { failed++; }
            }
            let next = 0;
            const work = async () => {
                while (next < entry.items.length) {
                    const it = entry.items[next++];
                    const f = it.file;
                    try {
                        // The converted file goes, the photo takes its old name
                        // back, and the original comes out of the bin into it
                        const idx = app.files.indexOf(f);
                        if (idx !== -1) app.files.splice(idx, 1);
                        await it.dir.removeEntry(it.newName).catch(() => { });
                        app.nameChanged(f, it.oldName);
                        await app.restoreFromTrash(it.trash);
                        await app.afterFileChanged(f);
                        if (f._edit && it.editSize) f._edit = { ...f._edit, size: it.editSize };
                    } catch (e) {
                        console.error('Couldn\'t put back', it.oldName, e);
                        failed++;
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(app.TRASH_CONCURRENCY, entry.items.length) }, work));
        } finally {
            if (many) app.endTask('undo-space');
        }
        Flags.saveSoon();
        Edits.saveSoon();
        app.sortFiles();
        if (failed) throw new Error(`${failed} couldn't be put back`);
        const n = entry.items.length || entry.copies.length;
        app.showToast(entry.items.length ? `Put back ${n} original${n === 1 ? '' : 's'}` : `Removed ${n} smaller cop${n === 1 ? 'y' : 'ies'}`, 3000, null, null, { kind: 'undo' });
    }
};
