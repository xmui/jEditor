// Each menu row's picture, at its left (jEditor's own look): one line
// style, as the rest of the app's icons, so a menu can be read at a
// glance. Found by the command's key id (KEY_ACTIONS) if the row has one,
// else by its words. A row nothing matches keeps an empty space the same
// width, so the words still line up; a row with a tick shows the tick
// there instead (style.css).

const MenuIcons = {
    P: {
        rotL: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
        rotR: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
        flip: '<path d="M12 3v18"/><path d="m16 7 4 5-4 5"/><path d="m8 7-4 5 4 5"/>',
        flipV: '<path d="M3 12h18"/><path d="m7 8 5-4 5 4"/><path d="m7 16 5 4 5-4"/>',
        crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
        trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
        rename: '<path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 2.9 2.9L7 18.8l-4 1 1-4z"/>',
        folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
        folderPlus: '<path d="M12 10v6M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
        moveTo: '<path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/>',
        copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
        paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
        share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
        convert: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
        reveal: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
        window: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 4v16"/>',
        adjust: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
        brush: '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z"/><path d="M9.2 12c-2.5 0-4.2 1.6-4.2 4 0 1.5-.8 2.6-2.4 3.4C4.4 21 6.3 21.5 8 21.5c3 0 5-1.9 4.9-4.6"/>',
        scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
        camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
        play: '<polygon points="6 3 20 12 6 21 6 3"/>',
        expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        gear: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
        keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 15h8"/>',
        help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
        layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
        layerPlus: '<path d="m12 2 10 5-10 5L2 7z"/><path d="M2 12l10 5 4-2"/><path d="M19 14v6M16 17h6"/>',
        merge: '<path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.2 2.8L6 20"/><path d="m18 20-3.3-3.3"/>',
        mask: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="5"/>',
        lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        select: '<path d="M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M21 19a2 2 0 0 1-2 2M5 21a2 2 0 0 1-2-2M9 3h1M14 3h1M9 21h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1"/>',
        invert: '<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"/>',
        group: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
        bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
        undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
        redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
        clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
        flag: '<path d="M4 22V4a1 1 0 0 1 1-1h12l-2 5 2 5H5"/>',
        star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
        tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
        photo: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
        photoPlus: '<path d="M16 5h6M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/><circle cx="9" cy="9" r="2"/>',
        download: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
        drive: '<path d="M22 12H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/><path d="M6 16h.01M10 16h.01"/>',
        disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>',
        close: '<path d="M18 6 6 18M6 6l12 12"/>',
        sync: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
        compare: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
        warn: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
        wand: '<path d="m15 4-1-1M20 9l1 1M14 9l7-7M3 21l9-9"/><path d="M12.2 6.2 11 5M18 12l1.2 1.2"/>',
        transform: '<path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
        text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
        frame: '<path d="M22 6H2M22 18H2M6 2v20M18 2v20"/>',
        zoom: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M8 11h6M11 8v6"/>',
        list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
        pin: '<path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
        filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
        sparkle: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
        sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
        palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.6-1.7h2A5.6 5.6 0 0 0 22 10.9C22 6 17.5 2 12 2z"/>'
    },

    // [words, picture], tried in order: the first that matches. The words
    // are the row's, lower case (a number or a name in it doesn't matter)
    BY_WORDS: [
        [/^delete|^trash|^discard|remove all caches|take .* off all|^take it off$/, 'trash'],
        [/rotate .*left|rotate the view left/, 'rotL'],
        [/rotate|turn .*upright|turn upright|put the view straight/, 'rotR'],
        [/turn and flip|flip .*left to right|^left to right/, 'flip'],
        [/flip|upside down/, 'flipV'],
        [/crop|canvas back|canvas size|shrink|grow|feather/, 'crop'],
        [/^rename|edit the text/, 'rename'],
        [/new folder|folder inside/, 'folderPlus'],
        [/^move|move .* here/, 'moveTo'],
        [/^copy|duplicate|copy .* here/, 'copy'],
        [/^paste/, 'paste'],
        [/^export|burn .* disc|^share/, 'share'],
        [/convert/, 'convert'],
        [/folder info|^info|^details/, 'info'],
        [/new window|side by side|split/, 'window'],
        [/show in |open folder|open as the project|open in /, 'reveal'],
        [/sync/, 'sync'],
        [/new blank/, 'photoPlus'],
        [/adjust|restore colou?r|auto colou?r|white balance|^auto$|reset/, 'adjust'],
        [/paint|brush|make a brush/, 'brush'],
        [/scan/, 'scan'],
        [/camera/, 'camera'],
        [/slideshow/, 'play'],
        [/full screen/, 'expand'],
        [/search|find /, 'search'],
        [/settings/, 'gear'],
        [/keyboard|shortcuts/, 'keyboard'],
        [/guide|help/, 'help'],
        [/tour|what.s new/, 'sparkle'],
        [/new (adjustment )?layer|bring in an image|new blank/, 'layerPlus'],
        [/merge|flatten/, 'merge'],
        [/mask/, 'mask'],
        [/lock/, 'lock'],
        [/show this layer alone|show only|before and after|^show /, 'eye'],
        [/select its pixels|^select|clear selection/, 'select'],
        [/invert/, 'invert'],
        [/group/, 'group'],
        [/preset|save as a look|change your looks|^save /, 'bookmark'],
        [/undo|history/, 'clock'],
        [/redo/, 'redo'],
        [/flag|pick|reject|needs rescan/, 'flag'],
        [/star/, 'star'],
        [/label|colou?r label/, 'tag'],
        [/photos library|add .* to photos/, 'photoPlus'],
        [/import/, 'download'],
        [/usb|drive|card/, 'drive'],
        [/disc/, 'disc'],
        [/^close|remove from recents|clear search/, 'close'],
        [/sync/, 'sync'],
        [/clipping/, 'warn'],
        [/transform|nudge/, 'transform'],
        [/text/, 'text'],
        [/zoom|actual pixels|^fit|100%/, 'zoom'],
        [/list|names/, 'list'],
        [/pin/, 'pin'],
        [/filter|types|^flags$/, 'filter'],
        [/^grid|all photos|^photos/, 'grid'],
        [/sidebar|folders/, 'sidebar'],
        [/^open/, 'photo'],
        [/colour|color|background|use for/, 'palette'],
        [/symmetry|snap|smoothing|pen pressure/, 'wand']
    ],

    // A key id's picture, before the words (the same command, whatever
    // its row says)
    BY_ID: [
        [/rotateLeft|viewLeft/, 'rotL'], [/rotateRight|rotate180|upright|viewRight/, 'rotR'], [/flipH/, 'flip'], [/flipV/, 'flipV'],
        [/trash|paint\.clear/, 'trash'], [/rename/, 'rename'], [/moveTo/, 'moveTo'], [/copyTo|duplicate|copyImage|copyAdjust|adjust\.copy|paint\.copy/, 'copy'],
        [/paste/, 'paste'], [/\.crop$|autoCrop|cropLike/, 'crop'], [/edit\.adjust/, 'adjust'], [/edit\.paint/, 'brush'],
        [/flag\.(red|yellow|green|blue|purple)/, 'tag'], [/flag\.star/, 'star'], [/flag\./, 'flag'], [/undo|history/, 'clock'], [/redo/, 'redo'],
        [/saveOver/, 'download'], [/syncAdjust|adjust\.sync|autoSync/, 'sync']
    ],

    get(label, id) {
        const P = this.P;
        if (id) for (const [re, k] of this.BY_ID) if (re.test(id)) return P[k];
        const words = String(label || '').toLowerCase();
        for (const [re, k] of this.BY_WORDS) if (re.test(words)) return P[k];
        return '';
    },

    // The picture as an element, or an empty space its size
    el(label, id) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'i ctx-ico');
        svg.innerHTML = this.get(label, id);
        return svg;
    }
};
