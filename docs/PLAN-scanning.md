# Next: jEditor's own scanner settings (from the lab, 1.24.0)

What the lab found:
- FastFoto FF-680W: TWAIN and WIA both scan, but one-sided scans the wrong side.
- OpticBook A300: TWAIN works; no WIA driver exists for it (Plustek only ships TWAIN), so it's not listed there. Nothing to fix.
- Sony A7: tethering works.
- Preview and crop works well.

Decided with the lab (answers to questions):
1. **jEditor's own settings by default, for both scanners.** No driver window. The scanner's own window becomes the fallback, under an "Advanced / compatibility" section, together with the existing older-TWAIN option.
   - Choose the dock's layout from NAPS2 `GetCaps` (`PaperSourceCaps`):
     - flatbed → Preview and crop;
     - feeder only (FastFoto) → a settings form, then Scan.
2. **Sides (feeder):** a Front / Back / Both picker, remembered per scanner.
   - jEditor works out which side is which for the FF-680W, so Front is really the photo: single-sided gave the back on both TWAIN and WIA.
   - Plan: Front = Duplex, keeping the photo side of each pair, or Feeder with a per-scanner "swap" setting. Verify at the lab using Details.
3. **Backs when Both:** `Smith-014-b.jpg` beside `Smith-014.jpg`, the FastFoto app's style.
4. **Rotating boxes in preview and crop:** both.
   - Tilt a box to match a crooked print; it's straightened when cut (rotate in `CroppedPages` before cropping).
   - 90° turns per box to set which way is up.
5. **More settings in the preview window:**
   - brightness and contrast (NAPS2 `Brightness`/`Contrast`, shown on the preview);
   - file type and quality (JPEG with a quality, or lossless TIFF);
   - print-size boxes (wallet, 4×6, 5×7, 8×10…, dropped at exact size using the bed's inches);
   - saved setups (named presets of all of the above).

Where the code is:
- `src/Scanner.cs`: `CroppedPages`, `ScanBed`, `For`, `CapsAsync`.
- `app/scan.js`: modes, `previewGlass`, `scanBoxes`.
- `app/scan-preview.js`: box editor and print finder.
- `test/native.test.js`: the "preview and crop" suite.
- Smoke step: `cropped` in `src/bridge.js` and `src/Smoke.cs`.
