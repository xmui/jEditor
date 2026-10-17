// Photos picked, not a folder: for a browser that can't open folders
// (Safari on iPhone and iPad, Chrome on Android, Firefox). "Open photos" brings up the
// system's picker (Photos or Files); jEditor edits them as usual, keeping
// each edit in memory, and Save hands the edited photos back through the
// share sheet (Save to Photos, Save to Files, or another app), or
// downloads them (a zip for several) where there's no share sheet.

// A picked photo, standing in for a file handle: reads give the photo as
// last written, writes (whole, or in place, as lossless rotation does)
// replace it in memory.
class PickedHandle {
    constructor(file) {
        this.kind = 'file';
        this.name = file.name;
        this._file = file;
        this.edited = false;
    }

    async getFile() { return this._file; }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async isSameEntry(other) { return other === this; }

    async createWritable({ keepExistingData = false } = {}) {
        let buf = keepExistingData ? new Uint8Array(await this._file.arrayBuffer()) : new Uint8Array(0);
        let len = buf.length, pos = 0;
        const room = (n) => {
            if (n <= buf.length) return;
            const grown = new Uint8Array(Math.max(n, buf.length * 2));
            grown.set(buf.subarray(0, len));
            buf = grown;
        };
        const put = (bytes, at) => {
            room(at + bytes.length);
            buf.set(bytes, at);
            len = Math.max(len, at + bytes.length);
            pos = at + bytes.length;
        };
        const bytesOf = async (d) => {
            if (d instanceof Blob) return new Uint8Array(await d.arrayBuffer());
            if (d instanceof ArrayBuffer) return new Uint8Array(d);
            if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
            return new TextEncoder().encode(String(d));
        };
        let type = this._file.type;
        return {
            write: async (d) => {
                if (d && typeof d === 'object' && 'type' in d && !(d instanceof Blob)) {
                    if (d.type === 'seek') { pos = d.position; return; }
                    if (d.type === 'truncate') { room(d.size); len = d.size; pos = Math.min(pos, len); return; }
                    put(await bytesOf(d.data), d.position ?? pos);
                    return;
                }
                if (d instanceof Blob && d.type) type = d.type;
                put(await bytesOf(d), pos);
            },
            seek: async (p) => { pos = p; },
            truncate: async (n) => { room(n); len = n; },
            close: async () => {
                this._file = new File([buf.slice(0, len)], this.name, { type, lastModified: Date.now() });
                this.edited = true;
                if (typeof Picked !== 'undefined') Picked.update();
            },
            abort: async () => { }
        };
    }
}

