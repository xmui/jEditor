# Turn upright: the network

`app/upright.js` turns photos the right way up with a small network of
jEditor's own, whose numbers are in `app/upright-model.js`. This folder makes
that file. Nothing here ships with the app.

**What it learns from.** About 35,800 photos from [Open Images](https://storage.googleapis.com/openimages/web/index.html)
(the validation set, every photo licensed CC BY 2.0 by its author on Flickr)
that Open Images marks as upright. No photos of anyone's orders, and nothing of
FastFoto's: FastFoto's own networks were studied for the idea only (a small
network on a squeezed copy of the photo), as the clean-room rule says.

**How.** Each photo is squeezed to 128 × 128 (`fetch.py`), then, while it
trains (`train.py`), shown at 96 × 96 turned 0°, 90°, 180° or 270°, and the
network learns which. Before turning, each copy is made to look like a scanned
print: mirrored, cropped a little and tilted a few degrees, faded toward a
warm or cyan cast, sometimes black and white, grain, a vignette, and sometimes
a white border, or an instant photo's border (thicker at the bottom, so it
turns with the photo). 2,000 photos are kept back for checking and 2,000 more
for the final test.

**The network.** Four 3 × 3 convolutions (stride 2: 96 → 6, 24 to 96
channels), a 1 × 1 down to 32 channels, then 1,152 → 128 → 4. About 250,000
numbers, stored as half floats (about 650 KB as base64). In jEditor it looks at
the photo in all four turns and puts the answers together, and only turns a
photo when it's at least `Upright.SURE` sure.

**Making it again.**

```sh
python3 -m venv venv && ./venv/bin/pip install torch numpy pillow
curl -LO https://storage.googleapis.com/openimages/2018_04/validation/validation-images-with-rotation.csv
mv validation-images-with-rotation.csv val-rot.csv
./venv/bin/python fetch.py          # photos128.npy (about 1.7 GB), ok.npy
./venv/bin/python train.py 40       # upright.pt
./venv/bin/python export.py upright.pt ../../app/upright-model.js
```
