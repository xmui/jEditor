// The fields people edit in Info (meta-editor.js): title, caption,
// keywords, rating, author, copyright, the date taken and the place.
//
// Read from the photo's XMP, then its IPTC, then its EXIF, the first that
// has each (as Lightroom and the Metadata Working Group do). Written into
// the file without encoding the picture again: the XMP packet is rewritten
// with the fields changed (everything else in it kept), the EXIF gets the
// date taken and the place, and fields other apps also keep in EXIF or IPTC
// (Windows' own XP tags, an older app's IPTC caption) are kept in step
// where the file already has them, so no app shows an old value.
//
//   JPEG, PNG, WebP, TIFF   into the file (APP1/APP13, eXIf/iTXt, EXIF/XMP
//                           chunks, the TIFF's own tags)
//   RAW, HEIC, AVIF, JPEG XL, GIF
//                           an .xmp file beside it (name.xmp, as Lightroom
//                           writes), read back over what the photo has
//
// Values: strings ('' is none); keywords an array; rating 0–5 (0 none);
// taken 'YYYY-MM-DDTHH:MM:SS' in the photo's own local time, as EXIF keeps
// it ('' none); gps { lat, lon } in degrees, or null.
//
// Never throws on reading (an empty set of fields instead); writing throws
// with a message to show when a file can't take the change.

