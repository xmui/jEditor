#!/usr/bin/env node
// jEditor's editing tools, in headless Chromium: spot and dust removal
// (retouch.js, adjust-spots.js), subject and sky masks, RAW previews, Paint,
// zooming in Adjust (adjust.js), a new blank image (blank.js), the modes (modes.js), crop's sliding sides,
// the wheel the way a Mac does it (wheel.js) and the themes (themes.js). Run by `npm test` after the UI suite; on its own:
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
// the project
const PROJECT = `
    window.sleep = (ms) => new Promise(res => setTimeout(res, ms));
    window.until = async (fn, n = 200) => { for (let i = 0; i < n && !(await fn()); i++) await sleep(50); };
    window.pressKey = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
    window.openProject = async (name, photos) => {
        const opfs = await navigator.storage.getDirectory();
        try { await opfs.removeEntry(name, { recursive: true }); } catch (e) { /* fresh */ }
        const dir = await opfs.getDirectoryHandle(name, { create: true });
        for (const [n, blob] of Object.entries(photos)) {
            // "Folder/photo.jpg": in a folder
            let d = dir;
            const parts = n.split('/');
            for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
            const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
            const w = await fh.createWritable(); await w.write(blob); await w.close();
        }
        window.showDirectoryPicker = async () => dir;
        await app.browseFolder();
        await until(() => app.files.length === Object.keys(photos).length);
        return dir;
    };
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

            // Red-eye: a red pupil goes to its own dark; a red jumper
            // outside the circle, and a brown iris in it, stay as they were
            const eyes = document.createElement('canvas');
            eyes.width = W; eyes.height = H;
            const ex = eyes.getContext('2d', { willReadFrequently: true });
            ex.fillStyle = '#c03028'; ex.fillRect(0, 0, W, H);
            ex.fillStyle = '#6a4a30'; ex.beginPath(); ex.arc(200, 150, 20, 0, Math.PI * 2); ex.fill();
            ex.fillStyle = '#d82820'; ex.beginPath(); ex.arc(200, 150, 9, 0, Math.PI * 2); ex.fill();
            const px = (x, y) => [...ex.getImageData(x, y, 1, 1).data.slice(0, 3)];
            const eye = Retouch.cleanSpots([{ t: 'eye', x: 200 / W, y: 0.5, r: 24 / H, sx: 200 / W, sy: 0.5, f: 0.2, o: 1 }]);
            out.eyeKept = eye.length === 1 && eye[0].t === 'eye';
            Retouch.applySpots(ex, W, H, eye);
            out.eye = { pupil: px(200, 150), iris: px(200, 165), jumper: px(40, 40) };

            // Backlight: a dark subject against a bright sky → Shadows up,
            // Highlights down; the other settings kept
            const sky = new Uint8ClampedArray(100 * 100 * 4);
            for (let i = 0; i < 10000; i++) { const v = i < 6000 ? 245 : 35; sky.set([v, v, v, 255], i * 4); }
            out.backlight = Develop.backlight(sky, { contrast: 10 });
            return out;
        });
        check('spots: kept compact and in range, a spot copied from itself dropped', m.clean === '[{"t":"heal","x":0.5,"y":0.5,"r":0.25,"sx":0.6,"sy":0.5,"f":1,"o":0.05}]', m.clean);
        check('spots: kept with the adjustments but not in the tables; a spot alone is an edit', m.kept && m.notNothing, JSON.stringify(m));
        check('spots: heal takes the colour round the speck, clone keeps the source\'s', Math.abs(m.heal[2] - m.heal[0]) <= 6 && m.heal[1] < 30 && m.heal[3] - m.heal[0] > 15, JSON.stringify(m.heal));
        check('spots: nothing changes outside a spot; the same spot at any size gives the same result', m.untouched && Math.abs(m.scaled[0] - m.scaled[1]) <= 4, JSON.stringify(m.scaled));
        check('spots: a source is picked nearby, off the spot, inside the photo', m.source, JSON.stringify(m));
        check('dust: specks on a scan are found (dark and light), not a real edge', m.foundSpecks >= 10 && m.falseFinds <= 1 && m.markedFound, JSON.stringify(m));
        check('dust: healed, the specks are gone; found ones aren\'t found again; less sensitive finds less', m.residual <= 12 && m.keep && m.sens, JSON.stringify(m));
        check('red-eye: kept as a spot with no source; the red pupil goes dark, the iris and a red jumper outside it stay', m.eyeKept && m.eye.pupil[0] < 60 && JSON.stringify(m.eye.iris) === '[106,74,48]' && JSON.stringify(m.eye.jumper) === '[192,48,40]', JSON.stringify(m.eye));
        check('backlight: Shadows up and Highlights down, worked out from the photo; other settings kept', m.backlight.shadows >= 50 && m.backlight.highlights <= -40 && m.backlight.contrast === 10, JSON.stringify(m.backlight));

        // In a project: kept with the photo, shown and exported healed; a
        // crop afterwards doesn't move them
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
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
                await until(() => Adjust.fullCanvas && Adjust._fullKey === Adjust.fullKey());
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

    // ---- Sync: one photo's settings onto the rest (adjust-sync.js) ----
    // ---- Zoom in Adjust ----
    if (wanted('zoom')) {
        console.log('zoom in Adjust (adjust.js)');
        const { page, issues } = await open();
        const z = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                // Bigger than the working copy (EDGE), with fine detail: a
                // one-pixel checker on the left, flat grey on the right
                const W = 4000, H = 2600;
                const c = document.createElement('canvas'); c.width = W; c.height = H;
                const g = c.getContext('2d'), img = g.createImageData(W, H);
                for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                    const i = (y * W + x) * 4, v = x < W / 2 ? ((x + y) & 1 ? 200 : 60) : 128;
                    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
                }
                g.putImageData(img, 0, 0);
                await openProject('zoomy', { 'big.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                step = 'open Adjust';
                pressKey('e');
                await until(() => Adjust.ready);
                await sleep(100);
                const chip = (id) => document.getElementById(id).getAttribute('aria-pressed') === 'true';
                const level = document.getElementById('adj-zoom-level');
                out.fit = [Adjust.fitted, chip('adj-zoom-fit'), chip('adj-zoom-100'), level.classList.contains('hidden'), Adjust.w < W];
                step = 'Ctrl+1';
                pressKey('1', { ctrlKey: true });
                const cr = () => Adjust.canvas.getBoundingClientRect();
                out.at100 = [Adjust.fitted, Math.round(Adjust.view.z * 1000) / 1000, Math.round(cr().width), chip('adj-zoom-100'), chip('adj-zoom-fit'), level.classList.contains('hidden')];
                // Past 100% the photo's pixels are sharp squares; smooth at 100%
                step = 'pixels';
                const squares = () => [Adjust.root.classList.contains('adj-pixels'), getComputedStyle(document.getElementById('adj-sharp')).imageRendering, getComputedStyle(Adjust.canvas).imageRendering].join();
                out.pixels = [squares()];
                Adjust.zoomAt(4);
                out.pixels.push(squares());
                Adjust.zoomAt(1);
                out.pixels.push(squares());
                // Sharp: the part on screen from the full-size photo, one of
                // its pixels to one screen pixel, the checker still there
                step = 'sharp';
                const sharp = document.getElementById('adj-sharp');
                await until(() => !sharp.classList.contains('hidden') && Adjust._sharp);
                const s = Adjust._sharp, sr = sharp.getBoundingClientRect();
                out.sharpSize = [s.FW, s.FH, sharp.width === s.r.w, Math.abs(sr.width - s.r.w) < 1];
                const grab = (cv, x, y, w, h) => {
                    const t = document.createElement('canvas'); t.width = w; t.height = h;
                    t.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
                    return t.getContext('2d').getImageData(0, 0, w, h).data;
                };
                const contrast = (d) => { let m = 0; for (let i = 4; i < d.length; i += 4) m += Math.abs(d[i] - d[i - 4]); return m / (d.length / 4 - 1); };
                const mean = (d) => { let m = 0; for (let i = 0; i < d.length; i += 4) m += d[i]; return m / (d.length / 4); };
                // Where the checker is on screen, in the sharp part's pixels
                // and the working copy's
                const stage = document.getElementById('adj-stage').getBoundingClientRect();
                const atX = stage.left + 40, atY = stage.top + 40;
                const sx = Math.round((atX - sr.left) / sr.width * sharp.width), sy = Math.round((atY - sr.top) / sr.height * sharp.height);
                const wx = Math.round((atX - cr().left) / cr().width * Adjust.canvas.width), wy = Math.round((atY - cr().top) / cr().height * Adjust.canvas.height);
                Adjust.draw();
                out.inChecker = (atX - cr().left) / cr().width < 0.5;
                out.contrast = [contrast(grab(sharp, sx, sy, 32, 1)), contrast(grab(Adjust.canvas, wx, wy, 32, 1))].map(Math.round);
                // Adjusted the same as the picture under it
                step = 'adjusted';
                Adjust.a.exposure = 1; Adjust.changed(); Adjust.draw();
                const flatX = stage.left + stage.width - 60;
                const toSharp = (x, y) => [Math.round((x - sr.left) / sr.width * sharp.width), Math.round((y - sr.top) / sr.height * sharp.height)];
                const toWork = (x, y) => [Math.round((x - cr().left) / cr().width * Adjust.canvas.width), Math.round((y - cr().top) / cr().height * Adjust.canvas.height)];
                const fx = (flatX - cr().left) / cr().width;
                if (fx > 0.5) {
                    out.same = [mean(grab(sharp, ...toSharp(flatX, atY), 8, 8)), mean(grab(Adjust.canvas, ...toWork(flatX, atY), 8, 8))].map(Math.round);
                } else {
                    out.same = [mean(grab(sharp, sx, sy, 32, 8)), mean(grab(Adjust.canvas, wx, wy, 32, 8))].map(Math.round);
                }
                // Before and after zooms too: the view stays, the sharp part
                // shows the photo as it was
                step = 'before';
                const v0 = JSON.stringify(Adjust.view);
                Adjust.toggleBefore(true);
                Adjust.draw();
                await sleep(250);
                Adjust.draw();
                out.before = [JSON.stringify(Adjust.view) === v0, !sharp.classList.contains('hidden'), Math.round(mean(grab(sharp, sx, sy, 32, 8)))];
                Adjust.toggleBefore(false);
                Adjust.a.exposure = 0; Adjust.changed();
                // Overlays stay on the photo: a spot drawn where it is on the
                // canvas, the overlay no bigger than the stage
                step = 'overlays';
                document.getElementById('adj-spots-sec').open = true;
                await sleep(50);
                const sv = document.getElementById('adj-spot-overlay').getBoundingClientRect();
                const u = (stage.left + stage.width / 2 - cr().left) / cr().width, vv = (stage.top + stage.height / 2 - cr().top) / cr().height;
                const p = AdjustSpots.fromPhoto(u, vv);
                const mp = (AdjustMasks.place(), AdjustMasks.fromPhoto(u, vv));
                const mv = document.getElementById('adj-overlay').getBoundingClientRect();
                out.overlay = [
                    Math.abs(sv.left + p.x - (cr().left + u * cr().width)) < 1 && Math.abs(sv.top + p.y - (cr().top + vv * cr().height)) < 1,
                    sv.width <= stage.width + 1 && sv.height <= stage.height + 1,
                    Math.abs(mv.left + mp.x - (cr().left + u * cr().width)) < 1,
                    Math.abs(AdjustSpots.toPhoto(p.x, p.y).u - u) < 1e-6
                ];
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('zoom: Adjust opens fitted, the chip says Fit (a big photo, a smaller working copy)', z.fit && String(z.fit) === 'true,true,false,true,true', JSON.stringify(z));
        check('zoom: Ctrl+1 shows it at 100% (one photo pixel to a screen pixel), the chip says so', z.at100 && String(z.at100) === 'false,1,4000,true,false,true', JSON.stringify(z.at100));
        check('zoom: past 100% the photo\'s pixels are sharp squares (on the full-size part, not the smaller working copy); smooth at 100%', z.pixels && z.pixels.join(' | ') === 'false,auto,auto | true,pixelated,auto | false,auto,auto', JSON.stringify(z.pixels));
        check('zoom: at 100% the part on screen is drawn from the full-size photo, pixel for pixel', z.sharpSize && String(z.sharpSize) === '4000,2600,true,true', JSON.stringify(z.sharpSize));
        check('zoom: sharp at 100%: fine detail the screen-sized copy loses is there', z.inChecker && z.contrast && z.contrast[0] > 100 && z.contrast[0] > z.contrast[1] * 2, JSON.stringify(z.contrast));
        check('zoom: the sharp part is adjusted as the picture under it is', z.same && Math.abs(z.same[0] - z.same[1]) <= 6 && z.same[0] > 150, JSON.stringify(z.same));
        check('zoom: Before stays zoomed, and shows the photo as it was there', z.before && z.before[0] && z.before[1] && Math.abs(z.before[2] - 130) <= 8, JSON.stringify(z.before));
        check('zoom: masks and spots stay on the photo zoomed in, their overlays only the size of the stage', z.overlay && String(z.overlay) === 'true,true,true,true', JSON.stringify(z.overlay));

        // With the real mouse and keys
        const st = await page.evaluate(() => { document.getElementById('adj-spots-sec').open = false; Adjust.zoomFit(); const r = document.getElementById('adj-stage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
        const view = () => page.evaluate(() => ({ fitted: Adjust.fitted, ...Adjust.view }));
        const under = (x, y) => page.evaluate(([x, y]) => { const r = Adjust.canvas.getBoundingClientRect(); return [(x - r.left) / r.width, (y - r.top) / r.height]; }, [x, y]);
        const px = st.x + st.w * 0.3, py = st.y + st.h * 0.4;
        const before = await under(px, py);
        await page.mouse.move(px, py);
        await page.keyboard.down('Control');
        for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
        await page.keyboard.up('Control');
        await page.waitForTimeout(100);
        const zoomed = await view(), after = await under(px, py);
        check('zoom: Ctrl+wheel zooms in about the pointer', !zoomed.fitted && Math.abs(before[0] - after[0]) < 0.002 && Math.abs(before[1] - after[1]) < 0.002, JSON.stringify([zoomed, before, after]));
        // A plain drag moves about, zoomed in
        await page.mouse.move(st.x + st.w / 2, st.y + st.h / 2);
        await page.mouse.down();
        await page.mouse.move(st.x + st.w / 2 + 60, st.y + st.h / 2 + 30, { steps: 4 });
        await page.mouse.up();
        const dragged = await view();
        check('zoom: zoomed in, a drag moves the photo about', Math.abs(dragged.x - zoomed.x - 60) < 1.5 && Math.abs(dragged.y - zoomed.y - 30) < 1.5 && Math.abs(dragged.z - zoomed.z) < 1e-9, JSON.stringify([zoomed, dragged]));
        // The wheel alone moves it too (two fingers on a trackpad)
        await page.mouse.wheel(40, 20);
        await page.waitForTimeout(80);
        const wheeled = await view();
        check('zoom: zoomed in, the wheel (or two fingers) moves about', Math.abs(wheeled.x - dragged.x + 40) < 1.5 && Math.abs(wheeled.y - dragged.y + 20) < 1.5, JSON.stringify([dragged, wheeled]));
        // With the spots tool out a drag is its own, Space+drag still moves
        await page.evaluate(() => { document.getElementById('adj-spots-sec').open = true; });
        await page.waitForTimeout(50);
        const sp0 = await page.evaluate(() => (Adjust.a.spots || []).length);
        await page.keyboard.down(' ');
        await page.mouse.move(st.x + st.w / 2, st.y + st.h / 2);
        await page.mouse.down();
        await page.mouse.move(st.x + st.w / 2 - 50, st.y + st.h / 2, { steps: 4 });
        await page.mouse.up();
        await page.keyboard.up(' ');
        const spaced = await view();
        const sp1 = await page.evaluate(() => (Adjust.a.spots || []).length);
        check('zoom: Space+drag moves about with a tool out, and the tool does nothing', Math.abs(spaced.x - wheeled.x + 50) < 1.5 && sp0 === sp1, JSON.stringify([wheeled, spaced, sp0, sp1]));
        await page.evaluate(() => { document.getElementById('adj-spots-sec').open = false; });
        // Keys: Ctrl+0 fits, Ctrl+= and Ctrl+- in and out
        await page.keyboard.press('Control+0');
        const fitted = await view();
        await page.keyboard.press('Control+=');
        const zin = await view();
        await page.keyboard.press('Control+-');
        const zout = await view();
        check('zoom: Ctrl+0 fits; Ctrl+= zooms in, Ctrl+- out', fitted.fitted && !zin.fitted && zin.z > fitted.z * 1.2 && zout.z < zin.z, JSON.stringify([fitted, zin, zout]));
        // Double-click: fit to 100% where it's clicked, and back
        await page.keyboard.press('Control+0');
        const dpt = [st.x + st.w * 0.6, st.y + st.h * 0.5];
        const dBefore = await under(...dpt);
        await page.mouse.dblclick(...dpt);
        const d1 = await view(), dAfter = await under(...dpt);
        await page.mouse.dblclick(...dpt);
        const d2 = await view();
        check('zoom: double-click goes to 100% on the spot clicked, and back to fit', !d1.fitted && Math.abs(d1.z - 1) < 1e-6 && Math.abs(dBefore[0] - dAfter[0]) < 0.002 && d2.fitted, JSON.stringify([d1, d2, dBefore, dAfter]));
        // The chip: not there at Fit; zoomed in, it pops up, and its Fit
        // goes back (and it goes); its 100% does as it says
        const shown = () => page.evaluate(() => getComputedStyle(document.getElementById('adj-zoom')).visibility === 'visible');
        await page.waitForTimeout(300);
        const atFit = await shown();
        await page.keyboard.press('Control+1');
        await page.waitForTimeout(300);
        const zoomedIn = await shown();
        await page.click('#adj-zoom-fit');
        const c2 = await view();
        await page.waitForTimeout(300);
        const goneAgain = !(await shown());
        await page.keyboard.press('Control+1');
        await page.waitForTimeout(300);
        await page.click('#adj-zoom-100');
        const c1 = await view();
        await page.keyboard.press('Control+0');
        check('zoom: the chip is hidden at Fit, pops up zoomed in, and goes again back at Fit', !atFit && zoomedIn && goneAgain, JSON.stringify([atFit, zoomedIn, goneAgain]));
        check('zoom: the chip\'s 100% and Fit do as they say', !c1.fitted && Math.abs(c1.z - 1) < 1e-6 && c2.fitted, JSON.stringify([c1, c2]));
        check('zoom: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    if (wanted('sync')) {
        console.log('sync (adjust-sync.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            const out = {};
            let step = 'open';
            try {
                const jpg = () => canvasBlob(scene(200, 150), 'image/jpeg', 0.9);
                // p and d for Crop: one portrait, one turned a quarter
                await openProject('sync', { 'a.jpg': await jpg(), 'b.jpg': await jpg(), 'c.jpg': await jpg(), 'p.jpg': await canvasBlob(scene(150, 200), 'image/jpeg', 0.9), 'd.jpg': await jpg() });
                const f = (n) => app.files.find(x => x.name === n);
                // The source: light, a look, a radial mask, a spot
                step = 'source';
                Edits.set([{ file: f('a.jpg'), edit: Edits.withAdj(null, { exposure: 1, contrast: 20, temp: 15, look: 'portra400', masks: [{ type: 'radial', adj: { exposure: 0.5 }, radial: [0.5, 0.5, 0.2, 0.2, 0, 0.5] }], spots: [{ x: 0.5, y: 0.5, r: 0.02, sx: 0.6, sy: 0.5 }] }) }], 'adjustments');
                // b: its own white balance, mask and spot; c: cropped
                Edits.set([
                    { file: f('b.jpg'), edit: Edits.withAdj(null, { temp: -30, saturation: 40, masks: [{ type: 'linear', adj: { exposure: -1 }, linear: [0, 0, 0, 1] }], spots: [{ x: 0.2, y: 0.2, r: 0.02, sx: 0.3, sy: 0.2 }] }) },
                    { file: f('c.jpg'), edit: { q: 0, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0, y1: 0.5 } } }
                ], 'setup');
                // The dialog: masks and spots unticked to start with
                step = 'dialog';
                try { localStorage.removeItem(AdjustSync.KEY); } catch (e) { /* fresh */ }
                app.selection = new Set([f('a.jpg'), f('b.jpg'), f('c.jpg')]);
                app.currentFile = f('a.jpg');
                app.syncAdjust();
                await until(() => AdjustSync.isOpen());
                const box = (id) => document.querySelector(`#sync-groups input[value="${id}"]`);
                out.defaults = box('light').checked && box('look').checked && !box('masks').checked && !box('spots').checked;
                out.unset = box('detail').parentElement.classList.contains('sync-unset') && !box('light').parentElement.classList.contains('sync-unset');
                // Light and look only: b keeps its white balance, mask and spot
                step = 'apply';
                for (const i of document.querySelectorAll('#sync-groups input')) i.checked = ['light', 'look'].includes(i.value);
                const undoBefore = (app._undoStack || []).length;
                document.getElementById('sync-ok').click();
                await until(() => !AdjustSync.isOpen());
                const b = f('b.jpg')._edit.adj, c = f('c.jpg')._edit;
                out.light = b.exposure === 1 && b.contrast === 20 && b.look === 'portra400';
                out.keptOwn = b.temp === -30 && b.saturation === 40 && b.masks.length === 1 && b.masks[0].type === 'linear' && b.spots.length === 1;
                out.cropKept = c && c.n.x1 === 0 && c.adj && c.adj.exposure === 1 && !c.adj.temp;
                out.sourceSame = f('a.jpg')._edit.adj.temp === 15;
                // (Crop, unticked only because a has no crop, stays on for next time)
                out.remembered = JSON.stringify(JSON.parse(localStorage.getItem(AdjustSync.KEY)).on) === JSON.stringify(AdjustSync.cropper() ? ['look', 'light', 'crop'] : ['look', 'light']);
                out.oneStep = app._undoStack.length === undoBefore + 1;
                // One Ctrl+Z undoes it on both
                step = 'undo';
                pressKey('z', { ctrlKey: true });
                await until(() => f('b.jpg')._edit.adj.exposure === undefined);
                out.undone = f('b.jpg')._edit.adj.exposure === undefined && f('b.jpg')._edit.adj.temp === -30 && !f('c.jpg')._edit.adj;
                // Masks ticked: the radial goes; a group the source hasn't
                // changed, ticked, takes the other's off
                step = 'masks';
                await AdjustSync.apply(f('a.jpg'), [f('b.jpg')], ['masks', 'presence']);
                const b2 = f('b.jpg')._edit.adj;
                out.masks = b2.masks.length === 1 && b2.masks[0].type === 'radial' && !b2.saturation && b2.temp === -30;
                // Sky and subject masks stay with their own photo
                const own = Develop.synced({ masks: [{ type: 'radial', adj: {}, radial: [0.5, 0.5, 0.2, 0.2, 0, 0.5] }] }, { masks: [] }, ['masks']);
                out.cleared = !own;
                // Crop (with Photos' bulk crop): the same as "Crop like the
                // last crop" on the same photos: a portrait one gets the frame
                // turned to fit, a turned one keeps its own quarter turn
                if (typeof app.cropEditsLike === 'function') {
                    step = 'crop';
                    keepEdits(true); // (both kept as edits, to compare)
                    Edits.set([
                        { file: f('a.jpg'), edit: { q: 0, angle: 3, n: { x0: -0.4, y0: -0.3, x1: 0.2, y1: 0.4 } } },
                        { file: f('c.jpg'), edit: null },
                        { file: f('d.jpg'), edit: { q: 1, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } } }
                    ], 'setup');
                    out.cropRow = AdjustSync.groups()[0].id === 'crop' && !AdjustSync.groups()[0].off;
                    const others = [f('c.jpg'), f('p.jpg'), f('d.jpg')];
                    const crops = () => others.map(x => { const e = x._edit || {}; return { q: e.q, angle: e.angle, n: e.n, landscape: e.landscape }; });
                    await AdjustSync.apply(f('a.jpg'), others, ['crop']);
                    const synced = crops();
                    pressKey('z', { ctrlKey: true });
                    await until(() => !f('c.jpg')._edit);
                    await app.cropLike(others, { ...f('a.jpg')._edit, wide: true });
                    await until(() => f('c.jpg')._edit);
                    const liked = crops();
                    out.cropSame = JSON.stringify(synced) === JSON.stringify(liked);
                    out.cropFits = synced[0].angle === 3 && synced[2].q === 1 && JSON.stringify(synced[0].n) !== JSON.stringify(synced[1].n);
                    out.crop = { synced, liked };
                } else out.cropSame = out.cropFits = out.cropRow = 'no bulk crop';
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('sync: the dialog starts with masks and spot removal unticked, and greys what the source hasn\'t changed', r.defaults && r.unset, JSON.stringify(r));
        check('sync: the ticked groups go onto the rest; each keeps the rest of its own, and its crop', r.light && r.keptOwn && r.cropKept && r.sourceSame, JSON.stringify(r));
        check('sync: what\'s ticked is remembered', r.remembered, JSON.stringify(r));
        check('sync: one Ctrl+Z undoes it on every photo', r.oneStep && r.undone, JSON.stringify(r));
        check('sync: masks, when ticked, go too; a group the source hasn\'t changed is taken off the others', r.masks && r.cleared, JSON.stringify(r));
        // In Adjust: the strip's selection, Sync from what's being made,
        // and Auto Sync
        const r2 = await page.evaluate(async () => {
            const out = {};
            let step = 'adjust';
            try {
                const f = (n) => app.files.find(x => x.name === n);
                Edits.set(['a.jpg', 'b.jpg', 'c.jpg'].map(n => ({ file: f(n), edit: null })), 'clear');
                Edits.set([{ file: f('b.jpg'), edit: Edits.withAdj(null, { temp: -30 }) }], 'setup');
                app.selection = new Set([f('a.jpg')]);
                await app.enterAdjust(f('a.jpg'));
                await until(() => Adjust.ready);
                // Ctrl+click and Shift+click in the strip
                step = 'strip';
                const thumb = (n) => [...document.querySelectorAll('#adjust-editor #thumbnail-strip .thumb-item')].find(d => d._file === f(n));
                thumb('c.jpg').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
                thumb('b.jpg').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
                out.strip = Adjust.file === f('a.jpg') && thumb('b.jpg').classList.contains('sel') && thumb('c.jpg').classList.contains('sel') && !thumb('a.jpg').classList.contains('sel');
                // Auto Sync: only the setting changed goes, a moment after
                step = 'auto';
                pressKey('S', { ctrlKey: true, altKey: true, shiftKey: true });
                out.chip = AdjustSync.auto && !document.getElementById('adj-sync-chip').classList.contains('hidden') && /2 photos/.test(document.getElementById('adj-sync-chip').textContent);
                Adjust.pushHistory();
                Adjust.a.exposure = 0.8;
                Adjust.changed();
                await until(() => f('b.jpg')._edit && f('b.jpg')._edit.adj.exposure === 0.8);
                out.auto = f('b.jpg')._edit.adj.exposure === 0.8 && f('b.jpg')._edit.adj.temp === -30 && f('c.jpg')._edit && f('c.jpg')._edit.adj.exposure === 0.8;
                // c taken out: no longer changed; Ctrl+Z in Adjust takes the
                // step off the others too
                step = 'undo';
                thumb('c.jpg').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
                Adjust.undo();
                await until(() => !f('b.jpg')._edit.adj.exposure);
                out.undo = !f('b.jpg')._edit.adj.exposure && f('b.jpg')._edit.adj.temp === -30 && f('c.jpg')._edit.adj.exposure === 0.8;
                // Sync with the dialog: Adjust's settings as they are now
                step = 'sync';
                Adjust.pushHistory();
                Adjust.a.contrast = 30;
                Adjust.changed();
                AdjustSync.toggleAuto(false);
                out.offFlushed = !AdjustSync.auto && f('b.jpg')._edit.adj.contrast === 30;
                Adjust.a.contrast = 40;
                Adjust.changed();
                pressKey('S', { ctrlKey: true, shiftKey: true });
                await until(() => AdjustSync.isOpen());
                document.getElementById('sync-ok').click();
                await until(() => f('b.jpg')._edit.adj.contrast === 40);
                out.sync = f('b.jpg')._edit.adj.contrast === 40;
                // A plain click opens that one alone; leaving turns it off
                step = 'leave';
                AdjustSync.toggleAuto(true);
                thumb('b.jpg').dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await until(() => Adjust.file === f('b.jpg') && Adjust.ready);
                out.leave = !AdjustSync.auto && !AdjustSync.targets().length && document.getElementById('adj-sync-chip').classList.contains('hidden');
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('sync in Adjust: Ctrl+click in the strip selects others, the open photo apart', r2.strip, JSON.stringify(r2));
        check('sync in Adjust: Auto Sync puts a changed setting onto the others selected, only that one, with a chip while on', r2.chip && r2.auto, JSON.stringify(r2));
        check('sync in Adjust: Ctrl+Z takes the step off the others too; one taken out of the selection isn\'t changed', r2.undo, JSON.stringify(r2));
        check('sync in Adjust: turning it off sends the last change; Ctrl+Shift+S syncs Adjust\'s settings as they are', r2.offFlushed && r2.sync, JSON.stringify(r2));
        check('sync in Adjust: a plain click opens that photo alone, and Auto Sync goes off', r2.leave, JSON.stringify(r2));
        if (r.cropSame !== 'no bulk crop') check('sync: Crop, ticked to start with, gives what "Crop like the last crop" does (a portrait frame turned to fit, each photo\'s own quarter turn kept)', r.cropRow && r.cropSame && r.cropFits, JSON.stringify(r.crop || r));
        check('sync: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
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
                // Write edits to file: RAWs exported, never written
                step = 'save';
                const choose = UI.choose;
                UI.choose = async () => 'ok';
                UI.prompt = async () => '';
                await Edits.saveAll({ list: [f('a.dng'), f('b.cr3')] }); // (Write edits to file)
                UI.choose = choose;
                UI.prompt = prompt0;
                out.saveNotWritten = await same('a.dng', dngBlob) && await same('b.cr3', cr3Blob) && !!f('b.cr3')._edit;
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('raw: RAW files are listed with the photos and get thumbnails', r.listed && r.thumbs, JSON.stringify(r));
        check('raw: shown from the JPEG inside', r.viewer && r.viewer[0] === 400 && r.viewer[2] > 150, JSON.stringify(r));
        check('raw: turns and adjustments are kept as edits, the RAW never written', r.turnKept && r.adjustKept, JSON.stringify(r));
        check('raw: Export writes JPEG copies (turned, adjusted); Write edits to file exports them instead of writing', JSON.stringify(r.exported) === '[300,200,300,400]' && r.saveNotWritten, JSON.stringify(r));
        check('raw: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- HEIC: decoded by libheif (codec.js), never written, like a RAW ----
    if (wanted('heic')) {
        console.log('heic (codec.js, codec-worker.js, codecs/heif_dec.js)');
        const { page, issues } = await open();
        // 64 × 64, from libheif's own test files (fuzzing/data/corpus/colors-no-alpha.heic)
        const HEIC = 'AAAAGGZ0eXBoZWljAAAAAG1pZjFoZWljAAABLm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAADnBpdG0AAAAAAAEAAAAiaWxvYwAAAABEQAABAAEAAAAAAU4AAQAAAAAAAAClAAAAI2lpbmYAAAAAAAEAAAAVaW5mZQIAAAAAAQAAaHZjMQAAAACuaXBycAAAAJFpcGNvAAAAdWh2Y0MBA3AAAAAAAAAAAAAe8AD8/fj4AAAPAyAAAQAYQAEMAf//A3AAAAMAkAAAAwAAAwAeugJAIQABAChCAQEDcAAAAwCQAAADAAADAB6gIIEFlupJKa5sCAAAAwAIAAADAAhAIgABAAdEAcFysCJAAAAAFGlzcGUAAAAAAAAAQAAAAEAAAAAVaXBtYQAAAAAAAAABAAECgQIAAACtbWRhdAAAAKEmAa8TgIGSEXXAGM2sfMMD8HKXsBNBYjkEW6//QKl1HfLCc/SN/bWOG2ARaa8rk4JsxRuKJFz/vIlnrSBv0Pk7pYMv503LniUfVt0RGOMyTBZVcbnDhlXs0nsTVObq7679Fh7MfXPARYndCrwpKWSNTQcCjNVYWPVOenDxU81lLBnE070xnN107IoLiTNywdiNWzedf/q6zzV3iwZflrO94A==';
        // 600 × 800 (a 800 × 600 photo turned by its EXIF, white top left: so
        // white top right once turned), with a 240 × 320 thumbnail inside, as
        // an iPhone's have (heif-enc -t 320)
        const THUMBED = 'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAApFtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAARmlsb2MAAAAAREAAAwABAAAAAAK1AAEAAAAAAAAEkAACAAAAAAdFAAEAAAAAAAAAHgADAAAAAAdjAAEAAAAAAAABmwAAAE1paW5mAAAAAAADAAAAFWluZmUCAAAAAAEAAGh2YzEAAAAAFWluZmUCAAABAAIAAEV4aWYAAAAAFWluZmUCAAAAAAMAAGh2YzEAAAABm2lwcnAAAAFzaXBjbwAAAHZodmNDAQNwAAAAAAAAAAAAWvAA/P34+AAADwMgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAWroCQCEAAQApQgEBA3AAAAMAkAAAAwAAAwBaoAZCAJZZbqSSmubAgAAAAwCAAAADAIQiAAEAB0QBwXKwYkAAAAAUaXNwZQAAAAAAAAMgAAACWAAAAAlpcm90AwAAABNjb2xybmNseAABAA0ABoAAAAAQcGl4aQAAAAADCAgIAAAAdWh2Y0MBA3AAAAAAAAAAAAA88AD8/fj4AAAPAyAAAQAYQAEMAf//A3AAAAMAkAAAAwAAAwA8ugJAIQABAChCAQEDcAAAAwCQAAADAAADADygCggPFlupJKa5sCAAAAMAIAAAAwAhIgABAAdEAcFysGJAAAAAFGlzcGUAAAAAAAABQAAAAPAAAAAJaXJvdAMAAAATY29scm5jbHgAAQANAAaAAAAAEHBpeGkAAAAAAwgICAAAACBpcG1hAAAAAAAAAAIAAQWBAgMEBQADBYYHCAkKAAAAKGlyZWYAAAAAAAAADmNkc2MAAgABAAEAAAAOdGhtYgADAAEAAQAABlFtZGF0AAAEjCgBrwTxQl7xKjCMQiAQCAPwQa7MlbT+96gTt7NUxi4shEosprl1i38A0xHCfQE+W+g/v7btZL0dwrzc+2eMPU9ynunDCWieXSRQK/GpHxqpuqLH3P1P57UCTBumaO/EVsuJZk1wM4yz+ssv/T5UqKaZxXYgX3EhDPnRJUbp11d4ZlwKf8lUx0epb1JOXBvbOX/9gd9BfbyeZjBOGHIHg9qPSpC61F/R12WGoRbcswca0lxg/9giGqShW44bWc65fkEKg29ZteGhN9nsYF27dPp1Wv2JTjVk6uRj+R1vJVqveYIGAq+svyfMe9mkXgAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAKKAAd3lOlAAAAwAD3C3aqOriU904YS0Ty6SKB8Cw2XIALqix9z9T+e1AkwbpmjvxFbLiWZNcDOMs/o7xkpm/Ydy0rxDPOx3tR3woVE6UOcSzd9BGe4WotVA4Kwd50z1utNhnsYxPwgW+J2D0ACamtWqVgqHuJLp4+R2XIwS+I9ro1ptLRKFxC/ZgBFTiswCAgEYj+8+I7tR6VIXWov6O5OSfrGXAJ7LSbs/Wkm1VX8/5vl633/5oi8ch2OGbBIHhUv8saNjjqBkSusuCqZPR0nZN+zcF3v7K85x/qf5d/mwJyxxWKY1CkVCwsQIqo+SsL+f83y9b7/80bC4AAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMBIbMYYApMi7moKP0u/JT7LL601juFju0Pz7Dey6MkUqdx9aee8YdjuXzaa633kc9ZOIFf61wKij+P0oKXKtnBqD4o9o6bmK0jtb9vuKQJfMnF7sC9S8jbI0gEoiqjMevff/xfjsA3PQDXTOpoM4pf/pEwNgoKCtuWYONaS4wf+yAYLzu8jDZrB3goxWQHBo5Z9xE739lec4/1P8u/zYq/IontX1d48ImJgeVcYE0GJCfALSqVG3dLd0yT8EMG4KS8ganz5gzGZDuz9Rzf/jKvDTQk05N7PLFZe/2/D3UvRMPs4N32EkmewIfvJ89vpW5mq8ZXldejHN7nOvRI2EiKVS9F0RmSqWA8uKGGs0Ti3Sg4+oTEbovtNZLCm9iQMCQeOUGZuWwfK/g0F2MWNWtXX/v5lvviAAKUAKQAc4CCAR4C6AAAAwB+wAAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwABSQAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAABrQAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAgIAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAIyAAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAy4AAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMCHgEDnnsGn6+QAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAAADAACYgAAAAABNTQAqAAAACAABARIAAwAAAAEABgAAAAAAAAAAAZcoAa8E8gmlBgIw7Fsdk6sK/5BTVJBkpfVwEgxTRqh6N31Y10Szt7j98ymfQqWkQI0PK2Eqvpq5zm3Xm9i6JJMGO+sNvBn+iLr9CF48mm0hd9OLxUDFhgIBp3dhnfhkkOcYY4nj5hiBpAA/LgAlbMl7VE2lv/BXf//1Kb83mUfWfE/Z8wEYWJNLwRYSsVeasctilfrRklVcMcn/EPwsa19jzF1j7jjN1vEhXBgtXJu//iH4WNa+x5i6x9xxm63iPvwpV/s9152KeBzZLO6GLHOa/fItEHhSbW88MClvfpCDxTDwKR1gSInP3n4z9/7vr8ePH/0642690qwrEP/dBRIY3h/qmscNRSWb3xrSOamNnYukQUCUXjoO9Zo12Z4KnJdZnP19fDwX1jK1JoJ/FDux7O4BTgTC/3ntLUQ6IQ0rnfLni1jI86ZQAAADAAADAAADAACzgCGHnn/d6hX/HDAQqwAAAwAAAwAAAwAABMwAAAMAAAMAAAMAAAMAAAMACSgAAAMAAAMAAAMAAAMAAAMAAAMAAAMB0w==';
        await page.evaluate(([b, t]) => {
            window.HEIC = new Blob([Uint8Array.from(atob(b), c => c.charCodeAt(0))], { type: 'image/heic' });
            window.THUMBED = new Blob([Uint8Array.from(atob(t), c => c.charCodeAt(0))], { type: 'image/heic' });
        }, [HEIC, THUMBED]);
        const r = await page.evaluate(async () => {
            let step = 'names';
            try {
                const out = {};
                out.names = [app.isImage('IMG_1.HEIC'), app.isImage('a.heif'), app.isImage('DSC1.HIF'), Codec.isHeif('a.jpg'), Codec.decoded('a.heic')].join();
                step = 'decode';
                const img = await pixels(await Codec.showable(new File([HEIC], 'IMG_1.heic')));
                const d = img.data, seen = new Set();
                for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] >> 5 << 10 | d[i + 1] >> 5 << 5 | d[i + 2] >> 5);
                out.decoded = [img.width, img.height, d[3] === 255, seen.size > 1];
                step = 'project';
                const dir = await openProject('heics', { 'IMG_1.heic': HEIC, 'b.jpg': await canvasBlob(scene(80, 60), 'image/jpeg', 0.9) });
                const f = (n) => app.files.find(x => x.name === n);
                const same = async () => { const a = new Uint8Array(await (await (await dir.getFileHandle('IMG_1.heic')).getFile()).arrayBuffer()), b = new Uint8Array(await HEIC.arrayBuffer()); return a.length === b.length && a.every((v, i) => v === b[i]); };
                await until(() => f('IMG_1.heic').thumbnailUrl);
                out.thumb = !!f('IMG_1.heic').thumbnailUrl;
                // Grid thumbnails: the HEIC's own when it has one (240 wide, not
                // the 320 a decode of the photo gives), turned as the photo is
                step = 'own thumbnail';
                const own = await pixels(await Codec.thumbnail(new File([THUMBED], 'IMG_2.heic', { type: 'image/heic' }), 320));
                const at = (img, x, y) => img.data.slice((Math.floor(y) * img.width + Math.floor(x)) * 4, (Math.floor(y) * img.width + Math.floor(x)) * 4 + 3);
                const white = (c) => c[0] > 200 && c[1] > 200 && c[2] > 200, red = (c) => c[0] > 150 && c[1] < 100 && c[2] < 100;
                out.ownThumb = [own.width, own.height, white(at(own, own.width * 0.9, own.height * 0.05)), red(at(own, own.width * 0.1, own.height * 0.6))];
                // ...and with none, from the photo (no bigger than it is)
                const none = await pixels(await Codec.thumbnail(new File([HEIC], 'IMG_1.heic', { type: 'image/heic' }), 320));
                out.noOwnThumb = [none.width, none.height];
                // Opened again: its cached thumbnail, with nothing decoded
                step = 'cached';
                const ops = [], run = Codec.run;
                Codec.run = function (msg) { ops.push(msg.op); return run.call(this, msg); };
                Codec._shown.length = 0;
                const fe = f('IMG_1.heic');
                URL.revokeObjectURL(fe.thumbnailUrl);
                fe.thumbnailUrl = null;
                await app.makeThumbnail(fe);
                Codec.run = run;
                out.cached = [!!fe.thumbnailUrl, ops.join() || 'none'];
                step = 'viewer';
                app.openSingle(f('IMG_1.heic'));
                const src = await app.getDisplaySource(f('IMG_1.heic'));
                const shown = await pixels(src.blob || await (await fetch(src.url)).blob());
                out.viewer = [shown.width, shown.height];
                // A turn: kept as an edit, the HEIC untouched
                step = 'turn';
                await app.rotateImage(f('IMG_1.heic'), 90);
                await sleep(100);
                out.turnKept = !!(f('IMG_1.heic')._edit && f('IMG_1.heic')._edit.q === 1) && await same();
                // Export: a JPEG copy, named .jpg
                step = 'export';
                const prompt0 = UI.prompt;
                UI.prompt = async () => '';
                await app.exportCopies([f('IMG_1.heic')]);
                const ex = await (await (await dir.getDirectoryHandle('jEditor Export')).getFileHandle('IMG_1.jpg')).getFile();
                out.exported = [ex.type || 'image/jpeg', (await pixels(ex)).width, new Uint8Array(await ex.slice(0, 2).arrayBuffer()).join()];
                // Write edits to file: exported, never written
                step = 'save';
                const choose = UI.choose;
                UI.choose = async () => 'ok';
                await Edits.saveAll({ list: [f('IMG_1.heic')] }); // (Write edits to file)
                UI.choose = choose;
                UI.prompt = prompt0;
                out.saveNotWritten = await same() && !!f('IMG_1.heic')._edit;
                // Convert: to WebP, whatever its size
                step = 'convert';
                const conv = await Codec.encode(await app.readImage(f('IMG_1.heic')), 'webp', 80);
                out.converted = [conv.w, conv.h, conv.bytes.length > 0];
                await Edits.flush();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('heic: .heic, .heif and .hif are photos, decoded by the codecs', r.names === 'true,true,true,false,true', JSON.stringify(r));
        check('heic: decoded by the bundled libheif, 64 × 64, opaque, in colour', String(r.decoded) === '64,64,true,true', JSON.stringify(r));
        check('heic: listed with a thumbnail, and shown', r.thumb && String(r.viewer) === '64,64', JSON.stringify(r));
        check('heic: a grid thumbnail is the HEIC\'s own when it has one, turned as the photo is', String(r.ownThumb) === '240,320,true,true', JSON.stringify(r));
        check('heic: ...and made from the photo when it has none', String(r.noOwnThumb) === '64,64', JSON.stringify(r));
        check('heic: a cached thumbnail is used without decoding the HEIC again', String(r.cached) === 'true,none', JSON.stringify(r));
        check('heic: a turn is kept as an edit, the HEIC never written; Write edits to file exports instead', r.turnKept && r.saveNotWritten, JSON.stringify(r));
        check('heic: Export writes a JPEG copy, IMG_1.jpg', r.exported && r.exported[1] === 64 && r.exported[2] === '255,216', JSON.stringify(r));
        check('heic: Convert encodes it (to WebP)', String(r.converted) === '64,64,true', JSON.stringify(r));
        check('heic: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
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
            // Ten slots; a slot shows its group's tool used last; a
            // right-click on a slot of several lists them
            PaintEditor.init(app);
            PaintEditor.setTool('lasso');
            PaintEditor.setTool('pencil');
            const slots = [...document.querySelectorAll('.paint-tool')];
            const sel = slots.find(b => b.dataset.group === '1');
            sel.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            const menu = document.getElementById('context-menu');
            out.slots = [slots.length, slots.map(b => b.dataset.tool).join(), slots.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.tool).join(), menu ? menu.querySelectorAll('[role^="menuitem"]').length : 0];
            app.closeContextMenu();
            out.lock = JSON.stringify(Paint.clean({ id: 'abc', w: 10, h: 10, layers: [{ id: 'l1', rev: 'r1', lock: 1 }, { id: 'l2', rev: 'r2', lock: false }] }).layers.map(l => l.lock));
            // Saved colours: + saves the brush colour once, kept between
            // sessions; taken off again
            PaintEditor.init(app);
            const sw = () => document.querySelectorAll('#paint-palette button:not(.paint-palette-add)').length;
            const n0 = sw();
            PaintEditor.fg = '#123456';
            PaintEditor.saveColour();
            PaintEditor.saveColour();
            const n1 = sw(), kept = JSON.parse(localStorage.getItem('jeditor.paintColours') || '[]').includes('#123456');
            PaintEditor.removeColour('#123456');
            out.saved = [n1 - n0, kept, sw() - n0, !!document.getElementById('paint-choose')];
            // Grow, shrink and feather a selection: a 20 x 20 square in 60 x 60
            const W = 60, H = 60, sq = new Uint8ClampedArray(W * H);
            for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) sq[y * W + x] = 255;
            const at = (a, x, y) => a[y * W + x];
            const grown = PaintEditor.spread(sq, W, H, 5, true), shrunk = PaintEditor.spread(sq, W, H, 5, false);
            // 5 out at the sides, and round at the corners (16,16 is 5.7 from the
            // square's corner); 5 in at the sides
            out.grow = [at(grown, 15, 30), at(grown, 14, 30), at(grown, 17, 17), at(grown, 16, 16)];
            out.shrink = [at(shrunk, 25, 30), at(shrunk, 24, 30), at(shrunk, 30, 30)];
            // Fill with gaps closed: a square drawn in a 2 px line, with a
            // 3 px gap in its top, fills inside (to the line) but not out
            const ring = new Uint8Array(W * H).fill(1);
            for (let y = 15; y < 45; y++) for (let x = 15; x < 45; x++) {
                if ((x < 17 || x > 42 || y < 17 || y > 42) && !(y < 17 && x >= 29 && x < 32)) ring[y * W + x] = 0;
            }
            const plain = PaintEditor.flood(ring, W, H, 30, 30), closed = PaintEditor.closedFlood(ring, W, H, 30, 30, 2);
            const n = (mk) => mk.reduce((t, v) => t + (v ? 1 : 0), 0);
            out.gaps = [!!plain[5 * W + 5], !!closed[5 * W + 5], !!closed[17 * W + 17], n(closed) >= 676 && n(closed) <= 700];
            const soft = PaintEditor.blurAlpha(sq, W, H, 8);
            out.feather = [at(soft, 30, 30), at(soft, 20, 30), at(soft, 10, 30), at(soft, 2, 30)];
            return out;
        });
        check('paint: Grow and Shrink move a selection\'s edge by the pixels asked, rounding its corners', JSON.stringify(m.grow) === '[255,0,255,0]' && JSON.stringify(m.shrink) === '[255,0,255]', JSON.stringify([m.grow, m.shrink]));
        check('paint: Close gaps fills a line drawing with a small gap inside, up to its lines, not out through the gap', JSON.stringify(m.gaps) === '[true,false,true,true]', JSON.stringify(m.gaps));
        check('paint: Feather softens the edge (half-way at it, nothing far off), the middle still selected', m.feather[0] >= 240 && m.feather[1] > 90 && m.feather[1] < 165 && m.feather[2] < m.feather[1] && m.feather[3] === 0, JSON.stringify(m.feather));
        check('paint: the record is checked (names, opacity, blend; bad ids dropped)', m.clean === '{"id":"abc","w":100,"h":50,"layers":[{"id":"l1","rev":"r1","name":"Sky","opacity":1,"blend":"source-over","hidden":true}]}' && m.none, JSON.stringify(m));
        check('paint: layers at the photo\'s size, a very big one smaller', m.size === '[{"w":3000,"h":2000},{"w":800,"h":600}]', m.size);
        check('paint: ten tool slots, each showing its group\'s tool used last; a right-click lists the others', JSON.stringify(m.slots) === '[10,"move,lasso,pencil,eraser,spot-heal,fill,line,text,picker,hand","pencil",4]', JSON.stringify(m.slots));
        check('paint: a layer\'s locked transparency is kept (only when on)', m.lock === '[true,null]', m.lock);
        check('paint: saved colours: + saves the brush colour (once), kept; right-click takes one off; Choose a colour…', JSON.stringify(m.saved) === '[1,true,0,true]', JSON.stringify(m.saved));

        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const W = 400, H = 300;
                const c = document.createElement('canvas'); c.width = W; c.height = H;
                const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
                g.fillStyle = '#2050c0'; g.fillRect(250, 50, 100, 100);   // a blue square, for the fill and the wand
                const dir = await openProject('painted', { 'p.png': await canvasBlob(c, 'image/png') });
                const f = app.files[0];
                const before = new Uint8Array(await (await (await dir.getFileHandle('p.png')).getFile()).arrayBuffer());
                app.openSingle(f);
                step = 'open';
                out.button = Modes.shown().some(m => m[0] === 'paint') && !!document.querySelector('#mode-row:not(.hidden) [data-mode="paint"]');
                pressKey('b');
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                out.open = P.isOpen && P.W === W && P.layers.length === 1;
                // To start: the photo locked at the bottom, a new layer on it chosen
                const rows = [...document.querySelectorAll('#paint-layer-list .paint-layer')];
                out.start = rows.length === 2 && rows[1].classList.contains('paint-photo-layer') && rows[1].getAttribute('aria-disabled') === 'true' &&
                    rows[0].getAttribute('aria-selected') === 'true' && P.cur === 0;
                const st = document.getElementById('paint-stage');
                const at = (x, y) => { const s = P.V().transformPoint(P.C.transformPoint({ x, y })); const r = P.canvas.getBoundingClientRect(); return { clientX: r.left + s.x, clientY: r.top + s.y }; };
                const pe = (type, x, y, o = {}) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: 1, bubbles: true, button: 0, ...o }));
                const px = (l, x, y) => [...P.layers[l].canvas.getContext('2d').getImageData(x, y, 1, 1).data];
                // The photo is drawn at screen size once for a view, and again
                // only when the view changes (a fine downscale every frame lagged)
                step = 'shown';
                P.render();
                const cached = P._shown && P._shown.canvas, cachedKey = P._shown && P._shown.key;
                P.render({ quick: true });
                out.shownKept = !!cached && P._shown.canvas === cached && P._shown.key === cachedKey;
                const key = P._shown.key;
                P.zoomTo(P.view.z * 1.5);
                P.render();
                out.shownRedrawn = P._shown.key !== key;
                P.fit();
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
                // Image ▸ Rotate right: the photo's own turn, the layers with it
                // (their pixels unchanged); Ctrl+Z turns it back
                step = 'rotate';
                const ow = P.OW, oh = P.OH;
                out.imageMenu = P.moreItems()[0][0] === 'Image';
                P.turnImage(1);
                out.turned = [P.OW === oh, P.OH === ow, P.edit.q === 1, px(0, 100, 100)[3]];
                pressKey('z', { ctrlKey: true });
                out.turnUndone = P.OW === ow && P.OH === oh && !((P.edit && P.edit.q) || 0);
                // Copy merged takes the photo too; paste in place puts it back
                // where it was, on a new layer
                step = 'copy merged';
                P.copy();
                out.plainClip = P._clip.getContext('2d').getImageData(100, 130, 1, 1).data[3];
                P.copy({ merged: true });
                P.addLayer();
                P.paste({ inPlace: true });
                pressKey('Enter');
                out.inPlace = [px(1, 100, 100).slice(0, 2).join(), px(1, 100, 130)[3], px(1, 100, 130).slice(0, 3).join() === [...P.photo.getContext('2d').getImageData(100, 130, 1, 1).data.slice(0, 3)].join()];
                P.deleteLayer();
                P.setTool('brush'); // (a paste takes Move)
                // Lock transparency: green goes over the red stroke, not past it
                step = 'lock';
                P.toggleLock(0);
                P.fg = '#00ff00';
                pe('pointerdown', 120, 100); pe('pointermove', 160, 100); pe('pointermove', 200, 100); pe('pointerup', 200, 100);
                out.locked = [px(0, 130, 100), px(0, 185, 100)[3], P.layers[0].lock];
                pressKey('z', { ctrlKey: true });
                P.toggleLock(0);
                P.fg = '#ff0000';
                // Ctrl-click a thumbnail: the layer's paint selected
                step = 'layer pixels';
                P.selectLayerPixels(0);
                out.layerSel = !!P.sel && P.sel.box.x >= 38 && P.sel.box.x <= 42 && P.sel.box.w >= 118 && P.sel.box.w <= 122;
                P.deselect();
                // Alt-click an eye: that layer alone, again all back
                step = 'solo';
                P.addLayer();
                P.soloLayer(1);
                const alone = [P.layers[0].hidden, P.layers[1].hidden];
                P.soloLayer(1);
                out.solo = [...alone, P.layers[0].hidden, P.layers[1].hidden];
                P.deleteLayer();
                out.layerMenu = P.layerItems(0).map(i => i[0]).slice(0, 4).join('|');
                // Alt with the brush: the colour picker, its loupe drawn; the
                // brush paints nothing
                step = 'alt pick';
                P.fg = '#0000ff';
                pe('pointerdown', 100, 100, { altKey: true });
                P.render();
                pe('pointerup', 100, 100, { altKey: true });
                out.altPick = [P.fg, !!P._loupeCv && P._loupeCv.width === P.LOUPE_N, px(0, 100, 130)[3]];
                P.alt = false;
                P.fg = '#ff0000';
                // Alt + right-drag: bigger to the right, softer down; no paint
                step = 'alt size';
                P.opts.size = 20; P.opts.hardness = 100;
                pe('pointerdown', 250, 300, { altKey: true, button: 2 });
                pe('pointermove', 330, 340, { altKey: true, button: 2 });
                pe('pointerup', 330, 340, { altKey: true, button: 2 });
                out.altSize = [P.opts.size > 20, P.opts.hardness < 100, px(0, 290, 320)[3], P.drag];
                P.opts.size = 20; P.opts.hardness = 100;
                // Half opacity: half covered
                step = 'opacity';
                P.opts.opacity = 50;
                pe('pointerdown', 50, 200); pe('pointermove', 70, 200); pe('pointermove', 90, 200); pe('pointerup', 90, 200);
                out.half = px(0, 70, 200)[3];
                // As it's drawn, the stroke shows exactly as it goes on: the
                // preview is redone only where the stroke reached since the
                // last frame, over the red stroke, soft, at half opacity
                step = 'preview';
                P.opts.hardness = 40;
                const previewOff = (tool) => {
                    P.setTool(tool);
                    pe('pointerdown', 40, 60);
                    for (const [x, y] of [[80, 90], [120, 110], [160, 95], [200, 140], [150, 160]]) { pe('pointermove', x, y); P.render({ quick: true }); }
                    const shownNow = P.scratch().getContext('2d').getImageData(0, 0, W, H).data.slice();
                    pe('pointerup', 150, 160);
                    const went = P.layers[0].canvas.getContext('2d').getImageData(0, 0, W, H).data;
                    let off = 0;
                    for (let i = 0; i < went.length; i++) off = Math.max(off, Math.abs(went[i] - shownNow[i]));
                    return off;
                };
                out.previewOff = [previewOff('brush'), previewOff('eraser')];
                pressKey('z', { ctrlKey: true }); pressKey('z', { ctrlKey: true }); // (the checks below expect the layer as it was)
                P.setTool('brush');
                P.opts.hardness = 100;
                P.opts.opacity = 100;
                // Sizes are the photo's own pixels, kept the same part of
                // each photo (a brush on a small photo is small); the slider
                // spreads the small sizes out
                step = 'sizes';
                P.opts.size = 20; P.opts.sizeFor = 800;
                P.fitSizes();
                out.sizes = [P.opts.size, P.opts.sizeFor, P.sizeMax()];
                P.opts.size = 20;
                P.buildOptions();
                const sizeIn = P.optRows.size.querySelector('input'), sizeNum = P.optRows.size.querySelector('.paint-num');
                sizeIn.value = '300';
                sizeIn.dispatchEvent(new Event('input'));
                sizeIn.dispatchEvent(new Event('change'));
                out.slider = [P.opts.size, sizeNum.textContent];
                // The wheel sizes the brush, shown on the photo as it changes;
                // Ctrl+wheel zooms; ] is bigger
                step = 'wheel';
                P.opts.size = 20;
                P.optRows.size._sync();
                pe('pointermove', 200, 150);
                const wheel = (o = {}) => st.dispatchEvent(new WheelEvent('wheel', { ...at(200, 150), deltaY: -100, bubbles: true, cancelable: true, ...o }));
                const z0 = P.view.z;
                wheel();
                out.wheel = [P.opts.size > 22 && P.opts.size < 26, sizeNum.textContent === P.sizeLabel(P.opts.size), performance.now() < P._sizeUntil, P.view.z === z0];
                const s1 = P.opts.size;
                wheel({ ctrlKey: true });
                out.ctrlWheel = [P.opts.size === s1, P.view.z > z0];
                P.fit();
                pressKey(']');
                out.bracket = P.opts.size >= Math.floor(s1) + 1;
                // Shift-click paints straight on from where the last stroke ended
                step = 'shift-click';
                P.opts.size = 10;
                pe('pointerdown', 50, 270); pe('pointermove', 60, 270); pe('pointerup', 60, 270);
                const between = px(0, 100, 270)[3];
                pe('pointerdown', 150, 270, { shiftKey: true }); pe('pointerup', 150, 270, { shiftKey: true });
                out.shiftLine = [between, px(0, 100, 270)[3], px(0, 100, 285)[3]];
                pressKey('z', { ctrlKey: true }); pressKey('z', { ctrlKey: true });
                // Recolor: red (light and dark) becomes blue, its shading kept;
                // other colours left alone; one undo
                step = 'recolor';
                const lg = P.layers[0].canvas.getContext('2d');
                lg.fillStyle = '#c82020'; lg.fillRect(300, 200, 40, 40);
                lg.fillStyle = '#701010'; lg.fillRect(340, 200, 40, 40);
                lg.fillStyle = '#20a040'; lg.fillRect(300, 250, 40, 20);
                P.setTool('recolor');
                const recolorOpts = ['Range', 'All layers', 'Opacity'].every(t => document.getElementById('paint-options').textContent.includes(t)) && !document.getElementById('paint-options').textContent.includes('Tolerance');
                P.opts.sampleAll = false; P.opts.range = 30; P.opts.opacity = 100;
                P.fg = '#2060e0';
                const h1 = P.history.length;
                pe('pointerdown', 310, 210); pe('pointerup', 310, 210);
                const lit = px(0, 310, 210), dark = px(0, 350, 210), green = px(0, 310, 260);
                out.recolor = [recolorOpts, lit[2] > 180 && lit[0] < 80, dark[2] > dark[0] + 40 && dark[2] < lit[2], green.join(), px(0, 290, 210)[3], P.history.length === h1 + 1 && P.history[h1].name];
                pressKey('z', { ctrlKey: true });
                out.recolor.push(px(0, 310, 210).join());
                lg.clearRect(300, 200, 80, 70);
                P.setTool('fill'); pressKey('g'); const afterG = P.tool; pressKey('g');
                out.recolor.push(afterG + ',' + P.tool);
                // Retro: the pixel pencil paints whole squares of a grid the
                // brush's size; the stamp our own picture; the spray can hard
                // dots as it's held, only inside its round
                step = 'retro';
                const clear = () => lg.clearRect(80, 180, 320, 100);
                P.fg = '#ff0000'; P.opts.opacity = 100;
                P.setTool('pixel'); P.opts.size = 10;
                pe('pointerdown', 103, 204); pe('pointerup', 103, 204);
                const cell = [px(0, 100, 200)[3], px(0, 109, 209)[3], px(0, 110, 205)[3], px(0, 99, 205)[3], px(0, 105, 210)[3]];
                clear();
                P.setTool('stamp'); P.opts.stamp = 'star'; P.opts.size = 24;
                pe('pointerdown', 200, 220); pe('pointerup', 200, 220);
                const stamped = [px(0, 200, 220)[3], px(0, 189, 209)[3], px(0, 200, 209)[3], px(0, 200, 231)[3], P.history[P.history.length - 1].name];
                clear();
                P.setTool('can'); P.opts.size = 40; P.opts.density = 60;
                pe('pointerdown', 300, 230);
                await new Promise(res => setTimeout(res, 300));
                pe('pointerup', 300, 230);
                const sprayed = P.layers[0].canvas.getContext('2d').getImageData(270, 200, 60, 60).data;
                let dots = 0, soft = 0, outside = 0;
                for (let i = 0; i < sprayed.length; i += 4) {
                    if (!sprayed[i + 3]) continue;
                    dots++;
                    if (sprayed[i + 3] !== 255) soft++;
                    const q = i / 4, dx = 270 + q % 60 - 300, dy = 200 + Math.floor(q / 60) - 230;
                    if (Math.hypot(dx, dy) > 23) outside++;
                }
                clear();
                const slot = [...document.querySelectorAll('.paint-tool')].find(b => b.dataset.group === '2');
                slot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                const menuNow = document.getElementById('context-menu');
                const retroMenu = menuNow ? [...menuNow.children].map(e => e.textContent.replace(/\s+$/, '')).join('|') : '';
                app.closeContextMenu();
                out.retro = [cell.join(), stamped.join(), dots > 20 && soft === 0 && outside === 0, retroMenu.replace(/(Brush|Pencil)[A-Z]\|/g, "$1|") === "Brush|Soft round|Hard round|Pencil|Ink|Marker|Airbrush|Spray|Painters|Charcoal|Watercolour|Texture brush|Mixer|Retro|Pixel pencil|Spray can|Stamp|Yours|Your brush" ? 'menu' : retroMenu];
                P.setTool('brush'); P.opts.size = 10; P.opts.density = 40;
                // Heal and clone (paint-heal.js): clone copies from where
                // Alt was clicked; heal copies its texture in the colours
                // round the stroke; spot heal fills a mark from round it;
                // each one step of Undo; J and S choose them
                step = 'heal';
                const hn = P.history.length, hard0 = P.opts.hardness;
                P.setTool('clone'); P.opts.size = 16; P.opts.hardness = 100; P.opts.sampleAll = true; P.opts.aligned = true;
                const healOpts = ['Hardness', 'Aligned', 'All layers', 'Opacity'].every(t => document.getElementById('paint-options').textContent.includes(t));
                pe('pointerdown', 100, 220); pe('pointerup', 100, 220);
                const noSource = [P.history.length === hn, px(0, 100, 220)[3]];
                pe('pointerdown', 300, 100, { altKey: true }); pe('pointerup', 300, 100, { altKey: true });
                pe('pointerdown', 100, 220); pe('pointerup', 100, 220);
                const cloned = px(0, 100, 220);
                const cloneName = P.history[P.history.length - 1].name;
                P.setTool('heal');
                pe('pointerdown', 100, 250); pe('pointermove', 115, 250); pe('pointerup', 115, 250);
                const healed = px(0, 108, 250);
                lg.fillStyle = '#000'; lg.fillRect(198, 248, 6, 6);
                P.setTool('spot-heal'); P.opts.size = 20; P.opts.hardness = 80;
                pe('pointerdown', 201, 251); pe('pointerup', 201, 251);
                const spot = px(0, 200, 250), spotName = P.history[P.history.length - 1].name;
                const near = (q, v, k = 14) => Math.abs(q[0] - v[0]) < k && Math.abs(q[1] - v[1]) < k && Math.abs(q[2] - v[2]) < k;
                const hslot = [...document.querySelectorAll('.paint-tool')].find(b => b.dataset.group === '4');
                hslot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                const hm = document.getElementById('context-menu');
                const healMenu = hm ? [...hm.querySelectorAll('[role^="menuitem"]')].map(e => e.textContent.replace(/[A-Z]$/, '').trim()).join('|') : '';
                app.closeContextMenu();
                P.setTool('brush'); pressKey('j'); const k1 = P.tool; pressKey('j'); const k2 = P.tool; pressKey('s');
                out.heal = [healOpts, noSource.join(), near(cloned, [32, 80, 192]) && cloned[3] === 255, cloneName, near(healed, [128, 128, 128], 16) && healed[3] === 255,
                    near(spot, [128, 128, 128]) && spot[3] > 200, spotName, P.history.length - hn, healMenu, [k1, k2, P.tool].join()];
                lg.clearRect(80, 205, 150, 65);
                // Tone and focus: dodge lightens, burn darkens, sponge takes
                // colour out, blur softens an edge, sharpen crisps it, smudge
                // drags a colour along; each one step of Undo
                step = 'tone';
                const tn = P.history.length;
                P.opts.size = 20; P.opts.hardness = 100; P.opts.strength = 50; P.opts.toneRange = 'mid'; P.opts.sponge = 'less'; P.opts.sampleAll = true;
                const toneOpts = (P.setTool('dodge'), ['Range', 'Strength', 'All layers'].every(t => document.getElementById('paint-options').textContent.includes(t)));
                pe('pointerdown', 100, 220); pe('pointerup', 100, 220);
                const dodged = px(0, 100, 220);
                P.setTool('burn');
                pe('pointerdown', 140, 220); pe('pointerup', 140, 220);
                const burnt = px(0, 140, 220);
                P.setTool('sponge');
                pe('pointerdown', 300, 100); pe('pointerup', 300, 100);
                const sponged = px(0, 300, 100);
                P.setTool('blur');
                pe('pointerdown', 250, 120); pe('pointerup', 250, 120);
                const blurIn = px(0, 252, 120), blurOut = px(0, 247, 120);
                P.setTool('sharpen');
                pe('pointerdown', 350, 120); pe('pointerup', 350, 120);
                const sharpOut = px(0, 351, 120);
                P.setTool('smudge'); P.opts.strength = 80;
                pe('pointerdown', 300, 135); for (let y = 140; y <= 190; y += 5) pe('pointermove', 300, y); pe('pointerup', 300, 190);
                const smudged = px(0, 300, 160);
                const toneNames = P.history.slice(tn).map(h => h.name).join('|');
                hslot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                const tm = document.getElementById('context-menu');
                const toneMenu = tm ? [...tm.children].map(e => e.textContent.replace(/[A-Z]$/, '').trim()).filter(Boolean).join('|') : '';
                app.closeContextMenu();
                out.tone = [toneOpts, dodged[0] > 180 && dodged[0] < 200 && dodged[3] === 255, burnt[0] > 55 && burnt[0] < 75, sponged[2] - sponged[0] < 100 && sponged[3] === 255,
                    blurIn[0] > 42 && blurOut[0] < 118, sharpOut[0] > 135, smudged[2] > smudged[0] + 20 && smudged[3] > 0, toneNames, toneMenu];
                for (let i = 0; i < 6; i++) pressKey('z', { ctrlKey: true });
                out.tone.push(P.history.length === tn && px(0, 100, 220)[3] === 0 && px(0, 300, 160)[3] === 0);
                // More brushes: hard and soft rounds; the marker darker where
                // it crosses itself; ink thinner when fast; the airbrush
                // building up as it's held; the block eraser square, E going
                // through the erasers; smoothing steadying a shaky line; a
                // pen's pressure as opacity
                step = 'brushes';
                const bn = P.history.length;
                P.opts.opacity = 100; P.opts.flow = 100; P.fg = '#ff0000';
                P.setTool('hard-round'); P.opts.size = 20;
                pe('pointerdown', 40, 40); pe('pointerup', 40, 40);
                P.setTool('soft-round');
                pe('pointerdown', 90, 40); pe('pointerup', 90, 40);
                const rounds = [px(0, 48, 40)[3] === 255, px(0, 98, 40)[3] < 100 && px(0, 90, 40)[3] > 200];
                P.setTool('marker');
                pe('pointerdown', 140, 30); pe('pointermove', 140, 50); pe('pointerup', 140, 50);
                const markerOne = px(0, 140, 40);
                P.fg = '#0000ff';
                pe('pointerdown', 130, 40); pe('pointermove', 150, 40); pe('pointerup', 150, 40);
                const markerCross = px(0, 140, 40), markerBlue = px(0, 156, 40);
                P.fg = '#ff0000';
                P.setTool('ink'); P.opts.size = 16;
                pe('pointerdown', 20, 205); for (let x = 22; x <= 120; x += 2) pe('pointermove', x, 205); pe('pointerup', 120, 205);
                pe('pointerdown', 20, 245); pe('pointermove', 70, 245); pe('pointermove', 120, 245); pe('pointerup', 120, 245);
                const thick = (y0) => { let n = 0; for (let y = y0 - 15; y <= y0 + 15; y++) if (px(0, 100, y)[3] > 128) n++; return n; };
                const inkW = [thick(205), thick(245)];
                P.setTool('airbrush'); P.opts.size = 20;
                pe('pointerdown', 200, 40); pe('pointerup', 200, 40);
                pe('pointerdown', 250, 40);
                await new Promise(res => setTimeout(res, 300));
                pe('pointerup', 250, 40);
                const air = [px(0, 200, 40)[3], px(0, 250, 40)[3]];
                lg.fillStyle = '#00ff00'; lg.fillRect(150, 190, 60, 40);
                P.setTool('eraser-block'); P.opts.size = 10;
                pe('pointerdown', 170, 210); pe('pointerup', 170, 210);
                const block = [px(0, 166, 206)[3], px(0, 174, 214)[3], px(0, 176, 216)[3]];
                lg.clearRect(150, 190, 60, 40);
                P.setTool('eraser'); pressKey('e'); const e1 = P.tool; pressKey('e'); const e2 = P.tool; pressKey('e'); const e3 = P.tool;
                P.setTool('hard-round'); P.opts.size = 4;
                const zig = (y0) => { pe('pointerdown', 200, y0); for (let i = 1; i <= 24; i++) pe('pointermove', 200 + i * 8, y0 + (i % 2 ? 12 : -12)); pe('pointerup', 392, y0); };
                const row = (y) => { let n = 0; for (let x = 200; x < 392; x++) if (px(0, x, y)[3] > 0) n++; return n; };
                P.opts.smoothing = 0; zig(205); const shaky = row(217);
                P.opts.smoothing = 75; zig(255); const steady = row(267);
                P.opts.smoothing = 0;
                P.setTool('hard-round'); P.opts.size = 20; P.opts.pressure = 'opacity';
                const penLight = { pointerType: 'pen', pressure: 0.4 };
                pe('pointerdown', 20, 280, penLight); for (let x = 25; x <= 100; x += 5) pe('pointermove', x, 280, penLight); pe('pointerup', 100, 280, penLight);
                const light = [px(0, 60, 280)[3], px(0, 60, 288)[3]];
                P.opts.pressure = 'size';
                const brushMenu = (() => {
                    const b = [...document.querySelectorAll('.paint-tool')].find(x => x.dataset.group === '2');
                    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                    const mm = document.getElementById('context-menu');
                    const t = mm ? [...mm.children].map(e => e.textContent.replace(/[A-Z]$/, '').trim()).filter(Boolean).join('|') : '';
                    app.closeContextMenu();
                    return t;
                })();
                out.brushes = [rounds.join(), markerOne[0] > 200 && markerOne[2] < 40, markerCross[0] < 40 && markerCross[2] < 40 && markerCross[3] === 255, markerBlue[2] > 200 && markerBlue[0] < 40,
                    inkW[0] > inkW[1] + 4, air[1] > air[0] + 40, block.join(), [e1, e2, e3].join(), shaky > 20 && steady < shaky / 3, light[0] > 70 && light[0] < 150 && light[1] > 0, brushMenu];
                while (P.history.length > bn) pressKey('z', { ctrlKey: true });
                P.fg = '#ff0000';
                P.setTool('brush'); P.opts.size = 10; P.opts.hardness = hard0;
                // Canvas size: the canvas bigger than the photo, the layers
                // reaching past it; what's painted out there kept, and
                // written (padded) by Export; Crop past the edge adds more;
                // each one step of Undo
                step = 'canvas';
                const lg0 = P.layers[0].canvas;
                const grew = P.setCanvas({ l: 40, t: 0, r: 0, b: 20 }, 'Canvas size');
                const big = [grew, P.W, P.H, P.OW, P.OH, P.ext.l, P.ext.b, P.layers[0].canvas.width, P.fill === P.bg];
                P.fg = '#00ff00'; P.opts.opacity = 100;
                pe('pointerdown', 10, 100); pe('pointerup', 10, 100);
                const painted = px(0, 10, 100)[3];
                P.turnImage(1);
                const at10 = P.C.transformPoint({ x: 10, y: 100 });
                const turned = [JSON.stringify(P.pad), P.OW, P.OH, at10.x > 0 && at10.x < P.OW && at10.y > 0 && at10.y < 40];
                pressKey('z', { ctrlKey: true });
                turned.push(JSON.stringify(P.pad));
                const canvasRec = await P.keep();
                const written = await CropEditor.renderSnapshot(await f.handle.getFile(), { q: 0, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 }, paint: canvasRec }, 'image/png');
                // (the layer file written just for this taken off again)
                const pdir = await Paint.dir(false);
                for (const l of canvasRec.layers) await pdir.removeEntry(Paint.fileName(canvasRec, l));
                const wpx = (x, y) => [...written.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)].join();
                const exported = [written.width, written.height, wpx(10, 100), wpx(20, 315), wpx(200, 100)];
                const onlyPhoto = Paint.padded(c, P.layersNow(), null);
                P.startCrop();
                const cropping = !!P.crop && document.getElementById('paint-options').textContent.includes('Enter crops');
                P.crop = { x0: 0, y0: 0, x1: P.OW + 60, y1: P.OH };
                P.endCrop(true);
                const cropped = [P.OW, P.OH, P.pad.r, P.history[P.history.length - 1].name];
                pressKey('z', { ctrlKey: true });
                const undone1 = P.OW;
                pressKey('z', { ctrlKey: true }); pressKey('z', { ctrlKey: true });
                out.canvas = { big, painted, turned, record: [canvasRec.w, canvasRec.h, JSON.stringify(canvasRec.ext), JSON.stringify(canvasRec.pad), canvasRec.fill], exported, onlyPhoto: [onlyPhoto.width, onlyPhoto.height], cropping, cropped, undone: [undone1, P.W, P.OW, !P.pad, P.layers[0].canvas === lg0] };
                // A pen's pressure sizes the brush
                step = 'pressure';
                const pen = { pointerType: 'pen', pressure: 0.2 };
                pe('pointerdown', 50, 270, pen); pe('pointermove', 100, 270, pen); pe('pointermove', 150, 270, pen); pe('pointerup', 150, 270, pen);
                out.pressure = [px(0, 100, 270)[3], px(0, 100, 273)[3]];
                pressKey('z', { ctrlKey: true });
                // QuickShape: a wobbly line held still at its end becomes a
                // straight one; still held, dragging on takes its end there
                step = 'quickshape';
                P.opts.size = 6; P.opts.quickShape = true;
                pe('pointerdown', 40, 200);
                for (let x = 50; x <= 140; x += 10) pe('pointermove', x, 200 + (x % 20 ? 3 : -3));
                await new Promise(res => setTimeout(res, P.HOLD_MS + 150));
                const snapped = P.drag && P.drag.snap && P.drag.snap.name;
                pe('pointermove', 180, 200);
                pe('pointerup', 180, 200);
                out.quickLine = [snapped, px(0, 110, 200)[3], px(0, 110, 204)[3], px(0, 175, 200)[3]];
                pressKey('z', { ctrlKey: true });
                // A rough circle held becomes a circle (painted on it, not on the wobble)
                pe('pointerdown', 260, 150);
                for (let i = 1; i <= 40; i++) { const a = i / 40 * Math.PI * 2.05; pe('pointermove', 200 + (60 + (i % 3) * 2) * Math.cos(a), 150 + (60 + (i % 3) * 2) * Math.sin(a)); }
                await new Promise(res => setTimeout(res, P.HOLD_MS + 150));
                out.quickCircle = [P.drag && P.drag.snap && P.drag.snap.name];
                pe('pointerup', 200 + 61 * Math.cos(0.1 * Math.PI), 150 + 61 * Math.sin(0.1 * Math.PI));
                out.quickCircle.push(px(0, 200, 89)[3] > 0, px(0, 139, 150)[3] > 0, px(0, 200, 150)[3]);
                pressKey('z', { ctrlKey: true });
                // Off (⋯), a held stroke stays as drawn
                P.opts.quickShape = false;
                pe('pointerdown', 40, 200); pe('pointermove', 90, 204); pe('pointermove', 140, 196);
                await new Promise(res => setTimeout(res, P.HOLD_MS + 150));
                out.quickOff = !(P.drag && P.drag.snap);
                pe('pointerup', 140, 196);
                pressKey('z', { ctrlKey: true });
                P.opts.quickShape = true;
                // The history: each step named; ⋯ → History lists them, and a
                // click (or a drag) on one goes there
                step = 'history';
                const h0 = P.history.length;
                pe('pointerdown', 40, 230); pe('pointermove', 140, 230); pe('pointerup', 140, 230);
                P.setTool('fill'); P.setTool('brush');
                const histMenu = P.moreItems().find(i => i[0] === 'History');
                histMenu[1]();
                const steps = () => [...document.querySelectorAll('#paint-history .paint-step')];
                const histShown = !document.getElementById('paint-history-sec').classList.contains('hidden');
                const lastStep = steps()[steps().length - 1];
                const rowAt = (row, type) => { const b = row.getBoundingClientRect(); row.dispatchEvent(new PointerEvent(type, { clientX: b.left + 5, clientY: b.top + b.height / 2, pointerId: 7, bubbles: true, button: 0 })); };
                const named = lastStep && lastStep.textContent;
                const firstRow = steps()[h0];
                rowAt(firstRow, 'pointerdown'); rowAt(firstRow, 'pointerup');
                const wentBack = [P.history.length === h0, px(0, 90, 230)[3], steps()[h0].getAttribute('aria-selected'), steps()[h0 + 1].classList.contains('paint-step-undone')];
                rowAt(steps()[h0 + 1], 'pointerdown'); rowAt(steps()[h0 + 1], 'pointerup');
                out.history = [histShown, histMenu[3], named, ...wentBack, px(0, 90, 230)[3]];
                histMenu[1]();
                out.historyHidden = document.getElementById('paint-history-sec').classList.contains('hidden');
                // Two fingers tapped undo; three redo. A second finger later on
                // leaves the first painting
                step = 'taps';
                const tp = (type, x, y, id) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: id, pointerType: 'touch', isPrimary: id === 21, bubbles: true, button: 0 }));
                tp('pointerdown', 100, 230, 21); tp('pointerdown', 120, 230, 22);
                tp('pointerup', 100, 230, 21); tp('pointerup', 120, 230, 22);
                const undone = [P.history.length === h0, px(0, 90, 230)[3], px(0, 100, 230)[3]];
                tp('pointerdown', 100, 230, 21); tp('pointerdown', 120, 230, 22); tp('pointerdown', 140, 230, 23);
                tp('pointerup', 100, 230, 21); tp('pointerup', 120, 230, 22); tp('pointerup', 140, 230, 23);
                const redone = [P.history.length === h0 + 1, px(0, 90, 230)[3]];
                tp('pointerdown', 40, 250, 21);
                await new Promise(res => setTimeout(res, P.TAP_JOIN_MS + 50));
                tp('pointerdown', 200, 250, 22);
                tp('pointermove', 140, 250, 21); tp('pointerup', 140, 250, 21); tp('pointerup', 200, 250, 22);
                out.taps = [...undone, ...redone, px(0, 90, 250)[3], P.history.length === h0 + 2];
                pressKey('z', { ctrlKey: true }); pressKey('z', { ctrlKey: true });
                P.opts.size = 20;
                // A rectangle, filled, on a new layer
                step = 'rect';
                pressKey('N', { ctrlKey: true, shiftKey: true });
                out.layers = P.layers.length === 2 && P.cur === 1;
                P.fg = '#00ff00'; P.opts.shapeFill = 'fg'; P.opts.lineWidth = 0;
                P.opts.shapeLayer = false; P.setTool('rect');
                pe('pointerdown', 20, 20); pe('pointermove', 60, 60); pe('pointerup', 60, 60);
                out.rect = [px(1, 40, 40), px(1, 70, 70)[3]];
                // The fill: the blue square, sampled from the photo
                step = 'fill';
                P.fg = '#ffff00'; P.opts.tolerance = 20; P.opts.contiguous = true; P.opts.sampleAll = true;
                P.setTool('fill');
                pe('pointerdown', 300, 100); pe('pointerup', 300, 100);
                out.fill = [px(1, 260, 60), px(1, 240, 100)[3]];
                // Fill: the whole layer, whatever colour is clicked (inside a
                // selection, only there); its colour options go
                step = 'fill whole';
                P.opts.fillWhat = 'layer';
                P.buildOptions();
                out.wholeOpts = !document.querySelector('#paint-options input[type=checkbox]');
                P.fg = '#ff00ff';
                P.setTool('rect-select');
                pe('pointerdown', 10, 250); pe('pointermove', 60, 290); pe('pointerup', 60, 290);
                P.setTool('fill');
                pe('pointerdown', 30, 270); pe('pointerup', 30, 270);
                out.wholeSel = [px(1, 30, 270), px(1, 100, 270)[3]];
                P.deselect();
                pe('pointerdown', 380, 280); pe('pointerup', 380, 280);
                out.whole = [px(1, 5, 5), px(1, 395, 150)];
                pressKey('z', { ctrlKey: true }); pressKey('z', { ctrlKey: true });
                out.wholeUndone = px(1, 5, 5)[3] === 0 && px(1, 260, 60)[0] === 255;
                P.opts.fillWhat = 'match';
                // Text
                step = 'text';
                P.fg = '#000000'; P.opts.fontSize = 40;
                P.setTool('text');
                pe('pointerdown', 20, 230); pe('pointerup', 20, 230);
                await sleep(20);
                const ta = document.getElementById('paint-text');
                ta.value = 'Hi';
                ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
                const tx = P.layer().canvas.getContext('2d').getImageData(15, 230, 60, 50).data;
                let ink = 0; for (let i = 3; i < tx.length; i += 4) if (tx[i] > 128) ink++;
                out.text = ink;
                // (On a layer of its own: taken off again for what follows)
                pressKey('z', { ctrlKey: true });
                // Select a rectangle, Delete: cleared there only
                step = 'select';
                P.setTool('rect-select');
                pe('pointerdown', 250, 50); pe('pointermove', 290, 150); pe('pointerup', 290, 150);
                out.selected = !!P.sel && P.sel.box.w >= 39 && P.sel.box.w <= 41;
                // The ⋯ menu's Select: invert (twice, back again), grow, shrink
                const more = P.moreItems();
                const sub = (n) => (more.find(i => i[0] === n) || [, []])[1];
                out.menu = more.map(i => i[0]).join().startsWith('Image,Select,Layer,Filter,Brushes,View,—,History,QuickShape') && typeof more.find(i => i[0].startsWith('QuickShape'))[3] === 'boolean' && sub('Select').some(i => i[0] === 'Invert') &&
                    sub('Smoothing').map(i => i[0]).join() === 'Off,Some,More,Most' && sub('Pen pressure').filter(i => i[3]).map(i => i[0]).join() === 'Size';
                const w0 = P.sel.box.w;
                P.invertSelection();
                out.inverted = !!P.sel && P.sel.box.w === P.W;
                P.invertSelection();
                await P.growSelection(3);
                const grownW = P.sel.box.w;
                await P.shrinkSelection(3);
                out.reshaped = [grownW - w0, P.sel.box.w - w0];
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
        check('paint: its button; B opens it on the photo', r.button && r.open, JSON.stringify(r));
        check('paint: starts with the photo locked as the bottom layer and a new layer on it', r.start, JSON.stringify(r));
        check('paint: the photo is drawn at screen size once for a view, again when it zooms', r.shownKept && r.shownRedrawn, JSON.stringify([r.shownKept, r.shownRedrawn]));
        check('paint: a brush stroke paints the layer (hard-edged), Ctrl+Z / Ctrl+Shift+Z inside', r.brush && r.brush[0] === 255 && r.brush[3] === 255 && r.brushEdge === 0 && r.undo === 0 && r.redo === 255, JSON.stringify(r));
        check('paint: Image ▸ Rotate right turns the photo (its own edit), the layers with it; Ctrl+Z turns it back', r.imageMenu && JSON.stringify(r.turned) === '[true,true,true,255]' && r.turnUndone, JSON.stringify([r.imageMenu, r.turned, r.turnUndone]));
        check('paint: copy merged takes the photo and the layers; paste in place puts it back where it came from', r.plainClip === 0 && JSON.stringify(r.inPlace) === '["255,0",255,true]', JSON.stringify([r.plainClip, r.inPlace]));
        check('paint: lock transparency paints only over what\'s on the layer', JSON.stringify(r.locked) === '[[0,255,0,255],0,true]', JSON.stringify(r.locked));
        check('paint: Ctrl-click a layer selects its paint; Alt-click an eye shows that layer alone, and again all; a layer\'s right-click menu', r.layerSel && JSON.stringify(r.solo) === '[true,false,false,false]' && r.layerMenu === 'Lock transparency|Lock the layer|Show this layer alone|Select its pixels', JSON.stringify([r.layerSel, r.solo, r.layerMenu]));
        check('paint: Alt with the brush picks the colour under it, with the loupe, and paints nothing', JSON.stringify(r.altPick) === '["#ff0000",true,0]', JSON.stringify(r.altPick));
        check('paint: Alt + right-drag makes the brush bigger (sideways) and softer (down), painting nothing', JSON.stringify(r.altSize) === '[true,true,0,null]', JSON.stringify(r.altSize));
        check('paint: a stroke at 50% opacity covers half, however it overlaps itself', r.half >= 120 && r.half <= 135, JSON.stringify(r));
        check('paint: a stroke shows as it\'s drawn exactly as it goes on (redone only where it reached), and the eraser too', String(r.previewOff) === '0,0', String(r.previewOff));
        check('paint: sizes are the photo\'s own pixels, the same part of each photo (small on a small photo); the size slider spreads small sizes out', JSON.stringify(r.sizes) === '[10,400,200]' && JSON.stringify(r.slider) === '[5,"5"]', JSON.stringify([r.sizes, r.slider]));
        check('paint: the wheel sizes the brush (shown on the photo as it changes), Ctrl+wheel zooms, ] is bigger', String(r.wheel) === 'true,true,true,true' && String(r.ctrlWheel) === 'true,true' && r.bracket, JSON.stringify([r.wheel, r.ctrlWheel, r.bracket]));
        check('paint: Shift-click paints straight on from where the last stroke ended', String(r.shiftLine) === '0,255,0', String(r.shiftLine));
        check('paint: QuickShape: a stroke held at its end snaps to a straight line, its end following the pointer while held', JSON.stringify(r.quickLine) === '["Line",255,0,255]', JSON.stringify(r.quickLine));
        check('paint: QuickShape: a rough circle becomes a circle; off in ⋯, a held stroke stays as drawn', JSON.stringify(r.quickCircle) === '["Circle",true,true,0]' && r.quickOff, JSON.stringify([r.quickCircle, r.quickOff]));
        check('paint: History (⋯) lists each step by name; a click on one goes back to it, the later ones greyed, and on again; off again', JSON.stringify(r.history) === '[true,false,"Brush",true,0,"true",true,255]' && r.historyHidden, JSON.stringify([r.history, r.historyHidden]));
        check('paint: on a touch screen two fingers tapped undo, three redo; a finger put down later leaves the first painting', JSON.stringify(r.taps) === '[true,0,0,true,255,255,true]', JSON.stringify(r.taps));
        check('paint: Recolor turns the colour clicked into the brush colour, light and dark shades alike, nothing else; one undo step; G goes fill, gradient, recolor', JSON.stringify(r.recolor) === '[true,true,true,"32,160,64,255",0,"Recolor","200,32,32,255","gradient,recolor"]', JSON.stringify(r.recolor));
        check('paint: Canvas size makes the canvas bigger than the photo (the layers too, what\'s added the background colour); what\'s painted past the photo is kept, and Export writes the bigger canvas; Crop dragged past the edge adds more; each one step of Undo',
            JSON.stringify(r.canvas) === JSON.stringify({ big: [true, 440, 320, 440, 320, 40, 20, 440, true], painted: 255, turned: ['{"l":20,"t":40,"r":0,"b":0}', 320, 440, true, '{"l":40,"t":0,"r":0,"b":20}'], record: [400, 300, '{"l":40,"t":0,"r":0,"b":20}', '{"l":40,"t":0,"r":0,"b":20}', '#ffffff'], exported: [440, 320, '0,255,0', '255,255,255', '128,128,128'], onlyPhoto: [440, 320], cropping: true, cropped: [500, 320, 60, 'Crop'], undone: [440, 400, 400, true, true] }), JSON.stringify(r.canvas));
        check('paint: heal and clone: clone copies from the Alt-click (nothing without one); heal copies in the colours round it; spot heal fills a mark from round it; one undo each; their own slot; J and S', JSON.stringify(r.heal) === '[true,"true,0",true,"Clone stamp",true,true,"Spot heal",3,"Spot heal|Heal|Clone stamp|Dodge|Burn|Sponge|Blur|Sharpen|Smudge","spot-heal,heal,clone"]', JSON.stringify(r.heal));
        check('paint: tone and focus: dodge lightens, burn darkens, sponge takes colour out, blur softens an edge, sharpen crisps it, smudge drags a colour; in the Heal slot under Tone and Focus; one undo each', JSON.stringify(r.tone) === '[true,true,true,true,true,true,true,"Dodge|Burn|Sponge|Blur|Sharpen|Smudge","Spot heal|Heal|Clone stamp|Tone|Dodge|Burn|Sponge|Focus|Blur|Sharpen|Smudge",true]', JSON.stringify(r.tone));
        check('paint: more brushes: hard and soft rounds; the marker darker where it crosses; ink thinner when fast; the airbrush builds as it\'s held; the block eraser square, E through the erasers; smoothing steadies a shaky line; a pen\'s pressure as opacity; all in the Brush slot', JSON.stringify(r.brushes) === '["true,true",true,true,true,true,true,"0,0,255","eraser-block,eraser-soft,eraser",true,true,"Brush|Soft round|Hard round|Pencil|Ink|Marker|Airbrush|Spray|Painters|Charcoal|Watercolour|Texture brush|Mixer|Retro|Pixel pencil|Spray can|Stamp|Yours|Your brush"]', JSON.stringify(r.brushes));
        check('paint: Retro: the pixel pencil fills one square of its grid; the stamp paints our star (not its corners); the spray can sprays hard dots inside its round; listed under Retro in the brush slot', JSON.stringify(r.retro) === '["255,255,0,0,0","255,0,255,0,Stamp",true,"menu"]', JSON.stringify(r.retro));
        check('paint: a pen\'s pressure sizes the brush', r.pressure && r.pressure[0] > 200 && r.pressure[1] === 0, String(r.pressure));
        check('paint: a new layer; a filled rectangle on it', r.layers && r.rect && r.rect[0][1] === 255 && r.rect[1] === 0, JSON.stringify(r));
        check('paint: the fill takes the photo\'s blue square, not beyond it; text is drawn', r.fill && r.fill[0][0] === 255 && r.fill[0][1] === 255 && r.fill[1] === 0 && r.text > 50, JSON.stringify(r));
        check('paint: the fill can fill the whole layer (only what\'s selected, with a selection), without the colour options; Ctrl+Z undoes it', r.wholeOpts && r.wholeSel && String(r.wholeSel[0]) === '255,0,255,255' && r.wholeSel[1] === 0 && String(r.whole) === '255,0,255,255,255,0,255,255' && r.wholeUndone, JSON.stringify([r.wholeOpts, r.wholeSel, r.whole, r.wholeUndone]));
        check('paint: a selection; Delete clears only inside it', r.selected && r.cleared[0] === 0 && r.cleared[1] === 255, JSON.stringify(r));
        check('paint: the ⋯ menu has Image, Select, Layer, Filter, Brushes and View (and History and QuickShape, ticked when on, Smoothing and Pen pressure); Invert, Grow and Shrink change the selection', r.menu && r.inverted && JSON.stringify(r.reshaped) === '[6,0]', JSON.stringify([r.menu, r.inverted, r.reshaped]));
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
            // Right-click on the canvas: Paint's menu, with the layer's own (audit A3)
            document.getElementById('paint-stage').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
            const paintRows = [...document.querySelectorAll('#context-menu button')].map(b => b.textContent);
            const paintMenu = paintRows.some(t => t.startsWith('Paste')) && paintRows.some(t => t.startsWith('Select all')) && paintRows.some(t => t.startsWith('The layer'));
            app.closeContextMenu();
            P.layers[0].canvas.getContext('2d').fillRect(0, 0, 50, 50);
            P.history.push({ kind: 'px', layer: P.layers[0], r: { x: 0, y: 0, w: 1, h: 1 }, before: new ImageData(1, 1), after: new ImageData(1, 1) });
            await app.savePaint();
            const h = app.files[0].handle;
            await until(() => h.edited);
            return { edited: !!h.edited, noEdit: !app.files[0]._edit, closed: !P.isOpen, paintMenu };
        });
        check('paint: without a project, Done paints it into the photo', p.edited && p.noEdit && p.closed, JSON.stringify(p));
        check('paint: right-click on the canvas has Paste, Select all and the layer\'s menu', p.paintMenu, JSON.stringify(p.paintMenu));

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
                P.opts.shapeLayer = false; P.setTool('rect');
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

        // A tall photo fits on screen as Paint opens (not measured before
        // the film strip is in), and again when the window changes size;
        // zoomed in by hand, it stays as it was
        const fitted = async () => page.evaluate(() => {
            const P = PaintEditor, st = document.getElementById('paint-stage').getBoundingClientRect();
            const top = st.top + P.view.y, bottom = top + P.OH * P.view.z;
            return { z: +P.view.z.toFixed(3), top: Math.round(top), bottom: Math.round(bottom), stage: [Math.round(st.top), Math.round(st.bottom)], inside: top >= st.top - 1 && bottom <= st.bottom + 1 };
        });
        await page.evaluate(async () => {
            const c = document.createElement('canvas'); c.width = 480; c.height = 1200;
            const g = c.getContext('2d'); g.fillStyle = '#4a7'; g.fillRect(0, 0, 480, 1200);
            // (Paint closed first, so ready below is this photo's, not the last one's)
            if (PaintEditor.isOpen) app.cancelPaint();
            await until(() => !PaintEditor.isOpen);
            await openProject('tall', { 'tall.png': await canvasBlob(c, 'image/png') });
            app.openSingle(app.files[0]);
            await sleep(100);
            pressKey('b');
            await until(() => PaintEditor.isOpen && PaintEditor.ready && PaintEditor.file === app.files[0]);
        });
        await page.waitForTimeout(400);
        const fit = { open: await fitted() };
        await page.setViewportSize({ width: 1100, height: 560 });
        await page.waitForTimeout(400);
        fit.smaller = await fitted();
        await page.evaluate(() => PaintEditor.zoomTo(1));
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.waitForTimeout(400);
        fit.zoomed = await fitted();
        check('paint: a tall photo fits as it opens, and again when the window changes size', fit.open.inside && fit.smaller.inside && fit.smaller.z < fit.open.z, JSON.stringify(fit));
        check('paint: zoomed in by hand, a new window size leaves the zoom alone', fit.zoomed.z === 1, JSON.stringify(fit.zoomed));
        await page.evaluate(() => pressKey('Escape'));
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
                // The dialog: a size from the list, turned, in pixels, a colour
                step = 'dialog';
                const made = Blank.open('Art');
                await until(() => !$('blank-panel').classList.contains('hidden'));
                out.name = $('blank-name').value;
                out.where = $('blank-where').value;
                out.noTabs = $('blank-panel').querySelector('.blank-tabs').classList.contains('hidden');
                $('blank-presets').querySelector('[data-key="4x6"]').click();
                out.inches = [$('blank-w').value, $('blank-h').value, $('blank-unit').value, $('blank-dpi').value];
                $('blank-turn').click();
                $('blank-unit').value = 'px';
                $('blank-unit').dispatchEvent(new Event('change'));
                out.dims = [$('blank-w').value, $('blank-h').value, $('blank-presets').querySelector('.on') && $('blank-presets').querySelector('.on').dataset.key];
                $('blank-w').value = '20000';
                $('blank-w').dispatchEvent(new Event('input'));
                out.tooBig = $('blank-go').disabled && /at most/.test($('blank-error').textContent);
                $('blank-w').value = '1800';
                $('blank-w').dispatchEvent(new Event('input'));
                $('blank-color').value = '#336699';
                $('blank-color').dispatchEvent(new Event('input'));
                $('blank-go').click();
                const file = await made;
                step = 'made';
                out.file = file && file.relPath;
                const data = await (await (await sub.getFileHandle('Untitled.png')).getFile());
                const img = await pixels(data);
                out.size = [img.width, img.height];
                out.pixel = [...img.data.slice(0, 4)];
                // Its resolution in the PNG (pHYs, pixels per metre: 300 dpi)
                const bytes = new Uint8Array(await data.arrayBuffer());
                const at = [...bytes.keys()].find(i => bytes[i] === 0x70 && bytes[i + 1] === 0x48 && bytes[i + 2] === 0x59 && bytes[i + 3] === 0x73);
                out.ppm = at ? new DataView(bytes.buffer).getUint32(at + 4) : 0;
                // Opened in Paint
                await until(() => PaintEditor.ready);
                out.inPaint = PaintEditor.isOpen && PaintEditor.file === file;
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
        check('blank: into the folder right-clicked, no Open a file there', r.where === 'Art' && r.noTabs, JSON.stringify(r));
        check('blank: a print size in inches at 300 dpi; turned; in pixels; too big is said', r.name === 'Untitled' && JSON.stringify(r.inches) === '["4","6","in","300"]' && JSON.stringify(r.dims) === '["1800","1200","4x6"]' && r.tooBig, JSON.stringify(r));
        check('blank: saved as a PNG of that size and colour, in the folder, with its resolution', r.file === 'Art/Untitled.png' && JSON.stringify(r.size) === '[1800,1200]' && JSON.stringify(r.pixel) === '[51,102,153,255]' && r.ppm === 11811, JSON.stringify(r));
        check('blank: opened in Paint straight away (Paint turned on for it)', r.inPaint, JSON.stringify(r));
        check('paint: an image dropped on it comes in as a layer of its own, named for it, fitted and floating', r.dropped && r.dropped[0] === 'Layer 1,logo' && r.dropped[1] === 1 && r.dropped[2] === 'move' && r.dropped[3] && r.dropped[4] === 1620, JSON.stringify(r));
        check('paint: Enter puts it down', r.putDown, JSON.stringify(r));
        check('paint: Ctrl+V with an image copied in another app brings it in; Paint\'s own copy when that\'s newer', r.pasted && r.pasted[0] && r.pasted[1] === 3 && r.pasted[2] === 'Pasted' && r.ownPaste, JSON.stringify(r));
        check('paint: what isn\'t an image is said so; Ctrl+Z takes an image off again', r.notImage && r.undone, JSON.stringify(r));
        check('blank: next time, the next name and the same size and background', r.next === 'Untitled-2' && JSON.stringify(r.remembered) === '["1800","1200",true]', JSON.stringify(r));
        check('blank: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint's top: three places (layout 3) ----
    if (wanted('painttop')) {
        console.log('paint\'s top: the file, the options, ⋯ (paint-editor.js: layoutTop)');
        const { page, issues } = await open();
        const look = async () => page.evaluate(async () => {
            await sleep(300);
            const r = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
            const hit = (a, b) => a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
            const row = r('#mode-row'), file = r('.paint-head .mode-file'), opts = r('#paint-options'), more = r('#paint-more'), zoom = r('#paint-zoom'), stage = r('#paint-stage');
            const box = document.getElementById('paint-options');
            return {
                order: !!(file && opts && more && file.r <= opts.l && opts.r <= more.l),
                clear: !hit(row, file) && !hit(file, opts) && !hit(opts, more),
                sameRow: !!(file && opts && more && Math.abs((file.t + file.b) / 2 - (opts.t + opts.b) / 2) < 3 && Math.abs((opts.t + opts.b) / 2 - (more.t + more.b) / 2) < 3),
                zoomAtBottom: !!(zoom && stage && zoom.b <= stage.b && zoom.b > stage.b - 60 && Math.abs((zoom.l + zoom.r) / 2 - (stage.l + stage.r) / 2) < 3),
                undo: !!r('.paint-head .mode-file #paint-undo') && !!r('.paint-head .mode-file #paint-redo'),
                folded: box.querySelectorAll('.paint-fold > *').length,
                fits: box.scrollWidth <= box.clientWidth + 1,
                text: box.textContent
            };
        });
        const setup = await page.evaluate(async () => {
            const c = document.createElement('canvas'); c.width = 600; c.height = 400;
            c.getContext('2d').fillStyle = '#777'; c.getContext('2d').fillRect(0, 0, 600, 400);
            await openProject('top', { 'a_photo_with_a_long_camera_name_IMG_20261101_143207.png': await canvasBlob(c) });
            app.openSingle(app.files[0]);
            await app.enterPaint();
            await until(() => PaintEditor.ready);
            PaintEditor.setTool('heal');
            return true;
        });
        await page.setViewportSize({ width: 1400, height: 820 });
        const wide = await look();
        await page.setViewportSize({ width: 700, height: 820 });
        const narrow = await look();
        // › opens the rest under it; a click elsewhere closes it
        const fold = await page.evaluate(async () => {
            const btn = document.querySelector('.paint-fold-btn'), card = document.querySelector('.paint-fold');
            if (!btn) return null;
            btn.click();
            const open = !card.classList.contains('hidden') && btn.getAttribute('aria-expanded') === 'true';
            document.getElementById('paint-stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            return { open, shut: card.classList.contains('hidden') };
        });
        // Zoom's pill: 100% lights up and the zoom shows once zoomed
        const zoom = await page.evaluate(async () => {
            const P = PaintEditor;
            document.getElementById('paint-zoom-1').click();
            await sleep(50);
            const at1 = document.getElementById('paint-zoom-1').getAttribute('aria-pressed') === 'true';
            P.zoomTo(2);
            P.render();
            const level = document.getElementById('paint-zoom-level').textContent;
            document.getElementById('paint-zoom-fit').click();
            P.render();
            const fit = document.getElementById('paint-zoom-fit').getAttribute('aria-pressed') === 'true';
            app.cancelPaint();
            return { at1, level, fit };
        });
        check('paint top: the file and Undo at the left, after the mode switcher; the options in the middle; ⋯ at the right, one row', setup && wide.order && wide.clear && wide.sameRow && wide.undo, JSON.stringify(wide));
        check('paint top: wide, the heal tool\'s main options in the row, the rest behind ›', wide.fits && wide.folded <= 2 && wide.folded < narrow.folded, JSON.stringify([wide, narrow.folded]));
        check('paint top: narrow, the rest fold behind ›, nothing over anything', narrow.order && narrow.clear && narrow.folded > 0 && narrow.fits && ['Size', 'Hardness', 'Aligned', 'All layers', 'Opacity'].every(t => narrow.text.includes(t)), JSON.stringify(narrow));
        check('paint top: › opens the folded options; a click elsewhere closes them', fold && fold.open && fold.shut, JSON.stringify(fold));
        check('paint top: zoom in a pill at the bottom, in the middle; Fit and 100% lit, the zoom shown', wide.zoomAtBottom && zoom.at1 && zoom.level === '200%' && zoom.fit, JSON.stringify([wide.zoomAtBottom, zoom]));
        check('paint top: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: keys like Photoshop's; a film strip photo dropped in ----
    if (wanted('paintkeys')) {
        console.log('paint keys and the film strip (paint-editor.js, modes.js, script.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const one = (colour) => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, 200, 100); return canvasBlob(c, 'image/png'); };
                await openProject('keys', { 'a.png': await one('#808080'), 'b.png': await one('#0000ff') });
                const a = app.files.find(f => f.name === 'a.png'), b = app.files.find(f => f.name === 'b.png');
                app.openSingle(a);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                // The film strip's other photo, dragged onto the picture: a layer
                step = 'strip';
                const thumb = [...document.querySelectorAll('#paint-editor #thumbnail-strip .thumb-item')].find(t => t._file === b);
                const dt = new DataTransfer();
                thumb.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
                const st = document.getElementById('paint-stage');
                st.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
                st.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                thumb.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
                await until(() => P.float);
                out.strip = [P.layers.map(l => l.name).join(), !!P.float];
                // Arrows move what's floating; Enter puts it down
                const tx = P.float.t.tx;
                pressKey('ArrowRight');
                pressKey('ArrowRight', { shiftKey: true });
                out.floatNudge = P.float.t.tx - tx;
                pressKey('Enter');
                // Alt+[ and Alt+]: the layer below and above; Ctrl+] moves it up
                step = 'layers';
                const names = () => P.layers.map(l => l.name).join();
                pressKey('[', { altKey: true, code: 'BracketLeft' });
                out.below = P.cur;
                pressKey(']', { altKey: true, code: 'BracketRight' });
                out.above = P.cur;
                pressKey('[', { ctrlKey: true, code: 'BracketLeft' });
                out.movedDown = [names(), P.cur];
                pressKey(']', { ctrlKey: true, code: 'BracketRight' });
                out.movedUp = names();
                // Shift+[ (typed as {): softer, a quarter at a time
                step = 'hardness';
                P.setTool('brush');
                P.opts.hardness = 80;
                pressKey('{', { shiftKey: true, code: 'BracketLeft' });
                const h1 = P.opts.hardness;
                pressKey('}', { shiftKey: true, code: 'BracketRight' });
                out.hard = [h1, P.opts.hardness];
                // With Move, arrows nudge the layer's pixels: one step to undo
                step = 'nudge';
                P.cur = 0;
                P.drawLayers();
                const l = P.layers[0], g = l.canvas.getContext('2d');
                g.clearRect(0, 0, P.W, P.H);
                g.fillStyle = '#ff0000';
                g.fillRect(10, 10, 5, 5);
                P.setTool('move');
                const n0 = P.history.length;
                pressKey('ArrowRight');
                pressKey('ArrowDown', { shiftKey: true });
                const px = (x, y) => g.getImageData(x, y, 1, 1).data[3];
                out.moved = [px(10, 10), px(11, 20), px(15, 24), P.history.length - n0];
                pressKey('z', { ctrlKey: true });
                out.undone = [px(10, 10), px(11, 20)];
                // With a select tool, arrows move the outline only
                step = 'outline';
                P.setTool('rect-select');
                const m = P.newCanvas(); m.getContext('2d').fillRect(20, 20, 10, 10);
                P.combineSelection(m, 'new');
                pressKey('ArrowLeft', { shiftKey: true });
                out.outline = [P.sel.box.x, P.sel.box.y, px(10, 10)];
                P.deselect();
                // Nothing to nudge (a brush): the arrows are left alone
                P.setTool('brush');
                out.leftAlone = window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint: a photo dragged from the film strip comes in as a layer', r.strip && r.strip[0] === 'Layer 1,b' && r.strip[1], JSON.stringify(r));
        check('paint: arrows nudge what\'s floating (Shift: 10 px)', r.floatNudge === 11, JSON.stringify(r));
        check('paint: Alt+[ / Alt+] the layer below / above; Ctrl+[ / Ctrl+] move it', r.below === 0 && r.above === 1 && r.movedDown && r.movedDown[0] === 'b,Layer 1' && r.movedDown[1] === 0 && r.movedUp === 'Layer 1,b', JSON.stringify(r));
        check('paint: Shift+[ / Shift+] softer / harder by a quarter', JSON.stringify(r.hard) === '[50,75]', JSON.stringify(r));
        check('paint: with Move, arrows nudge the layer (Shift: 10 px), one step to undo', JSON.stringify(r.moved) === '[0,255,255,1]' && JSON.stringify(r.undone) === '[255,0]', JSON.stringify(r));
        check('paint: with a select tool, arrows move the outline, not the pixels', JSON.stringify(r.outline) === '[10,20,255]', JSON.stringify(r));
        check('paint: with nothing to nudge, the arrows are left alone', r.leftAlone === true, JSON.stringify(r));
        check('paint keys: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: your own brushes (Define brush) ----
    if (wanted('ownbrush')) {
        console.log('paint: your own brushes (paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const W = 400, H = 300;
                const c = document.createElement('canvas'); c.width = W; c.height = H;
                const cg = c.getContext('2d'); cg.fillStyle = '#ffffff'; cg.fillRect(0, 0, W, H);
                // A black bar, 40 × 10, on white: what's dark becomes the tip
                cg.fillStyle = '#000000'; cg.fillRect(30, 30, 40, 10);
                await openProject('brushes', { 'p.png': await canvasBlob(c) });
                localStorage.removeItem('jeditor.paintBrushes');
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                const names = [];
                UI.prompt = async (o) => { names.push(o.title); return 'Bar'; };
                // Nothing selected: said so, nothing kept
                step = 'none';
                out.noSel = await P.defineBrush() === null && !P.ownBrushes().length;
                // What's selected → the tip, cropped to what's dark
                step = 'define';
                const m = P.newCanvas(); m.getContext('2d').fillRect(20, 20, 60, 30);
                P.combineSelection(m, 'new');
                const b = await P.defineBrush();
                const kept = P.ownBrushes();
                const tip = await new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = kept[0].data; });
                out.defined = [!!b, names[0], kept.length, kept[0].name, tip.join('x'), P.tool, P.opts.tip === b.id, P.opts.size];
                // In ⋯ → Brushes and the Brush slot (under Yours); its tip along the top
                step = 'menus';
                const brushes = P.moreItems().find(i => i[0] === 'Brushes')[1];
                out.menu = brushes.map(i => i[0]).join('|');
                out.optTip = [...document.querySelectorAll('#paint-options select')].some(sl => [...sl.options].some(o => o.textContent === 'Bar'));
                // Painting with it: the bar's shape, in the brush colour, wide not tall
                step = 'paint';
                P.deselect();
                const l = P.layers[0], lg = l.canvas.getContext('2d', { willReadFrequently: true });
                lg.clearRect(0, 0, P.W, P.H);
                P.fg = '#00ff00'; P.opts.opacity = 100; P.opts.flow = 100; P.opts.size = 80;
                await sleep(50);
                const st = document.getElementById('paint-stage');
                const at = (x, y) => { const sp = P.V().transformPoint(P.C.transformPoint({ x, y })); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const pe = (type, x, y) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: 1, bubbles: true, button: 0 }));
                pe('pointerdown', 200, 150); pe('pointerup', 200, 150);
                const a = (x, y) => lg.getImageData(x, y, 1, 1).data;
                out.painted = [[...a(200, 150)].join(), a(235, 150)[3] > 0, a(200, 165)[3]];
                // From a picture file: a see-through one gives its shape
                step = 'file';
                const f = document.createElement('canvas'); f.width = 50; f.height = 50;
                const fg = f.getContext('2d'); fg.fillStyle = '#ffffff'; fg.beginPath(); fg.arc(25, 25, 20, 0, Math.PI * 2); fg.fill();
                const b2 = await P.defineBrush(new File([await canvasBlob(f)], 'dot.png', { type: 'image/png' }));
                const t2 = await new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = P.ownBrushes()[1].data; });
                out.fromFile = [!!b2, P.ownBrushes().length, t2.join('x')];
                // Kept between sessions; deleted again
                step = 'delete';
                UI.confirm = async () => true;
                await P.deleteBrush(b.id);
                out.deleted = P.ownBrushes().map(x => x.name).join();
                app.cancelPaint();
                localStorage.removeItem('jeditor.paintBrushes');
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint brushes: nothing selected, nothing made', r.noSel, JSON.stringify(r));
        check('paint brushes: made from what\'s selected, named and kept, cropped to what\'s dark; Your brush picked', r.defined && r.defined[0] && r.defined[1] === 'Name the brush' && r.defined[2] === 1 && r.defined[3] === 'Bar' && r.defined[4] === '40x10' && r.defined[5] === 'custom' && r.defined[6] && r.defined[7] === 40, JSON.stringify(r));
        check('paint brushes: listed in ⋯ → Brushes (with Make and Delete) and as the Tip along the top', r.menu === 'Save the brush as a preset…|—|Make a brush from what\'s selected…|Make a brush from a picture…|—|Bar|—|Delete a brush' && r.optTip, JSON.stringify(r));
        check('paint brushes: it paints its shape in the brush colour', r.painted && r.painted[0] === '0,255,0,255' && r.painted[1] && r.painted[2] === 0, JSON.stringify(r));
        check('paint brushes: from a see-through picture, its shape', r.fromFile && r.fromFile[0] && r.fromFile[1] === 2 && r.fromFile[2] === '40x40', JSON.stringify(r));
        check('paint brushes: deleted again', r.deleted === 'Bar', JSON.stringify(r));
        check('paint brushes: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: the View menu, turning the view, Snap ----
    if (wanted('paintview')) {
        console.log('paint: View, the view turned, Snap (paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 400; c.height = 300;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 400, 300);
                await openProject('view', { 'v.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                const st = document.getElementById('paint-stage');
                const at = (x, y) => { const sp = P.V().transformPoint(P.C.transformPoint({ x, y })); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const pe = (type, x, y, o = {}) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: 1, bubbles: true, button: 0, ...o }));
                // ⋯ → View
                step = 'menu';
                const view = () => P.moreItems().find(i => i[0] === 'View')[1].map(i => i[0]).join('|');
                out.menu = view();
                // > turns the view 15°; a stroke still lands where it's drawn
                step = 'turn';
                pressKey('>');
                pressKey('>');
                out.angle = [P.viewAngle(), !document.getElementById('paint-view-angle').classList.contains('hidden'), (P.render(), document.getElementById('paint-view-angle').textContent)];
                out.menuTurned = view().includes('Put the view straight');
                P.setTool('pencil'); P.fg = '#ff0000'; P.opts.size = 4; P.opts.opacity = 100;
                const l = P.layers[0].canvas.getContext('2d', { willReadFrequently: true });
                pe('pointerdown', 100, 80); pe('pointerup', 100, 80);
                out.painted = [l.getImageData(100, 80, 1, 1).data[0], l.getImageData(100, 80, 1, 1).data[3]];
                // Fitted while turned: the turned picture fits in the stage
                step = 'fit';
                P.fit();
                const rr = P.canvas.getBoundingClientRect();
                const corners = [[0, 0], [P.OW, 0], [0, P.OH], [P.OW, P.OH]].map(([x, y]) => P.V().transformPoint({ x, y }));
                out.fits = corners.every(q => q.x >= 0 && q.y >= 0 && q.x <= rr.width && q.y <= rr.height);
                // Shift-drag with the Hand turns it; a click on the angle puts it straight
                step = 'hand';
                P.setTool('hand');
                const a0 = P.viewAngle();
                const sx = rr.left + rr.width / 2 + 100, sy = rr.top + rr.height / 2;
                st.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, pointerId: 1, bubbles: true, button: 0, shiftKey: true }));
                st.dispatchEvent(new PointerEvent('pointermove', { clientX: rr.left + rr.width / 2, clientY: sy + 100, pointerId: 1, bubbles: true, shiftKey: true }));
                st.dispatchEvent(new PointerEvent('pointerup', { clientX: rr.left + rr.width / 2, clientY: sy + 100, pointerId: 1, bubbles: true, shiftKey: true }));
                out.handTurn = P.viewAngle() - a0;
                document.getElementById('paint-view-angle').click();
                out.straight = [P.viewAngle(), document.getElementById('paint-view-angle').classList.contains('hidden') || (P.render(), document.getElementById('paint-view-angle').classList.contains('hidden'))];
                // Snap: a rectangle selection drawn near the edge starts on it
                step = 'snap';
                P.opts.snap = true;
                P.setTool('rect-select');
                const near = 4 / P.view.z;
                pe('pointerdown', near, near); pe('pointermove', 50, 40); pe('pointerup', 50, 40);
                out.snapped = P.sel && [P.sel.box.x, P.sel.box.y].join();
                P.deselect();
                pressKey(';', { ctrlKey: true });
                out.snapOff = P.opts.snap === false;
                pe('pointerdown', near * 2, near * 2); pe('pointermove', 50, 40); pe('pointerup', 50, 40);
                out.unsnapped = P.sel && P.sel.box.x > 0;
                P.deselect();
                pressKey(';', { ctrlKey: true });
                // What's moved: its edge onto the canvas's
                step = 'float';
                P.setTool('move');
                const m = P.newCanvas(); m.getContext('2d').fillRect(50, 50, 40, 40);
                P.combineSelection(m, 'new');
                pe('pointerdown', 70, 70); pe('pointermove', 70 - 50 + near, 70); pe('pointermove', 70 - 50 + near / 2, 70);
                out.floatSnap = P.float && Math.round(P.float.x0 + P.float.t.tx);
                // ...not from further off, so a small move by an edge can be
                // made; Ctrl held, none; always whole pixels
                pe('pointermove', 70 - 50 + 8 / P.view.z, 70);
                out.floatFar = Math.round(P.float.x0 + P.float.t.tx);
                pe('pointermove', 70 - 50 + near / 2, 70, { ctrlKey: true });
                out.floatFree = P.float.x0 + P.float.t.tx;
                pe('pointermove', 70 - 13.3, 70.6);
                out.floatWhole = [P.float.t.tx, P.float.t.ty];
                pe('pointerup', 70 - 50 + near / 2, 70);
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint view: ⋯ → View has Snap, Rotate left and right, Fit and Actual pixels', r.menu === 'Snap|—|Rotate the view left|Rotate the view right|—|Fit|Actual pixels', JSON.stringify(r));
        check('paint view: > turns the view 15° a time, its angle in the zoom pill, Put the view straight offered', r.angle && r.angle[0] === 30 && r.angle[1] && r.angle[2] === '30°' && r.menuTurned, JSON.stringify(r));
        check('paint view: turned, a stroke lands where it\'s drawn', r.painted && r.painted[0] === 255 && r.painted[1] === 255, JSON.stringify(r));
        check('paint view: turned, Fit fits the turned picture', r.fits, JSON.stringify(r));
        check('paint view: Shift-drag with the Hand turns it; a click on the angle puts it straight', Math.abs(r.handTurn - 90) <= 1 && r.straight && r.straight[0] === 0 && r.straight[1], JSON.stringify(r));
        check('paint view: Snap puts a selection\'s corner on the canvas\'s; Ctrl+; turns it off', r.snapped === '0,0' && r.snapOff && r.unsnapped, JSON.stringify(r));
        check('paint view: what\'s moved snaps its edge onto the canvas\'s', r.floatSnap === 0, JSON.stringify(r));
        check('paint view: what\'s moved snaps only within a few screen pixels; not with Ctrl held; it moves in whole pixels', r.floatFar > 0 && r.floatFree > 0 && r.floatWhole.every(Number.isInteger) && r.floatWhole[0] === -13, JSON.stringify(r));
        check('paint view: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: layer masks ----
    if (wanted('paintmask')) {
        console.log('paint: layer masks (paint-editor.js, paint.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 100;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 200, 100);
                await openProject('masks', { 'm.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                const l = P.layers[0];
                l.canvas.getContext('2d').fillStyle = '#ff0000';
                l.canvas.getContext('2d').fillRect(0, 0, P.W, P.H);
                l.changed = true;
                const shown = (x, y) => P.shownOf(P.layers[0]).getContext('2d').getImageData(x, y, 1, 1).data[3];
                const st = document.getElementById('paint-stage');
                const at = (x, y) => { const sp = P.V().transformPoint(P.C.transformPoint({ x, y })); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const pe = (type, x, y) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: 1, bubbles: true, button: 0 }));
                // ⋯ → Layer → Mask → Add a mask: the mask's thumbnail, being painted on
                step = 'add';
                const sub = (name) => P.moreItems().find(i => i[0] === 'Layer')[1].find(i => i[0] === 'Mask')[1].map(i => i[0]).join('|');
                out.menu0 = sub();
                P.addMask('all');
                out.added = [!!P.layers[0].mask, P.onMask, !!document.querySelector('.paint-mask-thumb.on'), P.fg, sub()];
                // Black on the mask hides; the layer's own pixels are untouched
                step = 'paint';
                P.setTool('pencil'); P.opts.size = 10; P.opts.opacity = 100;
                pe('pointerdown', 50, 50); pe('pointerup', 50, 50);
                out.hidden = [shown(50, 50), shown(150, 50), P.layers[0].canvas.getContext('2d').getImageData(50, 50, 1, 1).data[3]];
                // White shows it again (X swaps); Undo takes the stroke off the mask
                P.swapColours();
                pe('pointerdown', 50, 50); pe('pointerup', 50, 50);
                out.shownAgain = shown(50, 50);
                pressKey('z', { ctrlKey: true });
                out.undone = shown(50, 50);
                // Invert: what showed is hidden
                P.invertMask();
                out.inverted = [shown(50, 50), shown(150, 50)];
                P.invertMask();
                // Saved: the mask a file of its own; drawn over the photo with it
                step = 'keep';
                const rec = await P.keep();
                out.kept = !!rec.layers[0].mask && rec.layers[0].mask !== rec.layers[0].rev;
                const prep = await Paint.prepare({ paint: rec });
                const src = prep.layers[0].src;
                const sc = document.createElement('canvas'); sc.width = src.width; sc.height = src.height;
                sc.getContext('2d').drawImage(src, 0, 0);
                out.prepared = [sc.getContext('2d').getImageData(50, 50, 1, 1).data[3], sc.getContext('2d').getImageData(150, 50, 1, 1).data[3]];
                // Clicking the layer's thumbnail paints on the layer again
                step = 'thumb';
                document.querySelector('.paint-layer canvas:not(.paint-mask-thumb)').click();
                out.onLayer = P.onMask === false && P.target() === P.layers[0];
                // Apply: put into the pixels, the mask gone; Delete on another
                step = 'apply';
                P.applyMask();
                out.applied = [!P.layers[0].mask, P.layers[0].canvas.getContext('2d').getImageData(50, 50, 1, 1).data[3], P.layers[0].canvas.getContext('2d').getImageData(150, 50, 1, 1).data[3]];
                // From the selection: only what's selected shows
                step = 'sel';
                P.addLayer();
                P.layers[1].canvas.getContext('2d').fillRect(0, 0, P.W, P.H);
                const m = P.newCanvas(); m.getContext('2d').fillRect(100, 0, 100, 100);
                P.combineSelection(m, 'new');
                P.addMask('sel');
                const s1 = (x, y) => P.shownOf(P.layers[1]).getContext('2d').getImageData(x, y, 1, 1).data[3];
                out.fromSel = [s1(50, 50), s1(150, 50), !P.sel];
                pressKey('z', { ctrlKey: true });
                out.undoAdd = !P.layers[1].mask;
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint masks: ⋯ → Layer → Mask adds one; its thumbnail shows, painted on, in black and white', r.menu0 === 'Add a mask|Add a mask that hides it all' && r.added && r.added[0] && r.added[1] && r.added[2] && r.added[3] === '#000000' && /Paint on the layer\|Invert the mask\|Apply the mask\|Delete the mask/.test(r.added[4]), JSON.stringify(r));
        check('paint masks: black on the mask hides the layer there, its pixels kept; white shows it again; Undo', JSON.stringify(r.hidden) === '[0,255,255]' && r.shownAgain === 255 && r.undone === 0, JSON.stringify(r));
        check('paint masks: Invert swaps what shows', JSON.stringify(r.inverted) === '[255,0]', JSON.stringify(r));
        check('paint masks: kept as a file of its own, and drawn with it', r.kept && JSON.stringify(r.prepared) === '[0,255]', JSON.stringify(r));
        check('paint masks: the layer\'s thumbnail paints on the layer; Apply puts it into the pixels', r.onLayer && JSON.stringify(r.applied) === '[true,0,255]', JSON.stringify(r));
        check('paint masks: from the selection, only what\'s selected shows; Undo takes it off', JSON.stringify(r.fromSel) === '[0,255,true]' && r.undoAdd, JSON.stringify(r));
        check('paint masks: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: free transform ----
    if (wanted('painttransform')) {
        console.log('paint: free transform (paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 200;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 200, 200);
                await openProject('tf', { 't.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.snap = false;
                const g = P.layers[0].canvas.getContext('2d', { willReadFrequently: true });
                g.fillStyle = '#ff0000'; g.fillRect(80, 80, 40, 40);
                const a = (x, y) => g.getImageData(x, y, 1, 1).data[3];
                // Nothing there: said so
                step = 'empty';
                P.addLayer();
                pressKey('t', { ctrlKey: true });
                out.empty = !P.float;
                // Something small on it: the box fits it, not the canvas
                step = 'fits';
                const g1 = P.layers[1].canvas.getContext('2d');
                g1.fillStyle = '#0000ff'; g1.fillRect(10, 150, 30, 20);
                pressKey('t', { ctrlKey: true });
                out.fits = P.float && [P.float.x0, P.float.y0, P.float.w, P.float.h].join();
                P.cancelFloat();
                g1.clearRect(0, 0, 200, 200);
                P.cur = 0; P.drawLayers();
                // Ctrl+T: lifted, Move picked, its numbers along the top
                step = 'lift';
                P.setTool('brush');
                pressKey('t', { ctrlKey: true });
                const box = document.getElementById('paint-options');
                out.lifted = [!!P.float, P.tool, ['W', 'H', 'Angle', 'Flip ↔', 'Flip ↕', 'Cancel', 'Done'].every(t => box.textContent.includes(t))];
                out.menu = P.moreItems().find(i => i[0] === 'Layer')[1].some(i => i[0] === 'Free transform');
                // A side stretches one way only; the numbers follow
                step = 'edge';
                const st = document.getElementById('paint-stage');
                const sc = (q) => { const sp = P.V().transformPoint(q); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const h = P.floatHandles();
                const e = h.edges.find(x => x[0] === 'e')[1], mid = { x: (h.corners[0][1].x + h.corners[3][1].x) / 2, y: (h.corners[0][1].y + h.corners[3][1].y) / 2 };
                const far = { x: mid.x + (e.x - mid.x) * 1.5, y: e.y };
                st.dispatchEvent(new PointerEvent('pointerdown', { ...sc(e), pointerId: 1, bubbles: true, button: 0 }));
                st.dispatchEvent(new PointerEvent('pointermove', { ...sc(far), pointerId: 1, bubbles: true }));
                st.dispatchEvent(new PointerEvent('pointerup', { ...sc(far), pointerId: 1, bubbles: true }));
                const nums = () => [...box.querySelectorAll('input.paint-tf-num')].map(i => +i.value);
                out.stretched = [Math.round(P.float.t.sx * 100), Math.round(P.float.t.sy * 100), nums().join()];
                // Typed: the angle; Flip ↔ mirrors
                step = 'typed';
                const ang = box.querySelectorAll('input.paint-tf-num')[2];
                ang.value = '90'; ang.dispatchEvent(new Event('change'));
                out.turned = Math.round(P.float.t.rot * 180 / Math.PI);
                [...box.querySelectorAll('button')].find(b => b.textContent === 'Flip ↔').click();
                out.flipped = P.float.t.sx < 0;
                // Cancel puts it back; Done puts it down, one step to undo
                step = 'cancel';
                [...box.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click();
                out.cancelled = [!P.float, a(100, 100), a(130, 100)];
                pressKey('t', { ctrlKey: true });
                P.float.t.sx = 2;
                const n0 = P.history.length;
                [...box.querySelectorAll('button')].find(b => b.textContent === 'Done').click();
                out.done = [!P.float, a(100, 100), a(65, 100), P.history.length - n0];
                pressKey('z', { ctrlKey: true });
                out.undone = [a(65, 100), a(100, 100)];
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint transform: the box fits what\'s on the layer, not the whole canvas', r.fits === '10,150,30,20', JSON.stringify(r.fits));
        check('paint transform: nothing on the layer, nothing lifted', r.empty, JSON.stringify(r));
        check('paint transform: Ctrl+T lifts it with Move, W, H, Angle, flips, Cancel and Done along the top; in ⋯ → Layer', r.lifted && r.lifted[0] && r.lifted[1] === 'move' && r.lifted[2] && r.menu, JSON.stringify(r));
        check('paint transform: a side stretches it one way, the numbers following', r.stretched && r.stretched[0] > 120 && r.stretched[1] === 100 && r.stretched[2] === `${r.stretched[0]},100,0`, JSON.stringify(r));
        check('paint transform: the angle typed turns it; Flip ↔ mirrors it', r.turned === 90 && r.flipped, JSON.stringify(r));
        check('paint transform: Cancel puts it back; Done puts it down, one step to undo', JSON.stringify(r.cancelled) === '[true,255,0]' && r.done && r.done[0] && r.done[1] === 255 && r.done[2] === 255 && r.done[3] === 1 && JSON.stringify(r.undone) === '[0,255]', JSON.stringify(r));
        check('paint transform: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: text layers ----
    if (wanted('painttext')) {
        console.log('paint: text layers (paint-editor.js, paint.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 400; c.height = 300;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 400, 300);
                await openProject('tx', { 't.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.snap = false;
                const st = document.getElementById('paint-stage'), ta = document.getElementById('paint-text');
                const sc = (q) => { const sp = P.V().transformPoint(q); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const click = (q) => {
                    st.dispatchEvent(new PointerEvent('pointerdown', { ...sc(q), pointerId: 1, bubbles: true, button: 0 }));
                    st.dispatchEvent(new PointerEvent('pointerup', { ...sc(q), pointerId: 1, bubbles: true }));
                };
                const type = (v) => { ta.value = v; ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); };
                const alphaIn = (l, x, y, w, h) => { const d = l.canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data; let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i] > 0; return n; };
                // Typed: a layer of its own, named from it, keeping the words
                step = 'new';
                P.setTool('text');
                Object.assign(P.opts, { fontSize: 40, bold: false, italic: false, opacity: 100 });
                P.fg = '#ff0000';
                const n0 = P.layers.length;
                click({ x: 50, y: 50 });
                await sleep(20);
                type('Hi');
                const l = P.layer();
                out.made = [P.layers.length - n0, l.name, l.text && l.text.v, l.text && l.text.color, alphaIn(l, 50, 50, 60, 50) > 50];
                // Kept with the layers, through Paint.clean
                const kept = Paint.clean({ id: 'abc', w: 400, h: 300, layers: [{ id: 'l1', rev: 'r1', name: 'Hi', text: l.text }, { id: 'l2', rev: 'r2', name: 'x', text: { v: 'bad' } }] });
                out.kept = [kept.layers[0].text && kept.layers[0].text.v, kept.layers[0].text && kept.layers[0].text.m.length, 'text' in kept.layers[1]];
                // Clicked again with the Text tool: open with its words, hidden under the box; changed, one step to undo
                step = 'edit';
                P.cur = 0;
                click({ x: 60, y: 60 });
                await sleep(20);
                const wide0 = alphaIn(l, 50, 50, 140, 50);
                out.opened = [!ta.classList.contains('hidden'), ta.value, P.cur, P.text && P.text.layer === l];
                type('Hello');
                const l2 = P.layer();
                out.edited = [P.layers.length - n0, l2.text.v, l2.name, alphaIn(l2, 50, 50, 140, 50) > wide0];
                pressKey('z', { ctrlKey: true });
                out.undone = [P.layer().text.v, P.layer().name];
                pressKey('z', { ctrlKey: true, shiftKey: true });
                // Moved: still text, where it was put
                step = 'move';
                P.setTool('move');
                P.liftFloat();
                P.float.t.tx = 20;
                P.commitFloat();
                out.moved = [!!P.layer().text, Math.round(P.layer().text.m[4]), P.layer().text.v];
                // Painted on: pixels from then on; Undo brings the text back
                step = 'paint';
                P.setTool('brush');
                const a = sc({ x: 300, y: 200 }), b = sc({ x: 340, y: 220 });
                st.dispatchEvent(new PointerEvent('pointerdown', { ...a, pointerId: 1, bubbles: true, button: 0 }));
                st.dispatchEvent(new PointerEvent('pointermove', { ...b, pointerId: 1, bubbles: true }));
                st.dispatchEvent(new PointerEvent('pointerup', { ...b, pointerId: 1, bubbles: true }));
                await sleep(20);
                out.pixels = !P.layer().text;
                pressKey('z', { ctrlKey: true });
                out.back = P.layer().text && P.layer().text.v;
                // Its menu: change it, or make it pixels
                const items = P.layerItems(P.cur).map(i => i[0]);
                out.menu = items.includes('Edit the text') && items.includes('Make it pixels');
                P.rasterize(P.cur);
                out.rasterized = !P.layer().text && !P.layerItems(P.cur).some(i => i[0] === 'Edit the text');
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint text: typed text is a layer of its own, named from it, keeping its words and colour', JSON.stringify(r.made) === '[1,"Hi","Hi","#ff0000",true]', JSON.stringify(r));
        check('paint text: the words are kept with the layers (a bad one dropped)', JSON.stringify(r.kept) === '["Hi",6,false]', JSON.stringify(r));
        check('paint text: the Text tool on it opens it again with its words', r.opened && r.opened[0] && r.opened[1] === 'Hi' && r.opened[2] === 1 && r.opened[3], JSON.stringify(r));
        check('paint text: changed in place and renamed, one step to undo', JSON.stringify(r.edited) === '[1,"Hello","Hello",true]' && JSON.stringify(r.undone) === '["Hi","Hi"]', JSON.stringify(r));
        check('paint text: moved, it stays text', r.moved && r.moved[0] && r.moved[1] === 70 && r.moved[2] === 'Hello', JSON.stringify(r));
        check('paint text: painted on, it\'s pixels; Undo makes it text again', r.pixels && r.back === 'Hello', JSON.stringify(r));
        check('paint text: right-click has Edit the text and Make it pixels', r.menu && r.rasterized, JSON.stringify(r));
        check('paint text: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: shape layers ----
    if (wanted('paintshape')) {
        console.log('paint: shape layers (paint-editor.js, paint.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 400; c.height = 300;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 400, 300);
                await openProject('sh', { 's.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.snap = false;
                const st = document.getElementById('paint-stage');
                const sc = (q) => { const sp = P.V().transformPoint(q); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const drag = (a, b) => {
                    st.dispatchEvent(new PointerEvent('pointerdown', { ...sc(a), pointerId: 1, bubbles: true, button: 0 }));
                    st.dispatchEvent(new PointerEvent('pointermove', { ...sc(b), pointerId: 1, bubbles: true }));
                    st.dispatchEvent(new PointerEvent('pointerup', { ...sc(b), pointerId: 1, bubbles: true }));
                };
                const px = (l, x, y) => [...l.canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data];
                // Drawn: a layer of its own (by default), named for it, keeping the shape
                step = 'new';
                Object.assign(P.opts, { lineWidth: 6, shapeFill: 'none', opacity: 100, shapeLayer: true });
                P.fg = '#ff0000'; P.syncColours();
                P.setTool('rect');
                const n0 = P.layers.length;
                drag({ x: 100, y: 100 }, { x: 200, y: 180 });
                const l = P.layer();
                out.made = [P.layers.length - n0, l.name, l.shape && l.shape.kind, px(l, 100, 140)[0], px(l, 150, 140)[3]];
                out.mark = !!document.querySelector('#paint-layer-list .paint-layer[aria-selected="true"] .paint-layer-kind');
                // Kept with the layers, through Paint.clean (a bad one dropped)
                const kept = Paint.clean({ id: 'abc', w: 400, h: 300, layers: [{ id: 'l1', rev: 'r1', name: 'R', shape: l.shape }, { id: 'l2', rev: 'r2', name: 'x', shape: { kind: 'star' } }] });
                out.kept = [kept.layers[0].shape && kept.layers[0].shape.kind, kept.layers[0].shape && kept.layers[0].shape.stroke, 'shape' in kept.layers[1]];
                // Its tool out, the fill changed: it's filled, one step to undo
                step = 'restyle';
                P.opts.shapeFill = 'fg';
                P.restyle();
                out.filled = [px(P.layer(), 150, 140)[0], P.layer().shape.fill, P.history[P.history.length - 1].name];
                pressKey('z', { ctrlKey: true });
                out.unfilled = [px(P.layer(), 150, 140)[3], P.layer().shape.fill];
                // Chosen again with its tool out: the options show its own
                step = 'load';
                P.cur = 0; P.opts.lineWidth = 1; P.opts.shapeFill = 'bg'; P.buildOptions();
                P.cur = n0; P.buildOptions();
                out.loaded = [P.opts.lineWidth, P.opts.shapeFill];
                // Moved: still a shape, where it was put
                step = 'move';
                P.setTool('move');
                P.liftFloat();
                P.float.t.tx = 30;
                P.commitFloat();
                out.moved = [!!P.layer().shape, Math.round(P.layer().shape.m[4]), px(P.layer(), 130, 140)[0], px(P.layer(), 100, 140)[3]];
                // Painted on: pixels from then on; Undo brings the shape back
                step = 'paint';
                P.setTool('brush');
                drag({ x: 300, y: 250 }, { x: 340, y: 260 });
                await sleep(20);
                out.pixels = !P.layer().shape;
                pressKey('z', { ctrlKey: true });
                out.back = P.layer().shape && P.layer().shape.kind;
                out.menu = P.layerItems(P.cur).some(i => i[0] === 'Make it pixels');
                // New layer off: onto the layer chosen, as before
                step = 'off';
                P.cur = 0;
                P.setTool('line');
                P.opts.shapeLayer = false;
                const n1 = P.layers.length;
                drag({ x: 20, y: 20 }, { x: 80, y: 20 });
                out.off = [P.layers.length - n1, px(P.layers[0], 50, 20)[0]];
                // An arrow keeps its arrow
                P.opts.shapeLayer = true; P.opts.arrow = true;
                drag({ x: 20, y: 250 }, { x: 120, y: 250 });
                out.arrow = [P.layer().shape.kind, P.layer().shape.arrow, P.layer().name];
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint shapes: a rectangle is a layer of its own, marked in the list, keeping the shape', JSON.stringify(r.made) === '[1,"Rectangle","rect",255,0]' && r.mark, JSON.stringify(r));
        check('paint shapes: the shape is kept with the layers (a bad one dropped)', JSON.stringify(r.kept) === '["rect","#ff0000",false]', JSON.stringify(r));
        check('paint shapes: its tool out, a fill changed fills it; one step to undo', r.filled && r.filled[0] === 255 && r.filled[1] === '#ff0000' && r.filled[2] === 'Shape style' && JSON.stringify(r.unfilled) === '[0,null]', JSON.stringify(r));
        check('paint shapes: chosen again, the options show its own line and fill', JSON.stringify(r.loaded) === '[6,"none"]', JSON.stringify(r));
        check('paint shapes: moved, it stays a shape, drawn where it went', r.moved && r.moved[0] && r.moved[1] === 30 && r.moved[2] === 255 && r.moved[3] === 0, JSON.stringify(r));
        check('paint shapes: painted on, it\'s pixels; Undo makes it a shape again', r.pixels && r.back === 'rect' && r.menu, JSON.stringify(r));
        check('paint shapes: New layer off draws onto the layer chosen', JSON.stringify(r.off) === '[0,255]', JSON.stringify(r));
        check('paint shapes: a line keeps its arrow', JSON.stringify(r.arrow) === '["line",true,"Line"]', JSON.stringify(r));
        check('paint shapes: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: clipping, locking the layer, merge visible and flatten ----
    if (wanted('paintlayers')) {
        console.log('paint: clipping masks, Lock the layer, Merge visible, Flatten (paint-editor.js, paint.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 200;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 200, 200);
                await openProject('ly', { 'l.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                const fill = (l, col, x, y, w, h) => { const g = l.canvas.getContext('2d'); g.fillStyle = col; g.fillRect(x, y, w, h); };
                const px = (cv, x, y) => [...cv.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data];
                // Base: a red square; above: blue all over, clipped to it
                step = 'clip';
                fill(P.layers[0], '#ff0000', 50, 50, 100, 100);
                P.addLayer();
                fill(P.layer(), '#0000ff', 0, 0, 200, 200);
                pressKey('g', { ctrlKey: true, altKey: true });
                const top = P.layer();
                out.clipped = [!!top.clip, px(P.shownOf(top), 100, 100)[2], px(P.shownOf(top), 10, 10)[3], !!document.querySelector('#paint-layer-list .paint-layer.clipped .paint-layer-clip')];
                // The base hidden: the clipped one with it
                P.layers[0].hidden = true;
                out.hiddenBase = P.isShown(top);
                P.layers[0].hidden = false;
                // Kept: Paint.clean, and Paint.prepare draws it clipped
                const kept = Paint.clean({ id: 'abc', w: 200, h: 200, layers: [{ id: 'l1', rev: 'r1' }, { id: 'l2', rev: 'r2', clip: true, fixed: true }] });
                out.kept = [kept.layers[1].clip, kept.layers[1].fixed, 'clip' in kept.layers[0]];
                pressKey('z', { ctrlKey: true });
                out.unclipUndo = !P.layer().clip;
                pressKey('z', { ctrlKey: true, shiftKey: true });
                // Lock the layer: the brush leaves it as it was, Move doesn't lift it
                step = 'fixed';
                P.toggleFixed();
                const n0 = P.history.length;
                P.beginPixels(P.layer());
                fill(P.layer(), '#00ff00', 0, 0, 20, 20);
                P.endPixels(P.layer(), { x: 0, y: 0, w: 20, h: 20 });
                out.fixed = [px(P.layer().canvas, 5, 5)[2], P.history.length - n0, P.liftFloat(), P.layerItems(P.cur).find(i => i[0] === 'Lock the layer')[3]];
                P.toggleFixed();
                // Merge visible: the two as they look, one layer; one step to undo
                step = 'merge';
                P.addLayer();
                fill(P.layer(), '#00ff00', 0, 0, 10, 10);
                P.layer().hidden = true;
                const n1 = P.layers.length;
                pressKey('e', { ctrlKey: true, shiftKey: true });
                const m = P.layers.find(l => l.name === 'Merged');
                out.merged = [n1 - P.layers.length, !!m && px(m.canvas, 100, 100)[2], !!m && px(m.canvas, 10, 10)[3], P.layers.some(l => l.hidden)];
                pressKey('z', { ctrlKey: true });
                out.mergeUndo = P.layers.length === n1;
                // Flatten: one layer, the hidden one gone
                P.mergeVisible(true);
                out.flat = [P.layers.length, px(P.layers[0].canvas, 100, 100)[2], px(P.layers[0].canvas, 5, 5)[3]];
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint layers: Ctrl+Alt+G clips a layer to the one below, marked in the list', r.clipped && r.clipped[0] && r.clipped[1] === 255 && r.clipped[2] === 0 && r.clipped[3], JSON.stringify(r));
        check('paint layers: a clipped layer hides with the layer it\'s clipped to; Undo unclips', r.hiddenBase === false && r.unclipUndo, JSON.stringify(r));
        check('paint layers: clip and lock are kept with the layers', JSON.stringify(r.kept) === '[true,true,false]', JSON.stringify(r));
        check('paint layers: Lock the layer keeps paint off it and Move from lifting it', JSON.stringify(r.fixed) === '[255,0,false,true]', JSON.stringify(r));
        check('paint layers: Ctrl+Shift+E merges the layers shown as they look, the hidden one kept; one step to undo', r.merged && r.merged[0] === 1 && r.merged[1] === 255 && r.merged[2] === 0 && r.merged[3] && r.mergeUndo, JSON.stringify(r));
        check('paint layers: Flatten leaves one layer, the hidden one gone', JSON.stringify(r.flat) === '[1,255,0]', JSON.stringify(r));
        check('paint layers: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: skew, distort, perspective; smart layers ----
    if (wanted('paintwarp')) {
        console.log('paint: skew, distort and perspective; transformed layers kept as they were (paint-editor.js, paint.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 200;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 200, 200);
                await openProject('wp', { 'w.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.snap = false;
                const g = P.layers[0].canvas.getContext('2d', { willReadFrequently: true });
                g.fillStyle = '#ff0000'; g.fillRect(50, 50, 100, 100);
                const a = (x, y) => g.getImageData(x, y, 1, 1).data[3];
                const st = document.getElementById('paint-stage'), box = document.getElementById('paint-options');
                const sc = (q) => { const sp = P.V().transformPoint(q); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                // Ctrl-drag a corner: the corners go free (Mode along the top, no W or H)
                step = 'distort';
                pressKey('t', { ctrlKey: true });
                const ne = P.floatHandles().corners.find(x => x[0] === 'ne')[1], to = { x: ne.x - 50, y: ne.y };
                st.dispatchEvent(new PointerEvent('pointerdown', { ...sc(ne), pointerId: 1, bubbles: true, button: 0, ctrlKey: true }));
                st.dispatchEvent(new PointerEvent('pointermove', { ...sc(to), pointerId: 1, bubbles: true, ctrlKey: true }));
                st.dispatchEvent(new PointerEvent('pointerup', { ...sc(to), pointerId: 1, bubbles: true, ctrlKey: true }));
                out.free = [!!P.float.quad, Math.round(P.float.quad[1].x), !!box.querySelector('.paint-tf-mode'), !box.querySelector('input.paint-tf-num')];
                [...box.querySelectorAll('button')].find(b => b.textContent === 'Done').click();
                out.distorted = [a(140, 55), a(67, 67), !!P.layer().src];
                pressKey('z', { ctrlKey: true });
                out.undone = [a(140, 55), !P.layer().src];
                // (the box is what's on the layer: the square, 50 to 150)
                // Perspective: one corner out, its neighbour along the side the other way
                step = 'perspective';
                pressKey('t', { ctrlKey: true });
                P.float.mode = 'perspective';
                const sw = P.floatHandles().corners.find(x => x[0] === 'sw')[1], to2 = { x: sw.x - 30, y: sw.y };
                st.dispatchEvent(new PointerEvent('pointerdown', { ...sc(sw), pointerId: 1, bubbles: true, button: 0 }));
                st.dispatchEvent(new PointerEvent('pointermove', { ...sc(to2), pointerId: 1, bubbles: true }));
                st.dispatchEvent(new PointerEvent('pointerup', { ...sc(to2), pointerId: 1, bubbles: true }));
                out.persp = P.float.quad.map(q => Math.round(q.x)).join();
                P.cancelFloat();
                // Smart: made small then big again, it's as sharp as it was
                step = 'smart';
                pressKey('t', { ctrlKey: true });
                P.float.t.sx = P.float.t.sy = 0.2;
                P.commitFloat();
                pressKey('t', { ctrlKey: true });
                P.float.t.sx = P.float.t.sy = 5;
                P.commitFloat();
                out.sharp = [a(100, 100), a(148, 100), a(152, 100), a(53, 53)];
                // Kept with the layers; painting on it makes it plain pixels
                const kept = Paint.clean({ id: 'abc', w: 200, h: 200, layers: [{ id: 'l1', rev: 'r1', src: { rev: 'sx', w: 200, h0: 200, h: [1, 0, 0, 0, 1, 0, 0, 0, 1] } }, { id: 'l2', rev: 'r2', src: { rev: 'sy', h: [1] } }] });
                out.kept = [!!kept.layers[0].src && kept.layers[0].src.rev, 'src' in kept.layers[1]];
                P.beginPixels(P.layer());
                g.fillRect(0, 0, 5, 5);
                P.endPixels(P.layer(), { x: 0, y: 0, w: 5, h: 5 });
                out.plain = !P.layer().src;
                // A plain slide keeps no copy
                pressKey('z', { ctrlKey: true });
                P.rasterize(0);
                pressKey('t', { ctrlKey: true });
                P.float.t.tx = 5;
                P.commitFloat();
                out.slid = !P.layer().src;
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint warp: Ctrl-drag a corner sets the corners free, with Mode along the top', r.free && r.free[0] && r.free[1] === 100 && r.free[2] && r.free[3], JSON.stringify(r));
        check('paint warp: Done distorts it; Ctrl+Z puts it back', r.distorted && r.distorted[0] === 0 && r.distorted[1] >= 250 && r.distorted[2] && JSON.stringify(r.undone) === '[255,true]', JSON.stringify(r));
        check('paint warp: Perspective moves the neighbour along the side the other way', r.persp === '50,150,180,20', JSON.stringify(r));
        check('paint warp: transformed small then big again, it\'s as sharp as it was', JSON.stringify(r.sharp) === '[255,255,0,255]', JSON.stringify(r));
        check('paint warp: the original is kept with the layers; painting on it makes it plain pixels; a slide keeps no copy', r.kept && r.kept[0] === 'sx' && r.kept[1] === false && r.plain && r.slid, JSON.stringify(r));
        check('paint warp: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: snapping to other layers; R held turns the view ----
    if (wanted('paintsnapr')) {
        console.log('paint: Snap to what\'s on other layers; R held and dragged turns the view (paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 200;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 200, 200);
                await openProject('sn', { 's.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.snap = true;
                P.layers[0].canvas.getContext('2d').fillRect(120, 30, 40, 40);
                P.addLayer();
                step = 'snap';
                const near = 4 / P.view.z;
                const q = P.snapPoint({ ox: 120 + near, oy: 100, x: 0, y: 0 });
                const q2 = P.snapPoint({ ox: 140, oy: 70 - near, x: 0, y: 0 });
                out.snapped = [q.ox, q2.oy, P.snapTargets().xs.includes(160)];
                // R held, dragged: the view turns; let go, the tool's as it was
                step = 'r';
                P.setTool('brush');
                const st = document.getElementById('paint-stage'), rr = P.canvas.getBoundingClientRect();
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
                const cx = rr.left + P.cssW / 2, cy = rr.top + P.cssH / 2;
                st.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx + 100, clientY: cy, pointerId: 1, bubbles: true, button: 0 }));
                st.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy + 100, pointerId: 1, bubbles: true }));
                st.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy + 100, pointerId: 1, bubbles: true }));
                document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', code: 'KeyR', bubbles: true }));
                out.turned = [Math.round(P.viewAngle()), P.tool, P.layers[1].canvas.getContext('2d').getImageData(100, 100, 1, 1).data[3]];
                // Tapped twice: straight again
                for (const k of [0, 1]) {
                    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
                    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', code: 'KeyR', bubbles: true }));
                }
                out.straight = P.viewAngle();
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint snap: points snap to the edges of what\'s on other layers', r.snapped && r.snapped[0] === 120 && r.snapped[1] === 70 && r.snapped[2], JSON.stringify(r));
        check('paint view: R held and dragged turns the view, nothing painted, the tool as it was after', JSON.stringify(r.turned) === '[90,"brush",0]', JSON.stringify(r));
        check('paint view: R tapped twice puts the view straight', r.straight === 0, JSON.stringify(r));
        check('paint snap and R: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: layer groups ----
    if (wanted('paintgroups')) {
        console.log('paint: layer groups (paint-editor.js, paint.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 200;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 200, 200);
                await openProject('gr', { 'g.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                const fill = (l, col, x, y, w, h) => { const g = l.canvas.getContext('2d'); g.fillStyle = col; g.fillRect(x, y, w, h); };
                const px = (cv, x, y) => [...cv.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data];
                // Ctrl+G: a group, its row above its layer; a new layer joins it
                step = 'group';
                fill(P.layers[0], '#ff0000', 0, 0, 50, 50);
                P.addLayer();
                fill(P.layer(), '#0000ff', 100, 100, 50, 50);
                pressKey('g', { ctrlKey: true });
                const gid = P.layer().group;
                P.addLayer();
                fill(P.layer(), '#00ff00', 60, 60, 20, 20);
                const rows = [...document.querySelectorAll('#paint-layer-list .paint-layer')];
                out.made = [!!gid, P.layer().group === gid, rows[0].classList.contains('paint-group-row'), rows[0].textContent.includes('Group 1'), rows.filter(x => x.classList.contains('in-group')).length];
                // Hidden: its layers with it, in the editor and as kept
                step = 'hide';
                P.toggleGroupShown(gid);
                out.hidden = [P.isShown(P.layers[1]), P.isShown(P.layers[0])];
                const kept = Paint.clean({ id: 'abc', w: 200, h: 200, groups: [{ id: gid, name: 'G', hidden: true }, { id: 'zz', name: 'unused' }], layers: [{ id: 'l1', rev: 'r1' }, { id: 'l2', rev: 'r2', group: gid }, { id: 'l3', rev: 'r3', group: 'nope' }] });
                out.kept = [kept.groups.length, kept.groups[0].hidden, kept.layers[1].group === gid, 'group' in kept.layers[2]];
                pressKey('z', { ctrlKey: true });
                out.shownAgain = P.isShown(P.layers[1]);
                // Closed: its layers out of the list
                P.toggleGroupOpen(gid);
                out.closed = document.querySelectorAll('#paint-layer-list .in-group').length;
                P.toggleGroupOpen(gid);
                // Moved down at its edge: out of the group first
                step = 'move';
                P.cur = 1;
                P.moveLayer(-1);
                out.out = [P.layers[1].group, P.layers.length];
                P.moveLayer(1);
                out.back = P.layers[1].group === gid;
                // Ctrl+Shift+G: out, put above the group
                P.cur = 1;
                pressKey('g', { ctrlKey: true, shiftKey: true });
                out.ungrouped = [P.cur, P.layers[2].group, P.layers[1].group === gid];
                P.cur = 1;
                P.groupWithBelow(2);
                // Merge group: one layer in its place, as they looked
                step = 'merge';
                const n0 = P.layers.length;
                P.mergeGroup(gid);
                out.merged = [n0 - P.layers.length, P.layers[1].name, px(P.layers[1].canvas, 120, 120)[2], px(P.layers[1].canvas, 70, 70)[1], !P.groups[gid]];
                pressKey('z', { ctrlKey: true });
                out.mergeUndone = [P.layers.length === n0, !!P.groups[gid]];
                out.menu = P.groupItems(gid).map(i => i[0]).join('|');
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint groups: Ctrl+G groups the layer, its row above; a new layer joins it', JSON.stringify(r.made) === '[true,true,true,true,2]', JSON.stringify(r));
        check('paint groups: hiding a group hides its layers; kept with the layers; one step to undo', JSON.stringify(r.hidden) === '[false,true]' && JSON.stringify(r.kept) === '[1,true,true,false]' && r.shownAgain, JSON.stringify(r));
        check('paint groups: closed, its layers leave the list', r.closed === 0, JSON.stringify(r));
        check('paint groups: moved at its edge, a layer goes out of the group, and back in', JSON.stringify(r.out) === '[null,3]' && r.back, JSON.stringify(r));
        check('paint groups: Ctrl+Shift+G takes a layer out, above the group', JSON.stringify(r.ungrouped) === '[2,null,true]', JSON.stringify(r));
        check('paint groups: Merge group makes one layer of it, as it looked; Undo brings it back', r.merged && r.merged[0] === 1 && r.merged[1] === 'Group 1' && r.merged[2] === 255 && r.merged[3] === 255 && r.merged[4] && JSON.stringify(r.mergeUndone) === '[true,true]', JSON.stringify(r));
        check('paint groups: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: adjustment layers ----
    if (wanted('paintadj')) {
        console.log('paint: adjustment layers (paint-editor.js, paint.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 200;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 200, 200);
                await openProject('aj', { 'a.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.sampleAll = true;
                const shown = (x, y) => { const k = P.newCanvas(); P.compose(k.getContext('2d')); return [...k.getContext('2d').getImageData(x, y, 1, 1).data]; };
                // Invert: what's under it inverted; its mask chosen to paint on
                step = 'invert';
                const n0 = P.layers.length;
                P.addAdjLayer('invert');
                const l = P.layer();
                out.made = [P.layers.length - n0, l.name, l.adj.kind, shown(100, 100)[0], P.target().isMask === true, !document.querySelector('.paint-adj-card')];
                // Black on its mask: not there
                l.mask.getContext('2d').clearRect(0, 0, 50, 50);
                out.masked = [shown(10, 10)[0], shown(100, 100)[0]];
                // Brightness/Contrast: its card; Done is one step to undo
                step = 'bc';
                P.addAdjLayer('bc');
                const card = document.querySelector('.paint-adj-card');
                out.card = !!card && card.textContent.includes('Brightness') && card.textContent.includes('Contrast');
                const bl = P.layer();
                bl.adj = { ...bl.adj, b: 50 };
                const n1 = P.history.length;
                card.querySelector('.paint-adj-done').click();
                out.done = [!document.querySelector('.paint-adj-card'), P.history.length - n1, shown(100, 100)[0]];
                pressKey('z', { ctrlKey: true });
                out.undone = P.layer().adj.b;
                // Kept: Paint.clean keeps it, drops a made-up kind
                const kept = Paint.clean({ id: 'abc', w: 200, h: 200, layers: [{ id: 'l1', rev: 'r1', adj: { kind: 'levels', lo: 10, hi: 5, g: 99 } }, { id: 'l2', rev: 'r2', adj: { kind: 'nope' } }] });
                out.kept = [JSON.stringify(kept.layers[0].adj), 'adj' in kept.layers[1]];
                // As the viewer and Export draw it
                const v = document.createElement('canvas'); v.width = 4; v.height = 4;
                v.getContext('2d').fillStyle = '#808080'; v.getContext('2d').fillRect(0, 0, 4, 4);
                Paint.adjustCanvas(v, { kind: 'invert' }, null, 1);
                out.viewer = v.getContext('2d').getImageData(1, 1, 1, 1).data[0];
                // Can't be moved or clipped
                out.noMove = P.liftFloat() === false;
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint adjustment layers: Invert changes what\'s under it, painted on through its mask', JSON.stringify(r.made) === '[1,"Invert","invert",127,true,true]', JSON.stringify(r));
        check('paint adjustment layers: where its mask is black, it doesn\'t change anything', JSON.stringify(r.masked) === '[128,127]', JSON.stringify(r));
        check('paint adjustment layers: Brightness/Contrast opens its card; Done is one step to undo', r.card && r.done && r.done[0] && r.done[1] === 1 && r.done[2] > 127 + 50 && r.undone === 0, JSON.stringify(r));
        check('paint adjustment layers: kept with the layers, settings kept in range', r.kept && r.kept[0] === '{"kind":"levels","lo":10,"hi":12,"g":10}' && r.kept[1] === false, JSON.stringify(r));
        check('paint adjustment layers: the viewer and Export draw them; nothing to move', r.viewer === 127 && r.noMove, JSON.stringify(r));
        check('paint adjustment layers: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: filters (filter layers) ----
    if (wanted('paintfx')) {
        console.log('paint: filters as layers (paint.js, paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 200;
                const cg = c.getContext('2d');
                cg.fillStyle = '#808080'; cg.fillRect(0, 0, 200, 200);
                cg.fillStyle = '#000000'; cg.fillRect(0, 0, 100, 200);
                cg.fillStyle = '#ffffff'; cg.fillRect(150, 150, 1, 1);
                await openProject('fx', { 'f.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.sampleAll = true;
                const shown = (x, y) => { const k = P.newCanvas(); P.compose(k.getContext('2d')); return k.getContext('2d').getImageData(x, y, 1, 1).data[0]; };
                out.menu = (P.moreItems().find(i => i[0] === 'Filter') || [, []])[1].map(i => i[0]).join('|');
                const tryFx = (kind, set, at) => {
                    P.addAdjLayer(kind);
                    const l = P.layer();
                    Object.assign(l.adj, set);
                    P.closeAdj();
                    const v = at.map(([x, y]) => shown(x, y));
                    P.deleteLayer();
                    return v;
                };
                step = 'gauss';
                P.addAdjLayer('gauss');
                out.card = !!document.querySelector('.paint-adj-card') && document.querySelector('.paint-adj-card').textContent.includes('Radius');
                P.closeAdj(); P.deleteLayer();
                out.gauss = tryFx('gauss', { r: 6 }, [[99, 50], [101, 50], [50, 50]]);
                step = 'motion';
                out.motion = tryFx('motion', { a: 0, d: 30 }, [[99, 50], [50, 50]]);
                step = 'unsharp';
                out.unsharp = tryFx('unsharp', { amt: 200, r: 3, th: 0 }, [[102, 50], [97, 50], [170, 50]]);
                step = 'median';
                out.median = tryFx('median', { r: 1 }, [[150, 150], [151, 151]]);
                step = 'highpass';
                out.highpass = tryFx('highpass', { r: 5 }, [[170, 50], [30, 50], [101, 50]]);
                step = 'noise';
                const n1 = tryFx('noise', { amt: 20 }, [[170, 40], [171, 40], [172, 40]]), n2 = tryFx('noise', { amt: 20 }, [[170, 40], [171, 40], [172, 40]]);
                out.noise = [n1.some(v => v !== 128), n1.join() === n2.join()];
                out.kept = JSON.stringify(Paint.cleanAdj({ kind: 'motion', a: 999, d: 0 }));
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint filters: ⋯ → Filter has the six, each a layer with its settings card', r.menu === 'Gaussian blur…|Motion blur…|Unsharp mask…|Add noise…|Median…|High pass…' && r.card, JSON.stringify(r));
        check('paint filters: Gaussian blur softens an edge, leaving flat parts', r.gauss && r.gauss[0] > 5 && r.gauss[1] < 125 && r.gauss[2] === 0, JSON.stringify(r));
        check('paint filters: Motion blur smears across', r.motion && r.motion[0] > 20 && r.motion[1] === 0, JSON.stringify(r));
        check('paint filters: Unsharp mask makes an edge stand out', r.unsharp && r.unsharp[0] > 140 && r.unsharp[1] === 0 && r.unsharp[2] === 128, JSON.stringify(r));
        check('paint filters: Median takes out a speck', r.median && r.median[0] === 128, JSON.stringify(r));
        check('paint filters: High pass leaves flat parts grey, edges not', r.highpass && r.highpass[0] === 128 && r.highpass[1] === 128 && r.highpass[2] > 140, JSON.stringify(r));
        check('paint filters: Add noise adds grain, the same each time it\'s drawn', r.noise && r.noise[0] && r.noise[1], JSON.stringify(r));
        check('paint filters: settings kept in range', r.kept === '{"kind":"motion","a":180,"d":1}', JSON.stringify(r));
        check('paint filters: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: arrow, rounded rectangle, polygon; fill styles ----
    if (wanted('paintshapes2')) {
        console.log('paint: arrow, rounded rectangle and polygon, Outline / Filled / Outline and fill (paint-editor.js, paint.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 400; c.height = 300;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 400, 300);
                await openProject('s2', { 's.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.snap = false;
                const st = document.getElementById('paint-stage');
                const sc = (q) => { const sp = P.V().transformPoint(q); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const down = (q) => st.dispatchEvent(new PointerEvent('pointerdown', { ...sc(q), pointerId: 1, bubbles: true, button: 0 }));
                const up = (q) => st.dispatchEvent(new PointerEvent('pointerup', { ...sc(q), pointerId: 1, bubbles: true }));
                const drag = (a, b) => { down(a); st.dispatchEvent(new PointerEvent('pointermove', { ...sc(b), pointerId: 1, bubbles: true })); up(b); };
                const px = (l, x, y) => [...l.canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data];
                Object.assign(P.opts, { lineWidth: 4, opacity: 100, shapeLayer: true, shapeFill: 'none', corner: 30 });
                P.fg = '#ff0000'; P.bg = '#0000ff'; P.syncColours();
                out.slot = P.GROUPS.find(g => g.includes('rect')).join();
                // Arrow: a line with its head
                step = 'arrow';
                P.setTool('arrow');
                drag({ x: 20, y: 150 }, { x: 120, y: 150 });
                out.arrow = [P.layer().name, P.layer().shape.kind, P.layer().shape.arrow, px(P.layer(), 108, 154)[3] > 0, px(P.layer(), 60, 154)[3] === 0];
                // Rounded rectangle, Outline and fill: its corner cut round, filled with the background colour
                step = 'round';
                P.setTool('roundrect');
                P.opts.shapeFill = 'bg';
                out.style = [...document.querySelectorAll('#paint-options select')].some(s => [...s.options].map(o => o.text).join() === 'Outline,Filled,Outline and fill');
                drag({ x: 150, y: 30 }, { x: 350, y: 130 });
                const rl = P.layer();
                out.round = [rl.shape.kind, rl.shape.rad, px(rl, 151, 31)[3], px(rl, 250, 80)[2], px(rl, 250, 31)[0]];
                // Polygon: clicks, then a double-click closes it
                step = 'poly';
                P.setTool('polygon');
                P.opts.shapeFill = 'fg';
                for (const q of [{ x: 40, y: 200 }, { x: 140, y: 200 }, { x: 90, y: 280 }]) { down(q); up(q); }
                out.open = !!P.poly && P.poly.pts.length === 3;
                st.dispatchEvent(new MouseEvent('dblclick', { ...sc({ x: 90, y: 280 }), bubbles: true }));
                const pl = P.layer();
                out.poly = [!P.poly, pl.shape.kind, pl.shape.pts.length, px(pl, 90, 220)[0], px(pl, 20, 280)[3]];
                // Esc lets one go; clicking the first corner closes one too
                for (const q of [{ x: 200, y: 200 }, { x: 260, y: 200 }]) { down(q); up(q); }
                pressKey('Escape');
                out.esc = !P.poly;
                const n0 = P.layers.length;
                for (const q of [{ x: 200, y: 200 }, { x: 260, y: 200 }, { x: 230, y: 260 }, { x: 200, y: 200 }]) { down(q); up(q); }
                out.closed = [!P.poly, P.layers.length - n0];
                // Kept through Paint.clean
                const kept = Paint.clean({ id: 'abc', w: 400, h: 300, layers: [{ id: 'l1', rev: 'r1', shape: pl.shape }, { id: 'l2', rev: 'r2', shape: rl.shape }] });
                out.kept = [kept.layers[0].shape.pts.length, kept.layers[1].shape.rad];
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint shapes: the Shapes slot has line, arrow, rectangle, rounded rectangle, ellipse and polygon', r.slot === 'line,arrow,rect,roundrect,ellipse,polygon', JSON.stringify(r));
        check('paint shapes: the Arrow draws a line with its head', JSON.stringify(r.arrow) === '["Arrow","arrow",true,true,true]', JSON.stringify(r));
        check('paint shapes: Style is Outline, Filled or Outline and fill; a rounded rectangle\'s corner is round, filled with the background colour', r.style && JSON.stringify(r.round) === '["roundrect",30,0,255,255]', JSON.stringify(r));
        check('paint shapes: a polygon from clicks, closed with a double-click, Filled', r.open && JSON.stringify(r.poly) === '[true,"polygon",3,255,0]', JSON.stringify(r));
        check('paint shapes: Esc lets a polygon go; the first corner again closes it', r.esc && JSON.stringify(r.closed) === '[true,1]', JSON.stringify(r));
        check('paint shapes: polygons and rounded rectangles are kept with the layers', JSON.stringify(r.kept) === '[3,30]', JSON.stringify(r));
        check('paint shapes: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    if (wanted('painttext2')) {
        console.log('paint: text lined up left, centre or right, with an outline (paint-editor.js, paint.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 400; c.height = 300;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 400, 300);
                await openProject('t2', { 't.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.setTool('text');
                out.opts = [...document.querySelectorAll('#paint-options .paint-opt > span')].map(x => x.textContent).filter(x => ['Align', 'Outline'].includes(x)).join();
                Object.assign(P.opts, { fontSize: 40, opacity: 100, align: 'right', outline: 3, bold: true });
                P.fg = '#ff0000'; P.bg = '#00ff00'; P.syncColours();
                step = 'type';
                P.text = { ox: 20, oy: 20, rot: 0, k: 1 };
                P.openTextBox('');
                const ta = document.getElementById('paint-text');
                ta.value = 'WWWWWW\nI';
                P.positionText();
                out.box = [ta.style.textAlign, !!ta.style.webkitTextStroke];
                P.endText(true);
                const l = P.layer(), t = l.text;
                out.rec = [t.align, t.outline, t.ocolor];
                // The short line sits at the right of the long one; green round the letters
                const g = l.canvas.getContext('2d', { willReadFrequently: true });
                const M = P.textM(t), w = P.textSize(t).w;
                const at = (x, y) => { const q = M.transformPoint({ x, y }); return [...g.getImageData(Math.round(q.x), Math.round(q.y), 1, 1).data]; };
                const row = (y, x0, x1) => { const hits = []; for (let x = x0; x <= x1; x++) { const d = at(x, y); if (d[3] > 200 && d[0] > 200) hits.push(x); } return hits; };
                const second = row(68, -5, w + 5);
                out.right = second.length > 0 && Math.min(...second) > w * 0.6;
                let green = false;
                for (let x = -6; x < w + 6 && !green; x++) for (let y = 0; y < 50 && !green; y++) { const d = at(x, y); if (d[1] > 200 && d[0] < 60 && d[3] > 200) green = true; }
                out.green = green;
                step = 'reopen';
                Object.assign(P.opts, { align: 'left', outline: 0 });
                P.editText(P.cur);
                out.back = [P.opts.align, P.opts.outline, P.bg];
                P.endText(true);
                // Old text (no align or outline) unchanged; kept through Paint.clean
                const kept = Paint.clean({ id: 'abc', w: 400, h: 300, layers: [{ id: 'l1', rev: 'r1', text: t }, { id: 'l2', rev: 'r2', text: { ...t, align: 'up', outline: 999 } }] });
                out.kept = [kept.layers[0].text.align, kept.layers[0].text.outline, kept.layers[0].text.ocolor, 'align' in kept.layers[1].text, 'outline' in kept.layers[1].text];
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint text: Align and Outline are the Text tool\'s options', r.opts === 'Align,Outline', JSON.stringify(r));
        check('paint text: the box being typed in shows the alignment and outline', JSON.stringify(r.box) === '["right",true]', JSON.stringify(r));
        check('paint text: the text layer keeps its alignment and outline (in the background colour)', JSON.stringify(r.rec) === '["right",3,"#00ff00"]', JSON.stringify(r));
        check('paint text: lined up right, a short line sits at the right; the outline is round the letters', r.right && r.green, JSON.stringify(r));
        check('paint text: opened again, the options are the text\'s', JSON.stringify(r.back) === '["right",3,"#00ff00"]', JSON.stringify(r));
        check('paint text: alignment and outline are kept with the layers, and bad ones dropped', JSON.stringify(r.kept) === '["right",3,"#00ff00",false,false]', JSON.stringify(r));
        check('paint text: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    if (wanted('paintpuff')) {
        console.log('paint: Undo and Redo puff what changed, not with Animations off (paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 400; c.height = 300;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 400, 300);
                await openProject('pf', { 'p.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor, root = document.documentElement;
                delete root.dataset.motion;
                const fill = () => { P.pushState('Red'); const l = P.makeLayer('Red'); const g = l.canvas.getContext('2d'); g.setTransform(P.extM()); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 100, 100); P.layers.push(l); P.cur = P.layers.length - 1; P.afterState(); P.render(); };
                step = 'undo';
                fill();
                P.undo();
                const pf = document.querySelector('#paint-stage .paint-puff');
                out.puff = !!pf && pf.getAttribute('aria-hidden') === 'true';
                // Only what changed is on it: the red square, not the rest
                if (pf) {
                    const g = pf.getContext('2d'), dpr = P.dpr || 1;
                    const s = P.V().transformPoint({ x: 50, y: 50 }), o = P.V().transformPoint({ x: 300, y: 250 });
                    out.only = [g.getImageData(Math.round(s.x * dpr), Math.round(s.y * dpr), 1, 1).data[3] > 0, g.getImageData(Math.round(o.x * dpr), Math.round(o.y * dpr), 1, 1).data[3]];
                }
                await new Promise(res => setTimeout(res, 450));
                out.gone = !document.querySelector('#paint-stage .paint-puff');
                step = 'redo';
                P.redo();
                out.redo = !!document.querySelector('#paint-stage .paint-puff');
                await new Promise(res => setTimeout(res, 450));
                step = 'off';
                root.dataset.motion = 'off';
                P.undo();
                out.off = !document.querySelector('#paint-stage .paint-puff');
                delete root.dataset.motion;
                P.redo();
                await new Promise(res => setTimeout(res, 450));
                // Going along the history doesn't puff
                P.goTo(0);
                out.batch = !document.querySelector('#paint-stage .paint-puff');
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint puff: Undo puffs what it took away', r.puff, JSON.stringify(r));
        check('paint puff: only the part that changed is on it', JSON.stringify(r.only) === '[true,0]', JSON.stringify(r));
        check('paint puff: it goes once it has puffed', r.gone, JSON.stringify(r));
        check('paint puff: Redo puffs too', r.redo, JSON.stringify(r));
        check('paint puff: none with Settings → Animations off', r.off, JSON.stringify(r));
        check('paint puff: none going along the history', r.batch, JSON.stringify(r));
        check('paint puff: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Paint: the painters' brushes, tilt, presets (paint-editor.js) ----
    if (wanted('paintbrush2')) {
        console.log('paint: charcoal, watercolour, texture, mixer, tilt, presets (paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const W = 400, H = 300;
                const c = document.createElement('canvas'); c.width = W; c.height = H;
                c.getContext('2d').fillStyle = '#ffffff'; c.getContext('2d').fillRect(0, 0, W, H);
                await openProject('brushes2', { 'p.png': await canvasBlob(c) });
                localStorage.removeItem('jeditor.paintPresets');
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.quickShape = false; P.opts.smoothing = 0; P.opts.pressure = 'size';
                const l = P.layers[0], lg = l.canvas.getContext('2d', { willReadFrequently: true });
                const st = document.getElementById('paint-stage');
                const at = (x, y) => { const sp = P.V().transformPoint(P.C.transformPoint({ x, y })); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const pe = (type, x, y, more = {}) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: 1, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...more }));
                const line = (x0, x1, y, more) => { pe('pointerdown', x0, y, more); for (let x = x0; x <= x1; x += 4) pe('pointermove', x, y, more); pe('pointerup', x1, y, more); };
                const a = (x, y) => [...lg.getImageData(x, y, 1, 1).data];
                const clear = () => lg.clearRect(0, 0, P.W, P.H);
                // In the Brush slot, under their own heading
                step = 'slot';
                out.slot = ['charcoal', 'watercolour', 'texture', 'mixer'].every(t => P.GROUPS[2].includes(t)) && P.HEADINGS.charcoal === 'Painters';
                // Charcoal: grainy, some of the paper showing through
                step = 'charcoal';
                clear(); P.setTool('charcoal'); P.fg = '#000000'; P.opts.size = 40; P.opts.opacity = 100;
                line(60, 340, 150);
                let full = 0, none = 0;
                for (let x = 100; x < 300; x++) { const v = a(x, 150)[3]; if (v > 200) full++; if (v < 90) none++; }
                out.charcoal = [full, none];
                // The texture brush: through canvas, its weave showing
                step = 'texture';
                clear(); P.setTool('texture'); P.opts.texture = 'canvas'; P.opts.hardness = 100; P.opts.flow = 100;
                out.textureOpt = [...document.querySelectorAll('#paint-options select')].some(sl => [...sl.options].some(o => o.textContent === 'Paper'));
                line(60, 340, 150);
                const vals = new Set();
                for (let x = 100; x < 140; x++) vals.add(a(x, 150)[3] >> 5);
                out.texture = vals.size;
                // Watercolour: one dab, darker at its edge than in its middle
                step = 'watercolour';
                clear(); P.setTool('watercolour'); P.opts.size = 100; P.opts.flow = 100;
                pe('pointerdown', 200, 150); pe('pointerup', 200, 150);
                out.water = [a(200, 150)[3], a(239, 150)[3]];
                // The mixer: red into blue, then the blue carried into yellow
                step = 'mixer';
                clear(); lg.fillStyle = '#0000ff'; lg.fillRect(0, 0, 150, H); lg.fillStyle = '#ffff00'; lg.fillRect(150, 0, W, H);
                P.setTool('mixer'); P.fg = '#ff0000'; P.opts.size = 30; P.opts.wet = 60; P.opts.hardness = 100;
                line(40, 260, 150);
                out.mixer = [a(42, 150), a(165, 150)];
                // Tilt: a pen leaning sideways lays the round on its side
                step = 'tilt';
                clear(); P.setTool('hard-round'); P.fg = '#000000'; P.opts.size = 40;
                const pen = { pointerType: 'pen', pressure: 1, tiltX: 60, tiltY: 0 };
                pe('pointerdown', 200, 150, pen); pe('pointerup', 200, 150, pen);
                out.tilt = [a(235, 150)[3], a(200, 175)[3], a(200, 160)[3]];
                clear();
                pe('pointerdown', 200, 150, { ...pen, tiltX: 0 }); pe('pointerup', 200, 150, { ...pen, tiltX: 0 });
                out.upright = [a(235, 150)[3], a(200, 160)[3]];
                // Presets: the brush and its settings, saved, used, deleted
                step = 'presets';
                P.setTool('texture'); P.opts.size = 33; P.opts.texture = 'paper'; P.opts.hardness = 40;
                const b = await P.savePreset('Rough');
                P.setTool('brush'); P.opts.size = 10; P.opts.texture = 'canvas';
                const menu = () => P.moreItems().find(i => i[0] === 'Brushes')[1].map(i => i[0]).join('|');
                out.menu = menu();
                P.usePreset(b.id);
                out.used = [P.tool, P.opts.size, P.opts.texture, P.opts.hardness, 'fg' in b.opts, 'texture' in b.opts];
                UI.confirm = async () => true;
                await P.deletePreset(b.id);
                out.deleted = P.presets().length;
                app.cancelPaint();
                localStorage.removeItem('jeditor.paintPresets');
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        const R = JSON.stringify(r);
        check('paint brushes 2: charcoal, watercolour, texture and mixer in the Brush slot, under Painters', r.slot, R);
        check('paint brushes 2: charcoal is grainy (paper shows through a stroke)', r.charcoal && r.charcoal[0] > 20 && r.charcoal[1] > 20, R);
        check('paint brushes 2: the texture brush paints through its texture, chosen along the top', r.textureOpt && r.texture >= 3, R);
        check('paint brushes 2: watercolour pools at its edge', r.water && r.water[1] > r.water[0] && r.water[0] > 0, R);
        check('paint brushes 2: the mixer blends its red with the blue under it, and carries the blue on into yellow', r.mixer && r.mixer[0][0] > 40 && r.mixer[0][2] > 40 && r.mixer[1][2] > 40 && r.mixer[1][1] > 40, R);
        check('paint brushes 2: a pen tilted lays the brush on its side; upright, round', r.tilt && r.tilt[0] > 0 && r.tilt[1] === 0 && r.tilt[2] > 0 && r.upright[0] === 0 && r.upright[1] > 0, R);
        check('paint brushes 2: presets saved, listed in ⋯ → Brushes, used (tool and settings, not the colour), deleted', /^Save the brush as a preset…\|—\|Rough\|Delete a preset\|—\|/.test(r.menu || '') && JSON.stringify(r.used) === '["texture",33,"paper",40,false,true]' && r.deleted === 0, R);
        check('paint brushes 2: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    if (wanted('paintsym')) {
        console.log('paint: symmetry (paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const W = 400, H = 300;
                const c = document.createElement('canvas'); c.width = W; c.height = H;
                c.getContext('2d').fillStyle = '#ffffff'; c.getContext('2d').fillRect(0, 0, W, H);
                await openProject('symmetry', { 'p.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.quickShape = false; P.opts.smoothing = 0; P.opts.pressure = 'size';
                const l = P.layers[0], lg = l.canvas.getContext('2d', { willReadFrequently: true });
                const st = document.getElementById('paint-stage');
                const at = (x, y) => { const sp = P.V().transformPoint(P.C.transformPoint({ x, y })); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const pe = (type, x, y, more = {}) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: 1, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...more }));
                const dot = (x, y) => { pe('pointerdown', x, y); pe('pointerup', x, y); };
                const a = (x, y) => lg.getImageData(x, y, 1, 1).data[3];
                const clear = () => lg.clearRect(0, 0, P.W, P.H);
                P.setTool('hard-round'); P.fg = '#000000'; P.opts.size = 10; P.opts.opacity = 100;
                // In ⋯, with its choices
                step = 'menu';
                const m = P.moreItems().find(i => i[0] === 'Symmetry');
                out.menu = m ? m[1].map(i => i[0]).join('|') : null;
                // Off: one dab
                step = 'off';
                clear(); P.setSymmetry('off'); dot(50, 150);
                out.off = [a(50, 150), a(350, 150)];
                // Left and right
                step = 'x';
                clear(); m[1][1][1](); dot(50, 100);
                out.x = [P.opts.symmetry, a(50, 100), a(350, 100), a(50, 200)];
                // Both ways: all four corners
                step = 'xy';
                clear(); P.setSymmetry('xy'); dot(50, 50);
                out.xy = [a(50, 50), a(350, 50), a(50, 250), a(350, 250)];
                // Round, 4 times: a quarter turn round the middle each
                step = 'r4';
                clear(); P.setSymmetry('r4'); dot(100, 150);
                out.r4 = [a(100, 150), a(200, 50), a(300, 150), a(200, 250), a(350, 150)];
                // A stroke's mirrored too, and one Undo takes both
                step = 'stroke';
                clear(); P.setSymmetry('x');
                pe('pointerdown', 40, 120); for (let x = 40; x <= 120; x += 4) pe('pointermove', x, 120); pe('pointerup', 120, 120);
                out.stroke = [a(80, 120), a(320, 120)];
                P.undo();
                out.undo = [a(80, 120), a(320, 120)];
                // Kept for next time
                out.kept = JSON.parse(localStorage.getItem('jeditor.paint')).symmetry;
                P.setSymmetry('off');
                return out;
            } catch (e) { return { error: step + ': ' + e.message }; }
        });
        check('paint: symmetry is in ⋯', r.menu === 'Off|Left and right|Top and bottom|Both ways|Round, 3 times|Round, 4 times|Round, 6 times|Round, 8 times', r.menu || r.error);
        check('paint: symmetry off paints one dab', r.off && r.off[0] > 200 && r.off[1] === 0, JSON.stringify(r.off));
        check('paint: left and right mirrors a dab', r.x && r.x[0] === 'x' && r.x[1] > 200 && r.x[2] > 200 && r.x[3] === 0, JSON.stringify(r.x));
        check('paint: both ways paints all four corners', r.xy && r.xy.every(v => v > 200), JSON.stringify(r.xy));
        check('paint: round 4 times turns a dab round the middle', r.r4 && r.r4.slice(0, 4).every(v => v > 200) && r.r4[4] === 0, JSON.stringify(r.r4));
        check('paint: a stroke is mirrored, and one Undo takes both', r.stroke && r.stroke.every(v => v > 200) && r.undo.every(v => v === 0), JSON.stringify([r.stroke, r.undo]));
        check('paint: symmetry is kept', r.kept === 'x', r.kept);
        check('paint: symmetry, no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    if (wanted('paintgrow')) {
        console.log('paint: layers grow past the canvas to keep what\'s moved there (paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 150;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 200, 150);
                await openProject('grow', { 'g.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.snap = false;
                const L = () => P.layers[P.cur];
                const a = (x, y) => L().canvas.getContext('2d', { willReadFrequently: true }).getImageData(x + P.ext.l, y + P.ext.t, 1, 1).data[3];
                L().canvas.getContext('2d').fillStyle = '#ff0000';
                L().canvas.getContext('2d').fillRect(10, 10, 30, 30);
                const z0 = P.view.z;
                // Moved half off the left edge: the layer grows to keep it
                step = 'out';
                pressKey('t', { ctrlKey: true });
                P.float.t.tx = -25;
                P.commitFloat();
                out.out = [P.ext.l, P.W, P.OW, a(-14, 20), a(14, 20), P.view.z === z0, P.history.length];
                // Back in: all of it's there
                step = 'in';
                pressKey('t', { ctrlKey: true });
                P.float.t.tx = 25;
                P.commitFloat();
                out.back = [a(10, 10), a(39, 39), a(9, 20), a(40, 20)];
                // Undo goes back through both, one step each
                step = 'undo';
                P.undo(); P.undo(); P.undo();
                out.undone = [P.ext.l, P.W, a(10, 10), a(39, 39), a(-5, 20)];
                P.redo(); P.redo();
                out.redone = [P.ext.l, a(-14, 20), a(14, 20)];
                // Kept with the layers past the canvas; the canvas the same size
                step = 'keep';
                const paint = await P.keep();
                out.kept = [paint.ext && paint.ext.l, !paint.pad];
                // A canvas made bigger later shows it
                step = 'canvas';
                P.setCanvas({ l: 30, t: 0, r: 0, b: 0 });
                out.canvas = [P.ext.l, P.OW, a(-14, 20)];
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint grow: moved past the canvas\'s edge, the layer grows to keep it, the canvas and view the same', r.out && r.out[0] === 15 && r.out[1] === 215 && r.out[2] === 200 && r.out[3] === 255 && r.out[4] === 255 && r.out[5], JSON.stringify(r));
        check('paint grow: moved back in, all of it\'s there', r.back && r.back.join() === '255,255,0,0', JSON.stringify(r));
        check('paint grow: Undo and Redo go through the growing and the move', r.undone && r.undone.join() === '0,200,255,255,0' && r.redone && r.redone.join() === '15,255,255', JSON.stringify(r));
        check('paint grow: kept with the layers, the canvas unchanged', r.kept && r.kept.join() === '15,true', JSON.stringify(r));
        check('paint grow: a bigger canvas shows what was past its edge', r.canvas && r.canvas[0] === 30 && r.canvas[1] === 230 && r.canvas[2] === 255, JSON.stringify(r));
        check('paint grow: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    if (wanted('paintmesh')) {
        console.log('paint: Warp with a mesh (paint-editor.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas'); c.width = 200; c.height = 200;
                c.getContext('2d').fillStyle = '#808080'; c.getContext('2d').fillRect(0, 0, 200, 200);
                await openProject('mesh', { 'm.png': await canvasBlob(c) });
                app.openSingle(app.files[0]);
                await app.enterPaint();
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.snap = false;
                const g = P.layers[P.cur].canvas.getContext('2d', { willReadFrequently: true });
                g.fillStyle = '#ff0000'; g.fillRect(50, 50, 100, 100);
                const a = (x, y) => g.getImageData(x, y, 1, 1).data[3];
                const st = document.getElementById('paint-stage'), box = document.getElementById('paint-options');
                const sc = (q) => { const sp = P.V().transformPoint(q); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                const drag = (from, to) => {
                    st.dispatchEvent(new PointerEvent('pointerdown', { ...sc(from), pointerId: 1, bubbles: true, button: 0 }));
                    st.dispatchEvent(new PointerEvent('pointermove', { ...sc(to), pointerId: 1, bubbles: true }));
                    st.dispatchEvent(new PointerEvent('pointerup', { ...sc(to), pointerId: 1, bubbles: true }));
                };
                // Ctrl+T, then Mode → Warp: 16 points over the box
                step = 'warp';
                pressKey('t', { ctrlKey: true });
                const sel = box.querySelector('.paint-tf-mode');
                out.offered = [...sel.options].some(o => o.textContent === 'Warp');
                sel.value = 'warp'; sel.dispatchEvent(new Event('change'));
                const m = P.float.mesh;
                out.mesh = m && [m.length, Math.round(m[0].x), Math.round(m[15].x), Math.round(m[5].x)].join();
                out.buttons = ['Reset', 'Cancel', 'Done'].every(t => [...box.querySelectorAll('button')].some(b => b.textContent === t));
                // The two top middle points up: the top edge bends up
                step = 'bend';
                for (const i of [1, 2]) { const q = P.float.mesh[i]; drag(q, { x: q.x, y: q.y - 30 }); }
                out.moved = Math.round(P.float.mesh[1].y);
                // Reset takes the bend out; bend again, then Done
                [...box.querySelectorAll('button')].find(b => b.textContent === 'Reset').click();
                out.reset = Math.round(P.float.mesh[1].y);
                for (const i of [1, 2]) { const q = P.float.mesh[i]; drag(q, { x: q.x, y: q.y - 30 }); }
                // Dragged inside, it all moves
                drag({ x: 100, y: 100 }, { x: 105, y: 100 });
                out.slid = Math.round(P.float.mesh[0].x);
                [...box.querySelectorAll('button')].find(b => b.textContent === 'Done').click();
                out.bent = [a(105, 32), a(105, 24), a(57, 52), a(57, 140)];
                // One step to undo
                step = 'undo';
                pressKey('z', { ctrlKey: true });
                out.undone = [a(105, 32), a(52, 52)];
                app.cancelPaint();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('paint warp mesh: Mode → Warp puts 16 points over the box, with Reset, Cancel and Done', r.offered && r.mesh === '16,50,150,83' && r.buttons, JSON.stringify(r));
        check('paint warp mesh: a point dragged bends the edge; Reset takes it out; dragged inside, it moves', r.moved === 20 && r.reset === 50 && r.slid === 55, JSON.stringify(r));
        check('paint warp mesh: Done bends the pixels (the top bowed up, the corners where they were)', r.bent && r.bent[0] === 255 && r.bent[1] === 0 && r.bent[2] === 255 && r.bent[3] === 255, JSON.stringify(r));
        check('paint warp mesh: one step to undo', r.undone && r.undone.join() === '0,255', JSON.stringify(r));
        check('paint warp mesh: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Restore colour (develop.js: restoreAuto; script.js: restoreColour) ----
    if (wanted('restore')) {
        console.log('restore colour (develop.js, script.js, adjust.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                // A faded red slide: red lifted and squashed high, green and blue low and flat
                const slide = async (seed) => {
                    const c = document.createElement('canvas'); c.width = 160; c.height = 120;
                    const g = c.getContext('2d'); const img = g.createImageData(160, 120);
                    for (let i = 0; i < 160 * 120; i++) {
                        const v = ((Math.imul(i + seed, 2654435761) >>> 0) % 1000) / 1000, x = (i % 160) / 160;
                        img.data[i * 4] = 140 + 90 * (0.5 * v + 0.5 * x); img.data[i * 4 + 1] = 40 + 80 * (0.5 * v + 0.5 * x);
                        img.data[i * 4 + 2] = 45 + 60 * (0.5 * v + 0.5 * x); img.data[i * 4 + 3] = 255;
                    }
                    g.putImageData(img, 0, 0);
                    return canvasBlob(c);
                };
                await openProject('restore', { 'a.png': await slide(1), 'b.png': await slide(2), 'c.png': await slide(3) });
                const [a, b, c] = app.viewFiles();
                step = 'one';
                await app.restoreColour([a]);
                const ra = a._edit && a._edit.adj && a._edit.adj.restore;
                out.one = !!ra && ra.amount === 100 && ra.d === 1 && ra.r[0] < ra.g[0] && !b._edit;
                // The cast is taken off: the restored photo's channels come out close together
                const px = await app.restoreSample(a);
                const T = { channels: Develop.channelTables(Develop.full(a._edit.adj)), lut: null, N: Develop.LUT_SIZE };
                const o = Develop.applyCPU(px, T, new Uint8ClampedArray(px.length));
                const mean = [0, 1, 2].map(k => { let m = 0; for (let i = k; i < o.length; i += 4) m += o[i]; return m / (o.length / 4); });
                const mean0 = [0, 1, 2].map(k => { let m = 0; for (let i = k; i < px.length; i += 4) m += px[i]; return m / (px.length / 4); });
                out.means = [mean0.map(Math.round), mean.map(Math.round)];
                out.cast = Math.max(...mean) - Math.min(...mean) < 0.4 * (Math.max(...mean0) - Math.min(...mean0));
                step = 'undo one';
                await app.undo();
                out.undone = !a._edit;
                step = 'batch';
                await app.restoreColour([a, b, c]);
                out.batch = [a, b, c].every(f => f._edit && f._edit.adj && f._edit.adj.restore);
                await app.undo();
                out.batchUndo = [a, b, c].every(f => !f._edit);
                // As one roll: restored the same way, each marked with its roll
                step = 'roll';
                await app.restoreColour([a, b, c], { roll: true });
                out.roll = [a, b, c].every(f => f._edit && f._edit.adj && f._edit.adj.restore && f._edit.adj.restore.roll === 3);
                await app.undo();
                out.rollUndo = [a, b, c].every(f => !f._edit);
                // In the menus: the photo's right-click and the selection bar's ⋯
                app.selection = new Set([a, b]);
                const rc = app.selectionMoreItems().find(it => it[0] === 'Restore colour of 2');
                out.menus = !!rc && Array.isArray(rc[1]) && rc[1].map(it => it[0]).join('|') === 'Restore each on its own|Restore as one roll (faded together)';
                step = 'adjust';
                await app.restoreColour([a]);
                app.openSingle(a);
                pressKey('e');
                await until(() => Adjust.ready);
                const row = document.querySelector('.adj-restore-row');
                out.row = !!row && !row.classList.contains('hidden') && row.querySelector('.adj-range').value === '100';
                // Its strength: half, and it's kept so
                const range = row.querySelector('.adj-range');
                range.value = '50'; range.dispatchEvent(new Event('input')); range.dispatchEvent(new Event('change'));
                out.half = Adjust.result() && Adjust.result().restore && Adjust.result().restore.amount === 50;
                // The Restore tool: what Auto found, Keep the colours, Pick grey
                step = 'kinds';
                Adjust.showPane('restore');
                const found = document.getElementById('adj-restore-found').textContent;
                out.found = !document.getElementById('adj-restore-opts').classList.contains('hidden') && /slide|cast|print/.test(found);
                document.getElementById('adj-restore-keep').click();
                const kept = Adjust.result().restore;
                out.keep = kept.type === 'keep' && kept.amount === 50 && document.getElementById('adj-restore-keep').getAttribute('aria-pressed') === 'true';
                document.getElementById('adj-restore-fix').click();
                out.fix = Adjust.result().restore.type !== 'keep';
                step = 'grey';
                document.getElementById('adj-restore-pick').click();
                out.picking = Adjust.picking === 'restore';
                // A patch of the scan that should be grey: its own pixels
                const s = await app.restoreSample(a);
                Adjust.pickRestore(s.slice(0, 4 * 64));
                const rg = Adjust.result().restore;
                out.grey = !Adjust.picking && !!rg && rg.grey === true && document.getElementById('adj-restore-found').textContent.includes('grey');
                await Adjust.undo();
                out.greyUndo = !Adjust.result().restore.grey;
                return out;
            } catch (e) { return { error: step + ': ' + e.message }; }
        });
        check('restore: one photo\'s colour restored, kept as an Adjust setting, the others untouched', r.one, JSON.stringify(r));
        check('restore: the red cast is taken off (the channels come out close together)', r.cast, JSON.stringify(r.means || r));
        check('restore: Ctrl+Z takes it off; a selection is restored together and undone in one step', r.undone && r.batch && r.batchUndo, JSON.stringify(r));
        check('restore: on the selection bar\'s ⋯ menu, each on its own or as one roll', r.menus, JSON.stringify(r));
        check('restore: as one roll, every photo restored the same way and marked with its roll; one undo', r.roll && r.rollUndo, JSON.stringify(r));
        check('restore: in Adjust its strength is a slider under the histogram, at 100, and half is kept', r.row && r.half, JSON.stringify(r));
        check('restore: the Restore tool says what kind of fade it found; Keep the colours and Fix the colours switch, the strength kept', r.found && r.keep && r.fix, JSON.stringify(r));
        check('restore: Pick grey sets it from a grey, and Ctrl+Z takes that off', r.picking && r.grey && r.greyUndo, JSON.stringify(r));
        check('restore: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Photos, Adjust and Paint as modes ----
    // ---- Adjust: Geometry, straighten by drawing a line ----
    if (wanted('geometry')) {
        console.log('geometry in Adjust (adjust.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const c = document.createElement('canvas');
                c.width = 400; c.height = 300;
                const g = c.getContext('2d');
                g.fillStyle = '#808080';
                g.fillRect(0, 0, 400, 300);
                await openProject('geo', { 'a.png': await canvasBlob(c), 'b.png': await canvasBlob(c) });
                const a = app.files.find(f => f.name === 'a.png');
                app.openSingle(a);
                await app.enterAdjust(a);
                await until(() => Adjust.ready);
                // Draw a line: a line 5° down from level makes the photo turn 5° back
                step = 'line';
                document.getElementById('adj-level').click();
                out.tool = Adjust.picking === 'level';
                const rc = Adjust.canvas.getBoundingClientRect();
                const x0 = rc.left + rc.width * 0.2, y0 = rc.top + rc.height * 0.5, len = rc.width * 0.6, t = 5 * Math.PI / 180;
                const x1 = x0 + len * Math.cos(t), y1 = y0 + len * Math.sin(t);
                document.getElementById('adj-stage').dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, button: 0, pointerId: 1, bubbles: true, cancelable: true }));
                dispatchEvent(new PointerEvent('pointermove', { clientX: x1, clientY: y1, pointerId: 1, bubbles: true }));
                dispatchEvent(new PointerEvent('pointerup', { clientX: x1, clientY: y1, pointerId: 1, bubbles: true }));
                out.angle = Adjust.geo && Adjust.geo.angle;
                out.toolOff = !Adjust.picking;
                out.smaller = Adjust.PW < 400 && Adjust.PH < 300 && Adjust.PW / Adjust.PH > 1.2;
                // Ctrl+Z puts it back, Ctrl+Y does it again
                step = 'undo';
                Adjust.undo();
                out.undone = Adjust.geo === null && Adjust.PW === 400 && Adjust.PH === 300;
                Adjust.redo();
                out.redone = !!Adjust.geo && Math.abs(Adjust.geo.angle + 5) < 0.05;
                // The Angle slider
                step = 'slider';
                const inp = document.getElementById('adj-angle');
                inp.value = '2';
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                out.slider = !!Adjust.geo && Adjust.geo.angle === 2 && document.querySelector('#adj-geo .adj-num').value === '2.00';
                // Kept with the photo as Crop's straighten, no adjustments
                step = 'save';
                await Modes.go('photos');
                await until(() => !Adjust.isOpen);
                out.saved = !!a._edit && a._edit.angle === 2 && !a._edit.adj;
                // Opened again, it's there; Reset Geometry takes it off
                step = 'again';
                await app.enterAdjust(a);
                await until(() => Adjust.ready);
                out.again = !!Adjust.geo && Adjust.geo.angle === 2 && !Adjust.changedSinceOpen();
                Adjust.resetSection('geometry');
                out.reset = Adjust.geo === null && Adjust.changedSinceOpen();
                await Modes.go('photos');
                await until(() => !Adjust.isOpen);
                out.resetSaved = !a._edit;
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('geometry: Draw a line turns the photo so the line is level (5° down: −5°), the tool off after', r.tool && Math.abs(r.angle + 5) < 0.05 && r.toolOff, JSON.stringify(r));
        check('geometry: straightened, the frame shrinks to stay inside the photo', r.smaller, JSON.stringify(r));
        check('geometry: Ctrl+Z puts it straight back, Ctrl+Y turns it again', r.undone && r.redone, JSON.stringify(r));
        check('geometry: the Angle slider sets it', r.slider, JSON.stringify(r));
        check('geometry: kept with the photo as Crop\'s straighten; opened again, it\'s there', r.saved && r.again, JSON.stringify(r));
        check('geometry: Reset Geometry takes it off, and nothing is kept', r.reset && r.resetSaved, JSON.stringify(r));
        check('geometry: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    if (wanted('perspective')) {
        console.log('perspective in Adjust (retouch.js, adjust.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                // White, with a black column at x 40–60 from top to bottom
                const c = document.createElement('canvas');
                c.width = 400; c.height = 300;
                const g = c.getContext('2d');
                g.fillStyle = '#fff';
                g.fillRect(0, 0, 400, 300);
                g.fillStyle = '#000';
                g.fillRect(40, 0, 20, 300);
                const px = (cv, x, y) => cv.getContext('2d').getImageData(x, y, 1, 1).data[0];
                // The maths: the warped photo's corners come from perspQuad's
                step = 'maths';
                const p = { v: -100, h: 40 };
                const M = Retouch.perspMap(p), Q = Retouch.perspQuad(p);
                out.corners = [[0, 0], [1, 0], [1, 1], [0, 1]].every(([u, v], i) => {
                    const [x, y] = Retouch.perspPoint(M, u, v);
                    return Math.abs(x - Q[i][0]) < 1e-9 && Math.abs(y - Q[i][1]) < 1e-9;
                });
                const I = Retouch.perspMap({});
                out.identity = Math.abs(Retouch.perspPoint(I, 0.3, 0.7)[0] - 0.3) < 1e-9 && Math.abs(Retouch.perspPoint(I, 0.3, 0.7)[1] - 0.7) < 1e-9;
                out.clean = JSON.stringify(Retouch.cleanPersp({ v: -250, h: 0.2 })) === '{"v":-100}' && Retouch.cleanPersp({ v: 0 }) === null;
                // Vertical −100: the top spread out, so the column (near the
                // left) is gone off the top row and still at the bottom
                step = 'warp';
                const w = Retouch.warp(c, { v: -100 });
                out.warp = w.width === 400 && w.height === 300 && px(w, 50, 1) > 200 && px(w, 50, 298) < 60;
                // Auto: a photo of a grid shot at a slant (its lines drawn where
                // the warp p takes them from) is put back by p
                step = 'auto';
                const slanted = (p, W = 600, H = 400) => {
                    const cv = document.createElement('canvas');
                    cv.width = W; cv.height = H;
                    const cg = cv.getContext('2d');
                    cg.fillStyle = '#d8d4cc';
                    cg.fillRect(0, 0, W, H);
                    cg.strokeStyle = '#302820';
                    cg.lineWidth = 3;
                    const Mp = Retouch.perspMap(p);
                    const line = (u0, v0, u1, v1) => {
                        const [x0, y0] = Retouch.perspPoint(Mp, u0, v0), [x1, y1] = Retouch.perspPoint(Mp, u1, v1);
                        cg.beginPath(); cg.moveTo(x0 * W, y0 * H); cg.lineTo(x1 * W, y1 * H); cg.stroke();
                    };
                    for (const u of [0.12, 0.3, 0.5, 0.7, 0.88]) line(u, 0.05, u, 0.95);
                    for (const v of [0.15, 0.4, 0.65, 0.9]) line(0.05, v, 0.95, v);
                    return cv;
                };
                const near = (q, p) => !!q && Math.abs((q.v || 0) - (p.v || 0)) <= 4 && Math.abs((q.h || 0) - (p.h || 0)) <= 4;
                const inv = Retouch.perspInverse(M);
                const back = Retouch.perspPoint(inv, ...Retouch.perspPoint(M, 0.3, 0.6));
                out.inverse = Math.abs(back[0] - 0.3) < 1e-9 && Math.abs(back[1] - 0.6) < 1e-9;
                out.autoV = Retouch.autoPersp(slanted({ v: -40 }));
                out.autoVH = Retouch.autoPersp(slanted({ v: 30, h: -50 }));
                out.autoNone = Retouch.autoPersp(slanted({}));
                out.autoBlank = Retouch.autoPersp(c);
                out.auto = near(out.autoV, { v: -40 }) && near(out.autoVH, { v: 30, h: -50 }) && near(out.autoNone, {}) && out.autoBlank === null;
                // In Adjust: the Vertical slider
                step = 'open';
                await openProject('persp', { 'a.png': await canvasBlob(c), 'b.png': await canvasBlob(slanted({ v: -40 })) });
                const a = app.files.find(f => f.name === 'a.png');
                const b = app.files.find(f => f.name === 'b.png');
                app.openSingle(a);
                await app.enterAdjust(a);
                await until(() => Adjust.ready);
                step = 'slider';
                const inp = document.getElementById('adj-persp-v');
                out.row = !!inp && !!inp.closest('#adj-persp');
                inp.value = '-60';
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                Adjust.draw();
                out.set = !!Adjust.a.persp && Adjust.a.persp.v === -60 && Adjust.base !== Adjust.raw && Adjust.changedSinceOpen();
                out.base = px(Adjust.base, 50, 1) > 200 && px(Adjust.raw, 50, 1) < 60;
                step = 'undo';
                Adjust.undo();
                Adjust.draw();
                out.undone = !Adjust.a.persp && Adjust.base === Adjust.raw;
                Adjust.redo();
                Adjust.draw();
                out.redone = !!Adjust.a.persp && Adjust.a.persp.v === -60 && Adjust.base !== Adjust.raw;
                // Kept with the photo's adjustments, and shown everywhere
                step = 'save';
                await Modes.go('photos');
                await until(() => !Adjust.isOpen);
                out.saved = !!a._edit && !!a._edit.adj && !!a._edit.adj.persp && a._edit.adj.persp.v === -60 && !Develop.tonal(a._edit.adj);
                const shown = (await app.drawEdited(await canvasBlob(c), a._edit, 400, 300)).canvas;
                out.shown = px(shown, 50, 1) > 200 && px(shown, 50, 298) < 60;
                // Not copied to other photos by Sync (each photo's own)
                step = 'sync';
                out.notSynced = !(Develop.syncedKeys({}, a._edit.adj, ['persp']) || {}).persp && !(Develop.synced({}, a._edit.adj, Develop.SYNC.map(x => x.id)) || {}).persp;
                out.bUntouched = !b._edit;
                // Opened again it's there; Reset Geometry takes it off
                step = 'again';
                await app.enterAdjust(a);
                await until(() => Adjust.ready);
                Adjust.draw();
                out.again = !!Adjust.a.persp && Adjust.a.persp.v === -60 && !Adjust.changedSinceOpen() && document.getElementById('adj-persp-v').value === '-60';
                Adjust.resetSection('geometry');
                Adjust.draw();
                out.reset = !Adjust.a.persp && Adjust.base === Adjust.raw && Adjust.changedSinceOpen();
                await Modes.go('photos');
                await until(() => !Adjust.isOpen);
                out.resetSaved = !a._edit;
                // Auto in Adjust: nothing to go by on a (one line), b put back
                step = 'auto in adjust';
                await app.enterAdjust(a);
                await until(() => Adjust.ready);
                document.getElementById('adj-persp-auto').click();
                out.autoNoLines = !Adjust.a.persp;
                await Modes.go('photos');
                await until(() => !Adjust.isOpen);
                app.openSingle(b);
                await app.enterAdjust(b);
                await until(() => Adjust.ready && Adjust.file === b);
                document.getElementById('adj-persp-auto').click();
                Adjust.draw();
                out.autoSet = near(Adjust.a.persp, { v: -40 }) && Adjust.base !== Adjust.raw && document.getElementById('adj-persp-v').value === String(Adjust.a.persp.v);
                Adjust.undo();
                Adjust.draw();
                out.autoUndone = !Adjust.a.persp && Adjust.base === Adjust.raw;
                await Modes.go('photos');
                await until(() => !Adjust.isOpen);
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('perspective: the warp\'s corners come from where it says, none is no warp, and settings are kept in range', r.corners && r.identity && r.clean, JSON.stringify(r));
        check('perspective: Vertical −100 spreads the top out (the photo keeps its size)', r.warp, JSON.stringify(r));
        check('perspective: Adjust\'s Vertical slider warps the picture being adjusted', r.row && r.set && r.base, JSON.stringify(r));
        check('perspective: Ctrl+Z takes it off, Ctrl+Y puts it back', r.undone && r.redone, JSON.stringify(r));
        check('perspective: kept with the photo\'s adjustments, and shown in Photos warped', r.saved && r.shown, JSON.stringify(r));
        check('perspective: never synced to other photos', r.notSynced && r.bUntouched, JSON.stringify(r));
        check('perspective: opened again it\'s there; Reset Geometry takes it off, and nothing is kept', r.again && r.reset && r.resetSaved, JSON.stringify(r));
        check('perspective: Auto finds the photo\'s lines and the Vertical and Horizontal that make them parallel (none when there are no lines)', r.inverse && r.auto, JSON.stringify(r));
        check('perspective: Auto in Adjust sets the sliders (Ctrl+Z takes it off), and leaves a photo with no lines alone', r.autoNoLines && r.autoSet && r.autoUndone, JSON.stringify(r));
        check('perspective: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    if (wanted('lens')) {
        console.log('lens fixes in Adjust (retouch.js, adjust.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const canvas = (W, H, fill) => {
                    const c = document.createElement('canvas');
                    c.width = W; c.height = H;
                    const g = c.getContext('2d');
                    g.fillStyle = fill;
                    g.fillRect(0, 0, W, H);
                    return c;
                };
                const rgb = (cv, x, y) => cv.getContext('2d').getImageData(x, y, 1, 1).data;
                // Where a dark column is along row y (its middle, from green)
                const colAt = (cv, y, ch = 1) => {
                    const d = cv.getContext('2d').getImageData(0, y, cv.width, 1).data;
                    let sw = 0, sx = 0;
                    for (let x = 0; x < cv.width; x++) { const w = 255 - d[x * 4 + ch]; if (w > 40) { sw += w; sx += w * x; } }
                    return sw ? sx / sw : -1;
                };
                step = 'clean';
                out.clean = JSON.stringify(Retouch.cleanLens({ dist: 300, fringe: 0.3, vig: -12.6 })) === '{"dist":100,"vig":-13}' && Retouch.cleanLens({ dist: 0 }) === null && Retouch.cleanLens('x') === null;
                // A lens that bows straight lines out (barrel): a column drawn
                // where the lens put it is made straight by Distortion
                step = 'distortion';
                const W = 600, H = 400, D = 60;
                const k = -D / 100 * Retouch.LENS_K;
                const bowed = canvas(W, H, '#fff');
                const bg = bowed.getContext('2d');
                bg.strokeStyle = '#000';
                bg.lineWidth = 6;
                bg.beginPath();
                for (let i = 0; i <= 100; i++) {
                    const x = 0.15, y = i / 100;
                    const dx = (x - 0.5) * W, dy = (y - 0.5) * H;
                    const s = 1 + k * (dx * dx + dy * dy) / ((W * W + H * H) / 4);
                    const px = W / 2 + dx * s, py = H / 2 + dy * s;
                    if (i) bg.lineTo(px, py); else bg.moveTo(px, py);
                }
                bg.stroke();
                const bend = (cv) => { const xs = [40, 200, 360].map(y => colAt(cv, y)); return Math.max(...xs) - Math.min(...xs); };
                out.bentBefore = bend(bowed);
                const fixed = Retouch.warp(bowed, null, { dist: D });
                out.bentAfter = bend(fixed);
                out.straight = out.bentBefore > 6 && out.bentAfter < 1.5 && fixed.width === W && fixed.height === H;
                // Lines that bow in (below 0): the corners never come out empty
                const white = canvas(W, H, '#fff');
                const pin = Retouch.warp(white, null, { dist: -100, fringe: 100 });
                out.noEmpty = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].every(([x, y]) => { const d = rgb(pin, x, y); return d[0] > 250 && d[1] > 250 && d[2] > 250 && d[3] === 255; });
                // Fringes: red made bigger and blue smaller (above 0), so on a
                // column near the right edge red moves out and blue in
                step = 'fringes';
                const col = canvas(W, H, '#fff');
                col.getContext('2d').fillStyle = '#000';
                col.getContext('2d').fillRect(540, 0, 8, H);
                const fr = Retouch.warp(col, null, { fringe: 100 });
                const [rx, gx, bx] = [0, 1, 2].map(ch => colAt(fr, 200, ch));
                out.fringe = [rx, gx, bx];
                out.fringes = rx > gx + 0.5 && bx < gx - 0.5;
                // Dark corners: the middle stays, the corners lighten (or darken below 0)
                step = 'dark corners';
                const grey = canvas(W, H, '#808080');
                const lit = Retouch.warp(grey, null, { vig: 100 }), dim = Retouch.warp(grey, null, { vig: -100 });
                out.vig = [rgb(lit, W / 2, H / 2)[1], rgb(lit, 1, 1)[1], rgb(dim, 1, 1)[1]];
                out.corners = Math.abs(out.vig[0] - 128) <= 2 && out.vig[1] > 220 && out.vig[2] < 80;
                // With perspective, in one pass: the lens first
                out.both = Retouch.needed({ adj: { lens: { vig: 10 } } }) && !Retouch.needed({ adj: { lens: { vig: 0 } } });
                // In Adjust: the Distortion slider
                step = 'open';
                await openProject('lens', { 'a.png': await canvasBlob(bowed), 'b.png': await canvasBlob(white) });
                const a = app.files.find(f => f.name === 'a.png');
                const b = app.files.find(f => f.name === 'b.png');
                app.openSingle(a);
                await app.enterAdjust(a);
                await until(() => Adjust.ready && Adjust.file === a);
                step = 'slider';
                const inp = document.getElementById('adj-lens-dist');
                out.rows = !!inp && !!inp.closest('#adj-lens') && !!document.getElementById('adj-lens-fringe') && !!document.getElementById('adj-lens-vig');
                inp.value = String(D);
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                Adjust.draw();
                out.set = !!Adjust.a.lens && Adjust.a.lens.dist === D && Adjust.base !== Adjust.raw && Adjust.changedSinceOpen();
                out.baseBend = bend(Adjust.base);
                out.base = Adjust.base.width === Adjust.raw.width && out.baseBend < 2 && bend(Adjust.raw) > 6;
                step = 'undo';
                Adjust.undo();
                Adjust.draw();
                out.undone = !Adjust.a.lens && Adjust.base === Adjust.raw;
                Adjust.redo();
                Adjust.draw();
                out.redone = !!Adjust.a.lens && Adjust.a.lens.dist === D;
                step = 'save';
                await Modes.go('photos');
                await until(() => !Adjust.isOpen);
                out.saved = !!a._edit && !!a._edit.adj && !!a._edit.adj.lens && a._edit.adj.lens.dist === D && !Develop.tonal(a._edit.adj);
                const shown = (await app.drawEdited(await canvasBlob(bowed), a._edit, W, H)).canvas;
                out.shownBend = bend(shown);
                out.shown = out.shownBend < 2;
                // Synced to other photos (the same lens), in a group of its own
                step = 'sync';
                out.synced = (Develop.synced({}, a._edit.adj, ['lens']) || {}).lens?.dist === D && Develop.syncGroups(a._edit.adj).includes('lens') && !(Develop.synced({}, a._edit.adj, ['light']) || {}).lens;
                out.bUntouched = !b._edit;
                // Reset Geometry takes it off
                step = 'reset';
                await app.enterAdjust(a);
                await until(() => Adjust.ready && Adjust.file === a);
                Adjust.draw();
                out.again = !!Adjust.a.lens && document.getElementById('adj-lens-dist').value === String(D);
                Adjust.resetSection('geometry');
                Adjust.draw();
                out.reset = !Adjust.a.lens && Adjust.base === Adjust.raw;
                await Modes.go('photos');
                await until(() => !Adjust.isOpen);
                out.resetSaved = !a._edit;
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('lens: settings are kept in range, none when all are 0', r.clean, JSON.stringify(r));
        check('lens: Distortion makes lines a lens bowed out straight again, and the photo keeps its size', r.straight, JSON.stringify(r));
        check('lens: bowed in and with fringes, the corners never come out empty', r.noEmpty, JSON.stringify(r));
        check('lens: Fringes moves red and blue apart from green, toward the edges', r.fringes, JSON.stringify(r));
        check('lens: Dark corners lightens the corners (darkens below 0) and leaves the middle', r.corners && r.both, JSON.stringify(r));
        check('lens: Adjust\'s Distortion slider fixes the picture being adjusted', r.rows && r.set && r.base, JSON.stringify(r));
        check('lens: Ctrl+Z takes it off, Ctrl+Y puts it back', r.undone && r.redone, JSON.stringify(r));
        check('lens: kept with the photo\'s adjustments, and shown fixed in Photos', r.saved && r.shown, JSON.stringify(r));
        check('lens: Sync copies it, as Lens fixes, and nothing else does', r.synced && r.bUntouched, JSON.stringify(r));
        check('lens: opened again it\'s there; Reset Geometry takes it off', r.again && r.reset && r.resetSaved, JSON.stringify(r));
        check('lens: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    if (wanted('modes')) {
        console.log('modes: Photos, Adjust and Paint (modes.js), Start in, Paint\'s start (blank.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const $ = (id) => document.getElementById(id);
                const shownEl = (id) => { const e = $(id); return !!e && !e.classList.contains('hidden') && e.getClientRects().length > 0; };
                step = 'start';
                // The home page: Open a folder, New project and Convert as tiles, in that order; Adjust a photo and Paint a photo in the quiet row (no scanner here)
                out.startShown = ['btn-browse-folder', 'start-blank', 'start-convert', 'start-adjust', 'start-paint'].every(shownEl) && !shownEl('start-capture');
                out.startShown = out.startShown && [...document.querySelectorAll('.home-tiles > .home-tile')].map(b => b.id).join() === 'btn-browse-folder,start-blank,start-convert' && $('start-blank').textContent.includes('New project') && !!$('start-adjust').closest('.home-more') && !!$('start-paint').closest('.home-more');
                // A tile that says Adjust: the project lands in Adjust
                step = 'start in';
                Modes.next = 'adjust';
                out.startKept = true;
                const blob = async (color) => { const c = document.createElement('canvas'); c.width = 120; c.height = 90; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 120, 90); return canvasBlob(c); };
                await openProject('modes', { 'a.png': await blob('#806040'), 'b.png': await blob('#406080'), 'c.png': await blob('#408060') });
                await until(() => Adjust.ready && Modes.strip.parentElement);
                out.landedAdjust = Modes.current() === 'adjust' && Adjust.file === app.viewFiles()[0];
                // Adjust's ⋯: Reset, Copy, Show clipping, Before; J shows clipping
                out.more = ['Reset all', 'Copy settings', 'Show clipping', 'Before and after'].every(n => Adjust.moreItems().some(i => i[0] === n));
                pressKey('j');
                out.clip = Adjust.clip === true && Adjust.moreItems().find(i => i[0] === 'Show clipping')[3] === true;
                pressKey('j');
                out.clip = out.clip && Adjust.clip === false;
                // The row with Adjust chosen (beside it in the sidebar, or over its head's corner), and the strip along the bottom
                out.chipOver = shownEl('mode-row') && shownEl('mode-seg') && $('mode-seg').querySelector('.on').dataset.mode === 'adjust' && !shownEl('mode-float')
                    && ($('mode-row').parentElement === $('folder-rail') ? $('adjust-editor').getBoundingClientRect().left >= $('folder-rail').getBoundingClientRect().right - 1 : $('mode-row').classList.contains('over-mode'));
                // Its panel dragged away hides, a line left at the right edge; shown again from there
                app.showPanel('adjust', false);
                out.panelHides = getComputedStyle($('adj-panel')).display === 'none' || $('adj-panel').classList.contains('side-out');
                out.panelEdge = !$('adjust-editor').querySelector('.side-edge-right').classList.contains('hidden');
                app.showPanel('adjust', true);
                out.panelBack = getComputedStyle($('adj-panel')).display !== 'none' && $('adjust-editor').querySelector('.side-edge-right').classList.contains('hidden') && !app.uiPrefs.panelsHidden.adjust;
                // The film strip is Photos' own, moved in: its items, its height
                out.strip = Modes.strip === $('thumbnail-strip') && Modes.strip.parentElement === $('adjust-editor') && Modes.strip.children.length === 3 && Modes.strip.children[0].classList.contains('active')
                    && Modes.strip.children[0].classList.contains('thumb-item') && Math.round(Modes.strip.getBoundingClientRect().height) === app.uiPrefs.stripHeight
                    && $('strip-resize').parentElement === $('adjust-editor');
                // Another photo from the strip: still in Adjust, on that one
                step = 'strip';
                Modes.strip.children[1].click();
                await until(() => Adjust.ready && Adjust.file === app.viewFiles()[1]);
                out.stepped = Modes.current() === 'adjust' && Adjust.file === app.viewFiles()[1] && Modes.strip.children[1].classList.contains('active');
                // To Paint from the chip's menu: Paint on the same photo
                step = 'to paint';
                $('mode-chip-float').click();
                // The three modes, then Find anything (palette.js)
                const items = [...document.querySelectorAll('.mode-menu .mode-mi:not(.mode-find)')].map(b => b.textContent);
                out.menu = items.length === 3 && /Paint/.test(items[2]) && document.querySelector('.mode-menu .mode-mi.on') && /Adjust/.test(document.querySelector('.mode-menu .mode-mi.on').textContent) &&
                    /Find anything/.test(document.querySelector('.mode-menu .mode-mi:last-child').textContent);
                document.querySelectorAll('.mode-menu .mode-mi')[2].click();
                await until(() => PaintEditor.ready && Modes.strip.parentElement === $('paint-editor'));
                out.inPaint = Modes.current() === 'paint' && PaintEditor.file === app.viewFiles()[1] && Modes.strip.parentElement === $('paint-editor');
                // A stroke, then another photo: the painting kept on the first
                step = 'paint step';
                const P = PaintEditor;
                const st = $('paint-stage');
                const at = (x, y) => { const sp = P.V().transformPoint(P.C.transformPoint({ x, y })); const rc = P.canvas.getBoundingClientRect(); return { clientX: rc.left + sp.x, clientY: rc.top + sp.y }; };
                const pe = (type, x, y) => st.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId: 1, bubbles: true, button: 0 }));
                P.setTool('brush');
                pe('pointerdown', 20, 40); pe('pointermove', 60, 40); pe('pointerup', 60, 40);
                const painted = P.file;
                Modes.strip.children[2].click();
                await until(() => PaintEditor.ready && PaintEditor.file === app.viewFiles()[2]);
                out.kept = !!(painted._edit && painted._edit.paint) && PaintEditor.file === app.viewFiles()[2];
                // Back to Photos
                step = 'photos';
                await Modes.go('photos');
                out.back = Modes.current() === 'photos' && !PaintEditor.isOpen && Modes.strip.parentElement === Modes.stripHome.parentNode && Modes.stripHome.nextSibling === $('strip-resize');
                // And in Photos, the same click: another photo
                Modes.strip.children[0].click();
                out.photosClick = app.viewMode === 'single' && app.currentFile === app.viewFiles()[0] && Modes.strip.children[0].classList.contains('active');
                // Hidden in Photos: hidden in Adjust too, and after stepping there
                app.toggleThumbnailStrip();
                await Modes.go('adjust');
                await until(() => Adjust.ready);
                await Modes.stepBy(1);
                await until(() => Adjust.ready && Adjust.file === app.viewFiles()[1]);
                out.hiddenToo = Modes.strip.parentElement === $('adjust-editor') && Modes.strip.classList.contains('hidden');
                await Modes.go('photos');
                app.toggleThumbnailStrip();
                out.hiddenToo = out.hiddenToo && !Modes.strip.classList.contains('hidden');
                // The grid: with the sidebar open the row is along its top; closed, the same row floats as a pill
                step = 'grid';
                app.setView('grid');
                app.uiPrefs.folderRail = true;
                Folders.render();
                out.seg = shownEl('mode-seg') && [...$('mode-seg').children].map(b => b.dataset.mode).join() === 'photos,adjust,paint' && $('mode-seg').querySelector('.on').dataset.mode === 'photos' && $('mode-row').parentElement === $('folder-rail') && !shownEl('mode-chip-bar') && !shownEl('mode-float');
                app.uiPrefs.folderRail = false;
                Folders.render();
                out.chipBar = shownEl('mode-row') && $('mode-row').classList.contains('float') && shownEl('mode-seg') && shownEl('mode-row-side') && shownEl('mode-row-find') && !shownEl('mode-chip-bar') && !shownEl('mode-float')
                    && $('folder-bar').getBoundingClientRect().left >= $('mode-row').getBoundingClientRect().right;
                // The sidebar's Adjust: on the photo selected
                app.uiPrefs.folderRail = true;
                Folders.render();
                $('mode-seg').querySelector('[data-mode="adjust"]').click();
                await until(() => Adjust.ready);
                out.segGo = Modes.current() === 'adjust';
                // Right-click on the photo: Adjust's menu, each with its key (audit A3)
                $('adj-canvas').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
                const adjRows = [...document.querySelectorAll('#context-menu button')].map(b => b.textContent);
                out.adjMenu = adjRows.some(t => t.startsWith('Before and after')) && adjRows.some(t => t.startsWith('Copy adjustments')) && adjRows.some(t => t.startsWith('Reset all'));
                app.closeContextMenu();
                // Closing the window in Adjust: held (the app asks the page first)
                step = 'closing';
                const held = [];
                window.JEditorNative = { features: [], holdClose: (f) => held.push(f) };
                Modes._held = undefined;
                Modes.render();
                delete window.JEditorNative;
                out.holds = held.length === 1 && typeof held[0] === 'function';
                // Nothing done: it closes, nothing asked
                out.closeAtOnce = await Modes.closing() === true && $('ui-dialog').classList.contains('hidden');
                // Something done: "Keep your changes?"; Cancel stays, Keep keeps and closes
                const adjFile = Adjust.file;
                Adjust.setAll({ exposure: 1 });
                let asked = Modes.closing();
                await until(() => !$('ui-dialog').classList.contains('hidden'));
                out.askText = $('uid-title').textContent === 'Keep your changes?' && $('uid-ok').textContent === 'Keep' && /Don.t keep/.test($('uid-alt').textContent);
                $('uid-cancel').click();
                out.cancelStays = await asked === false && Adjust.isOpen;
                asked = Modes.closing();
                await until(() => !$('ui-dialog').classList.contains('hidden'));
                $('uid-ok').click();
                out.keepKeeps = await asked === true && !Adjust.isOpen && !!(adjFile._edit && adjFile._edit.adj && adjFile._edit.adj.exposure === 1);
                $('mode-seg').querySelector('[data-mode="adjust"]').click();
                await until(() => Adjust.ready);
                // No Done bar: Esc goes back to Photos
                out.noBar = !document.querySelector('#adjust-editor .crop-toolbar') && !document.querySelector('#paint-editor .crop-toolbar') && !$('adj-done') && !$('paint-done');
                pressKey('Escape');
                await until(() => !Adjust.isOpen);
                out.escBack = Modes.current() === 'photos';
                // The toolbar's main row has no Adjust or Paint now
                out.toolbar = app.uiPrefs.placement.adjust === 'more' && app.uiPrefs.placement.paint === 'more';
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('modes: the home page has the big tiles (New canvas where there\'s no scanner or camera)', r.startShown, JSON.stringify(r));
        check('modes: a project opened for Adjust lands in Adjust on its first photo', r.startKept && r.landedAdjust, JSON.stringify(r));
        check('modes: Adjust\'s ⋯ has Reset, Copy, Show clipping and Before; J shows clipping and hides it', r.more && r.clip, JSON.stringify(r));
        check('modes: in Adjust the row has Adjust chosen (the sidebar beside it, or the row over its corner), and a strip runs along the bottom', r.chipOver && r.strip, JSON.stringify(r));
        check('modes: Adjust\'s panel hides, leaving a line at the right edge, and comes back, remembered', r.panelHides && r.panelEdge && r.panelBack, JSON.stringify(r));
        check('modes: another photo from the strip opens in the same mode', r.stepped, JSON.stringify(r));
        check('modes: one film strip: back in Photos after Paint, where a click opens that photo', r.back && r.photosClick, JSON.stringify(r));
        check('modes: the film strip hidden in Photos stays hidden in Adjust, stepping to another photo too', r.hiddenToo, JSON.stringify(r));
        check('modes: the chip\'s menu switches to Paint, on the same photo', r.menu && r.inPaint, JSON.stringify(r));
        check('modes: what was painted is kept when another photo is chosen', r.kept, JSON.stringify(r));
        check('modes: back to Photos closes it', r.back, JSON.stringify(r));
        check('modes: the sidebar open, the row is along its top; closed, the same row floats as a pill, the folder pill after it', r.seg && r.chipBar && r.segGo, JSON.stringify(r));
        check('Adjust: right-click on the photo has Before and after, Copy adjustments and Reset all', r.adjMenu, JSON.stringify(r.adjMenu));
        check('modes: Adjust and Paint are off the toolbar\'s main row', r.toolbar, JSON.stringify(r));
        check('modes: closing the window in Adjust or Paint is held for the page', r.holds && r.closeAtOnce, JSON.stringify(r));
        check('modes: closing with changes asks "Keep your changes?"; Cancel stays, Keep keeps them', r.askText && r.cancelStays && r.keepKeeps, JSON.stringify(r));
        check('modes: no Done bar in Adjust or Paint; Esc goes back to Photos', r.noBar && r.escBack, JSON.stringify(r));
        check('modes: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();

        // The landing page's Paint: a new canvas, or an image or folder to open
        const p2 = await open();
        const q = await p2.page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const $ = (id) => document.getElementById(id);
                $('start-paint').click();
                await until(() => !$('blank-panel').classList.contains('hidden'));
                out.dialog = !$('blank-panel').querySelector('.blank-tabs').classList.contains('hidden') && $('blank-title').textContent === 'Paint' && $('blank-where').value === '\u0000pick';
                // Open a file → An image…: opened on its own, in Paint
                step = 'image';
                $('blank-tab-open').click();
                out.openPane = !$('blank-open').classList.contains('hidden') && $('blank-new').classList.contains('hidden');
                const c = document.createElement('canvas'); c.width = 100; c.height = 80;
                c.getContext('2d').fillRect(0, 0, 100, 80);
                const opfs = await navigator.storage.getDirectory();
                const fh = await opfs.getFileHandle('loose.png', { create: true });
                const w = await fh.createWritable(); await w.write(await canvasBlob(c)); await w.close();
                window.showOpenFilePicker = async () => [fh];
                $('blank-open-image').click();
                await until(() => PaintEditor.ready);
                out.image = PaintEditor.isOpen && app.files.length === 1 && app.files[0].name === 'loose.png' && !app.dirHandle;
                app.cancelPaint();
                // New canvas with no project: a folder chosen, opened, the canvas made in it, in Paint
                step = 'canvas';
                const dir = await opfs.getDirectoryHandle('canvas-here', { create: true });
                window.showDirectoryPicker = async () => dir;
                const made = Blank.open(null, { start: true });
                await until(() => !$('blank-panel').classList.contains('hidden'));
                $('blank-presets').querySelector('[data-key="square"]').click();
                $('blank-go').click();
                const file = await made;
                await until(() => PaintEditor.ready);
                out.canvas = file && file.name === 'Untitled.png' && app.dirHandle === dir && PaintEditor.file === file;
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('modes: Paint on the landing page asks what to paint on (New canvas | Open a file)', q.dialog && q.openPane, JSON.stringify(q));
        check('modes: An image… opens it on its own, in Paint', q.image, JSON.stringify(q));
        check('modes: a new canvas with no project open: a folder chosen, the canvas made there, in Paint', q.canvas, JSON.stringify(q));
        check('modes (landing): no JS errors', p2.issues.errors.length === 0, p2.issues.errors.join('; '));
        await p2.page.close();
    }

    // ---- Crop: a side dragged into a turned photo's edge slides, then gets shorter ----
    if (wanted('crop')) {
        console.log('crop: a side slides along a slanted edge, then gets shorter (crop.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(() => {
            const G = CropGeom, W = 2000, H = 1500, m = 1;
            const drag = (cs, st, handle, key, to, minSize = 10) => {
                const t = { ...st, [key]: to };
                const before = G.clampToward(st, t, W, H, cs, m, true);
                const after = G.slideSide(t, handle, before, W, H, cs, m, minSize) || before;
                return { before, after, fits: G.fits(after, W, H, cs, m) };
            };
            const out = {};
            // Turned 0.5°, a print near the top of a scan: its crop touches the top edge
            const cs = G.cosSin(0, 0.5);
            const top = Math.max(G.extent('x', -500, W, H, cs, m)[0], G.extent('x', 300, W, H, cs, m)[0]) + 0.01;
            const nearTop = { x0: -500, y0: top, x1: 300, y1: top + 600 };
            const a = drag(cs, nearTop, 'e', 'x1', 1400);
            out.slid = [a.before.x1, a.after.x1, a.after.x0, a.after.y1 - a.after.y0, a.after.y0 - nearTop.y0, a.fits];
            // A little way out: slid only as much as it needs
            const b = drag(cs, nearTop, 'e', 'x1', 600);
            out.little = [b.after.x1, b.after.y0 - nearTop.y0, b.fits];
            // Turned 3°, the crop as tall as it can be: it can't slide, so it gets a little shorter
            const cs3 = G.cosSin(0, 3);
            const e1 = G.extent('x', -800, W, H, cs3, m), e2 = G.extent('x', 600, W, H, cs3, m);
            const tall = { x0: -800, y0: Math.max(e1[0], e2[0]) + 0.01, x1: 600, y1: Math.min(e1[1], e2[1]) - 0.01 };
            const c = drag(cs3, tall, 'e', 'x1', 1400);
            out.shorter = [c.before.x1, c.after.x1, c.after.x0, (tall.y1 - tall.y0) - (c.after.y1 - c.after.y0), c.fits];
            // ...and it stops at the photo's edge facing it, not in the corner's wedge
            const e3 = G.extent('y', (c.after.y0 + c.after.y1) / 2, W, H, cs3, m);
            out.atEdge = e3[1] - c.after.x1;
            // Not turned: the side stops at the edge
            const cs0 = G.cosSin(0, 0);
            const d = drag(cs0, { x0: -500, y0: -749, x1: 300, y1: -149 }, 'e', 'x1', 1400);
            out.flat = [d.before.x1, d.after.x1];
            return out;
        });
        check('crop: turned 0.5°, a side whose corner meets the top edge slides along and goes on to the photo\'s edge', r.slid[0] < 310 && r.slid[1] > 985 && r.slid[2] === -500 && Math.abs(r.slid[3] - 600) < 1e-6 && r.slid[4] > 0 && r.slid[4] < 10 && r.slid[5], JSON.stringify(r));
        check('crop: it slides only as much as it needs', Math.abs(r.little[0] - 600) < 1e-6 && r.little[1] > 0 && r.little[1] < 3 && r.little[2], JSON.stringify(r));
        check('crop: as tall as it can be, it gets a little shorter instead, the other side staying put', r.shorter[1] > r.shorter[0] + 50 && r.shorter[2] === -800 && r.shorter[3] > 0 && r.shorter[3] < 120 && r.shorter[4], JSON.stringify(r));
        check('crop: ...and stops at the photo\'s edge facing it', r.atEdge >= 0 && r.atEdge < 60, JSON.stringify(r));
        check('crop: not turned, the side stops at the edge', Math.abs(r.flat[0] - 999) < 0.01 && Math.abs(r.flat[1] - 999) < 0.01, JSON.stringify(r));
        check('crop: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Flip ----
    if (wanted('flip')) {
        console.log('flip: left to right and upside down (script.js, crop.js, edits.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            const out = {};
            // A photo whose halves differ: red left, blue right, a green
            // band along the top
            const make = async (type, w = 64, h = 32) => {
                const c = document.createElement('canvas'); c.width = w; c.height = h;
                const g = c.getContext('2d');
                g.fillStyle = '#f00'; g.fillRect(0, 0, w / 2, h);
                g.fillStyle = '#00f'; g.fillRect(w / 2, 0, w / 2, h);
                g.fillStyle = '#0f0'; g.fillRect(0, 0, w, h / 4);
                return canvasBlob(c, type, 0.95);
            };
            // What's at a spot (fractions across and down), as the photo shows
            const at = async (blob, u, v) => {
                const bmp = await createImageBitmap(blob);
                const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
                const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); bmp.close();
                const d = g.getImageData(Math.floor(u * c.width), Math.floor(v * c.height), 1, 1).data;
                return d[0] > 150 && d[1] < 100 && d[2] < 100 ? 'red' : d[2] > 150 && d[0] < 100 && d[1] < 100 ? 'blue' : d[1] > 150 && d[0] < 100 && d[2] < 100 ? 'green' : `${d[0]},${d[1]},${d[2]}`;
            };
            const look = async (blob) => [await at(blob, 0.1, 0.6), await at(blob, 0.9, 0.6), await at(blob, 0.25, 0.05), await at(blob, 0.25, 0.95)].join(' ');
            const sides = async (blob) => [await at(blob, 0.1, 0.5), await at(blob, 0.9, 0.5)].join(' ');
            const bytesOf = async (f) => new Uint8Array(await (await f.handle.getFile()).arrayBuffer());

            // The orientation table: each flip twice is back where it was;
            // left to right then upside down is half a turn
            out.involution = [1, 2, 3, 4, 5, 6, 7, 8].every(o => app.flipOrientation(app.flipOrientation(o, 'h'), 'h') === o && app.flipOrientation(app.flipOrientation(o, 'v'), 'v') === o);
            out.halfTurn = [1, 2, 3, 4, 5, 6, 7, 8].every(o => app.flipOrientation(app.flipOrientation(o, 'h'), 'v') === app.composeOrientation(o, 180));
            out.turnedFlip = [1, 6, 3, 8].every(o => app.flipOrientation(app.flipOrientation(o, 'h', 90), 'h', 90) === o);

            await openProject('Flip', { 'a.jpg': await make('image/jpeg'), 'b.png': await make('image/png'), 'c.jpg': await make('image/jpeg') });
            const [a, b, c] = ['a.jpg', 'b.png', 'c.jpg'].map(n => app.files.find(f => f.name === n));
            out.before = await look(await a.handle.getFile());

            // A JPEG, left to right: only its orientation changes
            const aBefore = await bytesOf(a);
            await app.flipFiles([a], 'h');
            const aAfter = await bytesOf(a);
            out.jpegH = [await look(new Blob([aAfter])), readOrientation(aAfter)];
            // (a scanner's JPEG has no EXIF: one is added, the picture data untouched)
            out.jpegLossless = aAfter.length - aBefore.length < 100 && aAfter.subarray(aAfter.length - 200).every((x, i) => x === aBefore[aBefore.length - 200 + i]);
            await app.undo();
            out.jpegUndo = [await look(await a.handle.getFile()), readOrientation(await bytesOf(a)) || 1];
            // Upside down
            await app.flipFiles([a], 'v');
            out.jpegV = [await look(await a.handle.getFile()), readOrientation(await bytesOf(a))];
            await app.undo();

            // A PNG is re-encoded; Ctrl+Z puts its bytes back exactly
            const bBefore = await bytesOf(b);
            await app.flipFiles([b], 'h');
            out.png = await look(await b.handle.getFile());
            await app.undo();
            const bBack = await bytesOf(b);
            out.pngUndo = bBack.length === bBefore.length && bBack.every((x, i) => x === bBefore[i]);

            // A selection: one Ctrl+Z
            const depth = (app._undoStack || []).length;
            await app.flipFiles([a, c], 'h');
            out.oneStep = (app._undoStack || []).length === depth + 1;
            out.both = [readOrientation(await bytesOf(a)), readOrientation(await bytesOf(c))];
            await app.undo();
            out.bothBack = [readOrientation(await bytesOf(a)) || 1, readOrientation(await bytesOf(c)) || 1];

            // Kept until saved (Keep edits in jEditor): an edit, the crop
            // box mirrored with it; twice is no edit at all
            keepEdits(true);
            Edits.set([{ file: c, edit: { q: 0, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0, y1: 0.5 } } }], 'crop');
            await app.flipFiles([c], 'h');
            const e = c._edit;
            out.kept = e && e.m === true && e.n.x0 === 0 && e.n.x1 === 0.5;
            // The left half kept, shown flipped: red, all of it
            const shown = await CropEditor.renderSnapshot(await c.handle.getFile(), e, 'image/png');
            out.keptLook = await look(await canvasBlob(shown));
            out.diskUntouched = (readOrientation(await bytesOf(c)) || 1) === 1;
            await app.flipFiles([c], 'h');
            out.twice = c._edit && !c._edit.m && c._edit.n.x1 === 0;
            Edits.set([{ file: c, edit: null }], 'edits');
            await app.flipFiles([c], 'v');
            await app.flipFiles([c], 'v');
            out.twiceNothing = !c._edit;
            // Flipped and turned: Write edits to file writes it losslessly, as one
            await app.flipFiles([c], 'h');
            await app.rotateBulk(90, new Map([[c, 90]]));
            const cBefore = await bytesOf(c);
            await app.saveEdits([c]);
            const cSaved = await bytesOf(c);
            out.saved = [readOrientation(cSaved), !c._edit, cSaved.length - cBefore.length < 100];
            await app.undo();
            out.savedUndo = [readOrientation(await bytesOf(c)) || 1, !!(c._edit && c._edit.m && c._edit.q === 1)];
            Edits.set([{ file: c, edit: null }], 'edits');
            keepEdits(false);

            // The crop editor's geometry: the photo point under a spot, and
            // back; Adjust's mask map (Develop.cropMap) agrees with it
            const ed = CropEditor.fromSnapshot(400, 300, { q: 1, m: true, angle: 3, n: { x0: -0.4, y0: -0.3, x1: 0.2, y1: 0.4 } });
            const p = { x: 37, y: -21 }, back = ed.fromImage(ed.toImage(p));
            out.roundTrip = Math.hypot(back.x - p.x, back.y - p.y) < 1e-9;
            const map = Develop.cropMap(ed, 400, 300).m, o = ed.outputRect();
            const U = 0.25, V = 0.7, img = ed.toImage({ x: o.x0 + U * o.w, y: o.y0 + V * o.h });
            out.maskMap = Math.abs(map[0] * U + map[1] * V + map[2] - (img.x / 400 + 0.5)) < 1e-9 && Math.abs(map[3] * U + map[4] * V + map[5] - (img.y / 300 + 0.5)) < 1e-9;
            // Paint draws its layers through the same flip
            const src = document.createElement('canvas'); src.width = 400; src.height = 300;
            const sg = src.getContext('2d'); sg.fillStyle = '#f00'; sg.fillRect(0, 0, 200, 300); sg.fillStyle = '#00f'; sg.fillRect(200, 0, 200, 300);
            const flat = CropEditor.fromSnapshot(400, 300, { q: 0, m: true, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } });
            const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
            Paint.drawThrough(canvas.getContext('2d'), flat, src, 400, 300);
            out.paint = await sides(await canvasBlob(canvas));
            const drawn = flat.drawOutput(src);
            out.drawOutput = await sides(await canvasBlob(drawn));

            // In the crop editor: Shift+H flips, its own Ctrl+Z takes it back
            app.currentFile = a;
            app.setView('single');
            await sleep(300);
            await app.enterCrop();
            await until(() => CropEditor.ready);
            CropEditor.flip('h');
            out.editorFlip = CropEditor.m === true && CropEditor.snapshot().m === true;
            CropEditor.flip('v');
            out.editorBoth = !CropEditor.m && CropEditor.q === 2;
            CropEditor.undo();
            CropEditor.undo();
            out.editorUndo = !CropEditor.m && CropEditor.q === 0;
            // Right-click on the photo: Crop's menu (audit A3)
            document.querySelector('.crop-stage').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
            const cropRows = [...document.querySelectorAll('#context-menu button')].map(b => b.textContent);
            out.cropMenu = cropRows.some(t => t.startsWith('Turn and flip')) && cropRows.some(t => t.startsWith('Straighten back')) && cropRows.some(t => t.startsWith('Done'));
            app.closeContextMenu();
            CropEditor.flip('h');
            await app.saveCrop();
            for (let i = 0; i < 100 && readOrientation(await bytesOf(a)) !== 2; i++) await sleep(50);
            out.editorSaved = [await look(await a.handle.getFile()), readOrientation(await bytesOf(a))];
            return out;
        });
        check('Crop: right-click on the photo has Turn and flip, Straighten back to 0° and Done', r.cropMenu, JSON.stringify(r.cropMenu));
        check('flip: each flip twice is back as it was, and both together are half a turn', r.involution && r.halfTurn && r.turnedFlip, JSON.stringify(r));
        check('flip: the test photo is red left, blue right, green along the top', r.before === 'red blue green red', r.before);
        check('flip: a JPEG flipped left to right, by its orientation (2)', r.jpegH[0] === 'blue red green blue' && r.jpegH[1] === 2, JSON.stringify(r.jpegH));
        check('flip: ...losslessly: the picture data is the same', r.jpegLossless);
        check('flip: Ctrl+Z puts it back', r.jpegUndo[0] === 'red blue green red' && r.jpegUndo[1] === 1, JSON.stringify(r.jpegUndo));
        check('flip: upside down (orientation 4)', r.jpegV[0] === 'red blue red green' && r.jpegV[1] === 4, JSON.stringify(r.jpegV));
        check('flip: a PNG is re-encoded flipped, and Ctrl+Z puts its bytes back exactly', r.png === 'blue red green blue' && r.pngUndo, JSON.stringify([r.png, r.pngUndo]));
        check('flip: a selection is one Ctrl+Z', r.oneStep && r.both.join() === '2,2' && r.bothBack.join() === '1,1', JSON.stringify([r.oneStep, r.both, r.bothBack]));
        check('flip: with Keep edits in jEditor, kept as an edit with its crop mirrored, the file untouched', r.kept && r.diskUntouched, JSON.stringify([r.kept, r.diskUntouched]));
        check('flip: the kept edit shows the left half, flipped', r.keptLook === 'red red green red', r.keptLook);
        check('flip: flipped twice is the edit it was; upside down twice is no edit', r.twice && r.twiceNothing, JSON.stringify([r.twice, r.twiceNothing]));
        check('flip: flipped and turned, Write edits to file writes it losslessly in one go (orientation 7), and Ctrl+Z keeps the edit again', r.saved[0] === 7 && r.saved[1] && r.saved[2] && r.savedUndo[0] === 1 && r.savedUndo[1], JSON.stringify([r.saved, r.savedUndo]));
        check('flip: the crop editor\'s geometry goes there and back, flipped', r.roundTrip);
        check('flip: Adjust\'s masks are placed through the flip (Develop.cropMap)', r.maskMap);
        check('flip: Paint\'s layers and the crop are drawn flipped', r.paint === 'blue red' && r.drawOutput === 'blue red', JSON.stringify([r.paint, r.drawOutput]));
        check('flip: in the crop editor, flip and its own undo', r.editorFlip && r.editorBoth && r.editorUndo, JSON.stringify([r.editorFlip, r.editorBoth, r.editorUndo]));
        check('flip: Save in the crop editor writes a flip with no crop losslessly', r.editorSaved[0] === 'blue red green blue' && r.editorSaved[1] === 2, JSON.stringify(r.editorSaved));
        check('flip: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
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

    // ---- Themes ----
    if (wanted('themes')) {
        console.log('themes (themes.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            let step = 'start';
            try {
                const out = {};
                const $ = (id) => document.getElementById(id);
                const root = document.documentElement;
                const blob = async (color) => { const c = document.createElement('canvas'); c.width = 160; c.height = 120; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 160, 120); g.fillStyle = '#fff'; g.fillRect(40, 30, 60, 50); return canvasBlob(c); };
                await openProject('Summer', { 'a.png': await blob('#806040'), 'b.png': await blob('#406080'), 'c.png': await blob('#408060') });
                await until(() => app.files.every(f => f.thumbnailUrl));
                // In a browser: no themes, nothing of them in Settings
                step = 'browser';
                app.toggleCustomizePanel(true);
                app.showSettingsPage('appearance');
                out.browserNone = !Themes.can() && $('set-themes').classList.contains('hidden') && !Experiments.shown().some(x => x.id === 'themes');
                // An app with them (the Windows app's title bar calls)
                step = 'app';
                const calls = [];
                window.JEditorNative = { platform: 'windows', features: ['themes'], titleBar: (on) => calls.push('titleBar:' + on), windowAction: (a) => calls.push(a) };
                // Paused (2.0.0): an experiment, off to start with, in a beta too
                // (a dev page has no APP_BUILD: a beta's, for now)
                window.APP_BUILD = 'v2.0.0-beta.1';
                out.offered = Experiments.betaBuild() && Experiments.shown().some(x => x.id === 'themes') && !Experiments.on('themes') && !Themes.can();
                delete window.APP_BUILD;
                app.renderCustomizePanel();
                out.pickerHidden = [...document.querySelectorAll('.set-themes-part')].every(e => e.classList.contains('hidden'));
                // A theme chosen before: not on while the experiment's off
                app.uiPrefs.skin = 'xp/royale';
                Themes.apply();
                out.ownLook = !root.dataset.skin && !$('th-top');
                // Turned on (Settings → Experimental): the theme's back at once
                Experiments.set('themes', true);
                await until(() => root.dataset.skin === 'xp' && !root.classList.contains('theme-loading'));
                out.back = root.dataset.skin === 'xp' && !!$('th-top') && !$('set-themes').classList.contains('hidden');
                // Off again: jEditor's own look, and the choice kept
                Experiments.set('themes', false);
                out.offAgain = !root.dataset.skin && !$('th-top') && app.uiPrefs.skin === 'xp/royale' && calls[calls.length - 1] === 'titleBar:false';
                Experiments.set('themes', true);
                Themes.choose('');
                out.inApp = Themes.can();
                app.renderCustomizePanel();
                const cards = [...$('set-themes').querySelectorAll('.theme-card')];
                out.gallery = cards.map(c => c.dataset.skin).join() === ',xp/royale,snow/finder,mac84/finder' && cards[0].classList.contains('active');
                // Royale: its stylesheets, the docked layout, light, its title bar and menu bar
                step = 'royale';
                cards[1].click();
                await until(() => !root.classList.contains('theme-loading'));
                out.on = root.dataset.skin === 'xp' && root.dataset.layout === 'docked' && root.dataset.theme === 'light' && app.uiPrefs.skin === 'xp/royale'
                    && [...document.querySelectorAll('link[data-theme]')].map(l => l.getAttribute('href')).join() === 'themes/docked.css,themes/xp/luna.css,themes/xp/office.css,themes/xp/controls.css,themes/xp/modes.css,themes/xp/royale.css';
                out.styled = getComputedStyle(document.querySelector('.interface')).display === 'grid' && /Tahoma/.test(getComputedStyle(document.body).fontFamily);
                out.ownBar = calls.includes('titleBar:true') && !!$('th-top') && $('th-top').contains($('th-titlebar')) && $('th-top').contains($('th-menubar'))
                    && parseFloat(getComputedStyle(root).getPropertyValue('--th-top')) > 40;
                app.setView('grid');
                await until(() => $('th-titlebar').querySelector('.th-title').textContent === 'Summer - jEditor');
                out.title = $('th-titlebar').querySelector('.th-title').textContent === 'Summer - jEditor';
                app.openSingle(app.files[1]);
                await until(() => $('th-titlebar').querySelector('.th-title').textContent === 'b.png - jEditor');
                out.titleFollows = true;
                app.setView('grid');
                // The window's buttons go to the app
                $('th-titlebar').querySelector('.th-min').click();
                $('th-titlebar').querySelector('.th-max').click();
                $('th-titlebar').querySelector('.th-close').click();
                out.caps = calls.slice(-3).join() === 'minimize,maximize,close';
                dispatchEvent(new CustomEvent('jeditor-window', { detail: { maximized: true } }));
                out.maxed = $('th-titlebar').classList.contains('maximized');
                // Fitting stands down: docked bars have room for everything
                out.noFit = !$('main-interface').dataset.fit && !document.querySelector('[data-squeezed]');
                // The stylesheets write the folder's name and the counts from the app
                out.facts = $('fb-crumbs').dataset.folder === 'Summer' && $('folder-bar').dataset.info.startsWith('3 items') && $('btn-clear-selection').dataset.total === '3';
                // The menu bar: jEditor's commands, with their keys
                step = 'menus';
                const edit = [...$('th-menubar').querySelectorAll('.th-menu')].find(b => b.textContent === 'Edit');
                edit.click();
                const menu = $('context-menu');
                out.menu = !!menu && menu.classList.contains('th-dropdown') && edit.classList.contains('open')
                    && [...menu.querySelectorAll('button')].some(b => /^Select all/.test(b.textContent) && b.querySelector('.ctx-key') && b.querySelector('.ctx-key').textContent === 'Ctrl+A');
                [...menu.querySelectorAll('button')].find(b => /^Select all/.test(b.textContent)).click();
                await until(() => !edit.classList.contains('open'));
                out.ran = app.selection.size === 3 && !$('context-menu');
                // Full screen (the Mac app's, here): no title bar, the menu bar stays
                root.classList.add('fullscreen');
                out.fullscreen = getComputedStyle($('th-titlebar')).display === 'none' && getComputedStyle($('th-menubar')).display !== 'none';
                root.classList.remove('fullscreen');
                // A variant: Royale Red, another stylesheet on top
                step = 'variant';
                Themes.choose('xp/red');
                await until(() => !root.classList.contains('theme-loading'));
                out.variant = [...document.querySelectorAll('link[data-theme]')].pop().getAttribute('href') === 'themes/xp/red.css';
                // Aperture is dark
                Themes.choose('snow/aperture');
                await until(() => !root.classList.contains('theme-loading'));
                out.dark = root.dataset.skin === 'snow' && root.dataset.theme === 'dark' && !$('th-menubar');
                // 1984: its own setting, the thumbnails dithered to one bit
                step = '1984';
                Themes.choose('mac84/finder');
                await until(() => !root.classList.contains('theme-loading'));
                app.renderCustomizePanel();
                out.setting = root.dataset.tsThumbs === 'dither' && !!document.querySelector('#set-theme-settings input[value="grey"]');
                const img = () => app.files[0]._gridEl.querySelector('img');
                await until(() => img().src.startsWith('data:image/png'));
                out.dithered = img().src.startsWith('data:image/png') && !!img().dataset.undithered;
                document.querySelector('#set-theme-settings input[value="colour"]').click();
                await until(() => !img().src.startsWith('data:'));
                out.colour = root.dataset.tsThumbs === 'colour' && app.uiPrefs.skinSettings.mac84.thumbs === 'colour' && img().src === app.files[0].thumbnailUrl;
                // Kept for next time: the theme and its setting read back as at a start
                const prefs = app.uiPrefs;
                app.loadUiPrefs();
                out.kept = app.uiPrefs.skin === 'mac84/finder' && app.uiPrefs.skinSettings.mac84.thumbs === 'colour';
                app.uiPrefs = prefs;
                // Back to jEditor's own look: all of it gone, Windows' title bar back
                step = 'off';
                Themes.choose('');
                out.off = !root.dataset.skin && !root.dataset.layout && !$('th-top') && !document.querySelector('link[data-theme]')
                    && calls[calls.length - 1] === 'titleBar:false'
                    && root.dataset.theme === (app.uiPrefs.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : app.uiPrefs.theme);
                app.toggleCustomizePanel(false);
                delete window.JEditorNative;
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('themes: none in a browser; in the apps, an experiment, off to start with (betas too), the picker hidden', r.browserNone && r.offered && r.pickerHidden, JSON.stringify(r));
        check('themes: a theme chosen isn\'t on while the experiment\'s off, comes back the moment it\'s turned on, and goes (kept) when it\'s off again', r.ownLook && r.back && r.offAgain && r.inApp, JSON.stringify(r));
        check('themes: Settings → Appearance shows them as a gallery, jEditor\'s own look first', r.gallery, JSON.stringify(r));
        check('themes: one chosen puts its stylesheets on, docked, in its own light or dark', r.on && r.styled && r.dark, JSON.stringify(r));
        check('themes: its own title bar and menu bar along the top; Windows\' title bar goes', r.ownBar, JSON.stringify(r));
        check('themes: the title bar names the folder or photo; its buttons work the window', r.title && r.titleFollows && r.caps && r.maxed, JSON.stringify(r));
        check('themes: no fitting in docked bars; the folder\'s name and counts are the real ones', r.noFit && r.facts, JSON.stringify(r));
        check('themes: the menu bar\'s menus run jEditor\'s commands and show their keys', r.menu && r.ran, JSON.stringify(r));
        check('themes: a variant is one stylesheet more', r.variant, JSON.stringify(r));
        check('themes: full screen has no title bar, the menu bar stays', r.fullscreen, JSON.stringify(r));
        check('themes: the theme chosen and its settings are there at the next start', r.kept, JSON.stringify(r));
        check('themes: 1984\'s Thumbnails setting: dithered to one bit, or in colour again', r.setting && r.dithered && r.colour, JSON.stringify(r));
        check('themes: back to jEditor\'s look takes all of it off', r.off, JSON.stringify(r));

        // A narrow window, a photo selected: the selection bar and the size
        // slider share the foot bar, and the slider stays out from under it
        await page.setViewportSize({ width: 640, height: 600 });
        const foot = {};
        for (const skin of ['xp/royale', 'snow/finder', 'mac84/finder']) {
            foot[skin] = await page.evaluate(async (skin) => {
                window.JEditorNative = { platform: 'windows', features: ['themes'], titleBar: () => { }, windowAction: () => { } };
                Themes.choose(skin);
                await until(() => !document.documentElement.classList.contains('theme-loading'));
                app.setView('grid');
                app.goTo(app.files[1]);
                await sleep(300);
                const s = app.elements.gridSizeSlider, r = s.getBoundingClientRect();
                // Its buttons as shown (a bar that scrolls clips the rest)
                const box = document.getElementById('selection-bar').getBoundingClientRect();
                const bar = [...document.querySelectorAll('#selection-bar > *')].map(b => b.getBoundingClientRect()).filter(b => b.width)
                    .map(b => ({ left: Math.max(b.left, box.left), right: Math.min(b.right, box.right), top: b.top, bottom: b.bottom }));
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return { w: Math.round(r.width), hit: hit === s, under: bar.some(b => b.right > r.left + 1 && b.left < r.right - 1 && b.bottom > r.top && b.top < r.bottom) };
            }, skin);
        }
        await page.evaluate(() => { Themes.choose(''); delete window.JEditorNative; });
        await page.setViewportSize({ width: 1280, height: 720 });
        check('themes: in a narrow window the size slider stays clear of the selection bar, and takes a click', Object.values(foot).every(f => f.w >= 40 && f.hit && !f.under), JSON.stringify(foot));
        check('themes: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // TIFFs as other programs write them (made with Pillow, 12 × 8: dark blue
    // with a red block at 4–8, 2–4): LZW with the predictor, PackBits,
    // Deflate, a palette, and one turned (Orientation 6) with a camera and date
    const TIFFS = {
        "lzw": "SUkqAEYAAACAAoIFoAQWDQeEQmFQiBQSFw+IQyBw9fA5iREAEJ5DyEw2KRaMRqORKHQqKxeIyKOxOMS2FR6XTGDTCZTGAgsAAAEDAAEAAAAMAAAAAQEDAAEAAAAIAAAAAgEDAAMAAADQAAAAAwEDAAEAAAAFAAAABgEDAAEAAAACAAAAEQEEAAEAAAAIAAAAFQEDAAEAAAADAAAAFgEDAAEAAAAIAAAAFwEEAAEAAAA+AAAAHAEDAAEAAAABAAAAPQEDAAEAAAACAAAAAAAAAAgACAAIAA==",
        "packbits": "SUkqADABAAAjChBaChBaChBaChBaChBaChBaChBaChBaChBaChBaChBaChBaIwoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWiMKEFoKEFoKEFoKEFrIHh7IHh7IHh7IHh7IHh4KEFoKEFoKEFojChBaChBaChBaChBayB4eyB4eyB4eyB4eyB4eChBaChBaChBaIwoQWgoQWgoQWgoQWsgeHsgeHsgeHsgeHsgeHgoQWgoQWgoQWiMKEFoKEFoKEFoKEFoKEFoKEFoKEFoKEFoKEFoKEFoKEFoKEFojChBaChBaChBaChBaChBaChBaChBaChBaChBaChBaChBaChBaIwoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoAAAEDAAEAAAAMAAAAAQEDAAEAAAAIAAAAAgEDAAMAAACuAQAAAwEDAAEAAAAFgAAABgEDAAEAAAACAAAAEQEEAAEAAAAIAAAAFQEDAAEAAAADAAAAFgEDAAEAAAAIAAAAFwEEAAEAAAAoAQAAHAEDAAEAAAABAAAAAAAAAAgACAAIAA==",
        "deflate": "SUkqACAAAAB4nOMSiOKiNjohJ4eMaKqG1ggAz6kz8QAKAAABAwABAAAADAAAAAEBAwABAAAACAAAAAIBAwADAAAAngAAAAMBAwABAAAACAAAAAYBAwABAAAAAgAAABEBBAABAAAACAAAABUBAwABAAAAAwAAABYBAwABAAAACAAAABcBBAABAAAAFwAAABwBAwABAAAAAQAAAAAAAAAIAAgACAA=",
        "palette": "SUkqAAgAAAAKAAABBAABAAAADAAAAAEBBAABAAAACAAAAAIBAwABAAAACAAAAAMBAwABAAAAAQAAAAYBAwABAAAAAwAAABEBBAABAAAAhgYAABYBBAABAAAACAAAABcBBAABAAAAYAAAABwBAwABAAAAAQAAAEABAwAAAwAAhgAAAAAAAAAAyAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AWgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAABAQEBAQEBAAAAAAABAQEBAQEBAAAAAAABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        "turned": "SUkqAAgAAAANAAABBAABAAAADAAAAAEBBAABAAAACAAAAAIBAwADAAAAqgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAAA8BAgAGAAAAsAAAABEBBAABAAAAygAAABIBAwABAAAABgAAABUBAwABAAAAAwAAABYBBAABAAAACAAAABcBBAABAAAAIAEAABwBAwABAAAAAQAAADIBAgAUAAAAtgAAAAAAAAAIAAgACABFcHNvbgAyMDAxOjAyOjAzIDA0OjA1OjA2AAoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWsgeHsgeHsgeHsgeHsgeHgoQWgoQWgoQWgoQWgoQWgoQWgoQWsgeHsgeHsgeHsgeHsgeHgoQWgoQWgoQWgoQWgoQWgoQWgoQWsgeHsgeHsgeHsgeHsgeHgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWgoQWg=="
    };

    // ---- Redo in Photos: every kind of undo step, done again ----
    if (wanted('redo')) {
        console.log('redo: Ctrl+Shift+Z and Ctrl+Y do again what Ctrl+Z took back, every kind of step, never losing a file (script.js, history.js)');
        const { page, issues } = await open();
        const r = await page.evaluate(async () => {
            const out = {};
            let step = 'project';
            try {
                const jpeg = async (i, w = 240, h = 160) => {
                    const c = scene(w, h, { rect: { x: 10 + i * 20, y: 10, w: 40, h: 30, color: ['#c03020', '#2050c0', '#20a050', '#a020c0'][i % 4] } });
                    return canvasBlob(c, 'image/jpeg', 0.92);
                };
                const png = await canvasBlob(scene(200, 140), 'image/png');
                const dir = await openProject('redo', { 'a.jpg': await jpeg(0), 'b.jpg': await jpeg(1), 'c.jpg': await jpeg(2), 'd.png': png, 'Sub/e.jpg': await jpeg(3) });
                // Turns and flips written into the files (not kept as edits), as with Keep edits off
                app.uiPrefs.keepEdits = false;
                const F = (n) => app.files.find(f => f.name === n);
                const a = F('a.jpg'), b = F('b.jpg'), c = F('c.jpg'), d = F('d.png');
                // A file's bytes, as a short signature
                const sig = async (f) => {
                    const u = new Uint8Array(await (await f.handle.getFile()).arrayBuffer());
                    let h = 0;
                    for (let i = 0; i < u.length; i++) h = (Math.imul(h, 31) + u[i]) | 0;
                    return `${u.length}:${h}`;
                };
                const settled = async (...fs) => { for (const f of fs) await until(() => !f._rotationQueue && !f.isBusy && !f._flipping); await sleep(50); };
                const top = () => app._undoStack[app._undoStack.length - 1];
                // Undone, redone, undone again: what each gives (fn → a value to compare)
                const cycle = async (look) => {
                    const done = await look();
                    await app.undo();
                    const undone = await look();
                    const could = app.canRedo();
                    const redid = await app.redo();
                    const redone = await look();
                    await app.undo();
                    const again = await look();
                    return { changed: done !== undone, redo: could && redid && redone === done, undoAgain: again === undone, done, undone, redone, again };
                };
                const kinds = out.kinds = {};

                step = 'rotate';
                let s0 = await sig(a);
                await app.rotateImage(a, 90);
                await settled(a);
                kinds.rotate = { type: top().type, ...(await cycle(() => sig(a))), back: (await sig(a)) === s0 };

                step = 'group';
                app.viewMode = 'grid';
                app.selection = new Set([a, b]);
                await app.rotateBulk(90);
                await top().done;
                await settled(a, b);
                kinds.group = { type: top().type, ...(await cycle(async () => (await sig(a)) + (await sig(b)))) };
                app.selection = new Set();

                step = 'flip';
                await app.flipFiles([a], 'h');
                await settled(a);
                kinds.flip = { type: top().type, ...(await cycle(async () => (await sig(a)))) };

                step = 'bytes';
                {
                    const old = await (await d.handle.getFile()).arrayBuffer();
                    const w = await d.handle.createWritable();
                    await w.write(await canvasBlob(scene(180, 120, { rect: { x: 5, y: 5, w: 30, h: 30, color: '#f00' } }), 'image/png'));
                    await w.close();
                    app.pushUndo({ type: 'bytes', file: d, blob: new Blob([old], { type: 'image/png' }), label: 'crop' });
                    await app.afterFileChanged(d);
                }
                kinds.bytes = { type: top().type, ...(await cycle(() => sig(d))) };

                step = 'rename';
                await app.renameFile(b, 'b2.jpg');
                kinds.rename = { type: top().type, ...(await cycle(() => b.name)) };

                step = 'batch-rename';
                await app.renameMany([{ file: b, newName: 'x1.jpg' }, { file: c, newName: 'x2.jpg' }]);
                kinds['batch-rename'] = { type: top().type, ...(await cycle(() => b.name + ',' + c.name)) };

                step = 'flags';
                Flags.apply('star', [a]);
                kinds.flags = { type: top().type, ...(await cycle(() => String(!!(a._flags && a._flags.star)))) };

                step = 'edits';
                Edits.rotate([b], 90);
                kinds.edits = { type: top().type, ...(await cycle(() => JSON.stringify(b._edit || null))) };

                step = 'auto-crop';
                {
                    const entry = await app.snapshot([c], 'auto crop');
                    const w = await c.handle.createWritable();
                    await w.write(await jpeg(3, 200, 120));
                    await w.close();
                    await app.afterFileChanged(c);
                    app.pushUndo(entry);
                }
                kinds['auto-crop'] = { type: top().type, ...(await cycle(() => sig(c))) };

                step = 'saved-edits';
                Edits.rotate([a], 90);
                await app.saveOverOriginal([a], { how: 'originals' });
                await settled(a);
                kinds['saved-edits'] = { type: top().type, ...(await cycle(async () => (await sig(a)) + '|' + JSON.stringify(a._edit || null))) };

                step = 'folder-create';
                {
                    const { created } = await Folders.createPath('', 'New one');
                    app.pushUndo({ type: 'folder-create', paths: created });
                    Folders.afterChange();
                }
                const has = (p) => Folders.find(p) !== null;
                kinds['folder-create'] = { type: top().type, ...(await cycle(() => String(has('New one')))) };

                step = 'folder-rename';
                {
                    const to = await Folders.renameDir('Sub', 'Sub2');
                    app.pushUndo({ type: 'folder-rename', path: to, name: 'Sub' });
                    Folders.afterChange();
                }
                kinds['folder-rename'] = { type: top().type, ...(await cycle(() => `${has('Sub')} ${has('Sub2')} ${Folders.dirOf(F('e.jpg'))}`)) };

                step = 'folder-delete';
                await Folders.createPath('', 'Empty');
                Folders.afterChange();
                await Folders.deleteFolder('Empty');
                kinds['folder-delete'] = { type: top().type, ...(await cycle(() => String(has('Empty')))) };

                step = 'relocate';
                await Folders.relocate([b], 'Sub');
                kinds.relocate = { type: top().type, ...(await cycle(() => Folders.dirOf(b) + '/' + b.name)) };

                step = 'relocate copy';
                const copies = () => app.files.filter(f => f.name === c.name).map(f => Folders.dirOf(f)).sort().join();
                await Folders.relocate([c], 'Sub', { copy: true });
                kinds['relocate (copy)'] = { type: top().type, ...(await cycle(copies)) };

                step = 'folder-out';
                {
                    const opfs = await navigator.storage.getDirectory();
                    try { await opfs.removeEntry('redo-outside', { recursive: true }); } catch (e) { /* fresh */ }
                    const outside = await opfs.getDirectoryHandle('redo-outside', { create: true });
                    const names = async () => { const n = []; for await (const k of outside.keys()) n.push(k); return n.sort().join(); };
                    await Folders.sendFiles(outside, [c], true);
                    kinds['folder-out (copy)'] = { type: top().type, ...(await cycle(names)) };
                }

                step = 'convert';
                if (!window.SKIP_CONVERT) {
                    Convert.prefs.format = 'webp';
                    Convert.prefs.keep = false;
                    await Convert.open({ files: [d] });
                    await until(() => Convert.est && !Convert.est.working, 600);
                    Convert.go();
                    await until(() => Convert.done, 800);
                    Convert.go(); // Done
                    const look = async () => { await until(() => !Convert.run, 800); if (Convert.done) Convert.go(); return d.name; };
                    kinds.convert = { type: top().type, ...(await cycle(look)) };
                }

                step = 'trash';
                await app.moveToTrash([b]);
                kinds.trash = { type: top().type, ...(await cycle(() => String(app.files.includes(b)))) };
                out.kinds = kinds;

                // Nothing lost: the project's photos are all still there (by name)
                out.files = app.files.map(f => (f.relPath || f.name)).sort().join();

                // A new step clears what can be redone, and the copies kept for it
                step = 'cleared';
                const originals = async () => {
                    const root = await FolderCache.root(app, false);
                    const o = await root.getDirectoryHandle('originals').catch(() => null);
                    let n = 0;
                    if (o) for await (const k of o.keys()) if (/-redo-/.test(k)) n++;
                    return n;
                };
                await app.rotateImage(c, 90);
                await settled(c);
                await app.undo();
                out.keptCopy = (await originals()) > 0 || app._redoStack[app._redoStack.length - 1].type === 'rotate';
                Flags.apply('star', [c]);
                await sleep(100);
                out.cleared = !app.canRedo() && (await originals()) === 0;

                // The keys: Ctrl+Y and Ctrl+Shift+Z
                step = 'keys';
                Flags.apply('reject', [a]);
                await app.undo();
                pressKey('y', { ctrlKey: true });
                await until(() => !!(a._flags && a._flags.reject));
                out.ctrlY = !!(a._flags && a._flags.reject);
                await app.undo();
                pressKey('z', { ctrlKey: true, shiftKey: true });
                await until(() => !!(a._flags && a._flags.reject));
                out.ctrlShiftZ = !!(a._flags && a._flags.reject);

                // The undo's message offers Redo
                step = 'toast';
                await app.undo();
                const toast = [...document.querySelectorAll('#toast-stack .toast')].reverse().find(t => /Undid/.test(t.textContent));
                const btn = toast && toast.querySelector('.toast-action');
                out.toastRedo = !!btn && /Redo/.test(btn.textContent);
                if (btn) btn.click();
                await until(() => !!(a._flags && a._flags.reject));
                out.toastRedid = !!(a._flags && a._flags.reject);

                // The undo history: a Redo row above the steps
                step = 'history';
                await app.undo();
                History.toggle(true);
                const row = document.getElementById('history-redo');
                out.historyRow = !row.classList.contains('hidden') && /Redo: Reject/.test(row.textContent);
                row.click();
                await until(() => !!(a._flags && a._flags.reject));
                out.historyRedid = !!(a._flags && a._flags.reject) && row.classList.contains('hidden');
                History.toggle(false);

                // The Edit menu has Redo, as Photos' own now
                step = 'menu';
                const edit = MenuBar.items('Edit');
                const redoItem = edit.find(i => i.label === 'Redo');
                out.menu = !!redoItem && redoItem.id === 'edit.redo' && redoItem.enabled;
                out.nothing = (await app.redo()) === false;
            } catch (e) {
                out.error = `${step}: ${e.message}`;
            }
            return out;
        });
        check('redo: no error on the way', !r.error, r.error);
        const kinds = r.kinds || {};
        const want = ['rotate', 'group', 'flip', 'bytes', 'rename', 'batch-rename', 'flags', 'edits', 'auto-crop', 'saved-edits', 'folder-create', 'folder-rename', 'folder-delete', 'relocate', 'relocate (copy)', 'folder-out (copy)', 'convert', 'trash'];
        for (const k of want) {
            const v = kinds[k];
            check(`redo: ${k} — undone, redone as it was done, and undone again`, !!v && v.changed && v.redo && v.undoAgain, JSON.stringify(v));
        }
        check('redo: every photo still there after all of it', r.files === 'Sub/e.jpg,a.jpg,b.jpg,c.jpg,d.png', r.files);
        check('redo: something new done clears what could be redone, and the copies kept for it', r.keptCopy && r.cleared, JSON.stringify([r.keptCopy, r.cleared]));
        check('redo: Ctrl+Y and Ctrl+Shift+Z', r.ctrlY && r.ctrlShiftZ, JSON.stringify([r.ctrlY, r.ctrlShiftZ]));
        check('redo: the undo\'s message has Redo, and it redoes', r.toastRedo && r.toastRedid, JSON.stringify([r.toastRedo, r.toastRedid]));
        check('redo: the undo history has a Redo row above the steps, and it redoes', r.historyRow && r.historyRedid, JSON.stringify([r.historyRow, r.historyRedid]));
        check('redo: Edit → Redo is Photos\' own; with nothing to redo, nothing happens', r.menu && r.nothing, JSON.stringify([r.menu, r.nothing]));
        check('redo: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- Convert: AVIF, JPEG XL and WebP, their quality and storage (codec.js, convert.js) ----
    if (wanted('convert')) {
        console.log('convert: AVIF, JPEG XL, WebP, JPEG, PNG and TIFF, their EXIF, quality and storage, converting and Ctrl+Z (codec.js, convert.js, tiff.js)');
        const { page, issues } = await open();
        await page.evaluate((t) => { window.TIFFS = t; }, TIFFS);
        const r = await page.evaluate(async () => {
            let step = 'codecs';
            try {
                const out = {};
                // EXIF by hand: Make "jEd", taken 2019-07-04 12:34:56, turned (orientation 6)
                const exif = (() => {
                    const b = new Uint8Array(100), v = new DataView(b.buffer), enc = new TextEncoder();
                    b.set([0x4D, 0x4D, 0, 42]); v.setUint32(4, 8);
                    v.setUint16(8, 3);
                    v.setUint16(10, 0x010F); v.setUint16(12, 2); v.setUint32(14, 4); b.set(enc.encode('jEd\0'), 18);
                    v.setUint16(22, 0x0112); v.setUint16(24, 3); v.setUint32(26, 1); v.setUint16(30, 6);
                    v.setUint16(34, 0x8769); v.setUint16(36, 4); v.setUint32(38, 1); v.setUint32(42, 50);
                    v.setUint32(46, 0);
                    v.setUint16(50, 1); v.setUint16(52, 0x9003); v.setUint16(54, 2); v.setUint32(56, 20); v.setUint32(60, 68); v.setUint32(64, 0);
                    b.set(enc.encode('2019:07:04 12:34:56\0'), 68);
                    return b.slice(0, 88);
                })();
                const jpegWithExif = async (c) => new Blob([ImageMeta.withExifJpeg(new Uint8Array(await (await canvasBlob(c, 'image/jpeg', 0.95)).arrayBuffer()), exif)], { type: 'image/jpeg' });
                // A clean picture (no grain: grain has to be kept to look the
                // same, which takes the quality up), as photos of things are
                const clean = (w, h, i) => {
                    const c = document.createElement('canvas'); c.width = w; c.height = h;
                    const g = c.getContext('2d');
                    const grad = g.createLinearGradient(0, 0, w, h);
                    grad.addColorStop(0, '#203860'); grad.addColorStop(0.5, '#d0a070'); grad.addColorStop(1, '#f0e8d0');
                    g.fillStyle = grad; g.fillRect(0, 0, w, h);
                    for (let k = 0; k < 6; k++) {
                        g.fillStyle = ['#2050c0', '#c03020', '#20a050', '#a020c0', '#f0c030', '#303030'][(k + i) % 6];
                        g.beginPath(); g.arc(w * (0.15 + k * 0.14), h * (0.3 + 0.4 * ((k + i) % 2)), h * 0.12, 0, Math.PI * 2); g.fill();
                    }
                    g.fillStyle = '#fff'; g.font = `${h / 8}px sans-serif`; g.fillText('jEditor ' + i, w * 0.1, h * 0.9);
                    return c;
                };
                out.ready = await Codec.ready();
                const pic = clean(320, 200, 0);
                const src = await jpegWithExif(pic);
                out.formats = {};
                // The bundled JPEG XL decoder is checked even where the engine
                // has its own (newer Chromium does), by saying it hasn't
                out.engineJxl = await Codec.engineJxl();
                const engineJxl = Codec._engineJxl;
                Codec._engineJxl = Promise.resolve(false);
                for (const f of ['avif', 'jxl', 'webp']) {
                    const blob = await Codec.file(src, f, 70, ImageMeta.exifOf(new Uint8Array(await src.arrayBuffer())));
                    const bytes = new Uint8Array(await blob.arrayBuffer());
                    const t = ImageMeta.exifOf(bytes);
                    const info = t && app.readTiffInfo(new DataView(t.buffer, t.byteOffset, t.byteLength), 0);
                    // Orientation 1 now: the pixels are upright (the JPEG was shown turned)
                    const ifd = t && ImageMeta.readIfd({ view: new DataView(t.buffer, t.byteOffset, t.byteLength), tiff: 0, le: false, end: t.length }, 8);
                    const orient = ifd && ifd.entries.find(e => e.tag === 0x0112);
                    const shown = await createImageBitmap(f === 'jxl' ? await Codec.showable(new File([blob], 'p.jxl')) : blob);
                    out.formats[f] = [info && info.make, info && info.dateTaken && info.dateTaken.getFullYear(), orient && new DataView(t.buffer, t.byteOffset).getUint16(orient.pos + 8), shown.width, shown.height, bytes.length < src.size];
                    shown.close();
                }
                Codec._engineJxl = engineJxl;

                // TIFFs read (tiff.js), as other programs write them
                step = 'tiff';
                out.tiffs = {};
                for (const [k, b64] of Object.entries(window.TIFFS)) {
                    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                    const bmp = await createImageBitmap(await Codec.showable(new File([bytes], k + '.tif')));
                    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
                    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
                    const at = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)].map(v => Math.round(v / 10) * 10);
                    const ex = k === 'turned' && ImageMeta.exifOf(bytes);
                    out.tiffs[k] = k === 'turned' ? [bmp.width, bmp.height, (app.readTiffInfo(new DataView(ex.buffer, ex.byteOffset, ex.byteLength), 0) || {}).make] : [bmp.width, bmp.height, String(at(5, 3)), String(at(0, 0))];
                }
                // JPEG, PNG and TIFF written with the EXIF too
                for (const f of ['jpeg', 'png', 'tiff']) {
                    const blob = await Codec.file(src, f, 85, ImageMeta.exifOf(new Uint8Array(await src.arrayBuffer())));
                    const bytes = new Uint8Array(await blob.arrayBuffer());
                    const t = ImageMeta.exifOf(bytes);
                    const info = t && app.readTiffInfo(new DataView(t.buffer, t.byteOffset, t.byteLength), 0);
                    const shown = await createImageBitmap(f === 'tiff' ? await Codec.showable(new File([blob], 'p.tif')) : blob);
                    out.formats[f] = [info && info.make, info && info.dateTaken && info.dateTaken.getFullYear(), shown.width, shown.height];
                    shown.close();
                }

                // A project: two folders of photos, and a tiny one that won't get smaller
                step = 'estimate';
                const files = {};
                for (let i = 0; i < 4; i++) files[(i < 2 ? 'Ceremony/' : 'Party/') + `p${i}.jpg`] = await jpegWithExif(clean(900, 600, i));
                const tiny = document.createElement('canvas'); tiny.width = tiny.height = 4;
                files['tiny.png'] = await canvasBlob(tiny, 'image/png');
                const dir = await openProject('space', files);
                const P0 = app.files.find(f => f.name === 'p0.jpg');
                P0._flags = { star: true };
                Edits.set([{ file: P0, edit: { q: 1, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 }, size: P0.size } }], 'rotation');
                Convert.prefs.format = 'avif';
                Convert.prefs.keep = false;
                await Convert.open({ folder: '' });
                await until(() => Convert.est && !Convert.est.working, 600);
                const est = Convert.est;
                out.estimate = [est.total > 0, est.after > 0 && est.after < est.total, est.byDir && est.byDir.size, !!Convert.suggested.avif, Convert.el('cv-folders').children.length];
                out.closeUp = Convert.el('cv-after-cap').textContent.startsWith('After');

                // Converting: each photo AVIF in its place, flags and edit with it
                step = 'convert';
                Convert.go();
                await until(() => Convert.done, 800);
                const done = Convert.done;
                out.done = { saved: done.saved > 0, same: done.same, failed: done.failed, dots: Convert.el('cv-dots').children.length, hollow: Convert.el('cv-dots').querySelectorAll('.f').length };
                out.names = app.files.map(f => f.relPath || f.name).sort().join();
                out.kept = [P0.name, !!(P0._flags && P0._flags.star), !!P0._edit && P0._edit.size === P0.size];
                const info = await app.getExifInfo(P0);
                out.date = info && info.dateTaken && info.dateTaken.getFullYear();
                const onDisk = async () => {
                    const names = [];
                    for (const d of ['Ceremony', 'Party']) for await (const e of (await dir.getDirectoryHandle(d)).values()) names.push(`${d}/${e.name}`);
                    for await (const e of dir.values()) if (e.kind === 'file') names.push(e.name);
                    return names.sort().join();
                };
                out.disk = await onDisk();
                Convert.go(); // Done
                out.closed = !Convert.isOpen();

                // Ctrl+Z: the originals back, by their names, flags and edit too
                step = 'undo';
                await app.undo();
                out.undone = app.files.map(f => f.relPath || f.name).sort().join();
                out.undoneDisk = await onDisk();
                out.undoneKept = [P0.name, !!(P0._flags && P0._flags.star), !!P0._edit && P0._edit.size === P0.size];

                // Keep both: smaller copies in their own folder, not in the project
                step = 'keep';
                Convert.prefs.format = 'webp';
                Convert.prefs.keep = true;
                await Convert.open({ folder: 'Party' });
                await until(() => Convert.est && !Convert.est.working, 600);
                Convert.go();
                await until(() => Convert.done, 800);
                Convert.go();
                const copies = [];
                for await (const e of (await (await dir.getDirectoryHandle('jEditor Converted')).getDirectoryHandle('Party')).values()) copies.push(e.name);
                out.copies = copies.sort().join();
                out.notListed = !app.files.some(f => /jEditor Converted/.test(f.relPath || '')) && Watch.skipDir('jEditor Converted');

                // Export as AVIF: a copy that's an AVIF, its EXIF with it
                step = 'export';
                await app.exportCopies([P0], { maxEdge: 0, format: 'avif' });
                const ex = await (await (await dir.getDirectoryHandle('jEditor Export')).getFileHandle('p0.avif')).getFile();
                const exBytes = new Uint8Array(await ex.arrayBuffer());
                const exBmp = await createImageBitmap(ex);
                const exT = ImageMeta.exifOf(exBytes);
                const exInfo = exT && app.readTiffInfo(new DataView(exT.buffer, exT.byteOffset, exT.byteLength), 0);
                // One photo, from its right-click menu: Convert… for it alone
                step = 'one';
                const tile = app.files.find(f => f.name === 'p1.jpg')._gridEl;
                const items = tile ? app.buildContextItems(tile, false) : app.buildContextItems(null, true);
                const conv = items.find(it => it[0] === 'Convert…');
                out.oneMenu = !!conv;
                Convert.prefs.format = 'jpeg'; Convert.prefs.keep = false; Convert.est = null;
                if (conv) conv[1]();
                await until(() => Convert.est && !Convert.est.working, 600);
                out.oneScope = [Convert.scope.all.length, document.getElementById('cv-src-name').textContent];
                Convert.prefs.format = 'png'; Convert.est = null;
                Convert.setFormat('png');
                await until(() => Convert.est && !Convert.est.working, 600);
                Convert.go();
                await until(() => Convert.done, 800);
                out.one = app.files.map(f => f.relPath || f.name).sort().join();
                Convert.go();
                await app.undo();

                // Upright (600 × 900), then turned a quarter by its edit
                out.exported = [exBmp.width, exBmp.height, exInfo && exInfo.make];
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        const fmts = r.formats || {};
        check('convert: the codecs load; AVIF, JPEG XL and WebP are written with their EXIF (date, camera; upright), smaller, and shown',
            r.ready && ['avif', 'jxl', 'webp'].every(f => JSON.stringify(fmts[f]) === '["jEd",2019,1,200,320,true]'), JSON.stringify(r));
        const tf = r.tiffs || {};
        check('convert: TIFFs as other programs write them are read: LZW, PackBits, Deflate, a palette; one turned, with its camera',
            ['lzw', 'packbits', 'deflate', 'palette'].every(k => tf[k] && tf[k][0] === 12 && tf[k][1] === 8 && tf[k][2] === '200,30,30' && tf[k][3] === '10,20,90') && String(tf.turned) === '8,12,Epson', JSON.stringify(tf));
        check('convert: JPEG, PNG and TIFF are written with the EXIF (camera, date), and shown', ['jpeg', 'png', 'tiff'].every(f => JSON.stringify(fmts[f]) === '["jEd",2019,200,320]'), JSON.stringify([fmts.jpeg, fmts.png, fmts.tiff]));
        check('convert: JPEG XL is shown by the bundled decoder where the engine can\'t', !!(fmts.jxl && fmts.jxl[3] === 200), JSON.stringify([r.engineJxl, fmts.jxl]));
        check('convert: the quality that looks the same, a close-up, and the storage now and after from a sample, by folder', r.estimate && String(r.estimate) === 'true,true,3,true,3' && r.closeUp, JSON.stringify(r.estimate));
        check('convert: the photos are AVIF in their places; one that wouldn\'t get smaller is left; the dots fill', r.names === 'Ceremony/p0.avif,Ceremony/p1.avif,Party/p2.avif,Party/p3.avif,tiny.png' &&
            r.disk === 'Ceremony/p0.avif,Ceremony/p1.avif,Party/p2.avif,Party/p3.avif,tiny.png' && r.done && r.done.saved && r.done.same === 1 && !r.done.failed && r.done.dots === 100 && r.done.hollow > 0, JSON.stringify([r.names, r.disk, r.done]));
        check('convert: flags, the edit and the date taken go with a photo', r.kept && r.kept[0] === 'p0.avif' && r.kept[1] && r.kept[2] && r.date === 2019, JSON.stringify([r.kept, r.date]));
        check('convert: Ctrl+Z puts the originals back, by name, with their flags and edits', r.undone === 'Ceremony/p0.jpg,Ceremony/p1.jpg,Party/p2.jpg,Party/p3.jpg,tiny.png' &&
            r.undoneDisk === r.undone && r.undoneKept && r.undoneKept[0] === 'p0.jpg' && r.undoneKept[1] && r.undoneKept[2], JSON.stringify([r.undone, r.undoneDisk, r.undoneKept]));
        check('convert: Keep both puts the converted copies in "jEditor Converted", not in the project', r.copies === 'p2.webp,p3.webp' && r.notListed, JSON.stringify([r.copies, r.notListed]));
        check('convert: one photo, from its right-click menu', r.oneMenu && r.oneScope && r.oneScope[0] === 1 && r.oneScope[1] === 'p1.jpg' && r.one === 'Ceremony/p0.jpg,Ceremony/p1.png,Party/p2.jpg,Party/p3.jpg,tiny.png', JSON.stringify([r.oneMenu, r.oneScope, r.one]));
        check('export: as AVIF, with the edit and the EXIF', r.exported && String(r.exported) === '900,600,jEd', JSON.stringify(r.exported));
        check('convert: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        // Saves still going (flags, edits) finished first: Chromium 141 aborts
        // when a page closes with a file being written
        await page.evaluate(async () => { Codec.stop(); await Edits.flush(); if (Flags._saveTimer) { clearTimeout(Flags._saveTimer); await Flags.save(); } await sleep(300); });
        await page.close();

        // Any folder, from the start page: converted where it is, not opened
        const p2 = await open();
        const o = await p2.page.evaluate(async () => {
            let step = 'folder';
            // The start page's Convert photos, then Photos… or A folder… from its menu
            window.startConvert = async (item) => {
                document.getElementById('start-convert').click();
                await until(() => document.getElementById('context-menu'), 40);
                [...document.querySelectorAll('#context-menu button')].find(b => b.textContent === item).click();
            };
            try {
                const out = {};
                const opfs = await navigator.storage.getDirectory();
                try { await opfs.removeEntry('Holiday', { recursive: true }); } catch (e) { /* fresh */ }
                const dir = await opfs.getDirectoryHandle('Holiday', { create: true });
                const day = await dir.getDirectoryHandle('Day 1', { create: true });
                for (let i = 0; i < 3; i++) {
                    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
                    const g = c.getContext('2d'); g.fillStyle = ['#2050c0', '#c03020', '#20a050'][i]; g.fillRect(0, 0, 600, 400);
                    g.fillStyle = '#fff'; g.beginPath(); g.arc(200 + i * 80, 200, 90, 0, Math.PI * 2); g.fill();
                    const h = await (i ? day : dir).getFileHandle(`IMG_${i}.jpg`, { create: true });
                    const w = await h.createWritable(); await w.write(await canvasBlob(c, 'image/jpeg', 0.95)); await w.close();
                }
                const names = async () => {
                    const n = [];
                    for await (const e of dir.values()) if (e.kind === 'file') n.push(e.name);
                    for await (const e of day.values()) n.push('Day 1/' + e.name);
                    return n.sort().join();
                };
                window.showDirectoryPicker = async () => dir;
                Convert.prefs.format = 'avif';
                Convert.prefs.keep = false;
                await startConvert('A folder…');
                await until(() => Convert.est && !Convert.est.working, 600);
                out.chosen = [document.getElementById('cv-src-name').textContent, [...document.querySelectorAll('.cv-folder .n')].map(e => e.firstChild.textContent).sort().join()];
                step = 'convert';
                Convert.go();
                await until(() => Convert.done, 800);
                out.converted = await names();
                const trash = [];
                for await (const e of (await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('trash')).values()) trash.push(e.name);
                out.trash = trash.sort().join();
                out.notOpened = !app.dirHandle && !app.files.length && !document.getElementById('drop-zone').classList.contains('hidden');
                step = 'put back';
                document.getElementById('cv-cancel').click();
                await until(async () => (await names()).includes('IMG_0.jpg'), 100);
                await sleep(200);
                out.back = await names();
                out.stillStart = !app.files.length && !document.getElementById('drop-zone').classList.contains('hidden');
                // To TIFF: lossless, so bigger than the JPEGs, converted anyway
                step = 'tiff';
                Convert.prefs.format = 'tiff';
                Convert.est = null;
                await startConvert('A folder…');
                await until(() => Convert.est && !Convert.est.working, 600);
                out.tiffEstimate = [Convert.est.after > Convert.est.total, !document.getElementById('cv-lossless').classList.contains('hidden')];
                Convert.go();
                await until(() => Convert.done, 800);
                out.tiff = [await names(), document.getElementById('cv-saved-word').textContent, Convert.done.same];
                Convert.go();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('convert: from the start page, any folder: its photos and its folders\', without opening it', o.chosen && o.chosen[0] === 'Holiday · 3 photos' && o.chosen[1] === 'Day 1,Holiday', JSON.stringify(o));
        check('convert: a folder chosen is converted where it is, its originals in its own .jeditor/trash, not opened as the project', o.converted === 'Day 1/IMG_1.avif,Day 1/IMG_2.avif,IMG_0.avif' && o.trash === 'IMG_0.jpg,IMG_1.jpg,IMG_2.jpg' && o.notOpened, JSON.stringify(o));
        check('convert: Put the originals back puts them back by name, still on the start page', o.back === 'Day 1/IMG_1.jpg,Day 1/IMG_2.jpg,IMG_0.jpg' && o.stillStart, JSON.stringify(o));
        check('convert: to TIFF (lossless): converted though bigger, the storage says how much more', String(o.tiffEstimate) === 'true,true' && o.tiff && o.tiff[0] === 'Day 1/IMG_1.tif,Day 1/IMG_2.tif,IMG_0.tif' && o.tiff[1] === 'more storage' && o.tiff[2] === 0, JSON.stringify([o.tiffEstimate, o.tiff]));
        check('convert (a folder chosen): no JS errors', p2.issues.errors.length === 0, p2.issues.errors.join('; '));
        await p2.page.evaluate(async () => { Codec.stop(); await sleep(300); });
        await p2.page.close();

        // Photos picked on the start page: converted there, its progress and
        // what it did shown there; the folder they're in asked for first
        const p3 = await open();
        const q = await p3.page.evaluate(async () => {
            let step = 'photos';
            const drop = () => document.getElementById('drop-zone');
            const box = () => document.getElementById('start-convert-run');
            const shown = (el) => !!el && !el.classList.contains('hidden') && el.getBoundingClientRect().height > 0;
            const pick = async (item) => {
                document.getElementById('start-convert').click();
                await until(() => document.getElementById('context-menu'), 40);
                [...document.querySelectorAll('#context-menu button')].find(b => b.textContent === item).click();
            };
            try {
                const out = {};
                const opfs = await navigator.storage.getDirectory();
                for (const n of ['Scans', 'Out']) { try { await opfs.removeEntry(n, { recursive: true }); } catch (e) { /* fresh */ } }
                const dir = await opfs.getDirectoryHandle('Scans', { create: true });
                const sub = await dir.getDirectoryHandle('1998', { create: true });
                const outDir = await opfs.getDirectoryHandle('Out', { create: true });
                const made = [];
                for (let i = 0; i < 3; i++) {
                    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
                    const g = c.getContext('2d'); g.fillStyle = ['#2050c0', '#c03020', '#20a050'][i]; g.fillRect(0, 0, 600, 400);
                    g.fillStyle = '#fff'; g.beginPath(); g.arc(200 + i * 80, 200, 90, 0, Math.PI * 2); g.fill();
                    const h = await (i ? sub : dir).getFileHandle(`scan${i}.jpg`, { create: true });
                    const w = await h.createWritable(); await w.write(await canvasBlob(c, 'image/jpeg', 0.95)); await w.close();
                    made.push(h);
                }
                // a photo that isn't a photo: left out
                const txt = await dir.getFileHandle('notes.txt', { create: true });
                const names = async (d = dir) => {
                    const n = [];
                    for await (const e of d.values()) {
                        if (e.kind === 'file') n.push(e.name);
                        else if (e.name !== '.jeditor') for await (const f of e.values()) n.push(e.name + '/' + f.name);
                    }
                    return n.sort().join();
                };
                const menu = [];
                document.getElementById('start-convert').click();
                await until(() => document.getElementById('context-menu'), 40);
                menu.push(...[...document.querySelectorAll('#context-menu button')].map(b => b.textContent));
                document.body.click();
                out.menu = menu.join();
                // Picked; the folder they're in is the next picker, opening where they are
                let dirAsked = null;
                // Fresh handles each time, as the picker gives (a run moves the ones it had)
                const fresh = async () => [await dir.getFileHandle('scan0.jpg'), await sub.getFileHandle('scan1.jpg'), await sub.getFileHandle('scan2.jpg'), txt];
                window.showOpenFilePicker = async (o) => { out.multiple = o.multiple; const h = await fresh(); made[0] = h[0]; return h; };
                window.showDirectoryPicker = async (o) => { dirAsked = o; return dir; };
                Convert.prefs.format = 'avif';
                Convert.prefs.keep = false;
                await pick('Photos…');
                await until(() => Convert.est && !Convert.est.working, 600);
                out.src = document.getElementById('cv-src-name').textContent;
                out.note = document.getElementById('cv-note').textContent;
                step = 'convert';
                // What the panel says while it runs (it's quick: watched, not polled)
                const seen = [];
                const watch = new MutationObserver(() => {
                    if (box().dataset.state === 'run') seen.push([shown(box()), !Convert.isOpen(), shown(drop()), box().querySelector('.scr-title').textContent,
                        !!box().querySelector('[data-act="pause"]'), !!box().querySelector('[data-act="stop"]')]);
                });
                watch.observe(box(), { subtree: true, childList: true, characterData: true, attributes: true });
                const going = Convert.go();
                await until(() => dirAsked && (Convert.run || Convert.done), 200);
                out.startIn = !!dirAsked && dirAsked.startIn === made[0];
                await going;
                watch.disconnect();
                const last = seen.filter(x => /^Converting [1-3] of 3 photos to AVIF…$/.test(x[3])).pop();
                out.running = last ? [...last.slice(0, 3), true, ...last.slice(4)] : seen.slice(-1);
                await until(() => Convert.done, 800);
                out.converted = await names();
                const trash = [];
                for await (const e of (await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('trash')).values()) trash.push(e.name);
                out.trash = trash.sort().join();
                out.done = [shown(box()), box().querySelector('.scr-title').textContent, box().querySelector('.scr-sub').textContent,
                    [...box().querySelectorAll('.scr-actions button, .scr-back:not(.hidden) button')].map(b => b.textContent).join()];
                out.notOpened = !app.dirHandle && !app.files.length && shown(drop());
                step = 'put back';
                box().querySelector('[data-act="back"]').click();
                await until(async () => (await names()).includes('scan0.jpg'), 100);
                await sleep(200);
                out.back = [await names(), shown(box())];
                // Keep both, into another folder: copies there, the photos as they were
                step = 'keep';
                window.showDirectoryPicker = async () => outDir;
                Convert.prefs.keep = true;
                Convert.est = null;
                await pick('Photos…');
                await until(() => Convert.est && !Convert.est.working, 600);
                out.keepNote = document.getElementById('cv-note').textContent;
                await Convert.go();
                await until(() => Convert.done, 800);
                out.kept = [await names(), await names(await outDir.getDirectoryHandle('jEditor Converted')), box().querySelector('.scr-sub').textContent];
                box().querySelector('[data-act="done"]').click();
                out.doneHides = !shown(box());
                // Replacing, with a folder they aren't in: asked again, nothing changed
                step = 'not in it';
                Convert.prefs.keep = false;
                Convert.est = null;
                await pick('Photos…');
                await until(() => Convert.est && !Convert.est.working, 600);
                const tried = Convert.go();
                await until(() => { const b = document.getElementById('uid-ok'); return b && b.getBoundingClientRect().height > 0; }, 100);
                out.alert = document.getElementById('uid-ok').closest('[role="dialog"], [role="alertdialog"], .dialog').textContent;
                document.getElementById('uid-ok').click();
                await tried;
                out.notIn = [await names(), !Convert.run && !Convert.done, Convert.isOpen()];
                Convert.close();
                return out;
            } catch (e) { return { error: step + ': ' + e.message + ' ' + e.stack }; }
        });
        check('convert (start page): Convert photos offers Photos… and A folder…', q.menu === 'Photos…,A folder…', JSON.stringify(q));
        check('convert (start page): photos picked, not a folder; the next picker opens where they are', q.multiple === true && q.src === 'Photos picked · 3 photos' && /^Next, choose the folder they're in/.test(q.note) && q.startIn, JSON.stringify([q.multiple, q.src, q.note, q.startIn]));
        check('convert (start page): it runs on the start page, with how far it\'s got, Pause and Stop', q.running && q.running.every(Boolean), JSON.stringify(q.running));
        check('convert (start page): converted where they are, originals in their folder\'s .jeditor/trash, nothing opened', q.converted === '1998/scan1.avif,1998/scan2.avif,notes.txt,scan0.avif' && q.trash === 'scan0.jpg,scan1.jpg,scan2.jpg' && q.notOpened, JSON.stringify([q.converted, q.trash, q.notOpened]));
        check('convert (start page): what it did, shown there: Put them back, Convert more…, Done', q.done && q.done[0] && q.done[1] === 'Converted 3 photos to AVIF' && / → .*the originals are in \.jeditor\/trash in Scans/.test(q.done[2]) && q.done[3] === 'Put them back,Convert more…,Done', JSON.stringify(q.done));
        check('convert (start page): Put them back puts the originals back and clears the panel', q.back && q.back[0] === '1998/scan1.jpg,1998/scan2.jpg,notes.txt,scan0.jpg' && !q.back[1], JSON.stringify(q.back));
        check('convert (start page): Keep both, into a folder they aren\'t in: copies in its "jEditor Converted", the photos left', q.kept && q.kept[0] === '1998/scan1.jpg,1998/scan2.jpg,notes.txt,scan0.jpg' && q.kept[1] === 'scan0.avif,scan1.avif,scan2.avif' && /jEditor Converted/.test(q.kept[2]) && /^Next, choose where/.test(q.keepNote) && q.doneHides, JSON.stringify([q.kept, q.keepNote, q.doneHides]));
        check('convert (start page): replacing needs the folder they\'re in; another one asks again and changes nothing', /Choose the folder they're in/.test(q.alert) && q.notIn && q.notIn[0] === '1998/scan1.jpg,1998/scan2.jpg,notes.txt,scan0.jpg' && q.notIn[1] && q.notIn[2], JSON.stringify([q.alert, q.notIn]));
        check('convert (photos picked): no JS errors', p3.issues.errors.length === 0, p3.issues.errors.join('; '));
        await p3.page.evaluate(async () => { Codec.stop(); await sleep(300); });
        await p3.page.close();
    }

    await browser.close();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
