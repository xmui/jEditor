// jEditor's engine (docs/plans/fast-engine.md): the heavy image work, in
// Rust, inside the desktop apps. The page asks for results (a thumbnail of
// this file, this wide), never pixels it has to move itself.
//
// Phase 1: JPEG thumbnails (thumb.rs), RAW thumbnails from the JPEG inside
// them (raw.rs) and, with the feature `heif`, HEIC thumbnails (heif.rs);
// and the same three at the screen's size for the viewer (je_preview_file).
// Called by the Windows app through the C interface below (src/Engine.cs).

pub mod exif;
#[cfg(feature = "heif")]
pub mod heif;
pub mod raw;
pub mod thumb;

use std::os::raw::c_char;

/// Bytes the engine made, handed to the host; given back with je_free
#[repr(C)]
pub struct JeBuf {
    pub ptr: *mut u8,
    pub len: usize,
    pub cap: usize,
}

impl JeBuf {
    fn empty() -> Self {
        JeBuf { ptr: std::ptr::null_mut(), len: 0, cap: 0 }
    }
    fn from(mut v: Vec<u8>) -> Self {
        let b = JeBuf { ptr: v.as_mut_ptr(), len: v.len(), cap: v.capacity() };
        std::mem::forget(v);
        b
    }
}

pub const JE_OK: i32 = 0;
/// Not a kind of file the engine reads yet: the page makes it itself
pub const JE_UNSUPPORTED: i32 = 1;
/// The file couldn't be read
pub const JE_IO: i32 = 2;
/// The file couldn't be decoded
pub const JE_BAD: i32 = 3;
/// A wrong argument (a null pointer, a path that isn't UTF-8)
pub const JE_ARG: i32 = 4;

/// The engine's version, for the host's log ("jeditor-engine 0.1.0")
#[no_mangle]
pub extern "C" fn je_version() -> *const c_char {
    concat!("jeditor-engine ", env!("CARGO_PKG_VERSION"), "\0").as_ptr() as *const c_char
}

/// The kinds of photo je_thumbnail_file reads, by extension, space
/// separated ("jpg jpeg heic heif"): the host asks only for these
#[no_mangle]
pub extern "C" fn je_formats() -> *const c_char {
    #[cfg(feature = "heif")]
    let f = "jpg jpeg heic heif dng cr2 cr3 nef nrw arw sr2 srf orf rw2 rwl pef srw 3fr iiq erf kdc dcr mos mef raf\0";
    #[cfg(not(feature = "heif"))]
    let f = "jpg jpeg dng cr2 cr3 nef nrw arw sr2 srf orf rw2 rwl pef srw 3fr iiq erf kdc dcr mos mef raf\0";
    f.as_ptr() as *const c_char
}

/// A thumbnail of the photo at `path` (UTF-8, `path_len` bytes), `width`
/// px wide as shown, as a JPEG into `*out`. Safe to call from many
/// threads at once.
///
/// # Safety
/// `path` must point to `path_len` readable bytes and `out` to a JeBuf.
#[no_mangle]
pub unsafe extern "C" fn je_thumbnail_file(path: *const u8, path_len: usize, width: u32, out: *mut JeBuf) -> i32 {
    if path.is_null() || out.is_null() || width == 0 || width > 4096 {
        return JE_ARG;
    }
    *out = JeBuf::empty();
    let Ok(path) = std::str::from_utf8(std::slice::from_raw_parts(path, path_len)) else {
        return JE_ARG;
    };
    let r = std::panic::catch_unwind(|| thumbnail_file(path, width));
    match r {
        Ok(Ok(v)) => {
            *out = JeBuf::from(v);
            JE_OK
        }
        Ok(Err(code)) => code,
        Err(_) => JE_BAD,
    }
}

fn thumbnail_file(path: &str, width: u32) -> Result<Vec<u8>, i32> {
    let lower = path.to_ascii_lowercase();
    let jpeg = lower.ends_with(".jpg") || lower.ends_with(".jpeg");
    let heic = lower.ends_with(".heic") || lower.ends_with(".heif");
    if raw::is_raw(&lower) {
        return raw_thumbnail(path, width);
    }
    if !jpeg && !(heic && cfg!(feature = "heif")) {
        return Err(JE_UNSUPPORTED);
    }
    let bytes = std::fs::read(path).map_err(|_| JE_IO)?;
    let made = if jpeg {
        thumb::jpeg_thumbnail(&bytes, width, 80.0)
    } else {
        heic_thumbnail(&bytes, width)
    };
    made.map_err(|e| match e {
        thumb::Error::Unsupported(_) => JE_UNSUPPORTED,
        thumb::Error::Bad(_) => JE_BAD,
    })
}

