// RAW files: shown and edited from the full-size JPEG the camera puts
// inside them (every RAW format carries one, for the camera's own screen
// and for viewers like this). The RAW file itself is never written: its
// crops, turns and adjustments are always kept as an edit (edits.js), and
// Export (or Save edits) writes JPEG copies.
//
// Formats:
//   TIFF-based: DNG, CR2, NEF, NRW, ARW, SR2, SRF, ORF, RW2, RWL, PEF, SRW,
//     3FR, IIQ, ERF, KDC, DCR, MOS, MEF — every IFD (and SubIFDs, and
//     EXIF's) is looked through for JPEG strips, JPEGInterchangeFormat, and
//     Panasonic's JpgFromRaw; the biggest baseline or progressive JPEG wins
//     (a DNG's lossless-JPEG raw data isn't one, so it's never taken)
//   CR3 (ISO base media): Canon's preview box (PRVW) and the full-size
//     JPEG in its first track
//   RAF: the JPEG its header points to
// The RAW's own orientation goes onto the JPEG (an EXIF Orientation, put
// first), so it's turned as the camera was held.
//
// Only the parts needed are read (blob slices): the JPEG itself is a slice
// of the file, never a copy until it's decoded.

const Raw = {
    EXT: /\.(dng|cr2|cr3|nef|nrw|arw|sr2|srf|orf|rw2|rwl|pef|srw|3fr|iiq|erf|kdc|dcr|mos|mef|raf)$/i,

    is(name) {
        return this.EXT.test(name || '');
    },

    // What a copy of it is called when written: photo.cr3 → photo.jpg
    jpegName(name) {
        return name.replace(/\.[^.]+$/, '') + '.jpg';
    },

    // The preview as a File (named for the RAW, typed as a JPEG, dated as
    // the RAW), or null if none was found. Remembered for the last few.
    async preview(data) {
        const key = `${data.name}|${data.size}|${data.lastModified}`;
        this._cache = this._cache || new Map();
        if (this._cache.has(key)) return this._cache.get(key);
        let out = null;
        try {
            const jpeg = await this.find(data);
            if (jpeg) out = new File([jpeg], data.name, { type: 'image/jpeg', lastModified: data.lastModified });
        } catch (e) {
            console.warn('RAW: no preview in', data.name, e);
        }
        this._cache.set(key, out);
        if (this._cache.size > 24) this._cache.delete(this._cache.keys().next().value);
        return out;
    },

    async bytes(blob, off, len) {
        return new Uint8Array(await blob.slice(off, off + len).arrayBuffer());
    },

    // The JPEG (a Blob), its orientation put on, or null
    async find(blob) {
        const head = await this.bytes(blob, 0, 16);
        const ascii = (a, b) => String.fromCharCode(...head.subarray(a, b));
        let found = null;
        if (ascii(0, 15) === 'FUJIFILMCCD-RAW') found = await this.raf(blob);
        else if (ascii(4, 8) === 'ftyp') found = await this.cr3(blob);
        else if ((head[0] === 0x49 && head[1] === 0x49) || (head[0] === 0x4D && head[1] === 0x4D)) found = await this.tiff(blob, 0);
        if (!found || !found.jpeg) return null;
        return this.oriented(found.jpeg, found.orientation);
    },

    // Is this slice a JPEG a browser can show (baseline or progressive)?
    async showable(blob, off, len) {
        if (!(len > 1000) || off + len > blob.size + 16) return false;
        const b = await this.bytes(blob, off, Math.min(len, 128 * 1024));
        if (b[0] !== 0xFF || b[1] !== 0xD8) return false;
        let i = 2;
        while (i + 4 <= b.length) {
            if (b[i] !== 0xFF) { i++; continue; }
            const m = b[i + 1];
            if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { i++; continue; }
            if (m === 0xC0 || m === 0xC1 || m === 0xC2) return true;
            if (m === 0xC3 || (m >= 0xC5 && m <= 0xCF && m !== 0xC8 && m !== 0xCC)) return false;
            if (m === 0xDA || m === 0xD9) return false;
            i += 2 + ((b[i + 2] << 8) | b[i + 3]);
        }
        return false;
    },

    // ---- TIFF-based ----

    async tiff(blob, base) {
        const hdr = await this.bytes(blob, base, 16);
        const le = hdr[0] === 0x49;
        const v = new DataView(hdr.buffer);
        const first = v.getUint32(4, le);
        const cands = [];
        let orientation = 0;
        const seen = new Set();
        const TYPES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
        const walk = async (off, depth, chain) => {
            if (!off || seen.has(off) || depth > 4 || seen.size > 64 || base + off + 2 > blob.size) return;
            seen.add(off);
            const nb = await this.bytes(blob, base + off, 2);
            const n = new DataView(nb.buffer).getUint16(0, le);
            if (!n || n > 1000) return;
            const ents = await this.bytes(blob, base + off + 2, n * 12 + 4);
            const d = new DataView(ents.buffer);
            const tags = {};
            const value = async (i) => {
                const type = d.getUint16(i * 12 + 2, le), count = d.getUint32(i * 12 + 4, le);
                const size = (TYPES[type] || 1) * count;
                let buf, at = 0;
                if (size <= 4) { buf = d; at = i * 12 + 8; }
                else {
                    if (count > 4096) return [];
                    const raw = await this.bytes(blob, base + d.getUint32(i * 12 + 8, le), size);
                    buf = new DataView(raw.buffer);
                }
                const out = [];
                for (let k = 0; k < Math.min(count, 4096); k++) {
                    if (type === 3) out.push(buf.getUint16(at + k * 2, le));
                    else if (type === 4 || type === 13) out.push(buf.getUint32(at + k * 4, le));
                    else if (type === 1 || type === 7) out.push(buf.getUint8(at + k));
                    else break;
                }
                return out;
            };
            for (let i = 0; i < n; i++) {
                const tag = d.getUint16(i * 12, le);
                if ([0x00FE, 0x0103, 0x0111, 0x0117, 0x0112, 0x0201, 0x0202, 0x014A, 0x8769, 0x002E].includes(tag)) {
                    tags[tag] = tag === 0x002E ? { at: d.getUint32(i * 12 + 8, le), len: d.getUint32(i * 12 + 4, le) } : await value(i);
                }
            }
            if (depth === 0 && chain === 0 && tags[0x0112]) orientation = tags[0x0112][0] || 0;
            // A JPEG: strips (compression 6, old-style JPEG, or 7 checked
            // as showable), or JPEGInterchangeFormat
            const comp = tags[0x0103] ? tags[0x0103][0] : 0;
            if ((comp === 6 || comp === 7) && tags[0x0111] && tags[0x0117] && tags[0x0111].length === 1) {
                cands.push({ off: tags[0x0111][0], len: tags[0x0117][0] });
            }
            if (tags[0x0201] && tags[0x0202]) cands.push({ off: tags[0x0201][0], len: tags[0x0202][0] });
            if (tags[0x002E]) cands.push({ off: tags[0x002E].at, len: tags[0x002E].len });
            for (const sub of tags[0x014A] || []) await walk(sub, depth + 1, 0);
            if (tags[0x8769]) await walk(tags[0x8769][0], depth + 1, 0);
            const next = d.getUint32(n * 12, le);
            if (next) await walk(next, depth, chain + 1);
        };
        await walk(first, 0, 0);
        // The biggest showable one
        cands.sort((a, b) => b.len - a.len);
        for (const c of cands) {
            if (await this.showable(blob, base + c.off, c.len)) {
                return { jpeg: blob.slice(base + c.off, base + c.off + c.len, 'image/jpeg'), orientation };
            }
        }
        return { jpeg: null, orientation };
    },

    // ---- Fujifilm RAF ----

    async raf(blob) {
        const h = await this.bytes(blob, 0, 100);
        const v = new DataView(h.buffer);
        const off = v.getUint32(84, false), len = v.getUint32(88, false);
        if (!(await this.showable(blob, off, len))) return null;
        const jpeg = blob.slice(off, off + len, 'image/jpeg');
        return { jpeg, orientation: 0 };   // its own EXIF says how it's turned
    },

    // ---- Canon CR3 (ISO base media) ----

    async cr3(blob) {
        const boxes = async (off, end) => {
            const out = [];
            while (off + 8 <= end && out.length < 256) {
                const h = await this.bytes(blob, off, 16);
                const v = new DataView(h.buffer);
                let size = v.getUint32(0, false), hdr = 8;
                const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
                if (size === 1) { size = Number(v.getBigUint64(8, false)); hdr = 16; }
                else if (size === 0) size = end - off;
                if (size < hdr) break;
                out.push({ type, off, size, body: off + hdr });
                off += size;
            }
            return out;
        };
        const top = await boxes(0, blob.size);
        const moov = top.find(b => b.type === 'moov');
        if (!moov) return null;
        const inner = await boxes(moov.body, moov.off + moov.size);
        const cands = [];
        let orientation = 0;
        // Canon's own box: CMT1 (IFD0: the orientation)
        const CANON = '85c0b687820f11e08111f4ce462b6a48';
        for (const b of inner) {
            if (b.type !== 'uuid') continue;
            const id = [...await this.bytes(blob, b.body, 16)].map(x => x.toString(16).padStart(2, '0')).join('');
            if (id !== CANON) continue;
            for (const c of await boxes(b.body + 16, b.off + b.size)) {
                if (c.type === 'CMT1') {
                    const t = await this.tiff(blob, c.body).catch(() => null);
                    if (t) orientation = t.orientation;
                }
            }
        }
        // PRVW: in a uuid box of its own at the top level
        for (const b of top) {
            if (b.type !== 'uuid') continue;
            const chunk = await this.bytes(blob, b.body, Math.min(b.size, 256));
            for (let i = 16; i + 4 < chunk.length; i++) {
                if (chunk[i] === 0x50 && chunk[i + 1] === 0x52 && chunk[i + 2] === 0x56 && chunk[i + 3] === 0x57) {
                    // PRVW: … then a JPEG
                    const look = await this.bytes(blob, b.body + i, 64);
                    for (let k = 4; k + 1 < look.length; k++) {
                        if (look[k] === 0xFF && look[k + 1] === 0xD8) {
                            const len = new DataView(look.buffer).getUint32(k - 4, false);
                            cands.push({ off: b.body + i + k, len: len > 0 && len < b.size ? len : b.off + b.size - (b.body + i + k) });
                            break;
                        }
                    }
                    break;
                }
            }
        }
        // The first track: the full-size JPEG (its chunk offset and size)
        const trak = inner.find(b => b.type === 'trak');
        if (trak) {
            const find = async (box, path) => {
                if (!path.length) return box;
                const kids = await boxes(box.body, box.off + box.size);
                const k = kids.find(x => x.type === path[0]);
                return k ? find(k, path.slice(1)) : null;
            };
            const stbl = await find(trak, ['mdia', 'minf', 'stbl']);
            if (stbl) {
                const kids = await boxes(stbl.body, stbl.off + stbl.size);
                const stsz = kids.find(x => x.type === 'stsz'), co = kids.find(x => x.type === 'co64' || x.type === 'stco');
                if (stsz && co) {
                    const sz = new DataView((await this.bytes(blob, stsz.body, 20)).buffer);
                    const len = sz.getUint32(4, false) || sz.getUint32(12, false);
                    const cv = new DataView((await this.bytes(blob, co.body, 16)).buffer);
                    const off = co.type === 'co64' ? Number(cv.getBigUint64(8, false)) : cv.getUint32(8, false);
                    cands.push({ off, len });
                }
            }
        }
        cands.sort((a, b) => b.len - a.len);
        for (const c of cands) {
            if (await this.showable(blob, c.off, c.len)) return { jpeg: blob.slice(c.off, c.off + c.len, 'image/jpeg'), orientation };
        }
        return null;
    },

    // ---- Orientation ----

    // The JPEG with an EXIF Orientation segment put first (1–8; none or 1:
    // as it is, except a stray one inside is overruled)
    oriented(jpeg, o) {
        if (!(o >= 1 && o <= 8)) return jpeg;
        const tiff = new Uint8Array([0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, 0, 0]);
        const payload = new Uint8Array(6 + tiff.length);
        payload.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
        payload.set(tiff, 6);
        const len = payload.length + 2;
        const seg = new Uint8Array(4 + payload.length);
        seg.set([0xFF, 0xE1, len >> 8, len & 0xFF]);
        seg.set(payload, 4);
        return new Blob([new Uint8Array([0xFF, 0xD8]), seg, jpeg.slice(2)], { type: 'image/jpeg' });
    }
};
