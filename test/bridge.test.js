#!/usr/bin/env node
// Tests for src/bridge.js: the real jEditor UI (app/) in headless Chromium, served at the Windows app's origin, with
// a fake chrome.webview standing in for the app. Folders are real
// FileSystemDirectoryHandles from the browser's private file system, so
// jEditor reads and writes them as it would a folder on disk.
//
//   npm test          (with the UI tests; needs Chrome or Chromium, CHROME_PATH to choose one)
//   node test/bridge.test.js    just these

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const UI = path.join(ROOT, 'app');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'src', 'bridge.js'), 'utf8');
const ORIGIN = 'https://jeditor.example';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function launchOptions() {
    const candidates = [
        process.env.CHROME_PATH,
        '/opt/pw-browsers/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return { executablePath: p, args: ['--no-sandbox'] };
    }
    return { channel: 'chrome', args: ['--no-sandbox'] };
}

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// The app's side of chrome.webview: messages the page posts are kept in
// window.__posted (and passed to window.__onPost if set);
// window.__deliver(data, objects) sends one to the page.
const FAKE_WEBVIEW = `
    window.chrome = window.chrome || {};
    window.__posted = [];
    window.__listeners = [];
    window.chrome.webview = {
        postMessage(m) { window.__posted.push(m); if (window.__onPost) window.__onPost(m); },
        // As WebView2: a File from a file handle can't be sent (only ones
        // dropped or chosen from outside the page can, not made here)
        postMessageWithAdditionalObjects(m, objects) {
            if ([...objects].some(o => o instanceof File)) throw new TypeError('Unsupported object in additionalObjects');
            m.__objects = objects;
            this.postMessage(m);
        },
        addEventListener(type, fn) { if (type === 'message') window.__listeners.push(fn); },
        removeEventListener() { }
    };
    window.__deliver = (data, additionalObjects = []) =>
        window.__listeners.forEach(fn => fn({ data, additionalObjects }));
`;

// A folder of real JPEGs in the private file system
const MAKE_FOLDER = async (name, count) => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(name, { recursive: true }); } catch (e) { }
    const dir = await root.getDirectoryHandle(name, { create: true });
    for (let i = 1; i <= count; i++) {
        const c = document.createElement('canvas');
        c.width = 120; c.height = 80;
        const g = c.getContext('2d');
        g.fillStyle = `hsl(${i * 70},60%,50%)`;
        g.fillRect(0, 0, 120, 80);
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
        const f = await dir.getFileHandle(`photo${i}.jpg`, { create: true });
        const w = await f.createWritable();
        await w.write(blob);
        await w.close();
    }
    return dir;
};

