// The look checklist: opens every screen of jEditor, in its own look on each
// platform (the Windows app, the Mac app, Linux, a browser) and in every
// theme, at three window sizes (the smallest with comfortable density, the
// worst case for room), and checks each part of it. Writes
// docs/themes-checklist.md.
//
//   node design/themes/audit.js                  everything
//   node design/themes/audit.js xp/royale paint  one look, one screen
//   node design/themes/audit.js mac grid         jEditor on the Mac, one screen
//
// The fonts each platform shows jEditor in aren't here: Inter stands in for
// Segoe UI and SF (it's a little wider, so a fit here fits there), DejaVu
// Sans for Linux and a browser.
//   SHOTS=dir node design/themes/audit.js        keep a screenshot of each
//
// What a part is checked for (inside its own element):
//   off screen   something you'd click or read is past the window's edge, or
//                cut off by its box, with no scrolling to reach it
//   covered      under the theme's title bar or menu bar
//   no icon      a button with neither words nor a picture
//   spills       its words or icon reach outside its own button
//   overlaps     two buttons over each other
//   text cut     words cut off without "…"
//   own font     words still in jEditor's own font, not the theme's
//   missing file a picture or font of the theme that isn't there (404)
const path = require('path'), fs = require('fs'), http = require('http');
const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(REPO + '/node_modules/playwright-core');
const { launchOptions } = require(REPO + '/test/page-helpers.js');
const PH = path.join(__dirname, 'photos');

// [name for the command line, column, theme, platform, the font standing in]
const WIN = ['recycle', 'reveal', 'places', 'quickAccess', 'windows', 'scan', 'camera', 'backdrop', 'log', 'updates', 'burn', 'themes'];
const LOOKS = [
    ['windows', 'Windows', '', 'windows', 'Inter'],
    ['mac', 'Mac', '', 'mac', 'Inter'],
    ['mac26', 'Mac, macOS 26', '', 'mac', 'Inter', 'native-toolbar'],
    ['linux', 'Linux', '', 'linux', 'DejaVu Sans'],
    ['web', 'Web', '', 'web', 'DejaVu Sans'],
    ['xp/royale', 'Royale', 'xp/royale', 'windows'], ['xp/noir', 'Noir', 'xp/noir', 'windows'], ['xp/red', 'Red', 'xp/red', 'windows'],
    ['snow/finder', 'Finder', 'snow/finder', 'windows'], ['snow/aperture', 'Aperture', 'snow/aperture', 'windows'], ['mac84/finder', '1984', 'mac84/finder', 'windows']
];
const FEATURES = { windows: WIN, mac: ['reveal', 'windows', 'places', 'updates', 'permissions'], linux: ['reveal', 'windows', 'places', 'updates'] };
const FONT = { xp: /Tahoma/, snow: /Lucida|DejaVu/, mac84: /Chicago/ };
const SIZES = [[1280, 800, 'compact'], [1024, 640, 'compact'], [800, 600, 'comfortable']];

