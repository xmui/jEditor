// jEditor for Mac: the jEditor UI (../app, or Resources/app in the built
// app) in an Electron window. Electron is Chromium, as WebView2 is on
// Windows, so the UI runs as it does there and in Chrome.
//
// The page edits files through the File System Access API. The browser's
// own way to get a folder handle is its picker, which can't be given a
// path, so this app makes one for any path by dropping that folder onto
// the page (Input.dispatchDragEvent over the DevTools protocol): Chromium
// hands the page a real handle, as for a folder dragged in from Finder,
// and the permission check below grants it without asking. bridge.js, in
// the page, takes the drop and gives jEditor the handle.
//
//   jEditor.app [folder]         open that folder
//   --ui <folder>                run the UI from that folder (or JEDITOR_UI)
//   --user-data <folder>         a different profile
//   --smoke-test <folder>        open it, edit, check on disk, exit 0 or 1

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, screen, session, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const places = require('./places');

// Settings, recent folders and the projects' data are stored under this
// origin: it must never change
const SCHEME = 'app';
const HOST = 'jeditor';
const ORIGIN = `${SCHEME}://${HOST}`;

protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

// ---- Command line ----
function parseArgs(argv) {
    const out = { folder: null, ui: process.env.JEDITOR_UI || null, smoke: null, userData: null };
    // After the executable; `electron .` (not the built app) also passes
    // this folder, wherever among Chromium's own switches
    const args = argv.slice(1).filter(a => app.isPackaged || path.resolve(a) !== __dirname);
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--ui') out.ui = args[++i];
        else if (a === '--smoke-test') out.smoke = args[++i];
        else if (a === '--user-data') out.userData = args[++i];
        else if (!a.startsWith('-') && !out.folder) out.folder = a;
    }
    return out;
}

const opts = parseArgs(process.argv);
if (opts.userData) app.setPath('userData', path.resolve(opts.userData));

const UI = opts.ui ? path.resolve(opts.ui)
    : app.isPackaged ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..', 'app');
const DEV = !app.isPackaged || !!opts.ui;

// ---- Settings this app keeps (window place, last folder picked) ----
const settingsFile = () => path.join(app.getPath('userData'), 'mac.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { /* first run */ }
const saveSettings = () => {
    try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { log('warn', 'Settings not saved: ' + e.message); }
};

function log(level, text) {
    const line = `${new Date().toISOString()} ${level} ${text}`;
    (level === 'error' ? console.error : console.log)(line);
}

// ---- Windows: one project each ----
// webContents id → { win, ready, queue (folders to open once it's ready),
// state (what it shows: { name, path, folders }), focusedAt }
const windows = new Map();
let started = false;
const early = []; // folders from Finder before there's a window

const same = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const records = () => [...windows.values()];
const lastFocused = () => records().sort((a, b) => b.focusedAt - a.focusedAt)[0] || null;

function show(rec) {
    if (rec.win.isMinimized()) rec.win.restore();
    rec.win.show();
    rec.win.focus();
}

function flush(rec) {
    if (!rec.ready) return;
    while (rec.queue.length) rec.win.webContents.send('jeditor', { type: 'openFolder', ...rec.queue.shift() });
}

// Folders to open: from the command line, Finder, the Dock, Open in a new
// window. Already open in a window: that one comes forward. Else a window
// with nothing open takes it, or a new one opens.
function openFolder(p, { smoke = false, fresh = false } = {}) {
    let dir = path.resolve(p);
    try {
        if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir); // a photo: its folder
    } catch (e) {
        log('warn', `Not opened (${e.code || e.message}): ${dir}`);
        return null;
    }
    if (!started) { early.push(dir); return null; }
    const there = records().find(r => same(r.state && r.state.path, dir) || r.queue.some(q => same(q.path, dir)));
    if (there && !smoke) { show(there); return there; }
    // (still loading counts: what's queued opens once it's ready)
    const empty = !fresh && records().find(r => !(r.state && r.state.path) && !r.queue.length);
    const rec = empty || createWindow();
    rec.queue.push({ path: dir, smoke });
    flush(rec);
    if (!smoke) show(rec);
    return rec;
}

