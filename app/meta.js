// Image metadata surgery for JPEG and PNG.
//
// A canvas re-encode (crop, straighten, non-JPEG rotation) produces a file
// with no metadata at all: capture date, camera, color profile and DPI are
// gone. For scan orders that matters — DPI drives print size and the ICC
// profile drives color. These helpers copy the metadata that is still
// true after an edit from the original file onto the re-encoded one, and
// patch what changed (orientation, pixel dimensions, stale EXIF thumbnail).
//
// Everything works on Uint8Arrays and never throws: on anything unexpected
// the caller gets the re-encoded file back untouched.

const ImageMeta = {

    // ---- JPEG structure ----

    // Header segments from SOI up to (and including) SOS. SOS covers the
    // rest of the file. Returns [{ marker, start, end }] or null. With
    // partial, bytes may be just the head of a file: the segments that fit
    // are returned instead of null.
    jpegSegments(bytes, { partial = false } = {}) {
        if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
        const segs = [];
        let p = 2;
        while (p + 4 <= bytes.length) {
            if (bytes[p] !== 0xFF) return null;
            const m = bytes[p + 1];
            if (m === 0xFF) { p++; continue; } // fill byte
            if (m === 0xDA || m === 0xD9) {
                segs.push({ marker: m, start: p, end: bytes.length });
                return segs;
            }
            const len = (bytes[p + 2] << 8) | bytes[p + 3];
            if (len < 2) return null;
            if (p + 2 + len > bytes.length) return partial ? segs : null;
            segs.push({ marker: m, start: p, end: p + 2 + len });
            p += 2 + len;
        }
        return partial ? segs : null;
    },

    // Does the segment payload start with this ASCII signature?
    hasSig(bytes, seg, sig) {
        const at = seg.start + 4;
        if (at + sig.length > seg.end) return false;
        for (let i = 0; i < sig.length; i++) {
            if (bytes[at + i] !== sig.charCodeAt(i)) return false;
        }
        return true;
    },

    isExifSeg(bytes, seg) {
        return seg.marker === 0xE1 && this.hasSig(bytes, seg, 'Exif\0\0');
    },

    isXmpSeg(bytes, seg) {
        return seg.marker === 0xE1 && (this.hasSig(bytes, seg, 'http://ns.adobe.com/xap/1.0/\0') ||
            this.hasSig(bytes, seg, 'http://ns.adobe.com/xmp/extension/\0'));
    },

    // Segments that stay true after re-encoding. Deliberately a whitelist:
    // Adobe APP14 (color transform flags) and MPF APP2 (byte offsets into
    // the old file) would corrupt the new file if copied.
    keepJpegSeg(bytes, seg) {
        const m = seg.marker;
        if (m === 0xE0) return this.hasSig(bytes, seg, 'JFIF\0');          // density / DPI
        if (m === 0xE1) return this.isExifSeg(bytes, seg) || this.isXmpSeg(bytes, seg);
        if (m === 0xE2) return this.hasSig(bytes, seg, 'ICC_PROFILE\0');   // color profile
        if (m === 0xED) return this.hasSig(bytes, seg, 'Photoshop 3.0\0'); // IPTC, resolution
        if (m === 0xFE) return true;                                       // comment
        return false;
    },

    isAppOrCom(marker) {
        return (marker >= 0xE0 && marker <= 0xEF) || marker === 0xFE;
    },

    hasJpegIcc(bytes) {
        const segs = this.jpegSegments(bytes);
        return !!segs && segs.some(s => s.marker === 0xE2 && this.hasSig(bytes, s, 'ICC_PROFILE\0'));
    },

    // ---- TIFF / EXIF ----

    // Parse the TIFF header inside an EXIF APP1 segment.
    exifTiff(bytes, seg) {
        const tiff = seg.start + 10;
        if (tiff + 8 > seg.end) return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const bo = view.getUint16(tiff);
        const le = bo === 0x4949;
        if (!le && bo !== 0x4D4D) return null;
        if (view.getUint16(tiff + 2, le) !== 0x002A) return null;
        return { view, tiff, le, end: seg.end };
    },

    // Entries of the IFD at a TIFF-relative offset: { at, count, entries: [{tag, type, pos}], nextPos }
    readIfd(t, rel) {
        const at = t.tiff + rel;
        if (rel < 8 || at + 2 > t.end) return null;
        const count = t.view.getUint16(at, t.le);
        const nextPos = at + 2 + count * 12;
        if (nextPos + 4 > t.end) return null;
        const entries = [];
        for (let i = 0; i < count; i++) {
            const pos = at + 2 + i * 12;
            entries.push({ tag: t.view.getUint16(pos, t.le), type: t.view.getUint16(pos + 2, t.le), pos });
        }
        return { at, count, entries, nextPos };
    },

    // Overwrite a SHORT or LONG entry's inline value in place
    setIntEntry(t, entry, value) {
        if (entry.type === 3) { t.view.setUint16(entry.pos + 8, value, t.le); return true; }
        if (entry.type === 4) { t.view.setUint32(entry.pos + 8, value, t.le); return true; }
        return false;
    },

    readIntEntry(t, entry) {
        if (entry.type === 3) return t.view.getUint16(entry.pos + 8, t.le);
        if (entry.type === 4) return t.view.getUint32(entry.pos + 8, t.le);
        return null;
    },

    readRational(t, entry) {
        if (entry.type !== 5) return null;
        const off = t.tiff + t.view.getUint32(entry.pos + 8, t.le);
        if (off + 8 > t.end) return null;
        const den = t.view.getUint32(off + 4, t.le);
        return den ? t.view.getUint32(off, t.le) / den : null;
    },

    // Make a copied EXIF segment true for re-encoded, upright pixels:
    // orientation → 1, pixel dimensions updated, and the embedded preview
    // (IFD1) unlinked — it would still show the uncropped, unrotated image
    // in Explorer and other apps that read it.
    patchExifForBakedPixels(bytes, seg, width, height) {
        const t = this.exifTiff(bytes, seg);
        if (!t) return;
        const ifd0 = this.readIfd(t, t.view.getUint32(t.tiff + 4, t.le));
        if (!ifd0) return;
        let exifPtr = null;
        for (const e of ifd0.entries) {
            if (e.tag === 0x0112) this.setIntEntry(t, e, 1);
            if (e.tag === 0x8769) exifPtr = this.readIntEntry(t, e);
        }
        t.view.setUint32(ifd0.nextPos, 0, t.le); // drop IFD1 thumbnail
        if (exifPtr) {
            const sub = this.readIfd(t, exifPtr);
            if (sub) {
                for (const e of sub.entries) {
                    if (e.tag === 0xA002) this.setIntEntry(t, e, width);
                    if (e.tag === 0xA003) this.setIntEntry(t, e, height);
                }
            }
        }
    },

    // XMP can carry its own tiff:Orientation, which Adobe apps prefer over
    // EXIF. Rewrite it in place (single digit → single digit, same length).
    patchXmpOrientation(bytes, seg, value) {
        const text = new TextDecoder('latin1').decode(bytes.subarray(seg.start, seg.end));
        const re = /tiff:Orientation(="|>)([1-8])/g;
        let m;
        while ((m = re.exec(text))) {
            bytes[seg.start + m.index + m[0].length - 1] = 0x30 + value;
        }
    },

    // Add an Orientation tag to an EXIF block that has none, without
    // shifting any existing data: IFD0 is copied (plus the new entry) to the
    // end of the TIFF block and the header is pointed at the copy. All
    // existing offsets stay valid. Returns new file bytes, or null if the
    // segment would grow past the 64 KB JPEG segment limit.
    insertExifOrientation(bytes, seg, orientation) {
        const t = this.exifTiff(bytes, seg);
        if (!t) return null;
        const ifd0 = this.readIfd(t, t.view.getUint32(t.tiff + 4, t.le));
        if (!ifd0) return null;
        if (ifd0.entries.some(e => e.tag === 0x0112)) return null;

        const pad = (seg.end - t.tiff) % 2; // IFDs must start on a word boundary
        const newRel = seg.end - t.tiff + pad;
        const ifdSize = 2 + (ifd0.count + 1) * 12 + 4;
        const newLen = (seg.end - seg.start - 2) + pad + ifdSize;
        if (newLen > 0xFFFF) return null;

        const ifd = new Uint8Array(pad + ifdSize);
        const iv = new DataView(ifd.buffer);
        const le = t.le;
        iv.setUint16(pad, ifd0.count + 1, le);
        const rows = ifd0.entries.map(e => ({ tag: e.tag, raw: bytes.subarray(e.pos, e.pos + 12) }));
        const orient = new Uint8Array(12);
        const ov = new DataView(orient.buffer);
        ov.setUint16(0, 0x0112, le);
        ov.setUint16(2, 3, le);   // SHORT
        ov.setUint32(4, 1, le);   // count
        ov.setUint16(8, orientation, le);
        rows.push({ tag: 0x0112, raw: orient });
        rows.sort((a, b) => a.tag - b.tag); // TIFF requires ascending tags
        rows.forEach((r, i) => ifd.set(r.raw, pad + 2 + i * 12));
        iv.setUint32(pad + 2 + rows.length * 12, t.view.getUint32(ifd0.nextPos, le), le);

        const out = new Uint8Array(bytes.length + ifd.length);
        out.set(bytes.subarray(0, seg.end), 0);
        out.set(ifd, seg.end);
        out.set(bytes.subarray(seg.end), seg.end + ifd.length);
        const ov2 = new DataView(out.buffer);
        ov2.setUint16(seg.start + 2, newLen);          // APP1 length
        ov2.setUint32(t.tiff + 4, newRel, le);         // IFD0 pointer
        return out;
    },

    // ---- PNG structure ----

    // partial: the chunks that are whole in `bytes` (the start of a file),
    // for reading the header and pHYs, which come before the image data
    pngChunks(bytes, { partial = false } = {}) {
        const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const chunks = [];
        let p = 8;
        while (p + 12 <= bytes.length) {
            const len = view.getUint32(p);
            const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
            const end = p + 12 + len;
            if (end > bytes.length) return partial ? chunks : null;
            chunks.push({ type, start: p, end, data: p + 8 });
            p = end;
            if (type === 'IEND') break;
        }
        return chunks;
    },

    PNG_COLOR_CHUNKS: ['iCCP', 'sRGB', 'gAMA', 'cHRM'],
    PNG_KEEP_CHUNKS: ['iCCP', 'sRGB', 'gAMA', 'cHRM', 'pHYs', 'tEXt', 'zTXt', 'iTXt'],

    // ---- Transplant ----

    // Color components in a JPEG's frame header (3 = YCbCr, 4 = CMYK/YCCK)
    jpegComponents(bytes) {
        const segs = this.jpegSegments(bytes) || [];
        for (const s of segs) {
            const m = s.marker;
            if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC && s.end - s.start >= 10) {
                return bytes[s.start + 9];
            }
        }
        return 0;
    },

    // Should the edit decode without color conversion? True when the
    // original's color profile will be copied onto the result, so the
    // pixels must stay in that profile's space (decoding to sRGB and then
    // re-tagging with, say, Adobe RGB would wash the colors out). A CMYK
    // JPEG's profile can't describe the RGB output, so it converts instead.
    canCarryProfile(mime, original = null) {
        if (mime === 'image/png') return true;
        if (mime !== 'image/jpeg') return false;
        return !original || this.jpegComponents(original) !== 4;
    },

    // Copy metadata from `original` onto the re-encoded `blob`.
    async transplant(original, blob, mime, width, height) {
        try {
            const fresh = new Uint8Array(await blob.arrayBuffer());
            let out = null;
            if (mime === 'image/jpeg') out = this.transplantJpeg(original, fresh, width, height);
            else if (mime === 'image/png') out = this.transplantPng(original, fresh);
            return out ? new Blob([out], { type: mime }) : blob;
        } catch (e) {
            return blob;
        }
    },

    transplantJpeg(original, fresh, width, height) {
        const oSegs = this.jpegSegments(original);
        const fSegs = this.jpegSegments(fresh);
        if (!oSegs || !fSegs) return null;

        const cmyk = this.jpegComponents(original) === 4;
        const kept = [];
        for (const s of oSegs) {
            if (!this.isAppOrCom(s.marker)) continue;
            if (!this.keepJpegSeg(original, s)) continue;
            if (cmyk && s.marker === 0xE2) continue; // CMYK profile ≠ RGB output
            const copy = original.slice(s.start, s.end);
            const cs = { marker: s.marker, start: 0, end: copy.length };
            if (this.isExifSeg(copy, cs)) this.patchExifForBakedPixels(copy, cs, width, height);
            if (this.isXmpSeg(copy, cs)) this.patchXmpOrientation(copy, cs, 1);
            kept.push(copy);
        }
        const hadJfif = kept.some(c => c[1] === 0xE0);
        const hadExif = kept.some(c => this.isExifSeg(c, { marker: c[1], start: 0, end: c.length }));

        // Encoder output minus its own APP/COM segments. Keep the encoder's
        // JFIF only if the original had neither JFIF nor EXIF.
        const body = [];
        for (const s of fSegs) {
            if (this.isAppOrCom(s.marker)) {
                if (s.marker === 0xE0 && !hadJfif && !hadExif) body.push(fresh.subarray(s.start, s.end));
                continue;
            }
            body.push(fresh.subarray(s.start, s.end));
        }

        const parts = [new Uint8Array([0xFF, 0xD8]), ...kept, ...body];
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    },

    transplantPng(original, fresh) {
        const oc = this.pngChunks(original);
        const fc = this.pngChunks(fresh);
        if (!oc || !fc || fc[0].type !== 'IHDR') return null;

        const kept = oc.filter(c => this.PNG_KEEP_CHUNKS.includes(c.type));
        if (!kept.length) return null;
        const keptTypes = new Set(kept.map(c => c.type));
        const originalHasColor = this.PNG_COLOR_CHUNKS.some(t => keptTypes.has(t));

        const drop = (type) => keptTypes.has(type) ||
            (originalHasColor && this.PNG_COLOR_CHUNKS.includes(type));

        const parts = [fresh.subarray(0, 8), fresh.subarray(fc[0].start, fc[0].end)];
        kept.forEach(c => parts.push(original.subarray(c.start, c.end)));
        fc.slice(1).forEach(c => { if (!drop(c.type)) parts.push(fresh.subarray(c.start, c.end)); });

        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    },

    // ---- EXIF in WebP, AVIF and JPEG XL (and reading it from any) ----
    //
    // Convert (convert.js) turns photos into these. Their pixels
    // come out upright and in sRGB, so the EXIF goes with them made true for
    // that (orientation 1, the new size, no old thumbnail), and the colour
    // profile doesn't.

    // The EXIF's TIFF block in a JPEG, PNG, WebP, AVIF or JPEG XL, or null.
    // A TIFF's own tags are its EXIF: its camera and dates, made small
    exifOf(bytes) {
        try {
            if (this.isTiffFile(bytes)) return this.compactTiff(bytes);
            const segs = this.jpegSegments(bytes, { partial: true });
            if (segs) {
                const s = segs.find(x => this.isExifSeg(bytes, x));
                return s ? bytes.slice(s.start + 10, s.end) : null;
            }
            const chunks = this.pngChunks(bytes, { partial: true });
            if (chunks) {
                const c = chunks.find(x => x.type === 'eXIf');
                return c ? this.unprefixed(bytes.slice(c.data, c.end - 4)) : null;
            }
            const riff = this.webpChunks(bytes);
            if (riff) {
                const c = riff.find(x => x.type === 'EXIF');
                return c ? this.unprefixed(bytes.slice(c.data, c.data + c.size)) : null;
            }
            const boxes = this.boxes(bytes);
            if (boxes && boxes.length) {
                const exif = boxes.find(b => b.type === 'Exif');
                if (exif) return this.exifPayload(bytes.subarray(exif.data, exif.end));
                const meta = boxes.find(b => b.type === 'meta');
                if (meta) {
                    const m = this.heifItems(bytes, meta);
                    const item = m && m.items.find(i => i.type === 'Exif');
                    const loc = item && m.locs.get(item.id);
                    if (loc && loc.method === 0 && loc.extents.length === 1) {
                        const x = loc.extents[0], at = loc.base + x.offset;
                        return this.exifPayload(bytes.subarray(at, at + x.length));
                    }
                }
            }
        } catch (e) { /* none */ }
        return null;
    },

    // An Exif box or item: how far in the TIFF header is, then the TIFF
    exifPayload(p) {
        if (p.length < 12) return null;
        const skip = new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(0);
        return 4 + skip < p.length ? this.unprefixed(p.slice(4 + skip)) : null;
    },

    // Some writers keep JPEG's "Exif\0\0" in front of the TIFF block
    unprefixed(t) {
        return t.length > 6 && t[0] === 0x45 && t[1] === 0x78 && t[2] === 0x69 && t[3] === 0x66 && t[4] === 0 && t[5] === 0 ? t.slice(6) : t;
    },

    // A TIFF block made true for upright pixels of w × h
    tiffForUpright(tiff, w, h) {
        if (!tiff || tiff.length < 8 || tiff.length > 0xFFF0) return tiff && tiff.length >= 8 ? tiff : null;
        const seg = new Uint8Array(10 + tiff.length);
        seg.set([0xFF, 0xE1, (tiff.length + 8) >> 8, (tiff.length + 8) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
        seg.set(tiff, 10);
        this.patchExifForBakedPixels(seg, { marker: 0xE1, start: 0, end: seg.length }, w, h);
        return seg.slice(10);
    },

    // ---- WebP ----

    // RIFF chunks: [{ type, start, data, size }] or null
    webpChunks(bytes) {
        if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return null;
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out = [];
        let p = 12;
        while (p + 8 <= bytes.length) {
            const size = v.getUint32(p + 4, true);
            if (p + 8 + size > bytes.length) break;
            out.push({ type: String.fromCharCode(...bytes.subarray(p, p + 4)), start: p, data: p + 8, size });
            p += 8 + size + (size & 1);
        }
        return out;
    },

    // The WebP with this EXIF (the extended format, VP8X, says it's there)
    withExifWebp(webp, tiff, w, h) {
        const chunks = this.webpChunks(webp);
        if (!chunks || !chunks.length || !tiff) return webp;
        const chunk = (type, payload) => {
            const c = new Uint8Array(8 + payload.length + (payload.length & 1));
            c.set([...type].map(ch => ch.charCodeAt(0)));
            new DataView(c.buffer).setUint32(4, payload.length, true);
            c.set(payload, 8);
            return c;
        };
        const parts = [];
        let vp8x = chunks.find(c => c.type === 'VP8X');
        if (vp8x) {
            const head = webp.slice(vp8x.start, vp8x.data + vp8x.size + (vp8x.size & 1));
            head[8] |= 0x08;
            parts.push(head);
        } else {
            const x = new Uint8Array(10);
            const img = chunks[0];
            // A lossless picture says in its header whether it has alpha
            if (img.type === 'VP8L' && img.size >= 5 && (webp[img.data + 4] & 0x10)) x[0] |= 0x10;
            x[0] |= 0x08;
            x[4] = (w - 1) & 255; x[5] = ((w - 1) >> 8) & 255; x[6] = ((w - 1) >> 16) & 255;
            x[7] = (h - 1) & 255; x[8] = ((h - 1) >> 8) & 255; x[9] = ((h - 1) >> 16) & 255;
            parts.push(chunk('VP8X', x));
        }
        for (const c of chunks) {
            if (c.type === 'VP8X' || c.type === 'EXIF') continue;
            parts.push(webp.subarray(c.start, c.data + c.size + (c.size & 1)));
        }
        parts.push(chunk('EXIF', tiff)); // after the picture, as the format asks
        const total = 12 + parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        out.set(webp.subarray(0, 12));
        new DataView(out.buffer).setUint32(4, total - 8, true);
        let o = 12;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    },

    // ---- ISO boxes (AVIF, and JPEG XL's container) ----

    // [{ type, start, data, end }] between start and end, or null
    boxes(bytes, start = 0, end = bytes.length) {
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out = [];
        let p = start;
        while (p + 8 <= end) {
            let size = v.getUint32(p), head = 8;
            const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
            if (size === 1) {
                if (p + 16 > end) return null;
                size = Number(v.getBigUint64(p + 8));
                head = 16;
            } else if (size === 0) size = end - p;
            if (size < head || p + size > end) return out.length ? out : null;
            out.push({ type, start: p, data: p + head, end: p + size });
            p += size;
        }
        return out;
    },

    // An AVIF's meta box: its items ([{ id, type }]), where each is
    // (Map id → { method, base, extents: [{ offset, length }] }), and the
    // iloc's layout, for writing it again
    heifItems(bytes, meta) {
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const kids = this.boxes(bytes, meta.data + 4, meta.end);
        if (!kids) return null;
        const items = [];
        const iinf = kids.find(b => b.type === 'iinf');
        if (iinf) {
            const ver = bytes[iinf.data];
            const infes = this.boxes(bytes, iinf.data + 4 + (ver === 0 ? 2 : 4), iinf.end) || [];
            for (const b of infes) {
                if (b.type !== 'infe') continue;
                const iv = bytes[b.data];
                if (iv < 2) continue;
                const id = iv === 2 ? v.getUint16(b.data + 4) : v.getUint32(b.data + 4);
                const tAt = b.data + 4 + (iv === 2 ? 2 : 4) + 2;
                items.push({ id, type: String.fromCharCode(...bytes.subarray(tAt, tAt + 4)) });
            }
        }
        const locs = new Map();
        const iloc = kids.find(b => b.type === 'iloc');
        let layout = null;
        if (iloc) {
            const ver = bytes[iloc.data];
            let p = iloc.data + 4;
            const offSize = bytes[p] >> 4, lenSize = bytes[p] & 15, baseSize = bytes[p + 1] >> 4, idxSize = ver >= 1 ? bytes[p + 1] & 15 : 0;
            p += 2;
            const read = (n) => { const val = n === 0 ? 0 : n === 2 ? v.getUint16(p) : n === 4 ? v.getUint32(p) : Number(v.getBigUint64(p)); p += n; return val; };
            const count = ver < 2 ? read(2) : read(4);
            layout = { ver, offSize, lenSize, baseSize, idxSize, entries: [] };
            for (let i = 0; i < count; i++) {
                const id = ver < 2 ? read(2) : read(4);
                const method = ver >= 1 ? read(2) & 15 : 0;
                const ref = read(2);
                const base = read(baseSize);
                const n = read(2);
                const extents = [];
                for (let k = 0; k < n; k++) {
                    const index = idxSize ? read(idxSize) : 0;
                    extents.push({ index, offset: read(offSize), length: read(lenSize) });
                }
                const e = { id, method, ref, base, extents };
                layout.entries.push(e);
                locs.set(id, e);
            }
        }
        const pitm = kids.find(b => b.type === 'pitm');
        const primary = pitm ? (bytes[pitm.data] === 0 ? v.getUint16(pitm.data + 4) : v.getUint32(pitm.data + 4)) : 1;
        return { kids, items, locs, layout, primary };
    },

    // The AVIF with this EXIF: an Exif item described by the meta box (and
    // linked to the picture), its bytes in a box of their own at the end.
    // The meta box grows, so what comes after it moves along, and the
    // places the meta box gives for it are moved with it.
    withExifAvif(avif, tiff) {
        try {
            const top = this.boxes(avif);
            const meta = top && top.find(b => b.type === 'meta');
            const m = meta && this.heifItems(avif, meta);
            if (!m || !m.layout || m.layout.ver > 1 || m.items.some(i => i.type === 'Exif')) return avif;
            const L = m.layout;
            if (L.offSize !== 4 && L.offSize !== 8) return avif;
            const id = Math.max(0, ...m.items.map(i => i.id), ...L.entries.map(e => e.id)) + 1;
            if (id > 0xFFFF) return avif;
            const be = (n, size) => { const a = new Uint8Array(size); for (let i = size - 1; i >= 0; i--) { a[i] = n & 255; n = Math.floor(n / 256); } return a; };
            const cat = (...ps) => { const out = new Uint8Array(ps.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of ps) { out.set(p, o); o += p.length; } return out; };
            const box = (type, ...payload) => { const body = cat(...payload); return cat(be(8 + body.length, 4), new TextEncoder().encode(type), body); };
            const kid = (type) => m.kids.find(b => b.type === type);
            // iinf with one more infe (version 2: Exif, no name)
            const iinf = kid('iinf');
            if (!iinf) return avif;
            const iinfVer = avif[iinf.data];
            const oldCount = iinfVer === 0 ? (avif[iinf.data + 4] << 8) | avif[iinf.data + 5] : new DataView(avif.buffer, avif.byteOffset).getUint32(iinf.data + 4);
            const infesAt = iinf.data + 4 + (iinfVer === 0 ? 2 : 4);
            const infe = box('infe', new Uint8Array([2, 0, 0, 0]), be(id, 2), be(0, 2), new TextEncoder().encode('Exif'), new Uint8Array([0]));
            const newIinf = box('iinf', avif.subarray(iinf.data, iinf.data + 4), be(oldCount + 1, iinfVer === 0 ? 2 : 4), avif.subarray(infesAt, iinf.end), infe);
            // iref: the Exif item describes (cdsc) the picture
            const cdsc = box('cdsc', be(id, 2), be(1, 2), be(m.primary, 2));
            const iref = kid('iref');
            if (iref && avif[iref.data] !== 0) return avif; // 32-bit ids: not written by AVIF encoders
            const newIref = iref ? box('iref', avif.subarray(iref.data, iref.end), cdsc) : box('iref', new Uint8Array(4), cdsc);
            // iloc, written with a placeholder for now: its size doesn't
            // depend on the numbers in it
            const payload = cat(be(0, 4), tiff);
            const writeIloc = (shift, exifAt) => {
                const parts = [new Uint8Array([L.ver, 0, 0, 0]), new Uint8Array([(L.offSize << 4) | L.lenSize, (L.baseSize << 4) | L.idxSize]), be(L.entries.length + 1, 2)];
                const entry = (e, moved) => {
                    parts.push(be(e.id, 2));
                    if (L.ver === 1) parts.push(be(e.method, 2));
                    parts.push(be(e.ref, 2));
                    const base = e.base + (moved && L.baseSize && e.base ? shift : 0);
                    if (L.baseSize) parts.push(be(base, L.baseSize));
                    parts.push(be(e.extents.length, 2));
                    for (const x of e.extents) {
                        if (L.idxSize) parts.push(be(x.index, L.idxSize));
                        parts.push(be(x.offset + (moved && !(L.baseSize && e.base) ? shift : 0), L.offSize));
                        parts.push(be(x.length, L.lenSize));
                    }
                };
                for (const e of L.entries) entry(e, e.method === 0 && e.base + (e.extents[0] ? e.extents[0].offset : 0) >= meta.end);
                entry({ id, method: 0, ref: 0, base: 0, extents: [{ index: 0, offset: exifAt, length: payload.length }] }, false);
                return box('iloc', ...parts);
            };
            const metaWith = (iloc) => {
                const kids = [];
                for (const b of m.kids) {
                    if (b.type === 'iinf') { kids.push(newIinf); if (!iref) kids.push(newIref); }
                    else if (b.type === 'iref') kids.push(newIref);
                    else if (b.type === 'iloc') kids.push(iloc);
                    else kids.push(avif.subarray(b.start, b.end));
                }
                return box('meta', avif.subarray(meta.data, meta.data + 4), ...kids);
            };
            const shift = metaWith(writeIloc(0, 0)).length - (meta.end - meta.start);
            const exifAt = avif.length + shift + 8;
            if (L.offSize === 4 && exifAt + payload.length > 0xFFFFFFFF) return avif;
            const newMeta = metaWith(writeIloc(shift, exifAt));
            return cat(avif.subarray(0, meta.start), newMeta, avif.subarray(meta.end), box('mdat', payload));
        } catch (e) {
            return avif;
        }
    },

    // ---- PNG ----

    // A PNG with this EXIF (an eXIf chunk, before its pixels)
    withExifPng(png, tiff) {
        const chunks = this.pngChunks(png);
        if (!chunks || !tiff || chunks[0].type !== 'IHDR' || chunks.some(c => c.type === 'eXIf')) return png;
        if (!this._crc) {
            this._crc = new Uint32Array(256);
            for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; this._crc[n] = c >>> 0; }
        }
        const chunk = new Uint8Array(12 + tiff.length), v = new DataView(chunk.buffer);
        v.setUint32(0, tiff.length);
        chunk.set([0x65, 0x58, 0x49, 0x66], 4);
        chunk.set(tiff, 8);
        let c = 0xFFFFFFFF;
        for (let i = 4; i < 8 + tiff.length; i++) c = this._crc[(c ^ chunk[i]) & 255] ^ (c >>> 8);
        v.setUint32(8 + tiff.length, (c ^ 0xFFFFFFFF) >>> 0);
        const at = chunks[0].end;
        const out = new Uint8Array(png.length + chunk.length);
        out.set(png.subarray(0, at));
        out.set(chunk, at);
        out.set(png.subarray(at), at + chunk.length);
        return out;
    },

    // A JPEG with this EXIF, just after its start (when it has none)
    withExifJpeg(jpeg, tiff) {
        const segs = this.jpegSegments(jpeg);
        if (!segs || !tiff || tiff.length + 8 > 0xFFFF || segs.some(s => this.isExifSeg(jpeg, s))) return jpeg;
        const app1 = new Uint8Array(10 + tiff.length);
        app1.set([0xFF, 0xE1, (tiff.length + 8) >> 8, (tiff.length + 8) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
        app1.set(tiff, 10);
        const out = new Uint8Array(jpeg.length + app1.length);
        out.set(jpeg.subarray(0, 2));
        out.set(app1, 2);
        out.set(jpeg.subarray(2), 2 + app1.length);
        return out;
    },

    // ---- TIFF files ----
    //
    // A TIFF file is its own EXIF: its first IFD has the picture's tags and
    // the camera's (Make, DateTime…), with the Exif and GPS IFDs hanging off
    // it. Read, the camera's part is copied into a small TIFF block of its
    // own (compactTiff), as other formats' EXIF is; written (a TIFF made by
    // tiff-codec.js), that block goes first and the picture's IFD joins its
    // tags to the camera's (withExifTiff).

    isTiffFile(bytes) {
        return bytes.length >= 8 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0)
            || (bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0 && bytes[3] === 42));
    },

    TIFF_TYPE_SIZE: { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8 },
    // The picture's own tags (how its pixels are stored), never the camera's
    TIFF_PICTURE_TAGS: new Set([254, 255, 256, 257, 258, 259, 262, 263, 266, 273, 277, 278, 279, 280, 281, 284, 317, 320,
        322, 323, 324, 325, 330, 338, 339, 340, 341, 347, 513, 514, 529, 530, 531, 532, 34675]),
    TIFF_POINTERS: new Set([0x8769, 0x8825, 0xA005]), // Exif, GPS, Interoperability

    // The camera's tags of a TIFF file (bytes: the file, or as much of its
    // start as holds them) as a TIFF block in the same byte order → bytes, or null
    compactTiff(bytes) {
        try {
            const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const le = bytes[0] === 0x49;
            let out = new Uint8Array(4096), o = 8;
            const room = (n) => { if (o + n > out.length) { const b = new Uint8Array(Math.max(out.length * 2, o + n)); b.set(out); out = b; } };
            const ov = () => new DataView(out.buffer);
            out.set(bytes.subarray(0, 4));
            const copyIfd = (off, depth, top) => {
                const n = v.getUint16(off, le);
                const entries = [];
                for (let i = 0; i < n; i++) {
                    const e = off + 2 + i * 12, tag = v.getUint16(e, le);
                    if (top && this.TIFF_PICTURE_TAGS.has(tag)) continue;
                    entries.push(e);
                }
                const at = o + (o & 1);
                o = at;
                room(2 + entries.length * 12 + 4);
                ov().setUint16(at, entries.length, le);
                o = at + 2 + entries.length * 12 + 4;
                ov().setUint32(o - 4, 0, le);
                entries.forEach((e, i) => {
                    const to = at + 2 + i * 12;
                    out.set(bytes.subarray(e, e + 8), to);
                    const tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), count = v.getUint32(e + 4, le);
                    const size = (this.TIFF_TYPE_SIZE[type] || 1) * count;
                    if (this.TIFF_POINTERS.has(tag) && depth < 3) {
                        ov().setUint32(to + 8, copyIfd(v.getUint32(e + 8, le), depth + 1, false), le);
                    } else if (size <= 4) {
                        out.set(bytes.subarray(e + 8, e + 12), to + 8);
                    } else {
                        const from = v.getUint32(e + 8, le);
                        if (from + size > bytes.length || size > 1 << 20) { ov().setUint32(to + 4, 0, le); return; }
                        const dataAt = o + (o & 1);
                        o = dataAt;
                        room(size);
                        out.set(bytes.subarray(from, from + size), dataAt);
                        o += size;
                        ov().setUint32(to + 8, dataAt, le);
                    }
                });
                return at;
            };
            const first = copyIfd(v.getUint32(4, le), 0, true);
            ov().setUint32(4, first, le);
            return out.slice(0, o);
        } catch (e) {
            return null; // not all of it was there
        }
    },

    // A TIFF from tiff-codec.js (little-endian, 8-bit strips) with this EXIF
    // block: the block first, the strips after it, then an IFD with the
    // picture's tags and the camera's, which the header points to
    withExifTiff(file, tiff) {
        if (!tiff || !this.isTiffFile(tiff) || !this.isTiffFile(file)) return file;
        try {
            const fv = new DataView(file.buffer, file.byteOffset, file.byteLength);
            const ev = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
            const le = tiff[0] === 0x49;
            const read = (v, l, e) => {
                const type = v.getUint16(e + 2, l), count = v.getUint32(e + 4, l), size = (this.TIFF_TYPE_SIZE[type] || 1) * count;
                const at = size <= 4 ? e + 8 : v.getUint32(e + 8, l);
                return Array.from({ length: count }, (_, i) => type === 3 ? v.getUint16(at + i * 2, l) : type === 5 ? [v.getUint32(at + i * 8, l), v.getUint32(at + i * 8 + 4, l)] : v.getUint32(at + i * 4, l));
            };
            // The picture's tags, as written by tiff-codec.js
            const fi = fv.getUint32(4, true), picture = [];
            for (let i = 0, n = fv.getUint16(fi, true); i < n; i++) {
                const e = fi + 2 + i * 12;
                picture.push({ tag: fv.getUint16(e, true), type: fv.getUint16(e + 2, true), vals: read(fv, true, e) });
            }
            const offsets = picture.find(p => p.tag === 273), counts = picture.find(p => p.tag === 279);
            if (!offsets || !counts) return file;
            // The camera's, from the block
            const ei = ev.getUint32(4, le), camera = [];
            for (let i = 0, n = ev.getUint16(ei, le); i < n; i++) {
                const e = ei + 2 + i * 12, tag = ev.getUint16(e, le);
                if (!this.TIFF_PICTURE_TAGS.has(tag) && tag !== 274) camera.push({ tag, raw: tiff.subarray(e, e + 12) });
            }
            const have = new Set(camera.map(c => c.tag));
            const tags = [...picture.filter(p => !have.has(p.tag)), { tag: 274, type: 3, vals: [1] }, ...camera].sort((a, b) => a.tag - b.tag);
            // Where things go
            const base = tiff.length + (tiff.length & 1);
            let o = base;
            const from = offsets.vals;
            offsets.vals = from.map((x, i) => { const at = o; o += counts.vals[i] + (counts.vals[i] & 1); return at; });
            const extraAt = new Map();
            for (const p of tags) {
                if (!p.vals) continue;
                const size = (this.TIFF_TYPE_SIZE[p.type] || 1) * p.vals.length;
                if (size > 4) { extraAt.set(p, o); o += size + (size & 1); }
            }
            const ifdAt = o;
            o += 2 + tags.length * 12 + 4;
            const out = new Uint8Array(o), v = new DataView(out.buffer);
            out.set(tiff);
            offsets.vals.forEach((at, i) => out.set(file.subarray(from[i], from[i] + counts.vals[i]), at));
            const put = (at, type, vals) => vals.forEach((x, i) => {
                if (type === 3) v.setUint16(at + i * 2, x, le);
                else if (type === 5) { v.setUint32(at + i * 8, x[0], le); v.setUint32(at + i * 8 + 4, x[1], le); }
                else v.setUint32(at + i * 4, x, le);
            });
            v.setUint16(ifdAt, tags.length, le);
            tags.forEach((p, i) => {
                const e = ifdAt + 2 + i * 12;
                if (p.raw) { out.set(p.raw, e); return; }
                v.setUint16(e, p.tag, le); v.setUint16(e + 2, p.type, le); v.setUint32(e + 4, p.vals.length, le);
                if (extraAt.has(p)) { v.setUint32(e + 8, extraAt.get(p), le); put(extraAt.get(p), p.type, p.vals); }
                else put(e + 8, p.type, p.vals);
            });
            v.setUint32(ifdAt + 2 + tags.length * 12, 0, le);
            v.setUint32(4, ifdAt, le);
            return out;
        } catch (e) {
            return file;
        }
    },

    // A JPEG XL codestream in the container, with this EXIF
    withExifJxl(jxl, tiff) {
        if (jxl.length < 2 || jxl[0] !== 0xFF || jxl[1] !== 0x0A || !tiff) return jxl;
        const be32 = (n) => new Uint8Array([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
        const ascii = (s) => new TextEncoder().encode(s);
        const parts = [
            new Uint8Array([0, 0, 0, 12, 0x4A, 0x58, 0x4C, 0x20, 0x0D, 0x0A, 0x87, 0x0A]),
            be32(20), ascii('ftyp'), ascii('jxl '), be32(0), ascii('jxl '),
            be32(12 + tiff.length), ascii('Exif'), be32(0), tiff,
            be32(8 + jxl.length), ascii('jxlc'), jxl
        ];
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    },

    // ---- Pixel size without decoding ----

    // { w, h } as displayed (EXIF orientation 5–8 swaps them), from a JPEG
    // SOF segment or PNG IHDR in the first bytes of the file, else null.
    readPixelSize(bytes) {
        try {
            const segs = this.jpegSegments(bytes);
            if (segs) {
                let orientation = 1;
                for (const s of segs) {
                    if (this.isExifSeg(bytes, s)) {
                        const t = this.exifTiff(bytes, s);
                        const ifd0 = t && this.readIfd(t, t.view.getUint32(t.tiff + 4, t.le));
                        const e = ifd0 && ifd0.entries.find(x => x.tag === 0x0112);
                        if (e) orientation = this.readIntEntry(t, e) || 1;
                    }
                    const m = s.marker;
                    const isSof = m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;
                    if (isSof && s.end - s.start >= 9) {
                        const h = (bytes[s.start + 5] << 8) | bytes[s.start + 6];
                        const w = (bytes[s.start + 7] << 8) | bytes[s.start + 8];
                        return orientation >= 5 ? { w: h, h: w } : { w, h };
                    }
                }
                return null;
            }
            const chunks = this.pngChunks(bytes, { partial: true });
            if (chunks && chunks[0] && chunks[0].type === 'IHDR') {
                const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                return { w: v.getUint32(chunks[0].data), h: v.getUint32(chunks[0].data + 4) };
            }
        } catch (e) { /* unknown */ }
        return null;
    },

    // ---- Resolution (DPI) ----

    // { x, y } in dots per inch, or null when the file doesn't say.
    readDpi(bytes) {
        try {
            const segs = this.jpegSegments(bytes);
            if (segs) {
                for (const s of segs) {
                    if (s.marker === 0xE0 && this.hasSig(bytes, s, 'JFIF\0') && s.end - s.start >= 18) {
                        const units = bytes[s.start + 11];
                        const x = (bytes[s.start + 12] << 8) | bytes[s.start + 13];
                        const y = (bytes[s.start + 14] << 8) | bytes[s.start + 15];
                        if (units === 1 && x > 1) return { x, y };
                        if (units === 2 && x > 1) return { x: x * 2.54, y: y * 2.54 };
                    }
                }
                for (const s of segs) {
                    if (!this.isExifSeg(bytes, s)) continue;
                    const t = this.exifTiff(bytes, s);
                    const ifd0 = t && this.readIfd(t, t.view.getUint32(t.tiff + 4, t.le));
                    if (!ifd0) continue;
                    let xr = null, yr = null, unit = 2;
                    for (const e of ifd0.entries) {
                        if (e.tag === 0x011A) xr = this.readRational(t, e);
                        if (e.tag === 0x011B) yr = this.readRational(t, e);
                        if (e.tag === 0x0128) unit = this.readIntEntry(t, e);
                    }
                    // 72 dpi is every camera's placeholder, not a real scan resolution
                    if (xr && xr !== 72) {
                        const k = unit === 3 ? 2.54 : 1;
                        return { x: xr * k, y: (yr || xr) * k };
                    }
                }
                return null;
            }
            const chunks = this.pngChunks(bytes, { partial: true });
            const phys = chunks && chunks.find(c => c.type === 'pHYs');
            if (phys && bytes[phys.data + 8] === 1) {
                const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                return { x: v.getUint32(phys.data) * 0.0254, y: v.getUint32(phys.data + 4) * 0.0254 };
            }
        } catch (e) { /* unknown resolution */ }
        return null;
    }
};
