#!/usr/bin/env node
// The host's own file handles (mac/handles.js, mac/fs-host.js): the page's
// file layer for web views without File System Access (WebKit), step 1 of
// docs/plans/lighter-desktop.md. Served here from Node, as the app would.
//   1. The same file operations as Chromium's own handles, with the same
//      results (test/handles-conformance.js), in Chromium and in WebKit.
//   2. jEditor itself in WebKit on a folder on disk, through them: open,
//      rotate, rename, delete and undo, Recents another day.
// test/mac.test.js runs the real app with them (JEDITOR_HOST_HANDLES=1).
// With JEDITOR_CORE (the Rust core's binary, desktop/core: step 2), part 1
// runs on it too, in place of Node's fs-host.js.
//
//   node test/handles.test.js         (WebKit: npx playwright-core install webkit)
//   JEDITOR_CORE=desktop/core/target/debug/jeditor-core node test/handles.test.js

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const pw = require('playwright-core');
const { launchOptions, QUIET_FIRST_OPEN } = require('./page-helpers.js');
const { CONFORMANCE, EXPECTED, KNOWN } = require('./handles-conformance.js');
const fsHost = require('../mac/fs-host.js');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// The page's side: handles.js, given a transport to this server
const INSTALL = `<script src="/__host/handles.js"></script>
    <script>
    HostHandles.install({
        call: async (op, data) => {
            // Bytes go as base64 (the binding takes JSON)
            if (data && data.data instanceof Uint8Array) {
                let s = ''; const b = data.data;
                for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
                data = { ...data, data: btoa(s), b64: true };
            }
            return window.__fsHost(op, data);
        },
        fileUrl: (p) => '/__fs?p=' + encodeURIComponent(p),
        pick: { folder: async () => window.__pick(), files: async () => window.__pick(), save: async () => window.__pick() }
    });
    </script>`;

// Who answers the file requests: Node's fs-host.js, or the Rust core
let host = fsHost;

// The Rust core's binary, spoken to a JSON line at a time (src/main.rs there)
function rustCore(bin) {
    const { spawn } = require('child_process');
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const waiting = new Map();
    let next = 1, buf = '';
    child.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            const { id, answer } = JSON.parse(line);
            waiting.get(id)(answer);
            waiting.delete(id);
        }
    });
    const call = (op, data) => new Promise((resolve) => {
        const id = next++;
        waiting.set(id, resolve);
        child.stdin.write(JSON.stringify({ id, op, data }) + '\n');
    });
    return {
        request: (op, data) => {
            if (data && Buffer.isBuffer(data.data)) data = { ...data, data: data.data.toString('base64'), b64: true };
            return call(op, data);
        },
        respond: async (file, range) => {
            const r = await call('read', { path: file, range: range || null });
            return new Response(r.status === 200 || r.status === 206 ? Buffer.from(r.body, 'base64') : null, { status: r.status, headers: r.headers });
        },
        close: () => child.stdin.end(),
    };
}

function serve() {
    return http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://x');
        try {
            if (url.pathname === '/__fs') {
                const r = await host.respond(url.searchParams.get('p') || '', req.headers.range);
                const headers = {};
                r.headers.forEach((v, k) => { headers[k] = v; });
                res.writeHead(r.status, headers);
                return res.end(Buffer.from(await r.arrayBuffer()));
            }
            if (url.pathname === '/__host/handles.js') {
                res.writeHead(200, { 'content-type': 'text/javascript' });
                return res.end(fs.readFileSync(path.join(ROOT, 'mac', 'handles.js')));
            }
            let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
            const file = path.normalize(path.join(APP, rel));
            if (!file.startsWith(APP)) { res.writeHead(403); return res.end(); }
            let body = fs.readFileSync(file);
            const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            if (rel === '/index.html') body = Buffer.from(String(body).replace(/<script\b/, INSTALL + '\n    <script'));
            res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
            res.end(body);
        } catch (e) {
            res.writeHead(404); res.end('Not found');
        }
    });
}

async function pageFor(engine, baseUrl, profile, url = '/index.html') {
    const opts = { viewport: { width: 1280, height: 800 } };
    const ctx = engine === 'webkit'
        // WebKit's throwaway profiles have no OPFS; an app's profile is kept
        ? await pw.webkit.launchPersistentContext(profile, opts)
        : await pw.chromium.launchPersistentContext(profile, { ...launchOptions(), ...opts });
    await ctx.exposeBinding('__fsHost', (src, op, data) => {
        if (data && data.b64) data = { ...data, data: Buffer.from(data.data, 'base64') };
        return host.request(op, data);
    });
    await ctx.exposeBinding('__pick', () => ctx.__picked || null);
    const page = ctx.pages()[0] || await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(baseUrl + url, { waitUntil: 'load' });
    return { ctx, page, errors };
}

