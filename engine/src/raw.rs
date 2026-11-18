// RAW files: the full-size JPEG the camera puts inside them, found the way
// the page finds it (app/raw.js, which has the formats and why), but read
// straight from the file: only the headers and that JPEG, never the raw
// data around it (tens of MB a photo).
//
//   TIFF-based (DNG, CR2, NEF, ARW, ORF, RW2, PEF, …): every IFD, SubIFD
//     and EXIF IFD, for JPEG strips, JPEGInterchangeFormat and Panasonic's
//     JpgFromRaw; the biggest baseline or progressive JPEG wins
//   CR3: Canon's PRVW preview and the full-size JPEG in its first track
//   RAF: the JPEG its header points to
//
// The RAW's own orientation is given back with it (0: none, the JPEG's own
// EXIF says).

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

pub const EXTENSIONS: &[&str] = &[
    "dng", "cr2", "cr3", "nef", "nrw", "arw", "sr2", "srf", "orf", "rw2", "rwl", "pef", "srw", "3fr", "iiq", "erf",
    "kdc", "dcr", "mos", "mef", "raf",
];

pub fn is_raw(lower_path: &str) -> bool {
    lower_path.rsplit_once('.').is_some_and(|(_, e)| EXTENSIONS.contains(&e))
}

/// Something to read parts of: a file, or bytes (for the tests)
pub trait Source {
    fn size(&self) -> u64;
    /// `len` bytes at `off`, fewer at the end, none past it
    fn at(&mut self, off: u64, len: usize) -> Vec<u8>;
}

pub struct FileSource {
    file: File,
    size: u64,
}

impl FileSource {
    pub fn open(path: &str) -> std::io::Result<Self> {
        let file = File::open(path)?;
        let size = file.metadata()?.len();
        Ok(FileSource { file, size })
    }
}

impl Source for FileSource {
    fn size(&self) -> u64 {
        self.size
    }
    fn at(&mut self, off: u64, len: usize) -> Vec<u8> {
        if off >= self.size {
            return vec![];
        }
        let len = len.min((self.size - off) as usize);
        let mut v = vec![0; len];
        if self.file.seek(SeekFrom::Start(off)).is_err() {
            return vec![];
        }
        let mut got = 0;
        while got < len {
            match self.file.read(&mut v[got..]) {
                Ok(0) | Err(_) => break,
                Ok(n) => got += n,
            }
        }
        v.truncate(got);
        v
    }
}

impl Source for &[u8] {
    fn size(&self) -> u64 {
        self.len() as u64
    }
    fn at(&mut self, off: u64, len: usize) -> Vec<u8> {
        let s = (off as usize).min(self.len());
        self[s..(s + len).min(self.len())].to_vec()
    }
}

/// The preview JPEG's bytes and the RAW's orientation (0 when it has none)
pub fn preview(src: &mut dyn Source) -> Option<(Vec<u8>, u16)> {
    let head = src.at(0, 16);
    if head.len() < 16 {
        return None;
    }
    let (off, len, o) = if &head[..15] == b"FUJIFILMCCD-RAW" {
        raf(src)?
    } else if &head[4..8] == b"ftyp" {
        cr3(src)?
    } else if head[..2] == *b"II" || head[..2] == *b"MM" {
        let t = tiff(src, 0)?;
        (t.0?.0, t.0?.1, t.1)
    } else {
        return None;
    };
    let jpeg = src.at(off, len as usize);
    (jpeg.len() as u64 == len).then_some((jpeg, o))
}

fn u16_at(b: &[u8], i: usize, le: bool) -> u16 {
    let a = [b[i], b[i + 1]];
    if le { u16::from_le_bytes(a) } else { u16::from_be_bytes(a) }
}

fn u32_at(b: &[u8], i: usize, le: bool) -> u32 {
    let a = [b[i], b[i + 1], b[i + 2], b[i + 3]];
    if le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) }
}

