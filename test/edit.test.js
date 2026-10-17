#!/usr/bin/env node
// jEditor's editing tools, in headless Chromium: spot and dust removal
// (retouch.js, adjust-spots.js), subject and sky masks, RAW previews, Paint,
// and drives and import. Run by `npm test` after the UI suite; on its own:
//   node test/edit.test.js [name …]     (only the sections named)

const { chromium } = require('playwright-core');
const { createServer } = require('../scripts/serve.js');
const { launchOptions, newPage } = require('./page-helpers.js');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const only = process.argv.slice(2);
const wanted = (name) => !only.length || only.includes(name);

// In-page: a folder of photos in the browser's private storage, opened as
// the project; turning an experiment on
const PROJECT = `
    window.sleep = (ms) => new Promise(res => setTimeout(res, ms));
    window.until = async (fn, n = 200) => { for (let i = 0; i < n && !(await fn()); i++) await sleep(50); };
    window.pressKey = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
    window.openProject = async (name, photos) => {
        const opfs = await navigator.storage.getDirectory();
        try { await opfs.removeEntry(name, { recursive: true }); } catch (e) { /* fresh */ }
        const dir = await opfs.getDirectoryHandle(name, { create: true });
        for (const [n, blob] of Object.entries(photos)) {
            const fh = await dir.getFileHandle(n, { create: true });
            const w = await fh.createWritable(); await w.write(blob); await w.close();
        }
        window.showDirectoryPicker = async () => dir;
        await app.browseFolder();
        await until(() => app.files.length === Object.keys(photos).length);
        return dir;
    };
    window.experiment = (id, on = true) => Experiments.set(id, on);
    window.canvasBlob = (c, type = 'image/png', q) => new Promise(res => c.toBlob(res, type, q));
    window.pixels = async (blob, w, h) => {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = w || bmp.width; c.height = h || bmp.height;
        const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
        return g.getImageData(0, 0, c.width, c.height);
    };
    // A smooth scene with fine texture: a brightness ramp across, a little
    // noise (hashed, so the same every time)
    window.scene = (w, h, { specks = [], rect = null } = {}) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        const img = g.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const n = ((Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 0) % 7) - 3;
            const v = 70 + 120 * x / w + n;
            img.data[i] = v + 10; img.data[i + 1] = v; img.data[i + 2] = v - 10; img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        if (rect) { g.fillStyle = rect.color; g.fillRect(rect.x, rect.y, rect.w, rect.h); }
        for (const s of specks) {
            g.fillStyle = s.color; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill();
        }
        return c;
    };
`;