(async () => {
    const server = serve();
    await new Promise(r => server.listen(0, r));
    const baseUrl = `http://localhost:${server.address().port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jeditor-handles-'));
    let webkitThere = true;
    try { webkitThere = fs.existsSync(pw.webkit.executablePath()); } catch (e) { webkitThere = false; }

    // ---- 1. The same as Chromium's own handles ----
    const core = process.env.JEDITOR_CORE ? rustCore(path.resolve(process.env.JEDITOR_CORE)) : null;
    if (process.env.JEDITOR_CORE && !fs.existsSync(path.resolve(process.env.JEDITOR_CORE))) check('the Rust core is built (cargo build in desktop/core)', false, process.env.JEDITOR_CORE);
    for (const [engine, on] of [['chromium', fsHost], ['webkit', fsHost], ...(core ? [['chromium', core], ['webkit', core]] : [])]) {
        host = on;
        console.log(`the host's handles: as Chromium's own (${engine}${on === core ? ', on the Rust core' : ''})`);
        if (engine === 'webkit' && !webkitThere) {
            if (process.env.CI) check('WebKit is installed (npx playwright-core install webkit)', false);
            else console.log('  (skipped: no WebKit here; npx playwright-core install webkit)');
            continue;
        }
        const dir = fs.mkdtempSync(path.join(tmp, 'conf-'));
        const { ctx, page } = await pageFor(engine, baseUrl, fs.mkdtempSync(path.join(tmp, 'profile-')));
        const r = await page.evaluate(`(async () => (${CONFORMANCE})(HostHandles.folder(${JSON.stringify(dir)})))()`);
        const diff = Object.keys(EXPECTED).filter(k => r[k] !== (k in KNOWN ? KNOWN[k] : EXPECTED[k]));
        check(`every file operation gives what Chromium's does (${Object.keys(EXPECTED).length})`, diff.length === 0,
            diff.map(k => `${k}: wanted ${JSON.stringify(k in KNOWN ? KNOWN[k] : EXPECTED[k])}, got ${JSON.stringify(r[k])}`).join('; '));
        check('nothing is left behind (no half-written files)', fs.readdirSync(dir).length === 0, fs.readdirSync(dir).join());
        const kept = await page.evaluate(async (dir) => {
            // Kept in IndexedDB, and read back as a handle
            const h = HostHandles.folder(dir);
            const db = await new Promise((res, rej) => { const q = indexedDB.open('t', 1); q.onupgradeneeded = () => q.result.createObjectStore('s'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
            await new Promise((res, rej) => { const tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put({ handle: h, at: 1 }, 'k'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
            const back = await new Promise((res, rej) => { const q = db.transaction('s').objectStore('s').get('k'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
            const all = await new Promise((res) => { const q = db.transaction('s').objectStore('s').getAll(); q.onsuccess = () => res(q.result); });
            return { ours: HostHandles.isOurs(back.handle), same: await back.handle.isSameEntry(h), name: back.handle.name, all: HostHandles.isOurs(all[0].handle), at: back.at };
        }, dir);
        check('a handle kept in IndexedDB comes back as one (get and getAll)', kept.ours && kept.same && kept.all && kept.at === 1, JSON.stringify(kept));
        await ctx.close();
    }
    // ---- 2. jEditor in WebKit, on a folder on disk ----
    // (On the Rust core when it's given, as the Tauri app will be; Node's
    // fs-host.js is checked in part 1, and in the Mac app's own test)
    host = core || fsHost;
    console.log(`jEditor in WebKit, through the host's handles${core ? ' (on the Rust core)' : ''}`);
    if (!webkitThere) {
        if (process.env.CI) check('WebKit is installed', false);
        else console.log('  (skipped: no WebKit here)');
    } else {
        const order = path.join(tmp, 'Smith Order');
        fs.mkdirSync(path.join(order, 'Ceremony'), { recursive: true });
        const profile = fs.mkdtempSync(path.join(tmp, 'profile-'));
        {
            // Real JPEGs, one a big scan (a scaled decode would be tried on it)
            const { ctx, page } = await pageFor('chromium', baseUrl, fs.mkdtempSync(path.join(tmp, 'maker-')));
            const jpegs = await page.evaluate(async () => {
                const make = async (w, h, hue) => {
                    const c = new OffscreenCanvas(w, h); const g = c.getContext('2d');
                    g.fillStyle = `hsl(${hue},60%,50%)`; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 0, w / 4, h / 4);
                    const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
                    return Array.from(new Uint8Array(await b.arrayBuffer()));
                };
                return [await make(600, 400, 10), await make(600, 400, 120), await make(4800, 3200, 220), await make(600, 400, 300)];
            });
            await ctx.close();
            ['photo1.jpg', 'photo2.jpg', 'scan.jpg'].forEach((n, i) => fs.writeFileSync(path.join(order, n), Buffer.from(jpegs[i])));
            fs.writeFileSync(path.join(order, 'Ceremony', 'c1.jpg'), Buffer.from(jpegs[3]));
        }
        const before = fs.readFileSync(path.join(order, 'photo1.jpg'));

        let { ctx, page, errors } = await pageFor('webkit', baseUrl, profile);
        await page.waitForFunction(() => typeof app !== 'undefined' && app.elements);
        await page.evaluate(QUIET_FIRST_OPEN);
        // Turns written into the photo, not kept with the edits: the write is what's tested
        await page.evaluate(() => { app.uiPrefs.keepEdits = false; });
        const r = await page.evaluate(async (order) => {
            const out = {};
            const t0 = performance.now();
            await app.openDirectory(HostHandles.folder(order));
            out.files = app.files.map(f => f.relPath || f.name).sort().join();
            out.sizes = app.files.every(f => f.size > 0 && f.lastModified > 0);
            // The grid's thumbnails come, the big scan's too (no ImageDecoder hang)
            const thumbs = () => app.files.filter(f => f.thumbnailUrl).length;
            for (let i = 0; i < 200 && thumbs() < app.files.length; i++) await new Promise(r => setTimeout(r, 50));
            out.thumbs = thumbs();
            out.ms = Math.round(performance.now() - t0);
            return out;
        }, order);
        check('opens the folder, every photo listed with its size and date', r.files === 'Ceremony/c1.jpg,photo1.jpg,photo2.jpg,scan.jpg' && r.sizes, JSON.stringify(r));
        check('every thumbnail comes, a big scan\'s too (ImageDecoder doesn\'t hang)', r.thumbs === 4, JSON.stringify(r));

        const e = await page.evaluate(async () => {
            const out = {};
            const f = app.files.find(x => x.name === 'photo1.jpg');
            await app.rotateImage(f, 90);
            if (f._rotationQueue) await f._rotationQueue;
            for (let i = 0; i < 100 && (f.pendingRotation || f.savingRotation); i++) await new Promise(r => setTimeout(r, 50));
            const g = app.files.find(x => x.name === 'photo2.jpg');
            await app.renameFile(g, 'renamed.jpg');
            out.renamed = g.name;
            const v = app.files.find(x => x.name === 'scan.jpg');
            await app.moveToTrash([v]);
            out.afterTrash = app.files.length;
            return out;
        });
        const turned = !fs.readFileSync(path.join(order, 'photo1.jpg')).equals(before);
        check('a rename is made on disk (move(newName))', fs.existsSync(path.join(order, 'renamed.jpg')) && !fs.existsSync(path.join(order, 'photo2.jpg')) && e.renamed === 'renamed.jpg', JSON.stringify(e) + ' ' + fs.readdirSync(order).join());
        check('deleting takes it out of the folder', !fs.existsSync(path.join(order, 'scan.jpg')) && e.afterTrash === 3, JSON.stringify(e));
        await page.evaluate(() => app.undo());
        check('... and Ctrl+Z puts it back', fs.existsSync(path.join(order, 'scan.jpg')));
        check('a turn is written into the photo on disk (createWritable, keepExistingData)', turned);
        check('no half-written files left in the folder', !fs.readdirSync(order).some(n => fsHost.SWAP.test(n)), fs.readdirSync(order).join());
        check('no JS errors', errors.length === 0, errors.join('; '));
        await ctx.close();

        // Another day: the folder is under Recent, and opens from there
        ({ ctx, page, errors } = await pageFor('webkit', baseUrl, profile));
        await page.waitForFunction(() => typeof app !== 'undefined' && app.elements);
        const again = await page.evaluate(async () => {
            const rec = (await Recents.list())[0];
            return { name: rec && rec.name, ours: !!(rec && HostHandles.isOurs(rec.handle)) };
        });
        check('another day, the folder is under Recent, as one of these handles', again.name === 'Smith Order' && again.ours, JSON.stringify(again));
        check('no JS errors', errors.length === 0, errors.join('; '));
        await ctx.close();
    }

    if (core) core.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
