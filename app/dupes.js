// Duplicate finder and culling view.
//
// Scan orders collect the same print scanned twice — often at a different
// rotation, exposure or position on the bed — plus plain file copies.
// Two signals:
//   • exact copies: identical bytes (SHA-256, only for files of equal size)
//   • near-duplicates: each thumbnail is first cropped to the photo itself
//     (a uniform scanner bed or film border would otherwise make unrelated
//     scans look alike), then compared at all four rotations on two
//     brightness-normalised maps: the overall layout (16×16) and the fine
//     detail (32×32 minus its local mean). Both must agree; photos that
//     merely share a composition (sky over ground) differ in detail.
// Groups use complete linkage — a photo joins a group only if it matches
// every photo in it — so look-alikes can't chain unrelated photos together.
// Review is one group at a time: the copy with the most pixels is
// suggested as the keeper, the rest can be marked and moved to the trash
// (Ctrl+Z restores them).

const Dupes = {
    // Minimum [layout, detail] correlation for a near-duplicate. Tuned on
    // 340 real photos as simulated scans: true re-scans score ≥ 0.96 / 0.61,
    // the closest unrelated pairs ≤ 0.93 / 0.37.
    SENSITIVITY: { strict: [0.93, 0.7], normal: [0.88, 0.5], loose: [0.82, 0.42] },
    GRID: 16,

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

    // Bounding box of what differs from a uniform border (scanner bed, film
    // rebate), inset a little to drop bed slivers at a tilted print's
    // corners; the whole frame when the edge isn't uniform.
    contentBox(d, w, h) {
        const full = { x0: 0, y0: 0, x1: w, y1: h };
        const R = Math.max(2, Math.round(Math.min(w, h) * 0.01));
        const ring = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (x >= R && y >= R && x < w - R && y < h - R) continue;
                const i = (y * w + x) * 4;
                ring.push(d[i], d[i + 1], d[i + 2]);
            }
        }
        const med = [0, 1, 2].map(k => {
            const v = [];
            for (let i = k; i < ring.length; i += 3) v.push(ring[i]);
            v.sort((a, b) => a - b);
            return v[v.length >> 1];
        });
        let spread = 0;
        for (let i = 0; i < ring.length; i += 3) {
            spread += Math.abs(ring[i] - med[0]) + Math.abs(ring[i + 1] - med[1]) + Math.abs(ring[i + 2] - med[2]);
        }
        if (spread / (ring.length / 3) > 24) return full; // edge isn't a uniform border

        const mask = new Uint8Array(w * h);
        const rows = new Uint32Array(h), cols = new Uint32Array(w);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                if (Math.abs(d[i] - med[0]) + Math.abs(d[i + 1] - med[1]) + Math.abs(d[i + 2] - med[2]) > 60) {
                    rows[y]++; cols[x]++; mask[y * w + x] = 1;
                }
            }
        }
        const first = (arr, lim) => arr.findIndex(v => v > lim);
        const last = (arr, lim) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] > lim) return i; return -1; };
        const y0 = first(rows, w * 0.08), y1 = last(rows, w * 0.08);
        const x0 = first(cols, h * 0.08), x1 = last(cols, h * 0.08);
        if (y0 < 0 || x0 < 0 || x1 - x0 < w * 0.1 || y1 - y0 < h * 0.1) return full;
        const bw = x1 - x0, bh = y1 - y0;
        if (bw > w * 0.97 && bh > h * 0.97) return full;
        return {
            x0: x0 + bw * 0.04, y0: y0 + bh * 0.04, x1: x1 - bw * 0.04, y1: y1 - bh * 0.04,
            bordered: true, bed: med, angle: this.printAngle(mask, w, h, x0, y0, x1, y1)
        };
    },

    // Tilt of a print on the bed (degrees, clockwise), from straight-line
    // fits to its four edges; the median of the edges that fit well.
    printAngle(mask, w, h, x0, y0, x1, y1) {
        const bw = x1 - x0, bh = y1 - y0;
        const fit = (pts) => { // least squares v = a + b·u, refit without outliers
            const solve = (p) => {
                const n = p.length;
                if (n < 12) return null;
                let su = 0, sv = 0, suu = 0, suv = 0;
                for (const [u, v] of p) { su += u; sv += v; suu += u * u; suv += u * v; }
                const den = n * suu - su * su;
                if (!den) return null;
                const b = (n * suv - su * sv) / den;
                return { a: (sv - b * su) / n, b };
            };
            const first = solve(pts);
            if (!first) return null;
            const kept = pts.filter(([u, v]) => Math.abs(v - (first.a + first.b * u)) <= 2);
            if (kept.length < pts.length * 0.6) return null; // too ragged to be an edge
            const second = solve(kept);
            return second && second.b;
        };
        const scanCol = (x, from, to, step) => {
            for (let y = from; y !== to; y += step) if (mask[y * w + x]) return y;
            return -1;
        };
        const scanRow = (y, from, to, step) => {
            for (let x = from; x !== to; x += step) if (mask[y * w + x]) return x;
            return -1;
        };
        const top = [], bottom = [], left = [], right = [];
        const yLim = Math.round(bh * 0.25), xLim = Math.round(bw * 0.25);
        for (let x = Math.round(x0 + bw * 0.2); x < x1 - bw * 0.2; x++) {
            const t = scanCol(x, y0, Math.min(h, y0 + yLim), 1);
            if (t >= 0) top.push([x, t]);
            const b = scanCol(x, y1, Math.max(-1, y1 - yLim), -1);
            if (b >= 0) bottom.push([x, b]);
        }
        for (let y = Math.round(y0 + bh * 0.2); y < y1 - bh * 0.2; y++) {
            const l = scanRow(y, x0, Math.min(w, x0 + xLim), 1);
            if (l >= 0) left.push([y, l]);
            const r = scanRow(y, x1, Math.max(-1, x1 - xLim), -1);
            if (r >= 0) right.push([y, r]);
        }
        const angles = [];
        for (const slope of [fit(top), fit(bottom)]) if (slope !== null) angles.push(Math.atan(slope));
        for (const slope of [fit(left), fit(right)]) if (slope !== null) angles.push(-Math.atan(slope));
        if (!angles.length) return 0;
        angles.sort((a, b) => a - b);
        const deg = angles[angles.length >> 1] * 180 / Math.PI;
        return Math.abs(deg) <= 10 ? deg : 0;
    },

    // Zero-mean, unit-variance copy, plus its three quarter-turn rotations
    normalizedRotations(v, n) {
        let mean = 0;
        for (const x of v) mean += x;
        mean /= v.length;
        let varc = 0;
        for (const x of v) varc += (x - mean) ** 2;
        const std = Math.sqrt(varc / v.length);
        const norm = v.map(x => (x - mean) / (std || 1));
        const out = [norm];
        let cur = norm;
        for (let k = 0; k < 3; k++) {
            const r = new Float32Array(n * n);
            for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) r[x * n + (n - 1 - y)] = cur[y * n + x];
            out.push(r);
            cur = r;
        }
        return { rots: out, std };
    },

    // Fingerprint from a canvas holding the photo (normally its thumbnail)
    fingerprintFromCanvas(canvas) {
        const w = canvas.width, h = canvas.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let box = this.contentBox(ctx.getImageData(0, 0, w, h).data, w, h);
        // A tilted print on a bed: straighten it first, so re-scans placed
        // at a different angle still line up
        if (box.bordered && Math.abs(box.angle) > 0.3) {
            const straight = document.createElement('canvas');
            straight.width = w;
            straight.height = h;
            const sc = straight.getContext('2d', { willReadFrequently: true });
            sc.fillStyle = `rgb(${box.bed.join(',')})`;
            sc.fillRect(0, 0, w, h);
            sc.translate(w / 2, h / 2);
            sc.rotate(-box.angle * Math.PI / 180);
            sc.drawImage(canvas, -w / 2, -h / 2);
            const again = this.contentBox(sc.getImageData(0, 0, w, h).data, w, h);
            if (again.bordered) {
                canvas = straight;
                box = again;
            }
        }

        // The whole photo, plus its inner 92% and 84%: a tighter crop of
        // the same photo (another print size, a re-framed scan) lines up
        // with one of those
        const views = this.INSETS.map(k => {
            const ix = (box.x1 - box.x0) * k, iy = (box.y1 - box.y0) * k;
            return this.mapsFor(canvas, box.x0 + ix, box.y0 + iy, box.x1 - ix, box.y1 - iy);
        });
        return { views, weak: views[0].weak };
    },

    INSETS: [0, 0.04, 0.08],

    // Layout and detail maps of one region of the canvas
    mapsFor(canvas, x0, y0, x1, y1) {
        const N = this.GRID, M = N * 2, S = N * 4;
        const s = document.createElement('canvas');
        s.width = s.height = S;
        const sctx = s.getContext('2d', { willReadFrequently: true });
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, S, S);
        const sd = sctx.getImageData(0, 0, S, S).data;

        const layout = new Float32Array(N * N), fine = new Float32Array(M * M);
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const i = (y * S + x) * 4;
                const lum = sd[i] * 0.299 + sd[i + 1] * 0.587 + sd[i + 2] * 0.114;
                layout[(y >> 2) * N + (x >> 2)] += lum / 16;
                fine[(y >> 1) * M + (x >> 1)] += lum / 4;
            }
        }
        // Detail: each cell minus its 3×3 neighbourhood mean
        const detail = new Float32Array(M * M);
        for (let y = 0; y < M; y++) {
            for (let x = 0; x < M; x++) {
                let sum = 0, cnt = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const yy = y + dy, xx = x + dx;
                        if (yy < 0 || xx < 0 || yy >= M || xx >= M) continue;
                        sum += fine[yy * M + xx]; cnt++;
                    }
                }
                detail[y * M + x] = fine[y * M + x] - sum / cnt;
            }
        }
        const L = this.normalizedRotations(layout, N);
        const D = this.normalizedRotations(detail, M);
        return {
            layout: L.rots, detail: D.rots,
            // Nearly featureless frames (fog, blank film) can't be told
            // apart reliably: they only match as exact copies
            weak: L.std < 4 || D.std < 0.8
        };
    },

    async fingerprint(file) {
        const key = `${file.relPath || file.name}|${file.size}|${file.lastModified}`;
        if (file._fp && file._fp.key === key) return file._fp;
        const url = await this.app.ensureThumbnail(file);
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
        bmp.close();
        const fp = this.fingerprintFromCanvas(canvas);
        fp.key = key;
        file._fp = fp;
        return fp;
    },

    dot(a, b) {
        let s = 0;
        for (let i = 0; i < a.length; i++) s += a[i] * b[i];
        return s / a.length;
    },

    // [layout, detail] correlation at the rotation and crop where they
    // agree best. Detail is only computed where the layout can pass.
    similarity(a, b, minLayout = -1) {
        let best = [-1, -1];
        // Quick reject: whole-photo layouts far apart at every rotation
        // (the crop views never differ from these by this much)
        if (minLayout > 0) {
            let quick = -1;
            for (let r = 0; r < 4; r++) quick = Math.max(quick, this.dot(a.views[0].layout[0], b.views[0].layout[r]));
            if (quick < minLayout - 0.15) return best;
        }
        const pairs = [[0, 0]];
        for (let k = 1; k < a.views.length; k++) pairs.push([k, 0], [0, k]);
        for (const [ka, kb] of pairs) {
            const va = a.views[ka], vb = b.views[kb];
            for (let r = 0; r < 4; r++) {
                const l = this.dot(va.layout[0], vb.layout[r]);
                if (l < minLayout) continue;
                const d = this.dot(va.detail[0], vb.detail[r]);
                if (l + d > best[0] + best[1]) best = [l, d];
            }
        }
        return best;
    },

    isMatch(a, b, [minLayout, minDetail]) {
        if (!a || !b || a.weak || b.weak) return false;
        const [l, d] = this.similarity(a, b, minLayout);
        return l >= minLayout && d >= minDetail;
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
    async findGroups(files, sensitivity, onProgress = () => { }) {
        const n = files.length;
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
                if (!byHash.has(h)) byHash.set(h, []);
                byHash.get(h).push(i);
            }
            for (const same of byHash.values()) {
                if (same.length > 1) same.forEach(i => exactOf.set(files[i], this._shaOf(files[i])));
            }
        }

        const fps = new Array(n);
        for (let i = 0; i < n; i++) {
            fps[i] = await this.fingerprint(files[i]).catch(() => null);
            if (i % 10 === 0) onProgress(i, n);
        }
        onProgress(n, n);

        // Match matrix (upper triangle as a Set of "i,j")
        const match = new Set();
        const key = (i, j) => i < j ? i * n + j : j * n + i;
        const exactPair = (i, j) => exactOf.has(files[i]) && exactOf.get(files[i]) === exactOf.get(files[j]);
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (exactPair(i, j) || this.isMatch(fps[i], fps[j], sensitivity)) match.add(key(i, j));
            }
            if (i % 100 === 99) await new Promise(r => setTimeout(r, 0)); // stay responsive
        }

        // Complete linkage: merge two groups only if every cross pair matches
        const groupOf = files.map((_, i) => [i]);
        const owner = files.map((_, i) => i);
        for (const k of [...match].sort((a, b) => a - b)) {
            const i = Math.floor(k / n), j = k % n;
            const gi = owner[i], gj = owner[j];
            if (gi === gj) continue;
            const A = groupOf[gi], B = groupOf[gj];
            if (!A.every(x => B.every(y => match.has(key(x, y))))) continue;
            A.push(...B);
            B.forEach(x => { owner[x] = gi; });
            groupOf[gj] = null;
        }

        return groupOf.filter(g => g && g.length > 1).map(g => {
            const gf = g.map(i => files[i]);
            return {
                files: gf,
                fps: new Map(g.map(i => [files[i], fps[i]])),
                exact: new Set(gf.filter(f => exactOf.has(f) &&
                    gf.some(o => o !== f && exactOf.get(o) === exactOf.get(f))))
            };
        });
    },

    _shaOf(file) { return file._sha && file._sha.hex; },

    // Keeper suggestion: most pixels, then biggest file, then first in order
    async rankGroup(group) {
        for (const f of group.files) await this.pixelSize(f);
        const px = (f) => f._dims ? f._dims.w * f._dims.h : 0;
        const order = this.app.files;
        group.files.sort((a, b) => px(b) - px(a) || (b.size || 0) - (a.size || 0) ||
            order.indexOf(a) - order.indexOf(b));
        group.best = group.files[0];
        group.marked = new Set();
        // How alike each photo is to the suggested keeper, for the cards
        const bestFp = group.fps && group.fps.get(group.best);
        group.score = new Map(group.files.map(f => {
            if (f === group.best || group.exact.has(f) && group.exact.has(group.best)) return [f, 1];
            const fp = group.fps && group.fps.get(f);
            if (!fp || !bestFp) return [f, null];
            const [l, d] = this.similarity(fp, bestFp);
            return [f, Math.max(0, Math.min(1, (l + d) / 2))];
        }));
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
        if (f !== g.best && g.score && g.score.get(f) != null) {
            badge(`${Math.round(g.score.get(f) * 100)}% match`, 'score');
        }
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