/// A JPEG a browser shows (baseline or progressive) is at off, len long
fn showable(src: &mut dyn Source, off: u64, len: u64) -> bool {
    if len <= 1000 || off + len > src.size() + 16 {
        return false;
    }
    let b = src.at(off, len.min(128 * 1024) as usize);
    if b.len() < 4 || b[0] != 0xFF || b[1] != 0xD8 {
        return false;
    }
    let mut i = 2;
    while i + 4 <= b.len() {
        if b[i] != 0xFF {
            i += 1;
            continue;
        }
        let m = b[i + 1];
        if m == 0xD8 || m == 0x01 || (0xD0..=0xD7).contains(&m) || m == 0xFF {
            i += 1;
            continue;
        }
        match m {
            0xC0..=0xC2 => return true,
            0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF => return false,
            0xDA | 0xD9 => return false,
            _ => i += 2 + u16_at(&b, i + 2, false) as usize,
        }
    }
    false
}

fn biggest(src: &mut dyn Source, mut cands: Vec<(u64, u64)>) -> Option<(u64, u64)> {
    cands.sort_by_key(|c| std::cmp::Reverse(c.1));
    cands.into_iter().find(|&(off, len)| showable(src, off, len))
}

// ---- TIFF-based ----

/// The biggest showable JPEG (offset and length in the file) and the
/// orientation of the first IFD
fn tiff(src: &mut dyn Source, base: u64) -> Option<(Option<(u64, u64)>, u16)> {
    let hdr = src.at(base, 8);
    if hdr.len() < 8 {
        return None;
    }
    let le = hdr[0] == b'I';
    let mut w = Walk { base, le, seen: HashSet::new(), cands: vec![], orientation: 0 };
    w.ifd(src, u32_at(&hdr, 4, le), 0, 0);
    let found = biggest(src, std::mem::take(&mut w.cands));
    Some((found, w.orientation))
}

struct Walk {
    base: u64,
    le: bool,
    seen: HashSet<u32>,
    cands: Vec<(u64, u64)>,
    orientation: u16,
}

impl Walk {
    fn ifd(&mut self, src: &mut dyn Source, off: u32, depth: u32, chain: u32) {
        if off == 0 || depth > 4 || self.seen.len() > 64 || !self.seen.insert(off) {
            return;
        }
        let (le, base) = (self.le, self.base);
        let nb = src.at(base + off as u64, 2);
        if nb.len() < 2 {
            return;
        }
        let n = u16_at(&nb, 0, le) as usize;
        if n == 0 || n > 1000 {
            return;
        }
        let d = src.at(base + off as u64 + 2, n * 12 + 4);
        if d.len() < n * 12 + 4 {
            return;
        }
        let (mut comp, mut strip_off, mut strip_len, mut jif, mut jifl, mut jfr) = (0, None, None, None, None, None);
        let mut subs = vec![];
        let mut exif = None;
        for i in 0..n {
            let e = i * 12;
            let tag = u16_at(&d, e, le);
            if !matches!(tag, 0x0103 | 0x0111 | 0x0117 | 0x0112 | 0x0201 | 0x0202 | 0x014A | 0x8769 | 0x002E) {
                continue;
            }
            if tag == 0x002E {
                jfr = Some((u32_at(&d, e + 8, le) as u64, u32_at(&d, e + 4, le) as u64));
                continue;
            }
            let v = self.values(src, &d, e);
            let first = v.first().copied();
            match tag {
                0x0103 => comp = first.unwrap_or(0),
                0x0111 if v.len() == 1 => strip_off = first,
                0x0117 if v.len() == 1 => strip_len = first,
                0x0112 if depth == 0 && chain == 0 => self.orientation = first.unwrap_or(0) as u16,
                0x0201 => jif = first,
                0x0202 => jifl = first,
                0x014A => subs = v,
                0x8769 => exif = first,
                _ => {}
            }
        }
        if comp == 6 || comp == 7 {
            if let (Some(o), Some(l)) = (strip_off, strip_len) {
                self.cands.push((base + o as u64, l as u64));
            }
        }
        if let (Some(o), Some(l)) = (jif, jifl) {
            self.cands.push((base + o as u64, l as u64));
        }
        if let Some((o, l)) = jfr {
            self.cands.push((base + o, l));
        }
        for s in subs {
            self.ifd(src, s, depth + 1, 0);
        }
        if let Some(x) = exif {
            self.ifd(src, x, depth + 1, 0);
        }
        let next = u32_at(&d, n * 12, le);
        if next != 0 {
            self.ifd(src, next, depth, chain + 1);
        }
    }

