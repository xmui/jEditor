// Thumbnails of HEIC/HEIF photos (feature `heif`): libheif, with libde265
// for HEVC, linked dynamically (LGPL; docs/developing.md, The engine).
//
// libheif decodes the whole photo (HEVC has no scaled decode like JPEG's),
// but here, natively and many at once, rather than in the page. A photo
// that carries a thumbnail of its own at least as wide as wanted (an
// iPhone's is usually smaller) uses that instead. libheif applies the
// photo's rotation, mirroring and crop, as the page's decoder does.

use std::sync::OnceLock;

use libheif_rs::{ColorSpace, HeifContext, ImageHandle, LibHeif, RgbChroma};

use crate::thumb::{self, Error, Rgb};

// Started once (it loads its decoders), never stopped
fn lib() -> &'static LibHeif {
    static LIB: OnceLock<LibHeif> = OnceLock::new();
    LIB.get_or_init(LibHeif::new)
}

/// The HEIC's thumbnail: `width` px wide as shown, as a JPEG of `quality`
pub fn heic_thumbnail(bytes: &[u8], width: u32, quality: f32) -> Result<Vec<u8>, Error> {
    let small = heic_thumbnail_rgb(bytes, width)?;
    thumb::encode_jpeg(&small, quality)
}

/// The same, as RGB pixels
pub fn heic_thumbnail_rgb(bytes: &[u8], width: u32) -> Result<Rgb, Error> {
    let lib = lib();
    let ctx = HeifContext::read_from_bytes(bytes).map_err(|e| Error::Bad(e.to_string()))?;
    let primary = ctx.primary_image_handle().map_err(|e| Error::Bad(e.to_string()))?;
    let handle = own_thumbnail(&primary, width).unwrap_or(primary);
    let img = decode(lib, &handle)?;
    let tw = (width as usize).max(1);
    let th = ((img.h as f64 * tw as f64 / img.w as f64).round() as usize).max(1);
    thumb::resize(img, tw, th)
}

/// The whole photo, as RGB pixels (as shown)
pub fn decode_full(bytes: &[u8]) -> Result<Rgb, Error> {
    let ctx = HeifContext::read_from_bytes(bytes).map_err(|e| Error::Bad(e.to_string()))?;
    let primary = ctx.primary_image_handle().map_err(|e| Error::Bad(e.to_string()))?;
    decode(lib(), &primary)
}

// The photo's own thumbnail when it's at least `width` wide (as shown, so
// the narrower side when its rotation turns it, which isn't known before
// decoding: both sides must be enough)
fn own_thumbnail(primary: &ImageHandle, width: u32) -> Option<ImageHandle> {
    let n = primary.number_of_thumbnails();
    if n == 0 {
        return None;
    }
    let mut ids = vec![0; n];
    let n = primary.thumbnail_ids(&mut ids);
    ids.truncate(n);
    ids.into_iter()
        .filter_map(|id| primary.thumbnail(id).ok())
        .filter(|t| t.width().min(t.height()) >= width)
        .min_by_key(|t| t.width() as u64 * t.height() as u64)
}

fn decode(lib: &LibHeif, handle: &ImageHandle) -> Result<Rgb, Error> {
    let img = lib
        .decode(handle, ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|e| Error::Bad(e.to_string()))?;
    let planes = img.planes();
    let p = planes.interleaved.ok_or_else(|| Error::Bad("no RGB plane".into()))?;
    let (w, h) = (p.width as usize, p.height as usize);
    if w == 0 || h == 0 {
        return Err(Error::Bad("empty image".into()));
    }
    // Rows without their padding
    let mut px = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        px.extend_from_slice(&p.data[y * p.stride..y * p.stride + w * 3]);
    }
    Ok(Rgb { w, h, px })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HALVES: &[u8] = include_bytes!("../tests/fixtures/halves.heic"); // 600 × 400: red | blue

    #[test]
    fn thumbnail_size_and_colours() {
        let t = heic_thumbnail_rgb(HALVES, 300).unwrap();
        assert_eq!((t.w, t.h), (300, 200));
        let at = |x: usize, y: usize| &t.px[(y * t.w + x) * 3..(y * t.w + x) * 3 + 3];
        let (l, r) = (at(60, 100), at(240, 100));
        assert!(l[0] > 180 && l[2] < 80, "left is red: {l:?}");
        assert!(r[2] > 180 && r[0] < 80, "right is blue: {r:?}");
        let full = decode_full(HALVES).unwrap();
        assert_eq!((full.w, full.h), (600, 400));
        // As a JPEG, the size asked for
        let j = heic_thumbnail(HALVES, 120, 80.0).unwrap();
        let back = thumb::decode_full(&j).unwrap();
        assert_eq!((back.w, back.h), (120, 80));
    }

    #[test]
    fn bad_files() {
        assert!(matches!(heic_thumbnail_rgb(b"junk", 100), Err(Error::Bad(_))));
        assert!(matches!(heic_thumbnail_rgb(&HALVES[..200], 100), Err(Error::Bad(_))));
    }
}
