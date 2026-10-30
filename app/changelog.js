// What's new, newest first. Shown in the app (What's New) and used as the
// GitHub release notes. Every version bump needs an entry here: the tests
// check that the first entry is the current APP_VERSION.
// Text between `backticks` is shown as a key. beta: only ever a beta, never
// released; the release after it says what it had too (its notes).

const CHANGELOG = [
    {
        version: '1.50.1', date: '2026-10-30', beta: true,
        items: [
            'Crop many photos the same way: select photos, crop one and Save, then Crop the other N the same way. Or select photos and press `Shift+P` (or Crop N like the last crop, right-clicking them) to use the last crop. Each gets the same aspect ratio, frame and straighten, fitted to its size, so a 4 × 6 stays 4 × 6; a portrait photo gets the frame turned to suit it. Each keeps its own quarter turn, and one `Ctrl+Z` puts them all back.'
            'Sync, as in Lightroom (`Ctrl+Shift+S`, Edit → Sync adjustments…, or right-click a selection): select photos, click the one to sync from last, and tick what goes onto the rest: its crop (fitted to each, as Crop like the last crop does), look, white balance, light, levels, curve, color mixer, grading, detail and effects. Masks and spot removal start unticked, since they belong to one photo. Each photo keeps what isn\'t ticked, and one `Ctrl+Z` undoes it on all of them.',
            'Sync and Auto Sync in Adjust: `Ctrl`+click photos in the strip to select them too, then Sync (`Ctrl+Shift+S`, or right-click the strip) puts the open photo\'s settings onto them. Auto Sync (`Ctrl+Alt+Shift+S`) sends each setting you change onto them as well, only that one, while an Auto sync chip at the top says it\'s on.',
        ]
    },
    {
        version: '1.50.0', date: '2026-10-29',
        items: [
            'Themes are part of jEditor now, no longer an experiment, in the Windows, Mac and Linux apps: no need to turn them on in Settings → Experimental. Choose one in Settings → Appearance: Windows XP (Royale, Royale Noir and Royale Red), Snow Leopard (Finder and Aperture) or the 1984 Macintosh, each with its own title bar and menus. The theme you chose is there at the next start.',
            'Themes on the Mac and Linux: the theme\'s own title bar works the window, and on a Mac jEditor\'s commands are in the menu bar at the top of the screen while Snow Leopard is on. In full screen there\'s no title bar. The themes\' menus have Copy image and Paste image too, and their own scroll bars again, sideways ones included.',
            'HEIC and HEIF photos (an iPhone\'s, and Sony\'s .hif) are shown with the rest, upright, everywhere. Crop, adjust and paint them like any photo: like a RAW, the HEIC is never changed, and Export and Save edits write a JPEG copy. Convert takes them too, into any of its formats.',
            'Much faster in huge folders (10,000 photos and more): the grid opens in about a second, scrolls smoothly, and Select all, a search cleared, opening a photo and going back to the grid are instant. After a jump, the thumbnails in the middle of the screen come first.',
            'The grid on the Mac no longer keeps itself busy when nothing is happening, so tiles, thumbnails, scrolling and clicks are all quicker there.',
            'A new look in the sidebar: just a list, with Photos · Adjust · Paint as a pill. The project is its heading (click its name to rename it), and its … has what the card\'s buttons had: Scan, Show in Explorer or Finder, Split, Pin, Rename, Export and Save edits when done.',
            'The selection bar in the grid is quieter: the count, then Move to…, Rename…, … and Delete. Rotate left and right are under its … (and on `[` and `]`).',
            'Animations: tiles bounce when selected, a folder\'s photos ripple in, deleted ones shrink away while the rest slide into place, new photos fly in, and the mode switch\'s highlight glides. Settings → Appearance → Animations turns them off; so does the system\'s Reduce motion.',
            'Glass, in Settings → Appearance: Crystal (the clearest, to start with), Liquid (like Apple\'s Liquid Glass, bending what\'s under its edges), Clear, Opaque (faster on older computers) or Lens, with a tint if you like. The words on the glass are easier to read. The system\'s Reduce transparency or Increase contrast makes it solid.',
            'Adjust\'s panel has three tabs under the histogram: Edit, with the sliders in Lightroom\'s order (Basic first: the looks, white balance, light, vibrance and saturation), Retouch for spots and dust, and Masks.',
            'A button you clicked no longer stays highlighted after you press a key or close a menu with `Esc`.',
            'On the Mac, Photos · Adjust · Paint stays clear of the traffic lights and the toolbar, at any toolbar size and on macOS 26.',
            'Delete on Windows: a photo another program has open for a moment is tried again, instead of Couldn\'t delete.'
        ]
    },
    {
        version: '1.46.1', date: '2026-10-23', beta: true,
        items: [
            'Drag the edge of the sidebar, or of Adjust\'s or Paint\'s panel, to make it wider or narrower: jEditor remembers each width, in its own look and in every theme. Double-click the edge to put it back. In the themes, project and folder names in the sidebar get the room they need instead of being cut short, and show in full when you point at them.',
            '`Ctrl+C` copies the photo as it looks, crop, adjustments and paint included, to paste into another app (in Photos and in Adjust; or Copy image in the right-click menu). `Ctrl+V` with a picture copied in another app makes it a new image in the folder you\'re in and opens it in Paint (or Paste image, right-clicking the grid).',
            'Adjust\'s Pick grey (`W`, at the top of Color) sets the white balance from the photo: click something that should be white or grey, and Temperature and Tint take the cast off it. One `Ctrl+Z` puts it back.',
            'Convert (right-click a photo, the selected photos, a folder or the project; the toolbar\'s Convert; or Convert photos… on the start page): turns photos into AVIF, JPEG XL, WebP, JPEG, PNG or TIFF, in the project or in any folder on your computer (Choose a folder…), without opening it. Choose the quality on a slider marked where the photos still look the same, with a close-up of one of yours, original beside after, and see what it does to their storage before it starts, now and after, by folder. While it works, dots in your photos\' colours turn hollow for the storage freed. The originals go to the bin (one `Ctrl+Z` puts them all back), or keep both; flags, edits, dates and camera details go with each photo.',
            'jEditor shows AVIF, JPEG XL and TIFF photos (TIFF scans are listed with the rest now), and Export can write copies as JPEG, PNG, TIFF, WebP, AVIF or JPEG XL.',
            'Themes reach every part of jEditor, not just the main window: dialogs, Settings, Crop, Adjust, Paint, Duplicates, the scan window, Info and Undo history, each built the way that era\'s apps built theirs. In Windows XP Royale, dialogs are XP windows, Settings is a property sheet with tabs, and Adjust and Paint have Office 2003 command bars and task panes. In Snow Leopard, dialogs are sheets, Settings is a Preferences window, Info and Undo history are HUD panels, and Adjust and Paint have an inspector. In 1984, Paint is MacPaint\'s palette of one-bit tools.',
            'Every toolbar button has its own icon in each theme, including Scan, Camera, Adjust, Paint, Duplicates, Full screen, Settings and What\'s new.',
            'Photos · Adjust · Paint at the top of the sidebar no longer gets cut off in a narrow window or with a wider font: it tightens, then leaves out its icons, so the words fit.',
            'A full toolbar wraps instead of running off the edge, and More opens at least four buttons across.',
            'In Paint, the layer buttons stay inside the panel, and a long hint shortens with … instead of pushing the options off screen.',
            'In Adjust, a section\'s buttons (such as Auto color) move under its name when there isn\'t room beside it.'
        ]
    },
    {
        version: '1.46.0', date: '2026-10-22', beta: true,
        items: [
            'Paint\'s brushes: the wheel over the photo sizes the brush (`[` and `]` too; `Ctrl`+wheel zooms), and as it changes the brush shows on the photo as it\'ll paint, with its size. Sizes follow the photo, so a brush is the same part of a small, low-resolution photo as of a big one, and the Size slider gives most of its length to small sizes. `Shift`-click paints a straight line on from the last stroke, a pen\'s pressure sizes the brush, and a brush too small to see has a cross round it.',
            'Paint\'s fill can fill the whole layer (Fill → Whole layer along the top), or all of what\'s selected, whatever colours are there.',
            'Turn upright (`Shift+U`, or the right-click menu) turns photos the right way up: jEditor\'s own small network looks at each one and turns it only when it\'s sure, and one `Ctrl+Z` undoes them all. The scan window does it to each photo as it comes in (Turn upright, on to start with), turning each back with its front.',
            'New, as an experiment in the Windows app (on in betas): themes, in Settings → Appearance. jEditor as an app of another time, the same jEditor laid out the way that era\'s apps were, with its own title bar and a menu bar: Windows XP in Royale, Royale Noir and Royale Red; Snow Leopard as Finder or Aperture (dark); and 1984, the first Macintosh in one bit, whose Thumbnails setting shows the grid dithered (as MacPaint did), in black and white, or in colour. The menus have jEditor\'s commands with their keys; the title bar moves, maximises and closes the window. jEditor, first in the gallery, is the look you know.'
        ]
    },
    {
        version: '1.45.0', date: '2026-10-22',
        items: [
            'Adjust and Paint are part of jEditor now, no longer experiments: no need to turn them on in Settings → Experimental. Switch modes at the top of the sidebar, or press `E` for Adjust and `B` for Paint.',
            'Export is one window, from the Export button on a project\'s card: copy the project to a USB drive or card (with the room left on it, and Eject when it\'s done), burn it to a CD or DVD, or make copies of the selected photos, all of them or the starred, full size or smaller, into the project, onto a drive or into a folder you choose.',
            'Move to… and Copy to… go to any folder, outside the project too: Other folders on this PC… browses the drives, projects and the usual folders (type a name to make a new folder there), Choose a folder… opens the system\'s own folder window, and the last folders used are listed straight away. `Ctrl+Z` puts them back.',
            'Crop: while you drag a corner or side, a close-up of that spot shows in a corner at the photo\'s own pixels, with the crop\'s edge where it will be saved (the Loupe button, or `M`). The wheel or a pinch zooms the crop view about the pointer, + and - too; Space+drag or the middle button moves it, and `Z` fits it again.',
            'The scanner list has only the scanners plugged in and on (the rest under More), and it updates itself when one is plugged in or taken out. Each scanner offers only what it can do: its own resolutions, grey, both sides and glass sizes only where it has them.',
            'Resolutions in the scan window are never empty: the usual ones show at once while jEditor asks the scanner, and stay if it never answers. Resolutions above the scanner\'s optical one (an Epson\'s 1200 dpi from its 600) are offered under their own heading, Interpolated: more pixels, no more detail.',
            'The scan window can be resized by its edges and corners, and keeps its size; the photos coming in fill it. Show each one as it comes in is a switch in it while it scans.',
            'Auto crop each photo in the scan window is off to start with, so scans that are already right aren\'t cropped again. Turned on, it stays on.',
            'Scanning on an Epson FastFoto is set up exactly as FastFoto\'s own software sets it up, in the same order, with the photos sent as TIFF files, so its crops and colours match FastFoto\'s.',
            'Paint\'s brushes keep up with the pointer on a big photo, without lagging behind.'
        ]
    },
    {
        version: '1.44.1', date: '2026-10-18', beta: true,
        items: [
            'Closing the window in Adjust or Paint with something not kept yet asks Keep your changes? first (Keep, Don\'t keep or Cancel), instead of losing it.',
            'Scanning on an Epson sheet feeder (the FastFoto): each photo is cropped and straightened by Epson\'s own photo crop, the one FastFoto\'s software uses, so less of the scanner\'s backing is left around it.',
            'Scanning on an Epson sheet feeder starts from the scanner\'s own defaults with FastFoto\'s photo tone, so colours come out as they do in FastFoto\'s software, not stronger. Settings chosen in Epson\'s window (Scanner\'s own settings…) are still used when you\'ve chosen them.',
            'The scan window\'s choices are on/off switches, in two groups: Each photo (Auto crop, Show each one as it comes in) and The scanner (it crops each photo itself, and on an Epson feeder FastFoto\'s Curled photo correction and Reduce lines and streaks, both on to start with).',
            'The scan window always opens on screen: a spot it was dragged to in a bigger window is pulled back in, and it fits below that spot, scrolling inside.',
            'Paint starts with the photo as the bottom layer, locked, and a new layer on it ready to paint on.',
            'The debug console (`Ctrl+Shift+D`) is a switch in Settings → Toolbar & keys, off to start with, so the shortcut does nothing until it\'s turned on.'
        ]
    },
    {
        version: '1.44.0', date: '2026-10-18', beta: true,
        items: [
            'Spot removal in Adjust: click a speck of dust, a scratch or a blemish and it\'s healed from nearby, sized to the speck. Drag from it to choose where it\'s copied from; Heal blends it in, Clone copies exactly. Find dust puts a spot on every speck it finds on a scan, and Clear found takes them off again.',
            'Masks find the Sky and the Subject in the photo for you, then paint or erase to touch them up.',
            'RAW files (DNG, CR2, CR3, NEF, ARW, RAF and more) are shown with your photos, from the JPEG inside each one. Crop, adjust and paint them like any photo: the RAW file is never changed, and Export writes a JPEG.',
            'New, as an experiment (Settings → Experimental): Paint (`B`, or the brush button). Paint over a photo in layers with a brush, pencil, spray and eraser; fill, gradients, lines (with arrows), rectangles, ellipses and text; select by rectangle, ellipse, lasso or colour, then move, scale and turn what\'s selected. Layers have opacity and blend modes. Painting is kept with the photo, to change again any time, and stays put when the photo is cropped later.',
            'Copy a project to a USB drive or card in one step (the USB button on the project\'s card in the sidebar): the room is checked first, its flags and edits go with it, and Copy and eject ejects the drive when it\'s done.',
            'A camera\'s card plugged in is offered to import (or `Ctrl+I`): into this project or a new one, in folders by day if you like, only the photos not imported before, and the card ejected after.',
            'In the Windows app, burn a project to a CD or DVD (the disc button on the project\'s card).',
            'Photos, Adjust and Paint are modes now, like Lightroom\'s: switch at the top of the sidebar, or with the chip top left when it\'s closed (in single view, and over Adjust and Paint too). Adjust and Paint have no Done bar any more: what you do is kept as you go, as in Lightroom (Esc goes back to Photos, where Ctrl+Z takes it off again), and a film strip runs along the bottom: choose another photo and it opens in the same mode. The Adjust and Paint buttons moved to the toolbar\'s ⋯ menu.',
            'The start page has Start in: Photos, Adjust or Paint, remembered, so a project opens straight into the mode you want. Paint there asks what to paint on: a new canvas (print sizes in inches at 300 dpi, screens and social posts, or any size in pixels, inches or centimetres) or an image or folder to open.',
            'Paint can bring in images: Bring in an image… under the layers (`Ctrl+Shift+O`), drop an image on it, or paste one copied in another app. Each comes in on a layer of its own, fitted and ready to move, size and turn.',
            'Right-click a folder (or the grid) → New blank image…: any size, from screens and social posts to prints at 300 dpi, on white, black, a colour or nothing, saved as a PNG (with its resolution, so it prints at size) and opened in Paint.',
            'The scanner window is cleaner: its settings in sections, every box the same height and solid behind (nothing showing through or flickering), and after a scan the names carry on from it instead of showing numbers that are already taken.',
            'Crop: dragging a side out on a straightened photo no longer stops when one of its corners meets the photo\'s slanted edge. The crop slides out of the way (or, when it can\'t, gets a little shorter), so the side keeps following you to the photo\'s edge; the opposite side stays put.',
            'A project\'s .jeditor folder opened in the Windows or Mac app now keeps its edits, not only its flags.',
            'Smooth scrolling on the Mac: a mouse\'s wheel glides instead of jumping a notch at a time, everywhere that scrolls. On a trackpad, two fingers move a zoomed photo about (in Paint too) and a pinch zooms it, following your fingers at once; pinching the grid resizes the thumbnails as far as you pinch, and the film strip scrolls with a sideways swipe.'
        ]
    },
    {
        version: '1.43.1', date: '2026-10-18',
        items: [
            'Scanning on a sheet feeder that crops each photo itself (the Epson FastFoto, as it comes) no longer has Auto crop cut into the photos afterwards: the scanner has already cropped them, so Auto crop is skipped.',
            'Auto crop on a feeder scan no longer takes a plain band across a photo (a dark sky, a window frame) for the edge of the print when the photo fills the scan.',
            'Auto crop\'s test scans: one saved with Auto\'s crop is kept as right again (a scan\'s resolution stopped it), and a crop turned a quarter is no longer counted as moved.'
        ]
    },
    {
        version: '1.43.0', date: '2026-10-18',
        items: [
            'Auto crop\'s test scans now include photos cropped by a batch Auto crop (`Shift+A`, or after scanning) and then opened in the crop editor: fixed, they\'re kept as corrected, on the original scan; saved as they were, as right. Before, only photos Auto was used on in the editor counted.',
            'Settings → Auto crop → Recover: crops fixed in the editor after a batch Auto crop before this version become test scans too, for the open project, from the originals jEditor kept for undoing the batch.'
        ]
    },
    {
        version: '1.42.0', date: '2026-10-17',
        items: [
            'New, as an experiment (turn it on in Settings → Experimental): Adjust, Lightroom-style (`E`, or the sliders button): exposure, contrast, highlights, shadows, whites and blacks; temperature, tint, vibrance and saturation; levels on a live histogram, a curve, and a color mixer for the hue, saturation and brightness of each color. The photo changes as you drag, even a big scan. Auto sets the levels from the photo, and Auto color takes the cast off a faded print. `\\` shows before and after.',
            'Film simulations of real stocks, each shown on your photo, with an Amount from 0 to 200%. Colour negative (C-41): Kodak Portra 160, 400 and 800, Ektar 100, Gold 200, UltraMax 400, Fujifilm Superia 400, Pro 400H and C200. Slide (E-6): Fujichrome Velvia 50 and 100, Provia 100F, Kodak Ektachrome E100, and Kodachrome 64. Cinema (ECN-2): Kodak Vision3 50D, 250D and 500T, CineStill 800T and 50D, with the red halation round the lights. Black and white: Kodak Tri-X 400, T-Max 100 and 400, Ilford HP5 Plus, FP4 Plus, Pan F Plus 50, Delta 3200 and SFX 200, Fujifilm Acros 100 II, each seeing red, green and blue as that film does. And Creative: cross process, instant, faded print, teal and orange, sepia and selenium toning. Presets save your own settings under a name.',
            'Color grading with three wheels (shadows, midtones, highlights) and their brightness, Blending and Balance; and Effects: a vignette (darker or lighter, with midpoint, feather and roundness), film grain (with colour, as colour film\'s dye clouds) and halation.',
            'Detail: sharpening (amount, radius, and masking to keep it to the edges), noise reduction that keeps edges, and color noise reduction for blotchy scans. A 1:1 view in the panel shows them on the full photo, where you click.',
            'Masks: change part of the photo. A linear gradient (darken a sky to the horizon), a radial gradient (lift a face, or inverted, darken the edges) or a brush (paint it on, erase it off), each with its own exposure, contrast, tones, white balance, vibrance and saturation, up to eight on a photo. Show mask tints what one covers. Masks stay on their spot when the photo is cropped later.',
            'Adjustments never change the photo: they\'re kept with the project and shown wherever the photo is, so they can be changed again any time. Export writes copies with them, Save edits… writes them into the photos (Ctrl+Z still puts the originals back).',
            'Copy and paste adjustments (`Ctrl+Shift+C`, `Ctrl+Shift+V`) onto one photo or a whole selection in the grid, and Done & next (`Shift+Enter`) to work through a project.',
            'Export with a longest side now resizes the photo with its edits, not the original.',
            'On the Mac, updates install themselves: Settings → Updates downloads the new version, checks it and puts it in place of this one, then jEditor opens again. No more dragging into Applications (jEditor needs to be in Applications for this).',
            'On Linux, Settings → Updates works for the .deb and Arch package too: it installs the new package with your system\'s installer (asking for your password) and reopens jEditor.',
            'On the Mac, a taller title bar: more room at the top of the window to drag it by.'
        ]
    },
    {
        version: '1.41.0', date: '2026-10-17',
        items: [
            'On iPhone, iPad and Android, the web version opens photos: Open photos picks them from Photos, Files or the gallery, edits are kept as you go, and Save… hands them back through the share sheet (Save to Photos, Save to Files, or another app). On Android, Install jEditor keeps it with your apps; on iPhone and iPad, Share → Add to Home Screen.',
            'Beta builds: Settings → Updates → Beta builds gets you new features first, in betas, before they\'re released. Settings → Experimental lists features still being made, each off until you turn it on.',
            'Each jEditor says which it is on its start screen ("Mac · 1.41.0"), and the web version offers the app for your computer: Windows, Mac or Linux.',
            'On the Mac (macOS 26), dragging the toolbar\'s empty space moves the window again, and double-clicking it zooms or minimises as you\'ve set in Desktop & Dock.',
            'On the Mac, the first time jEditor opens, a window lists what macOS asks for (your Desktop, Documents and Downloads, USB drives and cards, and Full Disk Access if you like) and opens the right page of System Settings for each. It\'s in Settings → Projects → Permissions afterwards.',
            'On the Mac and Linux, jEditor starts more reliably: it reads its own files straight from disk.'
        ]
    },
    {
        version: '1.40.0', date: '2026-10-17',
        items: [
            'jEditor for Linux, a first version: jEditor-1.40.0-linux.AppImage runs on any 64-bit Linux (make it executable and open it), jEditor-1.40.0-linux.deb installs it on Debian, Ubuntu and Mint, and jEditor-1.40.0-linux.pacman on Arch Linux (sudo pacman -U). It has what the Mac app has: folders opened without asking, the sidebar with your projects, pinned folders and drives (USB drives and cards, with Eject), several windows and Split, and Show in Files. The AppImage updates itself from Settings → Updates.'
        ]
    },
    {
        version: '1.39.0', date: '2026-10-17',
        items: [
            'On macOS 26, jEditor\'s top row is the Mac\'s own toolbar, in real Liquid Glass, as in Apple\'s apps: the window\'s buttons, the photo\'s name and where it is in the project, the folder list, All photos and Folders, sort, your toolbar buttons, More and a Mac search field. Everything works as before, keys and Settings → Toolbar too. The photo starts below the toolbar, so nothing covers it. Earlier macOS keeps jEditor\'s own glass toolbars.',
            'On the Mac, Homebrew: brew tap xmui/jeditor https://github.com/xmui/jEditor, then brew install --cask xmui/jeditor/jeditor (and brew upgrade for new versions).'
        ]
    },
    {
        version: '1.38.0', date: '2026-10-17',
        items: [
            'On the Mac, Liquid Glass: the toolbars, the folder panel, menus and messages take macOS 26\'s look, with a soft sheen and light along their edges, and stay easy to read over any photo. The photos themselves are never under glass. The title bar is gone: the window\'s buttons sit in the top-left corner, in line with the toolbars, and the top row moves the window.',
            'On the Mac, the sidebar: your projects folder, pinned folders and the drives (Locations), with how many photos each has, New project, Rename (flags and edits go with it), a folder dragged onto a USB drive to copy it, and Eject.',
            'On the Mac, several windows: File → New Window (⇧⌘N), ⌘-click a project to open it in one, Split puts two side by side, and photos dragged from one into the other move (or copy, with ⌥), with ⌘Z to undo.',
            'On the Mac, updates: Settings → Updates finds a new version, downloads it and opens it in Finder, to drag into Applications.',
            'On the Mac, messages say ⌘Z rather than Ctrl+Z.',
            'Settings → Glass has Off, for solid toolbars and panels.',
            'A project left in the single photo view is listed in the other windows\' Move to as well (Windows too).'
        ]
    },
    {
        version: '1.37.0', date: '2026-10-17',
        items: [
            'jEditor for Mac, a first version: download jEditor-1.37.0-mac.dmg from the release and drag it into Applications (Apple silicon and Intel, macOS 12 or later). It opens folders without asking for permission, uses the Mac\'s own folder picker, opens folders from Finder (Open With, or dropped on the Dock icon) and shows them in Finder. It has what the web version has; the sidebar, several windows and updates come next. It isn\'t signed by Apple yet: the first time, open it from System Settings → Privacy & Security → Open Anyway.'
        ]
    },
    {
        version: '1.36.0', date: '2026-10-17',
        items: [
            'jEditor is on the web again, at xmui.github.io/jEditor, and as one file (standalone.html) with every release: open it in Chrome or Edge. It has everything here but what only an app can do: scanning, the camera, the sidebar\'s projects and drives, several windows, the Recycle Bin and updates. Settings, recent folders and flags from the old web version carry over.',
            'Ready for a Mac app: jEditor now asks the app it runs in what it can do, and uses its words (Explorer or Finder, the Recycle Bin or the Trash). Nothing changes on Windows.'
        ]
    },
    {
        version: '1.35.1', date: '2026-10-16',
        items: [
            'jEditor is moving back to its first home on GitHub, xmui/jEditor, where it\'s becoming one app for Windows, Mac and the web. Updates now come from there; nothing changes on this PC, and Settings → Updates finds them as before.',
            'A project in the sidebar\'s list no longer sometimes shows no photo count: when the list was drawn again while counting, the count was known but not shown until the next redraw.'
        ]
    },
    {
        version: '1.35.0', date: '2026-10-16',
        items: [
            'Drag a folder onto a drive (or any folder) in the sidebar to copy it there: a project onto a customer\'s USB stick, say. It says how far it\'s got, with Stop; checks there\'s room first; and a copy that\'s stopped or fails leaves nothing behind. Folders come from the sidebar\'s lists, the open project\'s folder list, or Explorer (photos from Explorer are copied too). jEditor\'s own data stays behind.',
            'Drag a folder onto the rest of the sidebar to pin it.',
            'A USB drive in the sidebar shows how much room it has left, under its name, with a bar of how full it is (red when under a tenth is free).',
            'The New badge on a drive just plugged in sits in its row again, instead of taking a line of its own.',
            'The sidebar never scrolls sideways: long names are cut with an ellipsis.'
        ]
    },
    {
        version: '1.34.1', date: '2026-10-15',
        items: [
            'Rescan (`R`) no longer shows the same photo two or three times. Pressed while a project was still opening (a big one on a network drive takes a while), it found the photos not read yet and added them, and then the opening added them again. R now waits for the opening, which reads every photo anyway, and says so. Pressed several times in a row, the presses make one rescan, and a photo already shown is never added again.'
        ]
    },
    {
        version: '1.34.0', date: '2026-10-15',
        items: [
            'With photos selected on a narrower window, the selection bar moves off center, beside the size slider, before it gives up its labels or the slider goes.',
            'The pills refit as the photo count ("1446 / 1446") or the sort\'s name changes width, not just when the window does.',
            'The project list shows the open project\'s real photo count (1,446) instead of "1,000+": counting stops at 1,000 for the others, but the open one\'s photos are all known.',
            'Crop on a narrower window: Cancel sits with Save & next and Save on the bottom row, the tools above it, instead of Cancel at the start of the tools and Previous and Reset alone on a row.',
            'In the single view on a narrow window, messages go up a row instead of running into the prev / rotate / next pill.',
            'More (the … at the top right) opens its buttons on rows under the usual ones, at the same width, instead of stretching out over the file name; on a narrow window it stays above the folder list.',
            'Deleting (or moving away) the selected photos in the grid selects the next photo, as Lightroom does: the selection bar stays, and Delete goes on from there.',
            'Settings is tidied into pages, chosen on the left (along the top on a narrow window): Appearance (color, window, look), Toolbar & keys (keyboard shortcuts, layout, toolbar buttons), Messages, Projects (watching, cache, storage) and Updates, plus Auto crop (its test scans). It opens on the page you used last, keeps one size as you switch, and the arrow keys move between pages. Keyboard shortcuts moved from the bottom of Settings to Toolbar & keys.',
            'Renaming the open project works like renaming a photo in the top pill: the name on the project card is one button, with a pill behind it and a pencil by it on hover, and a single click renames (no more double-click).',
            'Fewer explainers in the sidebar: the folder-list hint, the projects-folder note and the empty Pinned note are gone (their buttons say it in their tooltips), and Pinned only shows once something is pinned. Undo history drops its how-to line too. Settings keeps its explanations.',
            'An empty grid has a button for the way out: Clear search when nothing matches the search or flag filter, All photos for an empty folder, and Scan or Show in Explorer for a project with no photos yet.'
        ]
    },
    {
        version: '1.33.0', date: '2026-10-15',
        items: [
            'Auto crop test scans, for a better Auto crop: when you save a crop on a photo Auto was used on, jEditor keeps the scan and where you cropped it on this PC (up to 1 GB), with whether Auto\'s crop was kept, corrected, or missed the print. Settings → Auto crop: turn it off, see how many are kept, Export… them to a folder, or Clear… them. Your photos aren\'t touched.'
        ]
    },
    {
        version: '1.32.0', date: '2026-10-15',
        items: [
            'A narrow window (half the screen or less, with or without the folder list) keeps every pill whole and none over another. Each row gives up its least needed parts in turn as the window narrows, measured rather than guessed: at the top, the sort becomes just its icon, then the photo count goes, then (in the grid) the file name; then header buttons move into More, least used first. The file pill moves off center rather than run under the buttons. At the bottom, "not saved yet" goes (the count stays), then the selection bar\'s labels, then the edits bar moves up above the size slider, the slider gets shorter, and last it goes (`Ctrl` + wheel still sizes the grid). Messages move up above the edits bar.',
            'More, opened on a narrow window, wraps onto a second row instead of running off the left edge.',
            'The folder pill switches to its short labels whenever the long ones would be cut off, so its search button no longer disappears.'
        ]
    },
    {
        version: '1.31.1', date: '2026-10-15',
        items: [
            'FastFoto scans no longer come out dark and oversaturated. Epson\'s FastFoto driver sends far more contrast than the FastFoto app saves, with the same stretch on every color, whatever its own settings. A FastFoto now starts at brightness 5, contrast −35 in the scan dock, which matches the app; it\'s said beside the sliders, and changing them is kept as before. This happens once, and only if you hadn\'t set your own brightness or contrast for it.',
            'The scan helper asks a TWAIN feeder for 8 bits a color, and Details says what the scanner sent (bits, and its brightness, contrast and gamma as scanned), for scans whose colors look wrong.'
        ]
    },
    {
        version: '1.31.0', date: '2026-10-15',
        items: [
            'Settings → Window background (Windows 11, version 22H2 or later): Mica or Acrylic behind jEditor, like the Start menu, so the desktop shows softly through the start screen and the grid. Transparency sets how much shows through. Photos, Crop and Duplicates stay solid, so colors are judged as before. Solid, as before, to start with; it follows Windows\' Transparency effects setting.'
        ]
    },
    {
        version: '1.30.3', date: '2026-10-15',
        items: [
            'Deleting a photo on a network or USB drive (no Recycle Bin) no longer pops up "Can\'t open this file … contains system files". The photo goes to jEditor\'s trash on this PC, and moving it there was refused by Windows\' web engine; it\'s now copied there and then removed, as already happened after Cancel. Merging an old subfolder\'s .jeditor into the project\'s data could ask the same, once per file: fixed too.'
        ]
    },
    {
        version: '1.30.2', date: '2026-10-15',
        items: [
            'Auto crop on a scan that cut the print off at two opposite sides now works on real scans: 1.30.1 still said no print edge was found when the strips of bed were thin and grainy, because it looked for the bed all round the scan\'s edge first. It now looks at the two strips themselves: each one color the whole way along and ending at a straight edge, the two matching and parallel.'
        ]
    },
    {
        version: '1.30.1', date: '2026-10-15',
        items: [
            'Auto crop takes the bed off a scan that cut the print off at two opposite sides (a print a hair bigger than the scan area, or a feeder page cut to the photo): the strips of bed down the other two sides come off, and the photo is straightened by them. Before, Auto said no print edge was found.'
        ]
    },
    {
        version: '1.30.0', date: '2026-10-15',
        items: [
            'Scanner\'s own settings… (scan dock → Advanced, for a TWAIN feeder like the FastFoto): opens the scanner\'s own window just to choose its settings, such as Epson\'s color restoration and image enhancements, which jEditor can\'t name. Save there, and jEditor\'s feeder scans use them from then on. Forget goes back to the driver\'s defaults.',
            'Details lists the scanner\'s own settings with their values on each feeder scan, so a change made in its window shows.',
            'Renaming the open project: double-click its name on the project card, or the pencil that shows by the name on hover (as by a photo\'s name). The rename button is gone from the card.',
            'Settings → Messages: choose which messages pop up after you do something (rotating, flags, cropping, moving, deleting, renaming, undo, scanning, photos loaded). Rotation messages are off to start with. Errors and warnings always show.',
            'The edits-not-saved bar moved to the grid\'s bottom row, left of the size slider (above it when the row is full), with its buttons sitting evenly in it; it\'s no longer stacked under the file name, and the single view stays clear.',
            'With Save edits when done on, rotating a photo turns it smoothly again (in the grid and the big view) instead of jumping: the photo on screen turns, and the redrawn one takes its place.'
        ]
    },
    {
        version: '1.29.1', date: '2026-10-15',
        items: [
            'FastFoto colors: scans with the scanner cropping each photo itself asked the Epson driver for nothing about brightness and contrast, so it used whatever Epson Scan 2 last saved, which gave strong, oversaturated contrast. jEditor now asks for neutral brightness and contrast (its own sliders still apply), and Details shows what the driver had.'
        ]
    },
    {
        version: '1.29.0', date: '2026-10-14',
        items: [
            'Scan whole glass: next to Preview in the scan dock, it scans the whole glass as one photo at the resolution chosen, with no preview or boxes (Auto crop each photo still trims it to the print, when on).',
            'The scan and camera docks keep their buttons in sight: the settings scroll behind them, so Scan is never below the fold.',
            'American spelling throughout: color, gray, center, canceled. The scan color choice reads Grayscale.',
            'A project opens in one window only: opening it again (sidebar, Ctrl+click, Open in a new window) brings its window forward, so two windows can\'t write over each other\'s flags and edits.',
            'Scan more and Try again keep the names you typed (Smith-B-006 after Smith-B-005), and Scan or Preview pressed while jEditor is still asking the scanner what it can do waits instead of saying a scan is already running.',
            'Crop saves exactly the crop on screen when you press Save, and the editor waits while it writes. Edits made while Save edits is writing wait for it too, so none is lost or applied twice.',
            'Duplicates: the search stops when you close it, `Ctrl+Z` restores, and `Enter` on a button presses that button.',
            'Rename with {date} waits for capture dates instead of using file dates; a failed rename says which photos kept a temporary name.',
            'Renaming a project keeps its flags and edits in every case, and a photo renamed onto an old name doesn\'t take that photo\'s flags.',
            'Updates: a stalled download fails with a message instead of hanging, and a setup Windows blocks says so.',
            'A tethered shot that can\'t be saved is kept in a jEditor-unsaved folder instead of lost; the scan helper is shut down cleanly when a scan ends early.',
            'Smaller fixes: sidebar photo counts update, Preparing previews no longer sticks, PNG scans show their size and DPI, settings are shared safely between windows, and a crashed page reloads itself.'
        ]
    },
    {
        version: '1.28.0', date: '2026-10-14',
        items: [
            'Shortcut profiles: Keyboard shortcuts (`?`) has a Profile list. Lightroom Classic gives Lightroom\'s keys: `R` crop, `E` single view, `G` grid, `Ctrl+[` and `Ctrl+]` rotate, `P` star, `X` needs rescan, `U` clear, `6`–`9` color labels, `F5` rescan. Make your own with New profile…; each profile keeps its own changes.',
            'Opening a project while another was still loading could mix their photos and flags; the first open now stops.',
            'Flags changed just before switching project are saved to it, and can no longer erase the next project\'s flags. Taking the last flag off a photo is saved too.',
            'Kept edits follow photos that are renamed or moved.',
            'Renaming a folder only in capitals (wedding → Wedding) while a photo in it is open elsewhere now says it couldn\'t, instead of risking the folder.',
            'Auto crop no longer fails with "Maximum call stack size exceeded" on prints laid touching.',
            'The No flag filter shows unflagged photos; Esc in Rename only closes it; a camera date of 0000:00:00 is no date (not 1899).',
            'FastFoto auto-size scans work when the Windows user name has accents, and closing a window mid-scan no longer shows an error.'
        ]
    },
    {
        version: '1.27.0', date: '2026-10-14',
        items: [
            'A new photo finder behind Auto crop, batch Auto crop, feeder scans and Preview and crop. It learns the scan\'s background from its edge (a lid, a feeder\'s backing and the white past a short photo), so it copes with lid shading, dust, dark photos on a dark lid, white-bordered prints on a white lid, tilted prints and prints laid touching. Ordinary photos, even ones with a plain sky, aren\'t taken for scans.',
            'The FastFoto crops each photo itself: jEditor now turns on the scanner\'s own auto-size (as in Epson\'s software), with no scanner window. Advanced → The scanner crops each photo itself (on to start with); if a scanner can\'t, jEditor scans the usual way and crops each photo.',
            'Preview and crop: click a print to box it, tilted to match it; or drag to draw a box. The print-size boxes are gone. Choose the glass size under Glass (remembered for each scanner; the OpticBook A300 is known to be A3), and the preview is sharper (about 150 dpi, only to find the prints: the scan itself is at the resolution chosen).',
            'Each scanned photo opens large as it comes in, like the camera\'s (Show each photo as it comes in).',
            'A scanner unplugged, switched off or asleep, a paper jam or an empty feeder now gets a proper dialog saying what to check, with Try again (the names carry on).',
            'Settings are remembered for each scanner; a photo feeder starts at 300 dpi. The scanner\'s own window brings each photo over whole now, which was slow on the FastFoto, and Details times each page.',
            'New project in the sidebar: names a new folder in your projects folder and opens it.',
            'Rename projects and folders: right-click one in the sidebar → Rename…, or the pencil on the project card. Its flags, kept edits and thumbnails go with it, and a pin follows it.'
        ]
    },
    {
        version: '1.26.0', date: '2026-10-14',
        items: [
            'Save edits when done, a setting for each project (on its card in the sidebar, or right-click the grid). Crops, straightening, turns and batch Auto crop are kept on the photos instead of being saved into them straight away, so they can be changed as often as you like before anything is written.',
            'Recrop any time: Crop opens on the whole photo, at the crop you kept, so nothing is lost by cropping too tight. Batch Auto crop is the same: check each photo (Crop, then `Shift+Enter` for Done & next) and fix the ones it got wrong.',
            'The grid, film strip and viewer show each photo as it will be saved, with a pencil on the edited ones. The bar under the toolbar counts them, with Save and Discard. Save writes them into the photos (the originals are kept, so `Ctrl+Z` puts them back with the edits kept again) or exports copies of every photo, edited ones with their edits, into "jEditor Export".',
            'Kept edits stay with the project when jEditor is closed. Right-click a photo for Discard edit.',
            'Auto crop works on feeder scans (FastFoto): each page comes out the feeder\'s full length with the photo at the top and backing and white around it; Auto crop now finds the photo on such a page, trims everything else and straightens it. Shift+A and the crop editor\'s Auto recognize these pages too, so ones scanned before can be fixed.',
            'Scanners whose driver won\'t open with the newer TWAIN manager (the OpticBook A300): jEditor now tries again in Older TWAIN mode by itself, and when that works, keeps it on for that scanner and says so. A scanner that won\'t say what it has gets both How choices (the glass and the feeder) instead of none.',
            'Undo history: the new History button in the toolbar (or `H`) lists every step Ctrl+Z can take back, newest first: what it was, which photos and when. Click a step to go back to before it; jEditor asks first, naming everything that will be undone. Like the other toolbar buttons, it can be moved to More or hidden in Settings.'
        ]
    },
    {
        version: '1.25.0', date: '2026-10-14',
        items: [
            'Scanning uses jEditor\'s own settings now, no scanner window: How picks the glass (preview and crop) or the feeder, from what the scanner has. The scanner\'s own window is still there, under Advanced, for when you need its extras.',
            'Settings in the scan dock: resolution, color or grayscale, file type (JPEG with a quality, PNG, or TIFF), and brightness and contrast (shown on the preview as you move them). Saved setups keep a combination under a name to pick next time.',
            'The feeder (FastFoto): Sides is Front, Back or Both; with both, each back is saved beside its photo as Smith-014-b.jpg. The FastFoto sends the back as its front, so jEditor swaps them for it (Advanced → front and back are swapped; remembered for each scanner).',
            'Preview and crop: tilt a box to match a crooked print with the round handle above it (the photo comes out straight), and ↻ turns it a quarter so the photo comes out the right way up (the arrow shows which way). Add a box at an exact print size (wallet, 3½×5, 4×6, 5×7, 8×10, 8½×11), wide or tall, where there\'s room on the glass.'
        ]
    },
    {
        version: '1.24.1', date: '2026-10-13',
        items: [
            'Browsing in the sidebar no longer opens folders by mistake: in Pinned and This PC, clicking a folder only opens it out to show what\'s inside. Open (beside it when you point at it) or a double-click makes it the project. Projects in your projects folder still open with one click.',
            'Settings: dragging toolbar controls to reorder them works again (it was taken for photos being dropped in).'
        ]
    },
    {
        version: '1.24.0', date: '2026-10-13',
        items: [
            'Tethered shooting, like Lightroom\'s: Camera in the toolbar connects a Sony Alpha (A7 III, A7 IV and similar) over USB and shoots straight into the open project. Set the camera to PC Remote first: Menu → Network (or Setup) → USB Connection → PC Remote.',
            'The camera dock shows its live view (bigger with the expand button) and the last photos in. Take a photo with the round button, Take photo, or `F12` anywhere in jEditor; shots taken with the camera\'s own shutter button come in too. Each new photo opens large (it can be turned off).',
            'Photos are named in the project\'s sequence, like scans (Smith-014.jpg); RAW + JPEG keep one number (Smith-014.arw beside Smith-014.jpg). Keep a copy on the camera\'s card is on to start with.',
            'Details (`>_`) shows what the camera says, for when it doesn\'t connect. jEditor talks to the camera through Windows\' own driver: nothing else needs installing.'
        ]
    },
    {
        version: '1.23.0', date: '2026-10-13',
        items: [
            'Preview and crop, for a flatbed like the OpticBook: in the scan dock, choose How → Preview and crop. Lay prints on the glass, as many as fit; jEditor previews the glass, with no scanner window, and puts a box round each print it finds.',
            'Adjust the boxes: drag on the glass to add one, drag a box to move it, or its corners to resize it; × or `Delete` removes one. Choose the resolution (from what the scanner offers; 600 dpi to start with) and color or grayscale, then Scan: the glass is scanned once and each box saved as its own photo, named in order. Auto crop each photo then trims each to its print and straightens it.',
            'Scan more previews the glass again for the next prints, and the names carry on. How you scan is remembered for each scanner, and Stop works while it previews too.'
        ]
    },
    {
        version: '1.22.1', date: '2026-10-13',
        items: [
            'Details in the scan dock (the `>_` button): jEditor\'s log, live, showing what the scanner\'s driver is doing as it does it. Errors are in red. Copy copies the lines to send on; Log file shows the whole log in Explorer. It opens by itself when a scan fails.',
            'The log now also says how each TWAIN scan is set up (which TWAIN manager, transfer mode and whether it goes through the 32-bit helper).'
        ]
    },
    {
        version: '1.22.0', date: '2026-10-13',
        items: [
            'Two projects at once: New window (`Ctrl+Shift+N`, or `Ctrl`+click a project in the sidebar) opens another jEditor window, and Split (on the project card) puts this window and another side by side.',
            'Photos dragged from one window onto a folder in the other, or onto its photos, move there (hold `Ctrl` to copy). `M` lists the other window\'s folders too. `Ctrl+Z` puts them back.',
            'The scan dock: Scan now opens a panel that floats over the photos instead of a box in the way. Keep working, or work in another window, while it scans: it shows the last photos as they come in, with Stop, then Scan more (the names carry on) or Change settings. Drag it by its title; — makes it small.'
        ]
    },
    {
        version: '1.21.0', date: '2026-10-13',
        items: [
            'A new sidebar. At the top, the open project: its name, where it is, how many photos, and Scan, Show in Explorer and Pin. Then its folders, as before.',
            'Projects: every project in your projects folder (chosen the first time; click its name to change it), newest first, with how many photos and when each last changed, and a search box. Projects opened from elsewhere are listed under them. Click one to open it.',
            'Pinned: folders you pin (the pin beside any folder), and the folders pinned in Explorer\'s Quick Access. This PC: the drives, which open out like Explorer\'s. A USB drive plugged in is marked New, and can be ejected from here.',
            'The start screen shows the same projects, pinned folders and drives.',
            'A folder with no photos in it opens, ready to scan into or fill from Explorer, instead of saying No photos found. Deleting the last photo keeps the project open too.',
            'While a scan runs, a message says which scanner and offers Stop, for a scanner whose window never shows. If its driver doesn\'t respond, jEditor gives up on it after 5 seconds and starts the scanning helper afresh next time.',
            'Compatibility mode in the Scan box, for TWAIN scanners whose window never opens (some Plustek drivers, like the OpticBook\'s): it uses Windows\' older TWAIN manager and takes the whole image at once. Remembered for each scanner.',
            'Settings → Updates → Show log opens jEditor\'s log in Explorer, to send when something goes wrong.',
            'Order is now project everywhere on screen.'
        ]
    },
    {
        version: '1.20.2', date: '2026-10-13',
        items: [
            'Updating from inside jEditor no longer fails and rolls back: the setup now waits until jEditor has really closed before replacing its files.',
            'If an update still doesn\'t install, jEditor opens again on the version you had and says so, with where the setup\'s log is, instead of just closing.'
        ]
    },
    {
        version: '1.20.1', date: '2026-10-12',
        items: [
            'TWAIN scanners (the FastFoto through Epson Scan 2, not just its WIA version) now scan through a small 32-bit helper, the way NAPS2 does, using the scanners\' 32-bit drivers. It brings its own TWAIN manager, so nothing extra needs installing.',
            'Auto crop each photo (on to start with, in the Scan box): prints of any size are found on each scan and cropped to, as soon as the scan is in. Ctrl+Z puts the scans back as they were.',
            'Photos added to the open folder (by a scanner, say) just appear, without a message for each batch. R still says what changed.',
            'jEditor keeps a log of what it does (%LOCALAPPDATA%\\jEditor\\logs), including each scan step by step, for when something goes wrong.'
        ]
    },
    {
        version: '1.20.0', date: '2026-10-12',
        items: [
            'Scan straight into the open order: click Scan in the toolbar, pick the scanner, the folder and the names, and the scanner\'s own window opens (Epson Scan 2, Plustek). Each photo is saved into the order as it\'s scanned and shows up straight away, so a stack in the FastFoto feeder fills the grid while it scans.',
            'Names follow on from the folder\'s photos (Smith-014.jpg after Smith-013.jpg), each folder with its own sequence, and Scan more carries on where the last scan stopped. Names already taken are skipped, never overwritten.',
            'Browse other orders, folders and drives: the folder list has a Browse tab with your recent orders (switch with one click), the drives on this PC and the usual folders. Click into any folder to see how many photos it has, then Open as order. The start screen lists the drives too.',
            'Orders on a USB stick: plugging one in while jEditor is open offers to browse it, and it\'s listed first under Drives. Take it out and Browse steps back out of it.'
        ]
    },
    {
        version: '1.19.0', date: '2026-10-12',
        items: [
            'Order folders now hold only photos. What jEditor keeps for an order (flags, the thumbnail cache, Auto crop originals) is kept on this PC instead of in a .jeditor folder. An order\'s old .jeditor folder is moved out the next time it\'s opened, flags and all.',
            'Deleted photos go to the Windows Recycle Bin, and `Ctrl+Z` still brings them back. On a network or USB drive, which has no Recycle Bin, jEditor keeps them itself until you clean up.',
            'Stored orders (Settings → Folder → Manage…) lists every order jEditor keeps data for, newest first, with how much room each takes. Open an order again from there, remove its cache or everything, remove every cache at once, or remove orders whose folder is gone.',
            'Updates: jEditor looks for a new version once a day (Settings → Updates, where you can also check by hand or turn this off). Click Update and it downloads, installs and opens again on its own, still without admin rights.'
        ]
    },
    {
        version: '1.18.1', date: '2026-10-12',
        items: [
            'Messages and the progress pill moved to the bottom-left corner, so they no longer cover the middle of the photo. In the grid they sit beside the folder list when it\'s open.',
            'Fixed photos flashing as if selected for a moment when switching back to the grid: the ones selected the last time you were in the grid lit up again before clearing.'
        ]
    },
    {
        version: '1.18.0', date: '2026-10-12',
        items: [
            'Photos deleted in File Explorer no longer get stuck in jEditor. Deleting a photo that\'s already gone just takes it off the screen, a delete that Windows never finishes gives up on that file after 30 seconds instead of hanging, and a stuck operation no longer stops the folder watch from noticing photos deleted elsewhere.',
            'A photo a scanner is still saving is added once it\'s whole, not half-written, and a preview that can\'t be made or shown is tried again instead of staying blank.',
            'Folder details: in the grid, `I` (or Order info / Folder info in the right-click menus) shows the folder you\'re in: how many photos, here and with subfolders, total size, average and largest photo, file types, dates, flags, and for the whole order how much room jEditor\'s .jeditor folder takes (trash, cache, Auto crop originals). Select several photos to see the same for the selection. Single view still shows the photo\'s own details.',
            'The folder list shows the total for what you\'re looking at, such as 1,240 photos · 4.80 GB. Click it for the details. Hovering a folder shows its size too.',
            'The film strip\'s background is always black, in both themes.',
            'In single view, the controls above the film strip fade away a few seconds after they appear, leaving the photo the screen. Move the pointer to where they were and they come back. To do without them altogether, turn off Buttons above the film strip in Settings.',
            'The selection bar in the grid is centered on the photos again, beside the folder list when it\'s open.',
            'Opening an order whose subfolder has a .jeditor folder of its own (because that subfolder was once opened on its own) merges it into the order\'s and removes it, so the order has just one. Its deleted photos and Auto crop originals move into the order\'s .jeditor, named after the subfolder, and its flags join the order\'s. Its cache is dropped and rebuilt when needed. If anything can\'t be moved, that .jeditor is left where it is.'
        ]
    },
    {
        version: '1.17.0', date: '2026-10-12',
        items: [
            'A new look: one consistent set of colors, type, spacing, icons and buttons across every screen, with quieter neutral grays so the photo stands out and the accent color only marking what\'s selected, focused or the main action.',
            'Settings (the gear, or `Ctrl+,`) replaces Customize controls. New in it: a light theme (or match the system), the color behind photos (black, gray or light, for judging color), Comfortable density for bigger text and controls, and Subtle glass, which is faster on older computers.',
            'The toolbars no longer switch between light and dark as you move through bright and dark photos. They stay readable over any photo.',
            'Clean up, Export, error messages and the big Auto crop question are now dialogs in the app instead of browser pop-ups. Clean up lists what it will remove and starts on Cancel.',
            'The selection bar is grouped and never runs off the edge: Rotate, Auto crop, Move to, Rename and Delete, with Export, Copy to and Rotate 180° under ⋯.',
            'Selected photos show a tick as well as the colored ring, and the current photo has a white ring of its own, so the two are easy to tell apart. Tiles no longer grow on hover.',
            'Messages appear at the bottom center, above the toolbars, instead of covering the folder pill or the top of the grid. In crop and duplicates they appear at the top.',
            'Crop and straighten: the toolbar is regrouped with Save on the right, and the straighten slider and level line follow the accent color.',
            'The start screen is simpler, with Settings and Keyboard shortcuts at the bottom.',
            'Keyboard: every button, the folder list and the flag list can be reached with `Tab`, with a visible focus ring; the right-click menu works with the arrow keys; dialogs keep focus inside until they close. Toolbar buttons can be reordered with `Alt+↑` / `Alt+↓` in Settings.',
            'Works better in a narrow window and on tablets.'
        ]
    },
    {
        version: '1.16.0', date: '2026-10-12',
        items: [
            'jEditor watches the open folder. New photos (a scanner saving into the order, say) slot into the grid where they belong without losing your place, with a brief glow, and a message offers Show. Photos deleted or edited in another program are picked up too. Turn it off with Watch the folder for changes in Customize controls.',
            'Rescanning (`R`) and opening a folder are quicker, most of all on a network drive: folders are listed several at a time, and only new photos are opened. An unchanged order rescans in milliseconds. `R` now also notices photos removed or edited elsewhere.',
            'Flags: `P` stars a photo, `X` marks it as needing a rescan, `1`–`5` give it a color label (red, yellow, green, blue, purple) and `U` clears them. In the grid they apply to the selection. They show on the tiles, the film strip and beside the file name, and are kept with the order in .jeditor, so they follow renames and moves and go with the order to another computer. `Ctrl+Z` undoes them.',
            'The folder list has a Flags section with counts. Click one to show only those photos, then `Ctrl+A` selects them for Move to, Export or Delete. Right-click it to copy or save the list of names: the rescan list for whoever is on the scanner.',
            'The right-click menu starts with a row of flag buttons.',
            'Search: `Ctrl+F` or `/` (or the magnifier in the folder pill) finds photos by name and folder. Every word you type must match; `is:star`, `is:rescan`, `is:red` and the other colors find flags.',
            'Auto Crop on the selection bar (`Shift+A`) runs Auto on every selected photo in the background: it finds the print, straightens it and crops to it, with the aspect ratio last chosen in the crop editor. Photos with no print edge are left alone. The originals are kept in .jeditor/originals, so one `Ctrl+Z` puts the whole batch back.',
            'Opening a folder that\'s inside an order you\'ve opened before (one on the Recent list) offers to open the whole order at that folder instead, so the order keeps one .jeditor rather than getting a second one in the subfolder.',
            'Accent color in Customize controls: pick a swatch or any color, and everything blue follows it. Text on it turns dark when the color is light.',
            'Messages are quieter glass pills that match the top bar, with a small icon for what happened, and slide in and out smoothly. The same message twice shows ×2 instead of stacking, and a message with a button (Undo, Show) stays up while the pointer is on it.',
            'The selection bar keeps clear of the folder list, and of the grid size slider when there\'s room.'
        ]
    },
    {
        version: '1.15.1', date: '2026-10-07',
        items: [
            'Zooming the grid (the slider or `Ctrl` + wheel) keeps your place: the highlighted photo stays where it is on screen while the tiles grow or shrink around it. If it\'s out of sight, the photo in the middle of the view stays put instead.',
            'Rescanning the folder (`R`) keeps your place too: when new photos come in, the highlighted photo stays where it is on screen.',
            'Fixed the grid jumping after zooming, when rows above had been scrolled past.'
        ]
    },
    {
        version: '1.15.0', date: '2026-10-07',
        items: [
            'Recent orders on the start screen, under Open Folder: the last six folders you opened, newest first. Click one to open it again without picking it. Chrome may ask once more for permission to edit it.',
            'Hover a recent order and click × to take it off the list. The folder itself isn\'t touched.',
            'If a recent folder has been moved, renamed or deleted, jEditor says so and offers to take it off the list.',
            'The three pills along the top (folders, file name, controls) now match: same height, text and glass. They all follow the UI size setting.',
            'The folder pill is simpler: no photo count and no New folder button. New folder is at the bottom of the folder list, on `Shift+N`, and in the grid\'s right-click menu.',
            'The file path chip at the bottom left shows in single view only; the grid has the folder list and folder pill for that.',
            'Fixed grid tiles touching the row below when they stretch to fill the width; every tile now has the same gap all round.'
        ]
    },
    {
        version: '1.14.1', date: '2026-10-07',
        items: [
            'The folder controls in grid view are a pill at the top left, beside the other two, instead of a bar across the grid, so the grid starts higher up. The folder list toggle, All photos / Folders, the folder you\'re in and New folder are all in it; on a narrow window it keeps to the essentials.'
        ]
    },
    {
        version: '1.14.0', date: '2026-10-07',
        items: [
            'Folders, for collating an order into labelled folders. In grid view, a folder list on the left shows every folder (folders inside folders too) with its photo count. Click one to see just its photos.',
            'All photos shows every photo in the order, whatever folder it\'s in, with each photo\'s folder named on its tile. `A` switches between All photos and folders.',
            'Drag photos onto a folder to move them there. Hold `Ctrl` (or `Alt`) while dropping to copy them instead.',
            '`M` moves the selection (or the photo you\'re looking at) to a folder, `Shift+M` copies it. Type to find a folder, or type a new name to make the folder and move the photos into it in one go.',
            'If a photo with the same name is already in the folder, you\'re asked whether to keep both (the new one gets a number), skip it, or replace the old one (which goes to the trash).',
            'Make, rename and delete (empty) folders from the folder list, the bar above the grid (`Shift+N` makes one), or by right-clicking a folder.',
            'Hide the folder list (`Ctrl+B`) to work with folder tiles and a breadcrumb in the grid instead. `Backspace` goes up a folder.',
            'In a folder, `←` `→`, the film strip and Rename All cover that folder\'s photos only.',
            '`Ctrl+Z` undoes a move or copy in one step, including any photos it replaced and the folder made for it, and undoes making, renaming or deleting a folder.'
        ]
    },
    {
        version: '1.13.0', date: '2026-10-05',
        items: [
            'Opening a folder again after rotating photos is as quick as opening it with no changes. Before, every rotated photo\'s thumbnail and preview were made again from the full scan (120 big scans: 3.3 s → 0.2 s).',
            'Paging through photos you\'ve just rotated stays quick: their previews are kept instead of made again.',
            'Thumbnails and previews of JPEGs are made 2–4× faster, so a new order is ready sooner (2000 photos: 48 s → 21 s). The bigger the scans, the bigger the gain.',
            'Sorting by name is quicker on big orders.'
        ]
    },
    {
        version: '1.12.4', date: '2026-10-05',
        items: [
            'Rotate 180° is on `\\` now (it was `/`). Like any shortcut, it can be changed with `?`.'
        ]
    },
    {
        version: '1.12.3', date: '2026-10-05',
        items: [
            'Zoom goes up to 3200% of the photo\'s pixels. Past 100% the pixels show as sharp squares, with no smoothing.',
            'The mouse wheel zooms towards the pointer, the same amount each notch (about 25 notches from fit to 3200%). Trackpad pinch works too.',
            'A small readout shows the zoom level while zooming.',
            '`/` turns the photo 180° (the whole selection in the grid, and in the crop editor too). It\'s also in the right-click menu. (Moved to `\\` in 1.12.4.)',
            'Undoing a rotation of a grid selection puts back every photo in one step. Before, each `Ctrl+Z` undid one photo, and only the last 50 could be undone.',
            'Fixed double-click zooming to the wrong size (not 100%) on a photo that had been rotated.'
        ]
    },
    {
        version: '1.12.2', date: '2026-10-02',
        items: [
            'What\'s New: this list, in the More menu and on the start screen. The first time a new version opens, a notice links to it.',
            'The version shows in the window\'s title bar.'
        ]
    },
    {
        version: '1.12.1', date: '2026-10-02',
        items: [
            'Deleting many photos at once is much faster: they are moved into the trash instead of copied (300 photos: 13.6 s → 0.2 s). Undo is faster too.',
            'A progress pill shows while a big delete or restore runs.'
        ]
    },
    {
        version: '1.12.0', date: '2026-10-01',
        items: [
            'Crop and straighten works like Lightroom and Apple Photos: the frame stays in the middle and the photo moves behind it. After resizing, the view zooms so the crop fills the screen.',
            'Drag inside the frame to move the photo, outside it to rotate. Straightening turns the photo around the middle of the crop instead of shrinking the whole picture.',
            'Hold `Ctrl` (`⌘` on a Mac) and drag along a horizon or print edge to level it. `Shift` keeps the crop\'s shape, `Alt` resizes from the center.',
            'Auto (`Shift+A`) finds the print on a scan, straightens it and crops to its edges. Every photo runs Auto as each photo opens, for working through an order with `Shift+Enter`.',
            '`Ctrl+Z` and `Ctrl+Shift+Z` undo and redo inside the crop editor.',
            'Dragging outside the frame no longer draws a new crop box; it rotates instead.'
        ]
    },
    {
        version: '1.11.3', date: '2026-10-01',
        items: [
            'Grid and film-strip tiles show a spinner while their thumbnail loads, instead of a black square.',
            'Double-click a photo to zoom to 100% on that spot; double-click again to fit.'
        ]
    },
    {
        version: '1.11.2', date: '2026-10-01',
        items: [
            'Fixed the "Preparing previews" pill being unreadable on light photos.',
            'Scans that are already about screen size open faster.'
        ]
    },
    {
        version: '1.11.1', date: '2026-10-01',
        items: [
            'Fixed the web app sometimes failing to start for a few minutes after an update.'
        ]
    },
    {
        version: '1.11.0', date: '2026-10-01',
        items: [
            'jEditor keeps its data in a `.jeditor` folder inside the photo folder: the trash, plus cached thumbnails and duplicate data. Another computer opening the same order (say on a shared drive) gets them without recomputing.',
            'Clean Up Folder empties the trash and removes the cache when an order is finished.',
            'Batch rename: a name plus a sequence number, ordered by the current sort, date taken, name, date modified or size.',
            'Fixed photos sometimes showing a broken image after rotating.'
        ]
    },
    {
        version: '1.10.0', date: '2026-10-01',
        items: [
            'Smooth with 2000-photo orders: stepping through photos no longer hitches, and the grid and film strip stay quick.',
            'Rotating many photos at once is about 2.5× faster.',
            'The duplicate finder uses less memory and no longer freezes the page on big orders.'
        ]
    },
    {
        version: '1.9.2', date: '2026-10-01',
        items: [
            'Undo uses much less memory: rotations are undone by rotating back. Undo keeps up to 50 steps.',
            '`Ctrl+Shift+D` shows a performance readout, for troubleshooting slowdowns.'
        ]
    },
    {
        version: '1.9.1', date: '2026-09-28',
        items: [
            'The duplicate finder no longer groups unrelated scans: the scanner bed and borders are ignored, and each match shows a percentage.'
        ]
    },
    {
        version: '1.9.0', date: '2026-09-27',
        items: [
            'Rebuilt crop and straighten: always works from the photo on disk, never leaves empty corners, has print-size presets, Previous (reuse the last crop) and Save & Next.',
            'Crops keep the capture date, camera details, color profile and DPI.',
            'Rotating scanner JPEGs is lossless, even when they have no orientation tag.',
            'Big scans open instantly from a screen-sized preview; zooming in shows the original.',
            'Keyboard shortcuts can be viewed and changed (`?`).',
            'Find Duplicates (work in progress): exact copies and re-scans, reviewed side by side.'
        ]
    },
    {
        version: '1.8.1', date: '2026-07-09',
        items: ['The progress pill and messages moved to the top left, clear of the controls.']
    },
    {
        version: '1.8.0', date: '2026-07-09',
        items: [
            'Install jEditor as an app from Chrome or Edge; it works offline.',
            'Each version is published as a GitHub release with a single-file download.'
        ]
    },
    {
        version: '1.7.0', date: '2026-07-09',
        items: [
            'Customize the controls: reorder them, move them into More or hide them, make the pill vertical and change the UI size.',
            'The film strip can be resized by dragging its top edge.',
            'One pill shows all background work in progress.'
        ]
    },
    {
        version: '1.6.0', date: '2026-07-09',
        items: [
            'Undo (`Ctrl+Z`) for rotations, crops, renames and deletes.',
            'Delete moves photos to a trash folder instead of deleting them.',
            'Sort by date taken, rename photos, export resized copies, slideshow, and a right-click menu.',
            'Drag over the grid to select photos.'
        ]
    },
    {
        version: '1.5.0', date: '2026-07-08',
        items: ['File Info panel (`I`) with size, dates and camera, and the photo\'s location in the corner.']
    },
    {
        version: '1.4.1', date: '2026-07-08',
        items: ['Crop and film-strip buttons moved into the top-right controls.']
    },
    {
        version: '1.4.0', date: '2026-07-08',
        items: ['Smooth grid scrolling: thumbnails are made in the background for the whole folder.']
    },
    {
        version: '1.3.0', date: '2026-07-07',
        items: ['Rotation shows instantly everywhere while the file is saved in the background.']
    }
];
