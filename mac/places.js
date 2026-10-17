// The sidebar's places on a Mac or Linux (app/places.js asks, through
// bridge.js): the drives (each volume in /Volumes on a Mac: the startup
// disk, USB drives and cards, network shares; on Linux, the computer's own
// disk and what's mounted in /media/<user> or /run/media/<user>), the usual folders, the folders and photos in a
// folder, the projects in the projects folder, photo counts, new folders,
// renames, ejecting, and a whole folder copied (onto a USB drive, say).
//
// JEDITOR_VOLUMES: another folder to list as the drives, each folder in it
// a USB drive (the tests; Electron runs on Linux too). Eject then only
// hides it (renamed to .ejected-…), never touching what's in it.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// RAW files too (app/raw.js shows them from their own JPEG)
const PHOTO = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.heic',
    '.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2', '.srf', '.orf', '.rw2', '.rwl', '.pef', '.srw', '.3fr', '.iiq', '.erf', '.kdc', '.dcr', '.mos', '.mef', '.raf']);
const isPhoto = (name) => !name.startsWith('.') && PHOTO.has(path.extname(name).toLowerCase());
// Folders that aren't shown: hidden ones, and jEditor's own
const hidden = (name) => name.startsWith('.') || name.startsWith('$');
const LIMIT = 1000; // counting stops here: "1,000+" is enough to tell

const TEST_VOLUMES = process.env.JEDITOR_VOLUMES || null;
const LINUX = !TEST_VOLUMES && process.platform === 'linux';
const VOLUMES = TEST_VOLUMES || (process.platform === 'darwin' ? '/Volumes' : null);
// Where Linux mounts USB drives and cards: /media/<user> (Debian, Ubuntu),
// /run/media/<user> (Fedora, Arch)
const USER = (() => { try { return require('os').userInfo().username; } catch (e) { return process.env.USER || ''; } })();
const MEDIA = LINUX ? [`/media/${USER}`, `/run/media/${USER}`, '/media'] : [];

const run = (file, args) => new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 30000 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(String(stdout))));
});

async function space(p) {
    try {
        const s = await fs.promises.statfs(p);
        return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    } catch (e) {
        return { total: 0, free: 0 };
    }
}

// mount point → file system type ("apfs", "smbfs", …), from `mount`
// (Linux: /proc/mounts, and → the device too, for ejecting)
async function mountTypes() {
    const out = new Map();
    if (LINUX) {
        try {
            for (const line of (await fs.promises.readFile('/proc/mounts', 'utf8')).split('\n')) {
                const [dev, at, type] = line.split(' ');
                // Spaces and such in a mount point are written \040 etc.
                if (at) out.set(at.replace(/\\([0-7]{3})/g, (m, o) => String.fromCharCode(parseInt(o, 8))), { type, dev });
            }
        } catch (e) { /* kinds guessed */ }
        return out;
    }
    if (TEST_VOLUMES || process.platform !== 'darwin') return out;
    try {
        for (const line of (await run('/sbin/mount', [])).split('\n')) {
            const m = / on (.+) \(([^,)]+)/.exec(line);
            if (m) out.set(m[1], m[2]);
        }
    } catch (e) { /* kinds guessed */ }
    return out;
}

const NETWORK = new Set(['smbfs', 'afpfs', 'nfs', 'webdav', 'ftp', 'cifs', 'smb3', 'nfs4', 'fuse.sshfs', 'davfs']);
const CD = new Set(['cd9660', 'udf', 'cddafs', 'iso9660']);

// Linux: the computer's own disk, then each drive mounted for this user
async function linuxDrives() {
    const types = await mountTypes();
    const out = [{ path: '/', name: 'Computer', kind: 'disk', label: 'Computer', ...(await space('/')) }];
    const seen = new Set();
    for (const dir of MEDIA) {
        let names = [];
        try { names = await fs.promises.readdir(dir); } catch (e) { continue; }
        for (const name of names) {
            const p = path.join(dir, name);
            const m = types.get(p);
            // Only what's mounted there (/media also holds the users' folders)
            if (!m || seen.has(p) || name.startsWith('.')) continue;
            seen.add(p);
            const kind = NETWORK.has(m.type) ? 'network' : CD.has(m.type) ? 'cd' : 'usb';
            out.push({ path: p, name, kind, label: name, ...(await space(p)) });
        }
    }
    return out;
}

// → [{ path, name, kind: usb|disk|network|cd, label, total, free }]
async function drives() {
    if (LINUX) return linuxDrives();
    if (!VOLUMES) return [];
    let names = [];
    try { names = await fs.promises.readdir(VOLUMES); } catch (e) { return []; }
    const types = await mountTypes();
    const out = [];
    for (const name of names) {
        if (name.startsWith('.')) continue;
        const p = path.join(VOLUMES, name);
        let real;
        try {
            real = await fs.promises.realpath(p);
            if (!(await fs.promises.stat(real)).isDirectory()) continue;
        } catch (e) { continue; }
        // The startup disk is a link to / in /Volumes
        const boot = !TEST_VOLUMES && real === '/';
        const type = types.get(boot ? '/' : p);
        const kind = boot ? 'disk' : NETWORK.has(type) ? 'network' : CD.has(type) ? 'cd' : 'usb';
        out.push({ path: boot ? '/' : p, name, kind, label: name, ...(await space(real)) });
    }
    return out;
}

