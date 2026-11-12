// Thumbnails of JPEGs, the way the page makes them (app/script.js,
// generateThumbnailBlob: createImageBitmap with resizeWidth, then a JPEG at
// 0.8), but decoded straight to about the size wanted: libjpeg's scaled
// decode (n/8 of the size, from the DCT blocks) skips most of the work a
// full decode does, then a fine resize to the exact width.

use fast_image_resize::{images::Image, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use mozjpeg::{ColorSpace, Compress, Decompress};

use crate::exif;

#[derive(Debug)]
pub enum Error {
    /// Not something this engine reads (yet): the page makes it itself
    Unsupported(String),
    /// The file couldn't be read or decoded
    Bad(String),
}

/// A picture: RGB bytes, w × h
pub struct Rgb {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

/// The JPEG's thumbnail: `width` px wide as shown (after its EXIF
/// orientation), as a JPEG of `quality` (0–100)
pub fn jpeg_thumbnail(jpeg: &[u8], width: u32, quality: f32) -> Result<Vec<u8>, Error> {
    let small = jpeg_thumbnail_rgb(jpeg, width)?;
    encode_jpeg(&small, quality)
}

/// The same, as RGB pixels
pub fn jpeg_thumbnail_rgb(jpeg: &[u8], width: u32) -> Result<Rgb, Error> {
    let o = exif::orientation(jpeg);
    let swap = o >= 5;
    let decoded = decode_scaled(jpeg, width as usize, swap)?;
    // The size it's shown at, then that on the photo's own axes
    let (aw, ah) = if swap { (decoded.h, decoded.w) } else { (decoded.w, decoded.h) };
    let tw = (width as usize).max(1);
    let th = ((ah as f64 * tw as f64 / aw as f64).round() as usize).max(1);
    let (rw, rh) = if swap { (th, tw) } else { (tw, th) };
    let resized = resize(decoded, rw, rh)?;
    Ok(orient(resized, o))
}

/// Decoded at the smallest n/8 that's still at least `want` px along the
/// axis that's shown across (the height when the orientation turns it)
pub fn decode_scaled(jpeg: &[u8], want: usize, swap: bool) -> Result<Rgb, Error> {
    guard(|| {
        let mut d = Decompress::new_mem(jpeg).map_err(|e| Error::Bad(e.to_string()))?;
        if d.color_space() == mozjpeg::ColorSpace::JCS_CMYK || d.color_space() == mozjpeg::ColorSpace::JCS_YCCK {
            return Err(Error::Unsupported("CMYK JPEG".into()));
        }
        let (w, h) = d.size();
        let across = if swap { h } else { w };
        let n = (1..=8u8).find(|&n| (across * n as usize).div_ceil(8) >= want).unwrap_or(8);
        d.scale(n);
        let mut s = d.rgb().map_err(|e| Error::Bad(e.to_string()))?;
        let (w, h) = (s.width(), s.height());
        let px = s.read_scanlines::<u8>().map_err(|e| Error::Bad(e.to_string()))?;
        if px.len() != w * h * 3 {
            return Err(Error::Bad("short read".into()));
        }
        // A truncated file still gives a picture (grey below), as browsers show it
        let _ = s.finish();
        Ok(Rgb { w, h, px })
    })
}

/// A full-size decode (for comparing, and later for the viewer)
pub fn decode_full(jpeg: &[u8]) -> Result<Rgb, Error> {
    guard(|| {
        let d = Decompress::new_mem(jpeg).map_err(|e| Error::Bad(e.to_string()))?;
        let mut s = d.rgb().map_err(|e| Error::Bad(e.to_string()))?;
        let (w, h) = (s.width(), s.height());
        let px = s.read_scanlines::<u8>().map_err(|e| Error::Bad(e.to_string()))?;
        let _ = s.finish();
        Ok(Rgb { w, h, px })
    })
}

pub fn resize(src: Rgb, w: usize, h: usize) -> Result<Rgb, Error> {
    if src.w == w && src.h == h {
        return Ok(src);
    }
    let from = Image::from_vec_u8(src.w as u32, src.h as u32, src.px, PixelType::U8x3).map_err(|e| Error::Bad(e.to_string()))?;
    let mut to = Image::new(w as u32, h as u32, PixelType::U8x3);
    let opts = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::CatmullRom));
    Resizer::new().resize(&from, &mut to, &opts).map_err(|e| Error::Bad(e.to_string()))?;
    Ok(Rgb { w, h, px: to.into_vec() })
}

/// Turned and flipped as EXIF orientation `o` says (1–8)
pub fn orient(src: Rgb, o: u16) -> Rgb {
    if o <= 1 || o > 8 {
        return src;
    }
    let (w, h) = (src.w, src.h);
    let (ow, oh) = if o >= 5 { (h, w) } else { (w, h) };
    let mut px = vec![0u8; ow * oh * 3];
    for dy in 0..oh {
        for dx in 0..ow {
            let (sx, sy) = match o {
                2 => (w - 1 - dx, dy),
                3 => (w - 1 - dx, h - 1 - dy),
                4 => (dx, h - 1 - dy),
                5 => (dy, dx),
                6 => (dy, h - 1 - dx),
                7 => (w - 1 - dy, h - 1 - dx),
                _ => (w - 1 - dy, dx), // 8
            };
            let s = (sy * w + sx) * 3;
            let d = (dy * ow + dx) * 3;
            px[d..d + 3].copy_from_slice(&src.px[s..s + 3]);
        }
    }
    Rgb { w: ow, h: oh, px }
}

