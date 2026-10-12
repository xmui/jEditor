// What's new, newest first. Shown in the app (What's New) and used as the
// GitHub release notes. Every version bump needs an entry here: the tests
// check that the first entry is the current APP_VERSION.
// Text between `backticks` is shown as a key.

const CHANGELOG = [
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
            'The selection bar in the grid is centred on the photos again, beside the folder list when it\'s open.',
            'Opening an order whose subfolder has a .jeditor folder of its own (because that subfolder was once opened on its own) merges it into the order\'s and removes it, so the order has just one. Its deleted photos and Auto crop originals move into the order\'s .jeditor, named after the subfolder, and its flags join the order\'s. Its cache is dropped and rebuilt when needed. If anything can\'t be moved, that .jeditor is left where it is.'
        ]
    },
    {
        version: '1.17.0', date: '2026-10-12',
        items: [
            'A new look: one consistent set of colours, type, spacing, icons and buttons across every screen, with quieter neutral greys so the photo stands out and the accent colour only marking what\'s selected, focused or the main action.',
            'Settings (the gear, or `Ctrl+,`) replaces Customize controls. New in it: a light theme (or match the system), the colour behind photos (black, grey or light, for judging colour), Comfortable density for bigger text and controls, and Subtle glass, which is faster on older computers.',
            'The toolbars no longer switch between light and dark as you move through bright and dark photos. They stay readable over any photo.',
            'Clean up, Export, error messages and the big Auto crop question are now dialogs in the app instead of browser pop-ups. Clean up lists what it will remove and starts on Cancel.',
            'The selection bar is grouped and never runs off the edge: Rotate, Auto crop, Move to, Rename and Delete, with Export, Copy to and Rotate 180° under ⋯.',
            'Selected photos show a tick as well as the coloured ring, and the current photo has a white ring of its own, so the two are easy to tell apart. Tiles no longer grow on hover.',
            'Messages appear at the bottom centre, above the toolbars, instead of covering the folder pill or the top of the grid. In crop and duplicates they appear at the top.',
            'Crop and straighten: the toolbar is regrouped with Save on the right, and the straighten slider and level line follow the accent colour.',
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
            'Flags: `P` stars a photo, `X` marks it as needing a rescan, `1`–`5` give it a colour label (red, yellow, green, blue, purple) and `U` clears them. In the grid they apply to the selection. They show on the tiles, the film strip and beside the file name, and are kept with the order in .jeditor, so they follow renames and moves and go with the order to another computer. `Ctrl+Z` undoes them.',
            'The folder list has a Flags section with counts. Click one to show only those photos, then `Ctrl+A` selects them for Move to, Export or Delete. Right-click it to copy or save the list of names: the rescan list for whoever is on the scanner.',
            'The right-click menu starts with a row of flag buttons.',
            'Search: `Ctrl+F` or `/` (or the magnifier in the folder pill) finds photos by name and folder. Every word you type must match; `is:star`, `is:rescan`, `is:red` and the other colours find flags.',
            'Auto Crop on the selection bar (`Shift+A`) runs Auto on every selected photo in the background: it finds the print, straightens it and crops to it, with the aspect ratio last chosen in the crop editor. Photos with no print edge are left alone. The originals are kept in .jeditor/originals, so one `Ctrl+Z` puts the whole batch back.',
            'Opening a folder that\'s inside an order you\'ve opened before (one on the Recent list) offers to open the whole order at that folder instead, so the order keeps one .jeditor rather than getting a second one in the subfolder.',
            'Accent colour in Customize controls: pick a swatch or any colour, and everything blue follows it. Text on it turns dark when the colour is light.',
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
            'Hold `Ctrl` (`⌘` on a Mac) and drag along a horizon or print edge to level it. `Shift` keeps the crop\'s shape, `Alt` resizes from the centre.',
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
            'Crops keep the capture date, camera details, colour profile and DPI.',
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
