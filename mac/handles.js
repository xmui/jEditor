// jEditor's file handles made by the host: FileSystemDirectoryHandle and
// FileSystemFileHandle look-alikes, backed by the app's own file calls
// (fs-host.js), for web views without File System Access on real folders
// (WebKit: the Mac's WKWebView, Linux's WebKitGTK; docs/plans/lighter-desktop.md).
// The page's own code doesn't change: they behave as Chromium's do, errors
// included (test/handles-conformance.js).
//
// Nothing here knows the transport: the host gives
//   HostHandles.install({
//     call(op, data) → Promise of the answer, or { error: { name, message } },
//     fileUrl(path) → a URL serving the file's bytes (Range-capable),
//     pathOf(file) → where a dropped File is on disk (or null),
//     pick: { folder(), files({ multiple, types }), save({ suggestedName, types }) }
//       → a path (paths for files), or null if canceled; each optional (the
//       Mac app's bridge has its own folder picker)
//   })
// and gets back { folder(path) → a directory handle, file(path), isOurs(h), pathOf(h) }.
//
// Under Electron it's behind a switch (JEDITOR_HOST_HANDLES=1, main.js),
// off by default, so the handles are proven on Chromium first.
//
// Besides the handles:
//  - getFile() fetches the bytes; peek() and stat() give size and date
//    without reading the file (the folder scan and Watch use them)
//  - handles kept in IndexedDB (Recents, the bridge's folders) are stored as
//    { __jeHost: { kind, path } } and come back as handles
//  - the pickers (open, save) and a dropped item's getAsFileSystemHandle()
//    give these handles