const H = (id) => `app.keyHandlers()[${JSON.stringify(id)}]()`;
const single = (then = '') => `app.openSingle(app.files[3]); setTimeout(() => { ${then} }, 400)`;
// Screens: [folder open?, what to do]
const SCREENS = {
    start: [false, ''],
    grid: [true, `if (document.body.dataset.view === 'single') document.getElementById('btn-toggle-view').click(); setTimeout(() => { if (document.getElementById('mode-seg')?.getClientRects().length && !document.documentElement.dataset.skin) ${H('folders.rail')}; }, 300)`],
    rail: [true, `if (document.body.dataset.view === 'single') document.getElementById('btn-toggle-view').click(); setTimeout(() => { if (!document.getElementById('folder-rail')?.getClientRects().length || (!document.documentElement.dataset.skin && !document.getElementById('mode-seg')?.getClientRects().length)) ${H('folders.rail')}; }, 300)`],
    photo: [true, single()],
    toolbar: [true, `for (const k of app.uiPrefs.order) app.uiPrefs.placement[k] = 'main'; app.applyUiPrefs(); if (document.body.dataset.view === 'single') document.getElementById('btn-toggle-view').click()`],
    more: [true, `for (const k of app.uiPrefs.order) app.uiPrefs.placement[k] = 'more'; app.applyUiPrefs(); if (document.body.dataset.view === 'single') document.getElementById('btn-toggle-view').click(); setTimeout(() => document.getElementById('btn-more').click(), 300)`],
    menu: [true, single(`document.querySelectorAll('#th-menubar .th-menu')[1]?.click()`)],
    ctx: [true, `if (document.body.dataset.view === 'single') document.getElementById('btn-toggle-view').click(); setTimeout(() => { const t = document.querySelectorAll('#grid-view .grid-item')[4]; const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 40 })); }, 400)`],
    toast: [true, `app.showToast('Rotated 3 photos', 60000, null, { label: 'Undo', run() {} })`],
    info: [true, single(H('view.info'))],
    history: [true, single(H('edit.history'))],
    settings: [true, H('app.settings')],
    settings2: [true, `${H('app.settings')}; setTimeout(() => document.querySelectorAll('.settings-nav [role=tab]')[1]?.click(), 200)`],
    confirm: [true, `UI.confirm({ title: 'Delete 3 photos?', message: 'They go to the Recycle Bin. Ctrl+Z puts them back.' })`],
    prompt: [true, `UI.prompt({ title: 'New folder', message: 'Name the folder', value: 'Untitled folder' })`],
    rename: [true, `app.selection = new Set([app.files[1], app.files[2]]); ${H('edit.rename')}`],
    export: [true, `Export.open({ files: [app.files[1], app.files[2]] })`],
    moveto: [true, `app.selection = new Set([app.files[1]]); ${H('edit.moveTo')}`],
    blank: [true, `Blank.open()`],
    shortcuts: [true, H('app.shortcuts')],
    whatsnew: [true, `app.toggleWhatsNew()`],
    dupes: [true, H('app.dupes')],
    crop: [true, single(H('edit.crop'))],
    adjust: [true, single(H('edit.adjust'))],
    adjust2: [true, single(`${H('edit.adjust')}; setTimeout(() => { document.querySelectorAll('#adj-panel details').forEach(d => d.open = true); const p = document.getElementById('adj-panel'); p.scrollTop = p.scrollHeight; }, 800)`)],
    chip: [true, single(`${H('edit.adjust')}; setTimeout(() => document.getElementById('mode-chip-float').click(), 900)`)],
    paint: [true, single(H('edit.paint'))],
    paint2: [true, single(`${H('edit.paint')}; setTimeout(() => document.querySelector('[data-tool=text]').click(), 900)`)],
    scan: [true, `const p = document.getElementById('scan-panel'); p.classList.remove('host-missing', 'hidden'); Scan.setState('setup'); Scan.fitDock(); Scan.fillFolders(); Scan.fillNames();`]
};

