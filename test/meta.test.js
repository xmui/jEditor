#!/usr/bin/env node
// The metadata editor (meta-fields.js, meta-editor.js), in headless
// Chromium: fields read and written in JPEG, PNG, WebP and TIFF without the
// picture changing, an .xmp beside a RAW, IPTC and Windows' tags kept in
// step, and Info's Edit for a photo and a selection, with undo. Run by
// `npm test`; on its own:
//   node test/meta.test.js [name …]     (only the sections named)

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

const PAGE = `
    window.sleep = (ms) => new Promise(res => setTimeout(res, ms));
    window.until = async (fn, n = 200) => { for (let i = 0; i < n && !(await fn()); i++) await sleep(50); };
    window.picture = (w = 64, h = 48) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { g.fillStyle = 'hsl(' + ((x * 7 + y * 3) % 360) + ',60%,50%)'; g.fillRect(x, y, 8, 8); }
        return c;
    };
    window.encode = async (type, q) => new Uint8Array(await (await new Promise(r => picture().toBlob(r, type, q))).arrayBuffer());
    window.decoded = async (bytes, type) => {
        const bmp = await createImageBitmap(new Blob([bytes], { type }));
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
        return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
    };
    window.sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    window.ALL = { title: 'Christmas on Elm Street', caption: 'Grandma and Uncle Ray — by the tree', keywords: ['family', 'Christmas', 'Łódź'],
        rating: 4, author: 'Walter Kowalski', copyright: '© Kowalski family', taken: '1962-12-25T09:00:00', gps: { lat: 41.878113, lon: -87.629799 } };
    window.sameFields = (a, b) => MetaFields.FIELDS.every(k => MetaFields.same(k, a[k], b[k]));
    window.diffFields = (a, b) => MetaFields.FIELDS.filter(k => !MetaFields.same(k, a[k], b[k])).map(k => k + ': ' + JSON.stringify(a[k]) + ' vs ' + JSON.stringify(b[k])).join('; ');
`;