// Desktop, Pictures, Documents, Downloads (those that are there)
function home(app) {
    return ['desktop', 'pictures', 'documents', 'downloads']
        .map(k => { try { return { name: k[0].toUpperCase() + k.slice(1), path: app.getPath(k) }; } catch (e) { return null; } })
        .filter(h => h && fs.existsSync(h.path));
}

// A folder's folders (not hidden ones), and how many photos are directly in it
async function listDir(p, driveName) {
    let entries;
    try { entries = await fs.promises.readdir(p, { withFileTypes: true }); } catch (e) {
        throw new Error(e.code === 'ENOENT' ? 'That folder isn\'t there any more' : e.message);
    }
    const folders = [];
    let photos = 0, more = false;
    for (const e of entries) {
        if (e.isDirectory() && !hidden(e.name)) folders.push({ name: e.name, path: path.join(p, e.name) });
        else if (e.isFile() && isPhoto(e.name) && !more && ++photos >= LIMIT) more = true;
    }
    const parent = path.dirname(p);
    return { path: p, name: p === '/' ? (driveName || (LINUX ? 'Computer' : 'Macintosh HD')) : path.basename(p), parent: parent === p ? null : parent, folders, photos, more };
}

// The folders in the projects folder, newest first (by when each changed)
async function listProjects(p) {
    let entries;
    try { entries = await fs.promises.readdir(p, { withFileTypes: true }); } catch (e) {
        throw new Error('The projects folder isn\'t there');
    }
    const out = [];
    for (const e of entries) {
        if (!e.isDirectory() || hidden(e.name)) continue;
        const full = path.join(p, e.name);
        try { out.push({ name: e.name, path: full, modified: (await fs.promises.stat(full)).mtimeMs }); } catch (err) { /* gone */ }
    }
    return out.sort((a, b) => b.modified - a.modified);
}

// Photos in a folder and its subfolders, up to LIMIT. Kept per folder while
// it's unchanged, for a minute at most (photos added in a subfolder don't
// change the top folder's time)
const counted = new Map(); // path → { mtime, n, at }
async function count(p) {
    let mtime;
    try { mtime = (await fs.promises.stat(p)).mtimeMs; } catch (e) { return -1; }
    const c = counted.get(p);
    if (c && c.mtime === mtime && Date.now() - c.at < 60000) return c.n;
    let n = 0;
    const walk = async (dir) => {
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entries) {
            if (n >= LIMIT) return;
            if (e.isFile() && isPhoto(e.name)) n++;
            else if (e.isDirectory() && !hidden(e.name)) await walk(path.join(dir, e.name));
        }
    };
    await walk(p);
    counted.set(p, { mtime, n, at: Date.now() });
    return n;
}

// Why a name won't do as a folder's on a Mac, or null
function nameProblem(name) {
    if (!name) return 'A folder needs a name';
    if (name.length > 120) return 'That name is too long';
    // (Linux allows :, but USB drives' FAT and exFAT don't)
    if (/[/:]/.test(name)) return 'A folder\'s name can\'t have / or : in it';
    if (name.startsWith('.')) return 'A name starting with a dot would hide the folder';
    return null;
}

async function makeFolder(parent, name) {
    name = String(name || '').trim();
    const problem = nameProblem(name);
    if (problem) throw new Error(problem);
    if (!fs.existsSync(parent)) throw new Error('The projects folder isn\'t there');
    const p = path.join(parent, name);
    if (fs.existsSync(p)) throw new Error(`There's already a ${name} there`);
    await fs.promises.mkdir(p);
    return p;
}

// → the folder's new path. The project data kept for it moves in the page
// (bridge.js), where it's kept.
async function renameFolder(p, name) {
    name = String(name || '').trim();
    const problem = nameProblem(name);
    if (problem) throw new Error(problem);
    p = p.replace(/\/+$/, '');
    if (!fs.existsSync(p)) throw new Error('That folder isn\'t there');
    const to = path.join(path.dirname(p), name);
    if (to === p) return p;
    const caseOnly = to.toLowerCase() === p.toLowerCase();
    if (!caseOnly && fs.existsSync(to)) throw new Error(`There's already a ${name} there`);
    if (caseOnly) {
        // Through another name: the Mac's disk ignores case
        const step = to + '.jeditor-rename';
        await fs.promises.rename(p, step);
        await fs.promises.rename(step, to);
    } else {
        await fs.promises.rename(p, to);
    }
    return to;
}