// Finder's Open With and the Dock icon; may come before the app is ready
app.on('open-file', (e, p) => {
    e.preventDefault();
    openFolder(p);
});

if (!opts.smoke && !app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', (e, argv) => {
        const again = parseArgs(argv);
        if (again.folder) openFolder(again.folder);
        else if (lastFocused()) show(lastFocused());
        else createWindow();
    });
    app.whenReady().then(start);
}

// A Mac app stays open with no windows (the Dock brings one back); not
// so elsewhere (Electron runs these tests on Linux too)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || opts.smoke) app.quit();
});

// ---- The UI, served at app://jeditor/ ----
function serve() {
    protocol.handle(SCHEME, async (req) => {
        const url = new URL(req.url);
        if (url.host !== HOST) return new Response('Not found', { status: 404 });
        let rel = decodeURIComponent(url.pathname);
        if (rel === '/__host/bridge.js') return net.fetch(pathToFileURL(path.join(__dirname, 'bridge.js')).toString());
        if (rel === '/') rel = '/index.html';
        const file = path.join(UI, rel);
        if (!file.startsWith(UI + path.sep)) return new Response('Not found', { status: 404 });
        if (rel === '/index.html') {
            // bridge.js runs before jEditor's own scripts
            const html = (await fs.promises.readFile(file, 'utf8'))
                .replace(/<script\b/, '<script src="/__host/bridge.js"></script>\n    <script');
            return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
        }
        const res = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
        return res && res.ok ? res : new Response('Not found', { status: 404 });
    });
}

// The page is ours: it may use the file system (and the rest) without
// asking; nothing else is ever loaded in the window
function permissions() {
    const ours = (origin) => typeof origin === 'string' && origin.startsWith(ORIGIN);
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => ours(origin));
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => callback(ours(details.requestingUrl || wc.getURL())));
}

// ---- A folder handle for a path: drop the folder onto the page ----
let minting = Promise.resolve();
function mint(wc, dir) {
    const run = minting.then(async () => {
        if (!fs.statSync(dir).isDirectory()) throw new Error('Not a folder: ' + dir);
        const dbg = wc.debugger;
        const attached = !dbg.isAttached();
        if (attached) dbg.attach('1.3');
        try {
            const data = { items: [], files: [dir], dragOperationsMask: 1 };
            for (const type of ['dragEnter', 'dragOver', 'drop']) {
                await dbg.sendCommand('Input.dispatchDragEvent', { type, x: 4, y: 4, data });
            }
        } finally {
            if (attached) dbg.detach();
        }
    });
    minting = run.catch(() => { });
    return run;
}

// ---- Updates: the newest release's .dmg ----
// From jEditor's GitHub releases (JEDITOR_RELEASES: another address, for
// the tests). Not signed, the app can't replace itself: the .dmg is
// downloaded (checked against GitHub's SHA-256), opened in Finder, and
// jEditor quits so it can be dragged into Applications over this one.
const RELEASES = process.env.JEDITOR_RELEASES || 'https://api.github.com/repos/xmui/jEditor/releases/latest';
let latest = null;

function currentVersion() {
    const m = /APP_VERSION = '([0-9.]+)'/.exec(fs.readFileSync(path.join(UI, 'version.js'), 'utf8'));
    return m ? m[1] : '0.0.0';
}