(async () => {
    const server = createServer();
    await new Promise(r => server.listen(0, r));
    const baseUrl = `http://localhost:${server.address().port}`;
    const browser = await chromium.launch(launchOptions());

    // ---- The fields in each kind of file ----
    if (wanted('formats')) {
        console.log('formats');
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        await page.evaluate(PAGE);
        const r = await page.evaluate(async () => {
            const out = {};
            for (const [name, type, make] of [
                ['jpeg', 'image/jpeg', () => encode('image/jpeg', 0.9)],
                ['jpeg-exif', 'image/jpeg', () => makeRealJpeg(64, 48, { exif: true, dpi: 300, icc: true })],
                ['png', 'image/png', () => encode('image/png')],
                ['webp', 'image/webp', () => encode('image/webp', 0.8)],
                ['webp-lossless', 'image/webp', () => encode('image/webp', 1)],
                ['tiff', 'image/tiff', async () => new Uint8Array(await (await Codec.file(new Blob([await encode('image/png')], { type: 'image/png' }), 'tiff')).arrayBuffer())]
            ]) {
                try {
                    const before = await make();
                    const look = async (b) => type === 'image/tiff' ? decoded(new Uint8Array(await (await Codec.showable(new Blob([b], { type }))).arrayBuffer()), 'image/png') : decoded(b, type);
                    const pixels = await look(before);
                    const was = await MetaFields.read(before);
                    const after = await MetaFields.write(before, ALL);
                    const got = await MetaFields.read(after);
                    // Again, changing only some: the rest stay
                    const again = await MetaFields.write(after, { title: 'Second', keywords: ['one'], rating: 0, gps: null });
                    const got2 = await MetaFields.read(again);
                    const want2 = { ...ALL, title: 'Second', keywords: ['one'], rating: 0, gps: null };
                    // A third time, the same size of change: written in place, no growth
                    const third = await MetaFields.write(again, { taken: '1963-01-01T10:00:00' });
                    const fourth = await MetaFields.write(third, { taken: '1963-01-02T10:00:00' });
                    out[name] = {
                        wasEmpty: name === 'jpeg-exif' ? was.taken === '2024-06-15T13:45:00' : sameFields(was, MetaFields.empty()),
                        round: sameFields(got, ALL) || diffFields(got, ALL),
                        partial: sameFields(got2, want2) || diffFields(got2, want2),
                        samePixels: sameArr(pixels, await look(after)) && sameArr(pixels, await look(fourth)),
                        noGrowth: Math.abs(fourth.length - third.length) <= 2 || `${third.length} → ${fourth.length}`,
                        appSeesDate: name === 'tiff' ? true : !!(app.readTiffInfo && (() => { const t = ImageMeta.exifOf(fourth); const i = t && app.readTiffInfo(new DataView(t.buffer, t.byteOffset, t.byteLength), 0); return i && i.dateTaken && i.dateTaken.getFullYear() === 1963 && i.dateTaken.getDate() === 2; })()),
                        keptMake: name !== 'jpeg-exif' || /TestCam/.test(new TextDecoder('latin1').decode(fourth)),
                        keptIcc: name !== 'jpeg-exif' || ImageMeta.hasJpegIcc(fourth)
                    };
                    window.__written = window.__written || {};
                    window.__written[name] = Array.from(fourth);
                } catch (e) { out[name] = { error: e.message + ' ' + (e.stack || '').split('\n')[1] }; }
            }
            return out;
        });
        for (const [name, v] of Object.entries(r)) {
            if (v.error) { check(`${name}: written and read back`, false, v.error); continue; }
            check(`${name}: nothing there to start with (or the camera's date)`, v.wasEmpty === true);
            check(`${name}: every field written and read back`, v.round === true, v.round);
            check(`${name}: changing some fields keeps the others`, v.partial === true, v.partial);
            check(`${name}: the picture is the same`, v.samePixels === true);
            check(`${name}: the same change again doesn't grow the file`, v.noGrowth === true, v.noGrowth);
            check(`${name}: jEditor's own date reading sees the new date`, v.appSeesDate === true);
            if (name === 'jpeg-exif') {
                check('jpeg-exif: the camera and the colour profile are kept', v.keptMake && v.keptIcc);
            }
        }
        check('formats: no errors on the page', !issues.errors.length, issues.errors.join(' | '));
        await page.close();
    }

    // ---- IPTC and Windows' own tags, kept in step ----
    if (wanted('legacy')) {
        console.log('legacy');
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        await page.evaluate(PAGE);
        const r = await page.evaluate(async () => {
            const jpeg = await encode('image/jpeg', 0.9);
            // IPTC, as an older app wrote it: a caption, two keywords, a by-line
            const ds = (n, text) => { const d = new TextEncoder().encode(text); return [0x1C, 2, n, d.length >> 8, d.length & 255, ...d]; };
            const iim = [...ds(120, 'Old caption'), ...ds(25, 'old'), ...ds(25, 'words'), ...ds(80, 'Somebody')];
            const res = [...new TextEncoder().encode('8BIM'), 4, 4, 0, 0, 0, 0, iim.length >> 8, iim.length & 255, ...iim, ...(iim.length & 1 ? [0] : [])];
            const ps = [...new TextEncoder().encode('Photoshop 3.0'), 0, ...res];
            const app13 = [0xFF, 0xED, (ps.length + 2) >> 8, (ps.length + 2) & 255, ...ps];
            const withIptc = new Uint8Array(jpeg.length + app13.length);
            withIptc.set(jpeg.subarray(0, 2)); withIptc.set(app13, 2); withIptc.set(jpeg.subarray(2), 2 + app13.length);
            const was = await MetaFields.read(withIptc);
            const after = await MetaFields.write(withIptc, { caption: 'New caption', keywords: ['new'] });
            const iimAfter = MetaFields.iim(MetaFields.iimOf(after.subarray(ImageMeta.jpegSegments(after).find(s => s.marker === 0xED).start + 18)));
            const txt = (n) => iimAfter.filter(s => s.rec === 2 && s.ds === n).map(s => new TextDecoder().decode(s.data));
            // Windows' XP tags
            const tags = MetaFields.exifWith(null, { ifd0: { 0x9C9B: MetaFields.ucs2Val('XP title'), 0x9C9E: MetaFields.ucs2Val('a; b') } });
            const xp = await MetaFields.write(ImageMeta.withExifJpeg(jpeg, tags), { title: 'Windows sees this', keywords: ['c'] });
            const t = MetaFields.tiff(ImageMeta.exifOf(xp));
            return {
                readIptc: was.caption === 'Old caption' && was.keywords.join() === 'old,words' && was.author === 'Somebody',
                iptcCaption: txt(120).join() === 'New caption',
                iptcKeywords: txt(25).join() === 'new',
                iptcByline: txt(80).join() === 'Somebody',
                xpTitle: MetaFields.ucs2(t.get(t.ifd0, 0x9C9B)) === 'Windows sees this',
                xpKeywords: MetaFields.ucs2(t.get(t.ifd0, 0x9C9E)) === 'c',
                // A clock-less camera's "0000:00:00" isn't a date
                noFakeDate: (await MetaFields.read(ImageMeta.withExifJpeg(jpeg, MetaFields.exifWith(null, { exif: { 0x9003: MetaFields.asciiVal('0000:00:00 00:00:00') } })))).taken === ''
            };
        });
        check('legacy: IPTC caption, keywords and by-line are read', r.readIptc);
        check('legacy: the IPTC caption is changed with the XMP', r.iptcCaption);
        check('legacy: the IPTC keywords are changed', r.iptcKeywords);
        check('legacy: an IPTC field not changed stays', r.iptcByline);
        check('legacy: Windows\' XP title is kept in step', r.xpTitle);
        check('legacy: Windows\' XP keywords are kept in step', r.xpKeywords);
        check('legacy: a camera with no clock has no date', r.noFakeDate);
        check('legacy: no errors on the page', !issues.errors.length, issues.errors.join(' | '));
        await page.close();
    }

    // ---- XMP others wrote: kept, and read in both its forms ----
    if (wanted('xmp')) {
        console.log('xmp');
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        await page.evaluate(PAGE);
        const r = await page.evaluate(async () => {
            const lr = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:exif="http://ns.adobe.com/exif/1.0/"
 xmp:Rating="3" crs:Exposure2012="+0.50" exif:GPSLatitude="41,52.68678N" exif:GPSLongitude="87,37.78794W">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Lightroom's title</rdf:li></rdf:Alt></dc:title>
<dc:subject><rdf:Bag><rdf:li>lr</rdf:li><rdf:li>kw</rdf:li></rdf:Bag></dc:subject>
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
            const was = await MetaFields.read(new Uint8Array(0), lr);
            const next = MetaFields.sidecarWith(lr, { rating: 5, title: '' });
            const now = await MetaFields.read(new Uint8Array(0), next);
            return {
                read: was.rating === 3 && was.title === 'Lightroom\'s title' && was.keywords.join() === 'lr,kw' && Math.abs(was.gps.lat - 41.878113) < 1e-5 && was.gps.lon < -87.6,
                changed: now.rating === 5 && now.title === '' && now.keywords.join() === 'lr,kw',
                keptOthers: /crs:Exposure2012="\+0.50"|Exposure2012>\+0.50</.test(next) && /xmlns:crs/.test(next),
                oneRating: (next.match(/Rating/g) || []).length <= 2
            };
        });
        check('xmp: Lightroom\'s XMP is read (attributes and elements)', r.read);
        check('xmp: a change, and a field cleared', r.changed);
        check('xmp: what jEditor doesn\'t edit (Lightroom\'s develop settings) is kept', r.keptOthers);
        check('xmp: the rating is in it once', r.oneRating);
        check('xmp: no errors on the page', !issues.errors.length, issues.errors.join(' | '));
        await page.close();
    }

    // ---- Info's Edit: one photo, a selection, undo, redo ----
    if (wanted('editor')) {
        console.log('editor');
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        await page.setViewportSize({ width: 1280, height: 860 });
        await page.evaluate(PAGE);
        const r = await page.evaluate(async () => {
            const out = {};
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('Meta', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('Meta', { create: true });
            const put = async (name, bytes) => { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(bytes); await w.close(); };
            const base = await encode('image/jpeg', 0.9);
            await put('a.jpg', await MetaFields.write(base, { title: 'Alpha', keywords: ['family', 'old'] }));
            await put('b.jpg', await MetaFields.write(base, { title: 'Beta', keywords: ['family'] }));
            await put('c.jpg', base);
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            await until(() => app.files.length === 3);
            const file = (n) => app.files.find(f => f.name === n);
            const bytesOf = async (n) => new Uint8Array(await (await file(n).handle.getFile()).arrayBuffer());
            const fieldsOf = async (n) => MetaFields.read(await bytesOf(n));
            const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
            const addWord = (w) => { const kw = document.getElementById('meta-kw-input'); kw.value = w; kw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
            const visible = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };

            // One photo, in the viewer
            await app.openSingle(file('c.jpg'));
            app.toggleInfoPanel(true);
            await until(() => visible('info-edit'));
            out.editShown = visible('info-edit');
            const original = await bytesOf('c.jpg');
            const pixels = await decoded(original, 'image/jpeg');
            document.getElementById('info-edit').click();
            await until(() => document.getElementById('meta-form'));
            out.formShown = !!document.getElementById('meta-form') && !visible('info-list') && !visible('info-edit');
            out.noteSays = document.getElementById('meta-note').textContent;
            set('meta-title', 'Christmas on Elm Street');
            set('meta-caption', 'By the tree');
            addWord('family'); addWord('Christmas');
            document.querySelectorAll('#meta-rating button')[3].click();
            set('meta-taken', '1962-12-25T09:00:00');
            set('meta-lat', '41.878113, -87.629799'); // a pair pasted in
            document.getElementById('meta-done').click();
            await until(() => !document.getElementById('meta-form'));
            await until(() => document.getElementById('info-list').textContent.includes('Christmas on Elm Street'));
            const got = await fieldsOf('c.jpg');
            out.saved = got.title === 'Christmas on Elm Street' && got.caption === 'By the tree' && got.keywords.join() === 'family,Christmas' && got.rating === 4 && got.taken === '1962-12-25T09:00:00' && !!got.gps && Math.abs(got.gps.lon + 87.629799) < 1e-6;
            out.pixelsSame = sameArr(pixels, await decoded(await bytesOf('c.jpg'), 'image/jpeg'));
            out.infoShows = document.getElementById('info-list').textContent.includes('Christmas on Elm Street') && document.getElementById('info-list').textContent.includes('★★★★☆');
            out.dateTaken = file('c.jpg').dateTaken === new Date(1962, 11, 25, 9).getTime();
            const hist = History.describe(app._undoStack[app._undoStack.length - 1]);
            out.history = hist.what === 'Edit info' && hist.detail === 'c.jpg';
            await app.undo();
            out.undone = sameArr(Array.from(await bytesOf('c.jpg')), Array.from(original));
            await app.redo();
            out.redone = (await fieldsOf('c.jpg')).title === 'Christmas on Elm Street';

            // Esc leaves without saving
            const now = Array.from(await bytesOf('c.jpg'));
            document.getElementById('info-edit').click();
            await until(() => document.getElementById('meta-form'));
            set('meta-title', 'Not this');
            document.getElementById('meta-title').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(300);
            out.escCancels = !document.getElementById('meta-form') && sameArr(now, Array.from(await bytesOf('c.jpg'))) && visible('info-edit');

            // Going to another photo while editing saves what was typed
            document.getElementById('info-edit').click();
            await until(() => document.getElementById('meta-form'));
            set('meta-copyright', '© Kowalski family');
            await app.openSingle(file('a.jpg'));
            await until(async () => (await fieldsOf('c.jpg')).copyright === '© Kowalski family');
            out.leaveSaves = (await fieldsOf('c.jpg')).copyright === '© Kowalski family' && !document.getElementById('meta-form');

            // A selection in the grid: Mixed, and only what's changed is set on all
            app.setView('grid');
            await until(() => app.viewMode === 'grid');
            app.clearSelection();
            for (const n of ['a.jpg', 'b.jpg', 'c.jpg']) app.toggleSelection(file(n));
            app.updateSelectionUI();
            app.refreshInfoPanel();
            await until(() => visible('info-edit'));
            document.getElementById('info-edit').click();
            await until(() => document.getElementById('meta-form'));
            const title = document.getElementById('meta-title');
            out.mixed = title.value === '' && title.placeholder === 'Mixed' && document.querySelector('#info-panel h3').textContent === 'Edit 3 photos';
            const chips = [...document.querySelectorAll('.meta-chip')].map(c => c.textContent.replace('×', ''));
            out.chips = chips.join('|');
            set('meta-author', 'Walter Kowalski');
            // "old" is on one of them: given to all
            document.querySelector('.meta-chip[data-word="old"] > span').click();
            const befores = await Promise.all(['a.jpg', 'b.jpg', 'c.jpg'].map(bytesOf));
            document.getElementById('meta-done').click();
            await until(() => !document.getElementById('meta-form'));
            await until(async () => (await fieldsOf('b.jpg')).author === 'Walter Kowalski');
            const [fa, fb, fc] = await Promise.all(['a.jpg', 'b.jpg', 'c.jpg'].map(fieldsOf));
            out.selSaved = [fa, fb, fc].every(f => f.author === 'Walter Kowalski' && f.keywords.includes('old'));
            out.selKeptOwn = fa.title === 'Alpha' && fb.title === 'Beta' && fc.title === 'Christmas on Elm Street';
            await app.undo();
            const afters = await Promise.all(['a.jpg', 'b.jpg', 'c.jpg'].map(bytesOf));
            out.selUndone = afters.every((b, i) => sameArr(Array.from(b), Array.from(befores[i])));

            // An .xmp beside a RAW, and its undo
            const raw = { name: 'scan.cr2', handle: await dir.getFileHandle('scan.cr2', { create: true }), parentDir: dir, size: 0, lastModified: 0 };
            const undo = await MetaEditor.write(raw, { title: 'Raw title', rating: 2 });
            const side = await (await (await dir.getFileHandle('scan.xmp')).getFile()).text();
            out.sidecar = /Raw title/.test(side) && (await MetaFields.read(new Uint8Array(0), side)).rating === 2;
            await app.undoFileEdit(undo);
            out.sidecarUndone = await dir.getFileHandle('scan.xmp').then(() => false, () => true);
            return out;
        });
        check('editor: Info has Edit for a photo', r.editShown);
        check('editor: Edit turns Info into the form', r.formShown);
        check('editor: it says where it\'s saved', /Saved into the photo\. Ctrl\+Z undoes it\./.test(r.noteSays), r.noteSays);
        check('editor: every field is saved into the photo', r.saved);
        check('editor: the picture isn\'t touched', r.pixelsSame);
        check('editor: Info shows the title and rating after', r.infoShows);
        check('editor: the photo\'s date taken (for sorting) is the new one', r.dateTaken);
        check('editor: the undo history says Edit info, and the photo', r.history);
        check('editor: Ctrl+Z puts the file back exactly', r.undone);
        check('editor: redo saves it again', r.redone);
        check('editor: Esc leaves it without saving', r.escCancels);
        check('editor: going to another photo saves what was typed', r.leaveSaves);
        check('editor: a selection says Edit 3 photos, with differing fields Mixed', r.mixed);
        check('editor: keywords some have show how many', r.chips.includes('old · 1 of 3') && r.chips.split('|').includes('family'), r.chips);
        check('editor: a field changed for a selection is set on all', r.selSaved);
        check('editor: Mixed fields not changed are left as each had them', r.selKeptOwn);
        check('editor: one Ctrl+Z puts the whole selection back', r.selUndone);
        check('editor: a RAW\'s go into an .xmp beside it', r.sidecar);
        check('editor: undo takes the new .xmp away', r.sidecarUndone);
        check('editor: no errors on the page', !issues.errors.length, issues.errors.join(' | '));
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