const Picked = {
    app: null,
    handles: [],

    // Only in a browser with no way to open a folder
    available() {
        return !Host.get() && typeof window.showDirectoryPicker !== 'function';
    },

    init(app) {
        this.app = app;
        if (!this.available()) return;
        document.documentElement.classList.add('picked-mode');
        const open = document.getElementById('btn-browse-folder');
        if (open) open.lastChild.textContent = ' Open photos';
        const hint = document.querySelector('.drop-hint');
        const tagline = document.querySelector('.start-tagline');
        if (tagline) tagline.textContent = 'Rotate, crop and sort photos. Nothing is uploaded.';
        const where = { ios: 'Photos or Files', android: 'your gallery or files' }[Start.device()] || 'your photos';
        if (hint) hint.textContent = `From ${where}. Edited photos are saved with Save, to wherever you share them.`;
        this.input = document.createElement('input');
        this.input.type = 'file';
        this.input.multiple = true;
        this.input.accept = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';
        this.input.id = 'picked-input';
        this.input.hidden = true;
        this.input.addEventListener('change', () => this.open([...this.input.files]));
        document.body.appendChild(this.input);
        document.getElementById('picked-save').addEventListener('click', () => this.save());
        // Edits not saved yet would be lost
        addEventListener('beforeunload', (e) => {
            if (this.edited().length) { e.preventDefault(); e.returnValue = ''; }
        });
    },

    choose() {
        this.input.value = '';
        this.input.click();
    },

    async open(files) {
        const app = this.app;
        // RAW files (raw.js) are never written, so they need a folder
        const photos = files.filter(f => app.isImage(f.name) && !Raw.is(f.name));
        if (!photos.length) {
            if (files.length) UI.alert({ title: 'No photos there', message: 'jEditor opens JPEG, PNG, WebP and GIF photos.' });
            return;
        }
        if (this.edited().length && !(await UI.confirm({
            title: 'Leave these photos?',
            message: 'Some edits haven\'t been saved. Save them first, or they\'re lost.',
            ok: 'Leave them', danger: true
        }))) return;
        app._openGen = (app._openGen || 0) + 1;
        app.isLoading = true;
        try {
            app.cleanupURLs();
            app.files = [];
            app.dirHandle = null;
            app.readOnlyMode = false;
            app.beginTask('scan', 'Opening photos…');
            app.elements.dropZone.classList.add('hidden');
            // Two photos of the same name (from different albums) both open
            const names = new Set();
            this.handles = photos.map(f => {
                let name = f.name;
                for (let n = 2; names.has(name.toLowerCase()); n++) name = f.name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
                names.add(name.toLowerCase());
                return new PickedHandle(name === f.name ? f : new File([f], name, { type: f.type, lastModified: f.lastModified }));
            });
            for (const h of this.handles) {
                app.files.push({ name: h.name, handle: h, size: h._file.size, lastModified: h._file.lastModified });
            }
            await app.finalizeLoad();
        } finally {
            app.endTask('scan');
            app.isLoading = false;
            this.update();
        }
    },

    edited() {
        return this.handles.filter(h => h.edited && this.app.files.some(f => f.handle === h));
    },

    // The Save pill: shown while there are edited photos
    update() {
        const bar = document.getElementById('picked-bar');
        if (!bar) return;
        const n = this.edited().length;
        bar.classList.toggle('hidden', !n);
        document.getElementById('picked-count').textContent = n === 1 ? '1 edited photo' : `${n} edited photos`;
    },

    // Called from the click, so the share sheet may open (it needs one)
    async save() {
        const handles = this.edited();
        if (!handles.length) return;
        const files = handles.map(h => h._file);
        const done = () => {
            handles.forEach(h => { h.edited = false; });
            this.update();
        };
        if (navigator.canShare && navigator.share && navigator.canShare({ files })) {
            try {
                await navigator.share({ files });
                done();
                this.app.showToast(files.length === 1 ? 'Saved' : `Saved ${files.length} photos`);
            } catch (e) {
                if (e.name !== 'AbortError') UI.alert({ title: 'Couldn\'t save the photos', message: e.message });
            }
            return;
        }
        const blob = files.length === 1 ? files[0] : Picked.zip(await Promise.all(files.map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), date: new Date(f.lastModified) }))));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = files.length === 1 ? files[0].name : 'jEditor photos.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        done();
        this.app.showToast(files.length === 1 ? `Downloaded ${files[0].name}` : `Downloaded ${files.length} photos as a zip`);
    },

    // A zip of the files as they are (photos don't compress): [{ name, bytes, date }] → Blob
    zip(entries) {
        const table = Picked._crcTable || (Picked._crcTable = Array.from({ length: 256 }, (_, n) => {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            return c >>> 0;
        }));
        const crc32 = (bytes) => {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
            return (c ^ 0xFFFFFFFF) >>> 0;
        };
        const parts = [], central = [];
        let offset = 0;
        for (const e of entries) {
            const name = new TextEncoder().encode(e.name);
            const d = e.date || new Date();
            const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
            const day = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
            const crc = crc32(e.bytes);
            const head = new DataView(new ArrayBuffer(30));
            head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
            head.setUint16(8, 0, true); head.setUint16(10, time, true); head.setUint16(12, day, true);
            head.setUint32(14, crc, true); head.setUint32(18, e.bytes.length, true); head.setUint32(22, e.bytes.length, true);
            head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
            parts.push(head, name, e.bytes);
            const dir = new DataView(new ArrayBuffer(46));
            dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
            dir.setUint16(10, 0, true); dir.setUint16(12, time, true); dir.setUint16(14, day, true);
            dir.setUint32(16, crc, true); dir.setUint32(20, e.bytes.length, true); dir.setUint32(24, e.bytes.length, true);
            dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true);
            central.push(dir, name);
            offset += 30 + name.length + e.bytes.length;
        }
        const size = central.reduce((n, p) => n + p.byteLength, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
        end.setUint32(12, size, true); end.setUint32(16, offset, true);
        return new Blob([...parts, ...central, end], { type: 'application/zip' });
    }
};