// "v1.18.1" < "v1.18.1-2" < "v1.19.0"
function parseTag(tag) {
    const m = /(\d+)\.(\d+)\.(\d+)(?:-(\d+))?/.exec(String(tag));
    return m ? [+m[1], +m[2], +m[3], m[4] ? +m[4] : 1] : [0, 0, 0, 0];
}
function isNewer(tag, than) {
    const a = parseTag(tag), b = parseTag(than);
    for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

async function checkUpdate() {
    const res = await net.fetch(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'jEditor' } });
    if (res.status === 404) throw new Error('No releases yet');
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    const json = await res.json();
    const tag = json.tag_name;
    const dmg = (json.assets || []).find(a => /^jEditor-.*-mac\.dmg$/i.test(a.name || ''));
    if (!tag || !dmg) throw new Error(`Release ${tag || '?'} has no Mac app to download`);
    const current = 'v' + currentVersion();
    latest = {
        tag, name: dmg.name, url: dmg.browser_download_url, size: dmg.size || 0,
        sha256: typeof dmg.digest === 'string' && dmg.digest.startsWith('sha256:') ? dmg.digest.slice(7).toLowerCase() : null
    };
    return { current, tag, version: parseTag(tag).slice(0, 3).join('.'), notes: json.body || '', size: latest.size, newer: isNewer(tag, current) };
}

async function installUpdate(wc) {
    if (!latest) await checkUpdate();
    if (!isNewer(latest.tag, 'v' + currentVersion())) throw new Error('This is already the newest version');
    const res = await net.fetch(latest.url);
    if (!res.ok) throw new Error(`The download failed (${res.status})`);
    const total = +res.headers.get('content-length') || latest.size;
    const file = path.join(app.getPath('downloads'), latest.name);
    const part = file + '.part';
    const out = fs.createWriteStream(part);
    const hash = crypto.createHash('sha256');
    let got = 0, told = 0;
    try {
        for await (const chunk of res.body) {
            hash.update(chunk);
            got += chunk.length;
            if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
            if (got - told >= 1 << 20 || got === total) {
                told = got;
                wc.send('jeditor', { type: 'updateProgress', received: got, total });
            }
        }
        await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
    } catch (e) {
        out.destroy();
        fs.rmSync(part, { force: true });
        throw new Error('The download stopped: ' + e.message);
    }
    if (latest.sha256 && hash.digest('hex') !== latest.sha256) {
        fs.rmSync(part, { force: true });
        throw new Error('The download was damaged (its checksum doesn\'t match). Try again.');
    }
    fs.renameSync(part, file);
    const err = await shell.openPath(file);
    if (err) throw new Error('Downloaded to ' + file + ', but it didn\'t open: ' + err);
    log('info', 'Update opened: ' + file);
    setTimeout(() => app.quit(), 1500); // so it can be replaced
    return { ok: true, file };
}

// ---- What the page asks for (bridge.js) ----
const smokeSteps = {};

