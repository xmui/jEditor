// Auto crop's test set (docs/auto-crop-plan.md, step 1; the format is in
// docs/auto-crop-test-set.md).
//
// Every crop saved in the crop editor is logged with what Auto found on
// that photo, if it ran. When it did, the scan itself is kept too, with
// its label: Auto's crop saved as it was (accepted), changed (corrected),
// no print found (missed) or taken back to the whole photo (unwanted). So
// every crop done by hand is a test case for a better Auto.
//
// A photo batch Auto crop cropped (script.js) and then fixed in the editor
// counts too: the editor sees the cropped file, so its crop is put back
// onto the scan, the original batch Auto crop kept in the project's
// originals/. Recover does that for crops saved before this was done.
//
// Kept in jEditor's storage on this PC (a browser: its private storage),
// up to MAX_BYTES, oldest out first. Settings → Auto crop: on or off,
// Export… to a folder, Recover, Clear.

const CropLog = {
    DIR: 'auto-crop-tests',
    LOG: 'log.jsonl',
    KEY: 'jeditor.cropLog',
    MAX_BYTES: 1024 * 1024 * 1024,

    el(id) { return document.getElementById(id); },

    enabled() {
        try { return localStorage.getItem(this.KEY) !== '0'; } catch (e) { return true; }
    },

    setEnabled(on) {
        try { localStorage.setItem(this.KEY, on ? '1' : '0'); } catch (e) { /* private mode */ }
    },

    init(app) {
        this.app = app;
        const on = this.el('crop-log-on');
        if (!on) return;
        on.addEventListener('change', () => this.setEnabled(on.checked));
        this.el('crop-log-export').addEventListener('click', () => this.export());
        this.el('crop-log-recover').addEventListener('click', () => this.recover());
        this.el('crop-log-clear').addEventListener('click', () => this.clear());
    },

    // Settings opened: the switch and how many are kept
    async refresh() {
        const on = this.el('crop-log-on');
        if (!on) return;
        on.checked = this.enabled();
        const out = this.el('crop-log-count');
        const { scans, bytes } = await this.usage().catch(() => ({ scans: 0, bytes: 0 }));
        out.textContent = scans ? `${scans} scan${scans === 1 ? '' : 's'} kept · ${this.size(bytes)}` : 'None kept yet';
        this.el('crop-log-export').disabled = !scans;
        this.el('crop-log-clear').disabled = !scans;
    },

    size(b) {
        return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
    },

    async base() {
        const native = FolderCache.native();
        return native ? native.dataDir() : navigator.storage.getDirectory();
    },

    async dir(create = true) {
        return (await this.base()).getDirectoryHandle(this.DIR, { create });
    },

    // ---- What's recorded ----

    // The editor's crop as four corners in the photo's pixels (as shown:
    // EXIF orientation applied), top-left first, clockwise
    quad(ed) {
        const o = ed.outputRect();
        const r2 = (v) => Math.round(v * 100) / 100;
        return [[o.x0, o.y0], [o.x1, o.y0], [o.x1, o.y1], [o.x0, o.y1]].map(([x, y]) => {
            const p = ed.toImage({ x, y });
            return [r2(p.x + ed.W / 2), r2(p.y + ed.H / 2)];
        });
    },

    // Auto ran in the editor (det: what it found, or null), after the crop
    // was fitted to it
    noteAuto(ed, det) {
        ed._auto = det ? this.autoOf(ed, det) : { found: false };
    },

    // What Auto found (det) and the crop it made on ed, for a label
    autoOf(ed, det) {
        return {
            found: true,
            finder: det.finder || (det.feeder ? 'feeder' : 'flatbed'),
            tilt: Math.round(det.tilt * 1000) / 1000,
            sides: det.found,
            corners: det.corners.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]),
            crop: this.quad(ed)
        };
    },

    // How far apart two crops are: the farthest corner from its nearest in
    // the other, in pixels (a crop turned a quarter starts at another corner)
    apart(a, b) {
        const far = (p, q) => Math.max(...p.map(([x, y]) => Math.min(...q.map(([u, v]) => Math.hypot(x - u, y - v)))));
        return Math.max(far(a, b), far(b, a));
    },

    // The scan's dpi as a number (ImageMeta.readDpi gives { x, y })
    dpiOf(d) {
        const v = d && typeof d === 'object' ? d.x : d;
        return typeof v === 'number' && v > 0 ? Math.round(v) : null;
    },

    // The editor's crop, about to be saved → a log entry (null: off).
    // The whole photo with no Auto is kept only if batch Auto crop made
    // it (keep): then it's Auto's crop saved as it was.
    entry(app, ed, file) {
        if (!this.enabled() || !ed.ready) return null;
        const none = ed.isIdentity() && !ed.q;
        const auto = ed._auto || null;
        const o = ed.outputRect();
        const out = {
            v: 1,
            at: new Date().toISOString(),
            version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null,
            project: app.dirHandle ? app.dirHandle.name : null,
            file: file.relPath || file.name,
            W: ed.W, H: ed.H, dpi: this.dpiOf(ed.dpi),
            result: 'manual', diff: null,
            auto,
            saved: { none, crop: this.quad(ed), angle: ed.angle, q: ed.q, w: o.w, h: o.h, aspect: ed.aspectKey }
        };
        if (none && !(auto && auto.found)) out.batchOnly = true; // nothing cropped, nothing found
        return this.judge(out);
    },

    // Its result, from Auto's crop and the one saved
    judge(e) {
        const auto = e.auto;
        // A change smaller than this (0.25 mm at the scan's dpi) is Auto's
        // crop saved as it was
        const tol = Math.max(3, (this.dpiOf(e.dpi) || 0) * 0.25 / 25.4);
        e.result = 'manual';
        e.diff = null;
        if (auto && auto.found) {
            e.diff = Math.round(this.apart(auto.crop, e.saved.crop) * 10) / 10;
            e.result = e.saved.none ? 'unwanted' : e.diff <= tol ? 'accepted' : 'corrected';
        } else if (auto) {
            e.result = 'missed';
        }
        return e;
    },

    // Kept: the log line always; the scan too when Auto ran on it.
    // bytes: the photo's bytes before the save, or a function giving them.
    // A crop with no Auto on a photo batch Auto crop cropped becomes one on
    // the original scan (fromBatch). In the background; never holds up or
    // fails a save.
    keep(entry, bytes) {
        if (!entry) return Promise.resolve();
        const app = this.app;
        const originals = !entry.auto && app && app.dirHandle ? this.originals(app) : null;
        const job = async () => {
            if (originals) {
                const hit = await this.fromBatch(entry, await originals, Date.now()).catch(() => null);
                if (hit) { entry = hit.entry; bytes = hit.data; }
            }
            if (entry.batchOnly) return; // the whole photo, not from batch Auto crop
            await this.write(entry, bytes);
        };
        this._queue = (this._queue || Promise.resolve()).then(job).catch(e => console.warn('Auto crop test set:', e));
        return this._queue;
    },

    async write(entry, bytes) {
        const dir = await this.dir(true);
        if (entry.auto) {
            const data = typeof bytes === 'function' ? await bytes() : bytes;
            if (data) await this.putScan(dir, entry, data);
        }
        await this.append(dir, JSON.stringify(entry) + '\n');
        await this.prune(dir);
    },

    // The scan and its label, named by when the crop was saved
    async putScan(dir, entry, data) {
        entry.scan = this.stem(entry);
        await this.put(dir, entry.scan, data);
        await this.put(dir, entry.scan + '.json', JSON.stringify(entry, null, 1));
    },

    stem(entry) {
        const name = String(entry.file).split('/').pop();
        return `${entry.at.replace(/[-:]/g, '').replace(/\..*$/, '')}-${name}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    },

    async put(dir, name, data) {
        const h = await dir.getFileHandle(name, { create: true });
        const w = await h.createWritable();
        await w.write(data);
        await w.close();
    },

    async append(dir, line) {
        const h = await dir.getFileHandle(this.LOG, { create: true });
        const at = (await h.getFile()).size;
        const w = await h.createWritable({ keepExistingData: true });
        await w.seek(at);
        await w.write(line);
        await w.close();
    },

    // The scans kept: [{ name, size }] oldest first (names start with the time)
    async scans(dir) {
        const out = [];
        for await (const [name, h] of dir.entries()) {
            if (h.kind !== 'file' || name === this.LOG || name.endsWith('.json')) continue;
            out.push({ name, size: (await h.getFile()).size });
        }
        return out.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    },

    async usage() {
        let dir;
        try { dir = await this.dir(false); } catch (e) { return { scans: 0, bytes: 0 }; }
        const list = await this.scans(dir);
        return { scans: list.length, bytes: list.reduce((s, f) => s + f.size, 0) };
    },

    // Over the limit: the oldest scans go, with their labels (their log
    // lines stay)
    async prune(dir) {
        const list = await this.scans(dir);
        let total = list.reduce((s, f) => s + f.size, 0);
        for (const f of list) {
            if (total <= this.MAX_BYTES) break;
            await dir.removeEntry(f.name).catch(() => { });
            await dir.removeEntry(f.name + '.json').catch(() => { });
            total -= f.size;
        }
    },

    // ---- Batch Auto crop, then fixed in the editor ----

    // The open project's originals/ (batch Auto crop's, script.js), or null
    async originals(app) {
        try {
            const root = await FolderCache.root(app, false);
            return root ? await root.getDirectoryHandle('originals') : null;
        } catch (e) {
            return null;
        }
    },

    // The originals of a photo named `name`, newest first: [{ t, h }]
    // (batch Auto crop names them `<time>-<random>-<name>`)
    async originalsOf(originals, name) {
        const out = [];
        for await (const [n, h] of originals.entries()) {
            const m = /^([0-9a-z]+)-[0-9a-z]+-(.+)$/.exec(n);
            if (h.kind === 'file' && m && m[2] === name) out.push({ t: parseInt(m[1], 36), h });
        }
        return out.sort((a, b) => b.t - a.t);
    },

    // A photo's bytes as Auto sees them, as batch Auto crop and the editor
    // read it (script.js getDisplaySource): the screen-sized preview of a
    // big scan, else the photo. → { bmp, W, H }, W × H the photo's size
    async sight(data) {
        const app = this.app;
        const edge = app.previewEdge();
        const dims = ImageMeta.readPixelSize(new Uint8Array(await data.slice(0, 256 * 1024).arrayBuffer()));
        if (!dims || Math.max(dims.w, dims.h) > edge * 1.2) {
            const rec = await app.generatePreview(data, edge);
            if (rec && rec.blob) return { bmp: await createImageBitmap(rec.blob), W: rec.w, H: rec.h };
        }
        const bmp = await createImageBitmap(data);
        return { bmp, W: bmp.width, H: bmp.height };
    },

    // Auto on a scan, every way batch Auto crop might have run it (from
    // the selection bar, or after scanning, with the aspect ratio chosen
    // then): the first whose crop is w × h, or with no size, the plain
    // one. → { ed, det } or null
    async rerun(data, w = 0, h = 0) {
        const { bmp, W, H } = await this.sight(data);
        try {
            const aspects = [...new Set([CropEditor.loadAspect(), 'free'])];
            for (const opts of [{}, { scan: true }, { feeder: true, scan: true }]) {
                const det = CropAuto.find(bmp, W, H, opts);
                if (!det) continue;
                for (const key of aspects) {
                    const ed = CropEditor.headless(W, H);
                    ed.aspectKey = key;
                    ed.fitToPrint(det);
                    const o = ed.outputRect();
                    if (!w || (o.w === w && o.h === h)) return { ed, det };
                }
            }
            return null;
        } finally {
            bmp.close();
        }
    },

    // A crop saved (entry) on a photo batch Auto crop had cropped, put back
    // onto the scan: the newest original of that photo from before `before`
    // that Auto crops to the photo's size. → { entry, data } or null
    async fromBatch(entry, originals, before) {
        if (!originals || entry.auto) return null;
        const name = String(entry.file).split('/').pop();
        const list = (await this.originalsOf(originals, name)).filter(o => o.t <= before);
        for (const { h } of list.slice(0, 3)) {
            const data = await h.getFile();
            const hit = await this.rerun(data, entry.W, entry.H);
            if (!hit) continue;
            const { ed, det } = hit;
            // A pixel of the cropped photo → the scan's
            const o = ed.outputRect();
            const r2 = (v) => Math.round(v * 100) / 100;
            const onScan = ([x, y]) => {
                const p = ed.toImage({ x: o.x0 + x, y: o.y0 + y });
                return [r2(p.x + ed.W / 2), r2(p.y + ed.H / 2)];
            };
            const out = {
                ...entry, W: ed.W, H: ed.H, batch: true,
                auto: this.autoOf(ed, det),
                saved: { ...entry.saved, none: false, crop: entry.saved.crop.map(onScan), angle: r2(ed.angle + (entry.saved.angle || 0)) }
            };
            delete out.batchOnly;
            return { entry: this.judge(out), data };
        }
        return null;
    },

    // A crop saved in the editor on a photo whose crop was kept as an edit
    // (Save edits when done, edits.js), before Auto's crop was kept with
    // it: the scan is the photo as it was, still in the project while its
    // edit waits, or in originals/ once the edits were saved.
    // → { entry, data } or null
    async fromKept(entry, originals) {
        if (entry.auto) return null;
        const app = this.app;
        const name = String(entry.file).split('/').pop();
        const here = (app.files || []).find(f => (f.relPath || f.name) === entry.file);
        const found = [];
        if (here && Edits.get(here)) found.push(() => here.handle.getFile());
        if (originals) for (const { h } of await this.originalsOf(originals, name)) found.push(() => h.getFile());
        for (const read of found.slice(0, 4)) {
            const data = await read().catch(() => null);
            if (!data) continue;
            const dims = await this.sight(data).then(s => { s.bmp.close(); return s; });
            if (dims.W !== entry.W || dims.H !== entry.H) continue;
            const hit = await this.rerun(data);
            const out = { ...entry, auto: hit ? this.autoOf(hit.ed, hit.det) : { found: false } };
            return { entry: this.judge(out), data };
        }
        return null;
    },

    // Crops fixed in the editor after a batch Auto crop, saved before
    // those were kept: their log lines (no scan) in the open project become
    // test scans, from the originals jEditor kept. Auto's part is Auto run
    // again on the scan now.
    async recover() {
        const app = this.app;
        if (!app.dirHandle) {
            app.showToast('Open the project the crops were done in first');
            return;
        }
        const project = app.dirHandle.name;
        const key = 'crop-log-recover';
        app.beginTask(key, 'Recovering Auto crop tests…');
        let added = 0, left = 0;
        try {
            await this._queue; // crops still being kept
            let dir, text = '';
            try {
                dir = await this.dir(false);
                text = await (await (await dir.getFileHandle(this.LOG)).getFile()).text();
            } catch (e) { /* nothing logged */ }
            const lines = text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } });
            const todo = lines.filter(l => l && !l.scan && !l.auto && l.project === project);
            if (!todo.length) {
                app.showToast(`No crops to recover in ${project}`, 3000);
                return;
            }
            const originals = await this.originals(app);
            for (let i = 0; i < todo.length; i++) {
                app.updateTask(key, `Recovering Auto crop tests ${i + 1}/${todo.length}`);
                const line = todo[i];
                let hit = null;
                try {
                    hit = await this.fromBatch(line, originals, Date.parse(line.at)) || await this.fromKept(line, originals);
                } catch (e) {
                    console.warn('Auto crop test set: recover', line.file, e);
                }
                if (!hit) { left++; continue; }
                const entry = { ...hit.entry, recovered: true };
                await this.putScan(dir, entry, hit.data);
                lines[lines.indexOf(line)] = entry;
                added++;
            }
            if (added) {
                await this.put(dir, this.LOG, lines.filter(Boolean).map(l => JSON.stringify(l) + '\n').join(''));
                await this.prune(dir);
            }
            const notes = left ? ` — ${left} couldn't be matched to a scan` : '';
            app.showToast(added ? `Recovered ${added} test scan${added === 1 ? '' : 's'} from ${project}${notes}` : `Nothing recovered from ${project}${notes}`,
                4500, null, null, { type: added ? 'success' : 'info' });
        } catch (e) {
            app.showToast('Recover failed: ' + e.message, 4000);
        } finally {
            app.endTask(key);
            await this.refresh();
        }
    },

    // ---- Settings ----

    // Everything kept, copied into a new folder in one the user picks
    async export() {
        const app = this.app;
        let to;
        try {
            to = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (e) {
            if (e.name !== 'AbortError') app.showToast('Couldn\'t open that folder: ' + e.message, 4000);
            return;
        }
        try {
            const from = await this.dir(false);
            const name = `jEditor Auto crop tests ${new Date().toISOString().slice(0, 10)}`;
            const out = await to.getDirectoryHandle(name, { create: true });
            let n = 0;
            for await (const [file, h] of from.entries()) {
                if (h.kind !== 'file') continue;
                await this.put(out, file, await h.getFile());
                if (!file.endsWith('.json') && file !== this.LOG) n++;
            }
            app.showToast(`Exported ${n} scan${n === 1 ? '' : 's'} to "${name}"`, 3500, null, null, { type: 'success' });
        } catch (e) {
            app.showToast('Export failed: ' + e.message, 4000);
        }
    },

    async clear() {
        const yes = await UI.confirm({
            title: 'Clear the Auto crop test scans?',
            message: 'The scans kept for testing Auto crop, and the log of crops, are removed from ' + Host.words().computer + '. Your photos aren\'t touched.',
            ok: 'Clear', danger: true
        });
        if (!yes) return;
        try {
            await (await this.base()).removeEntry(this.DIR, { recursive: true });
        } catch (e) { /* none kept */ }
        await this.refresh();
    }
};
