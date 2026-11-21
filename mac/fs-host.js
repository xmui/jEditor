// The host's side of the page's file handles (handles.js): the file
// operations, on paths, in Node. main.js answers the page's 'fs' requests
// with them (behind the host-handles switch), and the tests use them to
// serve a page in a browser (test/handles.test.js).
//
// Each behaves as Chromium's own handles do on a folder on disk, errors
// included: they're thrown with the same names (NotFoundError,
// TypeMismatchError, InvalidModificationError, TypeError), and a write
// goes to a file of its own beside the photo, put in its place only on
// close(), so a photo is never left half written.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const fail = (name, message) => { const e = new Error(message); e.name = name; return e; };
const notFound = (what) => fail('NotFoundError', `A requested file or directory could not be found: ${what}`);

// A write in progress is kept as ".<name>.<id>.jeditor-swap" in the same
// folder; listings leave those out
const SWAP = /^\..+\.[0-9a-f]{16}\.jeditor-swap$/;

function checkName(name) {
    if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
        throw fail('TypeError', `Name is not allowed: ${JSON.stringify(name)}`);
    }
}
function checkPath(p) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) throw fail('TypeError', 'Not a path on disk');
}
async function statOf(p) {
    try { return await fs.promises.stat(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw notFound(p); throw e; }
}
const kindOf = (st) => (st.isDirectory() ? 'directory' : 'file');
const info = (st) => ({ kind: kindOf(st), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs });

const writers = new Map(); // id → { target, temp, fd, pos }

const ops = {
    // → { kind, size, mtime }
    async stat({ path: p }) {
        checkPath(p);
        return info(await statOf(p));
    },

    // A folder's entries → { entries: [{ name, kind, size, mtime }] }
    async list({ path: p }) {
        checkPath(p);
        const st = await statOf(p);
        if (!st.isDirectory()) throw fail('TypeMismatchError', 'Not a folder: ' + p);
        const dirents = await fs.promises.readdir(p, { withFileTypes: true });
        const entries = [];
        await Promise.all(dirents.map(async (d) => {
            if (SWAP.test(d.name)) return;
            try {
                // Links are followed, as Chromium does
                const s = d.isSymbolicLink() ? await fs.promises.stat(path.join(p, d.name)) : await fs.promises.lstat(path.join(p, d.name));
                if (!s.isFile() && !s.isDirectory()) return;
                entries.push({ name: d.name, ...info(s) });
            } catch (e) { /* gone, or a broken link */ }
        }));
        return { entries };
    },

    // getFileHandle / getDirectoryHandle → { path, kind, size, mtime }
    async child({ path: p, name, kind, create }) {
        checkPath(p);
        checkName(name);
        const parent = await statOf(p);
        if (!parent.isDirectory()) throw fail('TypeMismatchError', 'Not a folder: ' + p);
        const to = path.join(p, name);
        let st = null;
        try { st = await fs.promises.stat(to); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (st) {
            if (kindOf(st) !== kind) throw fail('TypeMismatchError', `${name} is not a ${kind}`);
            return { path: to, ...info(st) };
        }
        if (!create) throw notFound(to);
        if (kind === 'directory') await fs.promises.mkdir(to);
        else await (await fs.promises.open(to, 'wx')).close();
        return { path: to, ...info(await fs.promises.stat(to)) };
    },

    async remove({ path: p, name, recursive }) {
        checkPath(p);
        checkName(name);
        const to = path.join(p, name);
        const st = await statOf(to);
        if (st.isDirectory()) {
            if (!recursive && (await fs.promises.readdir(to)).some(n => !SWAP.test(n))) {
                throw fail('InvalidModificationError', 'The folder is not empty: ' + to);
            }
            await fs.promises.rm(to, { recursive: true, force: true });
        } else {
            await fs.promises.unlink(to);
        }
        return {};
    },

    // A file to another folder and/or name, over a file there (as
    // Chromium's move does) → { path }. Chromium won't move a folder; nor
    // does this
    async move({ path: from, kind, to: dir, name }) {
        checkPath(from);
        checkPath(dir);
        checkName(name);
        if (kind === 'directory') throw fail('TypeError', 'A folder can\'t be moved');
        const st = await statOf(from);
        if (st.isDirectory()) throw fail('TypeMismatchError', 'Not a file: ' + from);
        const into = await statOf(dir);
        if (!into.isDirectory()) throw fail('TypeMismatchError', 'Not a folder: ' + dir);
        const to = path.join(dir, name);
        if (to === from) return { path: to };
        let there = null;
        try { there = await fs.promises.stat(to); } catch (e) { /* free */ }
        if (there && there.isDirectory()) throw fail('InvalidModificationError', 'A folder has that name: ' + to);
        try {
            await fs.promises.rename(from, to);
        } catch (e) {
            if (e.code !== 'EXDEV') throw e;
            // Another disk: copied (under a swap name, then put in place), then the original removed
            const temp = swapName(to);
            await fs.promises.copyFile(from, temp);
            await fs.promises.rename(temp, to);
            await fs.promises.unlink(from);
        }
        return { path: to };
    },

    // createWritable → { id }. keep: starts with the file's bytes
    async open({ path: p, keep }) {
        checkPath(p);
        const st = await statOf(p);
        if (st.isDirectory()) throw fail('TypeMismatchError', 'Not a file: ' + p);
        const temp = swapName(p);
        if (keep) await fs.promises.copyFile(p, temp);
        const fd = await fs.promises.open(temp, keep ? 'r+' : 'w');
        const id = crypto.randomBytes(8).toString('hex');
        writers.set(id, { target: p, temp, fd, pos: 0 });
        return { id };
    },
    // data: bytes (Uint8Array/Buffer); at: where (null: where it's got to)
    async write({ id, at, data }) {
        const w = writer(id);
        const pos = typeof at === 'number' ? at : w.pos;
        const buf = Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data);
        await w.fd.write(buf, 0, buf.length, pos);
        w.pos = pos + buf.length;
        return {};
    },
    async seek({ id, at }) {
        writer(id).pos = at;
        return {};
    },
    async truncate({ id, size }) {
        const w = writer(id);
        await w.fd.truncate(size);
        if (w.pos > size) w.pos = size;
        return {};
    },
    // The new bytes go in place of the file's
    async close({ id }) {
        const w = writer(id);
        writers.delete(id);
        await w.fd.close();
        try {
            await fs.promises.rename(w.temp, w.target);
        } catch (e) {
            await fs.promises.unlink(w.temp).catch(() => { });
            throw e.code === 'ENOENT' ? notFound(w.target) : e;
        }
        return {};
    },
    async abort({ id }) {
        const w = writers.get(id);
        if (!w) return {};
        writers.delete(id);
        await w.fd.close().catch(() => { });
        await fs.promises.unlink(w.temp).catch(() => { });
        return {};
    },
};

function writer(id) {
    const w = writers.get(id);
    if (!w) throw fail('InvalidStateError', 'That write is closed');
    return w;
}
function swapName(p) {
    return path.join(path.dirname(p), `.${path.basename(p)}.${crypto.randomBytes(8).toString('hex')}.jeditor-swap`);
}

// A request from the page → its answer, or { error: { name, message } }
async function request(op, data) {
    const f = Object.prototype.hasOwnProperty.call(ops, op) ? ops[op] : null;
    if (!f) return { error: { name: 'TypeError', message: 'Unknown file operation: ' + op } };
    try {
        return await f(data || {});
    } catch (e) {
        const name = e && e.code === 'EACCES' || e && e.code === 'EPERM' ? 'NotAllowedError' : (e && e.name) || 'Error';
        return { error: { name: name === 'Error' ? 'InvalidStateError' : name, message: (e && e.message) || String(e) } };
    }
}

// A file's bytes for the page's getFile() (a Range, if asked) → a Response;
// x-fs-error: NotFoundError when it isn't there
async function respond(file, range) {
    // A file that isn't there is said in a header, not with a 404, which
    // the web view would log as an error
    const gone = (name) => new Response(null, { status: 200, headers: { 'x-fs-error': name, 'cache-control': 'no-store' } });
    let st;
    try { st = await fs.promises.stat(file); } catch (e) { return gone('NotFoundError'); }
    if (!st.isFile()) return gone('TypeMismatchError');
    const headers = { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes', 'x-mtime': String(st.mtimeMs) };
    const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
    if (m && (m[1] || m[2])) {
        let start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]);
        let end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
        if (start >= st.size || end < start) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${st.size}` } });
        const buf = Buffer.alloc(end - start + 1);
        const fd = await fs.promises.open(file, 'r');
        try { await fd.read(buf, 0, buf.length, start); } finally { await fd.close(); }
        return new Response(buf, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}` } });
    }
    return new Response(await fs.promises.readFile(file), { headers });
}

module.exports = { request, respond, ops, SWAP };