/// The viewer's picture of the photo at `path`: its long side at most
/// `edge` px (never bigger than the photo), turned as shown, as a JPEG
/// into `*out`; `*w` × `*h`, the whole photo's size as shown (a RAW's: its
/// JPEG's). The same kinds as je_thumbnail_file. Safe from many threads.
///
/// # Safety
/// `path` must point to `path_len` readable bytes; `out`, `w` and `h` to
/// a JeBuf and two u32s.
#[no_mangle]
pub unsafe extern "C" fn je_preview_file(path: *const u8, path_len: usize, edge: u32, out: *mut JeBuf, w: *mut u32, h: *mut u32) -> i32 {
    if path.is_null() || out.is_null() || w.is_null() || h.is_null() || edge == 0 || edge > 8192 {
        return JE_ARG;
    }
    *out = JeBuf::empty();
    let Ok(path) = std::str::from_utf8(std::slice::from_raw_parts(path, path_len)) else {
        return JE_ARG;
    };
    match std::panic::catch_unwind(|| preview_file(path, edge)) {
        Ok(Ok((v, pw, ph))) => {
            *out = JeBuf::from(v);
            *w = pw as u32;
            *h = ph as u32;
            JE_OK
        }
        Ok(Err(code)) => code,
        Err(_) => JE_BAD,
    }
}

fn preview_file(path: &str, edge: u32) -> Result<(Vec<u8>, usize, usize), i32> {
    let lower = path.to_ascii_lowercase();
    let jpeg = lower.ends_with(".jpg") || lower.ends_with(".jpeg");
    let heic = lower.ends_with(".heic") || lower.ends_with(".heif");
    let bad = |e: thumb::Error| match e {
        thumb::Error::Unsupported(_) => JE_UNSUPPORTED,
        thumb::Error::Bad(_) => JE_BAD,
    };
    let (img, w, h) = if raw::is_raw(&lower) {
        let mut src = raw::FileSource::open(path).map_err(|_| JE_IO)?;
        let (jpeg, o) = raw::preview(&mut src).ok_or(JE_BAD)?;
        let o = if (1..=8).contains(&o) { o } else { exif::orientation(&jpeg) };
        thumb::oriented_preview_rgb(&jpeg, edge, o).map_err(bad)?
    } else if jpeg {
        let bytes = std::fs::read(path).map_err(|_| JE_IO)?;
        thumb::oriented_preview_rgb(&bytes, edge, exif::orientation(&bytes)).map_err(bad)?
    } else if heic && cfg!(feature = "heif") {
        let bytes = std::fs::read(path).map_err(|_| JE_IO)?;
        heic_preview(&bytes, edge).map_err(bad)?
    } else {
        return Err(JE_UNSUPPORTED);
    };
    // 90, as the page's own previews (app/script.js, getImageWorker)
    Ok((thumb::encode_jpeg(&img, 90.0).map_err(bad)?, w, h))
}

#[cfg(feature = "heif")]
fn heic_preview(bytes: &[u8], edge: u32) -> Result<(thumb::Rgb, usize, usize), thumb::Error> {
    heif::heic_preview_rgb(bytes, edge)
}

#[cfg(not(feature = "heif"))]
fn heic_preview(_: &[u8], _: u32) -> Result<(thumb::Rgb, usize, usize), thumb::Error> {
    Err(thumb::Error::Unsupported("HEIC".into()))
}

// A RAW's: from the JPEG inside it (raw.rs), only that part of the file
// read, turned as the RAW says (or as the JPEG's own EXIF does)
fn raw_thumbnail(path: &str, width: u32) -> Result<Vec<u8>, i32> {
    let mut src = raw::FileSource::open(path).map_err(|_| JE_IO)?;
    let (jpeg, o) = raw::preview(&mut src).ok_or(JE_BAD)?;
    let o = if (1..=8).contains(&o) { o } else { exif::orientation(&jpeg) };
    let small = thumb::oriented_thumbnail_rgb(&jpeg, width, o).map_err(|_| JE_BAD)?;
    thumb::encode_jpeg(&small, 80.0).map_err(|_| JE_BAD)
}