const MetaFields = {
    FIELDS: ['title', 'caption', 'keywords', 'rating', 'author', 'copyright', 'taken', 'gps'],

    NS: {
        x: 'adobe:ns:meta/',
        rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
        dc: 'http://purl.org/dc/elements/1.1/',
        xmp: 'http://ns.adobe.com/xap/1.0/',
        photoshop: 'http://ns.adobe.com/photoshop/1.0/',
        exif: 'http://ns.adobe.com/exif/1.0/',
        MicrosoftPhoto: 'http://ns.microsoft.com/photo/1.0/'
    },
    XMP_SIG: 'http://ns.adobe.com/xap/1.0/\0',

    empty() {
        return { title: '', caption: '', keywords: [], rating: 0, author: '', copyright: '', taken: '', gps: null };
    },

    // Where a change to this photo goes: 'file', or 'sidecar' (name.xmp)
    where(name) {
        if (typeof Raw !== 'undefined' && Raw.is(name)) return 'sidecar';
        return /\.(jpe?g|png|webp|tiff?)$/i.test(name) ? 'file' : 'sidecar';
    },

    sidecarName(name) {
        return name.replace(/\.[^.]+$/, '') + '.xmp';
    },

    // ---- Reading ----

    // The fields of a photo: its bytes (the whole file, or for a JPEG as
    // much of its start as holds the headers), and its .xmp beside it if
    // there is one (text)
    async read(bytes, sidecar = null) {
        const out = this.empty();
        try {
            const parts = await this.parts(bytes);
            if (parts.tiff) this.fromExif(out, parts.tiff);
            if (parts.iptc) this.fromIptc(out, parts.iptc);
            // The newest word last: the photo's XMP, then the .xmp beside it
            if (parts.xmp) this.fromXmp(out, parts.xmp);
            if (sidecar) this.fromXmp(out, sidecar);
        } catch (e) { /* what was read so far */ }
        return out;
    },

    // The EXIF (TIFF block), XMP (text) and IPTC (IIM bytes) in a file
    async parts(bytes) {
        const M = ImageMeta, out = { tiff: null, xmp: null, iptc: null };
        if (M.isTiffFile(bytes)) {
            out.tiff = bytes;
            const t = this.tiff(bytes);
            const x = t && t.get(t.ifd0, 700);
            if (x) out.xmp = this.text(x);
            const ip = t && t.get(t.ifd0, 33723);
            if (ip) out.iptc = ip;
            return out;
        }
        const segs = M.jpegSegments(bytes, { partial: true });
        if (segs) {
            for (const s of segs) {
                if (M.isExifSeg(bytes, s)) out.tiff = out.tiff || bytes.subarray(s.start + 10, s.end);
                else if (s.marker === 0xE1 && M.hasSig(bytes, s, this.XMP_SIG)) out.xmp = out.xmp || this.text(bytes.subarray(s.start + 4 + this.XMP_SIG.length, s.end));
                else if (s.marker === 0xED && M.hasSig(bytes, s, 'Photoshop 3.0\0')) out.iptc = out.iptc || this.iimOf(bytes.subarray(s.start + 18, s.end));
            }
            return out;
        }
        const chunks = M.pngChunks(bytes, { partial: true });
        if (chunks) {
            for (const c of chunks) {
                if (c.type === 'eXIf') out.tiff = M.unprefixed(bytes.slice(c.data, c.end - 4));
                else if (c.type === 'iTXt') {
                    const x = await this.pngItxt(bytes.subarray(c.data, c.end - 4));
                    if (x && x.key === 'XML:com.adobe.xmp') out.xmp = x.text;
                }
            }
            return out;
        }
        const riff = M.webpChunks(bytes);
        if (riff) {
            for (const c of riff) {
                if (c.type === 'EXIF') out.tiff = M.unprefixed(bytes.slice(c.data, c.data + c.size));
                else if (c.type === 'XMP ') out.xmp = this.text(bytes.subarray(c.data, c.data + c.size));
            }
            return out;
        }
        out.tiff = M.exifOf(bytes);
        return out;
    },

    text(b) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/\0+$/, ''); } catch (e) { return new TextDecoder('latin1').decode(b).replace(/\0+$/, ''); }
    },

    // A PNG iTXt chunk's keyword and text (inflated when it's compressed)
    async pngItxt(d) {
        const z = d.indexOf(0);
        if (z < 1 || z + 3 > d.length) return null;
        const key = new TextDecoder('latin1').decode(d.subarray(0, z));
        const compressed = d[z + 1];
        let p = z + 3;
        p = d.indexOf(0, p) + 1; // language
        if (!p) return null;
        p = d.indexOf(0, p) + 1; // translated keyword
        if (!p) return null;
        let body = d.subarray(p);
        if (compressed) {
            if (typeof DecompressionStream === 'undefined') return null;
            body = new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
        }
        return { key, text: new TextDecoder().decode(body) };
    },

    // ---- EXIF (a TIFF block, or a whole TIFF file) ----

    TYPE_SIZE: { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8 },

    // A reader over a TIFF block: its IFDs and their values
    tiff(b) {
        if (!b || b.length < 8) return null;
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const le = b[0] === 0x49;
        if (!le && b[0] !== 0x4D) return null;
        if (v.getUint16(2, le) !== 42) return null;
        const self = this;
        const t = {
            b, v, le,
            ifd(off) {
                if (!off || off + 2 > b.length) return null;
                const n = v.getUint16(off, le);
                if (off + 2 + n * 12 + 4 > b.length) return null;
                const entries = [];
                for (let i = 0; i < n; i++) {
                    const pos = off + 2 + i * 12;
                    entries.push({ tag: v.getUint16(pos, le), type: v.getUint16(pos + 2, le), count: v.getUint32(pos + 4, le), pos });
                }
                return { off, entries, next: v.getUint32(off + 2 + n * 12, le) };
            },
            find(ifd, tag) { return ifd && ifd.entries.find(e => e.tag === tag) || null; },
            // Where an entry's value is, and how long
            at(e) {
                const size = (self.TYPE_SIZE[e.type] || 1) * e.count;
                const at = size <= 4 ? e.pos + 8 : v.getUint32(e.pos + 8, le);
                return at + size <= b.length ? { at, size } : null;
            },
            get(ifd, tag) {
                const e = this.find(ifd, tag);
                const w = e && this.at(e);
                return w ? b.subarray(w.at, w.at + w.size) : null;
            },
            int(ifd, tag) {
                const e = this.find(ifd, tag);
                if (!e) return null;
                if (e.type === 3 || e.type === 8) return v.getUint16(e.pos + 8, le);
                if (e.type === 4 || e.type === 9) return v.getUint32(e.pos + 8, le);
                if (e.type === 1) return b[e.pos + 8];
                return null;
            },
            rationals(ifd, tag) {
                const e = this.find(ifd, tag);
                const w = e && e.type === 5 && this.at(e);
                if (!w) return null;
                const out = [];
                for (let i = 0; i < e.count; i++) { const d = v.getUint32(w.at + i * 8 + 4, le); out.push(d ? v.getUint32(w.at + i * 8, le) / d : 0); }
                return out;
            }
        };
        t.ifd0 = t.ifd(v.getUint32(4, le));
        t.exif = t.ifd0 && t.ifd(t.int(t.ifd0, 0x8769));
        t.gps = t.ifd0 && t.ifd(t.int(t.ifd0, 0x8825));
        return t;
    },

    ascii(b) {
        return b ? this.text(b).replace(/\0[\s\S]*$/, '').trim() : '';
    },

    // Windows' XP tags: UCS-2, little-endian
    ucs2(b) {
        if (!b) return '';
        let s = '';
        for (let i = 0; i + 1 < b.length; i += 2) { const c = b[i] | (b[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
        return s.trim();
    },

    // Words cameras put in the description on their own
    CAMERA_JUNK: /^(OLYMPUS DIGITAL CAMERA|SONY DSC|DCIM|default|Exif_JPEG_PICTURE|DIGITAL CAMERA|KODAK Digital Still Camera|MINOLTA DIGITAL CAMERA)$/i,

    fromExif(out, tb) {
        const t = this.tiff(tb);
        if (!t || !t.ifd0) return;
        const d = this.ascii(t.get(t.exif, 0x9003)).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
        if (d && +d[1] >= 1000 && +d[2] >= 1 && +d[3] >= 1) out.taken = `${d[1]}-${d[2]}-${d[3]}T${d[4]}:${d[5]}:${d[6]}`;
        const desc = this.ascii(t.get(t.ifd0, 0x010E));
        if (desc && !this.CAMERA_JUNK.test(desc)) out.caption = desc;
        out.author = this.ascii(t.get(t.ifd0, 0x013B));
        out.copyright = this.ascii(t.get(t.ifd0, 0x8298));
        const xpT = this.ucs2(t.get(t.ifd0, 0x9C9B)), xpC = this.ucs2(t.get(t.ifd0, 0x9C9C)), xpA = this.ucs2(t.get(t.ifd0, 0x9C9D)), xpK = this.ucs2(t.get(t.ifd0, 0x9C9E));
        if (xpT) out.title = xpT;
        if (xpC && !out.caption) out.caption = xpC;
        if (xpA && !out.author) out.author = xpA;
        if (xpK) out.keywords = this.splitList(xpK);
        const r = t.int(t.ifd0, 0x4746);
        if (r != null && r >= 0 && r <= 5) out.rating = r;
        if (t.gps) {
            const lat = t.rationals(t.gps, 2), lon = t.rationals(t.gps, 4);
            if (lat && lon && lat.length === 3 && lon.length === 3) {
                const deg = (a) => a[0] + a[1] / 60 + a[2] / 3600;
                const latRef = this.ascii(t.get(t.gps, 1)), lonRef = this.ascii(t.get(t.gps, 3));
                const g = { lat: deg(lat) * (latRef === 'S' ? -1 : 1), lon: deg(lon) * (lonRef === 'W' ? -1 : 1) };
                if (isFinite(g.lat) && isFinite(g.lon) && (g.lat || g.lon)) out.gps = this.roundGps(g);
            }
        }
    },

    splitList(s) {
        return [...new Set(String(s).split(/[;,]/).map(x => x.trim()).filter(Boolean))];
    },

    roundGps(g) {
        return { lat: Math.round(g.lat * 1e6) / 1e6, lon: Math.round(g.lon * 1e6) / 1e6 };
    },

    // ---- IPTC (IIM, in a JPEG's Photoshop block or a TIFF's tag 33723) ----

    // The IIM inside a Photoshop APP13's resources (after "Photoshop 3.0\0")
    iimOf(res) {
        const r = this.psResources(res);
        const iptc = r && r.find(x => x.id === 0x0404);
        return iptc ? res.subarray(iptc.data, iptc.data + iptc.size) : null;
    },

    // 8BIM resources: [{ id, start, data, size, end }]
    psResources(b) {
        const out = [];
        let p = 0;
        while (p + 12 <= b.length) {
            if (b[p] !== 0x38 || b[p + 1] !== 0x42 || b[p + 2] !== 0x49 || b[p + 3] !== 0x4D) return out;
            const id = (b[p + 4] << 8) | b[p + 5];
            const nameLen = b[p + 6];
            let q = p + 6 + 1 + nameLen;
            if ((q - p) & 1) q++;
            if (q + 4 > b.length) return out;
            const size = ((b[q] << 24) | (b[q + 1] << 16) | (b[q + 2] << 8) | b[q + 3]) >>> 0;
            const data = q + 4;
            let end = data + size;
            if (end > b.length) return out;
            if (size & 1) end++;
            out.push({ id, start: p, data, size, end: Math.min(end, b.length) });
            p = end;
        }
        return out;
    },

    // IIM datasets: [{ rec, ds, data }]
    iim(b) {
        const out = [];
        let p = 0;
        while (p + 5 <= b.length && b[p] === 0x1C) {
            const len = (b[p + 3] << 8) | b[p + 4];
            if (len & 0x8000) break; // an extended length: nothing jEditor writes or needs
            if (p + 5 + len > b.length) break;
            out.push({ rec: b[p + 1], ds: b[p + 2], data: b.subarray(p + 5, p + 5 + len) });
            p += 5 + len;
        }
        return out;
    },

    // UTF-8 when the IIM says so (1:90 ESC % G), else Latin-1, or UTF-8 that reads as it
    iimText(sets, d) {
        const utf8 = sets.some(s => s.rec === 1 && s.ds === 90 && s.data[0] === 0x1B && s.data[1] === 0x25 && s.data[2] === 0x47);
        return utf8 ? new TextDecoder().decode(d).trim() : this.text(d).trim();
    },

    fromIptc(out, b) {
        const sets = this.iim(b);
        const one = (ds) => { const s = sets.find(x => x.rec === 2 && x.ds === ds); return s ? this.iimText(sets, s.data) : ''; };
        const all = (ds) => sets.filter(x => x.rec === 2 && x.ds === ds).map(s => this.iimText(sets, s.data)).filter(Boolean);
        if (one(5)) out.title = one(5);
        if (one(120)) out.caption = one(120);
        if (all(25).length) out.keywords = [...new Set(all(25))];
        if (all(80).length) out.author = all(80).join('; ');
        if (one(116)) out.copyright = one(116);
        const day = one(55).match(/^(\d{4})(\d{2})(\d{2})$/);
        if (day && !out.taken) {
            const tm = one(60).match(/^(\d{2})(\d{2})(\d{2})/);
            out.taken = `${day[1]}-${day[2]}-${day[3]}T${tm ? `${tm[1]}:${tm[2]}:${tm[3]}` : '00:00:00'}`;
        }
    },

    // ---- XMP ----

    xmpDoc(text) {
        if (!text || typeof DOMParser === 'undefined') return null;
        const s = text.indexOf('<x:xmpmeta'), e = text.lastIndexOf('</x:xmpmeta>');
        let body = s >= 0 && e > s ? text.slice(s, e + 12) : null;
        if (!body) {
            const r = text.indexOf('<rdf:RDF'), re = text.lastIndexOf('</rdf:RDF>');
            if (r < 0 || re < r) return null;
            body = `<x:xmpmeta xmlns:x="${this.NS.x}">${text.slice(r, re + 10)}</x:xmpmeta>`;
        }
        const doc = new DOMParser().parseFromString(body, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) return null;
        return doc;
    },

    descriptions(doc) {
        return [...doc.getElementsByTagNameNS(this.NS.rdf, 'Description')];
    },

    // A property's value: a string, or an array for a Bag or Seq
    xmpGet(doc, ns, local) {
        for (const d of this.descriptions(doc)) {
            const a = d.getAttributeNS(this.NS[ns], local);
            if (a) return a;
            const el = [...d.children].find(c => c.namespaceURI === this.NS[ns] && c.localName === local);
            if (!el) continue;
            const lis = [...el.getElementsByTagNameNS(this.NS.rdf, 'li')];
            const alt = el.getElementsByTagNameNS(this.NS.rdf, 'Alt')[0];
            if (alt) {
                const def = lis.find(l => l.getAttribute('xml:lang') === 'x-default') || lis[0];
                return def ? def.textContent : '';
            }
            if (el.getElementsByTagNameNS(this.NS.rdf, 'Bag')[0] || el.getElementsByTagNameNS(this.NS.rdf, 'Seq')[0]) return lis.map(l => l.textContent.trim()).filter(Boolean);
            return el.textContent;
        }
        return null;
    },

    fromXmp(out, text) {
        const doc = this.xmpDoc(text);
        if (!doc) return;
        const s = (ns, l) => { const v = this.xmpGet(doc, ns, l); return Array.isArray(v) ? v.join('; ') : (v || '').trim(); };
        const title = s('dc', 'title') || s('photoshop', 'Headline');
        if (title) out.title = title;
        const cap = s('dc', 'description');
        if (cap) out.caption = cap;
        const kw = this.xmpGet(doc, 'dc', 'subject');
        if (kw && kw.length) out.keywords = Array.isArray(kw) ? [...new Set(kw)] : this.splitList(kw);
        const by = s('dc', 'creator');
        if (by) out.author = by;
        const rights = s('dc', 'rights');
        if (rights) out.copyright = rights;
        const r = parseInt(s('xmp', 'Rating'), 10);
        if (r >= 0 && r <= 5 && s('xmp', 'Rating') !== '') out.rating = r;
        const when = this.fromXmpDate(s('exif', 'DateTimeOriginal') || s('photoshop', 'DateCreated'));
        if (when) out.taken = when;
        const lat = this.fromXmpGps(s('exif', 'GPSLatitude')), lon = this.fromXmpGps(s('exif', 'GPSLongitude'));
        if (lat != null && lon != null) out.gps = this.roundGps({ lat, lon });
    },

    // "1962-12-25T09:00:00", "1962-12-25T09:00", "1962-12-25", "1962"
    fromXmpDate(s) {
        const m = String(s || '').match(/^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?)?)?/);
        if (!m) return '';
        return `${m[1]}-${m[2] || '01'}-${m[3] || '01'}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
    },

    // "41,52.686N" or "41,52,41N" → degrees
    fromXmpGps(s) {
        const m = String(s || '').match(/^\s*(\d+),(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?\s*([NSEW])\s*$/i);
        if (!m) return null;
        const v = +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
        return /[SW]/i.test(m[4]) ? -v : v;
    },

    toXmpGps(v, pos, neg) {
        const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
        return `${d},${m.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}${v < 0 ? neg : pos}`;
    },

    // The XMP with these fields changed (others kept), as a packet
    xmpWith(text, changes) {
        let doc = this.xmpDoc(text);
        if (text && !doc) throw new Error('its XMP can\'t be read, so jEditor won\'t change it');
        if (!doc) {
            doc = new DOMParser().parseFromString(`<x:xmpmeta xmlns:x="${this.NS.x}"><rdf:RDF xmlns:rdf="${this.NS.rdf}"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta>`, 'application/xml');
        }
        let desc = this.descriptions(doc)[0];
        if (!desc) {
            const rdf = doc.getElementsByTagNameNS(this.NS.rdf, 'RDF')[0];
            desc = doc.createElementNS(this.NS.rdf, 'rdf:Description');
            desc.setAttributeNS(this.NS.rdf, 'rdf:about', '');
            rdf.appendChild(desc);
        }
        const drop = (ns, local) => {
            for (const d of this.descriptions(doc)) {
                d.removeAttributeNS(this.NS[ns], local);
                for (const c of [...d.children]) if (c.namespaceURI === this.NS[ns] && c.localName === local) c.remove();
            }
        };
        const has = (ns, local) => this.xmpGet(doc, ns, local) != null;
        const put = (ns, local, kind, value) => {
            drop(ns, local);
            const empty = value == null || value === '' || (Array.isArray(value) && !value.length);
            if (empty) return;
            // Declared once on the description, not on each property
            if (!desc.lookupNamespaceURI(ns)) desc.setAttributeNS('http://www.w3.org/2000/xmlns/', `xmlns:${ns}`, this.NS[ns]);
            const el = doc.createElementNS(this.NS[ns], `${ns}:${local}`);
            if (kind === 'text') el.textContent = String(value);
            else {
                const box = doc.createElementNS(this.NS.rdf, kind === 'alt' ? 'rdf:Alt' : kind === 'seq' ? 'rdf:Seq' : 'rdf:Bag');
                for (const v of kind === 'alt' ? [value] : value) {
                    const li = doc.createElementNS(this.NS.rdf, 'rdf:li');
                    if (kind === 'alt') li.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'x-default');
                    li.textContent = v;
                    box.appendChild(li);
                }
                el.appendChild(box);
            }
            desc.appendChild(el);
        };
        const c = changes;
        if ('title' in c) {
            put('dc', 'title', 'alt', c.title);
            if (has('photoshop', 'Headline')) put('photoshop', 'Headline', 'text', c.title);
        }
        if ('caption' in c) put('dc', 'description', 'alt', c.caption);
        if ('keywords' in c) put('dc', 'subject', 'bag', c.keywords);
        if ('author' in c) put('dc', 'creator', 'seq', String(c.author || '').split(';').map(x => x.trim()).filter(Boolean));
        if ('copyright' in c) put('dc', 'rights', 'alt', c.copyright);
        if ('rating' in c) {
            put('xmp', 'Rating', 'text', c.rating ? String(c.rating) : '');
            if (has('MicrosoftPhoto', 'Rating')) put('MicrosoftPhoto', 'Rating', 'text', c.rating ? String(this.ratingPercent(c.rating)) : '');
        }
        if ('taken' in c) {
            put('exif', 'DateTimeOriginal', 'text', c.taken);
            put('photoshop', 'DateCreated', 'text', c.taken);
        }
        if ('gps' in c) {
            put('exif', 'GPSLatitude', 'text', c.gps ? this.toXmpGps(c.gps.lat, 'N', 'S') : '');
            put('exif', 'GPSLongitude', 'text', c.gps ? this.toXmpGps(c.gps.lon, 'E', 'W') : '');
            if (c.gps && !has('exif', 'GPSVersionID')) put('exif', 'GPSVersionID', 'text', '2.3.0.0');
            if (!c.gps) put('exif', 'GPSVersionID', 'text', '');
        }
        let xml = new XMLSerializer().serializeToString(doc.documentElement);
        // Room to grow in place, as other writers leave
        return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${xml}\n${(' '.repeat(99) + '\n').repeat(20)}<?xpacket end="w"?>`;
    },

    ratingPercent(r) {
        return [0, 1, 25, 50, 75, 99][r] || 0;
    },

    // ---- EXIF writing ----
    //
    // A tag whose new value fits where the old one is, is written there.
    // Otherwise the IFD is written again after everything else, pointing at
    // the same values it had (none of them move, so a maker note's offsets
    // stay true), and whatever pointed at it is changed to the new one.

    // tags: { ifd0: { tag: value|null }, exif: {…}, gps: {…} }, value
    // { type, count, data: Uint8Array }; null takes the tag out → a new block
    exifWith(block, tags) {
        let b = block && block.length >= 8 ? new Uint8Array(block) : this.newTiff();
        let t = this.tiff(b);
        if (!t || !t.ifd0) throw new Error('its EXIF can\'t be read, so jEditor won\'t change it');
        const extra = [];
        let size = b.length;
        const append = (data) => {
            if (size & 1) { extra.push(new Uint8Array(1)); size++; }
            const at = size;
            extra.push(data);
            size += data.length;
            return at;
        };
        const le = t.le;
        const u16 = (n) => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n, le); return a; };
        const u32 = (n) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n, le); return a; };
        const longVal = (n) => ({ type: 4, count: 1, data: u32(n) });
        // The changes to one IFD → its offset, new or the same
        const change = (ifd, set) => {
            const keys = Object.keys(set).map(Number);
            if (!keys.length) return ifd ? ifd.off : 0;
            // In place, when every change fits
            if (ifd && keys.every(k => {
                const e = t.find(ifd, k), v = set[k];
                if (!e || !v || e.type !== v.type) return false;
                const w = t.at(e);
                if (!w) return false;
                if (v.data.length === w.size) return true;
                return v.type === 2 && v.data.length < w.size && w.size > 4;
            })) {
                for (const k of keys) {
                    const e = t.find(ifd, k), v = set[k], w = t.at(e);
                    b.fill(0, w.at, w.at + w.size);
                    b.set(v.data, w.at);
                }
                return ifd.off;
            }
            const entries = new Map();
            if (ifd) for (const e of ifd.entries) entries.set(e.tag, { tag: e.tag, raw: b.subarray(e.pos, e.pos + 12) });
            for (const k of keys) {
                const v = set[k];
                if (!v) { entries.delete(k); continue; }
                const raw = new Uint8Array(12);
                raw.set(u16(k), 0);
                raw.set(u16(v.type), 2);
                raw.set(u32(v.count), 4);
                if (v.data.length <= 4) raw.set(v.data, 8);
                else raw.set(u32(append(v.data)), 8);
                entries.set(k, { tag: k, raw });
            }
            const list = [...entries.values()].sort((a, c) => a.tag - c.tag);
            const out = new Uint8Array(2 + list.length * 12 + 4);
            out.set(u16(list.length), 0);
            list.forEach((e, i) => out.set(e.raw, 2 + i * 12));
            out.set(u32(ifd ? ifd.next : 0), 2 + list.length * 12);
            return append(out);
        };
        const ifd0Set = { ...(tags.ifd0 || {}) };
        for (const [key, ptr] of [['exif', 0x8769], ['gps', 0x8825]]) {
            const set = tags[key] || {};
            if (!Object.keys(set).length) continue;
            const old = t[key];
            // Nothing to take out of an IFD that isn't there
            if (!old && !Object.values(set).some(Boolean)) continue;
            const off = change(old, set);
            if (!old || off !== old.off) ifd0Set[ptr] = longVal(off);
        }
        const off0 = change(t.ifd0, ifd0Set);
        const out = new Uint8Array(size);
        out.set(b);
        let o = b.length;
        for (const e of extra) { out.set(e, o); o += e.length; }
        if (off0 !== t.ifd0.off) new DataView(out.buffer).setUint32(4, off0, le);
        return out;
    },

    // An EXIF block with nothing in it, to add tags to
    newTiff() {
        const b = new Uint8Array(14);
        b.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
        return b;
    },

    asciiVal(s) {
        const d = new TextEncoder().encode(String(s));
        const data = new Uint8Array(d.length + 1);
        data.set(d);
        return { type: 2, count: data.length, data };
    },

    ucs2Val(s) {
        const str = String(s);
        const data = new Uint8Array(str.length * 2 + 2);
        for (let i = 0; i < str.length; i++) { data[i * 2] = str.charCodeAt(i) & 255; data[i * 2 + 1] = str.charCodeAt(i) >> 8; }
        return { type: 1, count: data.length, data };
    },

    // The EXIF changes for these fields, given the block as it is
    exifTags(block, changes) {
        const t = block && block.length >= 8 ? this.tiff(block) : null;
        const le = t ? t.le : true;
        const has = (ifd, tag) => !!(t && t[ifd] && t.find(t[ifd], tag));
        const tags = { ifd0: {}, exif: {}, gps: {} };
        const c = changes;
        // Kept in step where the file has them
        const keep = (ifd, tag, v) => { if (has(ifd, tag)) tags[ifd][tag] = v; };
        if ('title' in c) keep('ifd0', 0x9C9B, c.title ? this.ucs2Val(c.title) : null);
        if ('caption' in c) {
            keep('ifd0', 0x010E, c.caption ? this.asciiVal(c.caption) : null);
            keep('ifd0', 0x9C9C, c.caption ? this.ucs2Val(c.caption) : null);
        }
        if ('keywords' in c) keep('ifd0', 0x9C9E, c.keywords.length ? this.ucs2Val(c.keywords.join('; ')) : null);
        if ('author' in c) {
            keep('ifd0', 0x013B, c.author ? this.asciiVal(c.author) : null);
            keep('ifd0', 0x9C9D, c.author ? this.ucs2Val(c.author) : null);
        }
        if ('copyright' in c) keep('ifd0', 0x8298, c.copyright ? this.asciiVal(c.copyright) : null);
        if ('rating' in c) {
            const s = (n) => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n, le); return { type: 3, count: 1, data: a }; };
            keep('ifd0', 0x4746, s(c.rating || 0));
            keep('ifd0', 0x4749, s(this.ratingPercent(c.rating || 0)));
        }
        // The date and the place always go in, where every app looks
        if ('taken' in c) {
            const v = c.taken ? this.asciiVal(c.taken.replace(/-/g, ':').replace('T', ' ').slice(0, 19)) : null;
            tags.exif[0x9003] = v;
            // An old "digitized" date the same as the old taken one goes along
            if (t && t.exif) {
                const was = this.ascii(t.get(t.exif, 0x9003)), dig = this.ascii(t.get(t.exif, 0x9004));
                if (was && dig === was) tags.exif[0x9004] = v;
            }
        }
        if ('gps' in c) {
            if (c.gps) {
                const rat = (deg) => {
                    const a = Math.abs(deg), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60 * 10000);
                    const data = new Uint8Array(24), v = new DataView(data.buffer);
                    [[d, 1], [m, 1], [s, 10000]].forEach(([n, den], i) => { v.setUint32(i * 8, n, le); v.setUint32(i * 8 + 4, den, le); });
                    return { type: 5, count: 3, data };
                };
                tags.gps[0] = { type: 1, count: 4, data: new Uint8Array([2, 3, 0, 0]) };
                tags.gps[1] = this.asciiVal(c.gps.lat < 0 ? 'S' : 'N');
                tags.gps[2] = rat(c.gps.lat);
                tags.gps[3] = this.asciiVal(c.gps.lon < 0 ? 'W' : 'E');
                tags.gps[4] = rat(c.gps.lon);
            } else if (t && t.gps) {
                for (const tag of [0, 1, 2, 3, 4]) if (t.find(t.gps, tag)) tags.gps[tag] = null;
            }
        }
        return tags;
    },

    // Does this change touch the EXIF at all?
    touchesExif(tags) {
        return ['ifd0', 'exif', 'gps'].some(k => Object.keys(tags[k] || {}).length);
    },

    // ---- IPTC writing (only where the file already has IPTC) ----

    iimWith(b, changes) {
        let sets = this.iim(b);
        const utf8 = sets.some(s => s.rec === 1 && s.ds === 90 && s.data[0] === 0x1B && s.data[1] === 0x25 && s.data[2] === 0x47);
        const enc = new TextEncoder();
        let needUtf8 = false;
        const add = [];
        const str = (ds, v) => { if (/[^\x00-\x7F]/.test(v)) needUtf8 = true; add.push({ rec: 2, ds, text: v }); };
        const c = changes;
        const drop = (...dss) => { sets = sets.filter(s => !(s.rec === 2 && dss.includes(s.ds))); };
        if ('title' in c) { drop(5); if (c.title) str(5, c.title.slice(0, 64)); }
        if ('caption' in c) { drop(120); if (c.caption) str(120, c.caption.slice(0, 2000)); }
        if ('keywords' in c) { drop(25); for (const k of c.keywords) str(25, k.slice(0, 64)); }
        if ('author' in c) { drop(80); for (const a of this.splitList(c.author || '')) str(80, a.slice(0, 32)); }
        if ('copyright' in c) { drop(116); if (c.copyright) str(116, c.copyright.slice(0, 128)); }
        if ('taken' in c && sets.some(s => s.rec === 2 && s.ds === 55)) {
            drop(55, 60);
            if (c.taken) { add.push({ rec: 2, ds: 55, text: c.taken.slice(0, 10).replace(/-/g, '') }); add.push({ rec: 2, ds: 60, text: c.taken.slice(11, 19).replace(/:/g, '') }); }
        }
        if (needUtf8 && !utf8) {
            // Latin-1 can't hold it: the IIM says UTF-8 from now on, and what it had is made UTF-8
            sets = sets.map(s => s.rec === 2 ? { ...s, data: enc.encode(this.text(s.data)) } : s);
            sets.unshift({ rec: 1, ds: 90, data: new Uint8Array([0x1B, 0x25, 0x47]) });
        }
        const asUtf8 = utf8 || needUtf8;
        const encode = (text) => asUtf8 ? enc.encode(text) : Uint8Array.from(text, ch => ch.charCodeAt(0) & 255);
        // Record 2 in dataset order, after record 1
        const all = [...sets, ...add.map(a => ({ rec: a.rec, ds: a.ds, data: encode(a.text) }))];
        all.sort((a, z) => a.rec - z.rec || a.ds - z.ds);
        const len = all.reduce((n, s) => n + 5 + s.data.length, 0);
        const out = new Uint8Array(len);
        let o = 0;
        for (const s of all) {
            out.set([0x1C, s.rec, s.ds, s.data.length >> 8, s.data.length & 255], o);
            out.set(s.data, o + 5);
            o += 5 + s.data.length;
        }
        return out;
    },

    // A Photoshop block's resources with this IIM (and without the IPTC
    // digest, which only an old copy would match)
    psWith(res, iim) {
        const list = this.psResources(res);
        const parts = [];
        for (const r of list) {
            if (r.id === 0x0425) continue;
            if (r.id === 0x0404) {
                const head = res.slice(r.start, r.data - 4);
                const size = new Uint8Array(4);
                new DataView(size.buffer).setUint32(0, iim.length);
                parts.push(head, size, iim);
                if (iim.length & 1) parts.push(new Uint8Array(1));
                continue;
            }
            parts.push(res.subarray(r.start, r.end));
        }
        const last = list.length ? list[list.length - 1].end : 0;
        if (last < res.length) parts.push(res.subarray(last));
        return this.cat(parts);
    },

    cat(parts) {
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    },

    // ---- Writing a file ----

    // The file's bytes with these fields changed → new bytes. changes: only
    // the fields that change
    async write(bytes, changes) {
        const M = ImageMeta;
        const parts = await this.parts(bytes);
        const xmp = new TextEncoder().encode(this.xmpWith(parts.xmp, changes));
        const tags = this.exifTags(parts.tiff, changes);
        const exif = this.touchesExif(tags) ? this.exifWith(parts.tiff, tags) : null;
        if (M.isTiffFile(bytes)) return this.writeTiff(bytes, tags, xmp, changes);
        if (M.jpegSegments(bytes)) return this.writeJpeg(bytes, exif, xmp, changes);
        if (M.pngChunks(bytes)) return this.writePng(bytes, exif, xmp);
        if (M.webpChunks(bytes)) return this.writeWebp(bytes, exif, xmp);
        throw new Error('this kind of file can\'t take it');
    },

    writeJpeg(bytes, exif, xmp, changes) {
        const M = ImageMeta;
        const segs = M.jpegSegments(bytes);
        const seg = (marker, sig, payload) => {
            const n = 2 + sig.length + payload.length;
            if (n > 0xFFFF) throw new Error(marker === 0xE1 && sig.startsWith('Exif') ? 'its EXIF is too big for a JPEG' : 'it has too much metadata for a JPEG');
            const s = new Uint8Array(2 + n);
            s.set([0xFF, marker, n >> 8, n & 255]);
            for (let i = 0; i < sig.length; i++) s[4 + i] = sig.charCodeAt(i);
            s.set(payload, 4 + sig.length);
            return s;
        };
        const xmpSeg = seg(0xE1, this.XMP_SIG, xmp);
        const exifSeg = exif && seg(0xE1, 'Exif\0\0', exif);
        const out = [bytes.subarray(0, 2)];
        let putExif = !exifSeg, putXmp = false;
        const afterHead = () => {
            if (!putExif) { out.push(exifSeg); putExif = true; }
            if (!putXmp) { out.push(xmpSeg); putXmp = true; }
        };
        for (const s of segs) {
            if (s.marker === 0xDA) { afterHead(); out.push(bytes.subarray(s.start)); break; }
            // JFIF stays first, as it must
            if (s.marker === 0xE0 && M.hasSig(bytes, s, 'JFIF\0')) { out.push(bytes.subarray(s.start, s.end)); continue; }
            if (M.isExifSeg(bytes, s)) {
                if (exifSeg) { if (!putExif) { out.push(exifSeg); putExif = true; } } else out.push(bytes.subarray(s.start, s.end));
                continue;
            }
            if (s.marker === 0xE1 && M.hasSig(bytes, s, this.XMP_SIG)) {
                if (!putExif) { out.push(exifSeg); putExif = true; }
                if (!putXmp) { out.push(xmpSeg); putXmp = true; }
                continue;
            }
            if (s.marker === 0xED && M.hasSig(bytes, s, 'Photoshop 3.0\0')) {
                const res = bytes.subarray(s.start + 18, s.end);
                const iim = this.iimOf(res);
                if (iim) { out.push(seg(0xED, 'Photoshop 3.0\0', this.psWith(res, this.iimWith(iim, changes)))); continue; }
            }
            afterHead();
            out.push(bytes.subarray(s.start, s.end));
        }
        return this.cat(out);
    },

    pngChunk(type, data) {
        const M = ImageMeta;
        if (!M._crc) {
            M._crc = new Uint32Array(256);
            for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; M._crc[n] = c >>> 0; }
        }
        const c = new Uint8Array(12 + data.length), v = new DataView(c.buffer);
        v.setUint32(0, data.length);
        for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
        c.set(data, 8);
        let crc = 0xFFFFFFFF;
        for (let i = 4; i < 8 + data.length; i++) crc = M._crc[(crc ^ c[i]) & 255] ^ (crc >>> 8);
        v.setUint32(8 + data.length, (crc ^ 0xFFFFFFFF) >>> 0);
        return c;
    },

    writePng(bytes, exif, xmp) {
        const chunks = ImageMeta.pngChunks(bytes);
        const key = new TextEncoder().encode('XML:com.adobe.xmp');
        const itxt = new Uint8Array(key.length + 5 + xmp.length);
        itxt.set(key);
        itxt.set(xmp, key.length + 5); // \0, not compressed, method 0, no language, no translation
        const out = [bytes.subarray(0, 8)];
        for (const c of chunks) {
            const raw = bytes.subarray(c.start, c.end);
            if (c.type === 'eXIf' && exif) continue;
            if (c.type === 'iTXt' && new TextDecoder('latin1').decode(bytes.subarray(c.data, c.data + key.length + 1)) === 'XML:com.adobe.xmp\0') continue;
            out.push(raw);
            if (c.type === 'IHDR') {
                if (exif) out.push(this.pngChunk('eXIf', exif));
                out.push(this.pngChunk('iTXt', itxt));
            }
        }
        return this.cat(out);
    },

    writeWebp(bytes, exif, xmp) {
        const M = ImageMeta;
        const chunks = M.webpChunks(bytes);
        const chunk = (type, payload) => {
            const c = new Uint8Array(8 + payload.length + (payload.length & 1));
            for (let i = 0; i < 4; i++) c[i] = type.charCodeAt(i);
            new DataView(c.buffer).setUint32(4, payload.length, true);
            c.set(payload, 8);
            return c;
        };
        let head;
        const vp8x = chunks.find(c => c.type === 'VP8X');
        if (vp8x) head = bytes.slice(vp8x.start, vp8x.data + vp8x.size + (vp8x.size & 1));
        else {
            const img = chunks.find(c => c.type === 'VP8 ' || c.type === 'VP8L');
            if (!img) throw new Error('its WebP can\'t be read');
            let w, h;
            const d = img.data;
            if (img.type === 'VP8L') {
                const bits = bytes[d + 1] | (bytes[d + 2] << 8) | (bytes[d + 3] << 16) | (bytes[d + 4] << 24);
                w = (bits & 0x3FFF) + 1;
                h = ((bits >>> 14) & 0x3FFF) + 1;
            } else {
                w = (bytes[d + 6] | (bytes[d + 7] << 8)) & 0x3FFF;
                h = (bytes[d + 8] | (bytes[d + 9] << 8)) & 0x3FFF;
            }
            const x = new Uint8Array(10);
            if (img.type === 'VP8L' && (bytes[d + 4] & 0x10)) x[0] |= 0x10;
            x[4] = (w - 1) & 255; x[5] = ((w - 1) >> 8) & 255; x[6] = ((w - 1) >> 16) & 255;
            x[7] = (h - 1) & 255; x[8] = ((h - 1) >> 8) & 255; x[9] = ((h - 1) >> 16) & 255;
            head = chunk('VP8X', x);
        }
        const parts = [head];
        let keptExif = null;
        for (const c of chunks) {
            if (c.type === 'VP8X' || c.type === 'XMP ') continue;
            if (c.type === 'EXIF') { keptExif = bytes.subarray(c.start, c.data + c.size + (c.size & 1)); continue; }
            parts.push(bytes.subarray(c.start, c.data + c.size + (c.size & 1)));
        }
        // After the picture, EXIF then XMP, as the format asks
        if (exif) parts.push(chunk('EXIF', exif));
        else if (keptExif) parts.push(keptExif);
        parts.push(chunk('XMP ', xmp));
        head[8] |= 0x04 | ((exif || keptExif) ? 0x08 : 0);
        const body = this.cat(parts);
        const out = new Uint8Array(12 + body.length);
        out.set(bytes.subarray(0, 12));
        new DataView(out.buffer).setUint32(4, out.length - 8, true);
        out.set(body, 12);
        return out;
    },

    // A TIFF file: its own tags are its EXIF; the XMP is tag 700 and an
    // IPTC block tag 33723
    writeTiff(bytes, tags, xmp, changes) {
        const t = this.tiff(bytes);
        tags.ifd0[700] = { type: 1, count: xmp.length, data: xmp };
        const ip = t && t.get(t.ifd0, 33723);
        const e = ip && t.find(t.ifd0, 33723);
        if (ip && e) {
            const data = this.iimWith(ip, changes);
            const n = e.type === 4 ? Math.ceil(data.length / 4) : data.length;
            const padded = new Uint8Array(e.type === 4 ? n * 4 : n);
            padded.set(data);
            tags.ifd0[33723] = { type: e.type === 4 ? 4 : 7, count: n, data: padded };
        }
        return this.exifWith(bytes, tags);
    },

    // An .xmp file beside the photo, with these fields changed
    sidecarWith(text, changes) {
        return this.xmpWith(text, changes);
    },

    // ---- Comparing ----

    same(k, a, b) {
        if (k === 'keywords') return (a || []).length === (b || []).length && (a || []).every((x, i) => x === b[i]);
        if (k === 'gps') return (!a && !b) || (!!a && !!b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7);
        return (a || '') === (b || '') || (k === 'rating' && (a || 0) === (b || 0));
    }
};

if (typeof window !== 'undefined') window.MetaFields = MetaFields;
