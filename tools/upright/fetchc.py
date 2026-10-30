# Open Images (CC BY 2.0) photos marked upright, squeezed to 128x128 RGB,
# into one uint8 array. The originals aren't kept.
import csv, io, os, random, sys, urllib.request, numpy as np
D = os.environ.get('DATA', '.')  # where the photos go (Jake's: the T7)
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps

S = 128
rows = [r for r in csv.DictReader(open(os.path.join(D, 'train-rot.csv'))) if r['Rotation'] == '0.0']
random.Random(3).shuffle(rows)
rows = rows[:300000]
n = len(rows)
out = np.lib.format.open_memmap(os.path.join(D, 'photos128c.npy'), mode='w+', dtype=np.uint8, shape=(n, S, S, 3))
ok = np.zeros(n, bool)

def get(i):
    url = f"https://open-images-dataset.s3.amazonaws.com/train/{rows[i]['ImageID']}.jpg"
    for _ in range(3):
        try:
            data = urllib.request.urlopen(url, timeout=30).read()
            im = Image.open(io.BytesIO(data))
            im.draft('RGB', (S * 2, S * 2))
            im = im.convert('RGB').resize((S, S), Image.BILINEAR)
            out[i] = np.asarray(im)
            ok[i] = True
            return
        except Exception:
            pass

with ThreadPoolExecutor(48) as ex:
    for k, _ in enumerate(ex.map(get, range(n))):
        if k % 2000 == 0:
            print(k, ok.sum(), flush=True)
out.flush()
np.save(os.path.join(D, 'okc.npy'), ok)
open(os.path.join(D, 'idsc.txt'), 'w').write('\n'.join(r['ImageID'] for r in rows))
print('done', ok.sum(), 'of', n)