pub fn encode_jpeg(img: &Rgb, quality: f32) -> Result<Vec<u8>, Error> {
    guard(|| {
        let mut c = Compress::new(ColorSpace::JCS_RGB);
        c.set_size(img.w, img.h);
        c.set_fastest_defaults();
        c.set_optimize_coding(true);
        c.set_quality(quality);
        let mut s = c.start_compress(Vec::with_capacity(img.w * img.h / 4)).map_err(|e| Error::Bad(e.to_string()))?;
        s.write_scanlines(&img.px).map_err(|e| Error::Bad(e.to_string()))?;
        s.finish().map_err(|e| Error::Bad(e.to_string()))
    })
}

// libjpeg's errors come back as panics (mozjpeg's error manager unwinds):
// caught here, so a bad file is an error
fn guard<T>(f: impl FnOnce() -> Result<T, Error>) -> Result<T, Error> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(p) => Err(Error::Bad(
            p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "decoder error".into()),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A test picture: each corner its own colour, so a turn shows
    fn corners(w: usize, h: usize) -> Rgb {
        let mut px = vec![0u8; w * h * 3];
        for y in 0..h {
            for x in 0..w {
                let c: [u8; 3] = match (x < w / 2, y < h / 2) {
                    (true, true) => [250, 20, 20],   // top left: red
                    (false, true) => [20, 250, 20],  // top right: green
                    (true, false) => [20, 20, 250],  // bottom left: blue
                    (false, false) => [250, 250, 20], // bottom right: yellow
                };
                px[(y * w + x) * 3..][..3].copy_from_slice(&c);
            }
        }
        Rgb { w, h, px }
    }

    fn at(i: &Rgb, x: usize, y: usize) -> [u8; 3] {
        let k = (y * i.w + x) * 3;
        [i.px[k], i.px[k + 1], i.px[k + 2]]
    }

    fn near(a: [u8; 3], b: [u8; 3]) -> bool {
        a.iter().zip(b).all(|(p, q)| (*p as i32 - q as i32).abs() < 40)
    }

    // A JPEG with an Orientation tag spliced in after SOI
    fn with_orientation(jpeg: &[u8], o: u16) -> Vec<u8> {
        let mut tiff = b"MM\0\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01".to_vec();
        tiff.extend(o.to_be_bytes());
        tiff.extend([0, 0, 0, 0, 0, 0]);
        let mut seg = b"Exif\0\0".to_vec();
        seg.extend(tiff);
        let mut out = jpeg[..2].to_vec();
        out.extend([0xFF, 0xE1]);
        out.extend(((seg.len() + 2) as u16).to_be_bytes());
        out.extend(seg);
        out.extend(&jpeg[2..]);
        out
    }

    #[test]
    fn thumbnail_size_and_turns() {
        let src = encode_jpeg(&corners(1600, 1200), 92.0).unwrap();
        // Upright: 320 × 240, red top left
        let t = jpeg_thumbnail_rgb(&src, 320).unwrap();
        assert_eq!((t.w, t.h), (320, 240));
        assert!(near(at(&t, 10, 10), [250, 20, 20]));
        assert!(near(at(&t, 310, 230), [250, 250, 20]));
        // 6 (turned right): 320 wide as shown, 427 tall; blue top left
        let t = jpeg_thumbnail_rgb(&with_orientation(&src, 6), 320).unwrap();
        assert_eq!((t.w, t.h), (320, 427));
        assert!(near(at(&t, 10, 10), [20, 20, 250]), "{:?}", at(&t, 10, 10));
        assert!(near(at(&t, 310, 10), [250, 20, 20]));
        // 8 (turned left): green top left
        let t = jpeg_thumbnail_rgb(&with_orientation(&src, 8), 320).unwrap();
        assert!(near(at(&t, 10, 10), [20, 250, 20]));
        // 3 (upside down): yellow top left
        let t = jpeg_thumbnail_rgb(&with_orientation(&src, 3), 320).unwrap();
        assert!(near(at(&t, 10, 10), [250, 250, 20]));
        // And it encodes
        let j = jpeg_thumbnail(&src, 320, 80.0).unwrap();
        assert_eq!(&j[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn orientations_all_map_corners() {
        let src = corners(4, 2);
        let expect_tl = [[250, 20, 20], [20, 250, 20], [250, 250, 20], [20, 20, 250], [250, 20, 20], [20, 20, 250], [250, 250, 20], [20, 250, 20]];
        for o in 1..=8u16 {
            let r = orient(Rgb { w: src.w, h: src.h, px: src.px.clone() }, o);
            assert_eq!((r.w, r.h), if o >= 5 { (2, 4) } else { (4, 2) });
            assert_eq!(at(&r, 0, 0), expect_tl[o as usize - 1], "orientation {o}");
        }
    }

    #[test]
    fn bad_files_are_errors_not_crashes() {
        assert!(jpeg_thumbnail(b"not a jpeg at all", 320, 80.0).is_err());
        let src = encode_jpeg(&corners(800, 600), 90.0).unwrap();
        assert!(jpeg_thumbnail(&src[..200], 320, 80.0).is_err());
        // Cut short after the header: a picture, or an error, never a crash
        let _ = jpeg_thumbnail(&src[..src.len() / 2], 320, 80.0);
    }
}