#[cfg(feature = "heif")]
fn heic_thumbnail(bytes: &[u8], width: u32) -> Result<Vec<u8>, thumb::Error> {
    heif::heic_thumbnail(bytes, width, 80.0)
}

#[cfg(not(feature = "heif"))]
fn heic_thumbnail(_: &[u8], _: u32) -> Result<Vec<u8>, thumb::Error> {
    Err(thumb::Error::Unsupported("HEIC".into()))
}

/// Gives back bytes the engine made
///
/// # Safety
/// `buf` must be one the engine returned, given back once.
#[no_mangle]
pub unsafe extern "C" fn je_free(buf: JeBuf) {
    if !buf.ptr.is_null() {
        drop(Vec::from_raw_parts(buf.ptr, buf.len, buf.cap));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c_interface_round_trip() {
        let dir = std::env::temp_dir().join(format!("je-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = thumb::Rgb { w: 900, h: 600, px: vec![128; 900 * 600 * 3] };
        let jpg = dir.join("ä photo.JPG");
        std::fs::write(&jpg, thumb::encode_jpeg(&img, 90.0).unwrap()).unwrap();
        let call = |p: &str, w: u32| unsafe {
            let mut out = JeBuf::empty();
            let code = je_thumbnail_file(p.as_ptr(), p.len(), w, &mut out);
            let bytes = if out.ptr.is_null() { vec![] } else { std::slice::from_raw_parts(out.ptr, out.len).to_vec() };
            je_free(out);
            (code, bytes)
        };
        let (code, bytes) = call(jpg.to_str().unwrap(), 300);
        assert_eq!(code, JE_OK);
        let t = thumb::decode_full(&bytes).unwrap();
        assert_eq!((t.w, t.h), (300, 200));
        assert_eq!(call(dir.join("missing.jpg").to_str().unwrap(), 300).0, JE_IO);
        assert_eq!(call(dir.join("a.png").to_str().unwrap(), 300).0, JE_UNSUPPORTED);
        std::fs::write(dir.join("junk.jpg"), b"junk").unwrap();
        assert_eq!(call(dir.join("junk.jpg").to_str().unwrap(), 300).0, JE_BAD);
        assert_eq!(call(jpg.to_str().unwrap(), 0).0, JE_ARG);
        // A HEIC: made with the feature heif, else left to the page
        let heic = dir.join("Ö photo.HEIC");
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/halves.heic"), &heic).unwrap();
        let (code, bytes) = call(heic.to_str().unwrap(), 150);
        if cfg!(feature = "heif") {
            assert_eq!(code, JE_OK);
            let t = thumb::decode_full(&bytes).unwrap();
            assert_eq!((t.w, t.h), (150, 100));
        } else {
            assert_eq!(code, JE_UNSUPPORTED);
        }
        // The viewer's: fitted inside the edge, with the photo's own size
        let preview = |p: &str, e: u32| unsafe {
            let (mut out, mut w, mut h) = (JeBuf::empty(), 0u32, 0u32);
            let code = je_preview_file(p.as_ptr(), p.len(), e, &mut out, &mut w, &mut h);
            let bytes = if out.ptr.is_null() { vec![] } else { std::slice::from_raw_parts(out.ptr, out.len).to_vec() };
            je_free(out);
            (code, bytes, w, h)
        };
        let (code, bytes, w, h) = preview(jpg.to_str().unwrap(), 450);
        assert_eq!((code, w, h), (JE_OK, 900, 600));
        let p = thumb::decode_full(&bytes).unwrap();
        assert_eq!((p.w, p.h), (450, 300));
        assert_eq!(preview(dir.join("a.png").to_str().unwrap(), 450).0, JE_UNSUPPORTED);
        assert_eq!(preview(dir.join("junk.jpg").to_str().unwrap(), 450).0, JE_BAD);
        let (code, _, w, h) = preview(heic.to_str().unwrap(), 300);
        if cfg!(feature = "heif") {
            assert_eq!((code, w, h), (JE_OK, 600, 400));
        } else {
            assert_eq!(code, JE_UNSUPPORTED);
        }
        let formats = unsafe { std::ffi::CStr::from_ptr(je_formats()) }.to_str().unwrap();
        assert_eq!(formats.contains("heic"), cfg!(feature = "heif"));
        let listed: Vec<&str> = formats.split(' ').collect();
        assert!(raw::EXTENSIONS.iter().all(|e| listed.contains(e)), "every RAW in je_formats");
        std::fs::remove_dir_all(&dir).ok();
    }
}