// → null when it's gone, else why not
async function eject(p) {
    if (LINUX) return linuxEject(p);
    if (!VOLUMES || path.dirname(p) !== VOLUMES) return 'Only drives can be ejected';
    if (TEST_VOLUMES) {
        await fs.promises.rename(p, path.join(VOLUMES, '.ejected-' + path.basename(p)));
        return null;
    }
    try {
        await run('/usr/sbin/diskutil', ['eject', p]);
        return null;
    } catch (e) {
        const why = String(e.stderr || e.message).trim().split('\n').pop();
        return /in use|busy|dissent/i.test(why) ? 'Something still has a file on it open' : why || 'The Mac couldn\'t eject it';
    }
}

// Unmounted the desktop's way (gio, as the file manager does), else with
// udisksctl, which then powers a USB drive off so it can be pulled out
async function linuxEject(p) {
    const m = (await mountTypes()).get(p);
    if (!m || !MEDIA.includes(path.dirname(p))) return 'Only drives can be ejected';
    try {
        await run('gio', ['mount', '-e', p]);
        return null;
    } catch (e) { /* no gio: udisks */ }
    try {
        await run('udisksctl', ['unmount', '-b', m.dev]);
        await run('udisksctl', ['power-off', '-b', m.dev]).catch(() => { });
        return null;
    } catch (e) {
        const why = String(e.stderr || e.message).trim().split('\n').pop();
        return /busy/i.test(why) ? 'Something still has a file on it open' : why || 'Linux couldn\'t eject it';
    }
}

// ---- A whole folder copied into another ----
const SKIP = new Set(['.jeditor', '.jeditor-trash']);

function freeDir(dir, name) {
    let to = path.join(dir, name);
    for (let n = 2; fs.existsSync(to); n++) to = path.join(dir, `${name} (${n})`);
    return to;
}

const size = (n) => n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : `${Math.round(n / 2 ** 20)} MB`;

// progress(done, total) in bytes as it goes; stop.stopped ends it. A copy
// that fails or is stopped is removed, so no half folder is left. → its path
async function copyFolder(from, destParent, progress, stop) {
    from = path.resolve(from);
    destParent = path.resolve(destParent);
    if (!fs.existsSync(from)) throw new Error('The folder isn\'t there any more');
    if (!fs.existsSync(destParent)) throw new Error('The folder to copy it into isn\'t there');
    if (destParent === from || destParent.startsWith(from + path.sep)) throw new Error('A folder can\'t be copied into itself');
    const dirs = [], files = [];
    const walk = async (dir) => {
        for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (SKIP.has(e.name)) continue;
                dirs.push(p);
                await walk(p);
            } else if (e.isFile()) {
                files.push({ p, size: (await fs.promises.stat(p)).size });
            }
        }
    };
    await walk(from);
    const total = files.reduce((n, f) => n + f.size, 0);
    const room = await space(destParent);
    if (room.total && room.free < total) throw new Error(`Not enough room: it needs ${size(total)}, and ${size(room.free)} is free`);
    const to = freeDir(destParent, path.basename(from));
    let done = 0, last = 0;
    try {
        await fs.promises.mkdir(to);
        for (const d of dirs) await fs.promises.mkdir(path.join(to, path.relative(from, d)), { recursive: true });
        progress(0, total);
        for (const f of files) {
            if (stop.stopped) throw Object.assign(new Error('Stopped'), { stopped: true });
            const target = path.join(to, path.relative(from, f.p));
            await new Promise((resolve, reject) => {
                const src = fs.createReadStream(f.p, { highWaterMark: 1 << 20 });
                const dst = fs.createWriteStream(target, { flags: 'wx' });
                src.on('data', (chunk) => {
                    done += chunk.length;
                    if (stop.stopped) { src.destroy(); dst.destroy(); return reject(Object.assign(new Error('Stopped'), { stopped: true })); }
                    if (Date.now() - last > 250) { last = Date.now(); progress(done, total); }
                });
                src.on('error', reject);
                dst.on('error', reject);
                dst.on('finish', resolve);
                src.pipe(dst);
            });
            const st = await fs.promises.stat(f.p);
            await fs.promises.utimes(target, st.atime, st.mtime);
        }
        progress(total, total);
        return to;
    } catch (e) {
        await fs.promises.rm(to, { recursive: true, force: true }).catch(() => { });
        throw e;
    }
}

// Drives coming and going: listener() a moment after /Volumes changes
function watchDrives(listener) {
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(listener, 500); };
    for (const dir of LINUX ? MEDIA : VOLUMES ? [VOLUMES] : []) {
        try { fs.watch(dir, soon); } catch (e) { /* not there or not watchable: refreshed when the sidebar draws */ }
    }
}

module.exports = { drives, home, listDir, listProjects, count, LIMIT, makeFolder, renameFolder, eject, copyFolder, watchDrives };
