# Using jEditor

jEditor is a photo viewer for rotating, cropping and straightening folders of photos, built for working through scan orders. It edits the files on your disk directly. Nothing is uploaded.

To install it, see the [README](../README.md). The version number is shown on the start screen.

## Using it

1. Click **Open folder**, or drag a folder onto the window. Subfolders are included. The last six folders you opened are listed under **Recent** on the start screen; click one to open it again, or hover and click × to take it off the list. If you open a folder that's inside an order on the Recent list, jEditor offers to open the whole order at that folder instead, so the order keeps a single `.jeditor` folder. (For now this only works for orders on the Recent list; jEditor can't yet tell from a folder alone which order it's in.)
2. Move through photos with `←` / `→`. In single view the buttons above the film strip fade away after a few seconds; move the pointer there to bring them back, or turn off **Buttons above the film strip** in Settings to hide them for good. `Space` switches between single view and grid. In the grid, the slider at the bottom right or `Ctrl` + mouse wheel makes the tiles bigger or smaller; the highlighted photo stays where it is on screen.
3. Rotate with `[` / `]`. In grid view this rotates every selected photo.
4. Press `C` to crop and straighten. `Enter` saves, `Shift+Enter` saves and opens the next photo, `Esc` cancels.
5. `Ctrl+Z` undoes the last rotation, crop, rename or delete.

Changes are saved to the original files as you go.