async function handle(rec, type, data) {
    const wc = rec.win.webContents;
    switch (type) {
        case 'pickFolder': {
            const r = await dialog.showOpenDialog(rec.win, {
                title: data.title || 'Open a folder of photos',
                defaultPath: data.defaultPath || settings.lastPicked || app.getPath('pictures'),
                buttonLabel: 'Open',
                properties: ['openDirectory', 'createDirectory']
            });
            if (r.canceled || !r.filePaths[0]) return { cancelled: true };
            settings.lastPicked = path.dirname(r.filePaths[0]);
            saveSettings();
            return { path: r.filePaths[0] };
        }
        case 'mint':
            await mint(wc, data.path);
            return { ok: true };
        case 'exists':
            return { exists: (data.paths || []).map(p => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }) };
        case 'reveal':
            shell.showItemInFolder(data.path);
            return { ok: true };
        case 'checkUpdate':
            return checkUpdate();
        case 'installUpdate':
            return installUpdate(wc);
        case 'ready':
            rec.ready = true;
            flush(rec);
            return { ok: true };
        case 'theme':
            nativeTheme.themeSource = data.dark ? 'dark' : 'light';
            // (on a Mac the window stays clear, for its material)
            if (data.background && process.platform !== 'darwin') rec.win.setBackgroundColor(data.background);
            return { ok: true };
        case 'lights':
            // The traffic lights, centred on the page's top row of pills
            if (process.platform === 'darwin' && Number.isFinite(data.x) && Number.isFinite(data.y)) {
                rec.win.setWindowButtonPosition({ x: Math.round(data.x), y: Math.round(data.y) });
            }
            rec.lights = { x: data.x, y: data.y };
            return { ok: true, fullscreen: rec.win.isFullScreen() };
        // ---- The sidebar (places.js) ----
        case 'places': {
            const drives = await places.drives();
            return { drives, home: places.home(app) };
        }
        case 'listDir': {
            if (!isDir(data.path)) return { error: 'Not a folder' };
            const drive = (await places.drives()).find(d => d.path === data.path);
            return places.listDir(data.path, drive && drive.name);
        }
        case 'listProjects':
            return { projects: await places.listProjects(data.path) };
        case 'makeFolder':
            return { path: await places.makeFolder(data.parent, data.name) };
        case 'renameFolder':
            return { path: await places.renameFolder(data.path, data.name) };
        case 'countPhotos': {
            const counts = await Promise.all((data.paths || []).map(p => (path.isAbsolute(p) ? places.count(p) : -1)));
            return { counts, limit: places.LIMIT };
        }
        case 'eject': {
            const why = await places.eject(data.path);
            log('info', `Eject ${data.path}: ${why || 'done'}`);
            drivesChanged();
            return why ? { ok: false, error: why } : { ok: true };
        }
        case 'pickPath': {
            const r = await dialog.showOpenDialog(rec.win, {
                title: data.title || 'Choose a folder',
                defaultPath: data.start && isDir(data.start) ? data.start : app.getPath('pictures'),
                buttonLabel: 'Choose',
                properties: ['openDirectory', 'createDirectory']
            });
            return r.canceled || !r.filePaths[0] ? { cancelled: true } : { path: r.filePaths[0] };
        }
        case 'copyFolder': {
            const stop = { stopped: false };
            copies.set(data.copy, stop);
            try {
                const to = await places.copyFolder(data.path, data.dest, (done, total) =>
                    wc.send('jeditor', { type: 'copyProgress', copy: data.copy, done, total }), stop);
                log('info', `Copied ${data.path} to ${to}`);
                drivesChanged();
                return { to };
            } catch (e) {
                if (e.stopped) return { cancelled: true };
                throw e;
            } finally {
                copies.delete(data.copy);
            }
        }
        case 'cancelCopy': {
            const stop = copies.get(data.copy);
            if (stop) stop.stopped = true;
            return { ok: true };
        }
        // ---- Windows ----
        case 'newWindow':
            if (data.path) {
                if (!isDir(data.path)) throw new Error('That folder isn\'t there');
                openFolder(data.path, { fresh: true });
            } else {
                show(createWindow());
            }
            return { ok: true };
        case 'split':
            split(rec);
            return { ok: true };
        case 'state':
            rec.state = { name: data.name || null, path: data.path || null, folders: Array.isArray(data.folders) ? data.folders : [] };
            return { ok: true };
        case 'windows':
            return {
                windows: records().filter(r => r !== rec && r.state && r.state.path)
                    .map(r => ({ id: r.win.webContents.id, name: r.state.name, path: r.state.path, folders: r.state.folders }))
            };
        case 'transfer': {
            const items = await transfer(data.paths || [], data.dest, !!data.copy);
            log('info', `${data.copy ? 'Copied' : 'Moved'} ${items.filter(i => i.to).length} of ${items.length} into ${data.dest}`);
            filesChanged();
            return { items };
        }
        case 'undoTransfer': {
            const errors = await undoTransfer(data.items || [], !!data.copy);
            filesChanged();
            return { errors };
        }
        case 'log':
            log(data.level || 'info', data.text);
            return { ok: true };
        case 'smokeCheck': {
            // Looked at on disk, not taken from the page
            const file = path.join(opts.smoke, ...String(data.name || '').split('/'));
            const there = fs.existsSync(file);
            const ok = data.step === 'deleted' ? !there : data.step === 'restored' ? there : false;
            smokeSteps[data.step] = ok || `${data.name} is ${there ? '' : 'not '}there`;
            return { ok };
        }
        case 'smoke': {
            const steps = { ...data.steps, ...smokeSteps };
            const failed = Object.entries(steps).filter(([, v]) => v !== true);
            const ok = data.ok && !failed.length && !(data.errors || []).length;
            console.log('smoke test ' + (ok ? 'passed' : 'FAILED') + '\n' + JSON.stringify({ steps, errors: data.errors || [], error: data.error || null }, null, 2));
            setTimeout(() => app.exit(ok ? 0 : 1), 100);
            return { ok: true };
        }
    }
    throw new Error('Unknown request: ' + type);
}

