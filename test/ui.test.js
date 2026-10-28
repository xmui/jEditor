#!/usr/bin/env node
// jEditor test suite: boots the real app in headless Chromium and exercises
// sorting, selection identity, EXIF-based lossless rotation, the bulk-rotate
// race regression, and the standalone (file://) build.
//
// Requires a Chromium-based browser. Resolution order:
//   1. CHROME_PATH env var
//   2. Known local Chromium paths
//   3. Installed Google Chrome (playwright channel)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { createServer } = require('../scripts/serve.js');
const { launchOptions, PAGE_HELPERS, newPage } = require('./page-helpers.js');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Synthetic scans with known answers, for the photo finder (scenes.js)
const PHOTO_SCENES = fs.readFileSync(path.join(__dirname, 'scenes.js'), 'utf8');

(async () => {
    // ---- 0. PWA static checks: manifest, icons, service worker assets ----
    console.log('PWA manifest & assets');
    {
        const APP = path.join(ROOT, 'app');
        const pngSize = (p) => {
            const b = fs.readFileSync(p);
            return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
        };
        const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
        check('manifest is installable (standalone + start_url + id)',
            manifest.display === 'standalone' && manifest.start_url === './' && manifest.id === './');

        let iconsOk = true, iconDetail = [];
        for (const icon of manifest.icons) {
            const p = path.join(APP, icon.src);
            const ok = fs.existsSync(p) && pngSize(p) === icon.sizes;
            if (!ok) iconsOk = false;
            iconDetail.push(`${icon.src}=${fs.existsSync(p) ? pngSize(p) : 'MISSING'} (declared ${icon.sizes})`);
        }
        check('manifest icons exist with truthful sizes', iconsOk, iconDetail.join('; '));
        check('has a maskable icon', manifest.icons.some(i => (i.purpose || '').includes('maskable')));

        // Every asset the service worker precaches must actually exist,
        // otherwise cache.addAll rejects and the PWA never works offline
        const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
        const assets = [...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
        const missing = assets.filter(a => a !== '' && !fs.existsSync(path.join(APP, a)));
        check('all service-worker precache assets exist', missing.length === 0, missing.join(', '));
        check('service worker cache version follows app version',
            sw.includes("importScripts('./version.js')") && sw.includes('APP_VERSION'));
    }

    // Build the standalone file first so we can test it too
    execSync('node scripts/build-standalone.js', { cwd: ROOT, stdio: 'inherit' });

    const server = createServer();
    await new Promise(r => server.listen(0, r));
    const baseUrl = `http://localhost:${server.address().port}`;

    const browser = await chromium.launch(launchOptions());

    // ---- 0b. Web app build (GitHub Pages): one self-contained page ----
    console.log('web app build');
    {
        const os = require('os');
        const http = require('http');
        const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'jeditor-site-'));
        execSync(`node scripts/build-standalone.js --site "${SITE}"`, { cwd: ROOT, stdio: 'pipe' });
        const index = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
        check('site page has every script and style inlined', !/<script src=|<link rel="stylesheet"/.test(index) && index.includes('const Renamer'));
        const swSrc = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
        const precache = JSON.parse(swSrc.match(/const ASSETS = (\[[^]*?\]);/)[1]);
        const missing = precache.filter(a => a !== './' && !fs.existsSync(path.join(SITE, a)));
        check('site service worker precaches only files it has', missing.length === 0 && precache.includes('./index.html'), missing.join(', '));

        const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
        const siteServer = http.createServer((req, res) => {
            const p = decodeURIComponent(req.url.split('?')[0]);
            const f = path.join(SITE, p.endsWith('/') ? 'index.html' : p);
            fs.readFile(f, (e, d) => {
                if (e) { res.writeHead(404); return res.end(); }
                res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
                res.end(d);
            });
        });
        await new Promise(r => siteServer.listen(0, r));
        const { page, issues } = await newPage(browser, `http://localhost:${siteServer.address().port}/`);
        const r = await page.evaluate(async () => {
            const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(res => setTimeout(() => res(null), 8000))]);
            let cached = [];
            if (reg) {
                for (let i = 0; i < 40 && !cached.length; i++) {
                    const keys = await caches.keys();
                    if (keys.length) cached = (await (await caches.open(keys[0])).keys()).map(q => new URL(q.url).pathname);
                    if (!cached.length) await new Promise(res => setTimeout(res, 100));
                }
            }
            return {
                loaded: typeof app !== 'undefined' && typeof CropEditor !== 'undefined' && typeof Renamer !== 'undefined' && typeof FolderCache !== 'undefined',
                title: document.getElementById('app-title').textContent,
                sw: !!reg, cachedIndex: cached.some(p => p.endsWith('/index.html'))
            };
        });
        check('site boots with no errors', issues.errors.length === 0 && issues.failedRequests.length === 0 && r.loaded,
            issues.errors.concat(issues.failedRequests).join('; '));
        check('site installs its service worker and caches the page', r.sw && r.cachedIndex, JSON.stringify(r));
        await page.close();
        siteServer.close();
        fs.rmSync(SITE, { recursive: true, force: true });
    }

    // ---- 1. Boot: served app loads clean ----
    console.log('boot (http)');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        check('no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        check('no failed requests', issues.failedRequests.length === 0, issues.failedRequests.join('; '));
        check('crop editor + metadata modules loaded', await page.evaluate(() =>
            typeof CropEditor !== 'undefined' && typeof CropGeom !== 'undefined' && typeof ImageMeta !== 'undefined'));
        check('app initialized', await page.evaluate(() => typeof app !== 'undefined'));
        const web = await page.evaluate(() => {
            const shown = (el) => !!el && getComputedStyle(el).display !== 'none';
            return {
                host: Host.platform(),
                appOnly: ['btn-scan', 'btn-camera', 'sb-places', 'sb-card', 'start-places', 'upd-log', 'set-backdrop-row'].filter(id => shown(document.getElementById(id))),
                updates: app.settingsPages().includes('updates'),
                placeholders: /\{(files|computer|bin)\}/.test(document.body.innerHTML),
                trashTitle: document.getElementById('btn-trash').title
            };
        });
        check('in a browser: nothing the apps alone can do is shown', web.host === 'web' && web.appOnly.length === 0 && !web.updates, JSON.stringify(web));
        check('... and the words are filled in ("the trash in .jeditor")', !web.placeholders && /moves to the trash in \.jeditor/.test(web.trashTitle), web.trashTitle);

        const pkgVersion = require(path.join(ROOT, 'package.json')).version;
        const v = await page.evaluate(() => ({
            appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : null,
            title: document.getElementById('app-title')?.textContent || ''
        }));
        check('APP_VERSION matches package.json', v.appVersion === pkgVersion, `${v.appVersion} vs ${pkgVersion}`);
        check('version and build shown on start screen', v.title === `jEditor Web · ${pkgVersion}`, v.title);
        const get = await page.evaluate(async () => ({
            devices: [
                Start.device({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }),
                Start.device({ platform: 'MacIntel', userAgent: 'Macintosh', maxTouchPoints: 0 }),
                Start.device({ platform: 'MacIntel', userAgent: 'Macintosh', maxTouchPoints: 5 }),
                Start.device({ platform: 'iPhone', userAgent: 'iPhone OS 18' }),
                Start.device({ platform: 'Linux x86_64', userAgent: 'X11; Linux x86_64' }),
                Start.device({ platform: 'Linux armv8l', userAgent: 'Linux; Android 15' })
            ].join(),
            shown: !document.getElementById('start-get').classList.contains('hidden'),
            here: Start.device(),
            first: document.querySelector('#start-get .btn.primary')?.getAttribute('href') || '',
            others: document.querySelector('.start-get-others')?.textContent || '',
            mac: (() => { Start.renderGet('mac'); return [...document.querySelectorAll('#start-get .btn')].map(e => e.getAttribute('href') || e.dataset.copy); })(),
            ios: (() => { Start.renderGet('ios'); return document.querySelector('.start-get-head').textContent + ' | ' + !!document.querySelector('#start-get .btn.primary'); })(),
            android: await (async () => {
                Start.installPrompt = null;
                Start.renderGet('android');
                const without = document.querySelector('.start-get-head').textContent;
                // Chrome's install prompt, kept for the button
                const e = new Event('beforeinstallprompt');
                e.prompt = () => { window.prompted = true; };
                e.userChoice = Promise.resolve({ outcome: 'accepted' });
                Start.installPrompt = e;
                Start.renderGet('android');
                const button = document.querySelector('#start-get .btn.primary');
                const label = button ? button.textContent : '';
                if (button) button.click();
                await new Promise(r => setTimeout(r, 50));
                return { without, label, prompted: !!window.prompted, after: !!document.querySelector('#start-get .btn.primary') };
            })()
        }));
        check('the web version knows the computer it\'s on (an iPad is the Mac with touch)', get.devices === 'windows,mac,ios,ios,linux,android', get.devices);
        check('... and offers that app first, then the others', get.shown && get.here === 'linux' && get.first.endsWith(`/releases/latest/download/jEditor-${pkgVersion}-linux.AppImage`) && /Also for Windows and Mac/.test(get.others), JSON.stringify(get));
        check('... an Android phone gets Install jEditor (Chrome\'s prompt), or where to find it', /Add to Home screen \(or Install app\)/.test(get.android.without) && get.android.label === 'Install jEditor' && get.android.prompted && !get.android.after, JSON.stringify(get.android));
        check('... a Mac gets the .dmg and the Homebrew command; an iPhone or iPad gets Add to Home Screen', get.mac[0].endsWith(`jEditor-${pkgVersion}-mac.dmg`) && get.mac.some(t => /brew tap xmui\/jeditor/.test(t)) && /Add to Home Screen/.test(get.ios) && /false$/.test(get.ios), JSON.stringify([get.mac, get.ios]));
        await page.close();
    }

    // ---- 1b. What's New (changelog) ----
    console.log("what's new");
    {
        const { loadChangelog, notesFor } = require('../scripts/release-notes.js');
        const log = loadChangelog();
        const pkgVersion = require(path.join(ROOT, 'package.json')).version;
        check('changelog has an entry for this version, at the top', log[0] && log[0].version === pkgVersion,
            `top: ${log[0] && log[0].version}, package.json: ${pkgVersion} — add an entry to app/changelog.js`);
        const num = (v) => v.split('.').map(Number);
        const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
        check('changelog is newest first, one entry per version', log.every((e, i) => i === 0 || newer(log[i - 1].version, e.version)));
        check('changelog entries have a date and items', log.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
            Array.isArray(e.items) && e.items.length && e.items.every(t => typeof t === 'string' && t.trim())));
        const notes = notesFor(pkgVersion, log);
        check('release notes come from the changelog', !!notes && notes.startsWith('- ' + log[0].items[0]));
        const made = notesFor('3.0.0', [
            { version: '3.0.0', items: ['three'] }, { version: '2.1.0', beta: true, items: ['two one'] },
            { version: '2.0.0', beta: true, items: ['two'] }, { version: '1.0.0', items: ['one'] }]);
        check('a release\'s notes take in the betas before it, never released, and stop at the last release',
            /^- three\n[^]*2\.1\.0 beta[^]*- two one[^]*2\.0\.0 beta[^]*- two\n$/.test(made) && !made.includes('- one'), made);

        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(() => {
            const out = {};
            out.startLink = document.getElementById('btn-whatsnew-start').textContent;
            document.getElementById('btn-whatsnew-start').click();
            out.open = app.isWhatsNewOpen();
            const secs = [...document.querySelectorAll('#whatsnew-list section')];
            out.sections = secs.length;
            out.firstIsCurrent = !!secs[0].querySelector('.wn-tag.current') && secs[0].textContent.includes(APP_VERSION);
            out.keys = document.querySelectorAll('#whatsnew-list kbd').length;
            out.noRawBackticks = !document.getElementById('whatsnew-list').textContent.includes('`');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            out.closed = !app.isWhatsNewOpen();
            out.inMore = app.uiPrefs.placement.whatsnew === 'more' && !!app.headerButton('whatsnew');
            return out;
        });
        // First visit: no notice. After an update: one notice, once.
        const notice = () => page.evaluate(async () => {
            await new Promise(res => setTimeout(res, 900));
            const t = document.querySelector('#toast-stack [data-key="whatsnew"]');
            return t ? t.textContent : null;
        });
        await page.evaluate(() => localStorage.removeItem('jeditor.seenVersion'));
        await page.reload({ waitUntil: 'networkidle' });
        const firstVisit = await notice();
        await page.evaluate(() => localStorage.setItem('jeditor.seenVersion', '1.11.0'));
        await page.reload({ waitUntil: 'networkidle' });
        const afterUpdate = await notice();
        const marked = await page.evaluate(() => {
            document.querySelector('#toast-stack [data-key="whatsnew"] .toast-action').click();
            const tags = [...document.querySelectorAll('#whatsnew-list section')].map(sec => {
                const t = sec.querySelector('.wn-tag');
                return t ? t.textContent : '';
            });
            return { open: app.isWhatsNewOpen(), tags: tags.slice(0, CHANGELOG.findIndex(e => e.version === '1.11.0') + 1) };
        });
        await page.reload({ waitUntil: 'networkidle' });
        const nextVisit = await notice();
        // An older cached copy, then this version again: still not repeated
        await page.evaluate(() => localStorage.setItem('jeditor.seenVersion', '99.0.0'));
        await page.reload({ waitUntil: 'networkidle' });
        const afterNewer = await notice();
        const keptNewest = await page.evaluate(() => localStorage.getItem('jeditor.seenVersion'));
        const windowTitle = await page.title();

        check('start screen links to What\'s New', r.startLink.includes(require(path.join(ROOT, 'package.json')).version), r.startLink);
        check("What's New lists every version, this one marked", r.open && r.sections === log.length && r.firstIsCurrent, JSON.stringify(r));
        check("What's New shows `keys` as key caps", r.keys > 0 && r.noRawBackticks);
        check("Esc closes What's New; control sits in More", r.closed && r.inMore);
        check('no update notice on a first visit', firstVisit === null, String(firstVisit));
        check('update notice once after an update, links to What\'s New', afterUpdate && afterUpdate.includes('Updated to') && marked.open && nextVisit === null,
            `${afterUpdate} / ${nextVisit}`);
        check('notice never repeats for a version already announced', afterNewer === null && keptNewest === '99.0.0', `${afterNewer} / ${keptNewest}`);
        check('version in the window title', windowTitle === `jEditor ${pkgVersion}`, windowTitle);
        check('versions since the last one used are marked New',
            marked.tags[0] === 'This version' && marked.tags.slice(1, -1).every(t => t === 'New') && marked.tags[marked.tags.length - 1] === '',
            JSON.stringify(marked.tags));
        check("what's new suite: no JS errors", issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 2. Sort + selection identity ----
    console.log('sort & selection identity');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            // Tiny real PNG so thumbnail loading works without errors
            const canvas = document.createElement('canvas');
            canvas.width = 2; canvas.height = 1;
            const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
            const png = new Uint8Array(await blob.arrayBuffer());

            app.files = [
                makeFakeFile('b.png', png, 'image/png', 200, 2000),
                makeFakeFile('a.png', png, 'image/png', 300, 1000),
                makeFakeFile('c.png', png, 'image/png', 100, 3000)
            ];
            const [b, a, c] = app.files;
            app.currentFile = b;
            app.selection = new Set([b, c]);
            app.renderGrid();
            app.renderThumbnails();

            const sel = document.getElementById('sort-mode');
            sel.value = 'size_asc';
            sel.dispatchEvent(new Event('change'));

            const gridClasses = [...document.getElementById('grid-view').children].map(el =>
                `${el._file.name}:${el.classList.contains('selected') ? 'S' : '-'}${el.classList.contains('active') ? 'A' : '-'}`);

            return {
                order: app.files.map(f => f.name).join(','),
                current: app.currentFile.name,
                selection: [...app.selection].map(f => f.name).sort().join(','),
                gridClasses: gridClasses.join(' ')
            };
        });
        check('size sort order', r.order === 'c.png,b.png,a.png', r.order);
        check('current photo follows sort', r.current === 'b.png', r.current);
        check('selection follows sort', r.selection === 'b.png,c.png', r.selection);
        check('grid classes track files', r.gridClasses === 'c.png:S- b.png:SA a.png:--', r.gridClasses);
        await page.close();
    }

    // ---- 3. EXIF orientation unit tests ----
    console.log('EXIF orientation');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            // Four CW quarter turns must return to the start for all 8 values
            out.groupCycles = [1, 2, 3, 4, 5, 6, 7, 8].every(o => {
                let x = o;
                for (let i = 0; i < 4; i++) x = app.composeOrientation(x, 90);
                return x === o;
            });
            out.cw = [app.composeOrientation(1, 90), app.composeOrientation(6, 90), app.composeOrientation(3, 90)].join(',');
            out.ccw = app.composeOrientation(1, -90);
            out.r180 = app.composeOrientation(1, 180);

            // Patch path: JPEG with EXIF orientation 3 rotated CW -> 8
            const withExif = makeJpegBytes([app.buildOrientationExif(3)]);
            const patched = app.rotateJpegLossless(new Uint8Array(withExif).buffer, 90);
            out.patched = readOrientation(new Uint8Array(await patched.arrayBuffer()));

            // Insert path: JPEG without EXIF gets a new APP1 with orientation 6
            const bare = makeJpegBytes();
            const inserted = app.rotateJpegLossless(new Uint8Array(bare).buffer, 90);
            const insertedBytes = new Uint8Array(await inserted.arrayBuffer());
            out.inserted = readOrientation(insertedBytes);
            out.insertedStillJpeg = insertedBytes[0] === 0xFF && insertedBytes[1] === 0xD8;
            return out;
        });
        check('orientation group cycles (4×90° = identity)', r.groupCycles);
        check('CW composition 1→6→3→8', r.cw === '6,3,8', r.cw);
        check('CCW composition 1→8', r.ccw === 8, String(r.ccw));
        check('180° composition 1→3', r.r180 === 3, String(r.r180));
        check('patches existing EXIF orientation (3 + 90° = 8)', r.patched === 8, String(r.patched));
        check('inserts EXIF into bare JPEG (orientation 6)', r.inserted === 6, String(r.inserted));
        check('inserted file still starts with SOI', r.insertedStillJpeg);
        await page.close();
    }

    // ---- 4. Lossless rotation end-to-end + bulk race regression ----
    console.log('rotation pipeline');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const jpegA = makeFakeFile('a.jpg', makeJpegBytes(), 'image/jpeg');
            const jpegB = makeFakeFile('b.jpg', makeJpegBytes(), 'image/jpeg');
            app.files = [jpegA, jpegB];
            app.viewMode = 'grid';
            app.dirHandle = null;

            // Single lossless rotation
            await app.rotateImage(jpegA, 90, true);
            out.aOrientation = readOrientation(jpegA.handle.bytes);
            out.aWrites = jpegA.handle.writes;
            out.aType = jpegA.handle.writtenType;
            out.aSizeUpdated = jpegA.size === jpegA.handle.bytes.length;

            // Race regression: selecting another photo mid-bulk-rotate must NOT rotate it
            app.selection = new Set([jpegA]);
            const pending = app.rotateBulk(90);
            app.selection.clear();
            app.selection.add(jpegB); // simulates clicking another photo while rotating
            await pending;
            out.bWrites = jpegB.handle.writes;
            out.aWritesAfterBulk = jpegA.handle.writes;
            out.loadingHidden = document.getElementById('loading-indicator').classList.contains('hidden');
            return out;
        });
        check('JPEG rotated losslessly via EXIF (orientation 6)', r.aOrientation === 6, String(r.aOrientation));
        check('written as image/jpeg', r.aType === 'image/jpeg', String(r.aType));
        check('sort metadata refreshed after save', r.aSizeUpdated);
        check('bulk rotate: photo clicked mid-rotation is untouched', r.bWrites === 0, `writes=${r.bWrites}`);
        check('bulk rotate: selected photo was rotated', r.aWritesAfterBulk === 2, `writes=${r.aWritesAfterBulk}`);
        check('loading indicator cleared', r.loadingHidden);
        await page.close();
    }

    // ---- 4a. Turn upright: each photo its own turn, one undo step ----
    console.log('turn upright');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const files = ['c.jpg', 'd.jpg', 'e.jpg'].map(n => makeFakeFile(n, makeJpegBytes(), 'image/jpeg'));
            app.files = files;
            app.viewMode = 'grid';
            app.dirHandle = null;
            // What the network would say: c a quarter turn right, d left, e unsure
            const said = { 'c.jpg': { turns: 1, sure: 0.97 }, 'd.jpg': { turns: 3, sure: 0.95 }, 'e.jpg': { turns: 2, sure: 0.4 } };
            const real = Upright.guess;
            let n = 0;
            Upright.guess = async () => said[files[n++].name];
            out.loaded = !!Upright.load();
            const steps = (app._undoStack || []).length;
            out.turned = await app.turnUpright(files);
            Upright.guess = real;
            out.orient = files.slice(0, 2).map(f => readOrientation(f.handle.bytes)).join();
            out.eWrites = files[2].handle.writes;
            out.oneStep = (app._undoStack || []).length === steps + 1;
            // The real network, on a photo: an answer for one of the four turns
            const c = document.createElement('canvas');
            c.width = 120; c.height = 80;
            const g = c.getContext('2d');
            g.fillStyle = '#7ab'; g.fillRect(0, 0, 120, 40);
            g.fillStyle = '#585'; g.fillRect(0, 40, 120, 40);
            const ans = await Upright.guess(await new Promise(res => c.toBlob(res)));
            out.real = ans && [0, 1, 2, 3].includes(ans.turns) && ans.sure > 0.25 && ans.sure <= 1;
            return out;
        });
        check('turn upright: the network is there', r.loaded);
        check('turn upright: each photo turned its own way; an unsure one left as it is', r.turned === 2 && r.orient === '6,8' && r.eWrites === 0, JSON.stringify(r));
        check('turn upright: one undo step for them all', r.oneStep);
        check('turn upright: the network answers for a photo', r.real, JSON.stringify(r));
        await page.close();
    }

    // ---- 4b. Snappy previews: instant stacking, background saves, no re-decode ----
    console.log('instant previews & stacking');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const f = makeFakeFile('stack.jpg', makeJpegBytes(), 'image/jpeg');
            app.files = [f];
            app.viewMode = 'grid';
            app.dirHandle = null;

            // Two rapid clicks: preview must show 180° immediately, before any save lands
            const p1 = app.rotateImage(f, 90);
            const p2 = app.rotateImage(f, 90);
            out.instantPreview = app.getDisplayRotation(f, 'thumb');
            await Promise.all([p1, p2]);
            out.diskOrientation = readOrientation(f.handle.bytes);     // 1 +90 +90 → 3
            out.previewAfterSave = app.getDisplayRotation(f, 'thumb'); // still 180 via lag
            out.lag = f.thumbLag;
            out.settled = (f.pendingRotation || 0) === 0 && (f.savingRotation || 0) === 0;

            // Right then left cancels out on screen instantly and nets zero on disk
            const g = makeFakeFile('netzero.jpg', makeJpegBytes(), 'image/jpeg');
            app.files = [f, g];
            const q = app.rotateImage(g, 90);
            app.rotateImage(g, -90);
            out.netZeroInstant = app.getDisplayRotation(g, 'thumb');
            await q;
            out.netZeroDisk = readOrientation(g.handle.bytes); // 6 then back to 1
            out.netZeroPreview = app.getDisplayRotation(g, 'thumb');
            return out;
        });
        check('two quick rotates preview 180° instantly', r.instantPreview === 180, String(r.instantPreview));
        check('disk lands at orientation 3 (180°)', r.diskOrientation === 3, String(r.diskOrientation));
        check('preview unchanged after save (no reload)', r.previewAfterSave === 180 && r.lag === 180, `${r.previewAfterSave}/${r.lag}`);
        check('queue fully drained', r.settled);
        check('right+left cancels instantly on screen', r.netZeroInstant === 0, String(r.netZeroInstant));
        check('right+left nets zero on disk', r.netZeroDisk === 1 && r.netZeroPreview === 0, `${r.netZeroDisk}/${r.netZeroPreview}`);
        await page.close();
    }

    // ---- 4c. Stacked toasts ----
    console.log('stacked toasts');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            app.showToast('Rotating 3 photos…', 0, 'op1');
            app.showToast('Rotating 5 photos…', 0, 'op2');
            const stacked = document.querySelectorAll('#toast-stack .toast').length;
            const texts = [...document.querySelectorAll('#toast-stack .toast')].map(t => t.textContent);
            app.showToast('Rotated 3 photos', 60, 'op1'); // update in place, then auto-dismiss
            const stillStacked = document.querySelectorAll('#toast-stack .toast').length;
            const updatedText = document.querySelector('#toast-stack [data-key="op1"]').textContent;
            await new Promise(r => setTimeout(r, 600));
            const afterDismiss = document.querySelectorAll('#toast-stack .toast').length;
            return { stacked, texts, stillStacked, updatedText, afterDismiss };
        });
        check('two concurrent operations stack', r.stacked === 2, JSON.stringify(r.texts));
        check('progress toast updates in place', r.stillStacked === 2 && r.updatedText === 'Rotated 3 photos', r.updatedText);
        check('finished toast dismisses, sticky one stays', r.afterDismiss === 1, String(r.afterDismiss));
        await page.close();
    }

    // ---- 5. Non-JPEG fallback: PNG re-encode preserves type, swaps dimensions ----
    console.log('PNG rotation fallback');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 2; canvas.height = 1;
            const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
            const png = new Uint8Array(await blob.arrayBuffer());
            const file = makeFakeFile('p.png', png, 'image/png');
            app.files = [file];
            app.viewMode = 'grid';
            app.dirHandle = null;

            await app.rotateImage(file, 90, true);
            const bitmap = await createImageBitmap(new Blob([file.handle.bytes]));
            const gif = makeFakeFile('g.gif', png, 'image/gif');
            await app.rotateImage(gif, 90, true);
            return {
                type: file.handle.writtenType,
                dims: `${bitmap.width}x${bitmap.height}`,
                gifWrites: gif.handle.writes
            };
        });
        check('PNG stays PNG', r.type === 'image/png', String(r.type));
        check('dimensions swapped (2x1 → 1x2)', r.dims === '1x2', r.dims);
        check('GIF rotation refused (would lose animation)', r.gifWrites === 0, `writes=${r.gifWrites}`);
        await page.close();
    }

    // ---- 5a. File info: status chip, info panel, EXIF metadata ----
    console.log('file info');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};

            // Build a JPEG with a full EXIF block: Make, ExifIFD → DateTimeOriginal
            const buildExifJpeg = (make, dateStr) => {
                const makeBytes = [...make].map(c => c.charCodeAt(0)).concat([0]);
                const dateBytes = [...dateStr].map(c => c.charCodeAt(0)).concat([0]); // 20 bytes
                const makeOff = 38;                       // after header+IFD0
                const exifIfdOff = makeOff + makeBytes.length;
                const dateOff = exifIfdOff + 2 + 12 + 4;
                const tiffLen = dateOff + dateBytes.length;
                const buf = new ArrayBuffer(tiffLen);
                const v = new DataView(buf);
                v.setUint16(0, 0x4D4D);                   // big-endian
                v.setUint16(2, 0x002A);
                v.setUint32(4, 8);                        // IFD0 at 8
                v.setUint16(8, 2);                        // 2 entries
                let e = 10;
                v.setUint16(e, 0x010F); v.setUint16(e + 2, 2); // Make, ASCII
                v.setUint32(e + 4, makeBytes.length); v.setUint32(e + 8, makeOff);
                e += 12;
                v.setUint16(e, 0x8769); v.setUint16(e + 2, 4); // ExifIFD pointer, LONG
                v.setUint32(e + 4, 1); v.setUint32(e + 8, exifIfdOff);
                v.setUint32(e + 12, 0);                   // next IFD
                makeBytes.forEach((b, i) => v.setUint8(makeOff + i, b));
                v.setUint16(exifIfdOff, 1);               // ExifIFD: 1 entry
                const d = exifIfdOff + 2;
                v.setUint16(d, 0x9003); v.setUint16(d + 2, 2); // DateTimeOriginal, ASCII
                v.setUint32(d + 4, dateBytes.length); v.setUint32(d + 8, dateOff);
                v.setUint32(d + 12, 0);
                dateBytes.forEach((b, i) => v.setUint8(dateOff + i, b));

                const tiff = new Uint8Array(buf);
                const payloadLen = 6 + tiff.length;
                const seg = [0xFF, 0xE1, (payloadLen + 2) >> 8, (payloadLen + 2) & 0xFF,
                    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
                return [0xFF, 0xD8, ...seg, 0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9];
            };

            const jpegBytes = buildExifJpeg('TestCam Inc.', '2024:06:15 13:45:00');
            const info = app.readJpegExifInfo(new Uint8Array(jpegBytes).buffer);
            out.make = info && info.make;
            out.taken = info && info.dateTaken &&
                `${info.dateTaken.getFullYear()}-${info.dateTaken.getMonth() + 1}-${info.dateTaken.getDate()}`;

            // Status chip shows location + name for the current file
            const canvas = document.createElement('canvas');
            canvas.width = 4; canvas.height = 4;
            const png = new Uint8Array(await (await new Promise(res => canvas.toBlob(res, 'image/png'))).arrayBuffer());
            const file = makeFakeFile('photo.png', png, 'image/png');
            file.relPath = 'vacation/photo.png';
            app.dirHandle = { name: 'Photos' };
            app.files = [file];
            document.getElementById('main-interface').classList.remove('hidden');
            await app.loadFile(file);
            const chip = document.getElementById('status-bar');
            out.chipVisible = !chip.classList.contains('hidden');
            out.chipText = chip.textContent;

            // Info panel opens and lists name + formatted size
            app.toggleInfoPanel(true);
            await new Promise(r => setTimeout(r, 200));
            out.panelOpen = !document.getElementById('info-panel').classList.contains('hidden');
            out.panelText = document.getElementById('info-list').textContent;
            return out;
        });
        check('EXIF Make parsed', r.make === 'TestCam Inc.', String(r.make));
        check('EXIF DateTimeOriginal parsed', r.taken === '2024-6-15', String(r.taken));
        check('status chip visible with full path', r.chipVisible && r.chipText === 'Photos/vacation/photo.png', r.chipText);
        check('info panel opens', r.panelOpen);
        check('info panel lists name, location and size', r.panelText.includes('photo.png') &&
            r.panelText.includes('Photos/vacation') && /\d+ B|KB|MB/.test(r.panelText), r.panelText);
        await page.close();
    }

    // ---- 5b. Thumbnail pipeline: worker generation, caching, precache ----
    console.log('thumbnail pipeline');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};

            // Noisy PNG well above the fast-path threshold forces real generation
            const canvas = document.createElement('canvas');
            canvas.width = 900; canvas.height = 600;
            const ctx = canvas.getContext('2d');
            const noise = ctx.createImageData(900, 600);
            for (let i = 0; i < noise.data.length; i++) noise.data[i] = (Math.random() * 256) | 0;
            ctx.putImageData(noise, 0, 0);
            const big = await new Promise(res => canvas.toBlob(res, 'image/png'));
            out.originalSize = big.size;
            const bytes = new Uint8Array(await big.arrayBuffer());

            const file = makeFakeFile('big.png', bytes, 'image/png');
            app.files = [file];

            out.workerAvailable = !!app.getThumbWorker();

            const url = await app.ensureThumbnail(file, { urgent: true });
            out.urlSet = file.thumbnailUrl === url && url.startsWith('blob:');
            const thumb = await (await fetch(url)).blob();
            out.thumbSize = thumb.size;
            out.thumbType = thumb.type;
            const bmp = await createImageBitmap(thumb);
            out.thumbWidth = bmp.width;

            // Cache hit: same URL, resolved instantly
            out.cached = (await app.ensureThumbnail(file, { urgent: true })) === url;

            // Precache generates the rest in the background
            const file2 = makeFakeFile('big2.png', bytes, 'image/png');
            app.files = [file, file2];
            app.precacheThumbnails();
            await app.ensureThumbnail(file2, {});
            out.precached = !!file2.thumbnailUrl;

            // Grid re-render paints cached thumbs synchronously (no observer round-trip)
            app.renderGrid();
            const tileImgs = [...document.querySelectorAll('#grid-view .grid-item img')];
            out.instantPaint = tileImgs.every(img => img.src.startsWith('blob:'));
            out.cachedNoSpinner = !document.querySelector('#grid-view .grid-item.thumb-loading');

            // A tile still waiting shows a spinner until its picture loads
            // (on screen: lazy tiles in a hidden grid don't load)
            document.getElementById('main-interface').classList.remove('hidden');
            document.getElementById('grid-view').classList.remove('hidden');
            const file3 = makeFakeFile('big3.png', bytes, 'image/png');
            app.files = [file, file2, file3];
            app.renderGrid();
            const tile3 = file3._gridEl;
            out.spinnerWhileLoading = tile3.classList.contains('thumb-loading');
            await app.loadImageThumbnail(file3, tile3.querySelector('img'));
            for (let i = 0; i < 50 && tile3.classList.contains('thumb-loading'); i++) await new Promise(r => setTimeout(r, 20));
            out.spinnerCleared = !tile3.classList.contains('thumb-loading');
            return out;
        });
        check('worker available (off-main-thread generation)', r.workerAvailable);
        check('thumbnail downscaled to 320px', r.thumbWidth === 320, String(r.thumbWidth));
        check('thumbnail much smaller than original', r.thumbSize < r.originalSize / 3, `${r.thumbSize} vs ${r.originalSize}`);
        check('PNG stays PNG (transparency-safe)', r.thumbType === 'image/png', r.thumbType);
        check('second request is a cache hit', r.cached && r.urlSet);
        check('precache fills remaining files', r.precached);
        check('re-render paints cached thumbs immediately', r.instantPaint);
        check('cached tiles show no loading spinner', r.cachedNoSpinner);
        check('loading tile shows a spinner, cleared once its thumbnail loads', r.spinnerWhileLoading && r.spinnerCleared,
            `${r.spinnerWhileLoading}/${r.spinnerCleared}`);
        await page.close();
    }

    // ---- 5c. Triage suite: undo, trash, rename, sort persistence, menus ----
    console.log('triage suite');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            document.getElementById('main-interface').classList.remove('hidden');

            // --- Undo a rotation ---
            const a = makeFakeFile('a.jpg', makeJpegBytes(), 'image/jpeg');
            const originalLen = a.handle.bytes.length;
            app.files = [a];
            app.viewMode = 'grid';
            app.dirHandle = null;
            await app.rotateImage(a, 90);
            out.rotated = readOrientation(a.handle.bytes) === 6;
            const top = app._undoStack[app._undoStack.length - 1];
            out.noCopyKept = top.type === 'rotate' && !top.blob && top.deg === 90;
            await app.undo();
            out.undoneOrientation = readOrientation(a.handle.bytes); // rotated back: upright (1)
            out.undoNotStacked = app._undoStack.length === 0;        // the reverse isn't itself undoable

            // Re-encoded rotations (PNG) keep the original bytes and restore them exactly
            const pc = document.createElement('canvas');
            pc.width = 3; pc.height = 2;
            const pngBytes = new Uint8Array(await (await new Promise(res => pc.toBlob(res, 'image/png'))).arrayBuffer());
            const pf = makeFakeFile('p.png', pngBytes, 'image/png');
            app.files = [a, pf];
            await app.rotateImage(pf, 90);
            await app.undo();
            out.pngRestored = pf.handle.bytes.length === pngBytes.length && pf.handle.bytes.every((v, i) => v === pngBytes[i]);

            // Undo memory is capped: big file copies push old ones out
            const savedCap = app.UNDO_MAX_BYTES;
            app.UNDO_MAX_BYTES = 1000;
            app._undoStack = [];
            for (let i = 0; i < 5; i++) app.pushUndo({ type: 'bytes', file: pf, blob: new Blob([new Uint8Array(400)]) });
            app.pushUndo({ type: 'rotate', file: a, deg: 90 });
            out.undoCapped = app.undoBytes() <= 1000 && app._undoStack.length < 6 &&
                app._undoStack[app._undoStack.length - 1].type === 'rotate';
            app.UNDO_MAX_BYTES = savedCap;
            app._undoStack = [];
            app.files = [a];

            // --- Trash + restore ---
            const root = makeDir('Photos');
            const f1 = makeFakeFile('one.jpg', makeJpegBytes(), 'image/jpeg');
            const f2 = makeFakeFile('two.jpg', makeJpegBytes(), 'image/jpeg');
            f1.parentDir = root; f2.parentDir = root;
            root._files.set('one.jpg', f1.handle);
            root._files.set('two.jpg', f2.handle);
            app.dirHandle = root;
            app.files = [f1, f2];
            app.currentFile = f1;
            await app.moveToTrash([f1]);
            const trash = await (await root.getDirectoryHandle('.jeditor')).getDirectoryHandle('trash');
            out.trashedCount = app.files.length;                    // 1
            out.inTrash = trash._files.size;                        // 1
            out.removedFromRoot = !root._files.has('one.jpg');
            await app.undo();
            out.restoredCount = app.files.length;                   // 2
            out.trashEmpty = trash._files.size === 0;
            out.backInRoot = root._files.has('one.jpg');

            // --- Batch rename + undo ---
            // move() renames the directory entry too, like the real FS API
            const mkMove = (h) => async function (n) {
                root._files.delete(this.name);
                this.name = n;
                root._files.set(n, this);
            };
            f1.handle.move = mkMove(f1.handle);
            f2.handle.move = mkMove(f2.handle);
            Renamer.open(app, [f1, f2]);
            Renamer.mode = 'new';
            document.getElementById('rename-pattern').value = 'trip_{#}';
            document.getElementById('rename-order').value = 'name';
            await Renamer.refresh();
            await Renamer.apply();
            out.renamed = app.files.map(f => f.name).sort().join(',');
            await app.undo();
            out.renameUndone = app.files.map(f => f.name).sort().join(',');

            // --- Sort persistence ---
            localStorage.removeItem('jeditor.sortMode');
            const sel = document.getElementById('sort-mode');
            sel.value = 'size_desc';
            sel.dispatchEvent(new Event('change'));
            await new Promise(r2 => setTimeout(r2, 50));
            out.persisted = localStorage.getItem('jeditor.sortMode');

            // --- Capture-date sort ---
            f1.dateTaken = new Date(2020, 0, 1).getTime();
            f2.dateTaken = new Date(2024, 0, 1).getTime();
            app.sortMode = 'taken_desc';
            app.sortFiles(false);
            out.takenOrder = app.files.map(f => f.name).join(',');

            // --- Export copies (original size) ---
            UI.prompt = async () => ''; // the in-app Export dialog, answered "full size"
            await app.exportCopies([f2]);
            const exp = await root.getDirectoryHandle('jEditor Export');
            out.exported = exp._files.size === 1;

            // --- Context menu ---
            let clicked = false;
            app.openContextMenu([['Do Thing', () => { clicked = true; }], ['—'], ['Other', () => { }]], 20, 20);
            const menu = document.getElementById('context-menu');
            out.menuButtons = menu.querySelectorAll('button').length;   // 2
            out.menuDividers = menu.querySelectorAll('.ctx-divider').length; // 1
            menu.querySelector('button').click();
            out.menuActionRan = clicked;
            out.menuClosed = !document.getElementById('context-menu');

            // --- Ctrl+wheel grid zoom ---
            const before = document.getElementById('grid-size-slider').value;
            document.getElementById('grid-view').dispatchEvent(
                new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true }));
            out.zoomChanged = document.getElementById('grid-size-slider').value !== before;

            return out;
        });
        check('JPEG rotation undone by rotating back (no file copy held)', r.rotated && r.noCopyKept && r.undoneOrientation === 1 && r.undoNotStacked,
            JSON.stringify({ copy: r.noCopyKept, o: r.undoneOrientation, stacked: !r.undoNotStacked }));
        check('re-encoded rotation undo restores the exact bytes', r.pngRestored);
        check('undo memory is capped', r.undoCapped);
        check('trash removes from folder and app', r.trashedCount === 1 && r.inTrash === 1 && r.removedFromRoot);
        check('undo restores from trash', r.restoredCount === 2 && r.trashEmpty && r.backInRoot);
        check('batch rename applies pattern', r.renamed === 'trip_1.jpg,trip_2.jpg', r.renamed);
        check('batch rename undo restores names', r.renameUndone === 'one.jpg,two.jpg', r.renameUndone);
        check('sort mode persisted to localStorage', r.persisted === 'size_desc', String(r.persisted));
        check('capture-date sort orders by dateTaken', r.takenOrder === 'two.jpg,one.jpg', r.takenOrder);
        check('export writes a copy to jEditor Export', r.exported);
        check('context menu renders and runs actions', r.menuButtons === 2 && r.menuDividers === 1 && r.menuActionRan && r.menuClosed);
        check('ctrl+wheel zooms the grid', r.zoomChanged);
        await page.close();
    }

    // ---- 5d. UI customization, task pill, strip/status layout ----
    console.log('UI customization & task pill');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            localStorage.removeItem('jeditor.ui');

            // Default pill: info, view, refresh, crop, history visible; rest in "More"
            const hc = document.getElementById('header-controls');
            const visible = [...hc.querySelectorAll('[data-hc]')]
                .filter(b => !b.classList.contains('hc-extra') && !b.classList.contains('hidden') && getComputedStyle(b).display !== 'none')
                .map(b => b.dataset.hc);
            out.defaultMain = visible.join(',');
            const extras = [...hc.querySelectorAll('.hc-extra')].map(b => b.dataset.hc);
            out.defaultExtras = extras.join(',');
            out.extrasHiddenCollapsed = getComputedStyle(document.getElementById('btn-toggle-fit')).display === 'none';
            document.getElementById('btn-more').click();
            out.extrasShownExpanded = getComputedStyle(document.getElementById('btn-toggle-fit')).display !== 'none';

            // Placement + order + vertical + scale via prefs
            app.uiPrefs.placement.fullscreen = 'main';
            app.uiPrefs.placement.refresh = 'hidden';
            app.uiPrefs.order = ['crop', 'info', 'view', 'refresh', 'history', 'fit', 'strip', 'fullscreen', 'customize'];
            app.uiPrefs.vertical = true;
            app.uiPrefs.scale = 1.2;
            app.saveUiPrefs();
            app.applyUiPrefs();
            out.reordered = [...hc.querySelectorAll('[data-hc]')].map(b => b.dataset.hc).slice(0, 3).join(',');
            out.refreshHidden = document.getElementById('btn-refresh').classList.contains('hidden');
            out.fullscreenMain = !document.getElementById('btn-fullscreen').classList.contains('hc-extra');
            out.vertical = hc.classList.contains('vertical');
            out.persisted = JSON.parse(localStorage.getItem('jeditor.ui')).scale === 1.2;
            out.scaleApplied = getComputedStyle(hc).zoom;

            // Thumbnail fit contain by default
            localStorage.removeItem('jeditor.ui');
            app.loadUiPrefs();
            app.applyUiPrefs();
            out.containDefault = document.getElementById('grid-view').classList.contains('thumb-contain');

            // Strip height + in-flow status bar (no overlap possible)
            app.setStripHeight(120);
            out.stripVar = getComputedStyle(document.documentElement).getPropertyValue('--strip-height').trim();
            out.statusInFlow = ['static', 'relative'].includes(getComputedStyle(document.getElementById('status-bar')).position);

            // Info icon actually has its dot
            out.infoDot = document.getElementById('btn-info').innerHTML.includes('cy="8"');

            // Task pill: current task + hover list, stacking
            app.beginTask('t1', 'Rotating 3 photos…');
            app.beginTask('t2', 'Exporting 2/5');
            const pill = document.getElementById('loading-indicator');
            out.pillVisible = !pill.classList.contains('hidden');
            out.pillLabel = document.getElementById('loading-text').textContent;
            out.taskRows = document.querySelectorAll('#task-list .task-row').length;
            app.endTask('t1');
            out.afterOneEnd = document.getElementById('loading-text').textContent;
            // Readable whatever the photo looks like (it sits beside the photo)
            const contrast = () => {
                const cs = getComputedStyle(pill);
                const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]; };
                return Math.abs(lum(cs.backgroundColor) - lum(cs.color));
            };
            document.documentElement.dataset.theme = 'light';
            out.pillContrastLight = contrast();
            document.documentElement.dataset.theme = 'dark';
            out.pillContrastDark = contrast();
            app.endTask('t2');
            out.pillHidden = pill.classList.contains('hidden');
            return out;
        });
        check('default main controls: info, view, refresh, crop, history', r.defaultMain === 'info,view,refresh,crop,history', r.defaultMain);
        // (Adjust and Paint too: the mode switch has them)
        check('extras live in More (adjust, paint, fit, strip, fullscreen, dupes, convert, keys, whatsnew, customize)', r.defaultExtras === 'adjust,paint,fit,strip,fullscreen,dupes,convert,keys,whatsnew,customize', r.defaultExtras);
        check('More expander shows/hides extras', r.extrasHiddenCollapsed && r.extrasShownExpanded);
        // (Adjust, newer than that saved order, goes after Crop, and Paint after it)
        check('reorder + hide + promote via prefs', r.reordered === 'crop,adjust,paint' && r.refreshHidden && r.fullscreenMain,
            JSON.stringify({ o: r.reordered, h: r.refreshHidden, f: r.fullscreenMain }));
        check('vertical pill + scale + persistence', r.vertical && r.persisted && parseFloat(r.scaleApplied) === 1.2,
            JSON.stringify({ v: r.vertical, p: r.persisted, z: r.scaleApplied }));
        check('thumbnail fit (contain) on by default', r.containDefault);
        check('strip height adjustable, status bar in flow below strip', r.stripVar === '120px' && r.statusInFlow,
            JSON.stringify({ s: r.stripVar, flow: r.statusInFlow }));
        check('info icon has its dot', r.infoDot);
        check('task pill shows current task with count', r.pillVisible && r.pillLabel === 'Exporting 2/5 (+1)' && r.taskRows === 2,
            JSON.stringify({ l: r.pillLabel, rows: r.taskRows }));
        check('task pill readable over light and dark photos', r.pillContrastLight > 150 && r.pillContrastDark > 150,
            JSON.stringify({ light: r.pillContrastLight, dark: r.pillContrastDark }));
        check('task pill updates and clears', r.afterOneEnd === 'Exporting 2/5' && r.pillHidden,
            JSON.stringify({ a: r.afterOneEnd, hid: r.pillHidden }));
        await page.close();
    }

    // ---- 6. Appearance: theme, density, glass, surround; glass never follows the photo ----
    console.log('appearance settings');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const root = document.documentElement;
            const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
            localStorage.removeItem('jeditor.ui');
            app.loadUiPrefs();
            app.applyUiPrefs();
            out.defaults = [root.dataset.theme, root.dataset.density, root.dataset.glass, root.dataset.surround].join(',');

            // Settings opens on Ctrl+, from the start screen, and its radios apply at once
            window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }));
            out.opened = app.isSettingsOpen();
            const pick = (name, value) => {
                const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
                r.checked = true;
                r.dispatchEvent(new Event('change', { bubbles: true }));
            };
            pick('set-theme', 'light');
            pick('set-density', 'comfortable');
            pick('set-glass', 'subtle');
            pick('set-surround', 'grey');
            out.applied = [root.dataset.theme, root.dataset.density, root.dataset.glass, root.dataset.surround].join(',');
            out.lightText = css('--text-1') === '#171717';
            out.comfortable = css('--fs-body') === '14px';
            out.subtleGlass = css('--glass-filter') === 'none';
            out.surround = getComputedStyle(document.getElementById('main-view')).backgroundColor;
            out.saved = JSON.parse(localStorage.getItem('jeditor.ui'));
            // A page at a time: Appearance first; Messages on a click, and it's
            // where Settings opens next time; no Updates page outside the Windows app
            const shownPage = () => [...document.querySelectorAll('#settings-panel .settings-section')].filter(x => getComputedStyle(x).display !== 'none').map(x => x.dataset.page).join();
            out.firstPage = shownPage();
            document.querySelector('.settings-nav [data-page="messages"]').click();
            out.messagesPage = shownPage() + ' ' + document.querySelector('.settings-nav [data-page="messages"]').getAttribute('aria-selected');
            out.noUpdates = getComputedStyle(document.querySelector('.settings-nav [data-page="updates"]')).display === 'none';
            // Esc closes it
            document.getElementById('settings-panel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            out.closed = !app.isSettingsOpen();
            app.toggleCustomizePanel(true);
            out.reopenedOn = shownPage();
            // Arrow keys move between pages
            const tab = document.querySelector('.settings-nav [data-page="messages"]');
            tab.focus();
            tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            out.arrowPage = shownPage() + ' ' + (document.activeElement && document.activeElement.dataset.page);
            app.showSettingsPage('appearance');
            app.toggleCustomizePanel(false);

            // Window background is the Windows app's: hidden here, and the window stays solid
            out.backdropHidden = ['set-backdrop-row', 'set-transparency-row'].every(id => getComputedStyle(document.getElementById(id)).display === 'none');
            out.solidWindow = !root.classList.contains('backdrop') && getComputedStyle(document.body).backgroundColor === 'rgb(232, 232, 232)';
            localStorage.setItem('jeditor.ui', JSON.stringify({ backdrop: 'glass', transparency: 500 }));
            app.loadUiPrefs();
            out.badBackdrop = [app.uiPrefs.backdrop, app.uiPrefs.transparency].join();

            // The glass no longer follows the photo: no sampler, no classes
            out.noSampler = typeof app.analyzeImageBrightness === 'undefined' && typeof app.applyGlass === 'undefined';
            out.noGlassClasses = !document.body.className.includes('glass-light');

            localStorage.removeItem('jeditor.ui');
            app.loadUiPrefs();
            app.applyUiPrefs();
            return out;
        });
        check('appearance defaults: dark, compact, rich glass, theme surround', r.defaults === 'dark,compact,rich,auto', r.defaults);
        check('Ctrl+, opens Settings; Esc closes it', r.opened && r.closed, JSON.stringify({ o: r.opened, c: r.closed }));
        check('Settings: a page at a time, Appearance first; a click (or the arrow keys) changes page, and it opens on the last page used', r.firstPage === 'appearance' && r.messagesPage === 'messages true' && r.noUpdates && r.reopenedOn === 'messages' && r.arrowPage === 'autocrop autocrop', JSON.stringify([r.firstPage, r.messagesPage, r.noUpdates, r.reopenedOn, r.arrowPage]));
        check('theme, density, glass and surround apply and are remembered',
            r.applied === 'light,comfortable,subtle,grey' && r.lightText && r.comfortable && r.subtleGlass &&
            r.surround === 'rgb(118, 118, 118)' && r.saved.theme === 'light' && r.saved.density === 'comfortable' &&
            r.saved.glass === 'subtle' && r.saved.surround === 'grey', JSON.stringify(r));
        check('the glass is fixed: it no longer follows the photo', r.noSampler && r.noGlassClasses);
        check('window background: not in a browser, solid; bad saved values ignored',
            r.backdropHidden && r.solidWindow && r.badBackdrop === 'none,50', JSON.stringify(r));
        check('appearance suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7a. Lossless rotation for scanner JPEGs (EXIF without Orientation) ----
    console.log('lossless rotation: EXIF without orientation');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const jpeg = await makeRealJpeg(40, 20, { exif: true });
            const blob = app.rotateJpegLossless(jpeg.buffer.slice(0), 90);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            out.orientation = readOrientation(bytes);
            const info = app.readJpegExifInfo(bytes.buffer);
            out.make = info && info.make;
            out.taken = !!(info && info.dateTaken);
            // Compressed image data is untouched (lossless)
            const tail = (b) => { const s = ImageMeta.jpegSegments(b); return b.subarray(s[s.length - 1].start); };
            const a = tail(jpeg), b = tail(bytes);
            out.sameData = a.length === b.length && a.every((v, i) => v === b[i]);
            const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
            out.dims = `${bmp.width}x${bmp.height}`;
            // XMP tiff:Orientation follows the EXIF value
            const xmp = await makeRealJpeg(40, 20, { xmpOrientation: 1 });
            const xb = new Uint8Array(await app.rotateJpegLossless(xmp.buffer.slice(0), 90).arrayBuffer());
            out.xmp = /tiff:Orientation="6"/.test(new TextDecoder('latin1').decode(xb));

            // A file that already has an orientation tag is rotated by
            // writing just those bytes in place (plus the XMP digit)
            const tagged = await makeRealJpeg(40, 20, { exif: true, xmpOrientation: 1 });
            const tf = makeFakeFile('t.jpg', tagged, 'image/jpeg');
            app.files = [tf];
            app.dirHandle = null;
            await app.rotateImage(tf, 90);                 // adds the tag: full rewrite
            const afterFirst = new Uint8Array(tf.handle.bytes);
            await app.rotateImage(tf, 90);                 // tag exists: in place
            const afterSecond = tf.handle.bytes;
            const diff = [];
            for (let i = 0; i < afterSecond.length; i++) if (afterFirst[i] !== afterSecond[i]) diff.push(i);
            out.inPlace = tf.handle.inPlaceWrites >= 1 && afterSecond.length === afterFirst.length &&
                diff.length <= 3 && readOrientation(afterSecond) === 3 &&
                /tiff:Orientation="3"/.test(new TextDecoder('latin1').decode(afterSecond));

            // A CMYK original's ICC profile must not be carried onto RGB output
            const cmyk = await makeRealJpeg(40, 20, { icc: true });
            const sof = ImageMeta.jpegSegments(cmyk).find(sg => sg.marker === 0xC0);
            cmyk[sof.start + 9] = 4; // header now says 4 components (parse-level test)
            const fresh = new Blob([await makeRealJpeg(40, 20, {})], { type: 'image/jpeg' });
            const moved = new Uint8Array(await (await ImageMeta.transplant(cmyk, fresh, 'image/jpeg', 40, 20)).arrayBuffer());
            out.cmykSafe = !ImageMeta.canCarryProfile('image/jpeg', cmyk) && !ImageMeta.hasJpegIcc(moved) &&
                ImageMeta.canCarryProfile('image/jpeg', await makeRealJpeg(40, 20, { icc: true }));
            return out;
        });
        check('orientation tag added to existing EXIF (6)', r.orientation === 6, String(r.orientation));
        check('other EXIF survives (Make, DateTimeOriginal)', r.make === 'TestCam' && r.taken, String(r.make));
        check('compressed image data byte-identical', r.sameData);
        check('browser shows it rotated (40x20 → 20x40)', r.dims === '20x40', r.dims);
        check('XMP orientation kept in agreement', r.xmp);
        check('CMYK color profile not copied onto RGB output', r.cmykSafe);
        check('second rotation writes only the orientation bytes in place', r.inPlace);
        await page.close();
    }

    // ---- 7b. Crop & Straighten editor ----
    console.log('crop & straighten');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const ed = CropEditor;
            const open = async (file) => {
                app.files = [file];
                app.currentFile = file;
                app.viewMode = 'single';
                document.getElementById('main-interface').classList.remove('hidden');
                await app.enterCrop();
            };

            // Regression: rotate, then crop — the crop must keep the rotation
            const src = await makeRealJpeg(400, 200, { exif: true, dpi: 300, icc: true });
            const f = makeFakeFile('scan.jpg', src, 'image/jpeg');
            app.dirHandle = null;
            await app.rotateImage(f, 90);
            await open(f);
            out.editorDims = `${ed.W}x${ed.H}`;
            ed.setRect({ x0: -100, y0: -200, x1: 50, y1: 200 });
            await app.saveCrop();
            const saved = new Uint8Array(f.handle.bytes);
            const bmp = await createImageBitmap(new Blob([saved], { type: 'image/jpeg' }));
            out.savedDims = `${bmp.width}x${bmp.height}`;
            out.closed = !ed.isOpen && !app.cropState.active;

            // Metadata survives the re-encode
            const info = app.readJpegExifInfo(saved.buffer);
            out.make = info && info.make;
            out.taken = !!(info && info.dateTaken);
            const dpi = ImageMeta.readDpi(saved);
            out.dpi = dpi && Math.round(dpi.x);
            out.icc = ImageMeta.hasJpegIcc(saved);
            out.orientationReset = readOrientation(saved);

            // Undo brings the original (rotated) bytes back
            await app.undo();
            out.undone = readOrientation(f.handle.bytes) === 6;

            // Straighten: corners of the result are image, never empty
            const g = makeFakeFile('red.jpg', await makeRealJpeg(400, 300, { color: '#ff0000' }), 'image/jpeg');
            await open(g);
            ed.setAngle(7);
            out.fitsAt7 = CropGeom.fits(ed.rect, ed.W, ed.H, ed.cs(), 0);
            await app.saveCrop();
            const rb = await createImageBitmap(new Blob([g.handle.bytes], { type: 'image/jpeg' }));
            const c = document.createElement('canvas');
            c.width = rb.width; c.height = rb.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(rb, 0, 0);
            const px = (x, y) => ctx.getImageData(x, y, 1, 1).data;
            out.cornersRed = [[0, 0], [rb.width - 1, 0], [0, rb.height - 1], [rb.width - 1, rb.height - 1]]
                .every(([x, y]) => { const d = px(x, y); return d[0] > 200 && d[1] < 70 && d[2] < 70; });
            out.straightenedSmaller = rb.width < 400 && rb.height < 300;

            // Rotating the angle back restores what was drawn
            const h = makeFakeFile('back.jpg', await makeRealJpeg(400, 300, {}), 'image/jpeg');
            await open(h);
            const full = { ...ed.rect };
            ed.setAngle(12);
            const shrunk = ed.rect.x1 - ed.rect.x0 < full.x1 - full.x0;
            ed.setAngle(0);
            out.angleRoundTrip = shrunk && Math.abs(ed.rect.x0 - full.x0) < 1e-6 && Math.abs(ed.rect.y1 - full.y1) < 1e-6;

            // Aspect preset: 8×10 on a landscape photo → 5:4
            ed.setAspect('4:5');
            const o = ed.outputRect();
            out.aspect = o.w / o.h;
            ed.swapOrientation();
            const o2 = ed.outputRect();
            out.swapped = o2.w / o2.h;
            ed.setAspect('free');
            ed.selectAll();

            // Level tool: a line 10% off horizontal levels to −5.71°
            out.level = ed.levelAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
            out.plumb = ed.levelAngle({ x: 0, y: 0 }, { x: 5, y: 100 });

            // Quarter turn only → lossless EXIF rotation, not a re-encode
            ed.rotateQuarter(1);
            await app.saveCrop();
            // The rotation is written in the background: wait for it, not a fixed time
            for (let i = 0; i < 150 && readOrientation(h.handle.bytes) !== 6; i++) await new Promise(res => setTimeout(res, 20));
            out.quarterLossless = readOrientation(h.handle.bytes) === 6;

            // "Previous" reapplies the last crop
            const k = makeFakeFile('k.jpg', await makeRealJpeg(400, 300, {}), 'image/jpeg');
            await open(k);
            ed.setRect({ x0: -150, y0: -100, x1: 50, y1: 100 });
            app.rememberCrop(ed.snapshot());
            ed.reset();
            ed.usePrevious();
            out.previous = Math.abs(ed.rect.x0 + 150) < 1e-6 && Math.abs(ed.rect.x1 - 50) < 1e-6;
            app.cancelCrop();

            // Save & Next opens the editor on the following photo
            const n1 = makeFakeFile('n1.jpg', await makeRealJpeg(300, 200, {}), 'image/jpeg');
            const n2 = makeFakeFile('n2.jpg', await makeRealJpeg(300, 200, {}), 'image/jpeg');
            app.files = [n1, n2];
            app.currentFile = n1;
            await app.enterCrop();
            ed.setRect({ x0: -100, y0: -50, x1: 100, y1: 50 });
            await app.saveCrop({ next: true });
            for (let i = 0; i < 100 && !(ed.ready && ed.file === n2); i++) await new Promise(res => setTimeout(res, 20));
            out.next = app.currentFile === n2 && ed.isOpen && ed.file === n2 && n1.handle.writes === 1;
            app.cancelCrop();

            // PNG keeps pHYs (DPI) through a crop
            const p = makeFakeFile('p.png', await makeRealPng(60, 40, 300), 'image/png');
            await open(p);
            ed.setRect({ x0: -20, y0: -10, x1: 20, y1: 10 });
            await app.saveCrop();
            const pd = ImageMeta.readDpi(p.handle.bytes);
            out.pngDpi = pd && Math.round(pd.x);
            out.pngType = p.handle.writtenType;

            // ---- Frame-centered editing (Lightroom / Photos style) ----
            // A print on a scanner bed: busy blocks, tilted 3° clockwise
            const scanJpeg = async (tilt, bed) => {
                const c = document.createElement('canvas');
                c.width = 1200; c.height = 900;
                const g = c.getContext('2d');
                g.fillStyle = bed; g.fillRect(0, 0, 1200, 900);
                g.save(); g.translate(560, 430); g.rotate(tilt * Math.PI / 180);
                let seed = 7;
                const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
                for (let y = 0; y < 480; y += 40) for (let x = 0; x < 720; x += 40) {
                    g.fillStyle = `hsl(${Math.floor(rnd() * 360)},55%,${25 + Math.floor(rnd() * 40)}%)`;
                    g.fillRect(x - 360, y - 240, 40, 40);
                }
                g.restore();
                return new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92))).arrayBuffer());
            };
            const stage = () => document.getElementById('crop-canvas').getBoundingClientRect();
            const ptr = (type, x, y, mods = {}) => ed.canvas.dispatchEvent(new PointerEvent(type, {
                clientX: stage().left + x, clientY: stage().top + y, button: 0, pointerId: 1, bubbles: true, ...mods
            }));
            const frame = () => {
                const a = ed.toScreen(ed.rect.x0, ed.rect.y0), b = ed.toScreen(ed.rect.x1, ed.rect.y1);
                return [a.x, a.y, b.x, b.y];
            };
            const sameFrame = (f, g) => f.every((v, i) => Math.abs(v - g[i]) < 0.5);

            // Auto: straightens and crops to the print; no bed in the result
            const sc = makeFakeFile('scan.jpg', await scanJpeg(3, '#f2f0ec'), 'image/jpeg');
            await open(sc);
            out.autoFound = ed.autoDetect({ quiet: true });
            out.autoAngle = ed.angle;
            const ao = ed.outputRect();
            out.autoSize = [ao.w, ao.h];
            await app.saveCrop();
            const ab = await createImageBitmap(new Blob([sc.handle.bytes], { type: 'image/jpeg' }));
            const ac = document.createElement('canvas');
            ac.width = ab.width; ac.height = ab.height;
            const actx = ac.getContext('2d');
            actx.drawImage(ab, 0, 0);
            // every pixel along the saved edges is print, not the pale bed
            const edgePx = [];
            for (let x = 0; x < ab.width; x += 7) edgePx.push([x, 0], [x, ab.height - 1]);
            for (let y = 0; y < ab.height; y += 7) edgePx.push([0, y], [ab.width - 1, y]);
            out.autoNoBed = edgePx.every(([x, y]) => {
                const d = actx.getImageData(x, y, 1, 1).data;
                return d[0] + d[1] + d[2] < 600;
            });

            // A photo with no scanner border: Auto declines and changes nothing
            const plain = makeFakeFile('plain.jpg', await makeRealJpeg(400, 300, { color: '#3366aa' }), 'image/jpeg');
            await open(plain);
            const before = JSON.stringify(ed.rect);
            out.autoDeclines = ed.autoDetect({ quiet: true }) === false && JSON.stringify(ed.rect) === before && ed.angle === 0;
            app.cancelCrop();

            // Turning pivots on the crop's centre: the same spot on the photo
            // stays in the middle of the frame
            const pv = makeFakeFile('pivot.jpg', await scanJpeg(0, '#f2f0ec'), 'image/jpeg');
            await open(pv);
            ed.setRect({ x0: 100, y0: -50, x1: 400, y1: 150 });
            ed.settle(false);
            const spot = ed.toImage({ x: 250, y: 50 });
            ed.setAngle(6);
            const c6 = ed.toImage({ x: (ed.rect.x0 + ed.rect.x1) / 2, y: (ed.rect.y0 + ed.rect.y1) / 2 });
            out.pivot = Math.hypot(c6.x - spot.x, c6.y - spot.y) < 0.5 && CropGeom.fits(ed.rect, ed.W, ed.H, ed.cs(), 0);
            ed.setAngle(0);

            // Resting view: the crop fills the stage
            ed.setRect({ x0: -200, y0: -150, x1: 200, y1: 150 });
            ed.settle(false);
            const st0 = stage(), f0 = frame();
            out.fills = Math.abs((f0[2] - f0[0]) - (st0.width - 2 * ed.PAD)) < 1 || Math.abs((f0[3] - f0[1]) - (st0.height - 2 * ed.PAD)) < 1;
            out.centred = Math.abs((f0[0] + f0[2]) / 2 - st0.width / 2) < 1 && Math.abs((f0[1] + f0[3]) / 2 - st0.height / 2) < 1;

            // Drag inside: the photo moves, the frame stays
            const mx = (f0[0] + f0[2]) / 2, my = (f0[1] + f0[3]) / 2;
            const r0 = { ...ed.rect };
            ptr('pointerdown', mx, my); ptr('pointermove', mx + 30, my + 20); ptr('pointerup', mx + 30, my + 20);
            out.panFrameStill = sameFrame(frame(), f0);
            out.panMovedPhoto = ed.rect.x0 < r0.x0 - 1 && ed.rect.y0 < r0.y0 - 1;

            // Drag outside: rotates; the frame stays put
            ed.settle(false);
            const f1 = frame();
            ptr('pointerdown', f1[2] + 30, my); ptr('pointermove', f1[2] + 30, my + 60); ptr('pointerup', f1[2] + 30, my + 60);
            out.rotateDrag = ed.angle > 1 && ed.angle < 45;
            ed.settle(false);
            out.rotateFrameStill = sameFrame(frame(), f1) || Math.abs((frame()[2] - frame()[0]) - (f1[2] - f1[0])) < 1;

            // Ctrl+drag draws a level line
            ed.setAngle(0);
            ed.settle(false);
            ptr('pointerdown', 100, 100, { ctrlKey: true }); ptr('pointermove', 300, 120, { ctrlKey: true }); ptr('pointerup', 300, 120, { ctrlKey: true });
            out.ctrlLevel = Math.abs(ed.angle + 5.71) < 0.05;

            // Undo inside the editor; a run of nudges is one step
            ed.history = []; ed.future = [];
            ed.setAngle(0);
            ed.nudgeAngle(0.1); ed.nudgeAngle(0.1); ed.nudgeAngle(0.1);
            out.nudged = Math.abs(ed.angle - 0.3) < 1e-9;
            ed.undo();
            out.undoNudges = ed.angle === 0;
            ed.redo();
            out.redo = Math.abs(ed.angle - 0.3) < 1e-9;

            // Resize from a handle, then the view glides back to filling the stage
            ed.setAngle(0);
            ed.setRect(ed.fullRect());
            ed.settle(false);
            const f2 = frame();
            ptr('pointerdown', f2[0], f2[1]); ptr('pointermove', f2[0] + 80, f2[1] + 60); ptr('pointerup', f2[0] + 80, f2[1] + 60);
            out.resized = ed.rect.x0 > -ed.W / 2 + 10 && ed.rect.y0 > -ed.H / 2 + 10;
            for (let i = 0; i < 150 && (ed._anim || ed.drag); i++) await new Promise(res => setTimeout(res, 20)); // the glide
            const f3 = frame(), st3 = stage();
            out.settled = Math.abs((f3[0] + f3[2]) / 2 - st3.width / 2) < 1 && Math.abs((f3[1] + f3[3]) / 2 - st3.height / 2) < 1;

            // Loupe: while a handle is dragged, a close-up of that corner in
            // a top corner away from the pointer; off, none
            ed.setLoupe(true);
            ed.setRect({ x0: -150, y0: -100, x1: 150, y1: 100 });
            ed.settle(false);
            const f4 = frame();
            ptr('pointerdown', f4[0], f4[1]); ptr('pointermove', f4[0] + 10, f4[1] + 8);
            const lf = ed.loupeFocus(), lb = ed.loupeBox(), o4 = ed.outputRect();
            out.loupe = !!lf && lf.x === o4.x0 && lf.y === o4.y0 && !!lb && lb.x > stage().width / 2
                && ed.loupeScale(ed.view().s) >= 2 * ed.view().s;
            ed.setLoupe(false);
            out.loupeOff = ed.loupeFocus() === null && document.getElementById('crop-loupe').getAttribute('aria-pressed') === 'false';
            ed.setLoupe(true);
            ptr('pointerup', f4[0] + 10, f4[1] + 8);
            out.loupeGone = ed.loupeFocus() === null;

            // Zoom: the wheel zooms about the pointer; the view stays zoomed
            // through a resize; Fit (and a new aspect) rest on the crop again
            ed.setRect({ x0: -150, y0: -100, x1: 150, y1: 100 });
            ed.fitView(false);
            const home = ed.view().s, f5 = frame();
            const wheel = (x, y, dy) => ed.canvas.dispatchEvent(new WheelEvent('wheel', { clientX: stage().left + x, clientY: stage().top + y, deltaY: dy, bubbles: true, cancelable: true }));
            const under = ed.toOutput(f5[2], f5[3]);
            wheel(f5[2], f5[3], -300);
            const anchored = ed.toOutput(f5[2], f5[3]);
            out.zoomIn = ed.zoomed && ed.view().s > home * 1.5 && Math.hypot(anchored.x - under.x, anchored.y - under.y) < 0.5
                && /^\d+%$/.test(document.getElementById('crop-zoom-fit').textContent);
            const vz = { ...ed.view() }, f6 = frame();
            ptr('pointerdown', f6[2], f6[3]); ptr('pointermove', f6[2] - 20, f6[3] - 20); ptr('pointerup', f6[2] - 20, f6[3] - 20);
            out.zoomKept = ed.rect.x1 < 149 && ed.zoomed && ed.view().s === vz.s && ed.view().cx === vz.cx;
            // Space held: dragging moves the view, not the crop
            const r6 = JSON.stringify(ed.rect);
            window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
            ptr('pointerdown', 300, 200); ptr('pointermove', 260, 180); ptr('pointerup', 260, 180);
            window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
            out.spacePan = JSON.stringify(ed.rect) === r6 && Math.abs(ed.view().cx - vz.cx - 40 / vz.s) < 1e-6;
            ed.fitView(false);
            out.zoomFit = !ed.zoomed && Math.abs(ed.view().s - home) < 1e-6 && document.getElementById('crop-zoom-fit').textContent === 'Fit';
            ed.zoomBy(2);
            ed.zoomBy(0.5);
            out.zoomBackRests = !ed.zoomed;
            ed.zoomBy(2);
            ed.setAspect('1:1');
            out.aspectFits = !ed.zoomed;
            ed.setAspect('free');
            app.cancelCrop();

            // Close-ups draw from the full-size photo, not the screen-sized
            // working copy
            const big = makeFakeFile('big.jpg', await makeRealJpeg(2800, 1900, {}), 'image/jpeg');
            await open(big);
            const small = ed.preview.width < ed.W;
            ed.zoomBy(4);
            for (let i = 0; i < 100 && !ed.detail; i++) await new Promise(res => setTimeout(res, 20));
            out.detail = small && !!ed.detail && ed.detail.width === 2800 && ed.source(ed.view().s) === ed.detail;
            app.cancelCrop();
            out.detailDropped = !ed.detail;

            // "Every photo": Auto runs as the editor opens
            ed.setAutoEach(true);
            const sc2 = makeFakeFile('scan2.jpg', await scanJpeg(-2, '#0e0e0e'), 'image/jpeg');
            await open(sc2);
            out.autoEach = Math.abs(ed.angle - 2) < 0.15 && ed.history.length === 0;
            ed.setAutoEach(false);
            app.cancelCrop();

            // Auto crop's test set (crop-log.js): each crop saved after Auto
            // keeps the scan and a label; one cropped by hand, a log line
            const opfs = await navigator.storage.getDirectory();
            await opfs.removeEntry(CropLog.DIR, { recursive: true }).catch(() => { });
            const saveAfter = async (name, bytes, act) => {
                await open(makeFakeFile(name, bytes, 'image/jpeg'));
                await act();
                await app.saveCrop();
                await CropLog._queue;
            };
            const plainJpeg = async () => {
                const c = document.createElement('canvas');
                c.width = 900; c.height = 600;
                const g = c.getContext('2d');
                for (let y = 0; y < 600; y += 30) for (let x = 0; x < 900; x += 30) {
                    g.fillStyle = `hsl(${(x * 7 + y * 3) % 360},50%,${30 + (x + y) % 40}%)`;
                    g.fillRect(x, y, 30, 30);
                }
                return new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
            };
            const inset = (k) => { const r = ed.rect; ed.setRect({ x0: r.x0 + k, y0: r.y0 + k, x1: r.x1 - k, y1: r.y1 - k }); };
            await saveAfter('logA.jpg', await scanJpeg(-2, '#0e0e0e'), () => ed.autoDetect({ quiet: true }));
            await saveAfter('logB.jpg', await scanJpeg(1, '#0e0e0e'), () => { ed.autoDetect({ quiet: true }); inset(25); });
            await saveAfter('logC.jpg', await plainJpeg(), () => { ed.autoDetect({ quiet: true }); inset(40); });
            await saveAfter('logD.jpg', await plainJpeg(), () => inset(40));
            const dir = await opfs.getDirectoryHandle(CropLog.DIR);
            const names = [];
            for await (const [n] of dir.entries()) names.push(n);
            out.logNames = names.sort();
            const label = async (n) => JSON.parse(await (await (await dir.getFileHandle(n)).getFile()).text());
            const json = names.filter(n => n.endsWith('.json'));
            out.logLabels = await Promise.all(json.map(label));
            const lines = (await (await (await dir.getFileHandle('log.jsonl')).getFile()).text()).trim().split('\n').map(l => JSON.parse(l));
            out.logLines = lines.map(l => `${l.file}:${l.result}`);
            const scanB = names.find(n => /logB\.jpg$/.test(n));
            const keptB = scanB && new Uint8Array(await (await (await dir.getFileHandle(scanB)).getFile()).arrayBuffer());
            out.logBytes = !!keptB && keptB.length > 1000 && keptB[0] === 0xff && keptB[1] === 0xd8;
            await CropLog.refresh();
            out.logCount = document.getElementById('crop-log-count').textContent;
            // A scan's dpi ({ x, y } from its file) gives the tolerance; a
            // crop turned a quarter is the same crop, from another corner
            const Q = [[10, 20], [610, 20], [610, 420], [10, 420]];
            const judged = CropLog.judge({ dpi: { x: 600, y: 600 }, auto: { found: true, crop: Q }, saved: { none: false, crop: Q.map(([x, y]) => [x + 2, y]) } });
            out.logDpi = judged.result === 'accepted' && CropLog.dpiOf({ x: 600, y: 600 }) === 600;
            out.logTurned = CropLog.apart(Q, [Q[3], Q[0], Q[1], Q[2]]) === 0 && CropLog.apart(Q, Q.map(([x, y]) => [x + 30, y])) === 30;
            // Off: nothing more kept
            CropLog.setEnabled(false);
            await saveAfter('logE.jpg', await scanJpeg(0, '#0e0e0e'), () => ed.autoDetect({ quiet: true }));
            let after = 0;
            for await (const _ of dir.entries()) after++;
            out.logOff = after === names.length;
            CropLog.setEnabled(true);
            // Clear: all of it gone
            const realConfirm = UI.confirm;
            UI.confirm = async () => true;
            await CropLog.clear();
            UI.confirm = realConfirm;
            out.logCleared = await opfs.getDirectoryHandle(CropLog.DIR).then(() => false, () => true);
            return out;
        });
        check('rotate-then-crop: editor sees the rotated photo (200x400)', r.editorDims === '200x400', r.editorDims);
        check('rotate-then-crop: saved crop keeps the rotation (150x400)', r.savedDims === '150x400', r.savedDims);
        check('editor closes after save', r.closed);
        check('crop keeps EXIF (Make, DateTimeOriginal)', r.make === 'TestCam' && r.taken, String(r.make));
        check('crop keeps DPI (300)', r.dpi === 300, String(r.dpi));
        check('crop keeps the ICC color profile', r.icc);
        check('crop resets EXIF orientation to 1 (pixels baked upright)', r.orientationReset === 1, String(r.orientationReset));
        check('undo restores the pre-crop file', r.undone);
        check('straightened crop fits inside the rotated image', r.fitsAt7);
        check('straightened output has no empty corners', r.cornersRed && r.straightenedSmaller);
        check('straighten then back to 0° restores the crop', r.angleRoundTrip);
        check('8×10 preset gives 5:4 on landscape', Math.abs(r.aspect - 1.25) < 0.01, String(r.aspect));
        check('swap orientation gives 4:5', Math.abs(r.swapped - 0.8) < 0.01, String(r.swapped));
        check('level tool: near-horizontal line → −5.71°', Math.abs(r.level + 5.71) < 0.01, String(r.level));
        check('level tool: near-vertical line → plumb (+2.86°)', Math.abs(r.plumb - 2.86) < 0.01, String(r.plumb));
        check('quarter turn without crop saves losslessly', r.quarterLossless);
        check('"Previous" reapplies the last crop', r.previous);
        check('Save & Next moves on and reopens the editor', r.next);
        check('PNG crop stays PNG and keeps DPI', r.pngType === 'image/png' && r.pngDpi === 300, `${r.pngType} ${r.pngDpi}`);
        check('Auto straightens a tilted print (−3°)', r.autoFound && Math.abs(r.autoAngle + 3) < 0.15, String(r.autoAngle));
        {
            const L = r.logLabels || [], by = (f) => L.find(l => l.file === f) || {};
            const A = by('logA.jpg'), B = by('logB.jpg'), C = by('logC.jpg');
            check('test set: a scan saved with Auto\'s crop is kept as accepted, with where Auto put the print', A.result === 'accepted' && A.auto && A.auto.found && A.auto.corners.length === 4 && A.saved.crop.length === 4 && A.W === 1200, JSON.stringify(A));
            check('test set: a scan cropped tighter after Auto is kept as corrected, with how far', B.result === 'corrected' && B.diff > 20, JSON.stringify(B && { result: B.result, diff: B.diff }));
            check('test set: Auto finding nothing, then a crop by hand, is kept as missed', C.result === 'missed' && C.auto && C.auto.found === false, JSON.stringify(C && C.result));
            check('test set: the scans themselves are kept, as they were before the save', r.logBytes && r.logNames.filter(n => /^\d{8}T\d{6}-log[ABC]\.jpg$/.test(n)).length === 3 && L.length === 3, r.logNames.join());
            check('test set: every crop is in the log; one done without Auto has no scan', (r.logLines || []).join() === 'logA.jpg:accepted,logB.jpg:corrected,logC.jpg:missed,logD.jpg:manual' && !r.logNames.some(n => /logD/.test(n)), (r.logLines || []).join());
            check('test set: Settings shows how many are kept', /^3 scans kept · /.test(r.logCount), r.logCount);
            check('test set: a scan with a dpi saved with Auto\'s crop is accepted; its dpi is kept as a number', r.logDpi);
            check('test set: a crop turned a quarter isn\'t counted as moved', r.logTurned);
            check('test set: off keeps nothing; Clear removes it all', r.logOff && r.logCleared, JSON.stringify([r.logOff, r.logCleared]));
        }
        check('Auto crops to the print (720×480, no bed)', r.autoNoBed && Math.abs(r.autoSize[0] - 720) < 12 && Math.abs(r.autoSize[1] - 480) < 12, JSON.stringify(r.autoSize));
        check('Auto declines a photo with no scanner border', r.autoDeclines);
        check('straightening pivots on the crop center', r.pivot);
        check('resting view: crop centered and filling the stage', r.fills && r.centred);
        check('drag inside moves the photo, not the frame', r.panFrameStill && r.panMovedPhoto);
        check('drag outside the frame rotates', r.rotateDrag && r.rotateFrameStill, String(r.rotateDrag));
        check('Ctrl+drag draws a level line', r.ctrlLevel);
        check('editor undo: a run of nudges is one step; redo', r.nudged && r.undoNudges && r.redo);
        check('handle resize, then the view re-centers', r.resized && r.settled);
        check('loupe: a close-up of the dragged corner, away from the pointer; can be turned off', r.loupe && r.loupeOff && r.loupeGone, JSON.stringify([r.loupe, r.loupeOff, r.loupeGone]));
        check('zoom: the wheel zooms about the pointer, and it stays zoomed through a resize', r.zoomIn && r.zoomKept, JSON.stringify([r.zoomIn, r.zoomKept]));
        check('zoom: Space+drag moves the view, not the crop', r.spacePan);
        check('zoom: Fit, zooming back, or a new aspect rest on the crop again', r.zoomFit && r.zoomBackRests && r.aspectFits, JSON.stringify([r.zoomFit, r.zoomBackRests, r.aspectFits]));
        check('close-ups use the full-size photo, dropped on close', r.detail && r.detailDropped, JSON.stringify([r.detail, r.detailDropped]));
        check('"Every photo" runs Auto as each photo opens', r.autoEach);
        check('crop suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7c. Keyboard shortcuts: exact matching, rebinding, panel ----
    console.log('keyboard shortcuts');
    {
        const { page } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            localStorage.removeItem('jeditor.keys');
            app.loadKeyBindings();
            const f = makeFakeFile('a.jpg', await makeRealJpeg(40, 30, {}), 'image/jpeg');
            app.files = [f];
            app.currentFile = f;
            app.dirHandle = null;
            document.getElementById('main-interface').classList.remove('hidden');
            app.setView('single');
            const press = (key, mods = {}, target = window) =>
                target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));

            // Ctrl+C is not C
            press('c', { ctrlKey: true });
            out.ctrlCIgnored = !app.cropState.active;

            // Rebind: Shift+G → grid view, and it persists
            app.assignKey('view.grid', 'Shift+G');
            press('G', { shiftKey: true });
            out.rebound = app.viewMode === 'grid';
            out.persisted = JSON.parse(localStorage.getItem('jeditor.keys'))['view.grid'].includes('Shift+G');

            // Conflict: giving I to "Single view" takes it from File Info
            app.assignKey('view.single', 'I');
            out.conflictMoved = !app.keyBindings['view.info'].includes('I');
            press('i');
            out.newBindingWorks = app.viewMode === 'single';

            // Panel: record a new key with the + button
            press('?');
            out.panelOpen = app.isShortcutsOpen();
            const row = [...document.querySelectorAll('.sc-row')].find(x => x.textContent.startsWith('Full screen'));
            row.querySelector('.sc-add').click();
            press('k');
            out.recorded = app.keyBindings['view.fullscreen'].includes('K');
            // Typing in the filter never triggers shortcuts
            const filter = document.getElementById('shortcuts-filter');
            filter.focus();
            press('g', {}, filter);
            out.typingSafe = app.viewMode === 'single';
            press('Escape');
            out.panelClosed = !app.isShortcutsOpen();

            app.resetKeys();
            out.reset = app.keyBindings['view.info'].join() === 'I' && app.keyBindings['view.grid'].join() === 'G';
            out.format = app.formatCombo('Ctrl+Shift+ArrowLeft').replace('⌘', 'Ctrl') + '|' + app.formatCombo('+');
            return out;
        });
        check('Ctrl+C does not start crop', r.ctrlCIgnored);
        check('rebound key works and persists', r.rebound && r.persisted);
        check('assigning a used key moves it', r.conflictMoved && r.newBindingWorks);
        check('? opens the shortcuts panel', r.panelOpen);
        check('+ records a new key', r.recorded);
        check('typing in the filter is not a shortcut', r.typingSafe);
        check('Esc closes the panel', r.panelClosed);
        check('reset all restores defaults', r.reset);
        check('key combos format for display', r.format === 'Ctrl + Shift + ←|+', r.format);
        await page.close();

        // Profiles: Lightroom Classic's keys, changes kept per profile, own profiles
        const { page: pp } = await newPage(browser, `${baseUrl}/index.html`);
        const rp = await pp.evaluate(async () => {
            const out = {};
            for (const k of Object.keys(localStorage)) if (k.startsWith('jeditor.key')) localStorage.removeItem(k);
            app.loadKeyBindings();
            // No key does two things in one place, in any built-in profile
            out.clashes = [];
            for (const id of Object.keys(app.KEY_PROFILES)) {
                const keys = app.keyProfileDefaults(id), seen = new Map();
                for (const [aid, ctx] of app.KEY_ACTIONS) for (const k of keys[aid]) {
                    const at = ctx + ' ' + k;
                    if (seen.has(at)) out.clashes.push(`${id}: ${k} → ${seen.get(at)} and ${aid}`);
                    seen.set(at, aid);
                }
            }
            app.setKeyProfile('lightroom');
            const kb = app.keyBindings;
            out.lr = kb['edit.crop'].join() === 'R' && kb['flag.red'].join() === '6' && kb['view.single'].join() === 'E'
                && kb['edit.rotateLeft'].join() === 'Ctrl+[' && kb['app.refresh'].join() === 'F5' && kb['flag.star'].join() === 'P';
            // A change in Lightroom's stays there
            app.assignKey('view.grid', 'Shift+G');
            out.lrSaved = JSON.parse(localStorage.getItem('jeditor.keys.lightroom'))['view.grid'].includes('Shift+G')
                && !localStorage.getItem('jeditor.keys');
            app.setKeyProfile('jeditor');
            out.back = app.keyBindings['edit.crop'].join() === 'C' && app.keyBindings['view.grid'].join() === 'G';
            app.setKeyProfile('lightroom');
            out.kept = app.keyBindings['view.grid'].includes('Shift+G');
            app.loadKeyBindings();
            out.remembered = app.keyProfile === 'lightroom';
            // Reset goes back to Lightroom's keys, not jEditor's
            app.resetKeys();
            out.reset = app.keyBindings['view.grid'].join() === 'G' && app.keyBindings['edit.crop'].join() === 'R';
            // The panel: both profiles listed; a new one from the keys in use
            app.toggleShortcutsPanel(true);
            const sel = document.getElementById('shortcuts-profile');
            out.listed = [...sel.options].map(o => o.textContent).join() === 'jEditor,Lightroom Classic' && sel.value === 'lightroom';
            out.noRename = document.getElementById('shortcuts-profile-rename').classList.contains('hidden');
            const made = app.newKeyProfile();
            await new Promise(r => setTimeout(r, 50));
            document.getElementById('uid-input').value = 'Ana';
            document.getElementById('uid-ok').click();
            await made;
            out.made = app.keyProfiles().some(p => p.name === 'Ana' && p.id === app.keyProfile)
                && app.keyBindings['edit.crop'].join() === 'R' && sel.value === app.keyProfile
                && !document.getElementById('shortcuts-profile-rename').classList.contains('hidden');
            // Picking from the list switches
            sel.value = 'jeditor';
            sel.dispatchEvent(new Event('change'));
            out.picked = app.keyProfile === 'jeditor' && app.keyBindings['edit.crop'].join() === 'C';
            app.toggleShortcutsPanel(false);
            for (const k of Object.keys(localStorage)) if (k.startsWith('jeditor.key')) localStorage.removeItem(k);
            return out;
        });
        check('shortcut profiles: no key does two things', !rp.clashes.length, rp.clashes.join('; '));
        check('Lightroom Classic profile has Lightroom\'s keys', rp.lr);
        check('a change is kept in its own profile', rp.lrSaved && rp.back && rp.kept, JSON.stringify(rp));
        check('the profile in use is remembered', rp.remembered);
        check('reset goes back to the profile\'s own keys', rp.reset);
        check('the panel lists profiles; a new one copies the keys in use', rp.listed && rp.noRename && rp.made, JSON.stringify(rp));
        check('picking a profile in the panel switches to it', rp.picked);
        await pp.close();

        // '\\' turns photos 180°: the current one, the grid selection, and in crop
        const { page: p180, issues: i180 } = await newPage(browser, `${baseUrl}/index.html`);
        const r180 = await p180.evaluate(async () => {
            const out = {};
            localStorage.removeItem('jeditor.keys');
            app.loadKeyBindings();
            // Rotation messages are off to start with (Settings → Messages): on, to check this one
            app.uiPrefs.toasts.rotate = true;
            const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            const a = makeFakeFile('a.jpg', makeJpegBytes(), 'image/jpeg');
            const b = makeFakeFile('b.jpg', makeJpegBytes(), 'image/jpeg');
            const c = makeFakeFile('c.jpg', makeJpegBytes(), 'image/jpeg');
            app.files = [a, b, c];
            app.currentFile = a;
            app.dirHandle = null;
            document.getElementById('main-interface').classList.remove('hidden');
            app.setView('single');
            const settle = async (f) => { for (let i = 0; i < 100 && (f._rotationQueue || f.pendingRotation); i++) await new Promise(res => setTimeout(res, 20)); };
            press('\\');
            await settle(a);
            out.single = readOrientation(a.handle.bytes) === 3;
            app.setView('grid');
            app.selection = new Set([b, c]);
            press('\\');
            await settle(b); await settle(c);
            out.grid = readOrientation(b.handle.bytes) === 3 && readOrientation(c.handle.bytes) === 3;
            out.toast = [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('180°'));
            // Undo pressed while the batch is still saving: still the whole batch
            app.selection = new Set([b, c]);
            const again = app.rotateBulk(90);
            await app.undo();
            await again;
            await settle(b); await settle(c);
            out.undoMidBatch = readOrientation(b.handle.bytes) === 3 && readOrientation(c.handle.bytes) === 3;
            await app.undo();
            await settle(b); await settle(c);
            out.undo = readOrientation(b.handle.bytes) === 1 && readOrientation(c.handle.bytes) === 1;
            // In the crop editor: upside down, the same crop
            app.setView('single');
            const f = makeFakeFile('crop.jpg', await makeRealJpeg(400, 300, {}), 'image/jpeg');
            app.files = [f];
            app.currentFile = f;
            await app.enterCrop();
            CropEditor.setRect({ x0: -150, y0: -100, x1: 50, y1: 100 });
            const before = { ...CropEditor.rect };
            press('\\');
            const r = CropEditor.rect;
            out.crop = CropEditor.q === 2 && Math.abs((r.x1 - r.x0) - (before.x1 - before.x0)) < 1e-6 && Math.abs(r.x0 + before.x1) < 1e-6;
            CropEditor.undo();
            out.cropUndo = CropEditor.q === 0;
            app.cancelCrop();
            out.listed = app.KEY_ACTIONS.some(k => k[0] === 'edit.rotate180' && k[4].includes('\\'));
            return out;
        });
        check('\\ turns the current photo 180° (losslessly)', r180.single);
        check('\\ turns the grid selection 180°, says so; one undo for the whole selection', r180.grid && r180.toast && r180.undo, JSON.stringify(r180));
        check('undo pressed while a selection is still rotating undoes all of it', r180.undoMidBatch, JSON.stringify(r180));
        check('\\ turns the crop upside down (same crop); editor undo', r180.crop && r180.cropUndo);
        check('180° listed in the shortcuts panel', r180.listed);
        check('rotate 180 suite: no JS errors', i180.errors.length === 0, i180.errors.join('; '));
        await p180.close();
    }

    // ---- 7d. Opening a folder, instant navigation, grid & read-only fixes ----
    console.log('viewer: open, instant navigation, grid, read-only');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const dir = makeDir('Order');
            for (let i = 1; i <= 4; i++) {
                const h = makeHandle(`s${i}.jpg`, await makeRealJpeg(300, 200, { color: `hsl(${i * 80},60%,50%)` }), 'image/jpeg');
                dir._files.set(h.name, h);
            }
            dir.values = async function* () { yield* dir._files.values(); };
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            for (let i = 0; i < 50 && app._displayKind !== 'full'; i++) await new Promise(res => setTimeout(res, 20));
            const img = document.getElementById('current-image');
            out.visible = !document.getElementById('image-container').classList.contains('hidden') &&
                img.naturalWidth === 300 && app.viewMode === 'single';

            // Neighbor is pre-decoded: next photo is on screen synchronously
            const next = app.files[1];
            for (let i = 0; i < 50 && !(next._decodedEl && next._decodedEl._decoded); i++) await new Promise(res => setTimeout(res, 20));
            app.navigate(1);
            out.instant = document.getElementById('current-image') === next._decodedEl && app._displayKind === 'full';

            // Refresh doesn't duplicate
            await app.refreshFolder();
            out.noDupes = app.files.length === 4;

            // Grid Up/Down follows the real column count
            app.setView('grid');
            document.documentElement.style.setProperty('--grid-item-size', '300px');
            const cols = getComputedStyle(document.getElementById('grid-view')).gridTemplateColumns.split(' ').length;
            out.cols = app.getGridColumnCount() === cols;

            // Read-only: edits refused up front
            app.readOnlyMode = true;
            const before = app.files[0].handle.writes;
            const res = await app.rotateImage(app.files[0], 90);
            out.readOnly = res === false && app.files[0].handle.writes === before &&
                [...document.querySelectorAll('.toast')].some(t => /read-only/.test(t.textContent));
            app.readOnlyMode = false;
            const snap = app.perfSnapshot().join('\n');
            out.perf = /Undo: \d+ steps/.test(snap) && /Images decoded/.test(snap) && /Photo load/.test(snap);
            // Off in Settings to start with: the shortcut does nothing
            app.toggleDebugConsole();
            out.debugOff = !document.getElementById('debug-console').classList.contains('open');
            app.uiPrefs.debugConsole = true;
            app.toggleDebugConsole();
            out.perfShown = /Thumbnails:/.test(document.getElementById('debug-perf').textContent);
            app.toggleDebugConsole();
            app.uiPrefs.debugConsole = false;
            app.selection = new Set([app.files[0]]);
            app.updateSelectionUI();
            out.selectionText = document.getElementById('selection-count').textContent;
            // Leaving the grid clears the tiles' highlight too, so photos
            // selected earlier don't light up when the grid comes back
            app.setView('grid');
            app.selection = new Set(app.files.slice(0, 3));
            app.updateSelectionUI();
            app.setView('single');
            out.noStaleRings = !document.querySelector('#grid-view .grid-item.selected');
            app.setView('grid');
            out.onlyCurrentRinged = [...document.querySelectorAll('#grid-view .grid-item.selected')].map(t => t._file).join() === String(app.currentFile);
            return out;
        });
        check('opening a folder shows the photo (no blank screen)', r.visible);
        check('next photo swaps in instantly (pre-decoded)', r.instant);
        check('refresh adds no duplicates', r.noDupes);
        check('grid Up/Down uses the real column count', r.cols);
        check('read-only photos refuse edits with a message', r.readOnly);
        check('selection count reads "1 selected"', r.selectionText === '1 selected', r.selectionText);
        check('back in the grid, only the current photo is selected (no stale rings)', r.noStaleRings && r.onlyCurrentRinged,
            JSON.stringify({ stale: !r.noStaleRings, only: r.onlyCurrentRinged }));
        check('debug console is off until turned on in Settings', r.debugOff);
        check('debug console shows a performance readout', r.perf && r.perfShown);
        check('viewer suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7e. Screen-sized previews for big scans ----
    console.log('screen-sized previews');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const edge = app.previewEdge();
            const big = makeFakeFile('big.jpg', await makeRealJpeg(edge * 2, Math.round(edge * 1.5), { exif: true }), 'image/jpeg');
            app.files = [big];
            app.currentFile = big;
            app.dirHandle = null;
            document.getElementById('main-interface').classList.remove('hidden');
            app.setView('single');
            for (let i = 0; i < 200 && app._displayKind !== 'full'; i++) await new Promise(res => setTimeout(res, 25));
            const img = document.getElementById('current-image');
            out.isPreview = img._isPreview === true && Math.max(img.naturalWidth, img.naturalHeight) <= edge;
            // A screen-sized photo is shown from the original, without a worker decode first
            let workerCalls = 0;
            const gen = app.generatePreview.bind(app);
            app.generatePreview = (...a) => { workerCalls++; return gen(...a); };
            const small = makeFakeFile('small.jpg', await makeRealJpeg(Math.round(edge * 0.7), Math.round(edge * 0.5), {}), 'image/jpeg');
            const src = await app.getDisplaySource(small);
            out.smallDirect = workerCalls === 0 && src.isPreview === false && src.w === Math.round(edge * 0.7);
            app.generatePreview = gen;
            out.origDims = big._dims && big._dims.w === edge * 2;
            out.cached = !!(await app.idbGet('previews', big._preview.key));

            // Rotation on a preview still shows instantly
            await app.rotateImage(big, 90);
            out.rotatedShown = /rotate\(90deg\)/.test(document.getElementById('current-image').style.transform);

            // Zooming past fit swaps in the original
            app.zoomBy(2);
            for (let i = 0; i < 200 && document.getElementById('current-image')._isPreview; i++) await new Promise(res => setTimeout(res, 25));
            const full = document.getElementById('current-image');
            out.upgraded = !full._isPreview && Math.max(full.naturalWidth, full.naturalHeight) === edge * 2;
            out.zoomKept = app.zoom === 2 && /scale\(/.test(full.style.transform);

            // Crop still renders at full resolution from the original
            app.zoomBy(0);
            await app.enterCrop();
            out.cropDims = `${CropEditor.W}x${CropEditor.H}`;
            app.cancelCrop();

            // Double-click: in to 100% on the clicked spot, again back to fit.
            // Start and measure only when nothing is still in flight: the
            // earlier rotation's save, the original replacing the preview,
            // the zoom animation (a busy CI machine runs all of these late)
            const steady = async () => {
                let el = null;
                for (let i = 0; i < 200; i++) {
                    await new Promise(res => setTimeout(res, 25));
                    el = document.getElementById('current-image');
                    if (!big._rotationQueue && !big.pendingRotation && !big.savingRotation && el.complete &&
                        (app.zoom <= 1 || !el._isPreview) && !el.getAnimations().some(an => an.playState === 'running')) break;
                }
                await Promise.all(el.getAnimations().map(an => an.finished.catch(() => {})));
                return el;
            };
            const dbl = (x, y) => document.getElementById('current-image')
                .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));
            const view = await steady();
            const b0 = view.getBoundingClientRect();
            // Mouse events carry whole pixels
            const px = Math.round(b0.left + b0.width * 0.3), py = Math.round(b0.top + b0.height * 0.6);
            dbl(px, py);
            const shown = await steady();
            // 100%: the original's pixels one-to-one with screen pixels — its
            // on-screen size is its pixel size (whichever way round it is)
            const sb = shown.getBoundingClientRect();
            out.dblZoom = Math.abs(Math.max(sb.width, sb.height) - Math.max(shown.naturalWidth, shown.naturalHeight)) < 2 && !shown._isPreview;
            const b1 = shown.getBoundingClientRect();
            const ux = (px - b0.left) / b0.width, uy = (py - b0.top) / b0.height;
            out.dblDrift = Math.hypot(b1.left + b1.width * ux - px, b1.top + b1.height * uy - py);
            out.dblState = JSON.stringify({ zoom: app.zoom, pan: [app.panX, app.panY], swapped: shown !== view,
                preview: !!shown._isPreview, t0: view.style.transform, t1: shown.style.transform });
            dbl(px + 30, py + 30);
            out.dblFit = app.zoom === 1 && app.panX === 0 && app.panY === 0;

            // Wheel: zooms on the pointer, up to 3200% of the photo's pixels,
            // sharp squares from 200%
            const wheel = (x, y, dy) => document.getElementById('current-image')
                .dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: dy }));
            const w0 = (await steady()).getBoundingClientRect();
            const wx = Math.round(w0.left + w0.width * 0.7), wy = Math.round(w0.top + w0.height * 0.4);
            for (let i = 0; i < 6; i++) wheel(wx, wy, -100);
            const zoomedEl = await steady();
            const w1 = zoomedEl.getBoundingClientRect();
            const wux = (wx - w0.left) / w0.width, wuy = (wy - w0.top) / w0.height;
            out.wheelDrift = Math.hypot(w1.left + w1.width * wux - wx, w1.top + w1.height * wuy - wy);
            out.wheelZoomed = app.zoom > 2;
            for (let i = 0; i < 80; i++) wheel(wx, wy, -100);
            const one = app.oneToOneZoom();
            out.maxPct = Math.round(app.zoom / one * 100);
            out.pixelatedAtMax = document.getElementById('current-image').classList.contains('pixelated');
            out.readout = document.getElementById('zoom-level').textContent;
            app.zoomTo(one * 1.5);
            out.sharpAt150 = document.getElementById('current-image').classList.contains('pixelated');
            app.zoomTo(one * 0.8);
            out.smoothAt80 = !document.getElementById('current-image').classList.contains('pixelated');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
            out.keyFit = app.zoom === 1 && app.panX === 0 && !document.getElementById('current-image').classList.contains('pixelated');
            return { ...out, expectCrop: `${Math.round(edge * 1.5)}x${edge * 2}` };
        });
        check('big scan shows a screen-sized preview', r.isPreview);
        check('original dimensions reported for the preview', r.origDims);
        check('screen-sized photo skips the preview worker', r.smallDirect);
        check('preview cached in IndexedDB', r.cached);
        check('rotating a previewed photo shows instantly', r.rotatedShown);
        check('zooming in swaps to the full-resolution original', r.upgraded && r.zoomKept);
        check('crop works at original resolution after rotation', r.cropDims === r.expectCrop, `${r.cropDims} vs ${r.expectCrop}`);
        check('double-click zooms to 100% on the clicked spot', r.dblZoom && r.dblDrift < 2, `drift ${r.dblDrift}px ${r.dblState}`);
        check('double-click again zooms back to fit', r.dblFit);
        check('wheel zoom keeps the spot under the pointer', r.wheelZoomed && r.wheelDrift < 2, `drift ${r.wheelDrift}px`);
        check('zoom goes up to 3200% of the photo\'s pixels, and no further', r.maxPct === 3200 && r.readout === '3200%', `${r.maxPct}% / ${r.readout}`);
        check('past 100% pixels are sharp squares (no smoothing); smoothed when shrunk', r.pixelatedAtMax && r.sharpAt150 && r.smoothAt80);
        check('0 zooms back to fit', r.keyFit);
        check('preview suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7f. Duplicate finder & culling ----
    console.log('duplicates');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            // Deterministic "photo": random blocks from a seed
            const scene = async (seed, w, h, { brighten = 0, rotate = false } = {}) => {
                const c = document.createElement('canvas');
                c.width = rotate ? h : w; c.height = rotate ? w : h;
                const g = c.getContext('2d');
                if (rotate) { g.translate(h, 0); g.rotate(Math.PI / 2); }
                let x = seed;
                const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
                g.fillStyle = `hsl(${seed * 50 % 360},40%,${30 + brighten}%)`;
                g.fillRect(0, 0, w, h);
                for (let i = 0; i < 14; i++) {
                    g.fillStyle = `hsl(${rnd() * 360},60%,${20 + rnd() * 50 + brighten}%)`;
                    g.fillRect(rnd() * w, rnd() * h, w * (0.1 + rnd() * 0.4), h * (0.1 + rnd() * 0.4));
                }
                return new Uint8Array(await (await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9))).arrayBuffer());
            };
            const dir = makeDir('Order 88');
            const add = (name, bytes) => { const h = makeHandle(name, bytes, 'image/jpeg'); dir._files.set(name, h); };
            const a = await scene(7, 600, 400);
            add('a.jpg', a);
            add('a_copy.jpg', a.slice());
            add('a_rescan.jpg', await scene(7, 900, 600, { brighten: 6, rotate: true }));
            add('b.jpg', await scene(21, 600, 400));
            add('c.jpg', await scene(42, 600, 400));
            dir.values = async function* () { yield* dir._files.values(); };
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();

            const press = (key, mods = {}) =>
                window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
            press('d');
            for (let i = 0; i < 200 && !(Dupes.groups && Dupes.groups.length && document.querySelector('.dupe-card')); i++) {
                await new Promise(res => setTimeout(res, 25));
            }
            out.open = Dupes.isOpen;
            out.groups = Dupes.groups.map(g => g.files.map(f => f.name).sort().join('+'));
            const g = Dupes.groups[0];
            out.best = g && g.best.name;
            out.exact = g && [...g.exact].map(f => f.name).sort().join('+');
            out.cards = document.querySelectorAll('.dupe-card').length;

            // Similarity is rotation-invariant; unrelated photos don't match
            const fa = app.files.find(f => f.name === 'a.jpg')._fp;
            const fr = app.files.find(f => f.name === 'a_rescan.jpg')._fp;
            const fb = app.files.find(f => f.name === 'b.jpg')._fp;
            out.simRescan = Dupes.similarity(fa, fr).map(v => v.toFixed(2)).join('/');
            out.simOther = Dupes.similarity(fa, fb).map(v => v.toFixed(2)).join('/');
            out.rescanMatches = Dupes.isMatch(fa, fr, Dupes.SENSITIVITY.normal);
            out.otherRejected = !Dupes.isMatch(fa, fb, Dupes.SENSITIVITY.loose);

            // Cull: keep suggested (K), trash the rest (Enter)
            press('k');
            out.marked = g.marked.size;
            press('Enter');
            for (let i = 0; i < 100 && app.files.length !== 3; i++) await new Promise(res => setTimeout(res, 20));
            out.left = app.files.map(f => f.name).sort().join(',');
            out.doneMessage = document.getElementById('dupes-stage').textContent;
            press('Escape');
            out.closed = !Dupes.isOpen;
            await app.undo();
            out.restored = app.files.length === 5;
            return out;
        });
        check('D opens the duplicate finder', r.open);
        check('finds one group: copy + rotated re-scan', JSON.stringify(r.groups) === '["a.jpg+a_copy.jpg+a_rescan.jpg"]', JSON.stringify(r.groups));
        console.log(`  info  similarity (layout/detail): re-scan ${r.simRescan}, unrelated ${r.simOther}`);
        check('rotation-invariant match (re-scan matches, other photo does not)', r.rescanMatches && r.otherRejected, `${r.simRescan} / ${r.simOther}`);
        check('suggests the highest-resolution copy', r.best === 'a_rescan.jpg', String(r.best));
        check('exact copies flagged', r.exact === 'a.jpg+a_copy.jpg', String(r.exact));
        check('side-by-side cards rendered', r.cards === 3, String(r.cards));
        check('K marks all but the suggested keeper', r.marked === 2, String(r.marked));
        check('Enter trashes marked photos', r.left === 'a_rescan.jpg,b.jpg,c.jpg', r.left);
        check('finished state reported', /All done/.test(r.doneMessage), r.doneMessage);
        check('Esc closes; Ctrl+Z restores the trashed duplicates', r.closed && r.restored);
        check('duplicates suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7g. Duplicates: scanner beds, tilt, no chaining ----
    console.log('duplicates: scan-order cases');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            Dupes.init(app);
            // A "photo": deterministic blocks from a seed
            const photo = (seed) => {
                const c = document.createElement('canvas');
                c.width = 600; c.height = 400;
                const g = c.getContext('2d');
                let x = seed;
                const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
                g.fillStyle = `hsl(${seed * 50 % 360},40%,35%)`;
                g.fillRect(0, 0, 600, 400);
                for (let i = 0; i < 18; i++) {
                    g.fillStyle = `hsl(${rnd() * 360},60%,${20 + rnd() * 50}%)`;
                    g.fillRect(rnd() * 600, rnd() * 400, 60 + rnd() * 200, 40 + rnd() * 150);
                }
                return c;
            };
            // Scan it: a small print on a big white bed, tilted, optionally turned
            const scan = (src, { tilt = 0, quarter = 0, margin = 0.25 } = {}) => {
                const W = 1200, H = 900;
                const c = document.createElement('canvas');
                c.width = quarter % 2 ? H : W; c.height = quarter % 2 ? W : H;
                const g = c.getContext('2d');
                g.fillStyle = '#f4f2ee';
                g.fillRect(0, 0, c.width, c.height);
                g.translate(c.width / 2, c.height / 2);
                g.rotate(quarter * Math.PI / 2 + tilt * Math.PI / 180);
                const pw = W * (1 - 2 * margin), ph = H * (1 - 2 * margin);
                g.drawImage(src, -pw / 2, -ph / 2, pw, ph);
                return Dupes.fingerprintFromCanvas(c);
            };
            const A = photo(3), B = photo(11), C = photo(29);
            const a1 = scan(A, { tilt: -1.5 });
            const a2 = scan(A, { tilt: 3, quarter: 1, margin: 0.2 }); // re-scan: turned, placed differently
            const b1 = scan(B, { tilt: 1 });
            const c1 = scan(C, { tilt: -2 });
            const sens = Dupes.SENSITIVITY.normal;
            out.rescan = Dupes.isMatch(a1, a2, sens);
            out.bedsIgnored = !Dupes.isMatch(a1, b1, sens) && !Dupes.isMatch(b1, c1, sens) && !Dupes.isMatch(a1, c1, Dupes.SENSITIVITY.loose);
            out.sims = [Dupes.similarity(a1, a2), Dupes.similarity(a1, b1)].map(p => p.map(v => v.toFixed(2)).join('/')).join(' vs ');

            // A featureless frame never near-matches
            const blank = document.createElement('canvas');
            blank.width = 600; blank.height = 400;
            const bg = blank.getContext('2d');
            bg.fillStyle = '#777'; bg.fillRect(0, 0, 600, 400);
            out.weak = Dupes.fingerprintFromCanvas(blank).weak;

            // No chaining: x~y and y~z but not x~z must not become one group
            const files = ['x.jpg', 'y.jpg', 'z.jpg'].map(n => makeFakeFile(n, [1], 'image/jpeg', 1 + n.charCodeAt(0)));
            const saved = { fp: Dupes.fingerprint, match: Dupes.isMatch };
            Dupes.fingerprint = async (f) => ({ name: f.name });
            const rel = new Set(['x.jpg|y.jpg', 'y.jpg|z.jpg']);
            Dupes.isMatch = (p, q) => rel.has(p.name + '|' + q.name) || rel.has(q.name + '|' + p.name);
            const groups = await Dupes.findGroups(files, sens);
            Dupes.fingerprint = saved.fp;
            Dupes.isMatch = saved.match;
            out.noChain = groups.length === 1 && groups[0].files.length === 2;
            return out;
        });
        console.log(`  info  bed scans (layout/detail): re-scan ${r.sims}`);
        check('re-scan turned and re-placed on the bed still matches', r.rescan);
        check('unrelated prints on a white bed do not match', r.bedsIgnored);
        check('featureless frames are flagged weak', r.weak);
        check('look-alikes cannot chain unrelated photos into one group', r.noChain);
        check('scan-order duplicates: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7h. Rotating a photo shown from its original file (real disk files) ----
    console.log('rotate while showing the original file');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            // Real files in the browser's private file system: a File from
            // getFile() stops being readable once the file is written, like on disk
            const root = await navigator.storage.getDirectory();
            try { await root.removeEntry('snap', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await root.getDirectoryHandle('snap', { create: true });
            for (const [name, color] of [['a.jpg', '#c33'], ['b.jpg', '#36c'], ['c.jpg', '#3a3']]) {
                const fh = await dir.getFileHandle(name, { create: true });
                const w = await fh.createWritable();
                await w.write(new Blob([await makeRealJpeg(1800, 1200, { color })], { type: 'image/jpeg' }));
                await w.close();
            }
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            // Rotate straight away, while the photo may still be loading
            app.rotateCurrent(90);
            app.rotateCurrent(90);
            const a = app.files[0];
            while (a._rotationQueue) await a._rotationQueue;
            await new Promise(res => setTimeout(res, 300));
            const ok = () => {
                const img = document.getElementById('current-image');
                return img.complete && img.naturalWidth > 0;
            };
            out.afterRotate = ok();
            // Away and back: the photo is loaded again from the changed file
            app.navigate(1);
            await new Promise(res => setTimeout(res, 300));
            app.navigate(1);
            await new Promise(res => setTimeout(res, 300));
            app.openSingle(a);
            for (let i = 0; i < 100 && !(app._displayFile === a && app._displayKind === 'full'); i++) await new Promise(res => setTimeout(res, 20));
            out.afterReturn = ok() && app._displayFile === a;
            out.noBroken = ![...document.querySelectorAll('img')].some(i => i.src.startsWith('blob:') && i.complete && i.naturalWidth === 0);
            return out;
        });
        check('photo stays visible when rotated while loading', r.afterRotate);
        check('rotated photo loads again after navigating away and back', r.afterReturn);
        check('no broken images anywhere', r.noBroken);
        check('snapshot suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7i. Batch rename ----
    console.log('batch rename');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            document.getElementById('main-interface').classList.remove('hidden');
            const root = makeDir('Order');
            const move = (h) => async function (n) {
                if (h._failOn === n) throw new Error('locked');
                root._files.delete(this.name);
                this.name = n;
                root._files.set(n, this);
            };
            const add = (name, taken) => {
                const f = makeFakeFile(name, makeJpegBytes(), 'image/jpeg');
                f.parentDir = root;
                f.handle.name = name;
                f.handle.move = move(f.handle);
                f.dateTaken = taken;
                root._files.set(name, f.handle);
                return f;
            };
            const files = [add('IMG_0003.jpg', 300), add('IMG_0001.jpg', 100), add('IMG_0002.jpg', 200)];
            app.dirHandle = root;
            app.files = [...files];
            app.sortMode = 'name_asc';
            app.sortFiles(false);
            const names = () => app.files.map(f => f.name).sort().join(',');
            const set = (id, v) => { document.getElementById(id).value = v; };
            const run = async (opts) => {
                Renamer.open(app, opts.files || []);
                Renamer.mode = opts.mode || 'new';
                Renamer.syncMode();
                for (const [k, v] of Object.entries(opts.fields || {})) set(k, v);
                document.getElementById('rename-case').checked = !!opts.matchCase;
                await Renamer.refresh();
                return Renamer.rows;
            };

            // New names numbered by date taken, zero-padded
            let rows = await run({ fields: { 'rename-pattern': 'Smith_{###}', 'rename-order': 'taken', 'rename-dir': 'asc', 'rename-start': 1, 'rename-step': 1 } });
            out.preview = rows.map(x => x.oldName + '>' + x.newName).join(' ');
            out.previewShown = document.querySelectorAll('.rename-row').length === 3;
            await Renamer.apply();
            out.renamed = names();
            out.closed = !Renamer.isOpen;

            // Shift the whole sequence by one (new names overlap old ones)
            await run({ fields: { 'rename-pattern': 'Smith_{###}', 'rename-order': 'name', 'rename-start': 2 } });
            await Renamer.apply();
            out.shifted = names();
            out.noTempLeft = ![...root._files.keys()].some(n => n.startsWith('.jeditor'));

            // Undo puts the whole batch back
            await app.undo();
            out.undone = names();

            // Find & replace on the existing names, with a number token
            await run({ mode: 'replace', fields: { 'rename-find': 'smith_', 'rename-replace': 'Order88-', 'rename-order': 'name', 'rename-start': 1 } });
            out.replaceNoCase = Renamer.rows.map(x => x.newName).join(',');
            await run({ mode: 'replace', matchCase: true, fields: { 'rename-find': 'smith_', 'rename-replace': 'X' } });
            out.replaceCaseNoMatch = Renamer.rows.every(x => x.newName === x.oldName);

            // {date} token
            files[0].dateTaken = new Date(2024, 4, 9, 14, 5, 6).getTime();
            rows = await run({ files: [files[0]], fields: { 'rename-pattern': '{date}_{time}' } });
            out.dateToken = rows[0].newName;

            // Problems block the rename: duplicates, invalid, clash with another photo
            rows = await run({ fields: { 'rename-pattern': 'same' } });
            out.dupBlocked = rows.every(x => /Same name/.test(x.error)) && document.getElementById('rename-apply').disabled &&
                /add \{###\}/.test(document.getElementById('rename-summary').textContent);
            rows = await run({ fields: { 'rename-pattern': 'bad:name_{#}' } });
            out.invalidBlocked = rows.every(x => x.error) && document.getElementById('rename-apply').disabled;
            const other = app.files.find(f => f.name === 'Smith_002.jpg');
            rows = await run({ files: [app.files.find(f => f.name === 'Smith_001.jpg')], fields: { 'rename-pattern': 'smith_002' } });
            out.clashBlocked = /already has this name/.test(rows[0].error || '') && !!other;
            Renamer.close();

            // Case-only rename works (two passes)
            const one = app.files.find(f => f.name === 'Smith_001.jpg');
            out.caseOnly = await app.renameMany([{ file: one, newName: 'SMITH_001.jpg' }]) && one.name === 'SMITH_001.jpg';

            // A failure part-way puts every name back
            const before = names();
            const victim = app.files.find(f => f.name === 'Smith_003.jpg');
            victim.handle._failOn = 'Z_3.jpg';
            const ok = await app.renameMany(app.files.map((f, i) => ({ file: f, newName: `Z_${i + 1}.jpg` })).sort((a, b) => a.newName.localeCompare(b.newName)));
            out.rollback = ok === false && names() === before && ![...root._files.keys()].some(n => n.startsWith('.jeditor'));
            return out;
        });
        check('preview numbers by date taken, zero-padded', r.preview === 'IMG_0001.jpg>Smith_001.jpg IMG_0002.jpg>Smith_002.jpg IMG_0003.jpg>Smith_003.jpg' && r.previewShown, r.preview);
        check('rename applies and closes', r.renamed === 'Smith_001.jpg,Smith_002.jpg,Smith_003.jpg' && r.closed, r.renamed);
        check('shifting a sequence onto its own names works', r.shifted === 'Smith_002.jpg,Smith_003.jpg,Smith_004.jpg' && r.noTempLeft, r.shifted);
        check('undo restores the whole batch', r.undone === 'Smith_001.jpg,Smith_002.jpg,Smith_003.jpg', r.undone);
        check('find & replace (case-insensitive by default)', r.replaceNoCase === 'Order88-001.jpg,Order88-002.jpg,Order88-003.jpg', r.replaceNoCase);
        check('match case respected', r.replaceCaseNoMatch);
        check('{date}_{time} from capture date', r.dateToken === '2024-05-09_14-05-06.jpg', r.dateToken);
        check('duplicate names blocked with a hint', r.dupBlocked);
        check('invalid characters blocked', r.invalidBlocked);
        check('clash with another photo blocked', r.clashBlocked);
        check('case-only rename', r.caseOnly);
        check('failure part-way puts names back', r.rollback);
        check('rename suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7j. The .jeditor folder: trash, shared thumbnail + duplicate cache, clean up ----
    console.log('.jeditor folder cache');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const openFolder = () => page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle('cacheorder', { create: true });
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            while (app.files.some(f => !f.thumbnailUrl)) await new Promise(res => setTimeout(res, 50));
            await FolderCache.flush();
        });
        // First computer: make a folder of photos big enough to get cached thumbnails
        await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            try { await root.removeEntry('cacheorder', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await root.getDirectoryHandle('cacheorder', { create: true });
            for (let i = 0; i < 4; i++) {
                const c = document.createElement('canvas');
                c.width = 900; c.height = 600;
                const g = c.getContext('2d');
                const noise = g.createImageData(900, 600);
                for (let k = 0; k < noise.data.length; k++) noise.data[k] = (Math.random() * 255) | 0;
                g.putImageData(noise, 0, 0);
                g.fillStyle = `hsl(${i * 90},70%,50%)`;
                g.fillRect(100 + i * 50, 100, 400, 300);
                const fh = await dir.getFileHandle(`p${i}.jpg`, { create: true });
                const w = await fh.createWritable();
                await w.write(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)));
                await w.close();
            }
        });
        await openFolder();
        const first = await page.evaluate(async () => {
            const out = {};
            const dir = await window.showDirectoryPicker();
            const thumbs = await (await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('cache')).getDirectoryHandle('thumbs');
            let n = 0;
            for await (const e of thumbs.values()) n++;
            out.thumbsSaved = n;
            out.photosScanned = app.files.length; // .jeditor itself isn't scanned
            // Duplicate scan saves fingerprints with the folder
            app.openDupes();
            while (!(Dupes.groups && document.querySelector('.dupe-card, .dupes-message')) || app._tasks.has('dupes')) await new Promise(r => setTimeout(r, 50));
            Dupes.close();
            await new Promise(r => setTimeout(r, 200));
            const fpFile = await (await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('cache')).getFileHandle('fingerprints.json');
            out.fingerprintsSaved = Object.keys(JSON.parse(await (await fpFile.getFile()).text()).entries).length;
            return out;
        });

        // "Another computer": no browser cache, same folder
        await page.evaluate(() => new Promise(res => { const r = indexedDB.deleteDatabase('jeditor'); r.onsuccess = r.onerror = r.onblocked = res; }));
        await page.reload({ waitUntil: 'networkidle' });
        await page.evaluate(PAGE_HELPERS);
        await page.evaluate(() => {
            window._generated = 0;
            const gen = app.generateThumbnailBlob.bind(app);
            app.generateThumbnailBlob = (d) => { window._generated++; return gen(d); };
            window._fpComputed = 0;
            const fp = Dupes.fingerprintFromCanvas.bind(Dupes);
            Dupes.fingerprintFromCanvas = (c) => { window._fpComputed++; return fp(c); };
        });
        await openFolder();
        const second = await page.evaluate(async () => {
            const out = { thumbsGenerated: window._generated };
            app.openDupes();
            while (!(Dupes.groups && document.querySelector('.dupe-card, .dupes-message')) || app._tasks.has('dupes')) await new Promise(r => setTimeout(r, 50));
            Dupes.close();
            out.fingerprintsComputed = window._fpComputed;

            // Delete goes to .jeditor/trash; undo brings it back
            const dir = await window.showDirectoryPicker();
            await app.moveToTrash([app.files[0]]);
            const trash = await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('trash');
            let inTrash = 0;
            for await (const e of trash.values()) inTrash++;
            out.trashed = inTrash === 1 && app.files.length === 3;
            await app.undo();
            out.restored = app.files.length === 4;
            // In the grid the next photo is selected, so Delete goes on from there
            app.setView('grid');
            const [, b, c] = app.viewFiles();
            app.currentFile = b; app.selection = new Set([b]); app.updateSelectionUI();
            await app.moveToTrash([b]);
            out.nextSelected = app.selection.size === 1 && app.selection.has(c) && app.currentFile === c
                && !document.getElementById('selection-bar').classList.contains('hidden');
            await app.undo();
            app.selection = new Set(); app.updateSelectionUI();
            out.restored = out.restored && app.files.length === 4;

            // A batch: moved into the trash (no bytes rewritten), several at a
            // time; a name already in the trash gets a unique one
            const sizes = new Map(app.files.map(f => [f.name, f.size]));
            const parked = await trash.getFileHandle(app.files[1].name, { create: true }); // same name already in the trash
            const pw = await parked.createWritable(); await pw.write('old'); await pw.close();
            let writes = 0;
            const cw = FileSystemFileHandle.prototype.createWritable;
            FileSystemFileHandle.prototype.createWritable = function (...a) { writes++; return cw.apply(this, a); };
            app.currentFile = app.files[1];
            const batch = app.files.slice(0, 3);
            await app.moveToTrash(batch);
            FileSystemFileHandle.prototype.createWritable = cw;
            const trashNames = [];
            for await (const e of trash.values()) trashNames.push(e.name);
            const leftOnDisk = [];
            for await (const e of dir.values()) if (e.kind === 'file') leftOnDisk.push(e.name);
            out.batchMoved = writes === 0 && trashNames.length === 4 && leftOnDisk.length === 1 && app.files.length === 1;
            out.batchCurrent = app.currentFile === app.files[0];
            await app.undo();
            const back = [];
            for await (const e of dir.values()) if (e.kind === 'file') back.push(e.name);
            const intact = await Promise.all(app.files.map(async f => (await f.handle.getFile()).size === sizes.get(f.name)));
            out.batchRestored = app.files.length === 4 && back.length === 4 && intact.every(Boolean);
            await trash.removeEntry(parked.name);

            // A rotated photo's thumbnail is kept under its new version;
            // the old one is pruned
            const rf = app.files[0];
            const keyOf = (d) => `${rf.relPath || rf.name}|${d.size}|${d.lastModified}`;
            const oldKey = keyOf(await rf.handle.getFile());
            await app.rotateImage(rf, 90);
            while (rf._cacheFrom || rf._carryPromise) await new Promise(r => setTimeout(r, 20));
            const newKey = keyOf(await rf.handle.getFile());
            await FolderCache.flush();
            app.pruneFolderCache();
            await new Promise(r => setTimeout(r, 400));
            const thumbs = await (await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('cache')).getDirectoryHandle('thumbs');
            const names = [];
            for await (const e of thumbs.values()) names.push(e.name);
            out.prunedTo = names.length;
            out.prunedOld = !names.includes(FolderCache.hash(oldKey) + '.img') && names.includes(FolderCache.hash(newKey) + '.img');

            // Clean up removes .jeditor entirely (after confirming)
            await app.moveToTrash([app.files[1]]);
            UI.confirm = async () => true;
            await app.cleanUpFolder();
            let gone = false;
            try { await dir.getDirectoryHandle('.jeditor'); } catch (e) { gone = true; }
            out.cleanedUp = gone && !(app._undoStack || []).some(e => e.type === 'trash') && app.files.length === 3;

            // Setting off: nothing is written to the folder
            app.uiPrefs.folderCache = false;
            app.files.forEach(f => { delete f.thumbnailUrl; });
            FolderCache.putThumb(app, 'x|1|1', new Blob(['x']));
            await FolderCache.flush();
            let created = true;
            try { await dir.getDirectoryHandle('.jeditor'); } catch (e) { created = false; }
            out.offWritesNothing = !created;
            app.uiPrefs.folderCache = true;
            return out;
        });
        check('.jeditor caches a thumbnail per photo', first.thumbsSaved === 4 && first.photosScanned === 4, JSON.stringify(first));
        check('duplicate fingerprints saved with the folder', first.fingerprintsSaved === 4, String(first.fingerprintsSaved));
        check('another computer: thumbnails come from the folder', second.thumbsGenerated === 0, String(second.thumbsGenerated));
        check('another computer: duplicate scan reuses fingerprints', second.fingerprintsComputed === 0, String(second.fingerprintsComputed));
        check('delete goes to .jeditor/trash; undo restores', second.trashed && second.restored);
        check('deleting the selection in the grid selects the next photo', second.nextSelected);
        check('batch delete moves files (no copying), keeps a unique trash name', second.batchMoved && second.batchCurrent);
        check('undo restores the whole batch intact', second.batchRestored);
        check('rotated photo: old cached thumbnail pruned, new one kept', second.prunedTo === 4 && second.prunedOld, String(second.prunedTo));
        check('clean up removes .jeditor and its undo steps', second.cleanedUp);
        check('cache setting off writes nothing', second.offWritesNothing);
        check('folder cache suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7k. Rotations keep the caches: reopening doesn't remake thumbnails/previews ----
    console.log('caches kept through rotations');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const root = await navigator.storage.getDirectory();
            try { await root.removeEntry('carryorder', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await root.getDirectoryHandle('carryorder', { create: true });
            const edge = app.previewEdge();
            // Noise keeps the files big enough to be cached; a different
            // block per photo makes orientation mistakes visible
            const sizes = [[Math.round(edge * 1.5), edge], [900, 600], [900, 600]];
            for (let i = 0; i < sizes.length; i++) {
                const [w, h] = sizes[i];
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                const g = c.getContext('2d');
                const noise = g.createImageData(w, h);
                for (let k = 0; k < noise.data.length; k++) noise.data[k] = (Math.random() * 120) | 0;
                g.putImageData(noise, 0, 0);
                g.fillStyle = `hsl(${i * 120},90%,60%)`;
                g.fillRect(0, 0, w * 0.4, h * 0.3);
                const fh = await dir.getFileHandle(`r${i}.jpg`, { create: true });
                const wr = await fh.createWritable();
                await wr.write(await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9)));
                await wr.close();
            }
            window.showDirectoryPicker = async () => dir;
            const open = async () => {
                await app.browseFolder();
                while (app.files.some(f => !f.thumbnailUrl)) await new Promise(res => setTimeout(res, 50));
            };
            const settled = async () => {
                await new Promise(res => setTimeout(res, 50));
                while (app.files.some(f => f.isBusy || f.pendingRotation || f.savingRotation || f._cacheFrom || f._carryPromise)) {
                    await new Promise(res => setTimeout(res, 50));
                }
            };
            await open();
            await app.getDisplaySource(app.files[0]); // its preview is cached
            // Rotate all right, then the others again (stacked): 90, 270, 0
            app.setView('grid');
            app.selection = new Set(app.files);
            app.rotateBulk(90);
            app.selection = new Set(app.files.slice(1));
            app.rotateBulk(180);
            app.rotateImage(app.files[2], 90);
            await settled();

            // Reopen ("check the results"): nothing is made again
            let made = 0;
            const genThumb = app.generateThumbnailBlob.bind(app), genPreview = app.generatePreview.bind(app);
            app.generateThumbnailBlob = (...a) => { made++; return genThumb(...a); };
            app.generatePreview = (...a) => { made++; return genPreview(...a); };
            await open();
            const src = await app.getDisplaySource(app.files[0]);
            out.madeAgain = made;
            app.generateThumbnailBlob = genThumb;
            app.generatePreview = genPreview;

            // ...and what's cached matches a fresh one from the rotated file
            const px = async (blob) => {
                const b = await createImageBitmap(blob);
                const c = new OffscreenCanvas(12, 12);
                c.getContext('2d').drawImage(b, 0, 0, 12, 12);
                const res = { w: b.width, h: b.height, d: c.getContext('2d').getImageData(0, 0, 12, 12).data };
                b.close();
                return res;
            };
            const same = (a, b) => {
                let s = 0;
                for (let i = 0; i < a.d.length; i += 4) s += Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]);
                // Same way round, same picture (a turned thumbnail keeps its
                // short side, a new one is made 320 wide: sizes differ)
                return (a.w > a.h) === (b.w > b.h) && Math.abs(a.w / a.h - b.w / b.h) < 0.02 && s / (a.d.length / 4) / 3 < 8;
            };
            out.thumbs = [];
            for (const f of app.files) {
                const data = await f.handle.getFile();
                out.thumbs.push(same(await px(await (await fetch(f.thumbnailUrl)).blob()), await px(await genThumb(data))) && !f.thumbLag);
            }
            const fresh = await genPreview(await app.files[0].handle.getFile(), edge);
            out.preview = src.isPreview && same(await px(src.blob), await px(fresh.blob)) && src.w === fresh.w && src.h === fresh.h;
            out.portrait = src.w < src.h;

            // A change that isn't a rotation (crop, undo of a re-encode)
            // carries nothing over
            const f = app.files[1];
            const before = await f.handle.getFile();
            f._cacheFrom = { size: before.size, lastModified: before.lastModified, saved: f._savedRotationTotal || 0 };
            const wr = await f.handle.createWritable();
            await wr.write(await (await fetch(app.files[2].thumbnailUrl)).blob());
            await wr.close();
            await app.carryCache(f);
            const after = await f.handle.getFile();
            out.noCarryOnOtherWrites = !(await app.idbGetThumb(`${f.relPath || f.name}|${after.size}|${after.lastModified}`)) && f._cacheFrom === null;
            f._cacheFrom = { size: 1, lastModified: 1, saved: 0 };
            await app.afterFileChanged(f);
            out.resetOnChange = f._cacheFrom === null;
            return out;
        });
        check('reopening after rotating makes no thumbnails or previews again', r.madeAgain === 0, String(r.madeAgain));
        check('kept thumbnails match the rotated photos (90°, 270°, 0°)', r.thumbs.every(Boolean), JSON.stringify(r.thumbs));
        check('kept preview matches the rotated photo, original size swapped', r.preview && r.portrait);
        check('a change that isn\'t a rotation keeps nothing', r.noCarryOnOtherWrites && r.resetOnChange);
        check('rotation cache suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7l. Big JPEGs decode at a fraction of their size: same result ----
    console.log('fast decoding of big JPEGs');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const edge = app.previewEdge();
            const W = Math.round(edge * 2.5), H = Math.round(edge * 1.7);
            const c = new OffscreenCanvas(W, H);
            const g = c.getContext('2d');
            g.fillStyle = '#2050c0'; g.fillRect(0, 0, W, H);
            g.fillStyle = '#e03020'; g.fillRect(0, 0, W * 0.3, H * 0.3);  // top-left marker
            g.fillStyle = '#30c040'; g.fillRect(W * 0.7, H * 0.7, W * 0.3, H * 0.3);
            const base = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
            const px = async (blob, w) => {
                const b = await createImageBitmap(blob);
                const h = Math.round(w * b.height / b.width);
                const cv = new OffscreenCanvas(w, h);
                const cg = cv.getContext('2d', { willReadFrequently: true });
                cg.drawImage(b, 0, 0, w, h);
                const res = { w: b.width, h: b.height, d: cg.getImageData(0, 0, w, h).data };
                b.close();
                return res;
            };
            const close = (a, b) => {
                if (a.d.length !== b.d.length) return false;
                let s = 0;
                for (let i = 0; i < a.d.length; i += 4) s += Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]);
                return s / (a.d.length / 4) / 3 < 6;
            };
            const out = [];
            for (const deg of [0, 90, 180, 270]) {
                const blob = deg ? app.rotateJpegLossless(await base.arrayBuffer(), deg) : base;
                const file = new File([blob], `t${deg}.jpg`, { type: 'image/jpeg' });
                const ref = await createImageBitmap(file); // full decode, orientation applied
                const refC = new OffscreenCanvas(ref.width, ref.height);
                refC.getContext('2d').drawImage(ref, 0, 0);
                const refBlob = await refC.convertToBlob({ type: 'image/png' });
                const [rw, rh] = [ref.width, ref.height];
                ref.close();
                const thumb = await px(await app.generateThumbnailBlob(file), 32);
                const prev = await app.generatePreview(file, edge);
                const p = await px(prev.blob, 32);
                const want = await px(refBlob, 32);
                out.push({
                    deg,
                    thumb: thumb.w === app.THUMB_WIDTH && Math.abs(thumb.h - app.THUMB_WIDTH * rh / rw) <= 1 && close(thumb, want),
                    preview: prev.w === rw && prev.h === rh && Math.max(p.w, p.h) === edge && close(p, want)
                });
            }
            return out;
        });
        check('big JPEG thumbnails: right way round, size and picture (0/90/180/270°)', r.every(x => x.thumb), JSON.stringify(r));
        check('big JPEG previews: right way round, size and picture, original size reported', r.every(x => x.preview), JSON.stringify(r));
        check('fast decoding suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7m. Folders: navigate, move, copy, collate ----
    console.log('folders');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        await page.setViewportSize({ width: 1300, height: 800 });
        const r = await page.evaluate(async () => {
            const out = {};
            // Real files in the browser's private file system, where photos
            // move with FileSystemHandle.move() as they do on disk
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('collate', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('collate', { create: true });
            const put = async (d, name, color) => {
                const fh = await d.getFileHandle(name, { create: true });
                const w = await fh.createWritable();
                await w.write(new Blob([await makeRealJpeg(300, 200, { color })], { type: 'image/jpeg' }));
                await w.close();
            };
            for (const [n, c] of [['a.jpg', '#c33'], ['b.jpg', '#3c3'], ['c.jpg', '#33c'], ['d.jpg', '#cc3']]) await put(dir, n, c);
            const wed = await dir.getDirectoryHandle('Wedding', { create: true });
            await put(wed, 'b.jpg', '#888');
            await put(wed, 'w1.jpg', '#c3c');
            const cer = await wed.getDirectoryHandle('Ceremony', { create: true });
            await put(cer, 'c1.jpg', '#3cc');
            await wed.getDirectoryHandle('Reception', { create: true }); // empty
            // Everything on disk, outside jEditor's own folder
            const disk = async (d = dir, p = '') => {
                const names = [];
                for await (const e of d.values()) {
                    if (e.kind === 'directory') {
                        if (e.name === '.jeditor') continue;
                        names.push(p + e.name + '/');
                        names.push(...await disk(e, p + e.name + '/'));
                    } else names.push(p + e.name);
                }
                return names.sort();
            };
            const f = (rel) => app.files.find(x => x.relPath === rel);
            const tiles = () => [...document.querySelectorAll('#grid-view .grid-item')].map(t => t._file.relPath).join(',');
            window.showDirectoryPicker = async () => dir;
            try { localStorage.removeItem('jeditor.ui'); } catch (e) { /* private */ }
            app.loadUiPrefs();
            await app.browseFolder();
            app.setView('grid');

            // Every folder is known, empty ones too; All photos is the start
            out.folders = Folders.ordered().join('|');
            out.allFirst = Folders.scope === null && app.viewFiles().length === 7 && document.querySelectorAll('#grid-view .grid-item').length === 7;
            out.railShown = !document.getElementById('folder-rail').classList.contains('hidden') &&
                !document.getElementById('folder-bar').classList.contains('hidden');
            out.chips = [...document.querySelectorAll('#grid-view .grid-item')].filter(t => t.querySelector('.tile-folder'))
                .map(t => t.querySelector('.tile-folder').textContent).sort().join(',');
            out.railRows = [...document.querySelectorAll('#folder-tree .fr-row')].map(r => r.querySelector('.fr-name').textContent + ':' + r.querySelector('.fr-count').textContent).join('|');

            // One folder at a time: its photos, its subfolders as tiles
            Folders.setScope('Wedding');
            out.wedTiles = tiles();
            out.wedFolders = [...document.querySelectorAll('#grid-view .folder-tile')].map(t => t.dataset.folderPath).join(',');
            out.crumbs = [...document.querySelectorAll('#fb-crumbs .fb-crumb')].map(b => b.textContent).join('>');
            app.goTo(f('Wedding/w1.jpg'));
            app.navigate(1); // wraps inside the folder
            out.wraps = app.currentFile.relPath === 'Wedding/b.jpg' && document.getElementById('file-count').textContent === '1 / 2';
            app.setView('single');
            out.strip = document.querySelectorAll('#thumbnail-strip .thumb-item').length;
            app.navigate(1);
            out.singleStays = app.currentFile.relPath === 'Wedding/w1.jpg';
            app.setView('grid');
            // An empty folder: no photos, single view refused
            Folders.setScope('Wedding/Reception');
            out.emptyGrid = document.getElementById('grid-view').classList.contains('grid-empty') && app.viewFiles().length === 0;
            app.setView('single');
            out.emptyNoSingle = app.viewMode === 'grid';
            // Backspace goes up a folder
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
            out.up = Folders.scope === 'Wedding';

            // Move from the order's own folder into Wedding: on disk, in the app, undoable
            Folders.setScope('');
            app.selection = new Set([f('a.jpg'), f('c.jpg')]);
            app.setCurrent(f('a.jpg'));
            app.updateSelectionUI();
            const a = f('a.jpg');
            let entry = await Folders.relocate([...app.selection], 'Wedding');
            out.moved = (await disk()).join(',');
            out.movedApp = a.relPath === 'Wedding/a.jpg' && (await a.handle.getFile()).size > 0;
            out.leftView = tiles() === 'b.jpg,d.jpg' && app.selection.size === 0 && app.currentFile.relPath === 'b.jpg';
            out.toastUndo = [...document.querySelectorAll('.toast')].some(t => /Moved 2 photos to Wedding/.test(t.textContent) && t.querySelector('.toast-action'));
            await app.undo();
            out.undone = (await disk()).join(',');
            out.undoneApp = a.relPath === 'a.jpg' && tiles() === 'a.jpg,b.jpg,c.jpg,d.jpg';

            // Name clash: asked first. Cancel changes nothing
            let asked = null;
            Folders.askClash = async (q) => { asked = q; return null; };
            entry = await Folders.relocate([f('b.jpg'), f('d.jpg')], 'Wedding');
            out.cancelled = entry === null && asked && asked.file.name === 'b.jpg' && asked.canReplace &&
                f('d.jpg') && (await disk()).includes('d.jpg');
            // Keep both: numbered name
            Folders.askClash = async () => ({ choice: 'keep', all: false });
            await Folders.relocate([f('b.jpg')], 'Wedding');
            out.keepBoth = (await disk()).includes('Wedding/b (2).jpg') && !!f('Wedding/b (2).jpg') && !!f('Wedding/b.jpg');
            await app.undo();
            out.keepBothUndone = (await disk()).includes('b.jpg') && !(await disk()).includes('Wedding/b (2).jpg');
            // Replace: the photo that was there goes to the trash, undo brings both back
            Folders.askClash = async () => ({ choice: 'replace', all: false });
            const old = f('Wedding/b.jpg');
            await Folders.relocate([f('b.jpg')], 'Wedding');
            const trash = await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('trash');
            const inTrash = [];
            for await (const e of trash.values()) inTrash.push(e.name);
            out.replaced = !app.files.includes(old) && inTrash.includes('b.jpg') && !(await disk()).includes('b.jpg') && (await disk()).includes('Wedding/b.jpg');
            await app.undo();
            out.replaceUndone = app.files.includes(old) && old.relPath === 'Wedding/b.jpg' && !!f('b.jpg') && (await disk()).includes('b.jpg');
            delete Folders.askClash; // the real dialog again

            // Copy: both places, undo removes the copy only
            await Folders.relocate([f('d.jpg')], 'Wedding/Ceremony', { copy: true });
            out.copied = (await disk()).includes('d.jpg') && (await disk()).includes('Wedding/Ceremony/d.jpg') && app.files.length === 8;
            await app.undo();
            out.copyUndone = !(await disk()).includes('Wedding/Ceremony/d.jpg') && app.files.length === 7;

            // The picker: M, type a new name, Enter makes the folder and moves
            app.selection = new Set([f('d.jpg')]);
            app.updateSelectionUI();
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
            out.pickerOpen = Folders.isModalOpen();
            const input = document.getElementById('fp-filter');
            input.value = 'Xmas 85';
            input.dispatchEvent(new Event('input'));
            out.pickerCreate = Folders.pickerItems[Folders.pickerHi].kind === 'create';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            for (let i = 0; i < 400 && !f('Xmas 85/d.jpg'); i++) await new Promise(res => setTimeout(res, 20));
            out.pickerMoved = (await disk()).includes('Xmas 85/d.jpg') && !Folders.isModalOpen() && document.activeElement !== input;
            await app.undo(); // one step: the move and the folder made for it
            out.pickerUndone = (await disk()).includes('d.jpg') && !(await disk()).includes('Xmas 85/') && !Folders.map.has('Xmas 85');
            // Bad names are refused
            out.badName = !!Folders.nameProblem('a:b') && !!Folders.nameProblem('.hidden') && !!Folders.nameProblem('con') && !Folders.nameProblem('Xmas 85');
            out.freeName = Folders.freeName('IMG (2).jpg', new Set(['img (2).jpg'])) === 'IMG (3).jpg';

            // Rename a folder with photos and a subfolder in it; undo
            Folders.setScope('Wedding/Ceremony');
            const c1 = f('Wedding/Ceremony/c1.jpg');
            const newPath = await Folders.renameDir('Wedding', 'Bride & Groom');
            app.pushUndo({ type: 'folder-rename', path: newPath, name: 'Wedding' });
            Folders.afterChange();
            out.renamed = (await disk()).includes('Bride & Groom/Ceremony/c1.jpg') && !(await disk()).includes('Wedding/') &&
                c1.relPath === 'Bride & Groom/Ceremony/c1.jpg' && Folders.scope === 'Bride & Groom/Ceremony' &&
                (await c1.handle.getFile()).size > 0;
            await app.undo();
            out.renameUndone = (await disk()).includes('Wedding/Ceremony/c1.jpg') && c1.relPath === 'Wedding/Ceremony/c1.jpg' && Folders.scope === 'Wedding/Ceremony';

            // Delete: only an empty folder, undoable
            await Folders.deleteFolder('Wedding/Reception');
            out.deleted = !(await disk()).includes('Wedding/Reception/') && !Folders.map.has('Wedding/Reception');
            await app.undo();
            out.deleteUndone = (await disk()).includes('Wedding/Reception/') && Folders.map.has('Wedding/Reception');
            await Folders.deleteFolder('Wedding');
            out.notEmptyKept = (await disk()).includes('Wedding/');

            // Moved photos keep their cached thumbnail and preview
            const blob = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
            await app.idbPutThumb('x.jpg|99999|5', blob);
            await app.idbPutPreview(`p|x.jpg|99999|5|${app.previewEdge()}`, { blob, w: 1, h: 1 });
            await Folders.carryCaches({ rel: 'x.jpg', size: 99999, mtime: 5 }, { rel: 'F/x.jpg', size: 99999, mtime: 5 }, true);
            out.cacheCarried = !!(await app.idbGetThumb('F/x.jpg|99999|5')) && !(await app.idbGetThumb('x.jpg|99999|5')) &&
                !!(await app.idbGet('previews', `p|F/x.jpg|99999|5|${app.previewEdge()}`));

            // Hiding the folder list leaves the bar; remembered
            Folders.setScope('');
            Folders.toggleRail();
            out.railHidden = document.getElementById('folder-rail').classList.contains('hidden') &&
                !document.getElementById('folder-bar').classList.contains('hidden') && JSON.parse(localStorage.getItem('jeditor.ui')).folderRail === false;
            Folders.toggleRail();
            // Rename All in a folder renames that folder's photos only
            Folders.setScope('Wedding');
            Renamer.open(app, []);
            out.renameScope = Renamer.scope().map(x => x.relPath).sort().join(',') + '|' + document.getElementById('rename-scope-all-label').textContent;
            Renamer.close();
            Folders.setScope('');
            app.clearSelection();
            out.menu = Folders.contextItems('Wedding/Reception').map(i => i[0]).join('|');
            app.selection = new Set([f('b.jpg'), f('d.jpg')]);
            out.menuSel = Folders.contextItems('Wedding').map(i => i[0]).slice(0, 5).join('|');
            // The path chip (bottom left) is for single view only
            app.setView('single');
            const chipShown = () => !document.getElementById('status-bar').classList.contains('hidden');
            out.chipSingle = chipShown();
            app.setView('grid');
            out.chipGrid = chipShown();
            // Grid rows never overlap, however wide the tiles stretch
            Folders.setScope(null);
            document.documentElement.style.setProperty('--grid-item-size', '130px');
            await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
            const gridTiles = [...document.querySelectorAll('#grid-view .grid-item')];
            const cols = app.getGridColumnCount();
            const r1 = gridTiles[0].getBoundingClientRect(), r2 = gridTiles[cols].getBoundingClientRect();
            out.rowGap = Math.round(r2.top - r1.bottom);
            out.square = Math.abs(r1.width - r1.height) < 1;
            document.documentElement.style.removeProperty('--grid-item-size');
            return out;
        });
        check('folders: every folder found, empty ones too', r.folders === '|Wedding|Wedding/Ceremony|Wedding/Reception', r.folders);
        check('folders: All photos first, with the folder list and bar', r.allFirst && r.railShown);
        check('folders: All photos labels each photo with its folder', r.chips === 'Ceremony,Wedding,Wedding', r.chips);
        check('folders: list shows the tree with photo counts', r.railRows === 'All photos:7|collate:4|Wedding:2|Ceremony:1|Reception:', r.railRows);
        check('folders: a folder shows its own photos and subfolder tiles', r.wedTiles === 'Wedding/b.jpg,Wedding/w1.jpg' && r.wedFolders === 'Wedding/Ceremony,Wedding/Reception', `${r.wedTiles} / ${r.wedFolders}`);
        check('folders: breadcrumb', r.crumbs === 'collate>Wedding', r.crumbs);
        check('folders: arrows stay in the folder (grid and single view)', r.wraps && r.singleStays && r.strip === 2, `strip=${r.strip}`);
        check('folders: empty folder shows a hint and no single view', r.emptyGrid && r.emptyNoSingle);
        check('folders: Backspace goes up a folder', r.up);
        check('folders: move to a folder on disk', r.moved === 'Wedding/,Wedding/Ceremony/,Wedding/Ceremony/c1.jpg,Wedding/Reception/,Wedding/a.jpg,Wedding/b.jpg,Wedding/c.jpg,Wedding/w1.jpg,b.jpg,d.jpg' && r.movedApp, r.moved);
        check('folders: moved photos leave the view, nothing hidden stays selected', r.leftView);
        check('folders: toast offers Undo', r.toastUndo);
        check('folders: undo puts photos back', r.undone === 'Wedding/,Wedding/Ceremony/,Wedding/Ceremony/c1.jpg,Wedding/Reception/,Wedding/b.jpg,Wedding/w1.jpg,a.jpg,b.jpg,c.jpg,d.jpg' && r.undoneApp, r.undone);
        check('folders: name clash is asked first; cancel changes nothing', r.cancelled);
        check('folders: keep both numbers the name; undo', r.keepBoth && r.keepBothUndone);
        check('folders: replace sends the old photo to the trash; undo restores both', r.replaced && r.replaceUndone);
        check('folders: copy to a folder; undo removes only the copy', r.copied && r.copyUndone);
        check('folders: M opens the picker; a new name makes the folder and moves', r.pickerOpen && r.pickerCreate && r.pickerMoved);
        check('folders: one undo removes the move and the new folder', r.pickerUndone);
        check('folders: bad folder names refused; free names numbered', r.badName && r.freeName);
        check('folders: rename a folder (photos and subfolders follow); undo', r.renamed && r.renameUndone);
        check('folders: delete an empty folder; undo; folders with photos are kept', r.deleted && r.deleteUndone && r.notEmptyKept);
        check('folders: moved photos keep their cached thumbnail and preview', r.cacheCarried);
        check('folders: folder list can be hidden (remembered)', r.railHidden);
        check('folders: Rename All in a folder covers that folder only', r.renameScope === 'Wedding/b.jpg,Wedding/w1.jpg|All photos in Wedding (2)', r.renameScope);
        check('folders: folder menu', r.menu === 'Open|Folder info|—|New folder inside…|New blank image…|Rename folder…|—|Delete folder', r.menu);
        check('path chip: shown in single view, hidden in the grid', r.chipSingle && !r.chipGrid, `${r.chipSingle}/${r.chipGrid}`);
        check('folders: grid rows keep their gap (tiles never overlap)', r.rowGap === 16 && r.square, `gap=${r.rowGap}`);
        check('folders: folder menu moves or copies the selection there', r.menuSel === 'Open|Folder info|—|Move 2 photos here|Copy 2 photos here', r.menuSel);

        // Drag photos onto a folder in the list (Ctrl copies), never opening
        // them as a dropped folder
        await page.evaluate(() => {
            Folders.setScope('');
            app.selection = new Set([app.files.find(x => x.relPath === 'a.jpg')]);
            app.updateSelectionUI();
        });
        const tile = page.locator('#grid-view .grid-item').first();
        await tile.dragTo(page.locator('#folder-tree .fr-row[data-folder-path="Wedding/Reception"]'));
        await page.waitForFunction(() => app.files.some(x => x.relPath === 'Wedding/Reception/a.jpg'), null, { timeout: 5000 }).catch(() => { });
        const dragged = await page.evaluate(() => ({
            moved: app.files.some(x => x.relPath === 'Wedding/Reception/a.jpg'),
            kept: app.files.length === 7 && !Folders.dragging && !document.body.classList.contains('drag-over')
        }));
        await page.keyboard.down('Control');
        await page.locator('#grid-view .grid-item').first().dragTo(page.locator('#folder-tree .fr-row[data-folder-path="Wedding/Ceremony"]'));
        await page.keyboard.up('Control');
        await page.waitForFunction(() => app.files.length === 8, null, { timeout: 5000 }).catch(() => { });
        const copied = await page.evaluate(() => app.files.length === 8 && app.files.some(x => x.relPath === 'Wedding/Ceremony/b.jpg') && app.files.some(x => x.relPath === 'b.jpg'));
        check('folders: drag onto a folder moves', dragged.moved && dragged.kept, JSON.stringify(dragged));
        check('folders: Ctrl+drag copies', copied);
        check('folders suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    console.log('folders: any folder, in a browser');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const opfs = await navigator.storage.getDirectory();
            for (const n of ['outweb', 'elsewhere']) try { await opfs.removeEntry(n, { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('outweb', { create: true });
            const away = await opfs.getDirectoryHandle('elsewhere', { create: true });
            const put = async (d, name, color) => {
                const w = await (await d.getFileHandle(name, { create: true })).createWritable();
                await w.write(new Blob([await makeRealJpeg(300, 200, { color })], { type: 'image/jpeg' }));
                await w.close();
            };
            await put(dir, 'a.jpg', '#c33');
            await put(dir, 'b.jpg', '#3c3');
            await put(away, 'a.jpg', '#333'); // taken there: the copy is a (2)
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            const names = async (d) => { const n = []; for await (const k of d.keys()) n.push(k); return n.sort().join(','); };
            const rows = () => [...document.querySelectorAll('#fp-list .fp-row')].map(r => (r.classList.contains('head') ? '#' : '') + r.textContent.trim());
            const f = (n) => app.files.find(x => x.name === n);
            window.showDirectoryPicker = async () => away;
            // Copy: into the folder chosen, under a free name
            Folders.openPicker([f('a.jpg')], 'copy');
            out.rows = rows().join(' | ');
            [...document.querySelectorAll('#fp-list .fp-row')].find(r => /Choose a folder/.test(r.textContent)).click();
            await new Promise(res => { const t = setInterval(async () => { if (/a \(2\)/.test(await names(away))) { clearInterval(t); res(); } }, 50); });
            out.copied = await names(away);
            await app.undo();
            out.uncopied = await names(away);
            // Move: out of the project; Ctrl+Z brings it back
            Folders.openPicker([f('b.jpg')], 'move');
            [...document.querySelectorAll('#fp-list .fp-row')].find(r => /Choose a folder/.test(r.textContent)).click();
            await new Promise(res => { const t = setInterval(() => { if (!f('b.jpg')) { clearInterval(t); res(); } }, 50); });
            out.moved = [await names(away), await names(dir)];
            await app.undo();
            await new Promise(res => { const t = setInterval(() => { if (f('b.jpg')) { clearInterval(t); res(); } }, 50); });
            out.back = [await names(away), (await names(dir)).replace(/,?\.jeditor/, '')];
            return out;
        });
        check('any folder (browser): Move to… offers its own folder picker, under Elsewhere', /#Elsewhere \| .*Choose a folder…/.test(r.rows) && !/Other folders/.test(r.rows), r.rows);
        check('... a copy goes there under a free name; Ctrl+Z removes it', r.copied === 'a (2).jpg,a.jpg' && r.uncopied === 'a.jpg', JSON.stringify([r.copied, r.uncopied]));
        check('... a move takes it out of the project; Ctrl+Z puts it back', r.moved[0] === 'a.jpg,b.jpg' && !/b\.jpg/.test(r.moved[1]) && r.back[0] === 'a.jpg' && /b\.jpg/.test(r.back[1]), JSON.stringify([r.moved, r.back]));
        check('any folder (browser): no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7n. Recent orders on the start screen ----
    console.log('recent orders');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            await Recents.tx('readwrite', s => s.clear());
            const opfs = await navigator.storage.getDirectory();
            const make = async (name) => {
                try { await opfs.removeEntry(name, { recursive: true }); } catch (e) { /* fresh */ }
                const d = await opfs.getDirectoryHandle(name, { create: true });
                const fh = await d.getFileHandle('a.jpg', { create: true });
                const w = await fh.createWritable();
                await w.write(new Blob([await makeRealJpeg(200, 150)], { type: 'image/jpeg' }));
                await w.close();
                return d;
            };
            const open = async (d) => { window.showDirectoryPicker = async () => d; await app.browseFolder(); await Recents.saving; };
            const names = async () => (await Recents.list()).map(x => x.name).join(',');
            const shown = () => [...document.querySelectorAll('#recent-list .recent-name')].map(x => x.textContent).join(',');
            out.hiddenWhenEmpty = document.getElementById('recents').classList.contains('hidden');
            const a = await make('rec A'), b = await make('rec B');
            await open(a);
            await open(b);
            out.order = await names();
            // Opening one again moves it to the top, once
            await open(await opfs.getDirectoryHandle('rec A'));
            out.reopened = await names();
            await Recents.render();
            out.shown = shown() === out.reopened && !document.getElementById('recents').classList.contains('hidden') &&
                [...document.querySelectorAll('#recent-list .recent-when')].every(x => x.textContent === 'Today');
            // Keeps the newest six
            for (let i = 1; i <= 6; i++) await open(await make(`rec ${i}`));
            out.capped = await names();
            // Click reopens it, at the start
            Folders.setScope(null);
            const target = [...document.querySelectorAll('#recent-list li')].find(li => li.querySelector('.recent-name').textContent === 'rec 3');
            target.querySelector('.recent-open').click();
            for (let i = 0; i < 100 && !(app.dirHandle && app.dirHandle.name === 'rec 3' && app.files.length); i++) await new Promise(res => setTimeout(res, 20));
            await Recents.saving;
            out.clicked = app.dirHandle.name === 'rec 3' && app.files.length === 1 && (await names()).startsWith('rec 3,');
            // × forgets it (the folder stays)
            const li = [...document.querySelectorAll('#recent-list li')].find(x => x.querySelector('.recent-name').textContent === 'rec 1');
            li.querySelector('.recent-remove').click();
            for (let i = 0; i < 50 && shown().includes('rec 1'); i++) await new Promise(res => setTimeout(res, 20));
            out.removed = !(await names()).includes('rec 1') && !shown().includes('rec 1') && !!(await opfs.getDirectoryHandle('rec 1'));
            // A folder that's gone says so and offers to remove it
            await opfs.removeEntry('rec 2', { recursive: true });
            const rec2 = (await Recents.list()).find(x => x.name === 'rec 2');
            const before = app.dirHandle;
            await Recents.open(rec2);
            out.missing = app.dirHandle === before && [...document.querySelectorAll('.toast')].some(t => /Couldn't find “rec 2”/.test(t.textContent) && t.querySelector('.toast-action'));
            out.when = [Recents.when(Date.now()), Recents.when(Date.now() - 86400000), Recents.when(new Date(2020, 2, 4).getTime())].join('|');
            return out;
        });
        check('recent: hidden until a folder has been opened', r.hiddenWhenEmpty);
        check('recent: newest first', r.order === 'rec B,rec A', r.order);
        check('recent: opening one again moves it to the top, once', r.reopened === 'rec A,rec B', r.reopened);
        check('recent: listed on the start screen with when', r.shown);
        check('recent: keeps the newest six', r.capped === 'rec 6,rec 5,rec 4,rec 3,rec 2,rec 1', r.capped);
        check('recent: click reopens the folder', r.clicked);
        check('recent: × removes it from the list only', r.removed);
        check('recent: a folder that has gone says so', r.missing);
        check('recent: dates read Today / Yesterday / Mar 4, 2020', /^Today\|Yesterday\|Mar 4, 2020$/.test(r.when), r.when);
        check('recent suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7o. Zooming the grid keeps your place ----
    console.log('grid zoom keeps your place');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        await page.setViewportSize({ width: 1300, height: 820 });
        const r = await page.evaluate(async () => {
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('zoomorder', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('zoomorder', { create: true });
            const bytes = await makeRealJpeg(240, 160);
            for (let i = 0; i < 240; i++) {
                const fh = await dir.getFileHandle(`p${String(i).padStart(3, '0')}.jpg`, { create: true });
                const w = await fh.createWritable();
                await w.write(new Blob([bytes], { type: 'image/jpeg' }));
                await w.close();
            }
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            app.setView('grid');
            const frames = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
            const grid = app.elements.gridView;
            const f = app.files[130];
            let out0;
            app.goTo(f);
            await frames();
            const top = () => Math.round(f._gridEl.getBoundingClientRect().top);
            // Put it 400px down and wait for the layout to hold still there
            for (let i = 0; i < 20 && top() !== 400; i++) {
                grid.scrollTop += f._gridEl.getBoundingClientRect().top - 400;
                await frames();
            }
            out0 = top();
            const out = { tops: [out0], cols: [app.getGridColumnCount()] };
            const wheel = (dy) => grid.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true }));
            for (let i = 0; i < 3; i++) { wheel(100); await frames(); }
            out.tops.push(top()); out.cols.push(app.getGridColumnCount());
            for (let i = 0; i < 6; i++) { wheel(-100); await frames(); }
            out.tops.push(top()); out.cols.push(app.getGridColumnCount());
            const slider = app.elements.gridSizeSlider;
            slider.value = 100;
            slider.dispatchEvent(new Event('input'));
            await frames();
            await new Promise(res => setTimeout(res, 200)); // off-screen tiles settle
            out.tops.push(top());
            // Highlighted photo out of sight: the middle of the view stays
            grid.scrollTop = 0;
            await frames();
            const a = app.gridAnchor();
            out.fallback = a.el !== f._gridEl;
            slider.value = 260;
            slider.dispatchEvent(new Event('input'));
            await frames();
            out.fallbackMoved = Math.round(a.el.getBoundingClientRect().top - a.top);
            // Rescan (R) with new photos sorting in before it: the highlighted one stays put
            app.goTo(f);
            await frames();
            for (let i = 0; i < 20 && top() !== 300; i++) {
                grid.scrollTop += f._gridEl.getBoundingClientRect().top - 300;
                await frames();
            }
            for (let i = 0; i < 20; i++) {
                const fh = await dir.getFileHandle(`a${String(i).padStart(3, '0')}.jpg`, { create: true });
                const w = await fh.createWritable();
                await w.write(new Blob([bytes], { type: 'image/jpeg' }));
                await w.close();
            }
            await app.refreshFolder();
            await frames();
            out.rescan = Math.round(f._gridEl.getBoundingClientRect().top);
            out.rescanFiles = app.files.length;
            out.stillCurrent = app.currentFile === f && f._gridEl.classList.contains('active');
            return out;
        });
        check('grid zoom: the highlighted photo stays put (wheel and slider)', r.tops.every(t => Math.abs(t - 400) <= 1), r.tops.join(','));
        check('grid zoom: really changed the columns', r.cols[1] > r.cols[0] && r.cols[2] < r.cols[0], r.cols.join(','));
        check('grid zoom: otherwise the middle of the view stays put', r.fallback && Math.abs(r.fallbackMoved) <= 1, String(r.fallbackMoved));
        check('rescan: the highlighted photo stays put when new photos come in', r.rescanFiles === 260 && Math.abs(r.rescan - 300) <= 1 && r.stillCurrent, `${r.rescan} (${r.rescanFiles})`);
        check('grid zoom suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7p. Toasts: typed, merged, hover keeps them, click dismisses ----
    console.log('toasts');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const all = () => [...document.querySelectorAll('#toast-stack .toast:not(.leaving)')];
            app.showToast('Nothing to undo', 3000);
            app.showToast('Nothing to undo', 3000);
            app.showToast('Nothing to undo', 3000);
            out.merged = all().length === 1 && all()[0].querySelector('.toast-count').textContent === '×3';
            app.showToast('Delete failed: in use', 3000);
            app.showToast('Saved 100 × 80', 3000);
            out.types = all().map(t => [...t.classList].find(c => c.startsWith('t-'))).join(',');
            out.icons = all().every(t => t.querySelector('.toast-icon svg'));
            // Hovering keeps a toast with a button up past its time
            const t = app.showToast('Moved 2 photos to X', 150, null, { label: 'Undo', run() { } });
            out.passThrough = getComputedStyle(all()[0]).pointerEvents === 'none' && getComputedStyle(t).pointerEvents === 'auto';
            t.dispatchEvent(new MouseEvent('mouseenter'));
            await new Promise(res => setTimeout(res, 400));
            out.held = t.isConnected && !t.classList.contains('leaving');
            t.dispatchEvent(new MouseEvent('mouseleave'));
            await new Promise(res => setTimeout(res, 1000));
            out.goneAfter = !t.isConnected;
            // Click dismisses
            const c = app.showToast('Made “X”', 10000, null, { label: 'Undo', run() { } });
            c.click();
            await new Promise(res => setTimeout(res, 400));
            out.clicked = !c.isConnected;
            // No more than five at once
            for (let i = 0; i < 8; i++) app.showToast('Message ' + i, 5000);
            out.capped = all().length <= 5;
            return out;
        });
        check('toasts: the same message again counts ×3 instead of stacking', r.merged);
        check('toasts: typed (error, success) with an icon each', r.types.includes('t-error') && r.types.includes('t-success') && r.icons, r.types);
        check('toasts: plain ones let clicks through; one with a button stays up while hovered', r.passThrough && r.held && r.goneAfter, JSON.stringify(r));
        check('toasts: click dismisses; at most five at once', r.clicked && r.capped, JSON.stringify(r));
        check('toast suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7q. Watching the folder: new, removed and edited photos ----
    console.log('watching the folder');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(30); return fn(); };
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('watchorder', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('watchorder', { create: true });
            const put = async (d, name, bytes) => {
                const fh = await d.getFileHandle(name, { create: true });
                const w = await fh.createWritable();
                await w.write(new Blob([bytes], { type: 'image/jpeg' }));
                await w.close();
            };
            const bytes = await makeRealJpeg(240, 160);
            for (const n of ['b.jpg', 'd.jpg', 'f.jpg', 'h.jpg']) await put(dir, n, bytes);
            const sub = await dir.getDirectoryHandle('Wedding', { create: true });
            await put(sub, 'w1.jpg', bytes);
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            app.setView('grid');
            await until(() => Watch.observer || Watch._pollTimer);
            out.watching = Watch.observer ? 'observer' : 'poll';
            const kept = app.files.find(f => f.name === 'd.jpg')._gridEl;

            // A scanner saves two new photos: they slot in, nothing else is rebuilt
            await put(dir, 'c.jpg', bytes);
            await put(dir, 'e.jpg', await makeRealJpeg(240, 160, { color: '#c33' }));
            if (!Watch.observer) Watch.request({ full: true });
            await until(() => app.files.length === 7);
            const order = [...app.elements.gridView.querySelectorAll('.grid-item')].map(t => t._file.name).join(',');
            out.added = app.files.length === 7 && order === app.viewFiles().map(f => f.name).join(',');
            out.inPlace = app.files.find(f => f.name === 'd.jpg')._gridEl === kept && kept.isConnected;
            out.glow = app.files.find(f => f.name === 'c.jpg')._gridEl.classList.contains('is-new');
            // No message for them: they just appear (a scanner adds them one by one)
            await new Promise(r => setTimeout(r, 800));
            out.toast = ![...document.querySelectorAll('.toast')].some(t => /new photo/.test(t.textContent));
            Watch.showNew(['c.jpg', 'e.jpg'].map(n => app.files.find(f => f.name === n)));
            out.shown = ['c.jpg', 'e.jpg'].every(n => app.selection.has(app.files.find(f => f.name === n)));

            // A scanner writing a photo: first the start of it, then the
            // rest. It's added once it's whole, with a real thumbnail.
            const full = await makeRealJpeg(400, 300, { color: '#2a8' });
            const partFh = await dir.getFileHandle('g.jpg', { create: true });
            let w = await partFh.createWritable();
            await w.write(new Blob([full.slice(0, 300)]));
            await w.close();
            if (!Watch.observer) Watch.request({ full: true });
            await sleep(700);
            out.notYet = !app.files.some(f => f.name === 'g.jpg');
            w = await partFh.createWritable();
            await w.write(new Blob([full]));
            await w.close();
            if (!Watch.observer) Watch.request({ full: true });
            await until(() => app.files.some(f => f.name === 'g.jpg'), 6000);
            const g = app.files.find(f => f.name === 'g.jpg');
            out.wholeSize = !!g && g.size === full.length;
            await until(() => g && g.thumbnailUrl, 4000);
            out.thumb = await new Promise(res => {
                if (!g || !g.thumbnailUrl) return res(false);
                const im = new Image();
                im.onload = () => res(im.naturalWidth > 0);
                im.onerror = () => res(false);
                im.src = g.thumbnailUrl;
            });
            await dir.removeEntry('g.jpg');
            if (!Watch.observer) Watch.request({ full: true });
            await until(() => !app.files.some(f => f.name === 'g.jpg'));
            // Whole files are told apart from half-written ones
            const jpgDone = await Watch.complete(new File([full], 'x.jpg', { lastModified: Date.now() }));
            const jpgHalf = await Watch.complete(new File([full.slice(0, 500)], 'x.jpg', { lastModified: Date.now() }));
            const oldHalf = await Watch.complete(new File([full.slice(0, 500)], 'x.jpg', { lastModified: Date.now() - 60000 }));
            out.complete = jpgDone && !jpgHalf && oldHalf;

            // Removed outside jEditor: gone from the grid
            await dir.removeEntry('h.jpg');
            if (!Watch.observer) Watch.request({ full: true });
            await until(() => !app.files.some(f => f.name === 'h.jpg'));
            out.removed = !app.files.some(f => f.name === 'h.jpg') && app.files.length === 6;

            // A new folder with a photo in it
            const extra = await dir.getDirectoryHandle('Reception', { create: true });
            await put(extra, 'r1.jpg', bytes);
            if (!Watch.observer) Watch.request({ full: true });
            await until(() => app.files.some(f => f.relPath === 'Reception/r1.jpg'));
            out.newFolder = Folders.map.has('Reception') && app.files.some(f => f.relPath === 'Reception/r1.jpg');

            // Edited in another program: R notices (in the background)
            const b = app.files.find(f => f.name === 'b.jpg');
            const before = b.size;
            await put(dir, 'b.jpg', await makeRealJpeg(300, 200, { color: '#39c' }));
            await app.refreshFolder();
            await until(() => b.size !== before);
            out.edited = b.size !== before;

            // R while the project is still opening waits for it (the load
            // reads every photo); pressed several times in a row, each new
            // photo comes in once
            await put(dir, 'r2.jpg', bytes);
            await put(dir, 'r3.jpg', bytes);
            app.isLoading = true;
            await app.refreshFolder();
            app.isLoading = false;
            out.waitedForLoad = !app.files.some(f => f.relPath === 'r2.jpg') && /Still opening/.test([...document.querySelectorAll('.toast')].map(t => t.textContent).join(' '));
            const presses = [];
            for (let i = 0; i < 4; i++) presses.push(app.refreshFolder());
            await Promise.all(presses);
            await sleep(400);
            await app.refreshFolder();
            out.noDoubles = ['r2.jpg', 'r3.jpg'].every(n => app.files.filter(f => f.relPath === n).length === 1)
                && new Set(app.files.map(f => f.relPath)).size === app.files.length
                && app.elements.gridView.querySelectorAll('.grid-item').length === app.viewFiles().length;
            // (gone again, for the counts below)
            await dir.removeEntry('r2.jpg');
            await dir.removeEntry('r3.jpg');
            await app.refreshFolder();
            await until(() => !app.files.some(f => /^r[23]\.jpg$/.test(f.relPath)));

            // Nothing changed: up to date, quickly
            const t0 = performance.now();
            await app.refreshFolder();
            out.rescanMs = Math.round(performance.now() - t0);
            out.upToDate = [...document.querySelectorAll('.toast')].some(t => /up to date/.test(t.textContent));

            // jEditor's own rename and trash aren't mistaken for outside changes
            const d = app.files.find(f => f.name === 'd.jpg');
            await app.renameFile(d, 'd2.jpg');
            await app.moveToTrash([app.files.find(f => f.name === 'f.jpg')]);
            await sleep(900);
            await app.refreshFolder();
            out.ownOps = app.files.length === 6 && app.files.includes(d) && d.name === 'd2.jpg' &&
                !app.files.some(f => f.name === 'f.jpg') && !app.files.some(f => f.name === 'd.jpg');

            // Switched off: no watching
            app.uiPrefs.autoCheck = false;
            Watch.start();
            out.off = !Watch.observer && !Watch._pollTimer;

            // Deleting a photo that's already gone (deleted in File Explorer
            // before jEditor noticed): it just leaves the grid
            await put(dir, 'x1.jpg', bytes);
            await app.refreshFolder();
            const x1 = app.files.find(f => f.name === 'x1.jpg');
            await dir.removeEntry('x1.jpg');
            await app.moveToTrash([x1]);
            const toasts = () => [...document.querySelectorAll('.toast')].map(t => t.textContent);
            out.goneDelete = !app.files.includes(x1) && toasts().some(t => /already deleted elsewhere/.test(t)) &&
                !toasts().some(t => /Couldn't delete/.test(t));

            // One file that never finishes deleting doesn't hold up the rest
            await put(dir, 'x2.jpg', bytes);
            await put(dir, 'x3.jpg', bytes);
            await app.refreshFolder();
            const x2 = app.files.find(f => f.name === 'x2.jpg'), x3 = app.files.find(f => f.name === 'x3.jpg');
            const realTrashOne = app.trashOne;
            app.trashOne = function (f, ...rest) { return f === x2 ? new Promise(() => { }) : realTrashOne.call(this, f, ...rest); };
            app.TRASH_TIMEOUT_MS = 300;
            const started = Date.now();
            await app.moveToTrash([x2, x3]);
            app.trashOne = realTrashOne;
            app.TRASH_TIMEOUT_MS = 30000;
            out.hungDelete = Date.now() - started < 3000 && !app.files.includes(x3) && app.files.includes(x2) &&
                !(app._tasks && app._tasks.has('trash'));

            // An edit of ours that never ends stops holding up folder checks
            app.uiPrefs.autoCheck = true;
            Watch.start();
            await until(() => Watch.observer || Watch._pollTimer);
            const stuck = { hang: () => new Promise(() => { }) };
            Watch.guard(stuck, ['hang']);
            Watch.STALE_OP_MS = 400;
            stuck.hang();
            await dir.removeEntry('x2.jpg');
            Watch.request({ full: true });
            await until(() => !app.files.includes(x2), 5000);
            out.staleOp = !app.files.includes(x2);
            Watch.STALE_OP_MS = 90000;
            return out;
        });
        console.log(`  info  watching with: ${r.watching}; rescan of an unchanged order: ${r.rescanMs} ms`);
        check('watch: new photos slot into the grid in sort order', r.added, JSON.stringify(r));
        check('watch: existing tiles aren\'t rebuilt; new ones glow', r.inPlace && r.glow);
        check('watch: no message for new photos; showing them selects them', r.toast && r.shown);
        check('watch: a photo still being written waits, then comes in whole with a real thumbnail', r.notYet && r.wholeSize && r.thumb && r.complete, JSON.stringify(r));
        check('watch: photos removed outside jEditor go', r.removed);
        check('watch: a new folder and its photos show up', r.newFolder);
        check('rescan: photos edited elsewhere are picked up', r.edited);
        check('rescan: R while the project is still opening waits for it, saying so; pressed several times, each new photo comes in once', r.waitedForLoad && r.noDoubles, JSON.stringify([r.waitedForLoad, r.noDoubles]));
        check('rescan: an unchanged order is up to date', r.upToDate && r.rescanMs < 2000, String(r.rescanMs));
        check('watch: jEditor\'s own rename and trash aren\'t seen as outside changes', r.ownOps);
        check('watch: can be switched off', r.off);
        check('delete: a photo already deleted elsewhere just leaves the grid', r.goneDelete, JSON.stringify(r));
        check('delete: one file that never finishes doesn\'t hold up the rest', r.hungDelete, JSON.stringify(r));
        check('watch: an edit that never ends stops holding up folder checks', r.staleOp, JSON.stringify(r));
        check('watch suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7r. Flags and search ----
    console.log('flags and search');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const key = (k, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('flagorder', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('flagorder', { create: true });
            const bytes = await makeRealJpeg(200, 140);
            const put = async (d, name) => {
                const fh = await d.getFileHandle(name, { create: true });
                const w = await fh.createWritable();
                await w.write(new Blob([bytes], { type: 'image/jpeg' }));
                await w.close();
            };
            for (let i = 1; i <= 6; i++) await put(dir, `IMG_000${i}.jpg`);
            const sub = await dir.getDirectoryHandle('Ceremony', { create: true });
            await put(sub, 'vows.jpg');
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            app.setView('grid');
            const f = (n) => app.files.find(x => x.name === n);
            const sel = (...names) => { app.selection = new Set(names.map(f)); app.updateSelectionUI(); };

            sel('IMG_0001.jpg', 'IMG_0002.jpg');
            key('p');
            sel('IMG_0002.jpg', 'vows.jpg');
            key('x');
            sel('IMG_0003.jpg');
            key('3');
            out.flags = Flags.has(f('IMG_0001.jpg'), 'star') && Flags.has(f('IMG_0002.jpg'), 'star') && Flags.has(f('IMG_0002.jpg'), 'rescan') &&
                Flags.has(f('vows.jpg'), 'rescan') && Flags.has(f('IMG_0003.jpg'), 'green');
            out.badges = !!f('IMG_0002.jpg')._gridEl.querySelector('.tile-flags .tf-star') && !!f('IMG_0002.jpg')._gridEl.querySelector('.tf-rescan');
            // P again on the same photos takes the star off; Ctrl+Z puts it back
            sel('IMG_0001.jpg');
            key('p');
            out.toggled = !Flags.has(f('IMG_0001.jpg'), 'star');
            key('z', { ctrlKey: true });
            await sleep(50);
            out.undone = Flags.has(f('IMG_0001.jpg'), 'star');
            // 3 again takes the green label off
            sel('IMG_0003.jpg');
            key('4');
            out.colourSwap = Flags.has(f('IMG_0003.jpg'), 'blue') && !Flags.has(f('IMG_0003.jpg'), 'green');

            // Saved with the order
            await sleep(700);
            const read = async () => JSON.parse(await (await (await (await dir.getDirectoryHandle('.jeditor')).getFileHandle('flags.json')).getFile()).text()).flags;
            const saved = await read();
            out.saved = saved['IMG_0002.jpg'] && saved['IMG_0002.jpg'].star && saved['Ceremony/vows.jpg'].rescan && saved['IMG_0003.jpg'].color === 'blue';

            // A rename carries the flags; they're saved under the new name
            await app.renameFile(f('IMG_0001.jpg'), 'Smith_01.jpg');
            await sleep(700);
            const afterRename = await read();
            out.renamed = !!(afterRename['Smith_01.jpg'] && afterRename['Smith_01.jpg'].star && !afterRename['IMG_0001.jpg']);

            // Opened again: flags come back
            await app.openDirectory(dir);
            await sleep(200);
            out.reloaded = Flags.has(f('Smith_01.jpg'), 'star') && Flags.has(f('vows.jpg'), 'rescan');
            app.setView('grid');

            // The filter: only flagged photos; Ctrl+A selects just those
            Flags.setFilter('star');
            out.filter = app.viewFiles().map(x => x.name).sort().join(',');
            key('a', { ctrlKey: true });
            out.selectAll = app.selection.size === 2;
            out.chip = !document.getElementById('fb-filter-chip').classList.contains('hidden');
            out.list = [...document.querySelectorAll('#flag-list [data-flag-filter]')].map(r => r.dataset.flagFilter).join(',');
            Flags.setFilter(null);

            // Search: words in the name or folder, and is: for flags
            Flags.setQuery('ceremony');
            out.searchFolder = app.viewFiles().map(x => x.name).join(',');
            Flags.setQuery('img 000');
            out.searchWords = app.viewFiles().length;
            Flags.setQuery('is:rescan');
            out.searchFlag = app.viewFiles().map(x => x.name).sort().join(',');
            Flags.setQuery('nothing-like-this');
            out.noMatch = app.viewFiles().length === 0 && app.elements.gridView.classList.contains('grid-no-match');
            // Its Clear search button shows everything again
            const clearBtn = app.elements.gridView.querySelector('.grid-empty-box .btn');
            out.clearLabel = clearBtn && clearBtn.textContent;
            if (clearBtn) clearBtn.click();
            out.cleared = app.viewFiles().length === 7 && !Flags.query && !app.elements.gridView.classList.contains('grid-no-match');
            // Ctrl+F opens the search box
            key('f', { ctrlKey: true });
            out.focus = document.activeElement && document.activeElement.id === 'fb-search';
            document.activeElement.blur();

            // The rescan list
            out.listText = Flags.listText(app.files.filter(x => Flags.has(x, 'rescan')), 'rescan');

            // Clean Up removes the flags too
            UI.confirm = async () => true;
            await app.cleanUpFolder();
            out.cleanedUp = !app.files.some(x => x._flags);
            return out;
        });
        check('flags: P, X and 1–5 set star, rescan and color on the selection', r.flags && r.badges, JSON.stringify(r));
        check('flags: P again unstars; Ctrl+Z undoes; a new color replaces the old', r.toggled && r.undone && r.colourSwap);
        check('flags: saved in .jeditor/flags.json, keyed by path', r.saved);
        check('flags: a rename carries them; saved under the new name', r.renamed);
        check('flags: come back when the order is opened again', r.reloaded);
        check('flags: filter shows only those photos, Ctrl+A selects just them', r.filter === 'IMG_0002.jpg,Smith_01.jpg' && r.selectAll && r.chip, r.filter);
        check('flags: the folder list has a Flags section with counts', r.list.startsWith('star,rescan,blue') && r.list.endsWith('none'), r.list);
        check('search: by folder, by words, by is:flag; no match says so, and its Clear search button shows everything', r.searchFolder === 'vows.jpg' && r.searchWords === 5 && r.searchFlag === 'IMG_0002.jpg,vows.jpg' && r.noMatch && r.cleared,
            `${r.searchFolder} / ${r.searchWords} / ${r.searchFlag}`);
        check('search: Ctrl+F opens the search box', r.focus);
        check('flags: rescan list names each photo with its folder', /Needs rescan \(2\)/.test(r.listText) && r.listText.includes('Ceremony/vows.jpg'), r.listText);
        check('flags: Clean Up Folder removes them', r.cleanedUp);
        check('flags suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7s. Batch Auto crop ----
    console.log('batch auto crop');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('cropbatch', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('cropbatch', { create: true });
            // Two scans with a tilted print on a light bed, one plain photo
            const scan = async (color, tilt) => {
                const c = document.createElement('canvas');
                c.width = 900; c.height = 700;
                const g = c.getContext('2d');
                g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, 900, 700);
                g.save(); g.translate(450, 350); g.rotate(tilt * Math.PI / 180);
                g.fillStyle = color; g.fillRect(-280, -200, 560, 400);
                g.restore();
                return new Blob([await (await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92))).arrayBuffer()], { type: 'image/jpeg' });
            };
            const files = { 'scan1.jpg': await scan('#2a6', 3), 'scan2.jpg': await scan('#a33', -2), 'plain.jpg': new Blob([await makeRealJpeg(400, 300)], { type: 'image/jpeg' }) };
            const originals = {};
            for (const [n, b] of Object.entries(files)) {
                const fh = await dir.getFileHandle(n, { create: true });
                const w = await fh.createWritable(); await w.write(b); await w.close();
                originals[n] = new Uint8Array(await b.arrayBuffer());
            }
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            app.setView('grid');
            app.selection = new Set(app.files);
            app.updateSelectionUI();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true }));
            for (let i = 0; i < 200 && (app._autoCropping || !app._undoStack || !app._undoStack.some(e => e.type === 'auto-crop')); i++) await new Promise(res => setTimeout(res, 50));
            const dims = async (n) => {
                const bmp = await createImageBitmap(await (await dir.getFileHandle(n)).getFile());
                const d = [bmp.width, bmp.height]; bmp.close(); return d;
            };
            out.scan1 = await dims('scan1.jpg');
            out.scan2 = await dims('scan2.jpg');
            out.plain = await dims('plain.jpg');
            out.toast = [...document.querySelectorAll('.toast')].map(t => t.textContent).find(t => /Auto-cropped/.test(t)) || '';
            const backups = await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('originals');
            out.backups = 0;
            for await (const e of backups.values()) out.backups++;
            // One Ctrl+Z puts both back, byte for byte
            await app.undo();
            const same = async (n) => {
                const now = new Uint8Array(await (await (await dir.getFileHandle(n)).getFile()).arrayBuffer());
                return now.length === originals[n].length && now.every((v, i) => v === originals[n][i]);
            };
            out.restored = await same('scan1.jpg') && await same('scan2.jpg');
            out.backupsAfter = 0;
            for await (const e of backups.values()) out.backupsAfter++;

            // Auto crop's test set (crop-log.js): a photo batch Auto crop
            // cropped, then fixed in the editor, is a test scan of the
            // original, with the crop put back onto it
            await opfs.removeEntry(CropLog.DIR, { recursive: true }).catch(() => { });
            {
                const b = await scan('#36c', 1.5);
                const fh = await dir.getFileHandle('scan3.jpg', { create: true });
                const w = await fh.createWritable(); await w.write(b); await w.close();
                originals['scan3.jpg'] = new Uint8Array(await b.arrayBuffer());
            }
            await app.browseFolder();
            app.setView('grid');
            app.selection = new Set(app.files);
            app.updateSelectionUI();
            const runs = (app._undoStack || []).length;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true }));
            for (let i = 0; i < 200 && (app._autoCropping || (app._undoStack || []).length === runs); i++) await new Promise(res => setTimeout(res, 50));
            app.selection.clear();
            const f = (n) => app.files.find(x => x.name === n);
            const ed = CropEditor;
            const edit = async (n, act) => {
                app.currentFile = f(n);
                app.setView('single');
                await app.enterCrop();
                for (let i = 0; i < 100 && !ed.ready; i++) await new Promise(res => setTimeout(res, 20));
                await act();
            };
            const inset = (k) => { const r = ed.rect; ed.setRect({ x0: r.x0 + k, y0: r.y0 + k, x1: r.x1 - k, y1: r.y1 - k }); };
            // Fixed: 20 px in on every side
            await edit('scan1.jpg', () => inset(20));
            out.fixedSize = [ed.outputRect().w, ed.outputRect().h];
            await app.saveCrop();
            // Saved as it was (Save, nothing changed); and a photo batch Auto
            // crop left alone, saved as it is: not a test
            await edit('scan2.jpg', () => { });
            await app.saveCrop();
            await edit('plain.jpg', () => { });
            await app.saveCrop();
            await CropLog._queue;
            // Fixed before this was kept: a log line only, as it used to be;
            // Recover makes it a test scan
            await edit('scan3.jpg', () => inset(30));
            const legacy = CropLog.entry(app, ed, f('scan3.jpg'));
            CropLog.setEnabled(false);
            await app.saveCrop();
            CropLog.setEnabled(true);
            await CropLog.write(legacy);
            await CropLog.recover();
            const log = await opfs.getDirectoryHandle(CropLog.DIR);
            const names = [];
            for await (const [n] of log.entries()) names.push(n);
            out.logNames = names.sort();
            const read = async (n) => (await (await log.getFileHandle(n)).getFile());
            const label = async (re) => { const n = names.find(x => re.test(x) && x.endsWith('.json')); return n ? JSON.parse(await (await read(n)).text()) : null; };
            const kept = async (re) => { const n = names.find(x => re.test(x) && !x.endsWith('.json')); return n ? new Uint8Array(await (await read(n)).arrayBuffer()) : null; };
            const sameBytes = (a, b) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);
            out.l1 = await label(/scan1\.jpg/);
            out.l2 = await label(/scan2\.jpg/);
            out.l3 = await label(/scan3\.jpg/);
            out.scans = sameBytes(await kept(/scan1\.jpg/), originals['scan1.jpg']) && sameBytes(await kept(/scan2\.jpg/), originals['scan2.jpg']) && sameBytes(await kept(/scan3\.jpg/), originals['scan3.jpg']);
            await CropLog.refresh();
            out.count = document.getElementById('crop-log-count').textContent;
            out.lines = (await (await read('log.jsonl')).text()).trim().split('\n').map(l => JSON.parse(l)).map(l => `${l.file}:${l.result}${l.recovered ? ':recovered' : ''}`);
            return out;
        });
        const inside = (d) => d[0] < 900 && d[1] < 700 && d[0] > 450 && d[1] > 300;
        check('auto crop: each scan is cropped to its print', inside(r.scan1) && inside(r.scan2), `${r.scan1} / ${r.scan2}`);
        check('auto crop: a photo with no print edge is left alone', r.plain.join('x') === '400x300', r.plain.join('x'));
        check('auto crop: says what it did, with Undo', /Auto-cropped 2 photos — no print found on 1/.test(r.toast), r.toast);
        check('auto crop: originals kept in .jeditor/originals; one Ctrl+Z restores every byte', r.backups === 2 && r.restored && r.backupsAfter === 0, JSON.stringify(r));
        {
            // scan1's print: 560 × 400 at (450, 350), turned 3°; the fix took
            // 20 px off each side of Auto's crop
            const L = r.l1 || {}, q = (L.saved && L.saved.crop) || [];
            const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
            const mid = q.length === 4 ? [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2] : [0, 0];
            const turn = q.length === 4 ? Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]) * 180 / Math.PI : 0;
            const fs = r.fixedSize || [];
            check('test set: a batch Auto crop fixed in the editor is kept as corrected, on the original scan', L.result === 'corrected' && L.batch === true && L.W === 900 && L.H === 700 && L.auto && L.auto.found, JSON.stringify(L));
            check('test set: its crop is put back onto the scan: where it was, the size saved, turned with the print',
                Math.abs(mid[0] - 450) < 4 && Math.abs(mid[1] - 350) < 4 && Math.abs(len(q[0], q[1]) - fs[0]) < 1.5 && Math.abs(len(q[1], q[2]) - fs[1]) < 1.5 && Math.abs(turn - 3) < 0.3 && L.diff > 25 && L.diff < 32,
                JSON.stringify({ mid, turn, sides: q.length === 4 && [len(q[0], q[1]), len(q[1], q[2])], fs, diff: L.diff }));
            check('test set: a batch Auto crop saved as it was is kept as accepted', r.l2 && r.l2.result === 'accepted' && r.l2.batch && r.l2.W === 900, JSON.stringify(r.l2));
            check('test set: Recover turns a crop fixed before this into a test scan, from the originals', r.l3 && r.l3.result === 'corrected' && r.l3.batch && r.l3.recovered && r.l3.W === 900, JSON.stringify(r.l3));
            check('test set: the scans kept are the originals, byte for byte', r.scans && /^3 scans kept/.test(r.count), (r.logNames || []).join() + ' ' + r.count);
            check('test set: the log has each, the recovered one in place; a photo batch Auto crop left alone isn\'t a test',
                (r.lines || []).join() === 'scan1.jpg:corrected,scan2.jpg:accepted,scan3.jpg:corrected:recovered', (r.lines || []).join());
        }
        check('auto crop suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7s0. The photo finder (photo-find.js) ----
    console.log('photo finder');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        await page.evaluate(PHOTO_SCENES);
        const r = await page.evaluate(() => {
            const S = Scenes, out = {};
            const lid = '#ecebe6';
            const all = (name, bed, prints, opts, W = 1000, H = 1200) => {
                const c = S.draw(W, H, bed, prints, opts);
                const found = PhotoFind.all(c, W, H);
                out[name] = { n: found.length, err: Math.max(...prints.map(p => Math.min(...found.map(f => S.err(f.corners, p)), 999))) };
            };
            all('three', lid, [{ x: 300, y: 260, w: 360, h: 240, angle: 3 }, { x: 800, y: 300, w: 240, h: 360, angle: -5 }, { x: 420, y: 800, w: 420, h: 300, angle: 0, kind: 'dark' }], { gradient: 0.12, noise: 6, dust: true });
            all('whiteBorder', '#f7f7f5', [{ x: 500, y: 450, w: 400, h: 300, angle: -1.5, border: 18, borderColor: '#ffffff' }], { noise: 4 });
            all('darkOnBlack', '#0a0a0a', [{ x: 500, y: 500, w: 380, h: 280, angle: 4, kind: 'dark' }], { noise: 6 });
            all('touching', lid, [{ x: 330, y: 400, w: 300, h: 220, angle: 0 }, { x: 631, y: 400, w: 300, h: 220, angle: 0 }], { noise: 5 });
            all('six', lid, [0, 1, 2, 3, 4, 5].map(i => ({ x: 200 + (i % 2) * 450, y: 180 + Math.floor(i / 2) * 380, w: 360, h: 250, angle: (i - 2.5) * 1.6 })), { noise: 6, dust: true });
            all('shaded', lid, [{ x: 400, y: 450, w: 400, h: 300, angle: -2 }, { x: 600, y: 950, w: 300, h: 200, angle: 1 }], { gradient: 0.35, noise: 6 });
            all('panorama', lid, [{ x: 500, y: 400, w: 900, h: 280, angle: 1 }], { noise: 5 });
            const feeder = (g, W, H) => { g.fillStyle = '#fbfbfb'; g.fillRect(0, 0, W, H); g.fillStyle = '#b4c3d2'; g.fillRect(0, 0, W, 580); };
            const fp = { x: 450, y: 285, w: 380, h: 560, angle: 1.5 };
            const f = PhotoFind.single(S.draw(850, 1400, feeder, [fp], { noise: 8 }), 850, 1400, { feeder: true });
            out.feeder = f ? S.err(f.corners, fp) : 999;
            const sky = S.draw(900, 600, '#888', [{ x: 450, y: 300, w: 900, h: 600, angle: 0, kind: 'sky' }], {});
            const plain = S.draw(900, 600, '#888', [{ x: 450, y: 300, w: 900, h: 600, angle: 0 }], {});
            out.notScans = !PhotoFind.single(sky, 900, 600, { strict: true }) && !PhotoFind.single(plain, 900, 600, { strict: true });
            return out;
        });
        const ok = (k, n, e) => r[k] && r[k].n === n && r[k].err <= e;
        check('finder: prints on a shaded, dusty lid, tilted, a dark one too', ok('three', 3, 4) && ok('shaded', 2, 4) && ok('darkOnBlack', 1, 5), JSON.stringify([r.three, r.shaded, r.darkOnBlack]));
        check('finder: a white-bordered print on a white lid, border and all', ok('whiteBorder', 1, 6), JSON.stringify(r.whiteBorder));
        check('finder: prints laid touching are told apart; a panorama stays whole', ok('touching', 2, 4) && ok('panorama', 1, 4), JSON.stringify([r.touching, r.panorama]));
        check('finder: six prints at once', ok('six', 6, 4), JSON.stringify(r.six));
        check('finder: a feeder page (two backgrounds), tilted', r.feeder <= 4, String(r.feeder));
        check('finder: ordinary photos (one with a plain sky) aren\'t taken for scans', r.notScans);
        check('finder suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7s1. Auto crop on a sheet-feeder page ----
    console.log('feeder auto crop');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            let seed = 11;
            const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
            // Like a FastFoto page: the photo at the leading edge, the bluish
            // backing beside it, white fill where the page runs on past it
            const page = (tilt) => {
                const c = document.createElement('canvas');
                c.width = 850; c.height = 1400;
                const g = c.getContext('2d');
                g.fillStyle = '#fbfbfb'; g.fillRect(0, 0, 850, 1400);
                const img = g.getImageData(0, 0, 850, 580);
                for (let i = 0; i < img.data.length; i += 4) {
                    const n = (rnd() - 0.5) * 14;
                    img.data[i] = 180 + n; img.data[i + 1] = 195 + n; img.data[i + 2] = 210 + n;
                }
                g.putImageData(img, 0, 0);
                g.save(); g.translate(450, 285); g.rotate(tilt * Math.PI / 180);
                for (let y = 0; y < 560; y += 28) for (let x = 0; x < 380; x += 38) {
                    g.fillStyle = `hsl(${Math.floor(rnd() * 360)},50%,${10 + Math.floor(rnd() * 50)}%)`;
                    g.fillRect(x - 190, y - 280, 38, 28);
                }
                g.restore();
                return c;
            };
            const crop = (det, W, H) => {
                const ed = CropEditor.headless(W, H);
                ed.aspectKey = 'free';
                ed.fitToPrint(det);
                const o = ed.outputRect();
                const ctr = ed.toImage({ x: (o.x0 + o.x1) / 2, y: (o.y0 + o.y1) / 2 });
                return { w: o.w, h: o.h, cx: Math.round(ctr.x + W / 2), cy: Math.round(ctr.y + H / 2), angle: ed.angle };
            };
            const straight = page(0);
            out.flatbedMisses = !CropAuto.detect(straight, 850, 1400);
            const d0 = CropAuto.find(straight, 850, 1400, { feeder: true });
            out.straight = d0 && crop(d0, 850, 1400);
            const tilted = page(1.5);
            const d1 = CropAuto.find(tilted, 850, 1400, { feeder: true });
            out.tilted = d1 && crop(d1, 850, 1400);
            // The crop editor's Auto (no hint) knows such a page too
            out.unhinted = !!CropAuto.find(straight, 850, 1400);
            // ...but leaves an ordinary photo alone, even one with a plain
            // dark band along the bottom
            const photo = document.createElement('canvas');
            photo.width = 900; photo.height = 600;
            const pg = photo.getContext('2d');
            for (let y = 0; y < 600; y += 30) for (let x = 0; x < 900; x += 30) {
                pg.fillStyle = `hsl(${Math.floor(rnd() * 360)},40%,${20 + Math.floor(rnd() * 50)}%)`;
                pg.fillRect(x, y, 30, 30);
            }
            pg.fillStyle = '#050505'; pg.fillRect(0, 420, 900, 180);
            out.photoAlone = !CropAuto.find(photo, 900, 600);
            // The feeder's finder too: a photo that fills the scan (the
            // feeder cut it to the print) has no backing beside it
            out.photoAloneFeeder = !CropAuto.detectFeeder(photo, 900, 600);
            // A print a hair taller than the scan: cut off top and bottom,
            // a grainy strip of bed down each side (left wider than right),
            // too little of the scan's edge for the bed to be known as one;
            // the photo's lower left pale and bluish, much the bed's color
            const cutOff = (tilt) => {
                const c = document.createElement('canvas');
                c.width = 1000; c.height = 620;
                const g = c.getContext('2d');
                const img = g.createImageData(1000, 620);
                for (let i = 0; i < img.data.length; i += 4) {
                    const n = (rnd() - 0.5) * 30;
                    img.data[i] = 182 + n; img.data[i + 1] = 194 + n; img.data[i + 2] = 232 + n; img.data[i + 3] = 255;
                }
                g.putImageData(img, 0, 0);
                g.save(); g.translate(485, 310); g.rotate(tilt * Math.PI / 180);
                for (let y = 0; y < 700; y += 25) for (let x = 0; x < 880; x += 40) {
                    const pale = x < 300 && y > 450;
                    g.fillStyle = pale ? `hsl(${215 + Math.floor(rnd() * 20)},30%,${70 + Math.floor(rnd() * 15)}%)`
                        : `hsl(${Math.floor(rnd() * 360)},45%,${15 + Math.floor(rnd() * 65)}%)`;
                    g.fillRect(x - 440, y - 350, 40, 25);
                }
                g.restore();
                return c;
            };
            const c0 = CropAuto.find(cutOff(0), 1000, 620);
            out.cut = c0 && crop(c0, 1000, 620);
            const c1 = CropAuto.find(cutOff(-1.2), 1000, 620);
            out.cutTilted = c1 && crop(c1, 1000, 620);
            return out;
        });
        const near = (c, w, h) => c && c.w > w - 30 && c.w <= w && c.h > h - 30 && c.h <= h && Math.abs(c.cx - 450) <= 8 && Math.abs(c.cy - 280) <= 10;
        check('feeder page: the flatbed finder can\'t see the photo (two backgrounds)', r.flatbedMisses);
        check('feeder page: Auto crop finds the photo, background trimmed off', near(r.straight, 380, 560), JSON.stringify(r.straight));
        check('feeder page: a tilted photo is straightened and cropped', near(r.tilted, 380, 560) && Math.abs(r.tilted.angle + 1.5) < 0.4, JSON.stringify(r.tilted));
        check('feeder page: found without the hint too; an ordinary photo is left alone', r.unhinted && r.photoAlone, JSON.stringify([r.unhinted, r.photoAlone]));
        check('feeder finder: a photo that fills the scan, with a plain band across it, isn\'t cropped to the band', r.photoAloneFeeder);
        const cut = r.cut, ct = r.cutTilted;
        check('a print cut off top and bottom by the scan: the bed strips either side come off',
            cut && cut.w > 860 && cut.w <= 880 && cut.h >= 610 && Math.abs(cut.cx - 485) <= 4 && cut.angle === 0, JSON.stringify(cut));
        check('...and tilted: straightened, no bed left in', ct && Math.abs(ct.angle - 1.2) < 0.3 && ct.w > 850 && ct.w <= 880 && Math.abs(ct.cx - 485) <= 6, JSON.stringify(ct));
        check('feeder auto crop suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7s0. Settings → Messages ----
    console.log('settings: messages');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            localStorage.removeItem('jeditor.ui');
            app.loadUiPrefs();
            const shown = (re) => [...document.querySelectorAll('.toast')].some(t => re.test(t.textContent));
            // Rotation messages are off to start with; the others are on
            out.defaults = !app.toastOn('rotate') && app.toastOn('flags') && app.toastOn('delete');
            app.showToast('Turned 1 photo right', 3000, null, null, { kind: 'rotate' });
            app.showToast('Starred a.jpg', 3000, null, null, { kind: 'flags' });
            out.rotateHidden = !shown(/Turned 1 photo/);
            out.flagsShown = shown(/Starred a\.jpg/);
            // Errors always show, whatever their kind
            app.showToast('Rotation failed: file in use', 3000, null, null, { kind: 'rotate', type: 'error' });
            out.errorShown = shown(/Rotation failed/);
            // The switches in Settings: one per kind, as set; changing one is kept
            app.toggleCustomizePanel(true);
            const sw = (k) => document.querySelector(`input[data-toast="${k}"]`);
            out.switches = document.querySelectorAll('#cust-toasts input[data-toast]').length === app.TOAST_KINDS.length && !sw('rotate').checked && sw('flags').checked;
            sw('flags').checked = false;
            sw('flags').dispatchEvent(new Event('change'));
            sw('rotate').checked = true;
            sw('rotate').dispatchEvent(new Event('change'));
            app.toggleCustomizePanel(false);
            const saved = JSON.parse(localStorage.getItem('jeditor.ui')).toasts;
            out.saved = saved.flags === false && saved.rotate === true;
            app.loadUiPrefs();
            out.kept = !app.toastOn('flags') && app.toastOn('rotate');
            app.showToast('Starred b.jpg', 3000, null, null, { kind: 'flags' });
            out.flagsNowHidden = !shown(/Starred b\.jpg/);
            localStorage.removeItem('jeditor.ui');
            return out;
        });
        check('messages: rotation off to start with, the rest on; a kind turned off doesn\'t show', r.defaults && r.rotateHidden && r.flagsShown, JSON.stringify(r));
        check('messages: errors show even when their kind is off', r.errorShown);
        check('messages: a switch per kind in Settings; changes are saved and kept', r.switches && r.saved && r.kept && r.flagsNowHidden, JSON.stringify(r));
        check('messages suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7s1. Kept rotations turn on screen first ----
    console.log('kept rotations turn on screen');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const until = async (fn, n = 200) => { for (let i = 0; i < n && !(await fn()); i++) await sleep(25); };
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('keptturn', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('keptturn', { create: true });
            for (const n of ['a.jpg', 'b.jpg']) {
                const fh = await dir.getFileHandle(n, { create: true });
                const w = await fh.createWritable(); await w.write(new Blob([await makeRealJpeg(400, 300)], { type: 'image/jpeg' })); await w.close();
            }
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            await Edits.setDefer(true);
            const a = app.files.find(x => x.name === 'a.jpg');
            app.setView('grid');
            await until(() => { const i = a._gridEl && a._gridEl.querySelector(':scope > img'); return i && i.src && i.src !== app.BLANK_THUMB && i.naturalWidth; });
            // Grid: the tile's own picture turns (no blank, no spinner), then
            // the redrawn thumbnail takes its place, straight
            const tile = a._gridEl.querySelector(':scope > img');
            const before = tile.src;
            app.selection = new Set([a]);
            app.updateSelectionUI();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
            out.tileTurning = a._gridEl.querySelector(':scope > img') === tile && /rotate\(90deg\)/.test(tile.style.transform);
            await until(() => tile.src !== before);
            await sleep(60);
            out.tileDone = a._gridEl.querySelector(':scope > img') === tile && !tile.style.transform && tile.naturalHeight > tile.naturalWidth;
            // Single view: the photo turns, isn't dimmed, then the redrawn one
            // replaces it with no turn left over
            app.openSingle(a);
            await until(() => app._displayFile === a && app._displayKind === 'full');
            const shown = app.elements.currentImage;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
            out.viewTurning = app.elements.currentImage === shown && /rotate\(90deg\)/.test(shown.style.transform) && shown.style.opacity !== '0.3';
            await until(() => app.elements.currentImage !== shown && app._displayKind === 'full');
            const now = app.elements.currentImage;
            out.viewDone = /rotate\(0deg\)/.test(now.style.transform) && now.naturalWidth > now.naturalHeight && !a._turnHeldView;
            out.kept = a._edit && a._edit.q === 2;
            return out;
        });
        // The edits bar: grid only, left of the size slider in the bottom row,
        // never over the selection bar (above the slider when the row is full)
        const lay = [];
        for (const w of [1400, 1100]) {
            await page.setViewportSize({ width: w, height: 700 });
            lay.push(await page.evaluate(async () => {
                app.setView('grid');
                app.selection = new Set([app.files[0]]);
                app.updateSelectionUI();
                await new Promise(res => setTimeout(res, 400));
                const box = (id) => document.getElementById(id).getBoundingClientRect();
                const e = box('edits-bar'), s = box('selection-bar'), g = box('grid-controls');
                const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
                const out = { clear: apart(e, s) && apart(e, g) && apart(s, g), leftOfSlider: e.right <= g.left + 1 && Math.abs(e.bottom - g.bottom) < 2, aboveSlider: e.bottom <= g.top };
                app.openSingle(app.files[0]);
                await new Promise(res => setTimeout(res, 200));
                out.hiddenInSingle = getComputedStyle(document.getElementById('edits-bar')).display === 'none';
                app.setView('grid');
                return out;
            }));
        }
        check('edits bar: grid only, left of the size slider; above it when the row is full; never over the selection bar',
            lay[0].clear && lay[0].leftOfSlider && lay[1].clear && (lay[1].leftOfSlider || lay[1].aboveSlider) && lay[0].hiddenInSingle, JSON.stringify(lay));
        // A narrow window, with and without the folder list: every pill in
        // the window, none over another (fit.js gives up parts in turn)
        const fit = [];
        for (const w of [1300, 900, 700, 480]) {
            await page.setViewportSize({ width: w, height: 700 });
            for (const rail of [true, false]) {
                fit.push(await page.evaluate(async ({ w, rail }) => {
                    app.setView('grid');
                    if (Folders.railOpen() !== rail) Folders.toggleRail();
                    app.selection = new Set(app.files.slice(0, 2));
                    app.updateSelectionUI();
                    const frames = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
                    await new Promise(res => setTimeout(res, 300));
                    await frames();
                    const shown = (el) => el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
                    const apart = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
                    const check = (ids) => {
                        const els = ids.map(id => document.getElementById(id) || document.querySelector(id)).filter(shown);
                        const r = els.map(e => e.getBoundingClientRect());
                        const bad = [];
                        r.forEach((a, i) => {
                            if (a.left < -1 || a.right > innerWidth + 1) bad.push(els[i].id || els[i].className + ' off screen');
                            for (let j = i + 1; j < r.length; j++) if (!apart(a, r[j])) bad.push((els[i].id || els[i].className) + ' over ' + (els[j].id || els[j].className));
                        });
                        return bad;
                    };
                    const out = { w, rail, fit: document.getElementById('main-interface').dataset.fit };
                    // The folder list beside the grid (wide windows): the selection bar keeps to the grid
                    const railBox = rail && innerWidth >= 768 ? document.getElementById('folder-rail').getBoundingClientRect() : null;
                    out.bad = [...check(['folder-bar', '.file-info', 'header-controls']), ...check(['selection-bar', 'edits-bar', 'grid-controls'])];
                    if (railBox && document.getElementById('selection-bar').getBoundingClientRect().left < railBox.right) out.bad.push('selection bar over the folder list');
                    // Short of room the folder pill doesn't cut its buttons off
                    const fb = document.getElementById('folder-bar');
                    if (fb.scrollWidth > fb.clientWidth + 1) out.bad.push('folder pill cut off');
                    out.squeezed = document.querySelectorAll('#header-controls [data-squeezed]').length;
                    out.more = shown(document.getElementById('btn-more'));
                    // More opened: its buttons on rows underneath, never out over the file pill
                    document.getElementById('btn-more').click();
                    await frames();
                    out.bad.push(...check(['.file-info', 'header-controls']).map(b => 'More open: ' + b));
                    document.getElementById('btn-more').click();
                    await frames();
                    // Single view: the file pill and the buttons
                    app.openSingle(app.files[0]);
                    await new Promise(res => setTimeout(res, 200));
                    await frames();
                    out.bad.push(...check(['.file-info', 'header-controls']).map(b => 'single: ' + b));
                    // A message beside the prev / rotate / next pill goes up a row rather than into it
                    app.showToast('Rotated 3 photos to the right', 3000);
                    await new Promise(res => setTimeout(res, 150));
                    await frames();
                    const t = document.getElementById('toast-stack').lastElementChild.getBoundingClientRect();
                    const c = document.querySelector('#image-container .controls').getBoundingClientRect();
                    if (!apart(t, c)) out.bad.push('single: message over the controls');
                    out.name = shown(document.querySelector('.file-info'));
                    app.setView('grid');
                    return out;
                }, { w, rail }));
            }
        }
        check('narrow windows: no pill over another or off screen, top or bottom, with or without the folder list', fit.every(f => f.bad.length === 0), JSON.stringify(fit.filter(f => f.bad.length)));
        check('... wide, nothing given up; at 480 header buttons go into More, which shows; the file pill stays in single view', !fit[1].fit && fit[6].squeezed > 0 && fit[6].more && fit.every(f => f.name), JSON.stringify(fit.map(f => [f.w, f.rail, f.fit, f.squeezed, f.more])));
        check('kept rotation: the grid tile turns its own picture, then the redrawn one replaces it straight', r.tileTurning && r.tileDone, JSON.stringify(r));
        check('kept rotation: the big photo turns (not dimmed), then the redrawn one has no turn left over', r.viewTurning && r.viewDone && r.kept, JSON.stringify(r));
        check('kept rotation suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7s2. Save edits when done ----
    console.log('save edits when done');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            let step = 'start';
            try { return await (async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const until = async (fn, n = 200) => { for (let i = 0; i < n && !(await fn()); i++) await sleep(50); };
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('keptedits', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('keptedits', { create: true });
            const scan = async (color, tilt) => {
                const c = document.createElement('canvas');
                c.width = 900; c.height = 700;
                const g = c.getContext('2d');
                g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, 900, 700);
                g.save(); g.translate(450, 350); g.rotate(tilt * Math.PI / 180);
                g.fillStyle = color; g.fillRect(-280, -200, 560, 400);
                g.restore();
                return new Blob([await (await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92))).arrayBuffer()], { type: 'image/jpeg' });
            };
            const files = { 'scan1.jpg': await scan('#2a6', 3), 'scan2.jpg': await scan('#a33', -2), 'plain.jpg': new Blob([await makeRealJpeg(400, 300)], { type: 'image/jpeg' }) };
            const originals = {};
            for (const [n, b] of Object.entries(files)) {
                const fh = await dir.getFileHandle(n, { create: true });
                const w = await fh.createWritable(); await w.write(b); await w.close();
                originals[n] = new Uint8Array(await b.arrayBuffer());
            }
            const bytes = async (d, n) => new Uint8Array(await (await (await d.getFileHandle(n)).getFile()).arrayBuffer());
            const same = async (n) => {
                const now = await bytes(dir, n);
                return now.length === originals[n].length && now.every((v, i) => v === originals[n][i]);
            };
            const untouched = async () => await same('scan1.jpg') && await same('scan2.jpg') && await same('plain.jpg');
            const dims = async (d, n) => {
                const bmp = await createImageBitmap(await (await d.getFileHandle(n)).getFile());
                const x = [bmp.width, bmp.height]; bmp.close(); return x;
            };
            const kept = async () => {
                try { return JSON.parse(await (await (await (await dir.getDirectoryHandle('.jeditor')).getFileHandle('edits.json')).getFile()).text()); } catch (e) { return null; }
            };
            const f = (n) => app.files.find(x => x.name === n);
            const bar = () => document.getElementById('edits-bar');
            const barText = () => document.getElementById('edits-text').textContent;

            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            app.setView('grid');
            out.barOffAtFirst = bar().classList.contains('hidden');

            // Turned on for this project (the grid's menu)
            step = "Turned on for this project (the grid's menu)";
            const bg = app.buildContextItems(null, false).find(it => it[0] === 'Save edits when done');
            bg[1]();
            await until(async () => (await kept()) && (await kept()).defer);
            out.on = Edits.on() && !bar().classList.contains('hidden') && /kept until you save/.test(barText()) && (await kept()).defer === true;

            // Batch Auto crop: kept as edits, nothing written
            step = 'Batch Auto crop: kept as edits, nothing written';
            const opfsRoot = await navigator.storage.getDirectory();
            await opfsRoot.removeEntry(CropLog.DIR, { recursive: true }).catch(() => { });
            app.selection = new Set(app.files);
            app.updateSelectionUI();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true }));
            await until(() => !app._autoCropping && f('scan1.jpg')._edit && f('scan2.jpg')._edit);
            out.autoKept = !!f('scan1.jpg')._edit && !!f('scan2.jpg')._edit && !f('plain.jpg')._edit && await untouched();
            out.autoToast = [...document.querySelectorAll('.toast')].map(t => t.textContent).find(t => /Auto-cropped/.test(t)) || '';
            out.badges = !!f('scan1.jpg')._gridEl.querySelector('.tile-edit') && !f('plain.jpg')._gridEl.querySelector('.tile-edit');
            out.barCount = barText();
            // Shown as it will be saved: the thumbnail and preview are of the print
            step = 'Shown as it will be saved: the thumbnail and preview are of the print';
            await until(() => f('scan1.jpg').thumbnailUrl && !f('scan1.jpg')._thumbStale);
            const tb = await createImageBitmap(await (await fetch(f('scan1.jpg').thumbnailUrl)).blob());
            out.thumbAspect = tb.width / tb.height;
            await until(() => f('scan1.jpg')._gridEl.querySelector(':scope > img').src === f('scan1.jpg').thumbnailUrl, 40);
            out.tileShows = f('scan1.jpg')._gridEl.querySelector(':scope > img').src === f('scan1.jpg').thumbnailUrl;
            const shown = await app.getDisplaySource(f('scan1.jpg'));
            out.shown = [shown.w, shown.h];

            // Recrop: the editor opens on the whole photo, at the kept crop
            step = 'Recrop: the editor opens on the whole photo, at the kept crop';
            const edit1 = { ...f('scan1.jpg')._edit };
            app.selection.clear();
            app.currentFile = f('scan1.jpg');
            app.setView('single');
            await app.enterCrop();
            await until(() => CropEditor.ready);
            const ed = CropEditor;
            out.editorWhole = ed.W === 900 && ed.H === 700;
            out.editorAtKept = Math.abs(ed.angle - edit1.angle) < 1e-6 && Math.abs(ed.snapshot().n.x0 - edit1.n.x0) < 1e-3;
            out.doneLabel = document.getElementById('crop-save').textContent;
            ed.setAngle(0);
            ed.setRect({ x0: -300, y0: -200, x1: 300, y1: 200 });
            await app.saveCrop();
            out.recropped = !!f('scan1.jpg')._edit && f('scan1.jpg')._edit.angle === 0 && await untouched();
            // Auto's crop went with the kept edit: a test scan (crop-log.js)
            await CropLog._queue;
            {
                const log = await opfsRoot.getDirectoryHandle(CropLog.DIR);
                for await (const [n, h] of log.entries()) {
                    if (/scan1\.jpg\.json$/.test(n)) out.keptLabel = JSON.parse(await (await h.getFile()).text());
                    else if (/scan1\.jpg$/.test(n)) out.keptScan = (await h.getFile()).size === originals['scan1.jpg'].length;
                }
            }
            const re = await app.getDisplaySource(f('scan1.jpg'));
            out.recropShown = [re.w, re.h];

            // A turn is kept too; Ctrl+Z takes it back
            step = 'A turn is kept too; Ctrl+Z takes it back';
            await app.rotateImage(f('plain.jpg'), 90);
            const turned = await app.getDisplaySource(f('plain.jpg'));
            out.turned = f('plain.jpg')._edit && f('plain.jpg')._edit.q === 1 && turned.w === 300 && turned.h === 400 && await untouched();
            await app.undo();
            out.turnUndone = !f('plain.jpg')._edit;
            await app.rotateImage(f('plain.jpg'), -90);

            // Kept with the project: open it again and they're back
            step = "Kept with the project: open it again and they're back";
            // (straight away, the last change maybe not written yet: it is
            // before the project is read again)
            await app.openDirectory(dir);
            // (kept edits can come a moment after the photos)
            await until(() => app.files.length === 3 && Edits.count() === 3);
            out.reloaded = Edits.on() && !!f('scan1.jpg')._edit && f('scan1.jpg')._edit.angle === 0 && !!f('plain.jpg')._edit && f('plain.jpg')._edit.q === 3 && /3 edits/.test(barText());

            // Export copies: every photo, the edited ones with their edits
            step = 'Export copies: every photo, the edited ones with their edits';
            await until(() => Edits.count() === 3);
            UI.choose = async () => 'alt';
            UI.prompt = async () => '';
            await Edits.saveAll();
            const exp = await dir.getDirectoryHandle('jEditor Export');
            out.exported = [await dims(exp, 'scan1.jpg'), await dims(exp, 'scan2.jpg'), await dims(exp, 'plain.jpg')];
            out.exportLeavesEdits = Edits.count() === 3 && await untouched();

            // Save into the photos
            step = 'Save into the photos';
            await until(() => Edits.count() === 3 && !app._savingEdits);
            UI.choose = async () => 'ok';
            await Edits.saveAll();
            out.saved = [await dims(dir, 'scan1.jpg'), await dims(dir, 'scan2.jpg'), await dims(dir, 'plain.jpg')];
            out.plainLossless = readOrientation(await bytes(dir, 'plain.jpg')) === 8;
            out.savedClears = Edits.count() === 0 && !f('scan1.jpg')._gridEl.querySelector('.tile-edit') && /kept until you save/.test(barText());
            const backups = await (await dir.getDirectoryHandle('.jeditor')).getDirectoryHandle('originals');
            out.backups = 0;
            for await (const e of backups.values()) out.backups++;

            // One Ctrl+Z: the photos back, the edits kept again
            step = 'One Ctrl+Z: the photos back, the edits kept again';
            // (a lossless turn undone keeps its orientation tag: the same
            // picture, not quite the same bytes)
            await app.undo();
            const upright = (await dims(dir, 'plain.jpg')).join('x') === '400x300';
            out.undoSave = await same('scan1.jpg') && await same('scan2.jpg') && upright && Edits.count() === 3;

            // Turned off with edits waiting: discard them
            step = 'Turned off with edits waiting: discard them';
            UI.choose = async () => 'alt';
            await Edits.setDefer(false);
            await until(async () => !(await kept()));
            out.off = !Edits.on() && Edits.count() === 0 && bar().classList.contains('hidden') && !(await kept()) &&
                await same('scan1.jpg') && (await dims(dir, 'plain.jpg')).join('x') === '400x300';
            return out;
            })(); } catch (err) { return { crash: `${step}: ${err.message}`, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }; }
        });
        check('kept edits: the steps all ran', !r.crash, `${r.crash} — toasts: ${r.toasts}`);
        if (r.crash) { await page.close(); } else {
        const inside = (d) => d[0] < 900 && d[1] < 700 && d[0] > 450 && d[1] > 300;
        check('kept edits: on for the project; the bar shows; saved in edits.json', r.barOffAtFirst && r.on, JSON.stringify(r));
        check('kept edits: batch Auto crop keeps crops as edits, nothing written', r.autoKept && /check them, then Save/.test(r.autoToast), r.autoToast);
        check('kept edits: pencil on edited photos; the bar counts them', r.badges && r.barCount === '2 edits not saved yet', r.barCount);
        check('kept edits: thumbnail and viewer show the photo as it will be saved', r.thumbAspect > 1.33 && r.tileShows && inside(r.shown), `${r.thumbAspect} ${r.tileShows} ${r.shown}`);
        check('kept edits: recrop opens on the whole photo at the kept crop', r.editorWhole && r.editorAtKept && r.doneLabel === 'Done');
        check('kept edits: a new crop replaces the kept one, still nothing written', r.recropped && r.recropShown.join('x') === '600x400', String(r.recropShown));
        check('kept edits: a batch Auto crop changed in the editor is an Auto crop test (corrected), with the photo as the scan', r.keptLabel && r.keptLabel.result === 'corrected' && r.keptLabel.auto && r.keptLabel.auto.found && r.keptLabel.W === 900 && r.keptScan, JSON.stringify(r.keptLabel && { result: r.keptLabel.result, W: r.keptLabel.W, scan: r.keptScan }));
        check('kept edits: a turn is kept too; Ctrl+Z takes it back', r.turned && r.turnUndone);
        check('kept edits: still there when the project is opened again', r.reloaded);
        check('kept edits: export copies all photos with their edits, photos untouched', r.exported[0].join('x') === '600x400' && inside(r.exported[1]) && r.exported[2].join('x') === '300x400' && r.exportLeavesEdits, JSON.stringify(r.exported));
        check('kept edits: save writes them into the photos (a turn losslessly), originals kept', r.saved[0].join('x') === '600x400' && inside(r.saved[1]) && r.saved[2].join('x') === '300x400' && r.plainLossless && r.savedClears && r.backups === 2, JSON.stringify(r.saved) + ' ' + r.backups);
        check('kept edits: Ctrl+Z after saving puts the photos back with the edits kept', r.undoSave);
        check('kept edits: turning it off can discard what is waiting', r.off);
        check('kept edits suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
        }
    }

    // ---- 7s2b. Pictures on the system clipboard ----
    console.log('copy and paste pictures');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
        const r = await page.evaluate(async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const until = async (fn, n = 200) => { for (let i = 0; i < n && !(await fn()); i++) await sleep(50); };
            const size = async (blob) => { const b = await createImageBitmap(blob); const s = [b.width, b.height]; b.close(); return s; };
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('clipimg', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('clipimg', { create: true });
            const fh = await dir.getFileHandle('scan.jpg', { create: true });
            const w = await fh.createWritable(); await w.write(new Blob([await makeRealJpeg(600, 400)], { type: 'image/jpeg' })); await w.close();
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            await until(() => app.files.length === 1 && !app.isLoading);
            const f = app.files[0];
            // Turned a quarter, not saved yet: copied as it looks
            Edits.set([{ file: f, edit: { q: 1, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } } }], 'test');
            app.openSingle(f);
            await sleep(300);
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
            let copied = null;
            await until(async () => {
                try {
                    for (const item of await navigator.clipboard.read()) if (item.types.includes('image/png')) copied = await item.getType('image/png');
                } catch (e) { /* not yet */ }
                return copied;
            });
            out.copied = copied ? await size(copied) : null;
            out.photoUntouched = (await size(await fh.getFile())).join() === '600,400';
            // A picture from another app: Pasted.png in the project, open in Paint
            const c = document.createElement('canvas');
            c.width = 120; c.height = 80;
            c.getContext('2d').fillStyle = '#c33';
            c.getContext('2d').fillRect(0, 0, 120, 80);
            const png = await new Promise(res => c.toBlob(res, 'image/png'));
            const dt = new DataTransfer();
            dt.items.add(new File([png], 'image.png', { type: 'image/png' }));
            document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            await until(() => Modes.current() === 'paint' && PaintEditor.file && PaintEditor.file.name === 'Pasted.png');
            out.inPaint = Modes.current() === 'paint' && !!PaintEditor.file && PaintEditor.file.name;
            out.pasted = await size(await (await dir.getFileHandle('Pasted.png')).getFile()).catch(() => null);
            await Modes.go('photos');
            return out;
        });
        check('Ctrl+C copies the photo as it looks (turned, not saved yet), leaving the file as it is', r.copied && r.copied.join() === '400,600' && r.photoUntouched, JSON.stringify(r));
        check('a picture pasted from another app is saved as Pasted.png in the project and opened in Paint', r.inPaint === 'Pasted.png' && r.pasted && r.pasted.join() === '120,80', JSON.stringify(r));
        check('copy and paste pictures: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7s3. Undo history ----
    console.log('undo history');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('history', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('history', { create: true });
            for (const n of ['a.jpg', 'b.jpg', 'c.jpg']) {
                const fh = await dir.getFileHandle(n, { create: true });
                const w = await fh.createWritable(); await w.write(new Blob([await makeRealJpeg(120, 80)], { type: 'image/jpeg' })); await w.close();
            }
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            app.setView('grid');
            const f = (n) => app.files.find(x => x.name === n);
            const key = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));

            out.button = !!document.querySelector('#header-controls [data-hc="history"]:not(.hidden):not(.hc-extra)');
            key('h');
            out.empty = History.isOpen() && !document.getElementById('history-empty').classList.contains('hidden');
            key('Escape');
            out.closed = !History.isOpen();

            // Four steps: a star, a rename, a red label, a rotation
            Flags.apply('star', [f('a.jpg')]);
            await app.renameFile(f('b.jpg'), 'Smith_02.jpg');
            Flags.apply('red', [f('c.jpg')]);
            await app.rotateImage(f('c.jpg'), 90);
            document.getElementById('btn-history').click();
            const rows = () => [...document.querySelectorAll('#history-list .history-row')];
            out.rows = rows().map(r => r.querySelector('.history-what').textContent + ':' + r.querySelector('.history-detail').textContent);

            // Back to before the rename: asks first, then undoes three steps
            let asked = null;
            UI.confirm = async (o) => { asked = o; return false; };
            rows()[2].click();
            await sleep(50);
            out.askedFirst = !!asked && asked.title === 'Go back 3 steps?' && asked.items.length === 3 && rows().length === 4 && !!f('Smith_02.jpg');
            UI.confirm = async (o) => { asked = o; return true; };
            rows()[2].click();
            for (let i = 0; i < 100 && (History._running || rows().length !== 1); i++) await sleep(50);
            out.wentBack = rows().length === 1 && !!f('b.jpg') && !Flags.has(f('c.jpg'), 'red') && Flags.has(f('a.jpg'), 'star') && !f('c.jpg').pendingRotation;
            out.toast = [...document.querySelectorAll('.toast')].map(t => t.textContent).find(t => /Went back/.test(t)) || '';
            out.left = rows().map(r => r.querySelector('.history-what').textContent).join();
            // Info closes it
            app.toggleInfoPanel(true);
            out.infoCloses = !History.isOpen();
            return out;
        });
        check('history: a toolbar button and H open it; empty says so; Esc closes', r.button && r.empty && r.closed, JSON.stringify(r));
        check('history: every step, newest first, with what and which photo', JSON.stringify(r.rows) === JSON.stringify(['Rotation:c.jpg', 'Red label:c.jpg', 'Rename:b.jpg → Smith_02.jpg', 'Star:a.jpg']), JSON.stringify(r.rows));
        check('history: clicking a step asks first, naming what is undone', r.askedFirst);
        check('history: then goes back to before it, saying so once', r.wentBack && /Went back 3 steps/.test(r.toast) && r.left === 'Star', r.toast + ' ' + r.left);
        check('history: Info closes it', r.infoCloses);
        check('history suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7t. A subfolder of an order opened before ----
    console.log('subfolder of a known order');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('parentorder', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('parentorder', { create: true });
            const bytes = await makeRealJpeg(200, 140);
            const put = async (d, name) => {
                const fh = await d.getFileHandle(name, { create: true });
                const w = await fh.createWritable(); await w.write(new Blob([bytes], { type: 'image/jpeg' })); await w.close();
            };
            await put(dir, 'a.jpg');
            const sub = await dir.getDirectoryHandle('Ceremony', { create: true });
            await put(sub, 'c1.jpg');
            await put(sub, 'c2.jpg');
            await dir.getDirectoryHandle('.jeditor', { create: true });
            Recents.list = async () => [{ id: 'p', name: 'parentorder', handle: dir, openedAt: 1 }];
            window.showDirectoryPicker = async () => sub;
            const opening = app.browseFolder();
            for (let i = 0; i < 50 && !Recents.isPromptOpen(); i++) await new Promise(res => setTimeout(res, 20));
            out.asked = Recents.isPromptOpen() && /inside “parentorder”/.test(document.getElementById('op-text').textContent);
            document.getElementById('op-order').click();
            await opening;
            await new Promise(res => setTimeout(res, 300));
            out.order = app.dirHandle === dir && Folders.scope === 'Ceremony' && app.viewMode === 'grid' &&
                app.viewFiles().length === 2 && app.files.length === 3;
            out.noNewJeditor = await sub.getDirectoryHandle('.jeditor').then(() => false, () => true);
            // Just this folder
            const again = app.browseFolder();
            for (let i = 0; i < 50 && !Recents.isPromptOpen(); i++) await new Promise(res => setTimeout(res, 20));
            document.getElementById('op-folder').click();
            await again;
            out.justFolder = app.dirHandle === sub && app.files.length === 2;
            return out;
        });
        check('subfolder: opening a folder inside a known order offers the order', r.asked);
        check('subfolder: the order opens at that folder; no second .jeditor', r.order && r.noNewJeditor, JSON.stringify(r));
        check('subfolder: or just the folder', r.justFolder);
        check('subfolder suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7t2. A subfolder's own .jeditor is merged into the order's ----
    console.log('nested .jeditor merged');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('nestorder', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('nestorder', { create: true });
            const bytes = await makeRealJpeg(200, 140);
            const put = async (d, name, data = bytes) => {
                const fh = await d.getFileHandle(name, { create: true });
                const w = await fh.createWritable(); await w.write(new Blob([data])); await w.close();
            };
            await put(dir, 'a.jpg');
            const sub = await dir.getDirectoryHandle('Ceremony', { create: true });
            await put(sub, 'c1.jpg');
            await put(sub, 'c2.jpg');
            // Ceremony was opened on its own once: flags, a deleted photo, a cache
            const own = await sub.getDirectoryHandle('.jeditor', { create: true });
            await put(own, 'flags.json', JSON.stringify({ version: 1, flags: { 'c1.jpg': { star: true }, 'gone.jpg': { rescan: true } } }));
            await put(await own.getDirectoryHandle('trash', { create: true }), 'old.jpg');
            await put(await (await own.getDirectoryHandle('cache', { create: true })).getDirectoryHandle('thumbs', { create: true }), 'x.img', 'x');
            // The order already has a trashed photo with the same name
            const top = await dir.getDirectoryHandle('.jeditor', { create: true });
            await put(await top.getDirectoryHandle('trash', { create: true }), 'Ceremony - old.jpg');
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            for (let i = 0; i < 100; i++) {
                if (await sub.getDirectoryHandle('.jeditor').then(() => false, () => true)) break;
                await sleep(30);
            }
            out.removed = await sub.getDirectoryHandle('.jeditor').then(() => false, () => true);
            const trash = [];
            for await (const e of (await top.getDirectoryHandle('trash')).values()) trash.push(e.name);
            out.trash = trash.sort().join(',');
            out.flag = Flags.has(app.files.find(f => f.relPath === 'Ceremony/c1.jpg'), 'star');
            await sleep(700);
            const saved = JSON.parse(await (await (await top.getFileHandle('flags.json')).getFile()).text()).flags;
            out.saved = !!(saved['Ceremony/c1.jpg'] && saved['Ceremony/c1.jpg'].star && saved['Ceremony/gone.jpg'] && saved['Ceremony/gone.jpg'].rescan);
            out.photos = app.files.length === 3;
            out.toast = [...document.querySelectorAll('.toast')].map(t => t.textContent).find(t => /Merged/.test(t)) || '';
            return out;
        });
        check('nested .jeditor: merged into the order\'s and removed', r.removed && r.photos, JSON.stringify(r));
        check('nested .jeditor: its deleted photos move to the order\'s trash, named after the folder', r.trash === 'Ceremony - old (2).jpg,Ceremony - old.jpg', r.trash);
        check('nested .jeditor: its flags join the order\'s under the folder\'s path', r.flag && r.saved);
        check('nested .jeditor: says so', /Merged the \.jeditor folder in “Ceremony” into this project's \(2 flags, 1 deleted photo\)/.test(r.toast), r.toast);
        check('nested .jeditor suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7t3. Single view: the controls above the film strip fade away ----
    console.log('single view controls fade');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        await page.setViewportSize({ width: 1200, height: 800 });
        const r = await page.evaluate(async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const dir = makeDir('Fade');
            for (let i = 1; i <= 3; i++) {
                const h = makeHandle(`f${i}.jpg`, await makeRealJpeg(300, 200), 'image/jpeg');
                dir._files.set(h.name, h);
            }
            dir.values = async function* () { yield* dir._files.values(); };
            window.showDirectoryPicker = async () => dir;
            app.CONTROLS_IDLE_MS = 150;
            await app.browseFolder();
            app.setView('single');
            const el = app.singleControls();
            out.shownFirst = !el.classList.contains('idle');
            await sleep(400);
            out.fades = el.classList.contains('idle');
            const move = (x, y) => document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
            const rect = el.getBoundingClientRect();
            move(rect.left + rect.width / 2, rect.top + rect.height / 2);
            out.back = !el.classList.contains('idle');
            await sleep(400);
            out.staysWhileNear = !el.classList.contains('idle');
            move(rect.left + rect.width / 2, 60);
            await sleep(400);
            out.fadesAfterLeaving = el.classList.contains('idle');
            // Customize controls can turn them off altogether
            const box = document.getElementById('cust-single-controls');
            box.checked = false;
            box.dispatchEvent(new Event('change'));
            out.off = getComputedStyle(el).display === 'none' && app.uiPrefs.singleControls === false;
            move(rect.left + rect.width / 2, rect.top + rect.height / 2);
            out.staysOff = getComputedStyle(el).display === 'none';
            app.setView('grid');
            app.setView('single');
            out.offAfterViews = getComputedStyle(el).display === 'none';
            box.checked = true;
            box.dispatchEvent(new Event('change'));
            out.onAgain = getComputedStyle(el).display !== 'none' && !el.classList.contains('idle');
            return out;
        });
        check('single view controls: shown, then fade after a few seconds', r.shownFirst && r.fades, JSON.stringify(r));
        check('single view controls: back while the pointer is there, fade once it leaves', r.back && r.staysWhileNear && r.fadesAfterLeaving, JSON.stringify(r));
        check('single view controls: can be turned off in Customize controls, and on again', r.off && r.staysOff && r.offAfterViews && r.onAgain, JSON.stringify(r));
        check('single view controls suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7t4. Folder details and storage size ----
    console.log('folder details');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('infoorder', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('infoorder', { create: true });
            const put = async (d, name, data) => {
                const fh = await d.getFileHandle(name, { create: true });
                const w = await fh.createWritable(); await w.write(new Blob([data])); await w.close();
            };
            const jpg = await makeRealJpeg(200, 140);
            await put(dir, 'a.jpg', jpg);
            await put(dir, 'b.jpg', jpg);
            await put(dir, 'c.png', await makeRealPng(120, 80, 300));
            const sub = await dir.getDirectoryHandle('Ceremony', { create: true });
            await put(sub, 'c1.jpg', jpg);
            const trash = await (await dir.getDirectoryHandle('.jeditor', { create: true })).getDirectoryHandle('trash', { create: true });
            await put(trash, 'gone.jpg', new Uint8Array(5000));
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            app.setView('grid');
            const rows = () => {
                const dts = [...document.querySelectorAll('#info-list dt')].map(x => x.textContent);
                const dds = [...document.querySelectorAll('#info-list dd')].map(x => x.textContent);
                return Object.fromEntries(dts.map((k, i) => [k.trim(), dds[i]]));
            };
            const title = () => document.querySelector('#info-panel h3').textContent;
            const total = app.files.reduce((n, f) => n + f.size, 0);

            // I in the grid: the order
            app.selection = new Set([app.files[0]]);
            app.updateSelectionUI();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
            await sleep(50);
            let r1 = rows();
            out.order = title() === 'Project' && r1.Photos === '4' && r1.Size === app.formatBytes(total) && r1.Folders === '1' && /JPEG 3 · PNG 1/.test(r1.Types);
            for (let i = 0; i < 50 && rows()['.jeditor'] === 'Adding up…'; i++) await sleep(30);
            r1 = rows();
            out.own = r1['.jeditor'] === app.formatBytes(5000) && /1 photo/.test(r1.Trash || '');
            // Several selected: the selection
            app.selection = new Set(app.files.slice(0, 2));
            app.updateSelectionUI();
            await sleep(50);
            out.selection = title() === 'Selection' && rows().Photos === '2';
            // A folder, with the whole order underneath
            Folders.setScope('Ceremony');
            app.selection.clear();
            app.updateSelectionUI();
            await sleep(50);
            const r2 = rows();
            out.folder = title() === 'Folder' && r2.Name === 'Ceremony' && r2.Photos === '1' && /4 photos/.test(r2['Whole project'] || '');
            out.railTotal = document.getElementById('fr-total').textContent === `1 photo · ${app.formatBytes(app.files.find(f => f.name === 'c1.jpg').size)}`;
            // Folder Info from the folder menu, then single view shows the photo
            Folders.setScope(null);
            Folders.contextItems('Ceremony').find(i => i[0] === 'Folder info')[1]();
            await sleep(50);
            out.menu = title() === 'Folder' && rows().Name === 'Ceremony';
            app.setView('single');
            await sleep(80);
            out.single = title() === 'File info' && rows().Name === app.currentFile.name;
            out.gb = app.formatBytes(3 * 1024 * 1024 * 1024) === '3.00 GB';
            return out;
        });
        check('folder details: I in the grid shows the project: photos, size, folders, types', r.order, JSON.stringify(r));
        check('folder details: how much room .jeditor takes, trash counted', r.own, JSON.stringify(r));
        check('folder details: a selection, a folder with the whole project, Folder Info in the menu', r.selection && r.folder && r.menu, JSON.stringify(r));
        check('folder details: total under the folder list; single view still shows the photo', r.railTotal && r.single && r.gb, JSON.stringify(r));
        check('folder details suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7u. Accent color ----
    console.log('accent color');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
            const out = {};
            app.setAccent('#16a34a');
            out.green = css('--accent-color') === '#16a34a' && css('--on-accent') === '#fff';
            await new Promise(res => setTimeout(res, 400)); // the button's color transition
            out.button = getComputedStyle(document.getElementById('btn-browse-folder')).backgroundColor;
            out.saved = JSON.parse(localStorage.getItem('jeditor.ui')).accent === '#16a34a';
            app.setAccent('#facc15');
            out.lightText = css('--on-accent') === '#111';
            document.querySelector('#cust-accent [data-accent="#2563eb"]').click();
            out.reset = app.uiPrefs.accent === null && css('--accent-color') === '#2563eb';
            return out;
        });
        check('accent: a color changes every accent element', r.green && r.button === 'rgb(22, 163, 74)', r.button);
        check('accent: remembered; dark text on a light accent; blue resets', r.saved && r.lightText && r.reset, JSON.stringify(r));
        check('accent suite: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    // ---- 7. file:// — direct open and standalone build ----
    console.log('beta builds and experiments');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        const r = await page.evaluate(async () => {
            const labels = ['v1.42.0-beta.3', 'v1.41.0-2', 'v1.41.0', 'nonsense'].map(t => Updates.label(t)).join('|');
            app.toggleCustomizePanel(true);
            app.showSettingsPage('experimental');
            const page = document.getElementById('set-page-experimental');
            // Adjust and Paint aren't experiments any more
            const listed = page.classList.contains('active') && !document.getElementById('exp-adjust') && !document.getElementById('exp-paint');
            // One being made: off until turned on, and it stays on
            const saved = Experiments.LIST;
            Experiments.LIST = [{ id: 'trial', title: 'Trial', text: 'Being made', beta: true }];
            Experiments.render();
            const off = Experiments.on('trial');
            let heard = null;
            addEventListener('jeditor-experiments', (e) => { heard = e.detail; }, { once: true });
            document.getElementById('exp-trial').click();
            app.loadUiPrefs();
            const kept = Experiments.on('trial') && app.uiPrefs.experiments.trial === true;
            const unknown = Experiments.on('nothing');
            // A beta has its experiments on to start with
            delete app.uiPrefs.experiments.trial;
            window.APP_BUILD = 'v9.9.0-beta.1';
            const betaOn = Experiments.betaBuild() && Experiments.on('trial');
            delete window.APP_BUILD;
            Experiments.LIST = saved;
            Experiments.render();
            app.toggleCustomizePanel(false);
            return { labels, listed, off, heard, kept, unknown, betaOn };
        });
        check('a beta says which ("1.42.0 beta 3"); a re-release, its version', r.labels === '1.42.0 beta 3|1.41.0|1.41.0|nonsense', r.labels);
        check('Settings → Experimental: Adjust and Paint no longer listed; one being made is on to start with in a beta', r.listed && r.betaOn, JSON.stringify(r));
        check('an experiment is off until turned on; on, it says so and stays on', !r.off && r.heard && r.heard.id === 'trial' && r.heard.on && r.kept && !r.unknown, JSON.stringify(r));
        check('no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    console.log('photos picked, not a folder (Safari on iPhone and iPad)');
    {
        const page = await browser.newPage({ acceptDownloads: true });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        // Safari: no way to open a folder
        await page.addInitScript(() => { Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }); });
        await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
        await page.evaluate(PAGE_HELPERS);
        const start = await page.evaluate(() => ({ available: Picked.available(), button: document.getElementById('btn-browse-folder').textContent.trim() }));
        check('without folders, Open photos picks photos instead', start.available && start.button === 'Open photos', JSON.stringify(start));
        const jpeg = Buffer.from(await page.evaluate(async () => [...await makeRealJpeg(64, 48, { exif: true })]));
        await page.setInputFiles('#picked-input', [
            { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: jpeg },
            { name: 'IMG_0002.jpg', mimeType: 'image/jpeg', buffer: jpeg },
            { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') }
        ]);
        await page.waitForFunction(() => app.files.length === 2 && !app.isLoading, null, { timeout: 10000 });
        const opened = await page.evaluate(() => ({ names: app.files.map(f => f.name).join(), pill: document.getElementById('picked-bar').classList.contains('hidden'), view: !document.getElementById('main-interface').classList.contains('hidden') }));
        check('the photos open (not the other file), with nothing to save yet', opened.names === 'IMG_0001.jpg,IMG_0002.jpg' && opened.pill && opened.view, JSON.stringify(opened));
        const turned = await page.evaluate(async () => {
            await app.rotateImage(app.files[0], 90, true);
            const h = app.files[0].handle;
            return { edited: h.edited, orientation: readOrientation(new Uint8Array(await (await h.getFile()).arrayBuffer())), pill: document.getElementById('picked-count').textContent, shown: !document.getElementById('picked-bar').classList.contains('hidden') };
        });
        check('a turn is kept (losslessly, in place), and Save offers it', turned.edited && turned.orientation === 6 && turned.shown && turned.pill === '1 edited photo', JSON.stringify(turned));
        await page.evaluate(() => {
            navigator.canShare = () => true;
            navigator.share = async ({ files }) => { window.shared = await Promise.all(files.map(async f => [f.name, f.size])); };
        });
        await page.click('#picked-save');
        await page.waitForFunction(() => window.shared, null, { timeout: 5000 }).catch(() => { });
        const shared = await page.evaluate(() => ({ shared: window.shared, hidden: document.getElementById('picked-bar').classList.contains('hidden') }));
        check('Save hands it to the share sheet (Save to Photos or Files), and it\'s saved', JSON.stringify(shared.shared && shared.shared.map(x => x[0])) === '["IMG_0001.jpg"]' && shared.hidden, JSON.stringify(shared));
        // No share sheet: several photos download as a zip
        await page.evaluate(async () => {
            delete navigator.canShare; delete navigator.share;
            Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
            await app.rotateImage(app.files[0], 90, true);
            await app.rotateImage(app.files[1], 270, true);
        });
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#picked-save')]);
        const zipPath = await download.path();
        const zip = fs.readFileSync(zipPath);
        const entries = [];
        for (let o = 0; zip.readUInt32LE(o) === 0x04034b50;) {
            const size = zip.readUInt32LE(o + 18), n = zip.readUInt16LE(o + 26);
            const name = zip.toString('utf8', o + 30, o + 30 + n), data = zip.subarray(o + 30 + n, o + 30 + n + size);
            entries.push({ name, ok: require('zlib').crc32(data) === zip.readUInt32LE(o + 14), size });
            o += 30 + n + size;
        }
        const eocd = zip.readUInt32LE(zip.length - 22) === 0x06054b50 && zip.readUInt16LE(zip.length - 12) === 2;
        check('with no share sheet, several photos download as one zip', download.suggestedFilename() === 'jEditor photos.zip' && eocd && entries.map(e => e.name).join() === 'IMG_0001.jpg,IMG_0002.jpg' && entries.every(e => e.ok && e.size > 0), JSON.stringify([download.suggestedFilename(), entries]));
        const dupes = await page.evaluate(async () => {
            const f = async (n) => new File([new Uint8Array(await (await app.files[0].handle.getFile()).arrayBuffer())], n, { type: 'image/jpeg' });
            await Picked.open([await f('image.jpg'), await f('image.jpg')]);
            return app.files.map(x => x.name).sort().join();
        });
        check('two photos with the same name both open', dupes === 'image (2).jpg,image.jpg', dupes);
        check('no JS errors', errors.length === 0, errors.join('; '));
        await page.close();
    }

    console.log('adjust (develop.js, adjust.js)');
    {
        const { page, issues } = await newPage(browser, `${baseUrl}/index.html`);
        // The maths, on the GPU and the CPU
        const m = await page.evaluate(async () => {
            const out = {};
            out.compact = JSON.stringify(Develop.clean({ exposure: 0.5, contrast: 0, levels: { rgb: [0, 1, 1, 0, 1], r: [0.1, 1, 0.9, 0, 1] }, curve: { rgb: [[0, 0], [1, 1]] }, hsl: { sat: [0, 0, 0, 0, 0, 0, 0, 0] } }));
            out.none = Develop.clean({ exposure: 0, curve: { rgb: [[0, 0], [0.5, 0.5], [1, 1]] } }) === null && !Develop.active({});
            out.clamped = JSON.stringify(Develop.clean({ exposure: 9, tint: -400, levels: { rgb: [0.8, 50, 0.2, 0, 1] } }));
            const id = Develop.tables({}).channels;
            out.identity = [...Array(256).keys()].every(i => Math.abs(id[i * 4] - i / 255) < 1e-6 && Math.abs(id[i * 4 + 2] - i / 255) < 1e-6);
            // +1 EV doubles the light: mid grey 0.5 → toGamma(2 · toLinear(0.5))
            const ev = Develop.tables({ exposure: 1 }).channels;
            out.exposure = Math.abs(ev[128 * 4] - Develop.toGamma(2 * Develop.toLinear(128 / 255))) < 1e-5;
            // A curve never turns back, however its points sit
            const f = Develop.spline([[0, 0], [0.2, 0.6], [0.25, 0.62], [1, 1]]);
            let mono = true, prev = -1;
            for (let i = 0; i <= 200; i++) { const y = f(i / 200); if (y < prev - 1e-9) mono = false; prev = y; }
            out.monotone = mono && Math.abs(f(0.2) - 0.6) < 1e-9;
            // The same picture from the GPU and the CPU (colour table too)
            const c = document.createElement('canvas');
            c.width = 300; c.height = 200;
            const g = c.getContext('2d');
            const img = g.createImageData(300, 200);
            for (let i = 0; i < img.data.length; i += 4) {
                img.data[i] = (i * 7) % 256; img.data[i + 1] = (i * 13) % 256; img.data[i + 2] = (i * 29) % 256; img.data[i + 3] = 255;
            }
            g.putImageData(img, 0, 0);
            const adj = { exposure: 0.4, contrast: 30, shadows: 40, temp: -20, vibrance: 25, saturation: 10, curve: { g: [[0, 0], [0.5, 0.6], [1, 1]] }, hsl: { hue: [20, 0, 0, 0, 0, -30, 0, 0], sat: [0, 0, 0, 40, 0, 0, 0, 0], lum: [0, 0, 0, 0, 0, 30, 0, 0] } };
            const gpu = document.createElement('canvas');
            gpu.width = 300; gpu.height = 200;
            gpu.getContext('2d').drawImage(c, 0, 0);
            out.hasGpu = !!Develop.gpu();
            Develop.applyCanvas(gpu, adj);
            const a = gpu.getContext('2d').getImageData(0, 0, 300, 200).data;
            const b = Develop.applyCPU(new Uint8ClampedArray(img.data), Develop.tables(adj));
            let worst = 0;
            for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
            out.gpuCpu = worst;
            // In tiles: the same
            const tiled = document.createElement('canvas');
            tiled.width = 300; tiled.height = 200;
            tiled.getContext('2d').drawImage(c, 0, 0);
            Develop.TILE = 64;
            Develop.applyCanvas(tiled, adj);
            Develop.TILE = 2048;
            const t = tiled.getContext('2d').getImageData(0, 0, 300, 200).data;
            out.tiles = t.every((v, i) => Math.abs(v - a[i]) <= 1);
            // Auto color takes a cast off
            const cast = new Uint8ClampedArray(64 * 64 * 4);
            for (let i = 0; i < cast.length; i += 4) { const v = (i / 4) % 64 * 2; cast[i] = 110 + v; cast[i + 1] = 90 + v * 0.8; cast[i + 2] = 60 + v * 0.5; cast[i + 3] = 255; }
            const fixed = Develop.applyCPU(cast, Develop.tables(Develop.auto(cast, null, { colour: true })), new Uint8ClampedArray(cast.length));
            const mean = (px, k) => { let s = 0; for (let i = k; i < px.length; i += 4) s += px[i]; return s / (px.length / 4); };
            const spread = (px) => Math.max(mean(px, 0), mean(px, 1), mean(px, 2)) - Math.min(mean(px, 0), mean(px, 1), mean(px, 2));
            out.cast = [Math.round(spread(cast)), Math.round(spread(fixed))];
            // White balance picked from a warm grey makes it grey; a clipped
            // or black patch can't tell
            const warm = new Uint8ClampedArray(9 * 4);
            for (let i = 0; i < warm.length; i += 4) { warm[i] = 140; warm[i + 1] = 128; warm[i + 2] = 112; warm[i + 3] = 255; }
            const wb = Develop.neutralWB(warm);
            const wbOut = Develop.applyCPU(warm, Develop.tables(wb), new Uint8ClampedArray(warm.length));
            const clipped = warm.slice(); clipped[0] = 255;
            out.wbPick = [wb.temp, wb.tint, Math.round(spread(wbOut)), Develop.neutralWB(clipped), Develop.neutralWB(new Uint8ClampedArray(36).fill(5))];
            // Grading, looks, vignette and grain: the GPU and the CPU agree too
            out.fxWorst = 0;
            for (const fx of [{ grade: { s: [200, 60, -10], h: [40, 40, 10] }, gradeBalance: 30 }, { look: 'instant', lookAmount: 150 }, { vignette: -60, vigRound: 40 }, { vignette: 50, vigRound: -60 }, { grain: 70, grainSize: 60 }, { grain: 60, grainColor: 80 }, { halation: 80 }, { look: 'cinestill800t' }, { look: 'trix' }]) {
                const cv = document.createElement('canvas');
                cv.width = 300; cv.height = 200;
                cv.getContext('2d').drawImage(c, 0, 0);
                Develop.TILE = 128;
                Develop.applyCanvas(cv, fx);
                Develop.TILE = 2048;
                const gp = cv.getContext('2d').getImageData(0, 0, 300, 200).data;
                const T = Develop.tables(fx);
                const glow = T.fx && T.fx.hal[0] ? Develop.canvasGlow(c, T) : null;
                const cp = Develop.applyCPU(new Uint8ClampedArray(img.data), T, new Uint8ClampedArray(img.data.length), { x: 0, y: 0, w: 300, W: 300, H: 200, glow });
                for (let i = 0; i < gp.length; i++) out.fxWorst = Math.max(out.fxWorst, Math.abs(gp[i] - cp[i]));
            }
            out.defaults = JSON.stringify(Develop.clean({ vigMid: 50, grainSize: 25, lookAmount: 80, gradeBlend: 50, look: 'nope', grade: { s: [400, 0, 0], h: [370, 20, 0] } }));
            // A vignette darkens the corners, not the middle
            const grey = new Uint8ClampedArray(100 * 100 * 4).fill(128);
            const v = Develop.applyCPU(grey, Develop.tables({ vignette: -80 }), new Uint8ClampedArray(grey.length), { x: 0, y: 0, w: 100, W: 100, H: 100 });
            out.vignette = [v[(50 * 100 + 50) * 4], v[0]];
            // Every film's settings are kept whole
            out.looksWhole = Develop.LOOKS.every(l => { const c = Develop.clean(l.adj); return c && Object.keys(l.adj).every(k => k in c); });
            out.processes = [...new Set(Develop.LOOKS.map(l => l.process))].join();
            // Black and white films see colours their own way: Acros (orthopanchromatic)
            // darkens reds and lightens blues, SFX (extended red) the opposite
            const filmGrey = (look, rgb) => Develop.applyCPU(new Uint8ClampedArray([...rgb, 255]), Develop.tables({ look }), new Uint8ClampedArray(4));
            const red = [200, 40, 40], blue = [40, 60, 200];
            const ac = [filmGrey('acros', red), filmGrey('acros', blue)], sf = [filmGrey('sfx', red), filmGrey('sfx', blue)];
            out.mono = ac[0][0] === ac[0][1] && ac[0][1] === ac[0][2] && ac[0][0] < sf[0][0] && ac[1][0] > sf[1][0];
            // Halation: a red glow round a light in the dark, none far away
            const hc = document.createElement('canvas');
            hc.width = 400; hc.height = 300;
            const hg = hc.getContext('2d');
            hg.fillStyle = '#000'; hg.fillRect(0, 0, 400, 300);
            hg.fillStyle = '#fff'; hg.beginPath(); hg.arc(200, 150, 6, 0, 7); hg.fill();
            Develop.applyCanvas(hc, { halation: 100 });
            const near = hg.getImageData(211, 150, 1, 1).data, far = hg.getImageData(20, 20, 1, 1).data;
            out.halation = [...near.slice(0, 3), far[0]];
            // Detail. Sharpening: more contrast across an edge
            const edge = new Uint8ClampedArray(40 * 10 * 4);
            for (let i = 0; i < 400; i++) { const v = i % 40 < 20 ? 80 : 170; edge.set([v, v, v, 255], i * 4); }
            const sh = Develop.applyDetail(edge.slice(), 40, 10, Develop.detail(Develop.full({ sharpen: 100 })));
            out.sharpen = [sh[(5 * 40 + 19) * 4], sh[(5 * 40 + 20) * 4], sh[(5 * 40 + 5) * 4]];
            // Noise reduction: a noisy flat patch smoother, a strong edge kept
            const noisy = new Uint8ClampedArray(60 * 60 * 4);
            for (let i = 0; i < 3600; i++) {
                const base = i % 60 < 30 ? 60 : 200, nz = ((i * 2654435761) >>> 0) % 21 - 10, c = ((i * 40503) >>> 0) % 31 - 15;
                noisy.set([base + nz + c, base + nz - c, base + nz, 255], i * 4);
            }
            const chroma = (px, k, from, to) => { let a = [], s2 = 0; for (let y = 10; y < 50; y++) for (let x = from; x < to; x++) a.push(px[(y * 60 + x) * 4 + k] - px[(y * 60 + x) * 4 + 1]); const m = a.reduce((p, q) => p + q, 0) / a.length; for (const v of a) s2 += (v - m) ** 2; return Math.sqrt(s2 / a.length); };
            const lum = (px, from, to) => { let a = []; for (let y = 10; y < 50; y++) for (let x = from; x < to; x++) a.push(px[(y * 60 + x) * 4 + 2]); const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / a.length); };
            const nr = Develop.applyDetail(noisy.slice(), 60, 60, Develop.detail(Develop.full({ noise: 80 })));
            const cn = Develop.applyDetail(noisy.slice(), 60, 60, Develop.detail(Develop.full({ colorNoise: 100 })));
            out.noise = [Math.round(lum(noisy, 2, 26)), Math.round(lum(nr, 2, 26)), nr[(30 * 60 + 27) * 4 + 2] < 90 && nr[(30 * 60 + 32) * 4 + 2] > 170];
            out.colorNoise = [Math.round(chroma(noisy, 0, 2, 26)), Math.round(chroma(cn, 0, 2, 26))];
            // In blocks with margins, the same as all at once; left out of small previews
            const big = document.createElement('canvas');
            big.width = 300; big.height = 200;
            big.getContext('2d').drawImage(c, 0, 0);
            const big2 = document.createElement('canvas');
            big2.width = 300; big2.height = 200;
            big2.getContext('2d').drawImage(c, 0, 0);
            const det = { sharpen: 80, sharpMask: 30, noise: 50, colorNoise: 40 };
            Develop.TILE = 64;
            Develop.applyCanvas(big, det);
            Develop.TILE = 2048;
            Develop.applyCanvas(big2, det);
            const b1 = big.getContext('2d').getImageData(0, 0, 300, 200).data, b2 = big2.getContext('2d').getImageData(0, 0, 300, 200).data;
            let worstTile = 0;
            for (let i = 0; i < b1.length; i++) worstTile = Math.max(worstTile, Math.abs(b1[i] - b2[i]));
            out.detailTiles = worstTile;
            const small = document.createElement('canvas');
            small.width = 300; small.height = 200;
            small.getContext('2d').drawImage(c, 0, 0);
            out.previewSkips = Develop.applyCanvas(small, { sharpen: 150 }, { scale: 0.3 }) && small.getContext('2d').getImageData(0, 0, 300, 200).data.every((v, i) => v === img.data[i]);
            // Masks: each kind the same on the GPU and the CPU, in tiles
            out.maskWorst = 0;
            for (const mk of [{ type: 'linear', linear: [0.1, 0.5, 0.6, 0.5], adj: { exposure: 1.5, saturation: -60 } }, { type: 'radial', radial: [0.5, 0.5, 0.3, 0.2, 0.4, 0.5], invert: true, adj: { exposure: -1, temp: 40 } }, { type: 'brush', brush: [{ size: 0.2, feather: 0.5, flow: 1, pts: [0.2, 0.3, 0.7, 0.6] }, { size: 0.05, feather: 0, flow: 1, erase: true, pts: [0.4, 0.4, 0.5, 0.5] }], adj: { exposure: 1, vibrance: 50 } }]) {
                const adjM = { masks: [mk] };
                const cv = document.createElement('canvas');
                cv.width = 300; cv.height = 200;
                cv.getContext('2d').drawImage(c, 0, 0);
                Develop.TILE = 64;
                Develop.applyCanvas(cv, adjM);
                Develop.TILE = 2048;
                const gp = cv.getContext('2d').getImageData(0, 0, 300, 200).data;
                const cp = Develop.applyCPU(new Uint8ClampedArray(img.data), Develop.tables(adjM), new Uint8ClampedArray(img.data.length), { x: 0, y: 0, w: 300, W: 300, H: 200 });
                for (let i = 0; i < gp.length; i++) out.maskWorst = Math.max(out.maskWorst, Math.abs(gp[i] - cp[i]));
            }
            // A mask stays on its spot of the photo when the photo is cropped
            const flat = document.createElement('canvas');
            flat.width = 400; flat.height = 200;
            const fg2 = flat.getContext('2d');
            fg2.fillStyle = '#606060'; fg2.fillRect(0, 0, 400, 200);
            const spot = { masks: [{ type: 'radial', radial: [0.25, 0.5, 0.15, 0.15, 0, 0.1], adj: { exposure: 2 } }] };
            const whole = document.createElement('canvas');
            whole.width = 400; whole.height = 200;
            whole.getContext('2d').drawImage(flat, 0, 0);
            Develop.applyCanvas(whole, spot);
            const ed = CropEditor.fromSnapshot(400, 200, { q: 0, angle: 0, n: { x0: -0.5, y0: -0.5, x1: 0, y1: 0.5 } });
            const left = ed.drawOutput(flat);
            Develop.applyCanvas(left, spot, { map: Develop.cropMap(ed, 400, 200) });
            const at = (cv, x, y) => cv.getContext('2d').getImageData(x, y, 1, 1).data[0];
            out.maskCrop = [at(whole, 100, 100), at(left, 100, 100), at(whole, 300, 100), at(left, 180, 100)];
            out.maskClean = JSON.stringify(Develop.cleanMasks([{ type: 'radial', radial: [0.5, 0.5, 0, 50, 0, 2], adj: { exposure: 9, nope: 3 } }, { type: 'linear', linear: [0.2, 0.2, 0.2, 0.2] }, { type: 'brush', brush: [] }, { type: 'what' }]));
            return out;
        });
        check('adjust: settings kept compact, nothing left is none, out of range brought in',
            m.compact === '{"exposure":0.5,"levels":{"r":[0.1,1,0.9,0,1]}}' && m.none && m.clamped === '{"exposure":5,"tint":-100,"levels":{"rgb":[0.8,9.99,0.81,0,1]}}', JSON.stringify(m));
        check('adjust: no settings change nothing; +1 EV doubles the light; curves never turn back', m.identity && m.exposure && m.monotone, JSON.stringify(m));
        check('adjust: the GPU and the CPU agree (within a level), in tiles too', m.hasGpu && m.gpuCpu <= 1 && m.tiles, JSON.stringify(m));
        check('adjust: Auto color takes the cast off a faded print', m.cast[0] > 40 && m.cast[1] < 8, JSON.stringify(m.cast));
        check('adjust: white balance picked from a warm grey makes it grey; a clipped or black patch is left alone', m.wbPick[0] < 0 && m.wbPick[2] <= 2 && m.wbPick[3] === null && m.wbPick[4] === null, JSON.stringify(m.wbPick));
        check('adjust: grading, looks, vignette and grain agree on the GPU and the CPU, in tiles', m.fxWorst <= 1, JSON.stringify(m.fxWorst));
        check('adjust: settings at their defaults, an unknown look and an empty wheel aren\'t kept', m.defaults === '{"grade":{"h":[10,20,0]}}', m.defaults);
        check('adjust: a vignette darkens the corners and leaves the middle', m.vignette[0] === 128 && m.vignette[1] < 60, JSON.stringify(m.vignette));
        check('adjust: films by process (C-41, E-6, ECN-2, B&W), every one\'s settings kept whole', m.looksWhole && m.processes === 'C-41,E-6,ECN-2,B&W,Creative', JSON.stringify([m.looksWhole, m.processes]));
        check('adjust: black-and-white films see colour their own way (Acros darkens reds, SFX lightens them)', m.mono, JSON.stringify(m.mono));
        check('adjust: sharpening adds contrast at an edge, not on flat ground', m.sharpen[0] < 80 && m.sharpen[1] > 170 && m.sharpen[2] === 80, JSON.stringify(m.sharpen));
        check('adjust: noise reduction smooths a noisy patch and keeps the edge; color noise takes out colour blotches', m.noise[1] < m.noise[0] / 2 && m.noise[2] && m.colorNoise[1] < m.colorNoise[0] / 2, JSON.stringify([m.noise, m.colorNoise]));
        check('adjust: detail in blocks is the same as all at once, and left out of small previews', m.detailTiles <= 1 && m.previewSkips, JSON.stringify([m.detailTiles, m.previewSkips]));
        check('adjust: masks (linear, radial, brush with erase) agree on the GPU and the CPU, in tiles', m.maskWorst <= 1, JSON.stringify(m.maskWorst));
        check('adjust: a mask stays on its spot of the photo when it\'s cropped', m.maskCrop[0] > 150 && Math.abs(m.maskCrop[0] - m.maskCrop[1]) <= 1 && m.maskCrop[2] === 96 && m.maskCrop[3] === 96, JSON.stringify(m.maskCrop));
        check('adjust: masks are checked (sizes and sliders in range, empty or unknown ones dropped)', m.maskClean === '[{"type":"radial","invert":false,"adj":{"exposure":5},"radial":[0.5,0.5,0.002,10,0,1]}]', m.maskClean);
        check('adjust: halation puts a red glow round a light, nothing far from it', m.halation[0] > 40 && m.halation[0] > m.halation[1] * 2 && m.halation[3] === 0, JSON.stringify(m.halation));

        const r = await page.evaluate(async () => {
            let step = 'start';
            try { return await (async () => {
            const out = {};
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const until = async (fn, n = 200) => { for (let i = 0; i < n && !(await fn()); i++) await sleep(50); };
            const key = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
            const opfs = await navigator.storage.getDirectory();
            try { await opfs.removeEntry('adjusted', { recursive: true }); } catch (e) { /* fresh */ }
            const dir = await opfs.getDirectoryHandle('adjusted', { create: true });
            const photo = async (shade) => {
                const c = document.createElement('canvas');
                c.width = 640; c.height = 480;
                const g = c.getContext('2d');
                const grad = g.createLinearGradient(0, 0, 640, 0);
                grad.addColorStop(0, `rgb(${shade - 40},${shade - 50},${shade - 60})`);
                grad.addColorStop(1, `rgb(${shade + 40},${shade + 30},${shade + 20})`);
                g.fillStyle = grad; g.fillRect(0, 0, 640, 480);
                return new Blob([await (await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92))).arrayBuffer()], { type: 'image/jpeg' });
            };
            const originals = {};
            for (const [n, s] of [['a.jpg', 100], ['b.jpg', 120]]) {
                const b = await photo(s);
                const fh = await dir.getFileHandle(n, { create: true });
                const w = await fh.createWritable(); await w.write(b); await w.close();
                originals[n] = new Uint8Array(await b.arrayBuffer());
            }
            const bytes = async (d, n) => new Uint8Array(await (await (await d.getFileHandle(n)).getFile()).arrayBuffer());
            const same = async (n) => { const now = await bytes(dir, n); return now.length === originals[n].length && now.every((v, i) => v === originals[n][i]); };
            const kept = async () => {
                try { return JSON.parse(await (await (await (await dir.getDirectoryHandle('.jeditor')).getFileHandle('edits.json')).getFile()).text()); } catch (e) { return null; }
            };
            const brightness = async (blob) => {
                const bmp = await createImageBitmap(blob);
                const c = document.createElement('canvas'); c.width = 64; c.height = 48;
                const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, 64, 48); bmp.close();
                const px = g.getImageData(0, 0, 64, 48).data;
                let s = 0; for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2];
                return s / (px.length / 4) / 3;
            };
            const f = (n) => app.files.find(x => x.name === n);
            const blobOf = async (src) => src.blob || await (await fetch(src.url)).blob();
            window.showDirectoryPicker = async () => dir;
            await app.browseFolder();
            app.openSingle(f('a.jpg'));
            const before = await brightness(await blobOf(await app.getDisplaySource(f('a.jpg'))));

            // Part of jEditor in a release, nothing to turn on: the mode
            // switch (modes.js) offers it, top left in single view, and the
            // right-click menu
            step = 'shown';
            out.onShown = Modes.shown().some(m => m[0] === 'adjust') && !document.getElementById('mode-float').classList.contains('hidden') && app.buildContextItems(null, true).some(it => it[0] === 'Adjust…');

            // E opens Adjust on the photo
            step = 'E opens Adjust';
            key('e');
            await until(() => Adjust.ready);
            out.open = Adjust.isOpen && !document.getElementById('adjust-editor').classList.contains('hidden') && !!Adjust.gl && !!Adjust.hist && Adjust.hist.n > 0;
            const histBefore = Adjust.hist.l.reduce((s, v, i) => s + v * i, 0) / Adjust.hist.n;
            // A slider, as dragged: the photo and histogram follow
            const slider = document.getElementById('adj-exposure');
            slider.value = '1'; slider.dispatchEvent(new Event('input'));
            slider.dispatchEvent(new Event('change'));
            await sleep(80);
            const histAfter = Adjust.hist.l.reduce((s, v, i) => s + v * i, 0) / Adjust.hist.n;
            out.live = histAfter > histBefore + 20 && document.querySelector('#adj-exposure').closest('.adj-row').querySelector('.adj-num').value === '1.00';
            // Ctrl+Z inside Adjust undoes the slider; Ctrl+Shift+Z redoes it
            key('z', { ctrlKey: true });
            out.undoInside = Adjust.a.exposure === 0;
            key('Z', { ctrlKey: true, shiftKey: true });
            out.redoInside = Adjust.a.exposure === 1;
            // A look: its picture made from this photo, a click puts it on, with an amount
            step = 'looks';
            document.querySelector('.adj-look-tabs [data-tab="B&W"]').click();
            await until(() => document.querySelectorAll('.adj-look canvas').length === Develop.LOOKS.length + 1 && document.querySelector('.adj-look[data-look="trix"] canvas').width > 0);
            out.tabShowsItsFilms = document.querySelector('.adj-look[data-look="portra400"]').classList.contains('hidden') && !document.querySelector('.adj-look[data-look="trix"]').classList.contains('hidden');
            const bwThumb = document.querySelector('.adj-look[data-look="trix"] canvas').getContext('2d').getImageData(10, 10, 1, 1).data;
            out.lookThumbGrey = out.tabShowsItsFilms && Math.abs(bwThumb[0] - bwThumb[1]) <= 3 && Math.abs(bwThumb[1] - bwThumb[2]) <= 3;
            document.querySelector('.adj-look[data-look="trix"]').click();
            await sleep(60);
            out.lookOn = Adjust.result().look === 'trix' && !document.getElementById('adj-look-amount').classList.contains('hidden') && document.querySelector('.adj-look[data-look="trix"]').getAttribute('aria-pressed') === 'true';
            document.querySelector('.adj-look[data-look=""]').click();
            document.querySelector('.adj-look-tabs [data-tab="C-41"]').click();
            out.lookOff = !Adjust.result().look;
            // A grading wheel: dragged out to the right is red, strong
            step = 'wheel';
            const grading = [...document.querySelectorAll('details.adj-sec')].find(d => /Color grading/.test(d.querySelector('summary').textContent));
            grading.open = true;
            await sleep(30);
            const wheel = document.querySelector('.adj-wheel canvas');
            const wr = wheel.getBoundingClientRect();
            const pe = (type, x, y) => wheel.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
            pe('pointerdown', wr.left + wr.width * 0.95, wr.top + wr.height / 2);
            pe('pointerup', wr.left + wr.width * 0.95, wr.top + wr.height / 2);
            const g = Adjust.result().grade.s;
            out.wheel = (g[0] < 5 || g[0] > 355) && g[1] === 100;
            // Presets: saved under a name, and put on again
            step = 'presets';
            const prompt0 = UI.prompt;
            UI.prompt = async () => 'Red shadows';
            await Adjust.savePreset();
            UI.prompt = prompt0;
            Adjust.reset();
            const pr = Adjust.presets().find(p => p.name === 'Red shadows');
            Adjust.setAll(pr.adj);
            out.preset = Adjust.result().grade.s[1] === 100 && Adjust.result().exposure === 1;
            Adjust.resetSection('grading');
            // Masks: a linear gradient drawn on the photo, a brush painted
            step = 'masks';
            const msec = document.getElementById('adj-masks-sec');
            msec.open = true;
            msec.dispatchEvent(new Event('toggle'));
            await sleep(30);
            const ov = document.getElementById('adj-overlay');
            const or = ov.getBoundingClientRect();
            const pd = (type, fx, fy) => ov.dispatchEvent(new PointerEvent(type, { clientX: or.left + or.width * fx, clientY: or.top + or.height * fy, pointerId: 1, bubbles: true }));
            document.querySelector('[data-add-mask="linear"]').click();
            pd('pointerdown', 0.5, 0.1); pd('pointermove', 0.5, 0.3); pd('pointermove', 0.5, 0.5); pd('pointerup', 0.5, 0.5);
            const lin = Adjust.result() && Adjust.result().masks && Adjust.result().masks[0];
            out.linearDrawn = !!lin && lin.type === 'linear' && Math.abs(lin.linear[1] - 0.1) < 0.02 && Math.abs(lin.linear[3] - 0.5) < 0.02;
            document.querySelector('[data-add-mask="brush"]').click();
            pd('pointerdown', 0.2, 0.7); pd('pointermove', 0.4, 0.7); pd('pointermove', 0.6, 0.72); pd('pointerup', 0.6, 0.72);
            const sl = document.getElementById('adj-mask-exposure');
            sl.value = '1.5'; sl.dispatchEvent(new Event('input')); sl.dispatchEvent(new Event('change'));
            await sleep(60);
            const ms = Adjust.result().masks;
            out.brushPainted = ms.length === 2 && ms[1].type === 'brush' && ms[1].brush[0].pts.length >= 4 && ms[1].adj.exposure === 1.5;
            out.maskList = document.querySelectorAll('.adj-mask-item').length === 2;
            Adjust.resetSection('masks');
            out.masksReset = !(Adjust.result() || {}).masks;
            msec.open = false;
            msec.dispatchEvent(new Event('toggle'));
            // Detail: the 1:1 view, from the full photo, moved by a click
            step = 'detail';
            document.getElementById('adj-detail-sec').open = true;
            document.getElementById('adj-detail-sec').dispatchEvent(new Event('toggle'));
            await until(() => Adjust.fullCanvas && document.getElementById('adj-loupe').width > 1);
            const lr0 = { ...Adjust._loupeRect };
            const cr = Adjust.canvas.getBoundingClientRect();
            document.getElementById('adj-stage').dispatchEvent(new PointerEvent('pointerdown', { clientX: cr.left + cr.width * 0.2, clientY: cr.top + cr.height * 0.3, bubbles: true }));
            out.loupe = Adjust.fullCanvas.width === 640 && Adjust._loupeRect.x < lr0.x && !document.getElementById('adj-loupe-box').classList.contains('hidden');
            document.getElementById('adj-detail-sec').open = false;
            document.getElementById('adj-detail-sec').dispatchEvent(new Event('toggle'));
            // White balance picked from the photo: W (or Pick grey), a click on
            // something grey; Esc stops picking without leaving Adjust
            step = 'white balance';
            const pick = document.getElementById('adj-wb-pick');
            const colorSec = pick.closest('details');
            pick.click();
            out.pickOn = Adjust.picking && pick.getAttribute('aria-pressed') === 'true' && colorSec.open;
            key('Escape');
            out.pickEsc = !Adjust.picking && Adjust.isOpen;
            key('w');
            const temp0 = Adjust.a.temp;
            const wr2 = Adjust.canvas.getBoundingClientRect();
            document.getElementById('adj-stage').dispatchEvent(new PointerEvent('pointerdown', { clientX: wr2.left + wr2.width / 2, clientY: wr2.top + wr2.height / 2, button: 0, bubbles: true }));
            await sleep(60);
            const mid = Adjust.base.getContext('2d').getImageData(Adjust.base.width / 2 - 2, Adjust.base.height / 2 - 2, 5, 5).data;
            const midOut = Develop.applyCPU(mid, Develop.tables({ temp: Adjust.a.temp, tint: Adjust.a.tint }), new Uint8ClampedArray(mid.length));
            const avg = (px, k) => { let t = 0; for (let i = k; i < px.length; i += 4) t += px[i]; return t / (px.length / 4); };
            const midSpread = Math.max(avg(midOut, 0), avg(midOut, 1), avg(midOut, 2)) - Math.min(avg(midOut, 0), avg(midOut, 1), avg(midOut, 2));
            out.picked = !Adjust.picking && Adjust.a.temp < 0 && midSpread <= 3 && pick.getAttribute('aria-pressed') === 'false';
            out.wb = [Adjust.a.temp, Adjust.a.tint, Math.round(midSpread)];
            key('z', { ctrlKey: true });
            out.pickUndone = Adjust.a.temp === temp0 && Adjust.a.exposure === 1;
            // Before and after (\\)
            key('\\');
            await sleep(50);
            out.beforeShown = Adjust.before && !document.getElementById('adj-before-tag').classList.contains('hidden');
            key('\\');
            // Done (Enter): kept with the photo, the file isn't touched
            step = 'Done';
            key('Enter');
            await until(async () => (await kept()) && (await kept()).edits['a.jpg']);
            const k1 = await kept();
            out.kept = !Adjust.isOpen && f('a.jpg')._edit && f('a.jpg')._edit.adj.exposure === 1 && k1.defer === false && k1.edits['a.jpg'].adj.exposure === 1 && await same('a.jpg');
            out.noBar = document.getElementById('edits-bar').classList.contains('hidden');
            const shown = await app.getDisplaySource(f('a.jpg'));
            out.shownBrighter = (await brightness(await blobOf(shown))) > before + 25;
            await until(() => f('a.jpg').thumbnailUrl && !f('a.jpg')._thumbStale);
            out.thumbBrighter = (await brightness(await (await fetch(f('a.jpg').thumbnailUrl)).blob())) > before + 25;
            out.pencil = !!document.querySelector('#file-edit:not(.hidden)');

            // A turn on an adjusted photo is kept with it too
            step = 'turn';
            await app.rotateImage(f('a.jpg'), 90);
            out.turnKept = f('a.jpg')._edit.q === 1 && f('a.jpg')._edit.adj.exposure === 1 && await same('a.jpg');
            // Ctrl+Z: the turn back; again: the adjustment gone
            await app.undo();
            await app.undo();
            out.undone = !f('a.jpg')._edit;
            // Back, with saturation off too, for the next steps
            Edits.set([{ file: f('a.jpg'), edit: Edits.withAdj(null, { exposure: 1, saturation: -100 }) }], 'adjustments');

            // Copy and paste onto another photo (grid selection)
            step = 'paste';
            app.setView('grid');
            app.selection = new Set([f('a.jpg')]);
            app.currentFile = f('a.jpg');
            app.updateSelectionUI();
            key('C', { ctrlKey: true, shiftKey: true });
            app.selection = new Set([f('b.jpg')]);
            app.currentFile = f('b.jpg');
            app.updateSelectionUI();
            key('V', { ctrlKey: true, shiftKey: true });
            out.pasted = f('b.jpg')._edit && f('b.jpg')._edit.adj.saturation === -100 && await same('b.jpg');

            // Opened again: the adjustments are still there
            step = 'reopen';
            await Edits.flush();
            await app.browseFolder();
            await until(() => app.files.length === 2 && f('a.jpg') && f('a.jpg')._edit);
            out.reopened = f('a.jpg')._edit.adj.exposure === 1 && f('b.jpg')._edit.adj.saturation === -100;

            // Export: copies with the adjustments, the originals left alone
            step = 'export';
            const prompt = UI.prompt;
            UI.prompt = async () => '';
            await app.exportCopies([f('b.jpg')]);
            UI.prompt = prompt;
            const ex = await (await (await dir.getDirectoryHandle('jEditor Export')).getFileHandle('b.jpg')).getFile();
            const exPx = await (async () => {
                const bmp = await createImageBitmap(ex);
                const c = document.createElement('canvas'); c.width = 8; c.height = 8;
                const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, 8, 8); bmp.close();
                return g.getImageData(4, 4, 1, 1).data;
            })();
            out.exported = Math.max(Math.abs(exPx[0] - exPx[1]), Math.abs(exPx[1] - exPx[2])) <= 3 && await same('b.jpg');

            // Save edits: written into the photo, the edit gone
            step = 'save into photo';
            const choose = UI.choose;
            UI.choose = async () => 'ok';
            await Edits.saveAll({ list: [f('b.jpg')] });
            UI.choose = choose;
            out.saved = !f('b.jpg')._edit && !(await same('b.jpg')) && !!f('a.jpg')._edit;
            return out;
            })(); } catch (e) { return { error: step + ': ' + e.message }; }
        });
        check('adjust: part of jEditor in a release, nothing to turn on (the mode switch and the menu offer it)', r.onShown, JSON.stringify(r));
        check('adjust: E opens it on the GPU, with a histogram', r.open, JSON.stringify(r));
        check('adjust: sliders change the photo and its histogram live; Ctrl+Z / Ctrl+Shift+Z inside; \\ shows before', r.live && r.undoInside && r.redoInside && r.beforeShown, JSON.stringify(r));
        check('adjust: films shown on the photo by process, a click puts one on (with Amount) or takes it off', r.lookThumbGrey && r.lookOn && r.lookOff, JSON.stringify(r));
        check('adjust: a grading wheel takes a hue and strength; presets save and put settings back', r.wheel && r.preset, JSON.stringify(r));
        check('adjust: Detail shows the full photo at 1:1, where you click', r.loupe, JSON.stringify(r));
        check('adjust: Pick grey (W) sets the white balance from a click on the photo, one Ctrl+Z; Esc stops picking', r.pickOn && r.pickEsc && r.picked && r.pickUndone, JSON.stringify(r));
        check('adjust: masks drawn and painted on the photo, with their own sliders', r.linearDrawn && r.brushPainted && r.maskList && r.masksReset, JSON.stringify(r));
        check('adjust: Done keeps it with the photo (edits.json), the file untouched, no Save bar', r.kept && r.noBar, JSON.stringify(r));
        check('adjust: the viewer and the thumbnail show it adjusted, with the pencil', r.shownBrighter && r.thumbBrighter && r.pencil, JSON.stringify(r));
        check('adjust: an adjusted photo\'s turn is kept with it; Ctrl+Z takes both back', r.turnKept && r.undone, JSON.stringify(r));
        check('adjust: Ctrl+Shift+C / V copy the adjustments onto other photos', r.pasted, JSON.stringify(r));
        check('adjust: still there when the project is opened again', r.reopened, JSON.stringify(r));
        check('adjust: Export writes them, Save edits writes them into the photo', r.exported && r.saved, JSON.stringify(r));

        // Without a project (photos picked on a phone): Done writes the photo
        const p = await page.evaluate(async () => {
            const sleep = (ms) => new Promise(res => setTimeout(res, ms));
            const bytes = new Uint8Array(await makeRealJpeg(200, 150, { color: '#555' }));
            await Picked.open([new File([bytes], 'phone.jpg', { type: 'image/jpeg' })]);
            app.openSingle(app.files[0]);
            await app.enterAdjust();
            for (let i = 0; i < 100 && !Adjust.ready; i++) await sleep(30);
            Adjust.a.exposure = 1.5;
            Adjust.changed();
            await app.saveAdjust();
            const h = app.files[0].handle;
            for (let i = 0; i < 100 && !h.edited; i++) await sleep(30);
            const now = new Uint8Array(await (await h.getFile()).arrayBuffer());
            return { edited: h.edited, changed: now.length !== bytes.length || now.some((v, i) => v !== bytes[i]), noEdit: !app.files[0]._edit, closed: !Adjust.isOpen };
        });
        check('adjust: without a project, Done writes the adjustments into the photo', p.edited && p.changed && p.noEdit && p.closed, JSON.stringify(p));
        check('adjust: no JS errors', issues.errors.length === 0, issues.errors.join('; '));
        await page.close();
    }

    console.log('file:// support');
    for (const [label, target] of [
        ['app/index.html', path.join(ROOT, 'app', 'index.html')],
        ['standalone.html', path.join(ROOT, 'standalone.html')]
    ]) {
        const { page, issues } = await newPage(browser, 'file://' + target);
        const r = await page.evaluate(() => ({
            cropper: typeof CropEditor !== 'undefined' && typeof ImageMeta !== 'undefined',
            app: typeof app !== 'undefined',
            dropZoneVisible: !document.getElementById('drop-zone').classList.contains('hidden'),
            fsApi: typeof window.showDirectoryPicker
        }));
        check(`${label}: no JS errors`, issues.errors.length === 0, issues.errors.join('; '));
        check(`${label}: crop editor + app loaded`, r.cropper && r.app);
        check(`${label}: drop zone shown`, r.dropZoneVisible);

        // Thumbnail generation must also work from file:// (blob worker or fallback)
        const thumbOk = await page.evaluate(async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 500; canvas.height = 400;
            const ctx = canvas.getContext('2d');
            const noise = ctx.createImageData(500, 400);
            for (let i = 0; i < noise.data.length; i++) noise.data[i] = (Math.random() * 256) | 0;
            ctx.putImageData(noise, 0, 0);
            const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const file = makeFakeFile('t.png', bytes, 'image/png');
            app.files = [file];
            const url = await app.ensureThumbnail(file, { urgent: true }).catch(() => null);
            return !!url && !!file.thumbnailUrl;
        });
        check(`${label}: thumbnails generate`, thumbOk);
        if (label === 'standalone.html') {
            check('standalone: no network requests fail', issues.failedRequests.length === 0, issues.failedRequests.join('; '));
        }
        console.log(`  info  ${label}: showDirectoryPicker is ${r.fsApi}`);
        await page.close();
    }

    await browser.close();
    server.close();

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