    /// An entry's values (BYTE, SHORT, LONG and IFD; up to 4096)
    fn values(&self, src: &mut dyn Source, d: &[u8], e: usize) -> Vec<u32> {
        let le = self.le;
        let ty = u16_at(d, e + 2, le);
        let count = u32_at(d, e + 4, le) as usize;
        let unit = match ty {
            3 | 8 => 2,
            4 | 9 | 11 | 13 => 4,
            5 | 10 | 12 => 8,
            _ => 1,
        };
        if count > 4096 {
            return vec![];
        }
        let size = unit * count;
        let far;
        let buf: &[u8] = if size <= 4 {
            &d[e + 8..e + 12]
        } else {
            far = src.at(self.base + u32_at(d, e + 8, le) as u64, size);
            if far.len() < size {
                return vec![];
            }
            &far
        };
        (0..count)
            .map_while(|k| match ty {
                3 => Some(u16_at(buf, k * 2, le) as u32),
                4 | 13 => Some(u32_at(buf, k * 4, le)),
                1 | 7 => Some(buf[k] as u32),
                _ => None,
            })
            .collect()
    }
}

// ---- Fujifilm RAF ----

fn raf(src: &mut dyn Source) -> Option<(u64, u64, u16)> {
    let h = src.at(0, 100);
    if h.len() < 92 {
        return None;
    }
    let (off, len) = (u32_at(&h, 84, false) as u64, u32_at(&h, 88, false) as u64);
    showable(src, off, len).then_some((off, len, 0))
}

// ---- Canon CR3 (ISO base media) ----

struct Boxed {
    kind: [u8; 4],
    off: u64,
    size: u64,
    body: u64,
}

fn boxes(src: &mut dyn Source, mut off: u64, end: u64) -> Vec<Boxed> {
    let mut out = vec![];
    while off + 8 <= end && out.len() < 256 {
        let h = src.at(off, 16);
        if h.len() < 8 {
            break;
        }
        let mut size = u32_at(&h, 0, false) as u64;
        let mut hdr = 8;
        if size == 1 && h.len() >= 16 {
            size = u64::from_be_bytes(h[8..16].try_into().unwrap());
            hdr = 16;
        } else if size == 0 {
            size = end - off;
        }
        if size < hdr {
            break;
        }
        out.push(Boxed { kind: h[4..8].try_into().unwrap(), off, size, body: off + hdr });
        off = off.saturating_add(size);
    }
    out
}

fn inside(src: &mut dyn Source, b: &Boxed) -> Vec<Boxed> {
    boxes(src, b.body, b.off + b.size)
}

const CANON: [u8; 16] = [0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48];

fn cr3(src: &mut dyn Source) -> Option<(u64, u64, u16)> {
    let size = src.size();
    let top = boxes(src, 0, size);
    let moov = top.iter().find(|b| &b.kind == b"moov")?;
    let inner = inside(src, moov);
    let mut cands = vec![];
    let mut orientation = 0;
    // Canon's own box: CMT1 (IFD0: the orientation)
    for b in inner.iter().filter(|b| &b.kind == b"uuid") {
        if src.at(b.body, 16) != CANON {
            continue;
        }
        for c in boxes(src, b.body + 16, b.off + b.size) {
            if &c.kind == b"CMT1" {
                if let Some((_, o)) = tiff(src, c.body) {
                    orientation = o;
                }
            }
        }
    }
    // PRVW: in a uuid box of its own at the top level
    for b in top.iter().filter(|b| &b.kind == b"uuid") {
        let chunk = src.at(b.body, b.size.min(256) as usize);
        let Some(i) = (16..chunk.len().saturating_sub(4)).find(|&i| &chunk[i..i + 4] == b"PRVW") else {
            continue;
        };
        let look = src.at(b.body + i as u64, 64);
        if let Some(k) = (4..look.len().saturating_sub(1)).find(|&k| look[k] == 0xFF && look[k + 1] == 0xD8) {
            let at = b.body + (i + k) as u64;
            let len = u32_at(&look, k - 4, false) as u64;
            cands.push((at, if len > 0 && len < b.size { len } else { b.off + b.size - at }));
        }
    }
    // The first track: the full-size JPEG (its chunk offset and size)
    if let Some(trak) = inner.iter().find(|b| &b.kind == b"trak") {
        let mut stbl = None;
        let mut at = inside(src, trak);
        for name in [b"mdia", b"minf", b"stbl"] {
            let Some(k) = at.into_iter().find(|x| &x.kind == name) else { break };
            if name == b"stbl" {
                stbl = Some(k);
                break;
            }
            at = inside(src, &k);
        }
        if let Some(stbl) = stbl {
            let kids = inside(src, &stbl);
            let stsz = kids.iter().find(|x| &x.kind == b"stsz");
            let co = kids.iter().find(|x| &x.kind == b"co64" || &x.kind == b"stco");
            if let (Some(stsz), Some(co)) = (stsz, co) {
                let sz = src.at(stsz.body, 20);
                let cv = src.at(co.body, 16);
                if sz.len() == 20 && cv.len() == 16 {
                    let len = match u32_at(&sz, 4, false) {
                        0 => u32_at(&sz, 12, false),
                        n => n,
                    } as u64;
                    let off = if &co.kind == b"co64" { u64::from_be_bytes(cv[8..16].try_into().unwrap()) } else { u32_at(&cv, 8, false) as u64 };
                    cands.push((off, len));
                }
            }
        }
    }
    biggest(src, cands).map(|(o, l)| (o, l, orientation))
}