ipcMain.handle('jeditor', async (e, type, data) => {
    const rec = windows.get(e.sender.id);
    if (!rec || rec.win.webContents !== e.sender) throw new Error('Not a jEditor window');
    try {
        return await handle(rec, type, data || {});
    } catch (err) {
        return { error: err.message || String(err) };
    }
});

function isDir(p) {
    try { return path.isAbsolute(p) && fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

const copies = new Map(); // folder copies under way: the page's id → { stopped }

// A drive came or went, or its free space changed: every sidebar again
function drivesChanged() {
    for (const r of records()) if (r.ready) r.win.webContents.send('jeditor', { type: 'drivesChanged' });
}

// Every window looks again (photos moved in or out of its project)
function filesChanged() {
    for (const r of records()) if (r.ready) r.win.webContents.send('jeditor', { type: 'filesChanged' });
}

// This window on the left half of its screen, another on the right (the
// last one used, or a new one)
function split(rec) {
    const area = screen.getDisplayMatching(rec.win.getBounds()).workArea;
    const other = records().filter(r => r !== rec).sort((a, b) => b.focusedAt - a.focusedAt)[0] || createWindow();
    const half = Math.floor(area.width / 2);
    [[rec, area.x], [other, area.x + half]].forEach(([r, x]) => {
        if (r.win.isFullScreen()) r.win.setFullScreen(false);
        if (r.win.isMaximized()) r.win.unmaximize();
        // A small screen's half can be under the usual minimum width
        const [minW, minH] = r.win.getMinimumSize();
        if (half < minW) r.win.setMinimumSize(half, minH);
        r.win.setBounds({ x, y: area.y, width: half, height: area.height });
        r.win.show();
    });
    rec.win.focus();
}

// ---- Photos between projects (windows), by path ----
// "Smith.jpg" → "Smith (2).jpg" while the name is taken
function freeName(dir, name) {
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let to = path.join(dir, name);
    for (let n = 2; fs.existsSync(to); n++) to = path.join(dir, `${stem} (${n})${ext}`);
    return to;
}

async function moveFile(from, to) {
    try {
        await fs.promises.rename(from, to);
    } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        // Another disk: copied, then the original removed
        await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
        await fs.promises.unlink(from);
    }
}

// → [{ from, to } or { from, error }], each under a free name in dest
async function transfer(paths, dest, copy) {
    if (!isDir(dest)) throw new Error('The folder to put them in isn\'t there');
    const out = [];
    for (const from of paths) {
        try {
            if (!path.isAbsolute(from) || !fs.existsSync(from)) { out.push({ from, error: 'not there any more' }); continue; }
            if (same(path.dirname(from), dest)) { out.push({ from, error: 'already in that folder' }); continue; }
            const to = freeName(dest, path.basename(from));
            if (copy) await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
            else await moveFile(from, to);
            out.push({ from, to });
        } catch (e) {
            out.push({ from, error: e.message });
        }
    }
    return out;
}

// Undo: the moved ones go back; the copies are removed (they're copies)
async function undoTransfer(items, copy) {
    const out = [];
    for (const { from, to } of items) {
        try {
            if (copy) await fs.promises.unlink(to);
            else if (fs.existsSync(from)) { out.push('another file with that name is in its place'); continue; }
            else await moveFile(to, from);
            out.push(null);
        } catch (e) {
            out.push(e.message);
        }
    }
    return out;
}

// ---- The window ----
function menu() {
    const send = (action) => () => {
        const rec = lastFocused();
        if (rec) rec.win.webContents.send('jeditor', { type: 'menu', action });
        else if (action === 'open') createWindow();
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            role: 'appMenu',
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { label: 'Settings…', accelerator: 'Cmd+,', click: send('settings') },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'File',
            submenu: [
                { label: 'New Window', accelerator: 'Cmd+Shift+N', click: () => show(createWindow()) },
                { label: 'Open Folder…', accelerator: 'Cmd+O', click: send('open') },
                { type: 'separator' },
                { role: 'close' }
            ]
        },
        // Cut, copy, paste and undo in text fields; the page handles ⌘Z
        // and ⌘A on photos itself, before the menu sees them
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                ...(DEV ? [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []),
                { role: 'togglefullscreen' }
            ]
        },
        { role: 'windowMenu' }
    ]));
}

