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

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

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

// ---- Folders to open: from the command line, Finder, the Dock ----
let win = null;
let pageReady = false;
const toOpen = []; // { path, smoke }

function openFolder(p, smoke = false) {
    let dir = path.resolve(p);
    try {
        if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir); // a photo: its folder
    } catch (e) {
        log('warn', `Not opened (${e.code || e.message}): ${dir}`);
        return;
    }
    toOpen.push({ path: dir, smoke });
    flushOpens();
}

function flushOpens() {
    if (!win || !pageReady) return;
    while (toOpen.length) win.webContents.send('jeditor', { type: 'openFolder', ...toOpen.shift() });
    if (win.isMinimized()) win.restore();
    win.focus();
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
        else if (win) win.focus();
    });
    app.whenReady().then(start);
}

app.on('window-all-closed', () => app.quit());

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

// ---- What the page asks for (bridge.js) ----
const smokeSteps = {};

async function handle(wc, type, data) {
    switch (type) {
        case 'pickFolder': {
            const r = await dialog.showOpenDialog(win, {
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
        case 'ready':
            pageReady = true;
            flushOpens();
            return { ok: true };
        case 'theme':
            nativeTheme.themeSource = data.dark ? 'dark' : 'light';
            if (data.background) win.setBackgroundColor(data.background);
            return { ok: true };
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
    if (!win || e.sender !== win.webContents) throw new Error('Not this window');
    try {
        return await handle(e.sender, type, data || {});
    } catch (err) {
        return { error: err.message || String(err) };
    }
});

// ---- The window ----
function menu() {
    const send = (action) => () => win && win.webContents.send('jeditor', { type: 'menu', action });
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
    const bounds = settings.bounds || { width: 1280, height: 860 };
    win = new BrowserWindow({
        ...bounds,
        minWidth: 640,
        minHeight: 480,
        show: false,
        backgroundColor: '#111111',
        title: 'jEditor',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false
        }
    });
    if (settings.maximized) win.maximize();

    // Nothing but jEditor in the window; links open in the browser
    win.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith(ORIGIN + '/')) e.preventDefault();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('did-start-loading', () => { pageReady = false; });

    const remember = () => {
        if (win.isDestroyed()) return;
        settings.maximized = win.isMaximized();
        if (!settings.maximized && !win.isFullScreen()) settings.bounds = win.getBounds();
        saveSettings();
    };
    win.on('close', remember);
    win.once('ready-to-show', () => {
        if (!opts.smoke) win.show();
    });
    win.on('closed', () => { win = null; });

    win.loadURL(`${ORIGIN}/index.html`);
}

function start() {
    serve();
    permissions();
    menu();
    createWindow();
    if (opts.smoke) {
        // The drop needs the window on screen, if only just
        win.showInactive();
        openFolder(opts.smoke, true);
        setTimeout(() => {
            console.log('smoke test FAILED: timed out');
            app.exit(1);
        }, 120000);
    } else if (opts.folder) {
        openFolder(opts.folder);
    }
}