#[cfg(test)]
mod tests {
    use super::*;

    // A small real JPEG, made by the engine itself
    fn jpeg(w: usize, h: usize) -> Vec<u8> {
        let px = (0..w * h * 3).map(|i| (i * 7 % 251) as u8).collect();
        crate::thumb::encode_jpeg(&crate::thumb::Rgb { w, h, px }, 90.0).unwrap()
    }

    // A little-endian TIFF: IFD0 (orientation, a small JPEG thumbnail) and
    // a SubIFD holding the big JPEG as one strip (compression 6)
    fn tiff_raw(o: u16, small: &[u8], big: &[u8]) -> Vec<u8> {
        let mut f = b"II\x2a\x00\x08\x00\x00\x00".to_vec();
        let ent = |t: u16, ty: u16, c: u32, v: u32| [&t.to_le_bytes()[..], &ty.to_le_bytes(), &c.to_le_bytes(), &v.to_le_bytes()].concat();
        let ifd0 = 8u32;
        let ifd0_len = 2 + 4 * 12 + 4;
        let sub = ifd0 + ifd0_len;
        let sub_len = 2 + 3 * 12 + 4;
        let small_at = sub + sub_len;
        let big_at = small_at + small.len() as u32;
        f.extend(4u16.to_le_bytes());
        f.extend(ent(0x0112, 3, 1, o as u32));
        f.extend(ent(0x014A, 4, 1, sub));
        f.extend(ent(0x0201, 4, 1, small_at));
        f.extend(ent(0x0202, 4, 1, small.len() as u32));
        f.extend(0u32.to_le_bytes());
        f.extend(3u16.to_le_bytes());
        f.extend(ent(0x0103, 3, 1, 6));
        f.extend(ent(0x0111, 4, 1, big_at));
        f.extend(ent(0x0117, 4, 1, big.len() as u32));
        f.extend(0u32.to_le_bytes());
        f.extend(small);
        f.extend(big);
        f
    }

    #[test]
    fn tiff_raw_gives_the_biggest_jpeg_and_orientation() {
        let (small, big) = (jpeg(64, 48), jpeg(640, 480));
        let file = tiff_raw(6, &small, &big);
        let (got, o) = preview(&mut &file[..]).unwrap();
        assert_eq!(got, big);
        assert_eq!(o, 6);
    }

    #[test]
    fn raf_gives_its_jpeg() {
        let big = jpeg(320, 240);
        let mut f = b"FUJIFILMCCD-RAW 0201".to_vec();
        f.resize(100, 0);
        f[84..88].copy_from_slice(&100u32.to_be_bytes());
        f[88..92].copy_from_slice(&(big.len() as u32).to_be_bytes());
        f.extend(&big);
        assert_eq!(preview(&mut &f[..]).unwrap(), (big, 0));
    }

    #[test]
    fn junk_is_none_not_a_crash() {
        for f in [vec![], b"II\x2a\x00\xff\xff\xff\xff".to_vec(), b"MM\x00\x2a\x00\x00\x00\x08\x00\x05".to_vec(), vec![0u8; 64]] {
            assert!(preview(&mut &f[..]).is_none());
        }
        let mut cut = tiff_raw(1, &jpeg(64, 48), &jpeg(640, 480));
        cut.truncate(cut.len() - 500);
        let _ = preview(&mut &cut[..]);
    }
}