// Every part of the app: [area, name, screen, selector]
const PARTS = [
    ['Main window', 'Title bar', 'grid', '#th-titlebar'],
    ['Main window', 'Menu bar', 'grid', '#th-menubar'],
    ['Main window', 'A menu, open', 'menu', '#context-menu'],
    ['Main window', 'Toolbar', 'grid', 'header'],
    ['Main window', 'Toolbar, with every button on it', 'toolbar', 'header'],
    ['Main window', 'Toolbar, with every button under More', 'more', 'header'],
    ['Main window', 'Folder bar and search', 'grid', '.folder-bar'],
    ['Main window', 'Folder list', 'rail', '.folder-rail'],
    ['Main window', 'Photos · Adjust · Paint, sidebar open', 'rail', '#mode-seg'],
    ['Main window', 'Photos · Adjust · Paint chip, sidebar closed', 'grid', '#mode-chip-bar'],
    ['Main window', 'Thumbnails', 'grid', '#grid-view'],
    ['Main window', "What's selected (pane or foot bar)", 'grid', '.selection-bar'],
    ['Main window', 'Thumbnail size', 'grid', '.grid-controls'],
    ['Main window', 'Photo', 'photo', '#image-container'],
    ['Main window', 'Previous, rotate, next', 'photo', '.controls'],
    ['Main window', 'Film strip', 'photo', '.thumbnails'],
    ['Main window', 'Status bar', 'photo', '.status-bar'],
    ['Main window', 'Right-click menu', 'ctx', '#context-menu'],
    ['Main window', 'Note (toast)', 'toast', '.toast'],
    ['Main window', 'Info', 'info', '#info-panel'],
    ['Main window', 'Undo history', 'history', '#history-panel'],
    ['Main window', 'Start page', 'start', '.drop-content'],
    ['Settings', 'Window and pages', 'settings', '.settings-card'],
    ['Settings', 'Theme gallery', 'settings', '#set-themes'],
    ['Settings', 'Rows, switches, lists', 'settings2', '.settings-body'],
    ['Dialogs', 'Are you sure?', 'confirm', '#ui-dialog .dialog'],
    ['Dialogs', 'A name to type', 'prompt', '#ui-dialog .dialog'],
    ['Dialogs', 'Rename', 'rename', '.rename-card'],
    ['Dialogs', 'Export', 'export', '.export-card'],
    ['Dialogs', 'Move to…', 'moveto', '.folder-card'],
    ['Dialogs', 'New blank image', 'blank', '.blank-card'],
    ['Dialogs', 'Keyboard shortcuts', 'shortcuts', '.shortcuts-card'],
    ["Dialogs", "What's new", 'whatsnew', '.whatsnew-card'],
    ['Dialogs', 'Scan window', 'scan', '#scan-panel'],
    ['Duplicates', 'Head', 'dupes', '.dupes-head'],
    ['Duplicates', 'Foot', 'dupes', '.dupes-foot'],
    ['Crop', 'Head', 'crop', '.crop-head'],
    ['Crop', 'Zoom', 'crop', '.crop-zoom'],
    ['Crop', 'Tools along the foot', 'crop', '.crop-toolbar'],
    ['Adjust', 'Head and its buttons', 'adjust', '.adj-head'],
    ['Adjust', 'Mode switch', 'adjust', '#mode-float'],
    ['Adjust', 'Mode switch menu', 'chip', '.mode-menu'],
    ['Adjust', 'Histogram, levels, looks', 'adjust', '#adj-panel'],
    ['Adjust', 'Sliders, curve, mixer, grading, masks, spots, detail', 'adjust2', '#adj-panel'],
    ['Adjust', 'Strip of photos', 'adjust', '#mode-strip'],
    ['Paint', 'Head and its buttons', 'paint', '.paint-head'],
    ['Paint', 'Tool options (brush)', 'paint', '#paint-options'],
    ['Paint', 'Tool options (text)', 'paint2', '#paint-options'],
    ['Paint', 'Tools', 'paint', '#paint-tools'],
    ['Paint', 'Colours and layers', 'paint', '.paint-panel']
];
// What the script can't see: checked by hand on the real app
const BY_HAND = [
    'Windows: the title bar drags the window, double-click maximises, the top edge resizes, Snap still works',
    'Windows: minimise, maximise and close in the title bar; the maximised window keeps its edges on screen',
    'Menus from the keyboard (Alt, arrows, Enter, Esc)',
    'Tooltips (drawn by Windows, not the theme)',
    'Import from a camera or card',
    'Let jEditor open your photos (permissions)',
    'Stored projects',
    'A folder that\'s already there (Move to…)',
    'Part of a project (order prompt)',
    'Camera window',
    'Drag and drop onto the window',
    'A real scan: preview, boxes, the photos coming in',
    'Photos picked one by one (the Save… bar)'
];

// jEditor's own look, by hand: [what, the looks it applies to]
const BY_HAND_OWN = [
    ['In the real fonts: Segoe UI, SF, the desktop\'s', ['windows', 'mac', 'mac26', 'linux', 'web']],
    ['With larger system text (Windows: Text size; Mac and Linux: larger text)', ['windows', 'mac', 'mac26', 'linux', 'web']],
    ['The window: dragged, maximised, resized, snapped', ['windows', 'mac', 'mac26', 'linux']],
    ['The traffic lights cover nothing, and the window drags by its top', ['mac']],
    ['macOS 26\'s own toolbar (Liquid Glass) holds the top row, nothing under it', ['mac26']],
    ['Mica and Acrylic behind the window', ['windows']],
    ['Installed as an app (the browser\'s Install)', ['web']],
    ['Touch and a pen', ['windows', 'web']]
];

