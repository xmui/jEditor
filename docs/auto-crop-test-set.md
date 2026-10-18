# Auto crop test set: format

Made by `app/crop-log.js` ([plan](auto-crop-plan.md), step 1). Settings → Auto crop → **Export…** copies it into a folder named `jEditor Auto crop tests <date>`. That folder is the test set the runner (step 2) reads.

## Files

```
<time>-<name>.jpg        the scan, its bytes as they were before the crop was saved
<time>-<name>.jpg.json   its label (below)
log.jsonl                one line per crop saved in the editor, the same object;
                         lines for photos Auto wasn't used on have no scan
```

`<time>` is when the crop was saved (UTC, `20261015T174512`). Names sort oldest first.

## Label

```jsonc
{
  "v": 1,
  "at": "2026-10-15T17:45:12.345Z",
  "version": "1.33.0",            // jEditor's version: which Auto made the "auto" part
  "project": "Lesprance 0116342",
  "file": "img_2517.jpg",         // within the project
  "scan": "20261015T174512-img_2517.jpg",
  "W": 3203, "H": 1986,           // the photo as shown (EXIF orientation applied)
  "dpi": 600,                     // from the file; null when it has none (1.43.0 and earlier: { "x": 600, "y": 600 })
  "result": "corrected",          // see below
  "diff": 23.4,                   // Auto's crop to the saved one: farthest corner, px
  "batch": true,                  // Auto's crop was batch Auto crop's (below); absent otherwise
  "recovered": true,              // made later by Recover (below); absent otherwise
  "auto": {                       // null: Auto wasn't used on this photo
    "found": true,                // false: Auto found no print
    "finder": "strips",           // which finder: photo, strips, feeder, flatbed
    "tilt": -0.24,                // degrees, clockwise
    "sides": 2,                   // sides found against the bed (the rest at the scan's edge)
    "corners": [[61, 0], [1545, 0], [1543, 993], [72, 993]],  // the print, as Auto found it
    "crop": [[..], [..], [..], [..]]                          // the crop Auto made from it
  },
  "saved": {
    "none": false,                // true: saved as the whole photo (no crop)
    "crop": [[..], [..], [..], [..]],  // the crop saved
    "angle": 0.24,                // straightening, degrees (the editor's sign)
    "q": 0,                       // quarter turns
    "w": 3051, "h": 1980,         // the saved photo's size
    "aspect": "free"              // aspect preset in use
  }
}
```

All corners are in the photo's pixels as shown (EXIF orientation applied), top-left first, then clockwise. `crop` corners are the saved rectangle's corners mapped back onto the unrotated photo, so a straightened crop is a tilted quadrilateral here.

## Result

| result | Auto | saved | as a test |
|---|---|---|---|
| `accepted` | found a print | its crop, within 0.25 mm (min 3 px) | Auto's crop was right |
| `corrected` | found a print | a different crop | the saved crop is the answer |
| `missed` | found nothing | a crop | the saved crop is the answer |
| `unwanted` | found a print | the whole photo | there's nothing to crop |
| `manual` | not used | a crop | log line only, no scan |

The saved crop is what the person wanted, not the print's exact edge. It includes any margin they chose, and an aspect preset if one was on. The runner scores against it: bed left inside, print lost outside, and how far each corner is from the saved one.

## Batch Auto crop

Batch Auto crop saves with no one checking, so a photo counts once it's opened in the crop editor and saved, changed or not.

- **Save edits when done** on: Auto's crop is kept with the photo's edit, and the photo on disk is still the scan. Saving it in the editor gives a label like any other.
- Otherwise the photo on disk is already cropped, and the scan is its original in the project's `originals/`. The saved crop is mapped back onto that scan, `W`/`H` are the scan's, and `saved.angle` adds the batch's straightening. Batch Auto crop's crop is found again by running Auto on the original, the way the batch did. The newest original of that name whose Auto crop matches the photo's size is used. If none matches, it stays a log line.

**Recover** (Settings → Auto crop) does the same for crops saved before this was done. It applies to log lines with no scan in the open project. The scan comes from `originals/`, or, when the photo's edit is still waiting, from the project itself. Auto is run again on it now, and the line in `log.jsonl` is replaced by the full label with `"recovered": true`. Lines it can't match to a scan stay as they are.

In 1.43.0 and earlier, a scan with a dpi was never `accepted`: its dpi was kept as `{ x, y }`, which broke the 0.25 mm tolerance, and `diff` compared corners in order, so a crop turned a quarter looked thousands of pixels off. The runner recomputes both from the corners, so it isn't affected.

## The runner

```
node scripts/auto-crop-test.js "<test set folder>" [--as editor|scan|feeder] [--out <folder>] [--edge <px>]
```

It runs today's Auto on every scan in a headless Chromium, the way the app does: on the screen-sized preview (`--edge`, 1600 by default), then cropped with the crop editor's own geometry, with the aspect ratio set to free.

- `--as` picks which Auto: `editor` (the default) is the crop editor's, `scan` is Auto crop after a flatbed scan, and `feeder` is Auto crop after a sheet-feeder scan.
- Each photo is one test: when a photo was saved twice, its last crop is the answer.
- If Auto finds no print, the whole photo is the crop it's scored on.

It scores each scan against the saved crop, in mm at the scan's dpi:

- **off**: the farthest corner of either crop from the nearest corner of the other.
- **extra**: how much of Auto's crop is outside the saved one (bed or border left in).
- **lost**: how much of the saved crop is outside Auto's (photo cut off).

A scan is **right** when off ≤ 1 mm, **close** when it's ≤ 3 mm, and **wrong** otherwise.

It writes `results.json` and `index.html` to `--out` (the test set's `report/` unless given). `index.html` is a contact sheet: every scan, worst first, with the saved crop in green and Auto's crop dashed in red. The scans are customers' photos, so keep the test set and its report out of this repo.
