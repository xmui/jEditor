// The EXIF orientation of a JPEG (1–8; 1 when there's none), read from its
// APP1 Exif block without decoding anything. The same tag the page's
// createImageBitmap applies (imageOrientation 'from-image').

pub fn orientation(jpeg: &[u8]) -> u16 {
    find(jpeg).unwrap_or(1)
}

fn find(b: &[u8]) -> Option<u16> {
    if b.len() < 4 || b[0] != 0xFF || b[1] != 0xD8 {
        return None;
    }
    let mut i = 2;
    while i + 4 <= b.len() {
        if b[i] != 0xFF {
            return None;
        }
        let marker = b[i + 1];
        // Padding, and markers with no length
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if marker == 0xD8 || (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            i += 2;
            continue;
        }
        // Start of scan or end of image: no EXIF before the picture
        if marker == 0xDA || marker == 0xD9 {
            return None;
        }
        let len = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        if len < 2 || i + 2 + len > b.len() {
            return None;
        }
        let seg = &b[i + 4..i + 2 + len];
        if marker == 0xE1 && seg.len() > 14 && &seg[..6] == b"Exif\0\0" {
            if let Some(o) = tiff_orientation(&seg[6..]) {
                return Some(o);
            }
        }
        i += 2 + len;
    }
    None
}

fn tiff_orientation(t: &[u8]) -> Option<u16> {
    let le = match t.get(..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |o: usize| -> Option<u16> {
        let s = t.get(o..o + 2)?;
        Some(if le { u16::from_le_bytes([s[0], s[1]]) } else { u16::from_be_bytes([s[0], s[1]]) })
    };
    let u32_at = |o: usize| -> Option<u32> {
        let s = t.get(o..o + 4)?;
        let a = [s[0], s[1], s[2], s[3]];
        Some(if le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) })
    };
    if u16_at(2)? != 42 {
        return None;
    }
    let ifd = u32_at(4)? as usize;
    let n = u16_at(ifd)? as usize;
    for k in 0..n.min(512) {
        let e = ifd + 2 + k * 12;
        if u16_at(e)? == 0x0112 {
            let v = u16_at(e + 8)?;
            return if (1..=8).contains(&v) { Some(v) } else { None };
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg_with(o: u16, le: bool) -> Vec<u8> {
        let mut tiff = Vec::new();
        let w16 = |v: &mut Vec<u8>, x: u16| v.extend(if le { x.to_le_bytes() } else { x.to_be_bytes() });
        let w32 = |v: &mut Vec<u8>, x: u32| v.extend(if le { x.to_le_bytes() } else { x.to_be_bytes() });
        tiff.extend(if le { b"II" } else { b"MM" });
        w16(&mut tiff, 42);
        w32(&mut tiff, 8);
        w16(&mut tiff, 2);
        // An unrelated tag first, then Orientation
        w16(&mut tiff, 0x010F); w16(&mut tiff, 2); w32(&mut tiff, 4); w32(&mut tiff, 0);
        w16(&mut tiff, 0x0112); w16(&mut tiff, 3); w32(&mut tiff, 1); w16(&mut tiff, o); w16(&mut tiff, 0);
        w32(&mut tiff, 0);
        let mut seg = b"Exif\0\0".to_vec();
        seg.extend(tiff);
        let mut j = vec![0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xE1];
        j.extend(((seg.len() + 2) as u16).to_be_bytes());
        j.extend(seg);
        j.extend([0xFF, 0xDA, 0, 2, 0xFF, 0xD9]);
        j
    }

    #[test]
    fn reads_both_byte_orders() {
        for o in 1..=8 {
            assert_eq!(orientation(&jpeg_with(o, true)), o);
            assert_eq!(orientation(&jpeg_with(o, false)), o);
        }
    }

    #[test]
    fn none_or_junk_is_upright() {
        assert_eq!(orientation(&[0xFF, 0xD8, 0xFF, 0xDA, 0, 2]), 1);
        assert_eq!(orientation(b"not a jpeg"), 1);
        let mut j = jpeg_with(6, true);
        j.truncate(20);
        assert_eq!(orientation(&j), 1);
    }
}
