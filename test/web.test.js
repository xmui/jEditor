#!/usr/bin/env node
// The web version, clicked through: the GitHub Pages build (one page,
// served) and standalone.html (one file, opened from disk). Each main path
// (home, a project, the grid, the viewer, Crop, Adjust, Paint, Settings,
// What's new, the guide, Find anything, Export) opens with no JS errors, and
// none of them offers what only the apps have (docs/platforms.md): no Show
// in Explorer, Scan, Camera, windows, drives, burning, updates or the log,
// and every [data-needs] the web lacks stays hidden. Run by `npm test`; on
// its own:
//   node test/web.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { chromium } = require('playwright-core');
const { launchOptions, newPage } = require('./page-helpers.js');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// What a menu row, a button or a line on the web must never offer: the
// apps' own features (host.js)
const APP_ONLY = /Show in (Explorer|Finder|Files)|^Scan\b|Scan…|^Camera|New window|Side by side|Split|Burn|Eject|Add to Photos|Check for updates|Show log|Window background|Clear and restart|Scanning and the camera/;

// In the page: every menu that opens (app.openContextMenu) is kept, as its
// rows' names
const WATCH = `
    window.__menus = [];
    window.sleep = (ms) => new Promise(r => setTimeout(r, ms));
    window.until = async (fn, n = 100) => { for (let i = 0; i < n && !(await fn()); i++) await sleep(50); return fn(); };
    window.pressKey = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
    const rows = (items) => items.flatMap(it => !it || it[0] === '—' ? [] : Array.isArray(it[1]) ? [String(it[0]), ...rows(it[1])] : [String(it[0])]);
    const open = app.openContextMenu.bind(app);
    app.openContextMenu = (items, x, y, o) => { window.__menus.push(rows(items)); return open(items, x, y, o); };
    // Shown: on screen and not hidden by a parent
    window.shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    // Text on screen in an element, what's hidden left out
    window.textOf = (el) => el ? el.innerText : '';
    // [data-needs] the web lacks, on screen (none should be)
    window.missingShown = () => [...document.querySelectorAll('.host-missing')].filter(shown).map(e => e.id || e.className);
`;

