#!/usr/bin/env node
// jEditor's editing tools, in headless Chromium: spot and dust removal
// (retouch.js, adjust-spots.js), subject and sky masks, RAW previews, Paint,
// a new blank image (blank.js) and the wheel the way a Mac does it (wheel.js). Run by `npm test` after the UI suite; on its own:
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

    // ---- RAW files ----
    if (wanted('raw')) {
        console.log('RAW files (raw.js)');
        const { page, issues } = await open();
        await page.evaluate(() => {
            const jpeg = async (w, h, color) => {
                const c = document.createElement('canvas'); c.width = w; c.height = h;
                const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h);
                g.fillStyle = '#fff'; g.fillRect(0, 0, w / 4, h / 4);   // a corner, to see the turn
                return new Uint8Array(await (await canvasBlob(c, 'image/jpeg', 0.9)).arrayBuffer());
            };
            window.rawJpeg = jpeg;
            // A DNG: IFD0 (orientation, a tiny thumbnail strip), a SubIFD of
            // raw data (lossless JPEG: not showable) and one with the preview
            window.makeDng = async (orientation = 6) => {
                const thumb = await jpeg(40, 30, '#333'), prev = await jpeg(300, 200, '#c33');
                // Lossless JPEG (SOF3): a header a browser can't show
                const raw = new Uint8Array(4000); raw.set([0xFF, 0xD8, 0xFF, 0xC3, 0x00, 0x0B, 8, 0, 10, 0, 10, 1, 1, 0x11, 0]);
                const parts = [];
                let off = 8;
                const ifd = (entries, next = 0) => {
                    const b = new DataView(new ArrayBuffer(2 + entries.length * 12 + 4));
                    b.setUint16(0, entries.length, true);
                    entries.forEach(([tag, type, count, val], i) => {
                        b.setUint16(2 + i * 12, tag, true); b.setUint16(4 + i * 12, type, true);
                        b.setUint32(6 + i * 12, count, true);
                        if (type === 3 && count === 1) b.setUint16(10 + i * 12, val, true); else b.setUint32(10 + i * 12, val, true);
                    });
                    b.setUint32(2 + entries.length * 12, next, true);
                    return new Uint8Array(b.buffer);
                };
                // Layout: header, IFD0, SubIFD A, SubIFD B, data
                const ifd0Len = 2 + 5 * 12 + 4, subLen = 2 + 4 * 12 + 4;
                const ifd0At = 8, subAAt = ifd0At + ifd0Len, subBAt = subAAt + subLen, dataAt = subBAt + subLen;
                const subOffsArr = dataAt;                       // two LONGs: the SubIFDs
                const thumbAt = subOffsArr + 8, rawAt = thumbAt + thumb.length, prevAt = rawAt + raw.length;
                const hdr = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
                const i0 = ifd([[0x00FE, 4, 1, 1], [0x0103, 3, 1, 7], [0x0111, 4, 1, thumbAt], [0x0112, 3, 1, orientation], [0x014A, 4, 2, subOffsArr]].concat([]).slice(0, 5));
                const sa = ifd([[0x00FE, 4, 1, 0], [0x0103, 3, 1, 7], [0x0111, 4, 1, rawAt], [0x0117, 4, 1, raw.length]]);
                const sb = ifd([[0x00FE, 4, 1, 1], [0x0103, 3, 1, 7], [0x0111, 4, 1, prevAt], [0x0117, 4, 1, prev.length]]);
                const subs = new DataView(new ArrayBuffer(8)); subs.setUint32(0, subAAt, true); subs.setUint32(4, subBAt, true);
                return new Blob([hdr, i0, sa, sb, new Uint8Array(subs.buffer), thumb, raw, prev], { type: 'image/x-adobe-dng' });
            };
            // A CR3: ftyp, moov (Canon's uuid with CMT1, a track whose first
            // chunk is the full JPEG), a top-level uuid with PRVW, mdat
            window.makeCr3 = async () => {
                const full = await jpeg(400, 300, '#36c'), prvw = await jpeg(160, 120, '#3c6');
                const box = (type, ...body) => {
                    const len = 8 + body.reduce((n, b) => n + b.length, 0);
                    const h = new Uint8Array(8); new DataView(h.buffer).setUint32(0, len); h.set([...type].map(c => c.charCodeAt(0)), 4);
                    const out = new Uint8Array(len); out.set(h); let o = 8; for (const b of body) { out.set(b, o); o += b.length; }
                    return out;
                };
                const u32 = (...v) => { const d = new DataView(new ArrayBuffer(v.length * 4)); v.forEach((x, i) => d.setUint32(i * 4, x)); return new Uint8Array(d.buffer); };
                const hex = (h) => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
                const cmt1 = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
                const ftyp = box('ftyp', new TextEncoder().encode('crx '), u32(1));
                const canon = box('uuid', hex('85c0b687820f11e08111f4ce462b6a48'), box('CMT1', cmt1));
                // The track's sample table, its chunk offset filled in after
                const build = (mdatAt) => {
                    const stsz = box('stsz', u32(0, 0, 1, full.length));
                    const co64 = box('co64', u32(0, 1), new Uint8Array([0, 0, 0, 0]), u32(mdatAt + 8));
                    const trak = box('trak', box('mdia', box('minf', box('stbl', stsz, co64))));
                    return box('moov', canon, trak);
                };
                const prvBox = box('uuid', hex('eaf42b5e1c984b88b9fbb7dc406e4d16'), u32(0, 0), box('PRVW', u32(0), new Uint8Array([0, 1, 0, 160, 0, 120, 0, 1]), u32(prvw.length), prvw));
                let moov = build(0);
                const mdatAt = ftyp.length + moov.length + prvBox.length;
                moov = build(mdatAt);
                return new Blob([ftyp, moov, prvBox, box('mdat', full)], { type: 'image/x-canon-cr3' });
            };
            window.makeRaf = async () => {
                const prev = await jpeg(320, 240, '#c90');
                const h = new Uint8Array(160);
                h.set(new TextEncoder().encode('FUJIFILMCCD-RAW 0201FF383501'));
                const v = new DataView(h.buffer); v.setUint32(84, 160); v.setUint32(88, prev.length);
                return new Blob([h, prev], { type: 'application/octet-stream' });
            };
        });
        const m = await page.evaluate(async () => {
            const out = {};
            const size = async (blob) => { const b = await createImageBitmap(blob); const s = [b.width, b.height]; b.close(); return s; };
            const name = (blob, n) => new File([blob], n, { lastModified: 1700000000000 });
            const dng = await Raw.preview(name(await makeDng(6), 'a.dng'));
            out.dng = dng ? await size(dng) : null;   // 300 × 200 turned: 200 × 300
            out.dngType = dng && dng.type;
            const dng1 = await Raw.preview(name(await makeDng(1), 'b.dng'));
            out.dng1 = dng1 ? await size(dng1) : null;
            const cr3 = await Raw.preview(name(await makeCr3(), 'c.cr3'));
            out.cr3 = cr3 ? await size(cr3) : null;
            const raf = await Raw.preview(name(await makeRaf(), 'd.raf'));
            out.raf = raf ? await size(raf) : null;
            out.none = await Raw.preview(name(new Blob([new Uint8Array(500)]), 'e.nef')) === null;
            out.names = [Raw.is('x.CR3'), Raw.is('x.nef'), Raw.is('x.jpg'), Raw.jpegName('IMG_1.cr3')].join();
            return out;
        });
        check('raw: a DNG\'s preview is found (not its lossless raw data, not the thumbnail), turned as the camera was', JSON.stringify(m.dng) === '[200,300]' && m.dngType === 'image/jpeg' && JSON.stringify(m.dng1) === '[300,200]', JSON.stringify(m));
        check('raw: a CR3\'s full-size JPEG is taken over its small preview; a RAF\'s from its header', JSON.stringify(m.cr3) === '[400,300]' && JSON.stringify(m.raf) === '[320,240]', JSON.stringify(m));
        check('raw: no preview in it, none; RAW names known', m.none && m.names === 'true,true,false,IMG_1.jpg', JSON.stringify(m));

        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                experiment('adjust');
                const dngBlob = await makeDng(1), cr3Blob = await makeCr3();
                const dir = await openProject('raws', { 'a.dng': dngBlob, 'b.cr3': cr3Blob, 'c.jpg': new Blob([await rawJpeg(200, 150, '#888')], { type: 'image/jpeg' }) });
                const f = (n) => app.files.find(x => x.name === n);
                const bytesOf = async (n) => new Uint8Array(await (await (await dir.getFileHandle(n)).getFile()).arrayBuffer());
                const same = async (n, blob) => { const a = await bytesOf(n), b = new Uint8Array(await blob.arrayBuffer()); return a.length === b.length && a.every((v, i) => v === b[i]); };
                out.listed = app.files.length === 3;
                step = 'thumbs';
                await until(() => f('a.dng').thumbnailUrl && f('b.cr3').thumbnailUrl);
                out.thumbs = !!(f('a.dng').thumbnailUrl && f('b.cr3').thumbnailUrl);
                step = 'viewer';
                app.openSingle(f('b.cr3'));
                const src = await app.getDisplaySource(f('b.cr3'));
                const img = await pixels(src.blob || await (await fetch(src.url)).blob());
                out.viewer = [img.width, img.height, img.data[(150 * img.width + 300) * 4 + 2]];
                // A turn: kept as an edit, the RAW untouched
                step = 'turn';
                await app.rotateImage(f('b.cr3'), 90);
                await sleep(100);
                out.turnKept = f('b.cr3')._edit && f('b.cr3')._edit.q === 1 && await same('b.cr3', cr3Blob);
                // Adjusted: kept
                step = 'adjust';
                app.openSingle(f('a.dng'));
                pressKey('e');
                await until(() => Adjust.ready);
                Adjust.a.exposure = 1;
                Adjust.changed();
                pressKey('Enter');
                await until(() => !Adjust.isOpen && f('a.dng')._edit);
                out.adjustKept = f('a.dng')._edit.adj.exposure === 1 && await same('a.dng', dngBlob);
                // Export: JPEG copies, named .jpg
                step = 'export';
                const prompt0 = UI.prompt;
                UI.prompt = async () => '';
                await app.exportCopies([f('a.dng'), f('b.cr3')]);
                UI.prompt = prompt0;
                const ex = await dir.getDirectoryHandle('jEditor Export');
                const exA = await (await ex.getFileHandle('a.jpg')).getFile();
                const exB = await (await ex.getFileHandle('b.jpg')).getFile();
                const sz = async (b) => { const bm = await createImageBitmap(b); const s = [bm.width, bm.height]; bm.close(); return s; };
                out.exported = [...await sz(exA), ...await sz(exB)];
                // Save edits: RAWs exported, never written
                step = 'save';
                const choose = UI.choose;
                UI.choose = async () => 'ok';
                UI.prompt = async () => '';
                await Edits.saveAll({ list: [f('a.dng'), f('b.cr3')] });
                UI.choose = choose;
                UI.prompt = prompt0;
                out.saveNotWritten = await same('a.dng', dngBlob) && await same('b.cr3', cr3Blob) && !!f('b.cr3')._edit;
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('raw: RAW files are listed with the photos and get thumbnails', r.listed && r.thumbs, JSON.stringify(r));
        check('raw: shown from the JPEG inside', r.viewer && r.viewer[0] === 400 && r.viewer[2] > 150, JSON.stringify(r));
        check('raw: turns and adjustments are kept as edits, the RAW never written', r.turnKept && r.adjustKept, JSON.stringify(r));
        check('raw: Export writes JPEG copies (turned, adjusted); Save edits exports them instead of writing', JSON.stringify(r.exported) === '[300,200,300,400]' && r.saveNotWritten, JSON.stringify(r));
        check('raw: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint ----
    if (wanted('paint')) {
        console.log('paint (paint.js, paint-editor.js)');
        const { page, issues } = await open();
        const m = await page.evaluate(() => {
            const out = {};
            out.clean = JSON.stringify(Paint.clean({ id: 'abc', w: 100, h: 50, layers: [{ id: 'l1', rev: 'r1', name: '  Sky  ', opacity: 3, blend: 'nope', hidden: 1 }, { id: 'BAD', rev: 'x' }] }));
            out.none = Paint.clean({ id: 'abc', w: 100, h: 50, layers: [] }) === null && Paint.clean({ id: '../x', w: 1, h: 1, layers: [{ id: 'a', rev: 'b' }] }) === null;
            out.size = JSON.stringify([Paint.sizeFor(6000, 4000), Paint.sizeFor(800, 600)]);
            return out;
        });
        check('paint: the record is checked (names, opacity, blend; bad ids dropped)', m.clean === '{"id":"abc","w":100,"h":50,"layers":[{"id":"l1","rev":"r1","name":"Sky","opacity":1,"blend":"source-over","hidden":true}]}' && m.none, JSON.stringify(m));
        check('paint: layers at the photo\'s size, a very big one smaller', m.size === '[{"w":3000,"h":2000},{"w":800,"h":600}]', m.size);

        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                experiment('paint');
                const W = 400, H = 300;
                const c = document.createElement('canvas'); c.width = W; c.height = H;
                const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
                g.fillStyle = '#2050c0'; g.fillRect(250, 50, 100, 100);   // a blue square, for the fill and the wand
                const dir = await openProject('painted', { 'p.png': await canvasBlob(c, 'image/png') });
                const f = app.files[0];
                const before = new Uint8Array(await (await (await dir.getFileHandle('p.png')).getFile()).arrayBuffer());
                app.openSingle(f);
                step = 'open';
                out.button = getComputedStyle(document.getElementById('btn-paint')).display !== 'none';
                pressKey('b');
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                out.open = P.isOpen && P.W === W && P.layers.length === 1;
                const st = document.getElementById('paint-stage');
                const at = (x, y) => { const s = P.V().transformPoint(P.C.transformPoint({ x, y })); const r = P.canvas.getBoundingClientRect(); return { clientX: r.left + s.x, clientY: r.top + s.y }; };
                const pe = (type, x, y, o = {}) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: 1, bubbles: true, button: 0, ...o }));
                const px = (l, x, y) => [...P.layers[l].canvas.getContext('2d').getImageData(x, y, 1, 1).data];
                // A brush stroke, red, across
                step = 'brush';
                P.fg = '#ff0000';
                P.opts.size = 20; P.opts.hardness = 100; P.opts.opacity = 100; P.opts.flow = 100;
                P.setTool('brush');
                pe('pointerdown', 50, 100); pe('pointermove', 100, 100); pe('pointermove', 150, 100); pe('pointerup', 150, 100);
                out.brush = px(0, 100, 100);
                out.brushEdge = px(0, 100, 130)[3];
                // Undo, redo
                pressKey('z', { ctrlKey: true });
                out.undo = px(0, 100, 100)[3];
                pressKey('Z', { ctrlKey: true, shiftKey: true });
                out.redo = px(0, 100, 100)[3];
                // Half opacity: half covered
                step = 'opacity';
                P.opts.opacity = 50;
                pe('pointerdown', 50, 200); pe('pointermove', 70, 200); pe('pointermove', 90, 200); pe('pointerup', 90, 200);
                out.half = px(0, 70, 200)[3];
                P.opts.opacity = 100;
                // A rectangle, filled, on a new layer
                step = 'rect';
                pressKey('N', { ctrlKey: true, shiftKey: true });
                out.layers = P.layers.length === 2 && P.cur === 1;
                P.fg = '#00ff00'; P.opts.shapeFill = 'fg'; P.opts.lineWidth = 0;
                P.setTool('rect');
                pe('pointerdown', 20, 20); pe('pointermove', 60, 60); pe('pointerup', 60, 60);
                out.rect = [px(1, 40, 40), px(1, 70, 70)[3]];
                // The fill: the blue square, sampled from the photo
                step = 'fill';
                P.fg = '#ffff00'; P.opts.tolerance = 20; P.opts.contiguous = true; P.opts.sampleAll = true;
                P.setTool('fill');
                pe('pointerdown', 300, 100); pe('pointerup', 300, 100);
                out.fill = [px(1, 260, 60), px(1, 240, 100)[3]];
                // Text
                step = 'text';
                P.fg = '#000000'; P.opts.fontSize = 40;
                P.setTool('text');
                pe('pointerdown', 20, 230); pe('pointerup', 20, 230);
                await sleep(20);
                const ta = document.getElementById('paint-text');
                ta.value = 'Hi';
                ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
                const tx = P.layers[1].canvas.getContext('2d').getImageData(15, 230, 60, 50).data;
                let ink = 0; for (let i = 3; i < tx.length; i += 4) if (tx[i] > 128) ink++;
                out.text = ink;
                // Select a rectangle, Delete: cleared there only
                step = 'select';
                P.setTool('rect-select');
                pe('pointerdown', 250, 50); pe('pointermove', 290, 150); pe('pointerup', 290, 150);
                out.selected = !!P.sel && P.sel.box.w >= 39 && P.sel.box.w <= 41;
                pressKey('Delete');
                out.cleared = [px(1, 270, 100)[3], px(1, 320, 100)[3]];
                // The wand picks the rest of the yellow; Move drags it
                step = 'move';
                P.setTool('wand');
                pe('pointerdown', 320, 100); pe('pointerup', 320, 100);
                out.wand = !!P.sel && P.sel.box.x >= 289 && P.sel.box.x <= 292;
                P.setTool('move');
                pe('pointerdown', 320, 100); pe('pointermove', 320, 180); pe('pointerup', 320, 180);
                pressKey('Enter');
                out.moved = [px(1, 320, 100)[3], px(1, 320, 180)];
                out.notDone = P.isOpen;
                // Done: kept with the photo, the file untouched
                step = 'done';
                pressKey('Enter');
                await until(() => !P.isOpen && f._edit && f._edit.paint);
                const rec = f._edit.paint;
                out.kept = rec.layers.length === 2 && rec.w === W;
                const paintDir = await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('paint');
                let files = 0;
                for await (const e of paintDir.values()) files++;
                out.files = files;
                const nowBytes = new Uint8Array(await (await (await dir.getFileHandle('p.png')).getFile()).arrayBuffer());
                out.fileSame = nowBytes.length === before.length && nowBytes.every((v, i) => v === before[i]);
                // Shown painted
                step = 'shown';
                const src = await app.getDisplaySource(f);
                const img = await pixels(src.blob || await (await fetch(src.url)).blob(), W, H);
                const shown = (x, y) => [...img.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
                out.shown = [shown(100, 100), shown(40, 40), shown(320, 180)];
                // Opened again: the layers come back as they were
                step = 'reopen';
                pressKey('b');
                await until(() => P.ready);
                out.reopened = P.layers.length === 2 && px(0, 100, 100)[0] > 200 && px(1, 40, 40)[1] > 200;
                pressKey('Escape');
                await until(() => !P.isOpen);
                // Cropped later: the paint stays where it was on the photo
                step = 'crop';
                Edits.set([{ file: f, edit: { ...f._edit, n: { x0: -0.5, y0: -0.5, x1: 0, y1: 0.5 } } }], 'crop');
                const src2 = await app.getDisplaySource(f);
                const img2 = await pixels(src2.blob || await (await fetch(src2.url)).blob());
                out.cropped = [img2.width, [...img2.data.subarray((100 * img2.width + 100) * 4, (100 * img2.width + 100) * 4 + 3)]];
                // A crop saved in the crop editor keeps the paint
                step = 'crop editor';
                pressKey('c');
                await until(() => CropEditor.ready);
                pressKey('Enter');
                await until(() => !CropEditor.isOpen);
                out.cropKeepsPaint = !!(f._edit && f._edit.paint);
                // Export: the paint's in it
                step = 'export';
                const prompt0 = UI.prompt;
                UI.prompt = async () => '';
                await app.exportCopies([f]);
                UI.prompt = prompt0;
                const ex = await (await (await dir.getDirectoryHandle('jEditor Export')).getFileHandle('p.png')).getFile();
                const exImg = await pixels(ex);
                out.exported = [...exImg.data.subarray((100 * exImg.width + 100) * 4, (100 * exImg.width + 100) * 4 + 3)];
                // Ctrl+Z (the app's): back to before the crop, paint kept
                await app.undo();
                out.undoCrop = !!(f._edit && f._edit.paint);
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint: an experiment with its button; B opens it on the photo', r.button && r.open, JSON.stringify(r));
        check('paint: a brush stroke paints the layer (hard-edged), Ctrl+Z / Ctrl+Shift+Z inside', r.brush && r.brush[0] === 255 && r.brush[3] === 255 && r.brushEdge === 0 && r.undo === 0 && r.redo === 255, JSON.stringify(r));
        check('paint: a stroke at 50% opacity covers half, however it overlaps itself', r.half >= 120 && r.half <= 135, JSON.stringify(r));
        check('paint: a new layer; a filled rectangle on it', r.layers && r.rect && r.rect[0][1] === 255 && r.rect[1] === 0, JSON.stringify(r));
        check('paint: the fill takes the photo\'s blue square, not beyond it; text is drawn', r.fill && r.fill[0][0] === 255 && r.fill[0][1] === 255 && r.fill[1] === 0 && r.text > 50, JSON.stringify(r));
        check('paint: a selection; Delete clears only inside it', r.selected && r.cleared[0] === 0 && r.cleared[1] === 255, JSON.stringify(r));
        check('paint: the wand selects by colour; Move drags it, Enter puts it down', r.wand && r.moved[0] === 0 && r.moved[1][3] === 255 && r.notDone, JSON.stringify(r));
        check('paint: Done keeps it with the photo (layers in the project\'s folder), the file untouched', r.kept && r.files === 2 && r.fileSame, JSON.stringify(r));
        check('paint: shown painted; opened again, the layers come back', r.shown && r.shown[0][0] > 200 && r.shown[1][1] > 200 && r.shown[2][0] > 200 && r.reopened, JSON.stringify(r));
        check('paint: a crop later leaves it where it was; the crop editor keeps it; Export writes it', r.cropped && r.cropped[0] === 200 && r.cropped[1][0] > 200 && r.cropKeepsPaint && r.exported && r.exported[0] > 200 && r.undoCrop, JSON.stringify(r));

        // Opening the project again: layer files nothing uses are deleted
        const tidy = await page.evaluate(async () => {
            const dir = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('painted')).getDirectoryHandle('.jeditor')).getDirectoryHandle('paint');
            const junk = await dir.getFileHandle('old-layer-x.png', { create: true });
            const w = await junk.createWritable(); await w.write(new Blob([new Uint8Array(10)])); await w.close();
            await sleep(1200);
            const gone = await Paint.tidy(app.files.map(f => f._edit).filter(Boolean));
            const names = [];
            for await (const [n] of dir.entries()) names.push(n);
            const used = app.files[0]._edit.paint.layers.map(l => Paint.fileName(app.files[0]._edit.paint, l));
            return { gone, junkGone: !names.includes('old-layer-x.png'), usedKept: used.every(u => names.includes(u)) };
        });
        check('paint: opening the project again deletes layer files nothing uses, keeps the rest', tidy.gone >= 1 && tidy.junkGone && tidy.usedKept, JSON.stringify(tidy));

        // Without a project (photos picked on a phone): painted into the photo
        const p = await page.evaluate(async () => {
            const bytes = new Uint8Array(await makeRealJpeg(200, 150, { color: '#555' }));
            await Picked.open([new File([bytes], 'phone.jpg', { type: 'image/jpeg' })]);
            app.openSingle(app.files[0]);
            await app.enterPaint();
            await until(() => PaintEditor.ready);
            const P = PaintEditor;
            P.layers[0].canvas.getContext('2d').fillRect(0, 0, 50, 50);
            P.history.push({ kind: 'px', layer: P.layers[0], r: { x: 0, y: 0, w: 1, h: 1 }, before: new ImageData(1, 1), after: new ImageData(1, 1) });
            await app.savePaint();
            const h = app.files[0].handle;
            await until(() => h.edited);
            return { edited: !!h.edited, noEdit: !app.files[0]._edit, closed: !P.isOpen };
        });
        check('paint: without a project, Done paints it into the photo', p.edited && p.noEdit && p.closed, JSON.stringify(p));

        // On a turned photo; the eraser, gradient, merging, and scaling what's moved
        const t = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const W = 300, H = 200;
                const c = document.createElement('canvas'); c.width = W; c.height = H;
                c.getContext('2d').fillStyle = '#777'; c.getContext('2d').fillRect(0, 0, W, H);
                await openProject('turned', { 't.png': await canvasBlob(c, 'image/png') });
                const f = app.files[0];
                // Turned a quarter right (kept as an edit): shown 200 × 300
                Edits.set([{ file: f, edit: { q: 1, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } } }], 'rotation');
                app.openSingle(f);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                out.shownSize = [P.OW, P.OH];
                const st = document.getElementById('paint-stage');
                // Points on the picture as shown
                const at = (ox, oy) => { const s = P.V().transformPoint({ x: ox, y: oy }); const r = P.canvas.getBoundingClientRect(); return { clientX: r.left + s.x, clientY: r.top + s.y }; };
                const pe = (type, x, y, o = {}) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: 1, bubbles: true, button: 0, ...o }));
                const shownAt = (layer, ox, oy) => { const l = P.Ci.transformPoint({ x: ox, y: oy }); return [...P.layers[layer].canvas.getContext('2d').getImageData(Math.floor(l.x), Math.floor(l.y), 1, 1).data]; };
                // A wide rectangle on the picture as shown is wide there
                step = 'rect';
                P.fg = '#00ff00'; P.opts.shapeFill = 'fg'; P.opts.lineWidth = 0; P.opts.opacity = 100;
                P.setTool('rect');
                pe('pointerdown', 20, 20); pe('pointermove', 180, 60); pe('pointerup', 180, 60);
                out.rect = [shownAt(0, 170, 40)[3], shownAt(0, 40, 100)[3]];
                // The eraser takes it off where it goes
                step = 'eraser';
                P.opts.size = 20; P.opts.hardness = 100;
                P.setTool('eraser');
                pe('pointerdown', 100, 40); pe('pointermove', 110, 40); pe('pointerup', 110, 40);
                out.erased = [shownAt(0, 105, 40)[3], shownAt(0, 40, 40)[3]];
                // A gradient on a new layer: foreground at the start, background at the end
                step = 'gradient';
                P.addLayer();
                P.fg = '#ff0000'; P.bg = '#0000ff'; P.opts.gradient = 'linear'; P.opts.gradTo = 'bg';
                P.setTool('gradient');
                pe('pointerdown', 0, 150); pe('pointermove', 200, 150); pe('pointerup', 200, 150);
                const g0 = shownAt(1, 2, 150), g1 = shownAt(1, 198, 150);
                out.gradient = g0[0] > 200 && g0[2] < 40 && g1[2] > 200 && g1[0] < 40;
                // Half opacity, merged down: the green shows through red where both are
                step = 'merge';
                P.opacityRow.querySelector('input').value = '50';
                P.opacityRow.querySelector('input').dispatchEvent(new Event('input'));
                P.opacityRow.querySelector('input').dispatchEvent(new Event('change'));
                P.mergeDown();
                const mg = shownAt(0, 40, 40);
                out.merged = P.layers.length === 1 && mg[0] > 100 && mg[1] > 100;
                P.undo();
                out.unmerged = P.layers.length === 2 && P.layers[1].opacity === 0.5 && shownAt(0, 40, 40)[0] === 0;
                // Move with a selection, then scale it from a corner
                step = 'transform';
                P.cur = 0;
                P.setTool('rect-select');
                pe('pointerdown', 20, 20); pe('pointermove', 60, 60); pe('pointerup', 60, 60);
                P.setTool('move');
                pe('pointerdown', 40, 40); pe('pointermove', 41, 40); pe('pointerup', 41, 40);
                const h = P.floatHandles();
                const se = h.corners.find(x => x[0] === 'se')[1];
                pe('pointerdown', se.x, se.y); pe('pointermove', se.x + 40, se.y + 40); pe('pointerup', se.x + 40, se.y + 40);
                out.scaled = P.float.t.sx > 2.6 && P.float.t.sx < 3.2 && Math.abs(P.float.t.sx - P.float.t.sy) < 0.2;   // about its middle: 20 px from it to 60
                P.commitFloat();
                out.afterScale = [shownAt(0, 75, 75)[1], P.sel && P.sel.box.w > 70];
                pressKey('Escape');
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint: on a turned photo, shapes are drawn as they look', JSON.stringify(t.shownSize) === '[200,300]' && t.rect && t.rect[0] === 255 && t.rect[1] === 0, JSON.stringify(t));
        check('paint: the eraser takes off what it goes over', t.erased && t.erased[0] === 0 && t.erased[1] === 255, JSON.stringify(t));
        check('paint: a gradient from the foreground colour to the background', t.gradient, JSON.stringify(t));
        check('paint: merging down keeps a layer\'s opacity; Ctrl+Z undoes it', t.merged && t.unmerged, JSON.stringify(t));
        check('paint: what\'s moved scales from a corner, its selection with it', t.scaled && t.afterScale && t.afterScale[0] === 255 && t.afterScale[1], JSON.stringify(t));
        check('paint: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- A new blank image; images brought into Paint ----
    if (wanted('blank')) {
        console.log('a new blank image, images brought into Paint (blank.js, paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                experiment('paint', false);
                const c = document.createElement('canvas'); c.width = 200; c.height = 150;
                c.getContext('2d').fillRect(0, 0, 200, 150);
                const dir = await openProject('blanks', { 'a.png': await canvasBlob(c) });
                const sub = await dir.getDirectoryHandle('Art', { create: true });
                await app.browseFolder();
                await until(() => Folders.map.has('Art'));
                const $ = (id) => document.getElementById(id);
                // On the folder's menu and the grid's background
                step = 'menus';
                out.folderMenu = Folders.contextItems('Art').some(i => i[0] === 'New blank image…');
                app.setView('grid');
                out.gridMenu = app.buildContextItems(null, false).some(i => i[0] === 'New blank image…');
                // The dialog: a size from the list, turned, a colour
                step = 'dialog';
                const made = Blank.open('Art');
                await until(() => !$('blank-panel').classList.contains('hidden'));
                out.name = $('blank-name').value;
                $('blank-size').value = '4x6';
                $('blank-size').dispatchEvent(new Event('change'));
                $('blank-turn').click();
                out.dims = [$('blank-w').value, $('blank-h').value, $('blank-size').value];
                $('blank-w').value = '20000';
                $('blank-w').dispatchEvent(new Event('input'));
                out.tooBig = $('blank-go').disabled && /at most/.test($('blank-error').textContent);
                $('blank-w').value = '1800';
                $('blank-w').dispatchEvent(new Event('input'));
                $('blank-color').value = '#336699';
                $('blank-color').dispatchEvent(new Event('input'));
                out.paintOffered = $('blank-paint').checked;
                $('blank-go').click();
                const file = await made;
                step = 'made';
                out.file = file && file.relPath;
                const data = await (await (await sub.getFileHandle('Untitled.png')).getFile());
                const img = await pixels(data);
                out.size = [img.width, img.height];
                out.pixel = [...img.data.slice(0, 4)];
                // Opened in Paint (turned on for it)
                await until(() => PaintEditor.ready);
                out.inPaint = PaintEditor.isOpen && PaintEditor.file === file && Experiments.on('paint');
                // Next time: the name after it
                step = 'images';
                const P = PaintEditor;
                const red = document.createElement('canvas'); red.width = 3000; red.height = 1500;
                red.getContext('2d').fillStyle = '#ff0000'; red.getContext('2d').fillRect(0, 0, 3000, 1500);
                const logo = new File([await canvasBlob(red)], 'logo.png', { type: 'image/png' });
                // Dropped on Paint: a layer of its own, named for it, floating, fitted
                const dt = new DataTransfer();
                dt.items.add(logo);
                const st = $('paint-stage');
                st.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
                st.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                await until(() => P.float);
                out.dropped = [P.layers.map(l => l.name).join(), P.cur, P.tool, !!P.float, Math.round(P.float.w * P.float.t.sx)];
                pressKey('Enter');
                const lp = [...P.layers[1].canvas.getContext('2d').getImageData(Math.round(P.W / 2), Math.round(P.H / 2), 1, 1).data];
                out.putDown = !P.float && lp[0] === 255 && lp[3] === 255;
                // Pasted from another app (Ctrl+V, nothing copied in Paint)
                const cd = new DataTransfer();
                cd.items.add(new File([await canvasBlob(red)], 'image.png', { type: 'image/png' }));
                const handled = !window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
                document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: cd, bubbles: true, cancelable: true }));
                await until(() => P.float);
                out.pasted = [!handled, P.layers.length, P.layers[P.cur].name];
                pressKey('Escape');
                // Paint's own copy, when it's the newest: Ctrl+V pastes it
                P.copy();
                const own = !window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
                out.ownPaste = own && !!P.float;
                pressKey('Escape');
                // Not an image: said so
                await P.importFiles([new File(['hi'], 'notes.txt', { type: 'text/plain' })]);
                out.notImage = /Only images/.test(document.body.textContent);
                // Undo takes the layer off again
                const n = P.layers.length;
                pressKey('z', { ctrlKey: true });
                pressKey('z', { ctrlKey: true });
                out.undone = P.layers.length === n - 1;
                app.cancelPaint();
                const again = Blank.open('Art');
                await until(() => !$('blank-panel').classList.contains('hidden'));
                out.next = $('blank-name').value;
                out.remembered = [$('blank-w').value, $('blank-h').value, $('blank-bg-color').checked];
                Blank.close(false);
                await again;
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('blank: offered on a folder\'s menu and the grid\'s background', r.folderMenu && r.gridMenu, JSON.stringify(r));
        check('blank: a size from the list, turned either way; too big is said', r.name === 'Untitled' && JSON.stringify(r.dims) === '["1800","1200","4x6"]' && r.tooBig, JSON.stringify(r));
        check('blank: saved as a PNG of that size and colour, in the folder', r.file === 'Art/Untitled.png' && JSON.stringify(r.size) === '[1800,1200]' && JSON.stringify(r.pixel) === '[51,102,153,255]', JSON.stringify(r));
        check('blank: opened in Paint straight away (Paint turned on for it)', r.paintOffered && r.inPaint, JSON.stringify(r));
        check('paint: an image dropped on it comes in as a layer of its own, named for it, fitted and floating', r.dropped && r.dropped[0] === 'Layer 1,logo' && r.dropped[1] === 1 && r.dropped[2] === 'move' && r.dropped[3] && r.dropped[4] === 1620, JSON.stringify(r));
        check('paint: Enter puts it down', r.putDown, JSON.stringify(r));
        check('paint: Ctrl+V with an image copied in another app brings it in; Paint\'s own copy when that\'s newer', r.pasted && r.pasted[0] && r.pasted[1] === 3 && r.pasted[2] === 'Pasted' && r.ownPaste, JSON.stringify(r));
        check('paint: what isn\'t an image is said so; Ctrl+Z takes an image off again', r.notImage && r.undone, JSON.stringify(r));
        check('blank: next time, the next name and the same size and background', r.next === 'Untitled-2' && JSON.stringify(r.remembered) === '["1800","1200",true]', JSON.stringify(r));
        check('blank: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- The wheel on a Mac ----
    if (wanted('wheel')) {
        console.log('the wheel on a Mac (wheel.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                // Which is which
                step = 'kinds';
                const kind = (e) => { Wheel._last = null; return Wheel.kind({ deltaMode: 0, deltaX: 0, deltaY: 0, ctrlKey: false, ...e }); };
                out.kinds = [
                    kind({ ctrlKey: true, deltaY: 3 }),                       // a pinch
                    kind({ deltaY: 4.5, wheelDeltaY: -13.5 }),                 // fingers (Chromium: -3 × deltaY)
                    kind({ deltaY: 100, wheelDeltaY: -120 }),                  // a mouse's notch
                    kind({ deltaX: 12, deltaY: 1, wheelDeltaY: -3 }),          // sideways: fingers
                    kind({ deltaMode: 1, deltaY: 3 })                          // lines: a wheel
                ].join();
                // A gesture keeps its kind (its momentum looks like a mouse's sometimes)
                Wheel._last = null;
                Wheel.kind({ deltaMode: 0, deltaX: 0, deltaY: 2, wheelDeltaY: -6 });
                out.gesture = Wheel.kind({ deltaMode: 0, deltaX: 0, deltaY: 120, wheelDeltaY: -120 });
                Wheel._last = null;

                // A mouse's notches glide on a Mac, and only there
                step = 'glide';
                const box = document.createElement('div');
                Object.assign(box.style, { position: 'fixed', left: '0', top: '0', width: '300px', height: '200px', overflowY: 'auto', zIndex: 99999 });
                box.innerHTML = '<div style="height:3000px"></div>';
                document.body.appendChild(box);
                const notch = (target, o = {}) => { Wheel._last = null; const e = new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true, ...o }); target.dispatchEvent(e); return e; };
                const mac0 = Host.mac;
                Host.mac = () => false;
                const native = notch(box.firstChild);
                out.notMac = !native.defaultPrevented;
                Host.mac = () => true;
                const e1 = notch(box.firstChild);
                // Where it is each frame, until it's still: somewhere between, on the way
                const seen = [];
                const t0 = performance.now();
                while (performance.now() - t0 < 600) {
                    await new Promise(r => requestAnimationFrame(r));
                    seen.push(box.scrollTop);
                }
                out.glide = [e1.defaultPrevented, seen.some(v => v > 0 && v < 120), box.scrollTop];
                // Notches add up while it's still going
                notch(box.firstChild); notch(box.firstChild);
                await sleep(400);
                out.added = box.scrollTop;
                // Fingers aren't touched (they're smooth already)
                Wheel._last = null;
                const finger = new WheelEvent('wheel', { deltaY: 4.5, deltaX: 1, bubbles: true, cancelable: true });
                box.firstChild.dispatchEvent(finger);
                out.fingers = !finger.defaultPrevented;
                // At the end of what scrolls, nothing to glide
                box.scrollTop = box.scrollHeight;
                out.atEnd = !notch(box.firstChild).defaultPrevented;
                box.remove();

                // The viewer: two fingers move a zoomed photo, a pinch zooms
                step = 'viewer';
                const c = scene(800, 600);
                await openProject('wheel', { 'w.jpg': await canvasBlob(c, 'image/jpeg', 0.9), 'v.jpg': await canvasBlob(c, 'image/jpeg', 0.9) });
                app.openSingle(app.files[0]);
                await until(() => app.elements.currentImage.naturalWidth > 0);
                const ic = app.elements.imageContainer;
                const wheel = (o) => { Wheel._last = null; ic.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 400, clientY: 300, ...o })); };
                wheel({ deltaY: 4, deltaX: 3 });                       // fingers, at fit: nothing
                out.fitStays = app.zoom === 1;
                app.zoomTo(3);
                const z = app.zoom, px = app.panX, py = app.panY;
                wheel({ deltaX: 30, deltaY: 20 });
                out.panned = app.zoom === z && Math.abs(app.panX - (px - 30)) < 1e-6 && Math.abs(app.panY - (py - 20)) < 1e-6 && app.elements.currentImage.classList.contains('follow');
                wheel({ deltaY: -20, ctrlKey: true });
                out.pinched = app.zoom > z;
                const z2 = app.zoom;
                wheel({ deltaY: -3, deltaMode: 1 });                   // a mouse: zooms
                out.mouseZooms = app.zoom > z2;
                await sleep(250);
                out.followOff = !app.elements.currentImage.classList.contains('follow');

                // The grid: a pinch by how much the fingers move, a notch a step
                step = 'grid';
                app.setView('grid');
                const slider = app.elements.gridSizeSlider;
                slider.value = 160; app.setGridSize(160);
                const gv = app.elements.gridView;
                for (let i = 0; i < 6; i++) gv.dispatchEvent(new WheelEvent('wheel', { deltaY: -2, ctrlKey: true, bubbles: true, cancelable: true }));
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                out.pinchGrid = +slider.value;
                gv.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                out.notchGrid = +slider.value;
                Host.mac = mac0;
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('wheel: a pinch, two fingers and a mouse told apart; a gesture keeps its kind', r.kinds === 'pinch,trackpad,mouse,trackpad,mouse' && r.gesture === 'trackpad', JSON.stringify(r));
        check('wheel: on a Mac a mouse\'s notches glide (and add up), not elsewhere; fingers and the end of the page are left alone', r.notMac && r.glide && r.glide[0] && r.glide[1] && r.glide[2] === 120 && r.added === 360 && r.fingers && r.atEnd, JSON.stringify(r));
        check('wheel: in the viewer two fingers move a zoomed photo (at once), a pinch and a mouse zoom; at fit, fingers do nothing', r.fitStays && r.panned && r.pinched && r.mouseZooms && r.followOff, JSON.stringify(r));
        check('wheel: pinching the grid zooms it by how much the fingers move; a Ctrl+notch is a step', r.pinchGrid > 160 && r.pinchGrid <= 182 && r.notchGrid === r.pinchGrid + 20, JSON.stringify(r));
        check('wheel: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
