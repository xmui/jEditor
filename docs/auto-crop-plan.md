# Auto crop: a rewrite, measured on real scans

Status: step 1 done in 1.33.0 (2026-10-15). Step 2's runner is `scripts/auto-crop-test.js` ([how to run it](auto-crop-test-set.md#the-runner)); the first test set's baseline is below.

## Why it leaves small edges

- **Edges are found on a copy about 1000 px across**, about a third of a 600 dpi scan. Each edge can be off by a few full-size pixels, and the soft step from bed to print sits inside that error.
- **The safety margin is fixed and tiny.** `fitToPrint` insets about 7 px at 600 dpi (0.3 mm), whatever the edge looks like.
- **Shadows and dark print edges aren't modelled.** A lid shadow, or a print's own dark edge (the line beside the left strip on `img_2517.jpg`), is where the crop stops.
- **One rectangle is forced on all four sides.** A print slightly out of square, or fed in a hair skewed, shows a sliver on one side.
- **Four finders with their own rules:** `PhotoFind.single`, `CropAuto.detect`, `detectFeeder` and `detectStrips`. Behaviour varies from scan to scan, and each fix so far patched one of them.

## What others do

- **VueScan** uses an ML model trained on thousands of cropped photos, and lets you adjust the boxes. ([VueScan 9.8.06](https://hamrick.com/blog/vuescan-9-8-06-autocrop-photos.html))
- **Photoshop's Crop and Straighten Photos** is known for leaving the same thin white edges, and for failing on marks or shadows on the bed. ([Photoshop Gurus](https://www.photoshopgurus.com/forum/threads/cropping-problem.63728), [Adobe community](https://community.adobe.com/questions-712/i-m-having-issue-with-the-automate-crop-and-straighten-tool-in-ps-2022-1130985))
- **Classic and published pipelines** compare against the lid's colour, then fit a rotated rectangle ([US7623734](https://patents.google.com/patent/US7623734B2/en), [OpenCV](https://ccoderun.ca/programming/doxygen/opencv/tutorial_js_contour_features.html)). HP's adds region merging and a separate skew estimate for each object ([TDCommons](https://www.tdcommons.org/dpubs_series/8778)).
- **ML corner finders** work on downscaled images, so their corners land 5–10 px off at full size. ([DocAligner](https://pypi.org/project/docaligner-docsaid/))

Finding roughly where each print is, is the easy part. The exact edge needs a pass of its own at full resolution.

## The design: one pipeline, five stages

1. **Coarse: where each print is**, on the small copy, as now, but one finder instead of four. A print's side can be *open*, where the scan cut it off, which replaces the strip special case.
2. **Candidates scored**: on edge support along each side, rectangularity, and **physical size**. The scan's dpi is known, so 3.5×5, 4×6, 5×7 and 8×10 prints have known pixel sizes, which is a strong check against false finds.
3. **Each edge refined at full resolution.** Read a narrow full-size band along each coarse side.
   - Find the edge to a fraction of a pixel at many points along it.
   - Fit each side as its own line, robust to dust and corners (RANSAC, then least squares on the inliers).
   - Classify the edge profile, from bed through shadow, dark print edge and white border to the image. Place the cut past the transition by its measured width, not a fixed number of pixels.
4. **The crop**: the largest upright rectangle inside the four fitted sides, which handles rounded corners and prints out of square. The margin is in mm through the dpi: **Tight / Safe (about 0.5 mm) / Generous**.
5. **Confidence.** Batch Auto crop flags low-confidence photos for review instead of saving them silently.

It runs in a Web Worker, so the window never stalls. An ML finder (onnxruntime-web) comes later, and only if the classical pipeline still misses on the test set.

## How we'll know it's right

- **A test set of 30–50 real lab scans** (FastFoto feeder pages, the Epson flatbed and the Plustek), weighted to the hard ones: white borders, dark photos, cut-off prints, rounded corners.
- **Labels from real use.** Step 1 records where Auto put the crop and where it was saved, and keeps the scan, so every correction becomes a test case.
- **A runner** that scores each scan: bed inside the crop (target 0 px), print lost outside it, and how far each corner is off.
- **A contact sheet**: every crop drawn on its scan, for checking by eye.

## Steps

| Step | What | Gives |
|---|---|---|
| 1 | Correction logging and the test-set format | The data to measure against |
| 2 | Runner and contact sheet, scoring today's Auto | A baseline number |
| 3 | Full-resolution edge pass and the mm margin, on today's coarse finders | Most of the small edges gone, early |
| 4 | One finder with physical-size scoring, replacing the four | Consistent behaviour, fewer misses |
| 5 | Confidence and flagging in batch | Bad crops caught, not saved |
| 6 | ML finder, only if needed | |

Each step ships only if it scores no worse than the one before it on the test set.

## Step 1: what's recorded

See [auto-crop-test-set.md](auto-crop-test-set.md) for the format.

- Every crop saved in the crop editor is logged, with Auto's result if Auto ran on that photo.
- When Auto ran (pressed, or **Every photo**), the scan itself is kept with its label: whether Auto's crop was saved as it was, corrected, or missed.
- It's kept in jEditor's storage on this PC (in a browser, the browser's private storage), up to 1 GB, oldest first out.
- Settings → Auto crop: on or off, how many are kept, **Export…** to a folder (to bring them here), and **Clear**.

Batch Auto crop fixed later in the editor counts too: the crop is mapped back onto the original in `originals/`. **Recover** does that for crops saved before it did ([format](auto-crop-test-set.md#batch-auto-crop)).

## Baseline: the first test set (2026-10-18)

49 FastFoto feeder scans from one order (Lesperance 0118330), 600 dpi, jEditor 1.43.0. The feeder had already cut each scan to its print, so the answer is the whole scan, give or take a millimetre.

| Auto as | right (≤ 1 mm) | close (≤ 3 mm) | wrong | median off |
|---|---|---|---|---|
| feeder (`--as feeder`, Auto crop after a feeder scan) | 11 | 6 | 32 | 10.4 mm |
| the crop editor (`--as editor`) | 34 | 11 | 4 | 0.9 mm |

- **Feeder mode finds a "print" inside a photo that is all print.** A dark band, a log, a window frame or a fireplace is taken for the print's edge, and 20–40% of the photo is cut off. It never leaves bed in (extra ≈ 0%).
- The editor's Auto finds nothing on 44 of them, which leaves the whole photo: right, or within a millimetre or two.
- So a scan that is all print needs to be recognized first: no bed along its edges, or a size that is already a standard print size at its dpi (stage 2's size check). In that case, don't crop.

These came from an Epson FF-680W on its default settings, so the scanner had cropped each photo itself (its own auto-size, over TWAIN), and Auto crop then cropped them again. Two fixes followed:

- **Scanning** no longer runs Auto crop when the scanner cropped each photo itself. The Windows app reports this as `autosized` with the scan.
- **The feeder finder** gives up when there's no backing on either side of the photo. A photo that fills the scan is all print, so its plain rows are part of it.

| Auto as | right | close | wrong | median off |
|---|---|---|---|---|
| feeder, after the feeder fix | 15 | 9 | 25 | 4.2 mm |

The 25 still wrong come from the other finders (`PhotoFind.single`, run less strictly for a feeder scan), which find a "print" inside the photo in the same way. The full-resolution edge pass and the physical-size check (steps 3 and 4) are next for those.

## Epson scanners: Epson's own crop

The FastFoto software doesn't crop photos itself. It asks Epson Scan 2 for its photo crop with two of the driver's own capabilities, and never sets the standard TWAIN ones:

| Capability | ID | FastFoto sets |
|---|---|---|
| `CAP_EP_DESKEWTYPE` | `0x8075` | 1 |
| `ICAP_EP_AUTOSIZETYPE` | `0x8081` | 0, or 1 for a panorama |

Given the standard ones (auto size, border detection, deskew), as jEditor did, the driver uses its document crop, which leaves backing around a photo. Scanning now asks for the photo crop whenever the scanner offers both capabilities, and jEditor doesn't crop those scans again.

Not yet confirmed on the scanner: which `ICAP_EP_AUTOSIZETYPE` value is the normal photo one (the order in FastFoto's code says 0). The scan's Details log shows what the driver said.

## Other scanners: VueScan's approach

For scanners without Epson's crop (the Plustek OpticBook, the Kodak), Auto crop is to be replaced by VueScan's approach, a model trained on cropped photos ([VueScan 9.8.06](https://hamrick.com/blog/vuescan-9-8-06-autocrop-photos.html)), written as jEditor's own code and trained on jEditor's test sets.

How VueScan does it, from VueScan 9.8.59 for Windows (Hamrick's public trial): its manual, its own log on the lab PC, and a look at the compiled program. This describes the method only. None of VueScan's code, settings or trained models goes into jEditor; its licence doesn't allow that, so jEditor builds and trains its own.

### What happens, in order

1. **What's on the glass.** A small classifier looks at the preview and labels it (photo, document and so on). The label picks which crop model runs: one for prints, one for "small items" (receipts, cards). The Crop size setting can override it: Auto Document always uses the small-items model. That's why the lab PC's OpticBook log shows the small-items model on a photo.
2. **The input.** The preview is shrunk to a fixed low resolution, set in dots per inch rather than in pixels, so a print is always the same size to the model whatever the scan dpi. The model gets the raw colour pixels: no levels, no sharpening, no edge filter.
3. **What the model gives back is a map, not boxes.** For each small square of the bed it says how likely that square is to be part of a photo. It doesn't say where the photos are.
4. **Turning the map into prints** is ordinary image processing, not machine learning:
   - the map is cut into yes/no at the halfway mark;
   - each blob that covers enough of the bed has its holes filled, so a dark sky or a black frame inside a print doesn't split it;
   - the outline of each blob is traced;
   - blobs much smaller than the biggest one are dropped as dust, labels or shadows;
   - each remaining outline gets the smallest rotated rectangle that holds it (centre, width, height, angle).
5. **Each box is checked against the real scan.** This step is ordinary code too, and it's where the accuracy comes from. The map is coarse, so its angle and edges are only roughly right. For each box, VueScan:
   - tries a few angles a little either side of the model's angle, in small steps;
   - at each angle, reads the full-detail scan along the box's sides and scores how sharp the bed-to-print edge is;
   - keeps a new angle only if it clearly beats the model's own, otherwise leaves the model's angle;
   - places the sides on the edges it found;
   - treats a side touching the edge of the bed as cut off, not as an edge.
6. **Tidy-up.** Angles are folded into ±45°, swapping width and height, so quarter turns are left to Auto rotation. Tiny angles are treated as straight. Boxes are sorted into reading order.
7. **What the settings do with the boxes:**
   - **Auto skew on:** the photo is straightened by the box's angle.
   - **Auto skew off:** the crop becomes the upright rectangle around the tilted box, so no photo is lost but a little bed shows.
   - **Aspect ratio:** if a box is already close to the chosen ratio, it's reshaped to that ratio with the same area.
   - **Border (%):** grows or trims what's saved.
   - **Buffer (%):** only keeps an inner margin out of the colour statistics.
   - **Multi crop:** every box becomes a frame.

What's still unknown: how its "how sharp is this edge" score is worked out, and how far inside the edge it puts the cut. Neither was traced line by line.

### What jEditor's own version needs

It fits the five stages above: the model replaces stage 1 ("coarse: where each print is"), and VueScan's per-box check against the real scan is our stage 3.

- **Our own small segmentation model**, a "photo or bed" map rather than a box finder.
  - It's trained only on our own previews: the OpticBook, the Kodak, and the Epson flatbed.
  - Labels come from the crops saved with "Keep scans to improve Auto crop", plus the test sets.
  - It runs in the app (onnxruntime-web, in the Web Worker), on a copy shrunk to a fixed dpi rather than a fixed pixel size.
  - Training and the scans stay on the Mac or the T7. The trained model ships in the app; the scans never leave.
- **The map-to-boxes step:** threshold, fill holes, trace outlines, drop small blobs, fit a rotated rectangle. OpenCV.js or a few hundred lines of our own; nothing to train.
- **Refining edges at full resolution.** This is the part VueScan relies on and we planned anyway: a narrow angle search, then an edge fit on each side, an open side where the bed cuts a print off, and our mm margin (Tight / Safe / Generous). VueScan only checks the angle and the edges. Our plan to fit each side as its own line and use the physical-size check goes further.
- **Confidence:** the map gives it for free (how sure the model was over the box, and how well the edges matched). Batch Auto crop uses it to flag photos for review.
- **A first step with no model:** the map-to-boxes and refine steps can run on today's classical mask (bed colour against print), so steps 3–5 can be built and scored on the test set before any training. The model then only has to beat that mask on the hard scans (white borders, dark photos, prints touching).

## Open questions

- Default margin: Safe (lose about 0.5 mm of photo, never bed) or Tight?
- Rounded corners and deckled edges: crop inside the curve, or keep the whole print with a little bed?
