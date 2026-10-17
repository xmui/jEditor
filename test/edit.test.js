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

    await browser.close();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