async function serveUi(context, origin = ORIGIN) {
    await context.route(origin + '/**', (route) => {
        const urlPath = decodeURIComponent(new URL(route.request().url()).pathname);
        const file = path.normalize(path.join(UI, urlPath === '/' ? 'index.html' : urlPath));
        if (!file.startsWith(UI) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
        route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
}

// A page as the Windows app shows it: fake webview, then the bridge, then
// jEditor
async function openPage(browser, { origin = ORIGIN, webview = true, dev = false } = {}) {
    const context = await browser.newContext();
    await serveUi(context, origin);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    if (webview) await page.addInitScript(FAKE_WEBVIEW);
    if (dev) await page.addInitScript('window.__jeditorDev = true;');
    await page.addInitScript(BRIDGE);
    await page.goto(origin + '/index.html');
    await page.waitForFunction(() => typeof app !== 'undefined' && app.elements);
    return { context, page, errors };
}

const waitForPost = (page, type) => page.waitForFunction(
    (t) => window.__posted.find(m => m.type === t), type, { timeout: 15000 }).then(h => h.jsonValue());

(async () => {
    const browser = await chromium.launch(launchOptions());

    console.log('bridge: start-up');
    {
        const { context, page, errors } = await openPage(browser);
        const ready = await waitForPost(page, 'ready');
        const version = fs.readFileSync(path.join(UI, 'version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
        check('posts ready with jEditor\'s version', ready.version === version, JSON.stringify(ready));
        const theme = await waitForPost(page, 'theme');
        check('posts the theme and background colour', typeof theme.dark === 'boolean' && /^rgba?\(/.test(theme.background), JSON.stringify(theme));

        const r = await page.evaluate(async () => ({
            picker: window.showDirectoryPicker.name === 'showDirectoryPicker' && /request\('pickFolder'\)/.test(String(window.showDirectoryPicker)),
            sw: await navigator.serviceWorker.register('sw.js'),
            regs: (await navigator.serviceWorker.getRegistrations()).length,
            recents: Recents.supported()
        }));
        check('replaces the folder picker', r.picker);
        check('no service worker is registered', r.sw === null || r.sw === undefined ? r.regs === 0 : false, JSON.stringify(r));
        check('recent orders stay available', r.recents);

        // A theme change is reported once
        await page.evaluate(() => { window.__posted.length = 0; document.documentElement.dataset.theme = 'light'; });
        const light = await waitForPost(page, 'theme');
        check('reports a theme change', light.dark === false, JSON.stringify(light));
        check('start-up: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('bridge: Open folder');
    {
        const { context, page, errors } = await openPage(browser);
        await waitForPost(page, 'ready');
        // The app answers the picker with a folder of three photos
        await page.evaluate(async (make) => {
            const dir = await (eval(make))('Smith Order', 3);
            window.__onPost = (m) => {
                if (m.type === 'pickFolder') setTimeout(() => window.__deliver({ replyTo: m.id, path: 'D:\\Orders\\Smith Order' }, [dir]), 10);
            };
        }, MAKE_FOLDER.toString());
        await page.click('#btn-browse-folder');
        await page.waitForFunction(() => app.files.length === 3 && !app.isLoading, null, { timeout: 15000 });
        const r = await page.evaluate(() => ({
            picks: window.__posted.filter(m => m.type === 'pickFolder').length,
            name: app.dirHandle && app.dirHandle.name,
            writable: !app.readOnlyMode
        }));
        check('Open folder asks the app once', r.picks === 1, JSON.stringify(r));
        check('opens the folder the app picked, for editing', r.name === 'Smith Order' && r.writable, JSON.stringify(r));

        // Remembered under Recent, with its handle
        await page.evaluate(() => Recents.saving);
        const recents = await page.evaluate(async () => (await Recents.list()).map(x => x.name));
        check('the folder goes on the Recent list', recents[0] === 'Smith Order', JSON.stringify(recents));
        check('open folder: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('bridge: picker cancelled');
    {
        const { context, page, errors } = await openPage(browser);
        await waitForPost(page, 'ready');
        await page.evaluate(() => {
            window.__onPost = (m) => { if (m.type === 'pickFolder') setTimeout(() => window.__deliver({ replyTo: m.id, cancelled: true }), 10); };
        });
        await page.click('#btn-browse-folder');
        await page.waitForFunction(() => window.__posted.some(m => m.type === 'pickFolder'));
        await page.waitForTimeout(300);
        const r = await page.evaluate(() => ({
            files: app.files.length,
            startScreen: !document.getElementById('drop-zone').classList.contains('hidden'),
            dialog: typeof UI !== 'undefined' && UI.isOpen()
        }));
        check('cancelling leaves the start screen, with no error message', r.files === 0 && r.startScreen && !r.dialog, JSON.stringify(r));
        check('cancel: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('bridge: folder from the command line, and the smoke test');
    {
        const { context, page, errors } = await openPage(browser);
        await waitForPost(page, 'ready');
        const before = await page.evaluate(async (make) => {
            const dir = await (eval(make))('Jones', 4);
            window.__dir = dir;
            const bytes = async () => {
                const out = [];
                for await (const h of dir.values()) if (h.kind === 'file') out.push([h.name, new Uint8Array(await (await h.getFile()).arrayBuffer()).join(',')]);
                return Object.fromEntries(out);
            };
            window.__bytes = bytes;
            // The app's side of the smoke test's further steps
            window.__onPost = async (m) => {
                const reply = (data, objects = []) => setTimeout(() => window.__deliver({ replyTo: m.id, ...data }, objects), 5);
                if (m.type === 'dataDir') reply({ path: 'C:\\data' }, [await (await navigator.storage.getDirectory()).getDirectoryHandle('appdata', { create: true })]);
                else if (m.type === 'recycle') { window.__recycledPaths = m.paths; reply({ results: m.paths.map(() => ({ noBin: true })) }); }
                else if (m.type === 'smokeCheck') { (window.__checks = window.__checks || []).push(m); reply({ ok: true }); }
                else if (m.type === 'places') reply({ drives: [{ path: 'C:\\', name: 'Local disk (C:)', kind: 'disk' }], home: [] });
                else if (m.type === 'listDir') {
                    let n = 0;
                    for await (const h of dir.values()) if (h.kind === 'file' && /\.jpe?g$/i.test(h.name)) n++;
                    reply({ path: m.path, name: 'Jones', parent: 'C:\\', folders: [], photos: n, more: false });
                }
                else if (m.type === 'listProjects') reply({ projects: [{ name: 'Jones', path: 'C:\\Jones', modified: Date.now() }] });
                else if (m.type === 'countPhotos') {
                    let n = 0;
                    for await (const h of dir.values()) if (h.kind === 'file' && /\.jpe?g$/i.test(h.name)) n++;
                    reply({ counts: m.paths.map(() => n), limit: 1000 });
                }
                else if (m.type === 'quickAccess') reply({ folders: [] });
                else if (m.type === 'newWindow' || m.type === 'split') reply({ ok: true });
                else if (m.type === 'transfer') reply({ items: m.paths.map(p => ({ from: p, to: m.dest + '\\' + p.split('\\').pop() })) });
                else if (m.type === 'undoTransfer') reply({ errors: m.items.map(() => null) });
                else if (m.type === 'scanners') reply({ devices: [{ id: 'jeditor-test-scanner', name: 'jEditor test scanner', driver: 'test' }], problems: [] });
                else if (m.type === 'scan') {
                    // The app's side: three photos into the folder, each posted as it lands
                    window.__scan = m;
                    const names = [];
                    for (let i = 0; i < 3; i++) {
                        const name = m.prefix + String(m.next + i).padStart(m.digits, '0') + '.jpg';
                        const c = document.createElement('canvas');
                        c.width = 90; c.height = 60;
                        c.getContext('2d').fillRect(0, 0, 10 + i, 10);
                        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg'));
                        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
                        await w.write(blob);
                        await w.close();
                        names.push(name);
                        // The last one's message comes after the reply (as it once did): the reply's list covers it
                        if (i < 2) window.__deliver({ type: 'scanned', scan: m.id, name });
                    }
                    reply({ count: names.length, names });
                }
                else if (m.type === 'checkUpdate') reply({ tag: 'v1.0.0', current: 'v1.0.0', newer: false });
            };
            const b = await bytes();
            window.__deliver({ type: 'openFolder', path: 'C:\\Jones', smoke: true }, [dir]);
            return b;
        }, MAKE_FOLDER.toString());
        const opened = await waitForPost(page, 'opened');
        check('opens the folder and reports the photo count', opened.name === 'Jones' && opened.count === 4, JSON.stringify(opened));
        const smoke = await waitForPost(page, 'smoke');
        check('smoke test: reports success', smoke.ok && smoke.count === 4 && smoke.rotated && smoke.errors.length === 0, JSON.stringify(smoke));
        check('smoke test: runs the further steps through the app', smoke.steps && smoke.steps.stored === true && smoke.steps.deleted === true && smoke.steps.restored === true && smoke.steps.scanned === true && smoke.steps.places === true && smoke.steps.browsed === true && smoke.steps.projects === true && smoke.steps.counted === true && smoke.steps.pins === true && smoke.steps.windows === true && smoke.steps.moved === true && smoke.steps.unmoved === true && smoke.steps.back === true && /v1\.0\.0/.test(smoke.steps.update), JSON.stringify(smoke.steps));
        const scanned = await page.evaluate(() => ({ scan: window.__scan, check: (window.__checks || []).find(c => c.step === 'scanned') }));
        check('smoke test: scans into the order with the test scanner, named next in its sequence', scanned.scan && scanned.scan.folder === 'C:\\Jones' && scanned.scan.device === 'jeditor-test-scanner' &&
            scanned.check && scanned.check.names.join() === 'photo5.jpg,photo6.jpg,photo7.jpg' && scanned.check.shown === 3, JSON.stringify(scanned));
        const after = await page.evaluate(() => window.__bytes());
        const changed = Object.keys(before).filter(k => before[k] !== after[k]);
        check('smoke test: the rotation is saved to the file, and only that one', changed.length === 1 && changed[0] === smoke.file, changed.join(', '));
        const recycled = await page.evaluate(() => window.__recycledPaths || []);
        check('smoke test: deletes by path, in the folder the app sent', recycled.length === 1 && /^C:\\Jones\\photo\d\.jpg$/.test(recycled[0]), recycled.join());
        await page.reload();
        await page.waitForFunction(() => typeof app !== 'undefined' && app.elements && window.JEditorNative);
        const remembered = await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            const other = await root.getDirectoryHandle('Elsewhere', { create: true });
            return [await JEditorNative.folderPath(await root.getDirectoryHandle('Jones')), await JEditorNative.folderPath(other)];
        });
        check('folder paths are remembered after a restart (recent orders); unknown ones are null', remembered[0] === 'C:\\Jones' && remembered[1] === null, JSON.stringify(remembered));
        check('command line: no JS errors', errors.length === 0, errors.join('; '));
        await context.close();
    }

    console.log('bridge: dev mode');
    {
        const { context, page } = await openPage(browser, { dev: true });
        await waitForPost(page, 'ready');
        await page.keyboard.press('F5');
        await page.keyboard.press('Control+r');
        await page.keyboard.press('F12');
        const actions = await page.evaluate(() => window.__posted.filter(m => m.type === 'dev').map(m => m.action));
        check('F5, Ctrl+R and F12 go to the app', actions.join() === 'reload,reload,devtools', actions.join());

        const hrefs = () => page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')));
        const old = await hrefs();
        await page.evaluate(() => window.__deliver({ type: 'reloadCss' }));
        await page.waitForFunction((n) => {
            const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
            return links.length === n && links.every(l => /[?&]v=\d+/.test(l.href));
        }, old.length, { timeout: 5000 }).catch(() => { });
        const fresh = await hrefs();
        check('reloadCss swaps every stylesheet in place', fresh.length === old.length && fresh.every(h => /[?&]v=\d+/.test(h)), fresh.join(', '));
        const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        check('the page is still styled after the swap', styled !== 'rgba(0, 0, 0, 0)', styled);
        await context.close();

        const plain = await openPage(browser);
        await waitForPost(plain.page, 'ready');
        await plain.page.keyboard.press('F5');
        const none = await plain.page.evaluate(() => window.__posted.filter(m => m.type === 'dev').length);
        check('outside dev mode, F5 stays with jEditor', none === 0);
        await plain.context.close();
    }

    console.log('bridge: only in the Windows app');
    {
        const other = await openPage(browser, { origin: 'https://elsewhere.example' });
        await other.page.waitForTimeout(300);
        const r1 = await other.page.evaluate(() => ({ posted: window.__posted.length, native: /native code/.test(String(window.showDirectoryPicker)) }));
        check('does nothing on another site', r1.posted === 0 && r1.native, JSON.stringify(r1));
        await other.context.close();

        const browserOnly = await openPage(browser, { webview: false });
        const r2 = await browserOnly.page.evaluate(() => /native code/.test(String(window.showDirectoryPicker)));
        check('does nothing in a plain browser', r2);
        check('plain browser: no JS errors', browserOnly.errors.length === 0, browserOnly.errors.join('; '));
        await browserOnly.context.close();
    }

    await browser.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