**Settings** (the gear in the toolbar's **More** section, the link on the start screen, or `Ctrl+,`) has a page for each kind of setting, chosen on the left; it opens on the last one you used.

- **Appearance**: in the Windows, Mac and Linux apps, a **theme** (an experiment for now, on in betas: see [Themes](#themes)); the theme (dark, light or match the system), the accent color and the color behind photos (black, gray or light, for judging color); on Windows 11 (22H2 or later), **Window background** puts Mica or Acrylic behind jEditor, like the Start menu, and **Transparency** sets how much of the desktop shows through (photos, Crop and Duplicates stay solid; it needs Windows' Transparency effects on, in Settings → Personalization → Colors); then glass (Rich, or Subtle, which is faster on older computers), density and toolbar size.
- **Toolbar & keys**: keyboard shortcuts and their profiles, a vertical toolbar, the buttons above the film strip, and which buttons are in the toolbar.
- **Messages**: which messages pop up after you do something.
- **Auto crop**: keeping test scans to improve Auto crop, how many are kept, and exporting, recovering or clearing them.
- **Projects**: watching the folder for changes, the thumbnail cache, stored projects and cleaning up the open one.
- **Updates**: checking for updates, and the log.

## Themes

In the Windows, Mac and Linux apps, **Settings → Appearance → Theme** makes jEditor look like an app of another time: the same jEditor, laid out the way that era's apps were, with its own title bar and a menu bar. It's an experiment for now (Settings → Experimental; betas have it on).

- **Windows XP**, in **Royale**, **Royale Noir** and **Royale Red** (the dots on its card): an Office 2003 program, with command bars, a task pane each side and a menu bar.
- **Snow Leopard**, as **Finder** (light) or **Aperture** (dark): one toolbar with the labels under its buttons, a source list and a foot bar.
- **1984**: the first Macintosh, in one bit. Its **Thumbnails** setting shows the grid dithered to one bit (as MacPaint did), in black and white, or in colour; the photo you open is always in colour.

The menu bar's menus have jEditor's commands, with their keys. The title bar moves the window, a double-click maximises it, and its buttons minimise, maximise and close it (on a Mac they stand in for the traffic lights, and macOS 26's toolbar steps aside for the theme's). Snow Leopard has no menu bar in the window, as a Mac app never did: on a Mac, the menu bar at the top of the screen has jEditor's commands while a theme is on (File, Edit, View, Photos and Help for Snow Leopard; the theme's own menus for the others). In full screen the title bar goes; the menu bar stays. On Linux the window opens again (just as it was) when a theme goes on or off, so the theme's title bar takes the place of the system's. Adjust and Paint are in the toolbar's ⋯ (or More), the Picture menu, and `E` and `B`. Light or dark is the theme's, and so are the accent colour, glass, density and toolbar size: Settings leaves them out while a theme is on. The whole app wears it: the dialogs and Settings, Crop, Adjust and Paint (with their own tool icons), the scan window and every toolbar button. A toolbar with more buttons than fit wraps onto a second row. **jEditor** at the start of the gallery goes back to jEditor's own look.

## Watching the folder

jEditor keeps an eye on the open folder. Photos a scanner saves into the order show up in the grid on their own, in sort order, without moving your place; they glow briefly, and a message offers **Show**, which jumps to them and selects them. Photos deleted, renamed or edited in another program are picked up too. Where the folder can report its own changes, they show up as they happen; on drives that can't report changes, it's checked when you come back to the window and every so often while it's on screen (less often on a slow drive). Turn off **Watch the folder for changes** in Settings to stop this.

`R` rescans by hand. Folders are listed several at a time, which helps most on a network drive, and only new photos are opened, so an unchanged order of 2000 photos rescans in a fraction of a second. Edited photos are then looked for in the background.

## Flags

Mark photos while you work through an order:

- `P` stars a photo (a pick), `X` marks it as needing a rescan, `1`–`5` give it a colour label (red, yellow, green, blue, purple; the same key again takes it off) and `U` clears all three. In the grid they apply to the selection, in single view to the photo shown. They're also at the top of the right-click menu, and `Ctrl+Z` undoes them.
- Flags show on the grid tiles, the film strip and beside the file name.
- The **Flags** section at the bottom of the folder list counts each flag. Click one to show only those photos (click again, or the × on the chip in the folder pill, to show everything). `Ctrl+A` then selects just them, ready for **Move to…**, **Export** (under ⋯ on the selection bar) or **Delete**: moving every "needs rescan" photo into a Rescan folder takes two clicks and `M`.
- Right-click a flag in the list to **Copy list of names** or **Save list as text…**: one path per line, for whoever is on the scanner.

Flags are kept with the order, in `.jeditor/flags.json`, so they follow renames and moves made in jEditor and go with the order to another computer.

## Search

`Ctrl+F` or `/` (or the magnifier in the folder pill) searches the photos by name and folder as you type. Every word must match, in any order: `smith 004` finds `Smith_0042.jpg`, `ceremony` finds everything in the Ceremony folder. `is:star`, `is:rescan`, `is:flagged`, `is:unflagged` and `is:red` (or another colour) match flags. `Enter` goes back to the grid with the results; `Esc` clears the search. The arrow keys, film strip and `Ctrl+A` cover the results only.

## What it does to your files

- **Rotation.** JPEGs are rotated by changing the EXIF orientation tag, so the image data isn't recompressed. This works on scanner files that have no orientation tag yet. PNG and WebP are re-encoded; PNG stays lossless. GIFs aren't rotated, because that would lose the animation.
- **Crop and straighten.** The photo is re-encoded in its original format (JPEG at quality 95). EXIF data (capture date, camera), the ICC colour profile, DPI, XMP and IPTC are carried over. The orientation tag is reset, since the pixels are now upright.
- **Rename.** Files are renamed in place. If the new names overlap the old ones (shifting a numbered sequence, say), they go through temporary names first. If a rename fails part-way, every file gets its original name back.
- **Delete.** Photos are moved to `.jeditor/trash` inside the opened folder, not deleted. `Ctrl+Z` restores them.
- **Move to a folder.** Photos are moved on disk, which is a rename and instant even for big scans; where a file can't be moved it's copied and the original removed. A copy is a byte-for-byte duplicate. Cached thumbnails and previews follow the photo, so moving doesn't make them again.
- **Export.** Copies go to a `jEditor Export` folder (or onto a USB drive, or a folder you choose), optionally resized or in another format, with any adjustments and edits not saved yet.
- **Convert.** Each photo is written again as AVIF, JPEG XL or WebP, upright and in sRGB, with its EXIF (orientation reset, the old thumbnail dropped; the colour profile isn't kept, as the pixels are sRGB now). Replacing puts the original in the Recycle Bin or `.jeditor/trash`; `Ctrl+Z` puts it back under its old name.
- **Adjust.** Never written into the photo in a project: the settings are kept in `.jeditor/edits.json`, and Export (or **Save edits…**) writes the result, re-encoded like a crop, with the metadata carried over. Without a project (photos picked on a phone, or dropped in), they're written into the photo when you leave Adjust.

## The .jeditor folder

jEditor keeps its own data in a `.jeditor` folder inside the folder you open:

- `trash/` holds deleted photos.
- `cache/` holds thumbnails and duplicate-finder data.
- `flags.json` holds the flags (stars, rescan flags, colour labels).
- `edits.json` holds adjustments (light, color, curves) and edits not saved yet.
- `originals/` holds the photos as they were before a batch Auto crop, so it can be undone.

If a subfolder has a `.jeditor` of its own (because it was once opened on its own), opening the whole order merges it into the order's: its deleted photos and Auto crop originals move across, named after the subfolder, its flags join the order's, and its cache is dropped. Then it's removed, so the order keeps one `.jeditor`.

Because the cache travels with the folder, a second computer opening the same order (on a shared drive, say) gets its thumbnails and duplicate data straight away. The large screen-sized previews aren't stored there, to keep the folder small; they're kept in jEditor's own storage on the PC instead.

Rotating doesn't throw the cache away. A rotation only changes the photo's orientation tag, so the cached thumbnail and preview get the same tag instead of being made again from the full scan. Opening the folder again after rotating a batch is as quick as opening it with no changes.

When an order is finished, use **Clean up folder…** (right-click the grid background, or **Clean up** in Settings). It empties the trash and removes the cache, the flags and the Auto crop originals; your photos aren't touched. Do this before copying an order to a customer: on Windows a folder starting with a dot is not hidden, so `.jeditor` would otherwise go along with the photos, deleted ones included. To stop jEditor writing a cache at all, turn off **Save cache in the folder** in Settings. The trash and the flags are still kept there either way.

Folders opened with earlier versions may have a `.jeditor-trash` folder; Clean up removes that too.

Some programs, mostly older print and lab software, ignore the EXIF orientation tag and will show a rotated JPEG the old way round. Cropping writes the rotation into the pixels, so a photo that has been cropped is always upright.

## Crop and straighten

It works like Lightroom or Apple Photos: the crop frame stays in the middle of the screen and the photo moves behind it.

- Drag a corner or edge to resize. When you let go, the view zooms so the crop fills the screen again. Drag a handle past the edge of the screen to zoom out and make the crop bigger. Hold `Shift` to keep the shape, or `Alt` to resize from the centre. On a straightened photo, a side dragged out whose corner meets the photo's slanted edge doesn't stop there: the crop slides out of the way (keeping its size), or when it can't, gets a little shorter, so the side keeps following your pointer to the photo's edge. The opposite side stays where it is.
- Drag inside the frame to move the photo. Drag outside it to rotate.
- Straighten with the slider, or `,` / `.` in 0.1° steps. The photo turns around the middle of the crop and zooms in just enough to hide the corners, so there are never empty corners.
- To level something, hold `Ctrl` (`⌘` on a Mac) and draw a line along a horizon or the edge of a print. The level tool (`L`) does the same without the key.
- **Loupe** (`M`): while you drag a corner or edge, or draw a level line, a close-up of that spot shows in a top corner of the window, at the photo's own pixels, with the crop's edge exactly where it will be saved. It moves to the other corner if your pointer comes near it. It's on to start with; turn it off with the button or `M`.
- **Zoom** for a closer look: scroll on the photo (or pinch on a trackpad) to zoom in and out where the pointer is, or use `+` and `-` and the buttons in the bottom corner. Hold `Space` and drag, or drag with the middle button, to look around. Zoomed in, the view stays put while you drag and straighten; **Fit** (`Z`) goes back to the whole crop, as do a new aspect, a quarter turn, **Auto**, **Previous** and **Reset**. Close-ups use the full-size photo, not the screen-sized copy, once it's loaded.
- **Auto** (`Shift+A`) finds the print on a scan, straightens it and crops to its edges. It needs a plain scanner lid or background around the photo (or, when the scan cut the print off at two opposite sides, down the other two), and it leaves a few pixels' margin so none of the bed shows. Turn on **Every photo** to run Auto on each photo as it opens. With `Shift+Enter` (save and next), a scan order then becomes: check the crop, press `Shift+Enter`, repeat.
- **Turn upright** (`Shift+U`, or Turn upright in the right-click menu) turns the photo, or every photo selected in the grid, the right way up. jEditor's own small network looks at each one (in `upright.js`; how it was trained is in `tools/upright`) and only turns a photo when it's sure, so some are left for you. Each is turned the way the rotate buttons turn them, and one `Ctrl+Z` undoes them all. **Turn upright** in the scan window does it to each photo as it's scanned (on to start with), and turns a photo's back with its front.
- **Batch Auto crop.** In the grid, select photos and press `Shift+A` (or **Auto crop** on the selection bar, or the right-click menu). Auto runs on each of them in the background, with the aspect ratio last chosen in the editor, and saves them. Photos with no print edge, or already cropped to it, are left alone. The originals are kept in `.jeditor/originals`, so one `Ctrl+Z` puts the whole batch back; flip through the results and fix the odd one in the editor.
- `Ctrl+Z` inside the editor undoes the last adjustment; `Ctrl+Shift+Z` redoes it.
- Aspect presets: 4×6, 5×7, 8×10, 11×14, square, 3:4, 16:9, original and free. `X` swaps portrait and landscape. A preset fits inside the current crop, so choosing one after Auto never takes in the bed.
- **Previous** (`P`) applies the last crop again. This is useful when a batch of scans has the same borders.
- The header shows the output size in pixels, and in inches when the file has a DPI.

## Adjust: light, color and curves

Like Lightroom's Develop, for one photo at a time: press `E` (or the sliders button, or right-click → **Adjust…**). The photo changes as you drag, on the graphics card, so even a big scan keeps up.

Under the histogram, three tabs. **Edit** has the sliders, in Lightroom's order: **Basic** (the look, white balance, light, then vibrance and saturation), then Tone curve, Color mixer, Color grading, Detail and Effects, one open at a time. **Retouch** has spot removal and dust; **Masks** has the masks. Clicks on the photo go to spots or masks only while their tab is shown.

- **Histogram and levels.** Red, green and blue, with marks at the ends when something clips. The handles under it set the black, mid-grey and white points; the lower two set the output range. Pick **R**, **G** or **B** to set one channel. **Auto** sets the levels from the photo; **Auto color** sets each channel on its own too, which takes the colour cast off a faded print.
- **Light:** Exposure (in stops), Contrast, Highlights, Shadows, Whites and Blacks.
- **Color:** Temperature, Tint, Vibrance (gentle on colours that are already strong) and Saturation. **Pick grey** (`W`, beside White balance in Basic) sets the white balance from the photo: click something that should be white or grey (a wall, a shirt, the paper's border) and Temperature and Tint take the cast off it. Something very bright or very dark can't tell, so pick a light grey. `Esc` stops picking.
- **Tone curve:** click to add a point and drag it; drag a point off the side, or double-click it, to take it away. The curve never turns back on itself. **RGB** or one channel.
- **Color mixer:** the hue, saturation and luminance of reds, oranges, yellows, greens, aquas, blues, purples and magentas, each on its own.
- **Looks:** film simulations of real stocks, each shown on your photo, by process:
  - **Negative (C-41):** Kodak Portra 160, 400, 800, Ektar 100, Gold 200, UltraMax 400; Fujifilm Superia 400, Pro 400H, C200. Soft contrast and highlights, lifted blacks, colour grain.
  - **Slide (E-6):** Fujichrome Velvia 50, 100, Provia 100F; Kodak Ektachrome E100; Kodachrome 64 (K-14). Deep blacks, high contrast and colour, the finest grain.
  - **Cinema (ECN-2):** Kodak Vision3 50D, 250D, 500T; CineStill 800T and 50D, whose missing rem-jet backing gives the red **halation** round bright lights.
  - **B&W:** Kodak Tri-X 400, T-Max 100, 400; Ilford HP5 Plus, FP4 Plus, Pan F Plus 50, Delta 3200, SFX 200; Fujifilm Acros 100 II. Each turns colour into grey with that film's own sensitivity to red, green and blue (Acros darkens reds and lightens skies; SFX does the opposite), with its contrast and grain.
  - **Creative:** cross process (slide film in negative chemistry), instant, faded print, teal and orange, sepia and selenium toning.

  Click one to put it on, then set its **Amount** (0–200%); **None** takes it off. A look goes over your own settings, so Auto color and the rest still apply under it. **Presets** saves your own settings under a name and puts them on again.
- **Color grading:** a wheel each for shadows, midtones and highlights: drag from the middle towards a colour to tint them (further out is stronger), and the slider under each makes them lighter or darker. **Blending** widens the three into each other, **Balance** moves where shadows end and highlights begin. Double-click a wheel to clear it.
- **Masks:** for part of the photo. **Linear** (drag across the photo: full where you start, none where you stop, so a sky darkens down to the horizon), **Radial** (drag out from the middle of something: full inside, feathered to nothing at the edge; **Invert** for the outside instead) and **Brush** (paint it on; **Erase** paints it off, with **Size**, **Feather** and **Flow**). **Sky** and **Subject** find them in the photo for you: the sky from the smooth, bright or blue ground along the top (and through gaps in trees), the subject from what stands out from the frame's edges and is sharper than the background. They're worked out from colour, brightness and sharpness rather than by an AI model, so they're best on clear cases; paint on them, or **Erase**, to touch them up. Each has its own Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Temperature, Tint, Vibrance and Saturation; up to eight on a photo. Drag a gradient's handles (or inside it) to change it. **Show mask** tints what it covers red. Masks are kept on the photo as it is on disk, so cropping or straightening later doesn't move them off what they're on.
- **Spot removal:** click a speck of dust, a scratch or a blemish to heal it: the spot is sized to the speck, and its source is picked from nearby where the surroundings match best. Drag from a speck instead to choose where it's copied from. **Heal** blends the source's texture into the colour and brightness round the spot; **Clone** copies it exactly. Drag a spot to move it, its dashed source to copy from somewhere else, its edge to resize it; right-click it (or `Delete`) to take it off. **Find dust** puts a heal spot on every speck it finds on a scan (**Sensitivity**: how faint a speck it looks for; check them, and right-click any that aren't dust), and **Clear found** takes those off again. Spots are kept on the photo as it is on disk, so a crop later doesn't move them; copying adjustments to other photos leaves each photo's spots behind.
- **Detail:** **Sharpening** (how much), **Radius** (how fine: 1 for crisp detail, 2–3 for a stronger look) and **Masking** (higher keeps it to edges, off skin and sky); **Noise reduction** smooths grainy or noisy areas while keeping edges, **Color noise** takes out the coloured blotches of a dark or high-ISO scan. These work on the photo's own pixels, so they show at 1:1: the view at the top of the section is the full photo at 1:1, where you click on it (the box on the photo shows where). Export and Save edits apply them at full size.
- **Effects:** a **Vignette** (to the left darkens the corners, to the right lightens them) with its **Midpoint**, **Feather** and **Roundness**, film **Grain** with its size and **Grain color** (colour film's grain is clouds of dye in each colour), and **Halation**, the red glow round bright lights. The vignette is on the photo as cropped.
- Double-click a slider's name to put it back to 0; each section has its own **Reset**.
- `\` shows the photo as it was (before and after). `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo inside Adjust.
- **Copy** and **Paste** (`Ctrl+Shift+C` / `Ctrl+Shift+V`) carry the adjustments to other photos. In the grid, `Ctrl+Shift+V` pastes onto every selected photo; the right-click menu has it too.
- There's no Done button: what you do is kept as you go. Leave with the mode switch, `Esc` or `Enter` (back to Photos), or click another photo in the strip; `Shift+Enter` goes on to the next photo. `Ctrl+Z` in Photos takes a whole visit's adjustments off again.

Adjustments are non-destructive: the photo on disk isn't changed. They're kept with the project (`.jeditor/edits.json`), shown wherever the photo is, and can be changed again any time, from the original. A pencil on the photo says it has them. An adjusted photo keeps its turns and crops the same way, so everything is applied once, from the original. **Export…** writes copies with the adjustments; **Save edits…** (right-click the grid background) writes them into the photos, keeping the originals for `Ctrl+Z`. **Discard edit** takes them off.

## RAW files

RAW files from cameras (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2, PEF, SRW and the rest) are listed with the other photos and shown from the full-size JPEG the camera puts inside each one, turned as the camera was held. They can be flagged, renamed, moved, cropped, adjusted and painted on like any photo, but a RAW file is never written: its turns, crops and adjustments are always kept as edits, and **Export** (or **Save edits**) writes a JPEG copy (`IMG_0042.cr3` → `IMG_0042.jpg`). Editing the raw sensor data itself (rather than its JPEG) comes later.

## Photos, Adjust and Paint

jEditor has three modes, like Lightroom's modules: **Photos** (sorting, rotating, cropping), **Adjust** and **Paint**. With the sidebar open, switch along its top; with it closed, the chip at the top left names the mode you're in and its menu switches (it's there in single view, and over Adjust and Paint too). `E` and `B` still open Adjust and Paint, and `Esc` goes back to Photos.

Adjust and Paint have no Done bar: what you do is kept as you go, as in Lightroom (`Ctrl+Z` in Photos takes it off again). In the Windows, Mac and Linux apps, closing the window in Adjust or Paint with something not kept yet asks **Keep your changes?** first: **Keep**, **Don't keep** or **Cancel** (in a browser, it asks the browser's way). Their few buttons (Before, Reset, Copy, Paste; Undo, Redo, Fit, 100%) are at the top right. A film strip runs along the bottom: click another photo and it opens in the same mode. Their toolbar buttons are in the ⋯ menu.

Drag the inner edge of the sidebar, or of Adjust's or Paint's panel, to make it wider or narrower; jEditor remembers each width, in every theme. Double-click the edge to put it back.

The start page's **Start in** (Photos, Adjust or Paint) is remembered: a project you open from there lands in that mode, on its first photo. **Paint** there (or **New blank canvas…**) asks what to paint on: a **New canvas** (below), or **Open a file**: **An image…** opens a single picture on its own (the painting goes into it when you leave Paint), **A folder…** opens a folder of photos as a project in Paint.

## Paint

Paint over a photo in layers, as a tool like Crop: press `B` (or the brush button, or right-click → **Paint…**).

- **Tools** down the left: **Move** (drag the layer, or what's selected; its corners scale it, the knob above turns it, `Enter` puts it down), **Rectangle** and **Ellipse select**, **Lasso**, **Magic wand** (by colour, with **Tolerance**), **Brush** (Size, Hardness, Opacity, Flow), **Pencil** (hard edges), **Spray**, **Eraser**, **Fill** (by colour, looking at the photo and all the layers or just this one; or **Whole layer**, which fills all of the layer, or all that's selected), **Gradient** (from the foreground colour to the background colour, or to nothing), **Line** (with an arrow if you like), **Rectangle**, **Ellipse** (stroked, filled or both), **Text** (click, type, `Ctrl+Enter`), the **Colour picker** and the **Hand**. Each tool's options are along the top.
- **Brushes:** with the brush, pencil, spray or eraser, the wheel over the photo sizes it (`[` and `]` too; on a Mac's trackpad, `Alt` and two fingers), and while it changes the brush shows on the photo as it'll paint, with its size in pixels (in the middle of the photo when you use the Size slider). `Shift`-click paints a straight line on from where the last stroke ended. A pen's pressure makes the brush smaller as you press lighter. Sizes are the photo's own pixels, kept the same part of the photo from one photo to the next: a brush that's a tenth of the way across a big photo is a tenth of the way across a small one, and the Size slider gives most of its length to the small sizes a small photo needs.
- **Selections** keep painting inside them. `Shift` adds to a selection, `Alt` takes away; `Ctrl+A` selects everything, `Ctrl+D` nothing; `Delete` clears what's selected; `Ctrl+C` / `Ctrl+V` copy and paste it.
- **Colours:** the foreground and background swatches (click to choose), a palette (`Alt`-click for the background colour), **Swap** (`X`) and black and white (`D`). `Alt`-click with a brush picks a colour from the photo.
- **Layers:** add, duplicate, move up and down, merge down, delete, hide, rename (double-click), each with its **Opacity** and a **Blend** mode (Multiply, Screen, Overlay and the rest).
- **Images:** **Bring in an image…** under the layers (`Ctrl+Shift+O`), drop an image file on Paint, or `Ctrl+V` an image copied in another app. It comes in on a layer of its own, named after it, fitted to the picture and left floating: drag it to move it, a corner to size it (`Shift` keeps its shape), the knob to turn it, and `Enter` puts it down. RAW files come in from the JPEG inside them. (`Ctrl+V` pastes Paint's own copy instead when that's the newest thing you copied.)
- **A blank canvas:** right-click a folder (or the grid's background) → **New blank image…**, or the start page's Paint. Pick a size from the list (prints at 300 dpi in inches, screens and social posts, the photo you're looking at, the last one you made) or type one in pixels, inches or centimetres at a resolution (72 to 600 dpi), up to 10,000 pixels a side, either way round; a background (white, black, none or a colour); and the folder to save into (with no project open, you choose one and it opens as the project). It's saved as a PNG carrying its resolution, so it prints at that size, and opens in Paint straight away.
- The wheel zooms (with a brush, `Ctrl`+wheel or a pinch); hold `Space` (or the Hand) and drag to move about; `0` fits the photo, `1` is 100%. `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo inside Paint.

Painting goes on last, over the photo as it's cropped and adjusted, so it looks as you painted it. It's non-destructive like the rest: the layers are kept with the project (in `.jeditor/paint`), so the painting can be opened and changed again, and a crop later leaves it where it was. **Export…** and **Save edits…** write it into copies or the photos. Without a project (photos picked on a phone, or an image opened on its own), leaving Paint paints into the photo.

## Drives, cards and discs

**Export** on the project's card in the sidebar (or right-click a project, or **Export…** under ⋯ on the selection bar) opens one window for taking photos off this computer. Each choice says what goes and whether it fits before anything starts, and drives and discs show up as they're put in:

- **USB drive or card** (Windows, Mac and Linux): the whole project, copied in one step, with how far it's got. Each drive is listed with the room left on it. The project's flags and edits go with it, so when it's opened in jEditor on another computer they're all there. **Eject it when it's done** ejects the drive after.
- **CD or DVD** (Windows): the burner, whether there's a blank disc in it and whether the project fits, the disc's name, and (with edits not saved yet) whether to save them into the photos first, since the disc gets the photos as they are on disk. The disc comes out when it's done.
- **Copies** (everywhere): copies of the selected photos, all of them or the starred ones, full size or smaller (the longest side: 4000, 3000, 2048, 1600, 1080 px or any other), as they are or as JPEG, PNG, TIFF, WebP, AVIF or JPEG XL (**Format**), with edits not saved yet in them, and RAWs as JPEGs. They go into `jEditor Export` in the project, into `jEditor Export` on a USB drive, or into a folder you choose.

In the Windows, Mac and Linux apps:

- **Importing from a camera's card:** when a card with a DCIM folder is plugged in, jEditor offers to import it; or press `Ctrl+I` (in a browser, choose the card's folder). The photos go into the open project, a new project in your projects folder (named for the day and the card), or a folder you choose; into a folder per day if you like; only the ones not imported before; and the card is ejected after if you like. RAW files come too; videos stay on the card.

## Converting photos: format, quality and storage

**Convert…** turns photos, one or many, into another format: **AVIF** (smallest), **JPEG XL** (newest), **WebP** (for the web), **JPEG** (opens anywhere), **PNG** (lossless) or **TIFF** (lossless, for print). Open it from the toolbar's **Convert** button (under ⋯ to start with; Settings can put it on the toolbar; in single view it converts the photo open), **Convert photos…** on the start page, right-clicking a photo, the selected photos, a folder or the project in the sidebar, or ⋯ on the selection bar.

- **Photos:** what's being converted: the project, a folder in it or the selected photos. **Choose a folder…** picks any folder on your computer instead, with the photos in its folders too, without opening it as the project (from the start page, it asks straight away). A folder chosen keeps its originals in the Recycle Bin, or in a `.jeditor/trash` of its own, and **Put the originals back** at the end takes the conversion back.

- **Quality** goes from smaller to better, with a mark at the lowest quality that still looks the same as the original (worked out on one of your photos; *Closest to the original* where only the highest keeps its grain). PNG and TIFF keep every pixel, so they have no quality to choose. Under it, a close-up of that photo at its own pixels, the original beside the result, with their sizes.
- **Storage:** what the photos take **Now** and **After** and by folder, worked out from a sample of them before anything happens, and again as you change the format or quality: what's freed striped green, or (PNG and TIFF, which often take more than a JPEG) how much more striped amber.
- **The originals:** **Replace them** (the converted photo takes the original's place and the original goes to the Recycle Bin, or jEditor's trash; one `Ctrl+Z` puts them all back) or **Keep both** (the converted copies go into `jEditor Converted` in the project, which jEditor doesn't list as the project's photos).

Flags and edits go with each photo, and so do its date taken, camera and the rest of its EXIF (into a TIFF: its camera and dates). RAW files, GIFs and photos already in that format are left as they are, and so, in the lossy formats, are photos that wouldn't get smaller.

While it works, 100 dots stand for the photos, each in their own colours once they're done; done dots turn hollow and green for the storage freed, as many as the share freed so far. Pause or Stop, or close the window and carry on: the corner says how far it's got. At the end: the storage freed, and the size before and after.

AVIF and JPEG XL are written by codecs that come with jEditor (WebAssembly builds of libavif and libjxl), and TIFF by jEditor itself (8 bits, LZW, lossless, which every program that opens TIFF reads; all the photo's EXIF goes in, GPS too). jEditor shows JPEG XL and TIFF photos with its own decoders, where the browser engine can't: TIFFs uncompressed or LZW, Deflate or PackBits, 1 to 16 bits, colour, grey, CMYK or a palette (not JPEG-compressed ones yet). Edits on an AVIF, JPEG XL or TIFF photo are always kept as edits (as on a RAW); **Save edits** writes them in the same format. Not in `standalone.html` opened from disk, which can't load the codecs.

## Folders (collating)

Some orders are collated: the photos go into labelled folders. Open the order folder and switch to the grid (`Space`).

- **The folder list** on the left shows every folder, including folders inside folders and empty ones, with how many photos are directly in each. Click a folder to see just its photos. `Ctrl+B` hides the list; the grid then shows a folder's subfolders as tiles at the start, and the folder pill shows where you are. `Backspace` goes up a folder.
- **All photos** (top of the list, or the switch in the folder pill at the top left) shows every photo in the order, whatever folder it's in, with each photo's folder named on its tile. It's what you see when an order is opened. `A` switches between All photos and the last folder.
- **Moving.** Drag the selected photos onto a folder, in the list, a folder tile or the breadcrumb. Hold `Ctrl` (or `Alt`) when you let go to copy them instead. Or press `M` (`Shift+M` copies), or use **Move to…** on the selection bar or the right-click menu. That opens a list of folders: type to find one, or type a new name to make that folder and move the photos into it in one go. `Wedding/Speeches` makes a folder inside another.
- **Name clashes.** If a photo with the same name is already in the folder, you're asked what to do: keep both (the moved photo gets a number, `IMG_0042 (2).jpg`), skip it, or replace the one that's there, which goes to the trash. You can apply the answer to the rest of the clashes. Cancel and nothing is moved.
- **Folders.** **New folder** at the bottom of the folder list, `Shift+N`, or right-clicking the grid makes one inside the folder you're looking at. Right-click a folder to rename it, make a folder inside it, make a **New blank image…** in it (to paint on), or delete it once it's empty.
- In a folder, `←` `→`, the film strip, `Ctrl+A` and **Rename all…** cover that folder's photos only.
- **Folder details.** The bottom of the folder list shows the total for what you're looking at (`1,240 photos · 4.80 GB`); click it, press `I` in the grid, or right-click a folder for **Folder info**. It lists how many photos there are (directly in the folder and with its subfolders), the total, average and largest size, file types, dates and flags. For the whole order it also shows how much room `.jeditor` takes: trash, cache and Auto crop originals. Select several photos to see the same for the selection.

`Ctrl+Z` undoes a move or copy in one step, together with any photos it replaced and the folder made for it. Making, renaming and deleting folders can be undone too.

## Renaming

Press `F2`, use **Rename…** on the selection bar, or right-click the grid background for **Rename all…**. It works on the selected photos or the whole folder.

- **New names** builds names from a pattern, such as `Smith_{###}` → `Smith_001.jpg`, `Smith_002.jpg`, …
- **Find & replace** changes part of the existing names, such as replacing `IMG_` with `Smith_`.

Patterns can use `{###}` for a sequence number (one digit per `#`), `{name}` for the current name, and `{date}` / `{time}` for when the photo was taken. Numbers follow the order you choose: the current sort, date taken, name, date modified or file size, ascending or descending, from any start number and step.

The preview shows every old and new name before anything changes. Duplicate names, names already used by other files, and characters Windows doesn't allow are flagged, and the rename won't run until they're fixed. The file extension is always kept, and `Ctrl+Z` undoes the whole rename in one step.

## Finding duplicates (work in progress)

Press `D` in a folder. It looks for:

- exact copies (identical file contents), and
- the same print scanned more than once, including when it was turned, placed at a different angle, cropped slightly differently, exposed differently, or scanned in black and white.

Scanner bed and film borders are ignored when comparing. Matches are shown in groups, side by side, with a match percentage. The copy with the most pixels is suggested as the one to keep. `K` marks the others and `Enter` moves them to the trash.

It can still miss some re-scans or group photos that look alike, so check each group before trashing. The **Sensitivity** setting trades one for the other.

## If it gets slow

Turn on **Debug console** in Settings → Toolbar & keys (it's off to start with), then press `Ctrl+Shift+D` to open it. The yellow lines at the top show what the app is holding and doing: memory, undo history, images decoded, background work, and how long recent photos took to load. A screenshot of it taken while things are slow is the most useful thing to include in a bug report.

It's built and tested for orders of 500–2000 photos. With 2000 scans at 1800×1200: the folder opens and shows the first photo in under half a second, thumbnails take about 20 seconds in the background the first time (under 2 seconds when it's opened again, rotated or not), rotating all 2000 takes about 8 seconds, renaming them about 2 seconds, and a duplicate scan about 20 seconds. Bigger files take longer to thumbnail, though big JPEGs are decoded at a fraction of their size for thumbnails and previews (about 4× faster than a full decode on 20-megapixel scans).

Undo keeps up to 50 steps. Rotating a selection in the grid is one step, however many photos it covers. Rotations are undone by rotating back, so they don't use memory. Crops keep a copy of the original file so they can be undone, up to 256 MB in total; older crop steps are dropped after that.

## Keyboard shortcuts

Press `?` in the app to see all of them. Any shortcut can be changed there. The defaults:

| Key | Action |
|---|---|
| `←` `→` | Previous / next photo (`↑` `↓` move by rows in the grid) |
| `[` `]` or `,` `.` or `Shift+←` `Shift+→` | Rotate left / right |
| `\` | Rotate 180° |
| `Space`, `G`, `S` | Toggle view, grid view, single view |
| `C` | Crop and straighten |
| `E` | Adjust: light, color, curves |
| `B` | Paint: brushes, shapes, text and layers |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy the photo's adjustments / paste them (onto the selection in grid view) |
| `Ctrl+C` / `Ctrl+V` | Copy the photo as it looks (crop, adjustments and paint), to paste into another app / paste a picture from another app: saved as `Pasted.png` in the folder you're in and opened in Paint (with no project open, you choose where it's saved) |
| `+` `-` `0` | Zoom in, zoom out, fit. The mouse wheel zooms on the pointer, up to 3200% (past 100% the pixels show as sharp squares, with no smoothing). Double-click the photo: in to 100% on that spot, again to fit. On a Mac's trackpad, pinch to zoom and move a zoomed photo with two fingers. |
| `I` | Info: the photo in single view; in the grid, the folder you're in (photos, total size, types, dates, flags, room taken by `.jeditor`), or the selection |
| `F` | Full screen |
| `F2` | Rename (the selected photos in grid view) |
| `M` / `Shift+M` | Move / copy to a folder (the selection in grid view) |
| `P` / `X` | Star / needs rescan on or off |
| `1`–`5` | Red, yellow, green, blue, purple label |
| `U` | Clear flags |
| `Shift+A` | Auto crop (the selection in grid view) |
| `Shift+U` | Turn upright (the selection, or the photo) |
| `Ctrl+F`, `/` | Search |
| `Shift+N` | New folder |
| `A` | Switch between All photos and folders (grid view) |
| `Backspace` | Up a folder (grid view) |
| `Ctrl+B` | Show or hide the folder list (grid view) |
| `Delete` | Move to trash |
| `Ctrl+Z` | Undo |
| `Ctrl+A` | Select all (grid view) |
| `D` | Find duplicates |
| `Ctrl+I` | Import from a camera or card |
| `R` | Rescan the folder |
| `?` | Show shortcuts |
| `Ctrl+,` | Settings |

In crop and straighten: `Enter` save, `Shift+Enter` save and next, `Esc` cancel, `Shift+A` auto, `[` `]` rotate 90°, `\` rotate 180°, `,` `.` straighten ±0.1°, `<` `>` ±1°, `0` reset the angle, `L` level tool, `M` loupe, `+` `-` zoom, `Z` fit, `A` next aspect ratio, `X` swap orientation, `P` previous crop, `R` reset, `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo.

In Adjust: `Enter` done, `Shift+Enter` done and next, `Esc` cancel, `\` before and after, `Shift+A` auto, `Shift+C` auto color, `W` pick grey (white balance), `R` reset, `Ctrl+Shift+C` / `Ctrl+Shift+V` copy / paste the adjustments, `Ctrl+C` / `Ctrl+V` copy the photo as it looks / paste a picture from another app, `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo.

In Paint: `Enter` done (or put down what's being moved), `Esc` cancel, `V` move, `M` rectangle / ellipse select, `L` lasso, `W` magic wand, `B` brush, `N` pencil, `E` eraser, `G` fill / gradient, `U` line, `R` rectangle, `O` ellipse, `T` text, `I` colour picker, `H` hand, `[` `]` brush size (or a line's, or the text's), `Shift`-click a straight line from the last stroke, `X` swap colours, `D` black and white, `Ctrl+A` / `Ctrl+D` select all / nothing, `Delete` clear the selection, `Ctrl+C` / `Ctrl+V` copy / paste (an image copied in another app comes in as a layer), `Ctrl+Shift+O` bring in an image, `Ctrl+Shift+N` new layer, `Ctrl+J` duplicate the layer, `Ctrl+E` merge down, `0` fit, `1` 100%, `+` `-` zoom, `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo.

In find duplicates: `1`–`9` mark or unmark a photo, `K` keep the suggested photo and mark the rest, `Enter` trash marked and go to the next group, `N` not duplicates, `←` `→` previous / next group, `Esc` close.

## Where things are in the code

The UI is plain JavaScript with no dependencies, in `app/`:

- `script.js`: viewer, grid, rotation, file operations, shortcuts
- `crop.js`: crop and straighten
- `develop.js`, `adjust.js`, `adjust-masks.js`, `adjust-spots.js`: Adjust (the maths, the panel, masks, spot removal)
- `retouch.js`: spot and dust removal, done on the photo before it's cropped
- `select.js`: finding the sky and the subject (masks)
- `raw.js`: RAW files, from the JPEG inside them
- `paint.js`, `paint-editor.js`: Paint (the layers kept with the photo, and the screen)
- `import.js`: importing from a camera's card
- `blank.js`: Paint's start: a new canvas (right-click a folder, or the start page's Paint), or an image or folder to open
- `themes.js`, `themes/`: the themes (Settings → Appearance): the list, their stylesheets, the title bar and menu bar they draw, 1984's dithered thumbnails
- `modes.js`: Photos, Adjust and Paint as modes: the switch (sidebar, chip), the strip in Adjust and Paint, Start in
- `disc.js`: burning a CD or DVD (the Windows app's `src/Burn.cs`)
- `export.js`: the Export window (a USB drive, a disc, or copies)
- `convert.js`: Convert (photos to AVIF, JPEG XL or WebP: the quality and close-up, the storage now and after, the dots)
- `codec.js`, `codec-worker.js`, `codecs/`, `tiff-codec.js`: writing AVIF, JPEG XL, WebP, JPEG, PNG and TIFF, and reading JPEG XL and TIFF, in workers (libavif and libjxl as WebAssembly; TIFF jEditor's own)
- `crop-auto.js`: finding the print on a scan (Auto)
- `crop-boxes.js`: Auto's map-to-boxes finder and full-detail edge fit (being scored; `CropAuto.find(..., { boxes: true })`)
- `changelog.js`: the list of changes shown in What's new, and the release notes
- `meta.js`: reading and copying JPEG/PNG metadata, and EXIF in WebP, AVIF and JPEG XL
- `dupes.js`: duplicate finder
- `rename.js`: batch rename
- `folders.js`: folders: the folder list, moving and copying photos, making, renaming and deleting folders
- `flags.js`: flags (star, rescan, colour labels) and search
- `watch.js`: watching the folder for changes, and rescanning
- `recents.js`: recent orders on the start screen, and spotting a folder that's part of one
- `ui.js`: the app's own alert / confirm / prompt dialogs, and focus handling for every dialog
- `tokens.css`: the design tokens (colours, type, spacing, radii, shadows, motion, layers) and the theme, density, glass, surround and window background switches; `style.css` builds every component from them

Building, testing and releasing are in the [README](../README.md).
