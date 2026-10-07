// What's new, newest first. Shown in the app (What's New) and used as the
// GitHub release notes. Every version bump needs an entry here: the tests
// check that the first entry is the current APP_VERSION.
// Text between `backticks` is shown as a key.

const CHANGELOG = [
    {
        version: '1.15.0', date: '2026-10-07',
        items: [
            'Recent orders on the start screen, under Open Folder: the last six folders you opened, newest first. Click one to open it again without picking it. Chrome may ask once more for permission to edit it.',
            'Hover a recent order and click × to take it off the list. The folder itself isn\'t touched.',
            'If a recent folder has been moved, renamed or deleted, jEditor says so and offers to take it off the list.',
            'The three pills along the top (folders, file name, controls) now match: same height, text and glass. They all follow the UI size setting.',
            'The folder pill is simpler: no photo count and no New folder button. New folder is at the bottom of the folder list, on `Shift+N`, and in the grid\'s right-click menu.',
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