const pageAudit = ({ sel, font }) => {
    const vw = innerWidth, vh = innerHeight;
    const out = [];
    const roots = [...document.querySelectorAll(sel)].filter(r => r.getClientRects().length && getComputedStyle(r).visibility !== 'hidden');
    if (!roots.length) return { shown: false, issues: [] };
    const name = (el) => {
        const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || el.placeholder || '').trim().split('\n')[0].slice(0, 40);
        const id = el.id ? '#' + el.id : el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '';
        return `${el.tagName.toLowerCase()}${id}${t ? ` "${t}"` : ''}`;
    };
    const shown = (el) => {
        if (!el.getClientRects().length) return false;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || +cs.opacity === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
    };
    const ownText = (el) => [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
    const LEAVES = 'button, input, select, textarea, label, a, img, canvas, h1, h2, h3, h4, [role="tab"], [role="option"], .tb-btn, .paint-tool';
    const seen = new Set();
    for (const root of roots) {
        const els = [...root.querySelectorAll('*')].filter(el => el.matches(LEAVES) || ownText(el));
        for (const el of els) {
            if (seen.has(el) || !shown(el) || el.closest('[aria-hidden="true"]') || el.matches('input[type="color"]')) continue;
            // In a section folded shut: not on screen
            const fold = el.closest('details:not([open])');
            if (fold && !el.closest('summary')) continue;
            seen.add(el);
            const r = el.getBoundingClientRect();
            const what = name(el);
            // Past the window's edge or cut off by its box, unless a scroll box would bring it in
            let clipped = null, scrolls = false;
            for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
                const cs = getComputedStyle(a);
                const ox = cs.overflowX, oy = cs.overflowY;
                if (ox === 'visible' && oy === 'visible') continue;
                const ar = a.getBoundingClientRect();
                const outside = r.left < ar.left - 1 || r.right > ar.right + 1 || r.top < ar.top - 1 || r.bottom > ar.bottom + 1;
                if (!outside) continue;
                if (/auto|scroll/.test(ox + oy) && (a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1)) {
                    // Only reached by scrolling a panel sideways: a fault, unless the box
                    // is a strip made to scroll that way (the film strip, the photos' strip)
                    const sideways = r.left < ar.left - 1 || r.right > ar.right + 1;
                    if (sideways && oy !== 'hidden' && a.scrollWidth > a.clientWidth + 1) out.push(['off screen', `${what} only fits by scrolling ${name(a).split(' ')[0]} sideways`]);
                    scrolls = true;
                    break;
                }
                clipped = a;
                break;
            }
            // Scrolled out of its box: not on screen, nothing more to check
            if (scrolls) continue;
            {
                if (clipped && (r.width > 4 && r.height > 4)) {
                    const ar = clipped.getBoundingClientRect();
                    const vis = Math.max(0, Math.min(r.right, ar.right) - Math.max(r.left, ar.left)) * Math.max(0, Math.min(r.bottom, ar.bottom) - Math.max(r.top, ar.top));
                    if (vis < r.width * r.height * 0.9) out.push(['off screen', `${what} is cut off by ${name(clipped).split(' ')[0]}`]);
                } else if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
                    out.push(['off screen', `${what} goes past the window's ${r.right > vw + 1 ? 'right' : r.bottom > vh + 1 ? 'bottom' : r.left < -1 ? 'left' : 'top'} edge`]);
                }
            }
            // Its words or icon reach outside its own button
            const btn = el.parentElement && el.parentElement.closest('button');
            if (btn && !el.matches('button') && shown(btn)) {
                const br = btn.getBoundingClientRect();
                const by = Math.max(br.left - r.left, r.right - br.right, br.top - r.top, r.bottom - br.bottom);
                if (by > 1) out.push(['spills', `${what} spills ${Math.round(by)}px out of ${name(btn)}`]);
            }
            // Two buttons over each other
            if (el.matches('button')) {
                for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
                    if (!sib.matches('button') || !shown(sib)) continue;
                    const sr = sib.getBoundingClientRect();
                    const w = Math.min(r.right, sr.right) - Math.max(r.left, sr.left), h = Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top);
                    if (w > 2 && h > 2) out.push(['overlaps', `${what} and ${name(sib)} are over each other`]);
                }
            }
            // Under the theme's title bar or menu bar
            const top = document.getElementById('th-top');
            if (top && !top.contains(el) && !scrolls) {
                const tr = top.getBoundingClientRect();
                if (r.top < tr.bottom - 2 && r.bottom > tr.top && r.height > 4) {
                    const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), y = Math.max(0, Math.min(r.top + 2, tr.bottom - 1));
                    const at = document.elementFromPoint(x, y);
                    if (at && top.contains(at)) out.push(['covered', `${what} is under the title bar`]);
                }
            }
            // A button with neither words nor a picture
            if (el.matches('button, [role="button"], [role="tab"], .tb-btn, .paint-tool') && !el.closest('.paint-palette, .accent-swatches, .th-caps, .theme-dots')) {
                const words = (el.innerText || '').trim() && getComputedStyle(el).fontSize !== '0px';
                const pic = [...el.querySelectorAll('svg, img, canvas')].some(shown)
                    || [...el.querySelectorAll('*')].some(c => shown(c) && !/rgba\(0, 0, 0, 0\)/.test(getComputedStyle(c).backgroundColor));
                // a picture, a colour dot, or a box drawn small (1984's close box)
                const bg = (e, p) => {
                    const cs = getComputedStyle(e, p);
                    if (cs.backgroundImage !== 'none') return true;
                    if (!p) return r.width <= 18 && r.height <= 18 && parseFloat(cs.borderTopWidth) > 0;
                    const drawn = cs.content && cs.content !== 'none' && cs.content !== 'normal';
                    return drawn && (cs.content !== '""' || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0);
                };
                const inline = el.style.background || el.style.backgroundColor;
                if (!words && !pic && !bg(el) && !bg(el, '::before') && !bg(el, '::after') && !inline) out.push(['no icon', `${what} shows nothing`]);
            }
            // Words cut off without an ellipsis
            if ((el.innerText || '').trim() && el.matches('button, label, h1, h2, h3, h4, span, a, [role="tab"]')) {
                const cs = getComputedStyle(el);
                if (/hidden|clip/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2) out.push(['text cut', `${what}: the words don't fit`]);
            }
            // Still in jEditor's own font
            if (font && ownText(el) && !new RegExp(font).test(getComputedStyle(el).fontFamily) && !el.closest('.paint-text, kbd, .sc-key, code, pre, .rename-preview')) out.push(['own font', `${what} (${getComputedStyle(el).fontFamily.split(',')[0]})`]);
        }
    }
    return { shown: true, issues: out };
};

