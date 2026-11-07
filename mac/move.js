// Moving what's in a folder (the projects folder) to another, one item at
// a time, so nothing is ever lost (app/folder-move.js asks). The same as
// the Windows app's src/FolderMove.cs:
//
//   - On the same disk, each item is renamed into place: instant, and
//     whole or not at all.
//   - Across disks, each is copied, then every file is read back and
//     compared with its original, byte for byte; only then is the original
//     removed. A copy that fails or doesn't match is removed and its
//     original stays, and the move stops there.
//
// An item whose name is already taken in the new folder is left where it
// is (and said so), never merged into the other. Hidden items at the top
// (.DS_Store, .something) stay behind too.

const fs = require('fs');
const os = require('os');
const path = require('path');

const skipped = (name) => name.startsWith('.') || name === 'Thumbs.db' || name === 'desktop.ini';

async function items(dir) {
    const out = [];
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
        if (skipped(e.name) || e.isSymbolicLink()) continue;
        if (e.isDirectory() || e.isFile()) out.push({ name: e.name, path: path.join(dir, e.name), dir: e.isDirectory() });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Every folder and file under a folder (links aren't followed)
async function tree(dir) {
    const dirs = [], files = [];
    const walk = async (d) => {
        for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { dirs.push(p); await walk(p); }
            else if (e.isFile()) files.push({ p, size: (await fs.promises.stat(p)).size });
        }
    };
    await walk(dir);
    return { dirs, files };
}

async function size(dir) {
    let folders = 0, files = 0, bytes = 0;
    if (!fs.existsSync(dir)) return { folders, files, bytes };
    for (const it of await items(dir)) {
        if (it.dir) {
            folders++;
            for (const f of (await tree(it.path)).files) { files++; bytes += f.size; }
        } else { files++; bytes += (await fs.promises.stat(it.path)).size; }
    }
    return { folders, files, bytes };
}

// The nearest folder at or above p that's there
function existing(p) {
    let d = path.resolve(p);
    while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
    return d;
}

// The disk a folder is (or would be) on: its free space, its name, and
// whether `from` is on it too
async function space(to, from) {
    const at = existing(to);
    let free = -1;
    try { const s = await fs.promises.statfs(at); free = s.bavail * s.bsize; } catch (e) { /* unknown */ }
    let same = false;
    try { same = !!from && (await fs.promises.stat(from)).dev === (await fs.promises.stat(at)).dev; } catch (e) { /* no */ }
    const vol = at.match(/^\/Volumes\/[^/]+/) || at.match(/^\/(media|run\/media)\/[^/]+\/[^/]+/);
    return { free, drive: vol ? path.basename(vol[0]) : os.platform() === 'darwin' ? 'this Mac' : 'this computer', sameDrive: same };
}

// A folder that can't be moved out of, or into
function refuse(from, to) {
    from = path.resolve(from);
    to = path.resolve(to);
    if (from === to) return 'It\'s the same folder';
    if (to.startsWith(from + path.sep)) return 'The new folder is inside the old one';
    if (from.startsWith(to + path.sep)) return 'The old folder is inside the new one';
    if (from === path.parse(from).root || from === os.homedir() || /^\/Volumes\/[^/]+$/.test(from) || /^\/(media|run\/media)\/[^/]+\/[^/]+$/.test(from))
        return 'jEditor doesn\'t move everything on a disk or in your home folder';
    return null;
}

async function same(a, b) {
    const [x, y] = await Promise.all([fs.promises.open(a, 'r'), fs.promises.open(b, 'r')]);
    try {
        const [sa, sb] = await Promise.all([x.stat(), y.stat()]);
        if (sa.size !== sb.size) return false;
        const bx = Buffer.alloc(1 << 20), by = Buffer.alloc(1 << 20);
        for (let pos = 0; pos < sa.size;) {
            const [{ bytesRead: n }, { bytesRead: m }] = await Promise.all([x.read(bx, 0, bx.length, pos), y.read(by, 0, by.length, pos)]);
            if (n !== m || n === 0) return n === m && pos === sa.size;
            if (!bx.subarray(0, n).equals(by.subarray(0, m))) return false;
            pos += n;
        }
        return true;
    } finally {
        await Promise.all([x.close(), y.close()]);
    }
}

// progress(done, total, moved): bytes across disks, items on one;
// stop.stopped ends it after the item it's on (whose copy is removed)
async function run(from, to, progress, stop = {}) {
    from = path.resolve(from);
    to = path.resolve(to);
    const refused = refuse(from, to);
    if (refused) return { moved: 0, left: [], error: refused };
    if (!fs.existsSync(from)) return { moved: 0, left: [], error: 'The folder isn\'t there any more' };
    await fs.promises.mkdir(to, { recursive: true });
    const list = await items(from);
    const room = await space(to, from);
    const total = room.sameDrive ? list.length : (await size(from)).bytes;
    if (!room.sameDrive && room.free >= 0 && room.free < total) return { moved: 0, left: [], error: `Not enough room on ${room.drive}` };
    let moved = 0, done = 0, last = 0;
    const left = [];
    const tell = (now) => {
        if (!now && Date.now() - last < 250) return;
        last = Date.now();
        progress(done, total, moved);
    };
    tell(true);
    for (const it of list) {
        if (stop.stopped) return { moved, left, stopped: true };
        const target = path.join(to, it.name);
        if (fs.existsSync(target)) { left.push({ name: it.name, why: 'taken' }); continue; }
        if (room.sameDrive) {
            try {
                await fs.promises.rename(it.path, target);
                moved++;
                done++;
                tell();
                continue;
            } catch (e) {
                if (e.code !== 'EXDEV') return { moved, left, error: `${it.name}: ${e.message}` };
                // Another disk after all (a mount inside): copied below
            }
        }
        try {
            const t = it.dir ? await tree(it.path) : { dirs: [], files: [{ p: it.path, size: 0 }] };
            if (it.dir) {
                await fs.promises.mkdir(target);
                for (const d of t.dirs) await fs.promises.mkdir(path.join(target, path.relative(it.path, d)), { recursive: true });
            }
            for (const f of t.files) {
                if (stop.stopped) throw Object.assign(new Error('Stopped'), { stopped: true });
                const copy = it.dir ? path.join(target, path.relative(it.path, f.p)) : target;
                await fs.promises.copyFile(f.p, copy, fs.constants.COPYFILE_EXCL);
                const st = await fs.promises.stat(f.p);
                await fs.promises.utimes(copy, st.atime, st.mtime).catch(() => { });
                if (!(await same(f.p, copy))) throw new Error(`The copy of ${path.basename(f.p)} doesn't match the original`);
                done += st.size;
                tell();
            }
        } catch (e) {
            // The half copy goes; the original was never touched
            await fs.promises.rm(target, { recursive: true, force: true }).catch(() => { });
            if (e.stopped) return { moved, left, stopped: true };
            return { moved, left, error: `${it.name}: ${e.message}` };
        }
        // Copied and checked: now the original goes
        moved++;
        try {
            await fs.promises.rm(it.path, { recursive: true });
        } catch (e) {
            left.push({ name: it.name, why: 'copied' });
        }
        tell(true);
    }
    progress(total, total, moved);
    return { moved, left };
}

module.exports = { size, space, refuse, run };
