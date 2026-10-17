// Auto crop's test set (docs/auto-crop-plan.md, step 1; the format is in
// docs/auto-crop-test-set.md).
//
// Every crop saved in the crop editor is logged with what Auto found on
// that photo, if it ran. When it did, the scan itself is kept too, with
// its label: Auto's crop saved as it was (accepted), changed (corrected),
// no print found (missed) or taken back to the whole photo (unwanted). So
// every crop done by hand is a test case for a better Auto.
//
// Kept in jEditor's storage on this PC (a browser: its private storage),
// up to MAX_BYTES, oldest out first. Settings → Auto crop: on or off,
// Export… to a folder, Clear.

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
        ed._auto = det ? {
            found: true,
            finder: det.finder || (det.feeder ? 'feeder' : 'flatbed'),
            tilt: Math.round(det.tilt * 1000) / 1000,
            sides: det.found,
            corners: det.corners.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]),
            crop: this.quad(ed)
        } : { found: false };
    },

    // How far apart two crops are: the farthest corner, in pixels
    apart(a, b) {
        return Math.max(...a.map(([x, y], i) => Math.hypot(x - b[i][0], y - b[i][1])));
    },

    // The editor's crop, about to be saved → a log entry (null: off)
    entry(app, ed, file) {
        if (!this.enabled() || !ed.ready) return null;
        const none = ed.isIdentity() && !ed.q;
        const auto = ed._auto || null;
        if (none && !(auto && auto.found)) return null; // nothing cropped, nothing found
        const crop = this.quad(ed);
        const o = ed.outputRect();
        // A change smaller than this (0.25 mm at the scan's dpi) is Auto's
        // crop saved as it was
        const tol = Math.max(3, (ed.dpi || 0) * 0.25 / 25.4);
        let result = 'manual', diff = null;
        if (auto && auto.found) {
            diff = Math.round(this.apart(auto.crop, crop) * 10) / 10;
            result = none ? 'unwanted' : diff <= tol ? 'accepted' : 'corrected';
        } else if (auto) {
            result = 'missed';
        }
        return {
            v: 1,
            at: new Date().toISOString(),
            version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null,
            project: app.dirHandle ? app.dirHandle.name : null,
            file: file.relPath || file.name,
            W: ed.W, H: ed.H, dpi: ed.dpi || null,
            result, diff,
            auto,
            saved: { none, crop, angle: ed.angle, q: ed.q, w: o.w, h: o.h, aspect: ed.aspectKey }
        };
    },

    // Kept: the log line always; the scan too when Auto ran on it.
    // bytes: the photo's bytes before the save, or a function giving them.
    // In the background; never holds up or fails a save.
    keep(entry, bytes) {
        if (!entry) return Promise.resolve();
        const job = () => this.write(entry, bytes).catch(e => console.warn('Auto crop test set:', e));
        this._queue = (this._queue || Promise.resolve()).then(job);
        return this._queue;
    },

    async write(entry, bytes) {
        const dir = await this.dir(true);
        if (entry.auto) {
            const data = typeof bytes === 'function' ? await bytes() : bytes;
            if (data) {
                const name = String(entry.file).split('/').pop();
                const stem = `${entry.at.replace(/[-:]/g, '').replace(/\..*$/, '')}-${name}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
                entry.scan = stem;
                await this.put(dir, stem, data);
                await this.put(dir, stem + '.json', JSON.stringify(entry, null, 1));
            }
        }
        await this.append(dir, JSON.stringify(entry) + '\n');
        await this.prune(dir);
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
            message: 'The scans kept for testing Auto crop, and the log of crops, are removed from this PC. Your photos aren\'t touched.',
            ok: 'Clear', danger: true
        });
        if (!yes) return;
        try {
            await (await this.base()).removeEntry(this.DIR, { recursive: true });
        } catch (e) { /* none kept */ }
        await this.refresh();
    }
};