(() => {
    if (window.HostHandles) return;

    const MAX_CHUNK = 8 * 1024 * 1024; // bytes per write call

    // File types as Chromium names them from the extension (none for HEIC,
    // MOV or RAW files: the page goes by the name)
    const TYPES = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/vnd.microsoft.icon', svg: 'image/svg+xml',
        tif: 'image/tiff', tiff: 'image/tiff', jxl: 'image/jxl',
        txt: 'text/plain', text: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'text/xml',
        html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
        pdf: 'application/pdf', zip: 'application/zip', mp4: 'video/mp4', m4v: 'video/mp4',
        webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', wasm: 'application/wasm', bin: 'application/octet-stream'
    };
    const typeOf = (name) => TYPES[(/\.([^.]+)$/.exec(name) || [])[1]?.toLowerCase()] || '';

    const baseName = (p) => p.replace(/\/+$/, '').split('/').pop() || p;
    const join = (dir, name) => (dir.endsWith('/') ? dir : dir + '/') + name;

    function error(e) {
        const name = e && e.name || 'InvalidStateError';
        const message = e && e.message || 'The file operation failed';
        return name === 'TypeError' ? new TypeError(message) : new DOMException(message, name);
    }
    function checkName(name) {
        if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
            throw new TypeError(`Name is not allowed: ${JSON.stringify(name)}`);
        }
    }

    let T = null; // the transport
    async function call(op, data) {
        const r = await T.call(op, data);
        if (r && r.error) throw error(r.error);
        return r || {};
    }

    // ---- The handles ----
    // Their only own property is __jeHost, so a copy (IndexedDB) carries
    // just that; revive() turns it back into a handle
    class Handle {
        constructor(kind, path) {
            this.__jeHost = { kind, path };
        }
        get kind() { return this.__jeHost.kind; }
        get name() { return baseName(this.__jeHost.path); }
        async isSameEntry(other) {
            const o = other && other.__jeHost;
            return !!o && o.kind === this.kind && o.path === this.__jeHost.path;
        }
        // The app has the disk, as on Windows: nothing to ask
        async queryPermission() { return 'granted'; }
        async requestPermission() { return 'granted'; }
        async move(a, b) {
            let dir, name;
            if (typeof a === 'string') { dir = null; name = a; }
            else if (a && a.__jeHost) { dir = a; name = b === undefined ? this.name : b; }
            else throw new TypeError('move() takes a new name, a folder, or both');
            checkName(name);
            const to = dir ? dir.__jeHost.path : this.__jeHost.path.replace(/\/[^/]+\/*$/, '') || '/';
            if (dir && dir.kind !== 'directory') throw new TypeError('Not a folder');
            const r = await call('move', { path: this.__jeHost.path, kind: this.kind, to, name });
            this.__jeHost.path = r.path;
            if (this._info) this._info = null;
        }
    }

    class FileHandle extends Handle {
        constructor(path, info) {
            super('file', path);
            // Size and date from the listing that found it (peek); not copied
            Object.defineProperty(this, '_info', { value: info || null, writable: true, enumerable: false });
        }
        async getFile() {
            const res = await fetch(T.fileUrl(this.__jeHost.path), { cache: 'no-store' });
            const gone = res.headers.get('x-fs-error');
            if (gone) throw new DOMException(gone === 'NotFoundError' ? 'A requested file or directory could not be found.' : 'Not a file', gone);
            if (!res.ok) throw new DOMException('The file couldn\'t be read', 'NotReadableError');
            const blob = await res.blob();
            const mtime = +res.headers.get('x-mtime') || Date.now();
            return new File([blob], this.name, { type: typeOf(this.name), lastModified: Math.floor(mtime) });
        }
        // Size and date as the listing found them, without reading the file
        // (null: not from a listing; the page reads it instead)
        peek() {
            return this._info ? { size: this._info.size, lastModified: Math.floor(this._info.mtime) } : null;
        }
        // Size and date now, without reading the file
        async stat() {
            const s = await call('stat', { path: this.__jeHost.path });
            if (s.kind !== 'file') throw new DOMException('Not a file', 'TypeMismatchError');
            return { size: s.size, lastModified: Math.floor(s.mtime) };
        }
        async createWritable(opts = {}) {
            const { id } = await call('open', { path: this.__jeHost.path, keep: !!opts.keepExistingData });
            return writable(id);
        }
    }

    // A FileSystemWritableFileStream's methods; each call waits for the one before
    function writable(id) {
        let chain = Promise.resolve();
        let done = false;
        const queue = (f) => {
            const run = chain.then(() => {
                if (done) throw new TypeError('The writable is closed');
                return f();
            });
            chain = run.catch(() => { });
            return run;
        };
        const bytes = async (data) => {
            if (typeof data === 'string') return new TextEncoder().encode(data);
            if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
            if (data instanceof ArrayBuffer) return new Uint8Array(data);
            if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            throw new TypeError('write() takes a string, a Blob, an ArrayBuffer or a typed array');
        };
        const put = async (data, at) => {
            const b = await bytes(data);
            let pos = typeof at === 'number' ? at : null;
            if (!b.length && pos === null) return;
            for (let i = 0; i < b.length || i === 0; i += MAX_CHUNK) {
                // A copy of just this part: a view would send the whole buffer
                const part = b.slice(i, i + MAX_CHUNK);
                await call('write', { id, at: pos === null ? null : pos + i, data: part });
                if (!b.length) break;
            }
        };
        const w = {
            write: (data) => queue(async () => {
                if (data && typeof data === 'object' && !(data instanceof Blob) && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
                    if (data.type === 'seek') return call('seek', { id, at: data.position });
                    if (data.type === 'truncate') return call('truncate', { id, size: data.size });
                    if (data.type === 'write' || data.type === undefined) return put(data.data, data.position);
                    throw new TypeError('Unknown write type: ' + data.type);
                }
                return put(data, null);
            }),
            seek: (position) => queue(() => call('seek', { id, at: position })),
            truncate: (size) => queue(() => call('truncate', { id, size })),
            close: () => queue(async () => { done = true; await call('close', { id }); }),
            abort: () => { done = true; return chain.then(() => call('abort', { id })); },
            get locked() { return false; },
        };
        return w;
    }

    class DirectoryHandle extends Handle {
        constructor(path) { super('directory', path); }
        async *entries() {
            const { entries } = await call('list', { path: this.__jeHost.path });
            for (const e of entries) {
                const p = join(this.__jeHost.path, e.name);
                yield [e.name, e.kind === 'directory' ? new DirectoryHandle(p) : new FileHandle(p, e)];
            }
        }
        async *keys() { for await (const [n] of this.entries()) yield n; }
        async *values() { for await (const [, h] of this.entries()) yield h; }
        [Symbol.asyncIterator]() { return this.entries(); }
        async getFileHandle(name, opts = {}) {
            checkName(name);
            const r = await call('child', { path: this.__jeHost.path, name, kind: 'file', create: !!opts.create });
            return new FileHandle(r.path, r);
        }
        async getDirectoryHandle(name, opts = {}) {
            checkName(name);
            const r = await call('child', { path: this.__jeHost.path, name, kind: 'directory', create: !!opts.create });
            return new DirectoryHandle(r.path);
        }
        async removeEntry(name, opts = {}) {
            checkName(name);
            await call('remove', { path: this.__jeHost.path, name, recursive: !!opts.recursive });
        }
        // The names from here down to `h` → [...], [] for this one, null if it isn't in here
        async resolve(h) {
            const p = h && h.__jeHost && h.__jeHost.path;
            if (typeof p !== 'string') return null;
            const mine = this.__jeHost.path.replace(/\/+$/, '');
            if (p === mine) return h.kind === 'directory' ? [] : null;
            if (!p.startsWith(mine + '/')) return null;
            return p.slice(mine.length + 1).split('/').filter(Boolean);
        }
    }

    // ---- Kept in IndexedDB: stored as { __jeHost }, read back as handles ----
    const made = (o) => (o.kind === 'directory' ? new DirectoryHandle(o.path) : new FileHandle(o.path));
    const isMark = (v) => v && typeof v === 'object' && !(v instanceof Handle) && v.__jeHost && typeof v.__jeHost.path === 'string' && Object.keys(v).length === 1;
    const revived = new WeakMap();
    function revive(v, depth = 0) {
        if (!v || typeof v !== 'object' || depth > 6 || v instanceof Handle || v instanceof Blob || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
        if (isMark(v)) {
            if (!revived.has(v)) revived.set(v, made(v.__jeHost));
            return revived.get(v);
        }
        if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) v[i] = revive(v[i], depth + 1);
            return v;
        }
        if (Object.getPrototypeOf(v) !== Object.prototype) return v;
        for (const k of Object.keys(v)) v[k] = revive(v[k], depth + 1);
        return v;
    }
    function reviveGetter(proto, prop) {
        const d = Object.getOwnPropertyDescriptor(proto, prop);
        if (!d || !d.get) return;
        Object.defineProperty(proto, prop, { ...d, get() { return revive(d.get.call(this)); } });
    }

    function install(transport) {
        T = transport;
        reviveGetter(IDBRequest.prototype, 'result');
        reviveGetter(IDBCursorWithValue.prototype, 'value');

        // ---- The pickers: the system's dialogs, giving these handles ----
        if (T.pick && T.pick.folder) {
            window.showDirectoryPicker = async function showDirectoryPicker(opts = {}) {
                const p = await T.pick.folder(opts);
                if (!p) throw new DOMException('The user aborted a request.', 'AbortError');
                return api.folder(p);
            };
        }
        if (T.pick && T.pick.files) {
            window.showOpenFilePicker = async function showOpenFilePicker(opts = {}) {
                const paths = await T.pick.files({ multiple: !!opts.multiple, types: opts.types || [], excludeAcceptAllOption: !!opts.excludeAcceptAllOption });
                if (!paths || !paths.length) throw new DOMException('The user aborted a request.', 'AbortError');
                return paths.map(p => new FileHandle(p));
            };
        }
        if (T.pick && T.pick.save) {
            window.showSaveFilePicker = async function showSaveFilePicker(opts = {}) {
                const p = await T.pick.save({ suggestedName: opts.suggestedName || '', types: opts.types || [] });
                if (!p) throw new DOMException('The user aborted a request.', 'AbortError');
                const dir = p.replace(/\/[^/]+$/, '') || '/';
                const r = await call('child', { path: dir, name: baseName(p), kind: 'file', create: true });
                return new FileHandle(r.path, r);
            };
        }

        // ---- A dropped item's handle, from where it is on disk ----
        if (T.pathOf && typeof DataTransferItem !== 'undefined') {
            DataTransferItem.prototype.getAsFileSystemHandle = function getAsFileSystemHandle() {
                if (this.kind !== 'file') return Promise.resolve(null);
                // Asked for now: the drop's data is gone once the event is over
                const file = this.getAsFile();
                const p = file && T.pathOf(file);
                if (!p) return Promise.resolve(null);
                return call('stat', { path: p }).then(s => (s.kind === 'directory' ? new DirectoryHandle(p) : new FileHandle(p, s)));
            };
        }

        // Chromium's FileSystemObserver can't watch these: Watch checks the
        // folder now and then instead (watch.js)
        try { delete window.FileSystemObserver; } catch (e) { /* not there */ }
        if (typeof window.FileSystemObserver === 'function') window.FileSystemObserver = undefined;

        return api;
    }

    const api = {
        folder: (path) => new DirectoryHandle(path.length > 1 ? path.replace(/\/+$/, '') : path),
        file: (path) => new FileHandle(path),
        isOurs: (h) => h instanceof Handle,
        pathOf: (h) => (h instanceof Handle ? h.__jeHost.path : null),
    };
    window.HostHandles = { install, ...api };
})();
