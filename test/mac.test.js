#!/usr/bin/env node
// Tests for the Mac app (mac/): the real Electron app, its bridge and the
// UI together, on folders on disk. Electron runs the same on Linux, so
// these run there too (under xvfb-run); what only macOS has (Finder, the
// built .app) is covered by the smoke test on the Mac runner.
//
//   (cd mac && npm ci) && node test/mac.test.js

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MAC = path.join(ROOT, 'mac');
const ELECTRON = require(path.join(MAC, 'node_modules', 'electron'));

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// A small JPEG, any color (baseline, no EXIF)
const JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAQABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCjRRRXz59kFFFFAH//2Q==',
    'base64');

function makeOrder(dir, name, n = 3) {
    const order = path.join(dir, name);
    fs.mkdirSync(path.join(order, 'Ceremony'), { recursive: true });
    for (let i = 1; i <= n; i++) fs.writeFileSync(path.join(order, `photo${i}.jpg`), JPEG);
    fs.writeFileSync(path.join(order, 'Ceremony', 'c1.jpg'), JPEG);
    return order;
}

// Releases, as GitHub's API gives them, from a server here (JEDITOR_RELEASES)
const releases = { latest: null, files: {} };
const releaseServer = http.createServer((req, res) => {
    if (req.url === '/latest') {
        if (!releases.latest) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(releases.latest));
    }
    const f = releases.files[req.url];
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-length': f.length });
    res.end(f);
});