(async () => {
    const server = createServer();
    await new Promise(r => server.listen(0, r));
    const baseUrl = `http://localhost:${server.address().port}`;
    const browser = await chromium.launch(launchOptions());
    const open = async () => {
        const p = await newPage(browser, `${baseUrl}/index.html`);
        await p.page.evaluate(PROJECT);
        return p;
    };

    // ---- Spot and dust removal ----
    if (wanted('spots')) {
        console.log('spots (retouch.js, adjust-spots.js)');
        const { page, issues } = await open();
        const m = await page.evaluate(async () => {
            const out = {};
            // Kept compact and in range; a spot copied from itself is dropped
            out.clean = JSON.stringify(Retouch.cleanSpots([
                { x: 0.5, y: 0.5, r: 9, sx: 0.6, sy: 0.5, f: 2, o: 0 },
                { t: 'clone', x: 0.2, y: 0.2, r: 0.01, sx: 0.2, sy: 0.2 },
                { x: 'a' }, null
            ]));
            // In the adjustments, but not in the tables: a spot-only edit
            // changes no colours, and keeps the photo edited
            const adj = { spots: [{ x: 0.5, y: 0.5, r: 0.02, sx: 0.6, sy: 0.5 }] };
            out.kept = !!(Develop.clean(adj) || {}).spots && Develop.active(adj) && !Develop.tonal(adj) && Develop.tables(adj).key === Develop.tables({}).key;
            out.notNothing = !Edits.isNothing(Edits.withAdj(null, adj));

            // Heal: a dark speck on a ramp, copied from where it's lighter,
            // takes on the brightness round it; clone keeps the source's
            const W = 400, H = 300;
            const clean = scene(W, H);
            const dirty = scene(W, H, { specks: [{ x: 150, y: 150, r: 5, color: '#000' }] });
            const at = (c, x, y) => c.getContext('2d').getImageData(x, y, 1, 1).data[1];
            const spot = { t: 'heal', x: 150 / W, y: 0.5, r: 8 / H, sx: 230 / W, sy: 0.5, f: 0.3, o: 1 };
            const healed = scene(W, H, { specks: [{ x: 150, y: 150, r: 5, color: '#000' }] });
            Retouch.applySpots(healed.getContext('2d', { willReadFrequently: true }), W, H, Retouch.cleanSpots([spot]));
            const cloned = scene(W, H, { specks: [{ x: 150, y: 150, r: 5, color: '#000' }] });
            Retouch.applySpots(cloned.getContext('2d', { willReadFrequently: true }), W, H, Retouch.cleanSpots([{ ...spot, t: 'clone' }]));
            out.heal = [at(clean, 150, 150), at(dirty, 150, 150), at(healed, 150, 150), at(cloned, 150, 150)];
            // Far from the spot nothing changes
            out.untouched = at(healed, 40, 40) === at(clean, 40, 40) && at(healed, 150, 180) === at(clean, 150, 180);
            // The same spot at twice the size: the same result
            const big = scene(W * 2, H * 2, { specks: [{ x: 300, y: 300, r: 10, color: '#000' }] });
            Retouch.applySpots(big.getContext('2d', { willReadFrequently: true }), W * 2, H * 2, Retouch.cleanSpots([spot]));
            out.scaled = [at(healed, 150, 150), at(big, 300, 300)];

            // The source picked for a spot: nearby, never on it, inside the photo
            const Y = Retouch.luma(dirty.getContext('2d').getImageData(0, 0, W, H));
            const src = Retouch.autoSource(Y, W, H, 150 / W, 0.5, 8 / H);
            const d = Math.hypot((src.sx - 150 / W) * W, (src.sy - 0.5) * H);
            out.source = d > 16 && d < 60 && src.sx > 0 && src.sx < 1 && src.sy > 0 && src.sy < 1;

            // The dust finder: specks found (dark and light), not the edges
            // of a real thing in the photo
            const specks = [];
            for (let k = 0; k < 12; k++) specks.push({ x: 40 + (k % 6) * 60, y: k < 6 ? 60 : 240, r: 1 + (k % 3), color: k % 2 ? '#000' : '#fff' });
            const rect = { x: 150, y: 110, w: 100, h: 80, color: '#202830' };
            const dusty = scene(W, H, { specks, rect });
            const found = Retouch.findDust(dusty.getContext('2d').getImageData(0, 0, W, H), { sensitivity: 50 });
            const hitSpeck = (f) => specks.some(s => Math.hypot(f.x * W - s.x, f.y * H - s.y) < 4);
            out.found = found.length;
            out.foundSpecks = specks.filter(s => found.some(f => Math.hypot(f.x * W - s.x, f.y * H - s.y) < 4)).length;
            out.falseFinds = found.filter(f => !hitSpeck(f)).length;
            out.markedFound = found.every(f => f.d === 1 && f.t === 'heal');
            // Healed, they're gone: each speck back near its surroundings
            const fixed = scene(W, H, { specks, rect });
            Retouch.applySpots(fixed.getContext('2d', { willReadFrequently: true }), W, H, Retouch.cleanSpots(found));
            const ref = scene(W, H, { rect });
            out.residual = Math.max(...specks.map(s => Math.abs(at(fixed, s.x, s.y) - at(ref, s.x, s.y))));
            // Spots already there aren't found again
            out.keep = Retouch.findDust(dusty.getContext('2d').getImageData(0, 0, W, H), { sensitivity: 50, keep: found }).length === 0;
            // Low sensitivity finds fewer
            out.sens = Retouch.findDust(dusty.getContext('2d').getImageData(0, 0, W, H), { sensitivity: 0 }).length <= found.length;
            return out;
        });
        check('spots: kept compact and in range, a spot copied from itself dropped', m.clean === '[{"t":"heal","x":0.5,"y":0.5,"r":0.25,"sx":0.6,"sy":0.5,"f":1,"o":0.05}]', m.clean);
        check('spots: kept with the adjustments but not in the tables; a spot alone is an edit', m.kept && m.notNothing, JSON.stringify(m));
        check('spots: heal takes the colour round the speck, clone keeps the source\'s', Math.abs(m.heal[2] - m.heal[0]) <= 6 && m.heal[1] < 30 && m.heal[3] - m.heal[0] > 15, JSON.stringify(m.heal));
        check('spots: nothing changes outside a spot; the same spot at any size gives the same result', m.untouched && Math.abs(m.scaled[0] - m.scaled[1]) <= 4, JSON.stringify(m.scaled));
        check('spots: a source is picked nearby, off the spot, inside the photo', m.source, JSON.stringify(m));
        check('dust: specks on a scan are found (dark and light), not a real edge', m.foundSpecks >= 10 && m.falseFinds <= 1 && m.markedFound, JSON.stringify(m));
        check('dust: healed, the specks are gone; found ones aren\'t found again; less sensitive finds less', m.residual <= 12 && m.keep && m.sens, JSON.stringify(m));

        // In a project: kept with the photo, shown and exported healed; a
        // crop afterwards doesn't move them
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                experiment('adjust');
                const W = 640, H = 480;
                const specks = [{ x: 200, y: 240, r: 6, color: '#000' }, { x: 420, y: 120, r: 4, color: '#fff' }, { x: 520, y: 380, r: 3, color: '#000' }];
                const dir = await openProject('spotted', {
                    'a.jpg': await canvasBlob(scene(W, H, { specks }), 'image/jpeg', 0.95),
                    'b.jpg': await canvasBlob(scene(W, H), 'image/jpeg', 0.95)
                });
                const f = (n) => app.files.find(x => x.name === n);
                const greenAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 1];
                app.openSingle(f('a.jpg'));
                step = 'open Adjust';
                pressKey('e');
                await until(() => Adjust.ready);
                const sec = document.getElementById('adj-spots-sec');
                const masks = document.getElementById('adj-masks-sec');
                masks.open = true;
                masks.dispatchEvent(new Event('toggle'));
                sec.open = true;
                sec.dispatchEvent(new Event('toggle'));
                await sleep(30);
                out.oneAtATime = !masks.open && !document.getElementById('adj-spot-overlay').classList.contains('hidden');
                // A click on the black speck: a heal spot, its source picked
                step = 'click';
                const ov = document.getElementById('adj-spot-overlay');
                const or = ov.getBoundingClientRect();
                const pd = (type, fx, fy, o = {}) => ov.dispatchEvent(new PointerEvent(type, { clientX: or.left + or.width * fx, clientY: or.top + or.height * fy, pointerId: 1, bubbles: true, button: 0, ...o }));
                pd('pointerdown', 200 / W, 240 / H); pd('pointerup', 200 / W, 240 / H);
                await sleep(60);
                const s0 = Adjust.result() && Adjust.result().spots;
                out.clicked = !!s0 && s0.length === 1 && s0[0].t === 'heal' && Math.abs(s0[0].x - 200 / W) < 0.01 && Math.hypot(s0[0].sx - s0[0].x, s0[0].sy - s0[0].y) > s0[0].r;
                // The working copy shows it healed
                const shownAt = (x, y) => {
                    const c = document.createElement('canvas'); c.width = Adjust.w; c.height = Adjust.h;
                    const g = c.getContext('2d'); g.drawImage(Adjust.canvas, 0, 0, c.width, c.height);
                    return g.getImageData(Math.round(x * c.width / W), Math.round(y * c.height / H), 1, 1).data[1];
                };
                out.healedLive = shownAt(200, 240) > 80;
                // Dragged from the white speck: a spot copied from where it's let go
                step = 'drag';
                pd('pointerdown', 420 / W, 120 / H); pd('pointermove', 470 / W, 120 / H); pd('pointermove', 480 / W, 125 / H); pd('pointerup', 480 / W, 125 / H);
                const s1 = Adjust.result().spots;
                out.dragged = s1.length === 2 && Math.abs(s1[1].sx - 480 / W) < 0.01 && Math.abs(s1[1].x - 420 / W) < 0.01;
                // Right-click takes it off; Ctrl+Z brings it back
                step = 'right-click';
                ov.dispatchEvent(new MouseEvent('contextmenu', { clientX: or.left + or.width * 420 / W, clientY: or.top + or.height * 120 / H, bubbles: true, cancelable: true }));
                out.removed = Adjust.result().spots.length === 1;
                pressKey('z', { ctrlKey: true });
                out.undone = Adjust.result().spots.length === 2;
                // Find dust: the third speck found, the two spots there left as they are
                step = 'find dust';
                await AdjustSpots.findDust();
                const s2 = Adjust.result().spots;
                out.dust = s2.length >= 3 && s2.filter(s => !s.d).length === 2 && s2.some(s => s.d && Math.hypot(s.x * W - 520, s.y * H - 380) < 6);
                out.countShown = /found as dust/.test(document.getElementById('adj-spot-count').textContent);
                AdjustSpots.clearFound();
                out.cleared = Adjust.result().spots.length === 2;
                await AdjustSpots.findDust();
                // The 1:1 view has them too
                step = '1:1';
                const det = document.getElementById('adj-detail-sec');
                det.open = true;
                det.dispatchEvent(new Event('toggle'));
                await until(() => Adjust.fullCanvas && Adjust._fullKey === JSON.stringify(Adjust.a.spots));
                out.full = Adjust.fullCtx.getImageData(200, 240, 1, 1).data[1] > 80;
                det.open = false;
                det.dispatchEvent(new Event('toggle'));
                // Done: kept with the photo; the file isn't touched
                step = 'done';
                const before = new Uint8Array(await (await (await dir.getFileHandle('a.jpg')).getFile()).arrayBuffer());
                pressKey('Enter');
                await until(() => !Adjust.isOpen && f('a.jpg')._edit);
                out.keptEdit = (f('a.jpg')._edit.adj.spots || []).length >= 3;
                const now = new Uint8Array(await (await (await dir.getFileHandle('a.jpg')).getFile()).arrayBuffer());
                out.fileSame = now.length === before.length && now.every((v, i) => v === before[i]);
                // The viewer shows it healed
                step = 'viewer';
                app.dropEdited && app.dropEdited(f('a.jpg'));
                const src = await app.getDisplaySource(f('a.jpg'));
                const img = await pixels(src.blob || await (await fetch(src.url)).blob(), W, H);
                out.viewer = [greenAt(img, 200, 240), greenAt(img, 420, 120), greenAt(img, 520, 380)];
                // Copied adjustments don't carry spots to another photo
                step = 'copy';
                Edits.set([{ file: f('a.jpg'), edit: Edits.withAdj(f('a.jpg')._edit, { ...f('a.jpg')._edit.adj, exposure: 0.5 }) }], 'adjustments');
                app.copyAdjust(f('a.jpg'));
                app.pasteAdjust([f('b.jpg')]);
                out.pasted = f('b.jpg')._edit && f('b.jpg')._edit.adj.exposure === 0.5 && !f('b.jpg')._edit.adj.spots;
                // Cropped afterwards: the spot stays on its speck
                step = 'crop';
                const e = f('a.jpg')._edit;
                Edits.set([{ file: f('a.jpg'), edit: { ...e, n: { x0: -0.5, y0: -0.5, x1: 0, y1: 0.5 } } }], 'crop');
                const src2 = await app.getDisplaySource(f('a.jpg'));
                const img2 = await pixels(src2.blob || await (await fetch(src2.url)).blob());
                out.cropped = [img2.width, greenAt(img2, Math.round(200 * img2.width / 320), Math.round(240 * img2.height / 480))];
                // Export: written healed
                step = 'export';
                const prompt0 = UI.prompt;
                UI.prompt = async () => '';
                await app.exportCopies([f('a.jpg')]);
                UI.prompt = prompt0;
                const ex = await (await (await dir.getDirectoryHandle('jEditor Export')).getFileHandle('a.jpg')).getFile();
                const exImg = await pixels(ex);
                out.exported = [exImg.width, greenAt(exImg, 200, 240)];
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('spots: Spot removal and Masks draw on the photo one at a time', r.oneAtATime, JSON.stringify(r));
        check('spots: a click heals a speck (its source picked), shown at once', r.clicked && r.healedLive, JSON.stringify(r));
        check('spots: dragging from a speck chooses the source; right-click takes it off; Ctrl+Z brings it back', r.dragged && r.removed && r.undone, JSON.stringify(r));
        check('dust: Find dust adds the specks it finds, leaving spots already made; Clear found takes them off', r.dust && r.countShown && r.cleared, JSON.stringify(r));
        check('spots: the 1:1 view shows them', r.full, JSON.stringify(r));
        check('spots: Done keeps them with the photo, the file untouched; the viewer shows them healed', r.keptEdit && r.fileSame && r.viewer && r.viewer.every(v => v > 60 && v < 200), JSON.stringify(r));
        check('spots: copying adjustments onto another photo leaves its spots behind', r.pasted, JSON.stringify(r));
        check('spots: a crop afterwards doesn\'t move them; Export writes them', r.cropped && r.cropped[1] > 80 && r.exported && r.exported[1] > 80, JSON.stringify(r));
        check('spots: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Sky and subject masks ----
    if (wanted('masks')) {
        console.log('sky and subject masks (select.js)');
        const { page, issues } = await open();
        const m = await page.evaluate(async () => {
            const out = {};
            const hash = (x, y, k = 0) => ((Math.imul((x + k * 977) * 73856093 ^ y * 19349663, 2654435761) >>> 0) % 1000) / 1000;
            // A landscape: blue sky (lighter to the horizon), hills with
            // texture, and a tree into the sky with sky between its leaves
            const W = 480, H = 320;
            const land = document.createElement('canvas'); land.width = W; land.height = H;
            const truth = new Uint8Array(W * H);
            {
                const g = land.getContext('2d'), img = g.createImageData(W, H);
                for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                    const i = (y * W + x) * 4, horizon = 150 + 18 * Math.sin(x / 40) + 8 * Math.sin(x / 13);
                    // The tree: a trunk and a round crown with gaps
                    const trunk = x > 360 && x < 374 && y > 60;
                    const cd = Math.hypot(x - 367, y - 70);
                    const leaf = cd < 48 && hash(x >> 2, y >> 2) > 0.3;
                    if (y < horizon && !trunk && !leaf) {
                        truth[y * W + x] = 1;
                        const t = y / horizon;
                        img.data[i] = 70 + 110 * t; img.data[i + 1] = 130 + 80 * t; img.data[i + 2] = 230 + 15 * t;
                    } else if (trunk || leaf) {
                        const v = hash(x, y, 1) * 40;
                        img.data[i] = trunk ? 80 + v : 30 + v; img.data[i + 1] = trunk ? 55 + v : 90 + v; img.data[i + 2] = trunk ? 30 : 30 + v / 2;
                    } else {
                        const v = hash(x, y, 2) * 60;
                        img.data[i] = 60 + v; img.data[i + 1] = 100 + v; img.data[i + 2] = 40 + v / 2;
                    }
                    img.data[i + 3] = 255;
                }
                g.putImageData(img, 0, 0);
            }
            const iou = (map, truthArr) => {
                const q = Select.decode(map);
                const c = document.createElement('canvas'); c.width = map.w; c.height = map.h;
                const g = c.getContext('2d'), img = g.createImageData(map.w, map.h);
                for (let i = 0; i < q.length; i++) { img.data[i * 4] = q[i] * 17; img.data[i * 4 + 3] = 255; }
                g.putImageData(img, 0, 0);
                const big = document.createElement('canvas'); big.width = W; big.height = H;
                const bg = big.getContext('2d'); bg.drawImage(c, 0, 0, W, H);
                const d = bg.getImageData(0, 0, W, H).data;
                let inter = 0, uni = 0;
                for (let i = 0; i < W * H; i++) { const a = d[i * 4] > 127, b = !!truthArr[i]; if (a && b) inter++; if (a || b) uni++; }
                return +(inter / Math.max(1, uni)).toFixed(3);
            };
            const sky = Select.sky(land);
            out.sky = sky ? iou(sky, truth) : null;
            out.compact = sky ? sky.d.length : null;
            // Indoors: no sky
            const room = document.createElement('canvas'); room.width = 300; room.height = 200;
            {
                const g = room.getContext('2d'), img = g.createImageData(300, 200);
                for (let i = 0; i < 300 * 200; i++) { const v = 40 + hash(i % 300, (i / 300) | 0, 3) * 90; img.data[i * 4] = v + 20; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v - 15; img.data[i * 4 + 3] = 255; }
                g.putImageData(img, 0, 0);
            }
            out.noSky = Select.sky(room) === null;
            // A subject: a sharp, textured orange ball before a soft grey-brown background
            const SW = 400, SH = 300;
            const pic = document.createElement('canvas'); pic.width = SW; pic.height = SH;
            const subj = new Uint8Array(W * H);
            {
                const g = pic.getContext('2d');
                const bgc = document.createElement('canvas'); bgc.width = SW; bgc.height = SH;
                const bgx = bgc.getContext('2d');
                bgx.fillStyle = '#7d7468'; bgx.fillRect(0, 0, SW, SH);
                for (let k = 0; k < 60; k++) { bgx.fillStyle = `rgb(${100 + hash(k, 1) * 60},${95 + hash(k, 2) * 50},${85 + hash(k, 3) * 40})`; bgx.beginPath(); bgx.arc(hash(k, 4) * SW, hash(k, 5) * SH, 10 + hash(k, 6) * 30, 0, 7); bgx.fill(); }
                g.filter = 'blur(8px)'; g.drawImage(bgc, 0, 0); g.filter = 'none';
                const img = g.getImageData(0, 0, SW, SH);
                for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
                    if (Math.hypot(x - 180, y - 160) < 70) {
                        const i = (y * SW + x) * 4, v = hash(x, y, 7) * 50;
                        img.data[i] = 210 + v / 2; img.data[i + 1] = 110 + v; img.data[i + 2] = 30;
                    }
                }
                g.putImageData(img, 0, 0);
            }
            const subjTruth = new Uint8Array(W * H);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x * SW / W - 180, y * SH / H - 160) < 70) subjTruth[y * W + x] = 1;
            const sub = Select.subject(pic);
            out.subject = sub ? iou(sub, subjTruth) : null;
            // Kept compactly, read back the same; a broken map isn't kept
            const q = new Uint8Array([0, 0, 0, 15, 15, 7, 0]);
            out.roundTrip = Select.decode({ w: 7, h: 1, d: Select.encode(q) }).every((v, i) => v === q[i]);
            out.cleaned = JSON.stringify(Develop.cleanMasks([{ type: 'sky', map: { w: 7, h: 1, d: Select.encode(q) }, adj: { exposure: -1 } }, { type: 'subject', map: { w: 9, h: 1, d: '0z.' } }]).map(m => [m.type, m.map.w, m.brush.length, m.adj.exposure]));
            // On the GPU and the CPU alike, touched up with an erase stroke
            const adjM = { masks: [{ type: 'sky', map: sky, adj: { exposure: -1.5, temp: -30 }, brush: [{ size: 0.1, feather: 0.5, flow: 1, erase: true, pts: [0.2, 0.2, 0.4, 0.25] }] }] };
            const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
            cv.getContext('2d').drawImage(land, 0, 0);
            const src = cv.getContext('2d').getImageData(0, 0, W, H);
            Develop.TILE = 128;
            Develop.applyCanvas(cv, adjM);
            Develop.TILE = 2048;
            const gp = cv.getContext('2d').getImageData(0, 0, W, H).data;
            const cp = Develop.applyCPU(new Uint8ClampedArray(src.data), Develop.tables(adjM), new Uint8ClampedArray(src.data.length), { x: 0, y: 0, w: W, W, H });
            let worst = 0;
            for (let i = 0; i < gp.length; i++) worst = Math.max(worst, Math.abs(gp[i] - cp[i]));
            out.gpuCpu = worst;
            const lum = (d, x, y) => d[(y * W + x) * 4 + 1];
            // Sky darkened, ground not, the erased patch not
            out.applied = [lum(src.data, 60, 30) - lum(gp, 60, 30), lum(src.data, 100, 280) - lum(gp, 100, 280), lum(src.data, 144, 70) - lum(gp, 144, 70)];
            return out;
        });
        check('masks: the sky is found (round a tree, through its leaves), kept compactly', m.sky > 0.85 && m.compact < 12000, JSON.stringify(m));
        console.log('  info  sky IoU ' + m.sky + ', subject IoU ' + m.subject + ', sky map ' + m.compact + ' chars');
        check('masks: no sky indoors', m.noSky, JSON.stringify(m));
        check('masks: the subject is found (sharp, standing out, against a soft background)', m.subject > 0.75, JSON.stringify(m));
        check('masks: found maps are kept and read back exactly; a broken one is dropped', m.roundTrip && m.cleaned === '[["sky",7,0,-1]]', JSON.stringify(m));
        check('masks: a found mask, touched up with the brush, agrees on the GPU and the CPU', m.gpuCpu <= 1 && m.applied[0] > 25 && m.applied[1] === 0 && m.applied[2] < 5, JSON.stringify(m));

        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                experiment('adjust');
                const W = 480, H = 320;
                const c = document.createElement('canvas'); c.width = W; c.height = H;
                const g = c.getContext('2d');
                const sky = g.createLinearGradient(0, 0, 0, 160);
                sky.addColorStop(0, '#4a86e0'); sky.addColorStop(1, '#a9cdf2');
                g.fillStyle = sky; g.fillRect(0, 0, W, 160);
                for (let y = 140; y < H; y += 4) for (let x = 0; x < W; x += 4) {
                    if (y < 150 + 10 * Math.sin(x / 30)) continue;
                    g.fillStyle = `rgb(${50 + (x * 7 + y * 3) % 50},${90 + (x * 11 + y) % 50},40)`;
                    g.fillRect(x, y, 4, 4);
                }
                await openProject('masked', { 'land.jpg': await canvasBlob(c, 'image/jpeg', 0.95) });
                const f = app.files[0];
                app.openSingle(f);
                step = 'adjust';
                pressKey('e');
                await until(() => Adjust.ready);
                const sec = document.getElementById('adj-masks-sec');
                sec.open = true;
                sec.dispatchEvent(new Event('toggle'));
                step = 'sky';
                document.querySelector('[data-add-mask="sky"]').click();
                await until(() => (Adjust.result() || {}).masks);
                const ms = Adjust.result().masks;
                out.found = ms.length === 1 && ms[0].type === 'sky' && !!ms[0].map;
                out.listed = /Sky 1/.test(document.getElementById('adj-mask-list').textContent) && !document.getElementById('adj-brush-tools-box').classList.contains('hidden');
                const sl = document.getElementById('adj-mask-exposure');
                sl.value = '-1.5'; sl.dispatchEvent(new Event('input')); sl.dispatchEvent(new Event('change'));
                // Touched up: an erase stroke
                step = 'erase';
                document.getElementById('adj-brush-erase').click();
                const ov = document.getElementById('adj-overlay');
                const or = ov.getBoundingClientRect();
                const pd = (type, fx, fy) => ov.dispatchEvent(new PointerEvent(type, { clientX: or.left + or.width * fx, clientY: or.top + or.height * fy, pointerId: 1, bubbles: true }));
                pd('pointerdown', 0.8, 0.1); pd('pointermove', 0.9, 0.12); pd('pointerup', 0.9, 0.12);
                out.erased = Adjust.result().masks[0].brush.length === 1 && Adjust.result().masks[0].brush[0].erase;
                step = 'done';
                pressKey('Enter');
                await until(() => !Adjust.isOpen && f._edit);
                const src = await app.getDisplaySource(f);
                const img = await pixels(src.blob || await (await fetch(src.url)).blob(), W, H);
                const at = (x, y) => img.data[(y * W + x) * 4 + 2];
                out.shown = [at(100, 30), at(100, 280), at(410, 32)];
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('masks: Sky finds it in Adjust, with its own sliders and the brush to touch it up', r.found && r.listed && r.erased, JSON.stringify(r));
        check('masks: the photo is shown with the sky darkened, the ground and the erased patch not', r.shown && r.shown[0] < 180 && r.shown[2] > 200, JSON.stringify(r));
        check('masks: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