function createWindow() {
    const base = settings.bounds || { width: 1280, height: 860 };
    // A new window beside the others: a step down and right of the last
    const last = lastFocused();
    const bounds = last ? { ...last.win.getBounds(), x: last.win.getBounds().x + 28, y: last.win.getBounds().y + 28 } : base;
    const mac = process.platform === 'darwin';
    const win = new BrowserWindow({
        ...bounds,
        minWidth: 640,
        minHeight: 480,
        show: false,
        title: 'jEditor',
        // No title bar: the traffic lights sit in the page's top row, which
        // moves the window (style.css), and the Mac's own window material
        // shows through the start screen (the rest of the page is solid)
        ...(mac ? {
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 20, y: 34 },
            vibrancy: 'under-window',
            visualEffectState: 'followWindow',
            backgroundColor: '#00000000'
        } : { backgroundColor: '#111111' }),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false
        }
    });
    if (!last && settings.maximized) win.maximize();
    const rec = { win, ready: false, queue: [], state: null, focusedAt: Date.now() };
    const id = win.webContents.id;
    windows.set(id, rec);

    // Nothing but jEditor in the window; links open in the browser
    win.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith(ORIGIN + '/')) e.preventDefault();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('did-start-loading', () => { rec.ready = false; });
    win.on('focus', () => { rec.focusedAt = Date.now(); });
    // In full screen the traffic lights are gone, and so is their room
    const fullscreen = (on) => () => { if (rec.ready) win.webContents.send('jeditor', { type: 'fullscreen', on }); };
    win.on('enter-full-screen', fullscreen(true));
    win.on('leave-full-screen', fullscreen(false));

    // The last window closed is where the next first one opens
    win.on('close', () => {
        settings.maximized = win.isMaximized();
        if (!settings.maximized && !win.isFullScreen()) settings.bounds = win.getBounds();
        saveSettings();
    });
    win.once('ready-to-show', () => {
        if (!opts.smoke) win.show();
    });
    win.on('closed', () => windows.delete(id));

    win.loadURL(`${ORIGIN}/index.html`);
    return rec;
}

function start() {
    serve();
    permissions();
    menu();
    started = true;
    places.watchDrives(drivesChanged);
    const first = createWindow();
    if (opts.smoke) {
        // The drop needs the window on screen, if only just
        first.win.showInactive();
        first.queue.push({ path: path.resolve(opts.smoke), smoke: true });
        setTimeout(() => {
            console.log('smoke test FAILED: timed out');
            app.exit(1);
        }, 120000);
    } else {
        for (const dir of [opts.folder, ...early].filter(Boolean)) openFolder(dir);
    }
}

// The Dock icon clicked with no window open
app.on('activate', () => {
    if (started && !windows.size) createWindow();
});