const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const p = u.startsWith('/photos/') ? path.join(PH, u.slice(8)) : path.join(REPO, 'app', u.endsWith('/') ? u + 'index.html' : u);
    fs.readFile(p, (e, d) => {
        if (e) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream' });
        res.end(d);
    });
});

(async () => {
    const [onlyTheme, onlyScreen] = process.argv.slice(2);
    if (!fs.existsSync(PH) || !fs.readdirSync(PH).some(f => f.endsWith('.jpg'))) { console.error('No photos: see design/themes/README.md (Try one) for fetching them'); process.exit(1); }
    const files = fs.readdirSync(PH).filter(f => f.endsWith('.jpg')).sort().slice(0, 20);
    const names = ['Coast road.jpg', 'Harbour at dusk.jpg', 'Old bridge.jpg', 'Morning fog.jpg', 'Pine forest.jpg', 'Lighthouse.jpg', 'Kitchen window.jpg', 'Market.jpg', 'Dunes.jpg', 'Grandad.jpg', 'Allotment.jpg', 'Lake.jpg', 'Snow line.jpg', 'Back garden.jpg', 'Station.jpg', 'Cliffs.jpg', 'Rain.jpg', 'Pier.jpg', 'Valley.jpg', 'Field.jpg'];
    await new Promise(r => srv.listen(0, r));
    const base = `http://localhost:${srv.address().port}`;
    const browser = await chromium.launch(launchOptions());
    const looks = LOOKS.filter(([k]) => !onlyTheme || k === onlyTheme);
    const screens = Object.keys(SCREENS).filter(s => !onlyScreen || s === onlyScreen);
    const results = {}; // results[look][part index] = { shown, issues: [[size, kind, text]] }
    const missing = {}; // look → files not found
    for (const [key, , theme, platform, standIn, htmlClass] of looks) {
        results[key] = PARTS.map(() => ({ shown: false, issues: [] }));
        missing[key] = new Set();
        for (const [w, h, density] of SIZES) {
            const ctx = await browser.newContext({ viewport: { width: w, height: h } });
            await ctx.addInitScript(({ platform, features, standIn, htmlClass, density }) => {
                // What the app would answer: nothing (no drives, scanners, places)
                const mac = platform !== 'windows';
                const answers = {
                    platform, features, titleBar() {}, windowAction() {}, setState() {}, watchLog() {}, permissionsSeen() {},
                    async places() { return { drives: [{ name: mac ? 'Macintosh HD' : 'Local Disk (C:)', path: mac ? '/' : 'C:\\', kind: 'fixed', free: 2e11, size: 5e11 }], home: [{ name: 'Pictures', path: mac ? '/Users/me/Pictures' : 'C:\\Users\\me\\Pictures' }] }; },
                    async permissions() { return { firstRun: false, rows: [] }; },
                    async countPhotos(paths) { return { counts: paths.map(() => 0), limit: 1000 }; },
                    async windows() { return []; }
                };
                if (platform !== 'web') window.JEditorNative = new Proxy(answers, {
                    get: (t, k) => k in t ? t[k] : (typeof k === 'string' && !k.startsWith('on') ? async () => [] : undefined)
                });
                try {
                    localStorage.setItem('jeditor.whatsNewSeen', '9.9.9');
                    const prefs = JSON.parse(localStorage.getItem('jeditor.ui') || '{}');
                    localStorage.setItem('jeditor.ui', JSON.stringify({ ...prefs, density }));
                } catch (e) { /* none */ }
                document.addEventListener('DOMContentLoaded', () => {
                    if (htmlClass) document.documentElement.classList.add(htmlClass);
                    if (standIn) {
                        const st = document.createElement('style');
                        st.textContent = `:root:not([data-skin]) { --font-ui: "${standIn}"; } :root:not([data-skin]) body { font-family: "${standIn}"; }`;
                        document.head.appendChild(st);
                    }
                });
            }, { platform, features: FEATURES[platform] || [], standIn, htmlClass, density });
            const page = await ctx.newPage();
            page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/photos/')) missing[key].add(r.url().replace(base + '/', '')); });
            page.on('pageerror', e => console.log('page error', key, e.message));
            // Scanning is Windows only: on the others the window never opens
            for (const s of screens) {
                if (s === 'scan' && !(FEATURES[platform] || []).includes('scan')) continue;
                const [folder, setup] = SCREENS[s];
                await page.goto(base + '/index.html');
                await page.waitForTimeout(300);
                await page.evaluate(({ theme, density }) => {
                    if (theme) { Experiments.set('themes', true); Themes.choose(theme); }
                    document.documentElement.dataset.density = density;
                }, { theme, density });
                if (folder) await page.evaluate(async ({ files, names }) => {
                    const root = await navigator.storage.getDirectory();
                    let dir;
                    try { dir = await root.getDirectoryHandle('Summer 2024'); } catch (e) {
                        dir = await root.getDirectoryHandle('Summer 2024', { create: true });
                        const subs = { 'Coast trip': [0, 1, 5, 8, 15, 17], 'Garden': [10, 13] };
                        const where = {}; for (const [k, v] of Object.entries(subs)) for (const i of v) where[i] = k;
                        for (let i = 0; i < files.length; i++) {
                            const b = await (await fetch('/photos/' + files[i])).blob();
                            const d = where[i] ? await dir.getDirectoryHandle(where[i], { create: true }) : dir;
                            const wr = await (await d.getFileHandle(names[i] || files[i], { create: true })).createWritable(); await wr.write(b); await wr.close();
                        }
                    }
                    window.showDirectoryPicker = async () => dir;
                    await app.browseFolder();
                    while (app.files.some(f => !f.thumbnailUrl)) await new Promise(r => setTimeout(r, 50));
                }, { files, names });
                await page.waitForTimeout(400);
                await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
                if (setup) await page.evaluate(`setTimeout(() => { ${setup} }, 0)`);
                await page.mouse.move(w / 2, h - 2);
                await page.waitForTimeout(1500);
                if (process.env.SHOTS) {
                    fs.mkdirSync(process.env.SHOTS, { recursive: true });
                    await page.screenshot({ path: path.join(process.env.SHOTS, `${key.replace('/', '-')}-${s}-${w}.png`) });
                }
                const font = theme ? FONT[theme.split('/')[0]].source : '';
                for (let i = 0; i < PARTS.length; i++) {
                    if (PARTS[i][2] !== s) continue;
                    const r = await page.evaluate(pageAudit, { sel: PARTS[i][3], font });
                    const into = results[key][i];
                    into.shown = into.shown || r.shown;
                    const have = new Set(into.issues.map(x => x[1] + x[2]));
                    for (const [kind, text] of r.issues) if (!have.has(kind + text)) into.issues.push([`${w}×${h}${density === 'comfortable' ? ', comfortable' : ''}`, kind, text]);
                }
            }
            await ctx.close();
            process.stdout.write(`${key} ${w}×${h} done\n`);
        }
    }
    await browser.close();
    srv.close();
    if (onlyTheme || onlyScreen) {
        for (const [key] of looks) for (let i = 0; i < PARTS.length; i++) for (const x of results[key][i].issues) console.log(key, PARTS[i][1], ...x);
        return;
    }
    // The checklist
    const cell = (r) => !r.shown ? '—' : r.issues.length ? `⚠ ${r.issues.length}` : '✓';
    const OWN = LOOKS.filter(l => !l[2]), THEMED = LOOKS.filter(l => l[2]);
    let md = '# Look checklist\n\n';
    md += 'Every part of jEditor: in its own look on each platform (the Windows app, the Mac app with and without macOS 26\'s own toolbar, Linux, a browser) and in every theme (the Windows app). Written by `node design/themes/audit.js`, which opens each screen at 1280×800, 1024×640 and 800×600 with comfortable density, and checks each part for: words or buttons off screen or cut off; anything under a theme\'s title bar; buttons with neither words nor an icon; words or icons spilling out of their button; buttons over each other; words cut off without "…"; words in the wrong font; files that aren\'t there. Run it again after changing how anything looks.\n\n';
    md += 'The platforms\' own fonts aren\'t on the machine it runs on: Inter stands in for Segoe UI and SF (a little wider, so what fits here fits there), DejaVu Sans for Linux and a browser.\n\n';
    md += '✓ nothing found · ⚠ n problems (listed below) · — not on screen there\n\n';
    md += `Checked ${new Date().toISOString().slice(0, 10)}.\n\n`;
    let area = '';
    for (let i = 0; i < PARTS.length; i++) {
        const [a, name] = PARTS[i];
        if (a !== area) {
            area = a;
            md += `\n## ${a}\n\n| Part | ${LOOKS.map(t => t[1]).join(' | ')} |\n|---|${LOOKS.map(() => ':-:').join('|')}|\n`;
        }
        md += `| ${name} | ${LOOKS.map(([k]) => results[k] ? cell(results[k][i]) : ' ').join(' | ')} |\n`;
    }
    md += '\n## Checked by hand\n\nWhat the script can\'t see. Tick each on the real app.\n\n### jEditor\'s own look\n\n';
    md += `| | ${OWN.map(t => t[1]).join(' | ')} |\n|---|${OWN.map(() => ':-:').join('|')}|\n`;
    for (const [b, on] of BY_HAND_OWN) md += `| ${b} | ${OWN.map(t => on.includes(t[0]) ? '☐' : '—').join(' | ')} |\n`;
    md += '\n### Themes\n\n';
    md += `| | ${THEMED.map(t => t[1]).join(' | ')} |\n|---|${THEMED.map(() => ':-:').join('|')}|\n`;
    for (const b of BY_HAND) md += `| ${b} | ${THEMED.map(() => '☐').join(' | ')} |\n`;
    md += '\n## Problems found\n';
    for (const [k, label] of LOOKS) {
        if (!results[k]) continue;
        const rows = [];
        PARTS.forEach((p, i) => results[k][i].issues.forEach(([size, kind, text]) => rows.push(`- **${p[0]} · ${p[1]}** (${size}) ${kind}: ${text}`)));
        for (const f of missing[k]) rows.push(`- missing file: \`${f}\``);
        md += `\n### ${label}\n\n${rows.length ? rows.join('\n') : 'None.'}\n`;
    }
    fs.writeFileSync(path.join(REPO, 'docs/themes-checklist.md'), md);
    console.log('wrote docs/themes-checklist.md');
})();