// The main paths, on a page that can open a folder (the served page)
async function walk(page) {
    return page.evaluate(async () => {
        let step = 'start';
        const out = { menus: {}, text: {} };
        const lastMenu = () => (window.__menus.pop() || []);
        const closeMenus = () => { app.closeContextMenu(); window.__menus.length = 0; };
        try {
            // Home and its gear menu
            step = 'home';
            out.text.home = textOf(document.getElementById('drop-zone'));
            document.getElementById('btn-settings-start').click();
            await sleep(100);
            out.menus.homeGear = lastMenu();
            closeMenus();

            // Settings, every page the web has
            step = 'settings';
            app.toggleCustomizePanel(true, 'general');
            out.pages = [...document.querySelectorAll('.settings-nav [role=tab]')].filter(shown).map(t => t.dataset.page);
            for (const p of out.pages) {
                app.showSettingsPage(p);
                await sleep(30);
                out.text['settings ' + p] = textOf(document.getElementById('set-page-' + p));
            }
            out.missingInSettings = missingShown();
            app.toggleCustomizePanel(false);

            // What's new: each card, then See all
            step = "what's new";
            Highlights.open();
            await sleep(50);
            for (let i = 0; i < Highlights.CARDS.length; i++) {
                Highlights.go(i);
                await sleep(20);
                out.text['card ' + i] = textOf(Highlights.el.querySelector('.hl-card'));
            }
            Highlights.close();
            app.toggleWhatsNew(true);
            await sleep(50);
            out.appTags = document.querySelectorAll('#whatsnew-list .wn-apps').length;
            out.marked = CHANGELOG.reduce((n, e) => n + (e.needs || []).filter(Boolean).length, 0);
            app.toggleWhatsNew(false);

            // The guide, every topic
            step = 'guide';
            Guide.open();
            await sleep(50);
            out.text.guide = Guide.CARDS.filter(c => Guide.shown(c)).map(c => `${c[2]}: ${c[3]}`).join('\n');
            Guide.close();

            // A project: two photos and a folder, in the browser's own storage
            step = 'open a project';
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('web-walk', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('web-walk', { create: true });
            const sub = await dir.getDirectoryHandle('Prints', { create: true });
            for (const [d, n, color] of [[dir, 'a.jpg', '#a64'], [dir, 'b.jpg', '#46a'], [sub, 'c.jpg', '#6a4']]) {
                const c = document.createElement('canvas'); c.width = 320; c.height = 240;
                const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 320, 240);
                const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
                const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(blob); await w.close();
            }
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            await until(() => app.files.length === 3 && app.files.every(f => f.thumbnailUrl));
            out.opened = app.files.length;
            out.text.grid = textOf(document.getElementById('main-interface'));
            out.missingInGrid = missingShown();

            // The grid's right-click menus: a photo, the grid, a folder, the top pill
            step = 'grid menus';
            const right = (el, x = 0, y = 0) => el && el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
            right(document.querySelector('.grid-item'));
            out.menus.photo = lastMenu(); closeMenus();
            right(app.elements.gridView, 5, 5);
            out.menus.grid = lastMenu(); closeMenus();
            right(document.querySelector('[data-folder-path]'));
            out.menus.folder = lastMenu(); closeMenus();
            right(app.elements.headerControls);
            out.menus.pill = lastMenu(); closeMenus();

            // The viewer, Info, its right-click menu
            step = 'viewer';
            app.openSingle(app.files[0]);
            await until(() => app.viewMode === 'single');
            await sleep(200);
            right(document.getElementById('image-container'), 200, 200);
            out.menus.viewer = lastMenu(); closeMenus();
            pressKey('i');
            await sleep(100);
            out.text.info = textOf(document.getElementById('info-panel') || document.querySelector('.info-panel'));
            pressKey('i');

            // Crop, Adjust and Paint: each opens, then Esc back to Photos
            step = 'crop';
            pressKey('c');
            await until(() => app.cropState.active);
            out.crop = app.cropState.active;
            pressKey('Escape');
            await until(() => !app.cropState.active);
            step = 'adjust';
            pressKey('e');
            await until(() => Adjust.ready);
            out.adjust = Adjust.ready;
            out.menus.adjust = Adjust.moreItems().flatMap(it => it && it[0] !== '—' ? [String(it[0])] : []);
            pressKey('Escape');
            await until(() => !Adjust.isOpen);
            step = 'paint';
            pressKey('b');
            await until(() => PaintEditor.ready);
            out.paint = PaintEditor.ready;
            pressKey('Escape');
            await until(() => !PaintEditor.isOpen);
            await until(() => !app.cropState.active);

            // Find anything: what it offers for the apps' words
            step = 'find anything';
            Palette.open();
            await sleep(50);
            const found = [];
            for (const q of ['scan', 'camera', 'window', 'burn', 'update', 'explorer']) {
                Palette.input.value = q;
                Palette.search();
                await sleep(30);
                found.push(...[...document.querySelectorAll('#palette [role=option]')].filter(shown).map(o => o.innerText.split('\n')[0]));
            }
            out.menus.find = found;
            Palette.close();

            // The keyboard shortcuts window, and Export (its tabs)
            step = 'shortcuts';
            app.toggleShortcutsPanel(true);
            await sleep(50);
            out.text.shortcuts = textOf(document.getElementById('shortcuts-panel'));
            app.toggleShortcutsPanel(false);
            step = 'export';
            await Export.open({ files: [app.files[0]] });
            await sleep(100);
            out.exportTabs = Export.tabs().map(t => t[0]);
            Export.close();
            out.missingAtEnd = missingShown();
            return out;
        } catch (e) {
            return { ...out, error: step + ': ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' ') };
        }
    });
}

// What the apps alone have, offered anywhere in what was seen
function offered(r) {
    const hits = [];
    for (const [where, rows] of Object.entries(r.menus || {})) for (const row of rows) if (APP_ONLY.test(row)) hits.push(`${where}: ${row}`);
    for (const [where, text] of Object.entries(r.text || {})) for (const line of String(text).split('\n')) if (APP_ONLY.test(line.trim())) hits.push(`${where}: ${line.trim()}`);
    return hits;
}

(async () => {
    const browser = await chromium.launch(launchOptions());

    // ---- The web page: the GitHub Pages build, served ----
    console.log('the web page (GitHub Pages build)');
    {
        const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'jeditor-web-'));
        execSync(`node scripts/build-standalone.js --site "${SITE}"`, { cwd: ROOT, stdio: 'pipe' });
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.wasm': 'application/wasm' };
        const server = http.createServer((req, res) => {
            const p = decodeURIComponent(req.url.split('?')[0]);
            const f = path.join(SITE, p.endsWith('/') ? 'index.html' : p);
            fs.readFile(f, (e, d) => {
                if (e) { res.writeHead(404); return res.end(); }
                res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
                res.end(d);
            });
        });
        await new Promise(r => server.listen(0, r));
        const { page, issues } = await newPage(browser, `http://localhost:${server.address().port}/`);
        await page.evaluate(WATCH);
        const r = await walk(page);
        check('web: every main path opens (home, Settings, What\'s new, the guide, a project, its menus, the viewer, Crop, Adjust, Paint, Find anything, Export)',
            !r.error && r.opened === 3 && r.crop && r.adjust && r.paint, r.error || JSON.stringify({ opened: r.opened, crop: r.crop, adjust: r.adjust, paint: r.paint }));
        const hits = offered(r);
        check('web: no menu, page or card offers what only the apps have', !hits.length, hits.join('; '));
        const missing = [...(r.missingInSettings || []), ...(r.missingInGrid || []), ...(r.missingAtEnd || [])];
        check('web: nothing the web lacks (data-needs) shows', !missing.length, missing.join(', '));
        check('web: Settings has no Updates page', !!r.pages && !r.pages.includes('updates'), JSON.stringify(r.pages));
        check('web: the guide\'s sidebar is the web\'s (no projects, pins or drives)', !!r.text && /The sidebar: The project's folders and its flags/.test(r.text.guide || '') && !/pinned folders and drives/.test(r.text.guide || ''), (r.text && r.text.guide || '').slice(0, 200));
        check('web: What\'s new marks every line about the apps\' own features "In the apps"', r.marked > 0 && r.appTags === r.marked, JSON.stringify([r.appTags, r.marked]));
        check('web: Export has only Copies (no USB drive or disc)', JSON.stringify(r.exportTabs) === '["copies"]', JSON.stringify(r.exportTabs));
        check('web: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        check('web: no request fails', issues.failedRequests.length === 0, issues.failedRequests.join('; '));
        await page.close();
        server.close();
        fs.rmSync(SITE, { recursive: true, force: true });
    }

    // ---- standalone.html: one file, opened from disk ----
    console.log('standalone.html (file://)');
    {
        execSync('node scripts/build-standalone.js', { cwd: ROOT, stdio: 'pipe' });
        const { page, issues } = await newPage(browser, 'file://' + path.join(ROOT, 'standalone.html'));
        await page.evaluate(WATCH);
        const r = await page.evaluate(async () => {
            const out = { menus: {}, text: {} };
            try {
                out.text.home = textOf(document.getElementById('drop-zone'));
                document.getElementById('btn-settings-start').click();
                await sleep(100);
                out.menus.homeGear = window.__menus.pop() || [];
                app.closeContextMenu();
                app.toggleCustomizePanel(true, 'general');
                for (const t of [...document.querySelectorAll('.settings-nav [role=tab]')].filter(shown)) {
                    app.showSettingsPage(t.dataset.page);
                    await sleep(20);
                    out.text['settings ' + t.dataset.page] = textOf(document.getElementById('set-page-' + t.dataset.page));
                }
                out.missing = missingShown();
                app.toggleCustomizePanel(false);
                // What's new, its pictures in the file (there's no folder beside it)
                Highlights.open();
                out.pictures = [0, 0];
                for (let i = 0; i < Highlights.CARDS.length; i++) {
                    Highlights.go(i);
                    const pics = [...Highlights.el.querySelectorAll('img')];
                    await until(() => pics.every(im => im.complete));
                    out.pictures[0] += pics.length;
                    out.pictures[1] += pics.filter(im => im.naturalWidth > 0).length;
                    out.text['card ' + i] = textOf(Highlights.el.querySelector('.hl-card'));
                }
                Highlights.close();
                Guide.open();
                await sleep(30);
                Guide.close();
                Palette.open();
                await sleep(30);
                Palette.close();
                // The codecs need files beside the page: Export leaves their formats out, Convert says so
                out.codecs = await Codec.ready();
            } catch (e) { out.error = e.message; }
            return out;
        });
        check('standalone: home, Settings, What\'s new, the guide and Find anything open', !r.error, r.error);
        const hits = offered(r);
        check('standalone: nothing offers what only the apps have', !hits.length, hits.join('; '));
        check('standalone: nothing the web lacks (data-needs) shows', !(r.missing || []).length, (r.missing || []).join(', '));
        check('standalone: What\'s new\'s cards have their pictures (they\'re in the file)', !!r.pictures && r.pictures[0] > 0 && r.pictures[1] === r.pictures[0], JSON.stringify(r.pictures));
        check('standalone: the codecs are known to be missing (Export leaves their formats out; Convert says it can\'t run here)', r.codecs === false, String(r.codecs));
        check('standalone: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    await browser.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
