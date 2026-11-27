# Makes the folder test/grid-speed.perf.js times: camera-sized JPEGs,
# iPhone-sized HEICs and DNGs (a 4000 x 3000 preview inside, as cameras
# put there), a few of each made, the rest hard links to them under their
# own names (each is read and made a thumbnail of on its own, but the disk
# holds only the few).
#
#   python3 test/grid-speed-photos.py <folder> <jpegs> <heics> <dngs> [<library> <album photos>]
#
# Needs Pillow and numpy, and heif-enc (or pillow-heif: HEICs with no
# thumbnail inside).

import io, os, struct, sys
import numpy as np
from PIL import Image

out, n_jpg, n_heic, n_dng = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
lib = sys.argv[5] if len(sys.argv) > 5 else None
n_lib = int(sys.argv[6]) if len(sys.argv) > 6 else 0
os.makedirs(out, exist_ok=True)
seeds = out.rstrip('/') + '-seeds'
os.makedirs(seeds, exist_ok=True)
rng = np.random.default_rng(1)

def photo(w, h, k):
    # A gradient with grain, so it compresses like a photo
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    r = (80 + 120 * x + 40 * np.sin(y * 6 + k)) + rng.normal(0, 9, (h, w))
    g = (60 + 100 * y + 50 * np.cos(x * 5 + k)) + rng.normal(0, 9, (h, w))
    b = (90 + 80 * (1 - x) * y + 30 * k % 60) + rng.normal(0, 9, (h, w))
    return Image.fromarray(np.clip(np.stack([r, g, b], -1), 0, 255).astype(np.uint8))

def jpeg_bytes(im, q=88):
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=q)
    return b.getvalue()

def dng(preview):
    # IFD0 (a small thumbnail strip), a SubIFD of raw data (lossless JPEG,
    # not showable) and one with the preview, as test/edit.test.js makes
    thumb = jpeg_bytes(Image.new('RGB', (160, 120), (60, 60, 60)))
    raw = bytearray(64000)
    raw[0:15] = bytes([0xFF, 0xD8, 0xFF, 0xC3, 0x00, 0x0B, 8, 0, 10, 0, 10, 1, 1, 0x11, 0])
    def ifd(entries):
        b = struct.pack('<H', len(entries))
        for tag, typ, count, val in entries:
            b += struct.pack('<HHI', tag, typ, count) + (struct.pack('<HH', val, 0) if typ == 3 and count == 1 else struct.pack('<I', val))
        return b + struct.pack('<I', 0)
    ifd0_len, sub_len = 2 + 5 * 12 + 4, 2 + 4 * 12 + 4
    sa_at = 8 + ifd0_len
    sb_at = sa_at + sub_len
    subs_at = sb_at + sub_len
    thumb_at = subs_at + 8
    raw_at = thumb_at + len(thumb)
    prev_at = raw_at + len(raw)
    return (b'II*\x00' + struct.pack('<I', 8)
            + ifd([(0x00FE, 4, 1, 1), (0x0103, 3, 1, 7), (0x0111, 4, 1, thumb_at), (0x0112, 3, 1, 1), (0x014A, 4, 2, subs_at)])
            + ifd([(0x00FE, 4, 1, 0), (0x0103, 3, 1, 7), (0x0111, 4, 1, raw_at), (0x0117, 4, 1, len(raw))])
            + ifd([(0x00FE, 4, 1, 1), (0x0103, 3, 1, 7), (0x0111, 4, 1, prev_at), (0x0117, 4, 1, len(preview))])
            + struct.pack('<II', sa_at, sb_at) + thumb + bytes(raw) + preview)

def seed(name, make):
    p = os.path.join(seeds, name)
    if not os.path.exists(p):
        with open(p, 'wb') as f: f.write(make())
    return p

def links(dir_, prefix, ext, count, seed_paths):
    os.makedirs(dir_, exist_ok=True)
    for i in range(count):
        p = os.path.join(dir_, f'{prefix}_{i + 1:05d}.{ext}')
        if not os.path.exists(p): os.link(seed_paths[i % len(seed_paths)], p)

jpgs = [seed(f'j{k}.jpg', lambda k=k: jpeg_bytes(photo(4000, 3000, k))) for k in range(12)]
links(out, 'IMG', 'jpg', n_jpg, jpgs)
if n_heic:
    # With a 320 x 240 thumbnail inside, as an iPhone writes them: heif-enc
    # (libheif-examples, libheif-plugin-x265) where it's installed
    import shutil, subprocess, tempfile
    def heic(k):
        im = photo(4032, 3024, k + 20)
        if shutil.which('heif-enc'):
            with tempfile.TemporaryDirectory() as t:
                im.save(os.path.join(t, 'a.png'))
                subprocess.run(['heif-enc', '-q', '70', '-t', '320', '-o', os.path.join(t, 'a.heic'), os.path.join(t, 'a.png')], check=True, stdout=subprocess.DEVNULL)
                return open(os.path.join(t, 'a.heic'), 'rb').read()
        import pillow_heif
        pillow_heif.register_heif_opener()
        b = io.BytesIO()
        im.save(b, 'HEIF', quality=70)
        return b.getvalue()
    links(out, 'IPHONE', 'heic', n_heic, [seed(f't{k}.heic', lambda k=k: heic(k)) for k in range(6)])
if n_dng:
    links(out, 'CAMERA', 'dng', n_dng, [seed(f'd{k}.dng', lambda k=k: dng(jpeg_bytes(photo(4000, 3000, k + 40)))) for k in range(6)])
if lib and n_lib:
    links(os.path.join(lib, 'Holiday'), 'LIB', 'jpg', n_lib, jpgs)
print('ok', out)
