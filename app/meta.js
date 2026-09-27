// Image metadata surgery for JPEG and PNG.
//
// A canvas re-encode (crop, straighten, non-JPEG rotation) produces a file
// with no metadata at all: capture date, camera, colour profile and DPI are
// gone. For scan orders that matters — DPI drives print size and the ICC
// profile drives colour. These helpers copy the metadata that is still
// true after an edit from the original file onto the re-encoded one, and
// patch what changed (orientation, pixel dimensions, stale EXIF thumbnail).
//
// Everything works on Uint8Arrays and never throws: on anything unexpected
// the caller gets the re-encoded file back untouched.

const ImageMeta = {

    // ---- JPEG structure ----

    // Header segments from SOI up to (and including) SOS. SOS covers the
    // rest of the file. Returns [{ marker, start, end }] or null.
    jpegSegments(bytes) {
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
            if (len < 2 || p + 2 + len > bytes.length) return null;
            segs.push({ marker: m, start: p, end: p + 2 + len });
            p += 2 + len;
        }
        return null;
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
    // Adobe APP14 (colour transform flags) and MPF APP2 (byte offsets into
    // the old file) would corrupt the new file if copied.
    keepJpegSeg(bytes, seg) {
        const m = seg.marker;
        if (m === 0xE0) return this.hasSig(bytes, seg, 'JFIF\0');          // density / DPI
        if (m === 0xE1) return this.isExifSeg(bytes, seg) || this.isXmpSeg(bytes, seg);
        if (m === 0xE2) return this.hasSig(bytes, seg, 'ICC_PROFILE\0');   // colour profile
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

    pngChunks(bytes) {
        const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const chunks = [];
        let p = 8;
        while (p + 12 <= bytes.length) {
            const len = view.getUint32(p);
            const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
            const end = p + 12 + len;
            if (end > bytes.length) return null;
            chunks.push({ type, start: p, end, data: p + 8 });
            p = end;
            if (type === 'IEND') break;
        }
        return chunks;
    },

    PNG_COLOR_CHUNKS: ['iCCP', 'sRGB', 'gAMA', 'cHRM'],
    PNG_KEEP_CHUNKS: ['iCCP', 'sRGB', 'gAMA', 'cHRM', 'pHYs', 'tEXt', 'zTXt', 'iTXt'],

    // ---- Transplant ----

    // Colour components in a JPEG's frame header (3 = YCbCr, 4 = CMYK/YCCK)
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

    // Should the edit decode without colour conversion? True when the
    // original's colour profile will be copied onto the result, so the
    // pixels must stay in that profile's space (decoding to sRGB and then
    // re-tagging with, say, Adobe RGB would wash the colours out). A CMYK
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
            const chunks = this.pngChunks(bytes);
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
            const chunks = this.pngChunks(bytes);
            const phys = chunks && chunks.find(c => c.type === 'pHYs');
            if (phys && bytes[phys.data + 8] === 1) {
                const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                return { x: v.getUint32(phys.data) * 0.0254, y: v.getUint32(phys.data + 4) * 0.0254 };
            }
        } catch (e) { /* unknown resolution */ }
        return null;
    }
};
