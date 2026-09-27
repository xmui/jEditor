// Duplicate finder and culling view.
//
// Scan orders collect the same print scanned twice — often at a different
// rotation or exposure — plus plain file copies. Two signals:
//   • exact copies: identical bytes (SHA-256, only for files of equal size)
//   • near-duplicates: a 64-bit gradient hash (dHash) of each thumbnail,
//     compared at all four rotations, so a re-scan the other way up still
//     matches; a loose average-colour check rejects look-alike layouts.
// Matches are grouped (union-find) and reviewed one group at a time: the
// copy with the most pixels is suggested as the keeper, the rest can be
// marked and moved to the trash (Ctrl+Z restores them).

const Dupes = {
    SENSITIVITY: { strict: 5, normal: 9, loose: 13 }, // max differing bits of 64
    COLOR_LIMIT: 60, // max average-colour distance (0–441) for a near-duplicate

    isOpen: false,

    el(id) { return document.getElementById(id); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        this.el('dupes-close').addEventListener('click', () => this.close());
        this.el('dupes-prev').addEventListener('click', () => this.step(-1));
        this.el('dupes-next').addEventListener('click', () => this.step(1));
        this.el('dupes-skip').addEventListener('click', () => this.skip());
        this.el('dupes-apply').addEventListener('click', () => this.apply());
        this.el('dupes-keep-best').addEventListener('click', () => this.keepBest());
        const sens = this.el('dupes-sensitivity');
        sens.addEventListener('change', () => { sens.blur(); this.scan(); });
    },

    // ---- fingerprints ----

    popcount(x) {
        x -= (x >>> 1) & 0x55555555;
        x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
        return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
    },

    // 9×9 grey grid → 64-bit dHash as [hi, lo] (row gradients, rows 0–7)
    dhash(g) {
        let hi = 0, lo = 0;
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const bit = g[y * 9 + x] < g[y * 9 + x + 1] ? 1 : 0;
                const i = y * 8 + x;
                if (i < 32) hi = (hi | (bit << i)) >>> 0;
                else lo = (lo | (bit << (i - 32))) >>> 0;
            }
        }
        return [hi, lo];
    },

    rotateGrid(g) { // 90° clockwise, 9×9
        const out = new Float32Array(81);
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) out[x * 9 + (8 - y)] = g[y * 9 + x];
        return out;
    },

    // Fingerprint from pixel data of a 36×36 rendering: dHash at the four
    // rotations plus the average colour.
    fingerprintFromPixels(data) {
        const g = new Float32Array(81);
        let r = 0, gr = 0, b = 0;
        for (let y = 0; y < 36; y++) {
            for (let x = 0; x < 36; x++) {
                const i = (y * 36 + x) * 4;
                g[Math.floor(y / 4) * 9 + Math.floor(x / 4)] +=
                    data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                r += data[i]; gr += data[i + 1]; b += data[i + 2];
            }
        }
        const hashes = [];
        let cur = g;
        for (let k = 0; k < 4; k++) {
            hashes.push(this.dhash(cur));
            cur = this.rotateGrid(cur);
        }
        const n = 36 * 36;
        return { hashes, color: [r / n, gr / n, b / n] };
    },

    async fingerprint(file) {
        const key = `${file.relPath || file.name}|${file.size}|${file.lastModified}`;
        if (file._fp && file._fp.key === key) return file._fp;
        const url = await this.app.ensureThumbnail(file);
        const blob = await (await fetch(url)).blob();
        const bmp = await createImageBitmap(blob, { resizeWidth: 36, resizeHeight: 36, resizeQuality: 'high' });
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 36;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const fp = this.fingerprintFromPixels(ctx.getImageData(0, 0, 36, 36).data);
        fp.key = key;
        file._fp = fp;
        return fp;
    },

    // Smallest bit distance between a's upright hash and any rotation of b's
    distance(a, b) {
        const [ah, al] = a.hashes[0];
        let best = 64;
        for (const [bh, bl] of b.hashes) {
            best = Math.min(best, this.popcount(ah ^ bh) + this.popcount(al ^ bl));
        }
        return best;
    },

    colorDistance(a, b) {
        return Math.hypot(a.color[0] - b.color[0], a.color[1] - b.color[1], a.color[2] - b.color[2]);
    },

    async sha256(file) {
        if (file._sha && file._sha.size === file.size && file._sha.mtime === file.lastModified) return file._sha.hex;
        if (!(window.crypto && crypto.subtle)) return null;
        const buf = await (await file.handle.getFile()).arrayBuffer();
        const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))]
            .map(b => b.toString(16).padStart(2, '0')).join('');
        file._sha = { size: file.size, mtime: file.lastModified, hex };
        return hex;
    },

    // Pixel size from the file header (JPEG SOF or PNG IHDR) — no decode
    async pixelSize(file) {
        if (file._dims) return file._dims;
        try {
            const bytes = new Uint8Array(await (await file.handle.getFile()).slice(0, 256 * 1024).arrayBuffer());
            const d = ImageMeta.readPixelSize(bytes);
            if (d) file._dims = d;
            return d;
        } catch (e) {
            return null;
        }
    },

    // ---- grouping ----

    // Returns groups: [{ files, exact: Set(file) }], each with ≥ 2 files.
    async findGroups(files, threshold, onProgress = () => { }) {
        const n = files.length;
        const parent = files.map((_, i) => i);
        const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
        const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
        const exactOf = new Map(); // file → sha shared with another file

        // Exact copies: hash only files that share a byte size
        const bySize = new Map();
        files.forEach((f, i) => {
            if (!bySize.has(f.size)) bySize.set(f.size, []);
            bySize.get(f.size).push(i);
        });
        for (const idx of bySize.values()) {
            if (idx.length < 2) continue;
            const byHash = new Map();
            for (const i of idx) {
                const h = await this.sha256(files[i]).catch(() => null);
                if (!h) continue;
                if (byHash.has(h)) {
                    union(byHash.get(h), i);
                    exactOf.set(files[i], h);
                    exactOf.set(files[byHash.get(h)], h);
                } else {
                    byHash.set(h, i);
                }
            }
        }

        // Near-duplicates
        const fps = new Array(n);
        for (let i = 0; i < n; i++) {
            fps[i] = await this.fingerprint(files[i]).catch(() => null);
            if (i % 10 === 0) onProgress(i, n);
        }
        onProgress(n, n);
        for (let i = 0; i < n; i++) {
            if (!fps[i]) continue;
            for (let j = i + 1; j < n; j++) {
                if (!fps[j]) continue;
                if (this.distance(fps[i], fps[j]) <= threshold &&
                    this.colorDistance(fps[i], fps[j]) <= this.COLOR_LIMIT) {
                    union(i, j);
                }
            }
            if (i % 200 === 199) await new Promise(r => setTimeout(r, 0)); // stay responsive
        }

        const groups = new Map();
        files.forEach((f, i) => {
            const root = find(i);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root).push(f);
        });
        return [...groups.values()]
            .filter(g => g.length > 1)
            .map(g => ({ files: g, exact: new Set(g.filter(f => exactOf.has(f) &&
                g.some(o => o !== f && exactOf.get(o) === exactOf.get(f)))) }));
    },

    // Keeper suggestion: most pixels, then biggest file, then first in order
    async rankGroup(group) {
        for (const f of group.files) await this.pixelSize(f);
        const px = (f) => f._dims ? f._dims.w * f._dims.h : 0;
        const order = this.app.files;
        group.files.sort((a, b) => px(b) - px(a) || (b.size || 0) - (a.size || 0) ||
            order.indexOf(a) - order.indexOf(b));
        group.best = group.files[0];
        group.marked = new Set();
    },

    // ---- review UI ----

    async open() {
        this.init(this.app || window.app);
        if (!this.app.files.length) return;
        this.isOpen = true;
        this.el('dupes-panel').classList.remove('hidden');
        await this.scan();
    },

    close() {
        this.isOpen = false;
        this._scanToken = (this._scanToken || 0) + 1;
        this.el('dupes-panel').classList.add('hidden');
        this.el('dupes-stage').innerHTML = '';
        this.app.endTask('dupes');
    },

    async scan() {
        const token = (this._scanToken = (this._scanToken || 0) + 1);
        const threshold = this.SENSITIVITY[this.el('dupes-sensitivity').value] || this.SENSITIVITY.normal;
        this.groups = [];
        this.index = 0;
        this.trashed = 0;
        this.renderMessage('Looking for duplicates…');
        this.app.beginTask('dupes', 'Finding duplicates…');
        try {
            const files = [...this.app.files];
            const groups = await this.findGroups(files, threshold, (i, n) => {
                if (token === this._scanToken) {
                    this.app.updateTask('dupes', `Finding duplicates ${i}/${n}`);
                    this.renderMessage(`Comparing photos… ${i} / ${n}`);
                }
            });
            if (token !== this._scanToken) return;
            const ignored = this.app._dupesIgnored || new Set();
            this.groups = groups.filter(g => !ignored.has(this.groupKey(g)));
            for (const g of this.groups) await this.rankGroup(g);
            if (token !== this._scanToken) return;
            this.render();
        } catch (e) {
            console.error('Duplicate scan failed:', e);
            this.renderMessage('Could not finish the duplicate scan: ' + e.message);
        } finally {
            if (token === this._scanToken) this.app.endTask('dupes');
        }
    },

    groupKey(g) {
        return g.files.map(f => f.relPath || f.name).sort().join('\n');
    },

    renderMessage(text) {
        const stage = this.el('dupes-stage');
        stage.innerHTML = '';
        const p = document.createElement('div');
        p.className = 'dupes-message';
        p.textContent = text;
        stage.appendChild(p);
        this.el('dupes-summary').textContent = '';
        this.el('dupes-progress').textContent = '';
        this.setButtons(false);
    },

    setButtons(on) {
        ['dupes-prev', 'dupes-next', 'dupes-skip', 'dupes-apply', 'dupes-keep-best'].forEach(id => {
            this.el(id).disabled = !on;
        });
    },

    current() { return this.groups[this.index]; },

    render() {
        const groups = this.groups;
        const total = groups.reduce((n, g) => n + g.files.length, 0);
        if (!groups.length) {
            this.renderMessage(this.trashed
                ? `All done — ${this.trashed} duplicate${this.trashed === 1 ? '' : 's'} moved to .jeditor-trash (Ctrl+Z restores).`
                : 'No duplicates found. Try “Loose” sensitivity to widen the search.');
            return;
        }
        this.index = Math.max(0, Math.min(this.index, groups.length - 1));
        const g = this.current();
        this.el('dupes-summary').textContent = `${groups.length} group${groups.length === 1 ? '' : 's'} · ${total} photos`;
        this.el('dupes-progress').textContent = `Group ${this.index + 1} of ${groups.length}`;
        this.setButtons(true);
        this.el('dupes-prev').disabled = this.index === 0;
        this.el('dupes-next').disabled = this.index === groups.length - 1;
        this.el('dupes-apply').textContent = g.marked.size
            ? `Trash ${g.marked.size} & next` : 'Keep all & next';

        const stage = this.el('dupes-stage');
        stage.innerHTML = '';
        stage.style.setProperty('--dupe-cols', Math.min(g.files.length, 4));
        g.files.forEach((f, i) => stage.appendChild(this.card(g, f, i)));
    },

    card(g, f, i) {
        const card = document.createElement('div');
        card.className = 'dupe-card';
        card.classList.toggle('marked', g.marked.has(f));
        card.title = 'Click to mark for trash';
        card.onclick = () => this.toggle(i);

        const frame = document.createElement('div');
        frame.className = 'dupe-frame';
        const img = document.createElement('img');
        img.alt = f.name;
        img.draggable = false;
        const rotate = (readAt) => {
            const r = ((f._savedRotationTotal || 0) - readAt) + (f.savingRotation || 0) + (f.pendingRotation || 0);
            img.style.transform = r ? `rotate(${r}deg)` : '';
        };
        if (f.thumbnailUrl) {
            img.src = f.thumbnailUrl;
            rotate((f._savedRotationTotal || 0) - (f.thumbLag || 0));
        }
        // Sharpen with the screen-sized preview
        this.app.getDisplaySource(f).then(src => {
            if (!img.isConnected && !card.isConnected) return;
            img.src = src.url;
            rotate(src.savedAtRead);
        }).catch(() => { });
        frame.appendChild(img);

        const badges = document.createElement('div');
        badges.className = 'dupe-badges';
        const badge = (text, cls) => {
            const b = document.createElement('span');
            b.className = 'dupe-badge ' + cls;
            b.textContent = text;
            badges.appendChild(b);
        };
        badge(String(i + 1), 'num');
        if (f === g.best) badge('Suggested keep', 'keep');
        if (g.exact.has(f)) badge('Exact copy', 'exact');
        frame.appendChild(badges);
        const mark = document.createElement('div');
        mark.className = 'dupe-mark';
        mark.textContent = 'Trash';
        frame.appendChild(mark);
        card.appendChild(frame);

        const meta = document.createElement('div');
        meta.className = 'dupe-meta';
        const line = (text, cls = '') => {
            const d = document.createElement('div');
            d.className = cls;
            d.textContent = text;
            meta.appendChild(d);
        };
        line(f.name, 'dupe-name');
        const bits = [];
        if (f._dims) bits.push(`${f._dims.w} × ${f._dims.h}`);
        bits.push(this.app.formatBytes(f.size));
        if (f.lastModified) bits.push(new Date(f.lastModified).toLocaleDateString());
        line(bits.join(' · '));
        const folder = (f.relPath || '').split('/').slice(0, -1).join('/');
        if (folder) line(folder, 'dupe-folder');
        card.appendChild(meta);
        return card;
    },

    toggle(i) {
        const g = this.current();
        const f = g && g.files[i];
        if (!f) return;
        if (g.marked.has(f)) g.marked.delete(f);
        else g.marked.add(f);
        if (g.marked.size === g.files.length) {
            g.marked.delete(f);
            this.app.showToast('Keep at least one photo from each group', 2000);
        }
        this.render();
    },

    keepBest() {
        const g = this.current();
        if (!g) return;
        g.marked = new Set(g.files.filter(f => f !== g.best));
        this.render();
    },

    step(dir) {
        if (!this.groups.length) return;
        this.index = Math.max(0, Math.min(this.groups.length - 1, this.index + dir));
        this.render();
    },

    // "Not duplicates": hide this group for the rest of the session
    skip() {
        const g = this.current();
        if (!g) return;
        if (!this.app._dupesIgnored) this.app._dupesIgnored = new Set();
        this.app._dupesIgnored.add(this.groupKey(g));
        this.groups.splice(this.index, 1);
        this.render();
    },

    // Trash the marked photos of this group (if any) and move on
    async apply() {
        const g = this.current();
        if (!g || this._applying) return;
        this._applying = true;
        try {
            const marked = g.files.filter(f => g.marked.has(f));
            if (marked.length) {
                const before = this.app.files.length;
                await this.app.moveToTrash(marked);
                this.trashed += before - this.app.files.length;
            }
            this.groups.splice(this.index, 1);
            this.render();
        } finally {
            this._applying = false;
        }
    }
};