async function launch(profile, args = []) {
    const app = await electron.launch({
        executablePath: ELECTRON,
        args: [MAC, '--no-sandbox', '--user-data', profile, ...args],
        env: { ...process.env, JEDITOR_RELEASES: `http://127.0.0.1:${releaseServer.address().port}/latest` }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.waitForFunction(() => typeof app !== 'undefined' && app.elements && window.JEditorNative);
    return { app, page, errors };
}

const loaded = (page, n) => page.waitForFunction((n) => !app.isLoading && app.files.length === n, n, { timeout: 20000 });

// A prompt nobody answers would wait for ever: fail instead
setTimeout(() => { console.log('  FAIL  timed out (a permission prompt, or a folder that never opened?)'); process.exit(1); }, 180000).unref();

(async () => {
    await new Promise(r => releaseServer.listen(0, '127.0.0.1', r));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jeditor-mac-'));
    const profile = path.join(tmp, 'profile');
    const smith = makeOrder(tmp, 'Smith Order');
    const jones = makeOrder(tmp, 'Jones', 2);

    console.log('mac: a folder given on the command line');
    {
        const { app, page, errors } = await launch(profile, [smith]);
        await loaded(page, 4);
        const r = await page.evaluate(async () => ({
            platform: Host.platform(),
            scan: getComputedStyle(document.getElementById('btn-scan')).display,
            path: await JEditorNative.folderPath(app.dirHandle),
            perm: await app.dirHandle.queryPermission({ mode: 'readwrite' }),
            files: app.files.map(f => f.relPath || f.name).sort().join()
        }));
        check('opens it, every photo listed', r.files === 'Ceremony/c1.jpg,photo1.jpg,photo2.jpg,photo3.jpg', r.files);
        check('the Mac app, with Mac features only', r.platform === 'mac' && r.scan === 'none', JSON.stringify(r));
        check('it knows the folder\'s path, and may edit it without asking', r.path === smith && r.perm === 'granted', JSON.stringify([r.path, r.perm]));

        // Edits go to disk; the project's data stays out of the folder
        const e = await page.evaluate(async () => {
            const f = app.files.find(x => x.name === 'photo1.jpg');
            await app.rotateImage(f, 90);
            if (f._rotationQueue) await f._rotationQueue;
            Flags.apply('star', [f]);
            await Flags.save();
            const victim = app.files.find(x => x.name === 'photo2.jpg');
            await app.moveToTrash([victim]);
            const toast = [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ');
            return { toast };
        });
        const rotated = !fs.readFileSync(path.join(smith, 'photo1.jpg')).equals(JPEG);
        check('a turn is saved into the photo on disk', rotated);
        check('deleting takes it out of the folder, into jEditor\'s trash', !fs.existsSync(path.join(smith, 'photo2.jpg')) && /jEditor's trash/.test(e.toast), e.toast);
        await page.evaluate(() => app.undo());
        check('... and Ctrl+Z puts it back', fs.existsSync(path.join(smith, 'photo2.jpg')));
        check('no .jeditor folder in the project', !fs.existsSync(path.join(smith, '.jeditor')), fs.readdirSync(smith).join());
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.close();
    }

    console.log('mac: opening again another day');
    {
        const { app, page, errors } = await launch(profile);
        const r = await page.evaluate(async () => {
            await Recents.render();
            const names = [...document.querySelectorAll('#recent-list .recent-name')].map(n => n.textContent);
            const rec = (await Recents.list()).find(x => x.name === 'Smith Order');
            const perm = rec && await rec.handle.queryPermission({ mode: 'readwrite' });
            if (rec) await Recents.open(rec);
            const until = Date.now() + 15000;
            while ((app.isLoading || !app.files.length) && Date.now() < until) await new Promise(res => setTimeout(res, 50));
            const f = app.files.find(x => x.name === 'photo1.jpg');
            return { names, perm, files: app.files.length, star: !!(f && Flags.get(f) && Flags.get(f).star), path: await JEditorNative.folderPath(app.dirHandle) };
        });
        check('the folder is under Recent', r.names.includes('Smith Order'), r.names.join());
        check('it opens from there without asking for permission', r.perm === 'granted' && r.files === 4, JSON.stringify(r));
        check('its flags are still there (kept by the app)', r.star);
        check('its path is still known', r.path === smith, r.path);

        // Open folder…: the Mac's own picker (answered here)
        await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, jones);
        await page.evaluate(() => app.browseFolder());
        await loaded(page, 3);
        const picked = await page.evaluate(async () => ({ name: app.dirHandle.name, path: await JEditorNative.folderPath(app.dirHandle) }));
        check('Open folder uses the Mac\'s picker and opens what was picked', picked.name === 'Jones' && picked.path === jones, JSON.stringify(picked));
        await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
        const cancelled = await page.evaluate(() => showDirectoryPicker().then(() => 'opened', e => e.name));
        check('... and canceling it is an AbortError, as in a browser', cancelled === 'AbortError', cancelled);

        // A project from the stored list, by its path
        const byPath = await page.evaluate(async (p) => {
            const ok = await JEditorNative.openPath(p);
            return { ok, name: app.dirHandle.name, exists: await JEditorNative.exists([p, p + '-gone']) };
        }, smith);
        check('a folder opens by its path', byPath.ok && byPath.name === 'Smith Order' && byPath.exists.join() === 'true,false', JSON.stringify(byPath));

        // A subfolder of a known folder: its path from there
        const sub = await page.evaluate(async () => JEditorNative.folderPath(await app.dirHandle.getDirectoryHandle('Ceremony')));
        check('a folder inside a known one has its path too', sub === path.join(smith, 'Ceremony'), sub);
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.close();
    }

    console.log('mac: updates');
    {
        const port = releaseServer.address().port;
        const dmg = crypto.randomBytes(3 * 1024 * 1024 + 17);
        const release = (digest) => ({
            tag_name: 'v9.1.0', body: '## What\'s new\n- Faster\n- Better',
            assets: [
                { name: 'jEditor-Setup-9.1.0.exe', browser_download_url: `http://127.0.0.1:${port}/setup`, size: 1 },
                { name: 'jEditor-9.1.0-mac.dmg', browser_download_url: `http://127.0.0.1:${port}/dmg`, size: dmg.length, digest: 'sha256:' + digest }
            ]
        });
        releases.files['/dmg'] = dmg;
        releases.latest = release(crypto.createHash('sha256').update(dmg).digest('hex'));
        const downloads = path.join(tmp, 'Downloads');
        fs.mkdirSync(downloads);
        const { app, page, errors } = await launch(profile);
        await app.evaluate(({ app, shell }, d) => {
            app.setPath('downloads', d);
            global.opened = [];
            shell.openPath = async (p) => { global.opened.push(p); return ''; };
            global.realQuit = app.quit;
            app.quit = () => { global.quitAsked = true; };
        }, downloads);
        const r = await page.evaluate(async () => {
            const shown = getComputedStyle(document.querySelector('[data-page="updates"]')).display !== 'none';
            const check = await JEditorNative.checkUpdate();
            const seen = [];
            await JEditorNative.installUpdate((got, total) => seen.push([got, total]));
            return { shown, check, seen };
        });
        await new Promise(res => setTimeout(res, 1800));
        const main = await app.evaluate(() => ({ opened: global.opened, quit: !!global.quitAsked }));
        const file = path.join(downloads, 'jEditor-9.1.0-mac.dmg');
        check('Settings has Updates', r.shown);
        check('a newer release is found, with its notes', r.check.newer && r.check.version === '9.1.0' && /Faster/.test(r.check.notes), JSON.stringify(r.check));
        check('its .dmg downloads (progress as it goes), checked against its SHA-256', fs.existsSync(file) && fs.readFileSync(file).equals(dmg) && r.seen.length >= 2 && r.seen.every(([got, total], i) => total === dmg.length && (!i || got > r.seen[i - 1][0])) && r.seen[r.seen.length - 1][0] === dmg.length, JSON.stringify(r.seen));
        check('... opens in Finder, and jEditor quits so it can be replaced', main.opened.join() === file && main.quit, JSON.stringify(main));

        // A damaged download is thrown away; an older release isn't offered
        fs.rmSync(file);
        releases.latest = release('0'.repeat(64));
        const bad = await page.evaluate(async () => {
            await JEditorNative.checkUpdate();
            return JEditorNative.installUpdate(() => { }).then(() => 'installed', e => e.message);
        });
        check('a damaged download says so, and leaves nothing behind', /damaged/.test(bad) && fs.readdirSync(downloads).length === 0, bad + ' ' + fs.readdirSync(downloads).join());
        releases.latest = { ...release('0'.repeat(64)), tag_name: 'v1.0.0' };
        const old = await page.evaluate(() => JEditorNative.checkUpdate().then(r => r.newer));
        check('an older release isn\'t offered', old === false);
        check('no JS errors', errors.length === 0, errors.join('; '));
        await app.evaluate(({ app }) => { app.quit = global.realQuit; });
        await app.close();
    }

    releaseServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
